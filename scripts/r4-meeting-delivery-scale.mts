import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import * as schema from "../lib/db/schema.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { readStateReference } from "../lib/control-plane/expansion/state-references.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { installDoorHosts } from "../lib/civic-data/source-authority.ts";
import { MEETING_PARTITION_CONTRACTS, refreshMeetingPartitions } from "../lib/civic-data/meeting-partitions.ts";
import { routineTaskDueAtMs, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { captureSourceAcquisitions } from "../lib/sources/acquisition-trace.ts";
import { fetchSource, runWithSourceFetch } from "../lib/sources/fetch-source.ts";
import { postgresSourceFetchStore, SOURCE_FETCH_DDL } from "../lib/sources/fetch-source-state.ts";
import { makeCivicPlusSource } from "../lib/sources/civicplus/index.ts";
import { readMeetingPartitionProjection } from "../lib/meetings/snapshot.ts";
import { meetingFetchPass } from "../lib/meetings/shared-fetch.ts";
import { installMeetingDoors, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { WEBSITE_PACING_DDL } from "../lib/control-plane/website-pacing.ts";
import { retainMeetingFetchBytes } from "../lib/civic-data/retained-meeting-bytes.ts";
import { RUNTIME_AUTHORITY_ENV } from "../lib/civic-data/runtime-authority.ts";
import { promoteMeetingPartition } from "./ingest.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { installDoorRecords } from "../lib/doors/meeting-doors.ts";
import { doorsFromWiringRow } from "../lib/doors/seed-meetings.ts";
import { applyDerivedRow, checkDoorDraft } from "../lib/doors/registry.ts";
import { publishRoutineReaderEdgeOutcome } from "../lib/civic-data/reader-edge-publication.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { readReaderEdgeMeetings } from "../lib/meetings/edge-serving.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import { REGISTRY_RUNTIME_SCOPE, type RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const MEETINGS_PER_BODY = 24;
const RESPONSE_BYTES = 220_402;

interface Statement { sql: string; params: unknown[]; arrayMode?: boolean }
interface ResultRows { rows: unknown[] }
interface Message { id?: number; statements?: Statement[]; transaction?: boolean; results?: ResultRows[]; error?: string; result?: Record<string, number | string> }
const mode = arg("mode");
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
function launch(args: string[]) { return fork(fileURLToPath(import.meta.url), args, {
  execArgv: ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs"], stdio: ["ignore", "inherit", "inherit", "ipc"],
}); }
async function database() {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const pg = new PGlite(join(arg("root")!, "postgres"));
  const initialized = await pg.query("SELECT to_regclass('civic_data_promotions') AS table_name");
  if (!(initialized.rows[0] as { table_name: unknown }).table_name) for (const name of ["0025_typical_fixer.sql", "0026_lame_sunset_bain.sql", "0027_pdc_candidate_history_shape.sql", "0028_wise_ikaris.sql", "0029_unchanged_confirmation_receipts.sql", "0031_civic_payload_parts.sql"]) {
    for (const sql of readFileSync(join("lib/db/migrations", name), "utf8").split("--> statement-breakpoint")) if (sql.trim()) await pg.exec(sql);
  }
  for (const sql of [...SOURCE_FETCH_DDL, ...WEBSITE_PACING_DDL]) await pg.exec(sql);
  let pending = Promise.resolve();
  process.on("message", (message: Message) => {
    if (!message.statements) return;
    pending = pending.then(async () => {
      try {
        const execute = async (client: Pick<typeof pg, "query">) => {
          const out = [];
          for (const statement of message.statements!) {
            const result = await client.query(statement.sql, statement.params, { rowMode: statement.arrayMode ? "array" : "object",
              parsers: { [types.TIMESTAMP]: value => value, [types.TIMESTAMPTZ]: value => value, [types.DATE]: value => value } });
            out.push({ rows: result.rows });
          }
          return out;
        };
        const results = message.transaction ? await pg.transaction(execute) : await execute(pg);
        process.send!({ id: message.id, results });
      } catch (error) { process.send!({ id: message.id, error: String(error) }); }
    });
  });
  process.on("disconnect", () => { void pending.then(() => pg.close()); });
}
function clientFor(child?: ChildProcess) {
  let next = 0;
  const waiting = new Map<number, { resolve(rows: ResultRows[]): void; reject(error: Error): void }>();
  const receive = (message: Message) => {
    const item = waiting.get(message.id!); if (!item) return;
    waiting.delete(message.id!);
    if (message.error) item.reject(new Error(message.error)); else item.resolve(message.results!);
  };
  if (child) child.on("message", receive); else process.on("message", receive);
  child?.on("exit", code => { for (const item of waiting.values()) item.reject(new Error(`Database exited ${code}`)); waiting.clear(); });
  return (statements: Statement[], transaction: boolean): Promise<ResultRows[]> => new Promise((resolve, reject) => {
    const id = ++next; waiting.set(id, { resolve, reject });
    const message = { id, statements, transaction };
    if (child) child.send(message); else process.send!(message);
  });
}
async function main() {
  const root = arg("root") ?? mkdtempSync(join(tmpdir(), "r4-meeting-delivery-"));
  mkdirSync(root, { recursive: true });
  const publish = arg("publish") === "only", cohort = arg("cohort") ?? (publish ? "all" : "hot");
  const workers = publish ? 1 : Number(arg("workers") ?? 8), started = performance.now();
  console.log(JSON.stringify({ persistentRoot: root, publish }));
  const database = launch(["--mode=database", `--root=${root}`]), request = clientFor(database);
  const results: Record<string, number | string>[] = [];
  try {
    await Promise.all(Array.from({ length: workers }, (_, index) => new Promise<void>((resolve, reject) => {
      const child = launch([`--mode=${publish ? "publisher" : "worker"}`, `--worker=${index}`, `--workers=${workers}`, `--root=${root}`,
        `--state=${arg("state") ?? "IL"}`, `--cohort=${cohort}`, ...(arg("limit") ? [`--limit=${arg("limit")}`] : [])]);
      child.on("message", (message: Message) => {
        if (message.result) results.push(message.result);
        if (message.statements) void request(message.statements, Boolean(message.transaction)).then(
          rows => child.send({ id: message.id, results: rows }), error => child.send({ id: message.id, error: String(error) }));
      });
      child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Delivery worker ${index} exited ${code}`)));
    })));
    const total = (field: string) => results.reduce((sum, row) => sum + Number(row[field]), 0);
    const peak = Math.max(...results.map(row => Number(row.peakRssBytes)));
    const previousRuntime = (name: string) => publish && existsSync(join(root, name)) ? Number(JSON.parse(readFileSync(join(root, name), "utf8")).runtimeMs) : 0;
    const deliveryRuntimeMs = previousRuntime("delivery.json"), coldSeedRuntimeMs = previousRuntime("cold-delivery.json");
    const result = { state: arg("state") ?? "IL", root, cohort, workers, meetingsPerBody: MEETINGS_PER_BODY, responseBytes: RESPONSE_BYTES,
      bodies: total("bodies"), hotBodies: total("hotBodies"), promoted: total("promoted"), visible: total("visible"),
      runtimeMs: performance.now() - started, deliveryRuntimeMs, coldSeedRuntimeMs, peakWorkerRssBytes: peak, copiesAtMargin: Math.floor((8 * 1024 ** 3 - 768 * 1024 ** 2) / peak),
      databaseBytesRead: total("databaseBytesRead"), databaseBytesWritten: total("databaseBytesWritten"), databaseRequests: total("databaseRequests"),
      controlledPostingToCheckMs: Math.max(...results.map(row => Number(row.controlledPostingToCheckMs))),
      conservativePostingToReaderMs: Math.max(...results.map(row => Number(row.controlledPostingToCheckMs))) + deliveryRuntimeMs + performance.now() - started, results };
    assert.ok(result.conservativePostingToReaderMs < 90 * 60_000);
    writeFileSync(join(root, publish ? "publication.json" : cohort === "cold" ? "cold-delivery.json" : "delivery.json"), JSON.stringify(result));
    console.log(JSON.stringify(result));
  } finally {
    if (database.connected) database.disconnect();
    if (database.exitCode === null && database.signalCode === null) await new Promise<void>(resolve => database.on("exit", () => resolve()));
  }
}
async function worker() {
  Object.assign(process.env, { WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", DATABASE_URL: "postgresql://local:local@localhost/r4",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@localhost/r4", [RUNTIME_AUTHORITY_ENV.repo]: process.cwd(),
    [RUNTIME_AUTHORITY_ENV.sha]: "a".repeat(40), [RUNTIME_AUTHORITY_ENV.capability]: "ROUTINE_CONTRACT",
    [RUNTIME_AUTHORITY_ENV.parentPid]: String(process.ppid), [RUNTIME_AUTHORITY_ENV.nonce]: randomUUID().replaceAll("-", "").repeat(2) });
  const send = clientFor();
  let databaseBytesRead = 0, databaseBytesWritten = 0, databaseRequests = 0;
  const request = async (statements: Statement[], transaction: boolean) => {
    databaseBytesWritten += size({ statements, transaction }); databaseRequests++;
    const result = await send(statements, transaction); databaseBytesRead += size(result); return result;
  };
  const query = (sql: string, params: unknown[], config: { arrayMode?: boolean } = {}) => {
    const statement = { sql, params, arrayMode: config.arrayMode };
    return { statement, then: <T, R>(resolve: (value: ResultRows) => T, reject: (error: unknown) => R) => request([statement], false).then(rows => rows[0]!).then(resolve, reject) };
  };
  const client = { query, transaction: (queries: { statement: Statement }[]) => request(queries.map(row => row.statement), true) };
  const db = drizzle(client as unknown as NeonQueryFunction<false, false>, { schema });
  const state = arg("state") ?? "IL", NOW = Date.parse("2026-10-15T12:00:00.000Z"), roles = ["governing", "planning", "finance"];
  const units = readStateReference(process.cwd(), state, { units: "state" }).units;
  const cohort = arg("cohort") ?? "hot";
  const hotGovernmentIds = new Set(units.filter((_unit, index) => index % 4 === 0).map(unit => unit.pid6));
  const wirings: BodySourceWiring[] = units.flatMap((unit, index) => cohort === "hot" && index % 4 !== 0 || cohort === "cold" && index % 4 === 0 ? [] : roles.map((role): BodySourceWiring => {
    const division = `ocd-division/country:us/state:${state.toLowerCase()}/government:${unit.pid6}`;
    return { bodyId: `${division}#${role}`, ocdId: division, agendaSourceType: "CIVICPLUS", jurisdiction: unit.name,
      publishingOrg: unit.name, timeZone: "America/Chicago", verifiedAt: new Date(NOW).toISOString(),
      config: { slug: `${unit.pid6}-${role}`, bodyName: unit.name, icalUrl: `https://${state.toLowerCase()}-${unit.pid6}-${role}.example.gov/calendar.ics` } };
  })).slice(0, Number(arg("limit") ?? Number.POSITIVE_INFINITY));
  installMeetingDoors(wirings);
  installDoorHosts(wirings.map(wiring => new URL(wiring.config.icalUrl!).hostname));
  const installed = refreshMeetingPartitions(wirings);
  assert.equal(installed.refreshed, true); assert.equal(installed.skipped.length, 0);
  const partitions = new Map(MEETING_PARTITION_CONTRACTS.map(row => [row.bodyId, row]));
  const root = arg("root")!;
  if (mode === "publisher") {
    process.env[RUNTIME_AUTHORITY_ENV.capability] = "ROUTINE_SUPERVISOR";
    installFactReader(null);
    installDoorRecords(wirings.flatMap(doorsFromWiringRow).map(draft => {
      const checked = checkDoorDraft(draft);
      if (!checked.ok) throw new Error(checked.why);
      return applyDerivedRow(null, checked.value, new Date(NOW).toISOString(), new Date(NOW).toISOString())!;
    }), `state:US-${state}`);
    const postgres = new PostgresRoutineDataStore(db, null), registryVersion = "scale-registry";
    const store = new Proxy(postgres, { get(target, key) {
      if (key === "readPromotionIdentity") return async (recordClass: string, scope: string) => recordClass === "REGISTRY_RUNTIME_BINDING"
        ? { recordClass, scope, versionId: registryVersion } : target.readPromotionIdentity(recordClass as Parameters<typeof target.readPromotionIdentity>[0], scope);
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const artifacts = new LocalFileArtifactStore(join(root, "reader"));
    const started = performance.now(), at = new Date(NOW + 35 * 60_000).toISOString();
    const publication = await publishRoutineReaderEdgeOutcome(store, at, wirings.map(wiring => partitions.get(wiring.bodyId)!), {
      artifactStore: artifacts, state, readMeetingRegistry: async (_divisions, ids, versionId) => {
        assert.equal(versionId, registryVersion);
        const selected = new Set(ids);
        const bodies = wirings.filter(wiring => selected.has(wiring.bodyId)).map(wiring => ({ id: wiring.bodyId, ocdId: wiring.ocdId }));
        assert.equal(bodies.length, ids.length);
        return { kind: "PROMOTED", metadata: { recordClass: "REGISTRY_RUNTIME_BINDING", scope: REGISTRY_RUNTIME_SCOPE, versionId },
          value: { registry: { divisions: [], bodies } } as unknown as RegistryRuntimeReadModel };
      },
    });
    assert.equal(publication.ok, true, JSON.stringify(publication));
    const reader = await readReaderEdgeMeetings({ store: artifacts, states: [state.toLowerCase()], now: at,
      settings: meetingSettingsFromValues(), fallback: async () => { throw new Error("Edge reader cannot fall back to the database"); } });
    assert.equal(reader.kind, "PROMOTED");
    if (reader.kind !== "PROMOTED") throw new Error("Published state missing");
    const canceled = reader.value.meetings.filter(meeting => meeting.status === "CANCELED");
    assert.equal(reader.value.meetings.length, wirings.length * MEETINGS_PER_BODY);
    const hotBodies = wirings.filter(wiring => hotGovernmentIds.has(wiring.config.slug!.split("-")[0]!)).length;
    assert.equal(canceled.length, hotBodies);
    assert.equal(new Set(canceled.map(meeting => meeting.bodyId)).size, hotBodies);
    for (const meeting of canceled) assert.equal(meeting.provenance.collectedAt, at);
    const exact = await readReaderEdgeMeetings({ store: artifacts, meetingId: canceled[0]!.id, now: at,
      settings: meetingSettingsFromValues(), fallback: async () => { throw new Error("Exact reader cannot fall back to the database"); } });
    assert.equal(exact.kind, "PROMOTED");
    if (exact.kind === "PROMOTED") assert.equal(exact.value.meetings[0]!.status, "CANCELED");
    const result = { state, bodies: wirings.length, hotBodies, promoted: 0, visible: canceled.length, databaseBytesRead, databaseBytesWritten, databaseRequests,
      runtimeMs: performance.now() - started, peakRssBytes: process.resourceUsage().maxRSS * 1024,
      controlledPostingToCheckMs: 34 * 60_000, measurements: "Actual PostgreSQL composition and prepared projection, state artifact publication and scoped/exact-ID edge retrieval. Registry territory metadata is supplied as a fixture; fact overlay is empty. Database metrics are serialized SQL/results, not storage/WAL." };
    process.send!({ result }, () => process.disconnect!());
    return;
  }
  const vault = new DurableEvidenceStore(join(root, "vault"), { remote: null });
  const fetchStore = postgresSourceFetchStore(async (sql, params) => (await request([{ sql, params: [...params ?? []] }], false))[0]!.rows as Record<string, unknown>[]);
  const locks = createMemoryRepositories().locks;
  let bodies = 0, promoted = 0, visible = 0, maxControlledDelayMs = 0, maxPublicationWallMs = 0;
  const started = performance.now();
  try {
    for (let index = Number(arg("worker") ?? 0); index < wirings.length; index += Number(arg("workers") ?? 1)) {
      const wiring = wirings[index]!, partition = partitions.get(wiring.bodyId)!;
      process.env[RUNTIME_AUTHORITY_ENV.contract] = partition.id;
      const store = new PostgresRoutineDataStore(db, null);
      const initialClock = new Date(NOW).toISOString();
      const nextDue = routineTaskDueAtMs(routineTaskFromContract(partition), {
        lastAttemptedAt: initialClock, lastSucceededObservedAt: initialClock, sittingStarts: ["2026-10-17T18:00:00.000Z"],
      }, NOW, true);
      bodies++;
      for (const phase of cohort === "cold" ? [0] : [0, 1]) {
        const atMs = phase === 0 ? NOW : nextDue, at = new Date(atMs).toISOString();
        const stamp = (time: number) => new Date(time).toISOString().replaceAll(/[-:]/g, "").replace(".000", "");
        const events = Array.from({ length: MEETINGS_PER_BODY }, (_, index) => {
          const starts = cohort === "cold" ? NOW + (14 + index * 3) * 86_400_000
            : Date.parse("2026-10-17T18:00:00.000Z") + (index - 11) * 7 * 86_400_000;
          return ["BEGIN:VEVENT", `UID:${wiring.config.slug}-${index}`, `SUMMARY:${phase === 1 && index === 11 ? "Canceled public hearing" : "Public hearing"}`,
            `DTSTART:${stamp(starts)}`, `DTEND:${stamp(starts + 2 * 3_600_000)}`, "LOCATION:Virtual meeting", "END:VEVENT"].join("\r\n");
        });
        const calendarParts = ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "X-PUBLISHER-PAGE:", "END:VCALENDAR"];
        calendarParts[calendarParts.length - 2] += "x".repeat(RESPONSE_BYTES - Buffer.byteLength(calendarParts.join("\r\n")));
        const calendar = calendarParts.join("\r\n");
        assert.equal(Buffer.byteLength(calendar), RESPONSE_BYTES);
        const transport: typeof fetch = async () => new Response(calendar, { headers: { "content-type": "text/calendar", etag: `"phase-${phase}"` } });
        const pass = meetingFetchPass({ fetchImpl: fetchSource });
        const before = performance.now();
        try {
          const retained = await retainMeetingFetchBytes(() => runWithSourceFetch({ vault, state, sourceId: partition.id,
            websiteSize: { kind: "local-government", population: 9999, students: null }, runtime: { store: fetchStore, transport, now: () => atMs } }, () =>
            captureSourceAcquisitions(async run => run("civicplus", async () => {
              const adapter = makeCivicPlusSource([wiring], pass, { store: vault, locks, now: () => at });
              return adapter.normalizeWithDrops(await adapter.fetch({ lat: 0, lng: 0, radiusKm: 1 }), new Date(atMs));
            }))));
          const captured = retained.value;
          assert.equal(captured.value.meetings.length, MEETINGS_PER_BODY);
          const result = await promoteMeetingPartition(store, partition, {
            formatVersion: 1, generatedAt: at, counts: { fresh: MEETINGS_PER_BODY, carried: 0, total: MEETINGS_PER_BODY },
            sources: [{ source: "civicplus", ok: true, error: null, fetched: 1, normalized: MEETINGS_PER_BODY,
              drops: captured.value.drops, acquisitions: captured.evidence }],
            meetings: captured.value.meetings, agendaDocuments: [],
          }, [], [], retained.responses);
          assert.equal(result.outcome.candidate.state, "PROMOTED", JSON.stringify({ state: result.outcome.candidate.state, failure: result.outcome.candidate.failureCode, receipt: result.outcome.candidate.receipt }));
          promoted++;
          const reader = await readMeetingPartitionProjection(partition, { store, now: at, bypassCache: true });
          assert.equal(reader.kind, "PROMOTED");
          if (reader.kind !== "PROMOTED") throw new Error("Published meeting missing from reader");
          assert.equal(reader.value.meetings.length, MEETINGS_PER_BODY);
          const changed = reader.value.meetings.find(meeting => meeting.id.endsWith("-11"))!;
          assert.equal(changed.status, phase === 0 ? "SCHEDULED" : "CANCELED");
          assert.equal(changed.bodyId, wiring.bodyId);
          assert.equal(changed.provenance.collectedAt, at);
          visible++;
          maxPublicationWallMs = Math.max(maxPublicationWallMs, performance.now() - before);
          if (phase === 1) maxControlledDelayMs = Math.max(maxControlledDelayMs, atMs - (NOW + 60_000));
        } finally { pass.clear(); }
      }
    }
    const runtimeMs = performance.now() - started, peakRssBytes = process.resourceUsage().maxRSS * 1024;
    assert.equal(visible, promoted);
    assert.ok(maxControlledDelayMs + runtimeMs < 90 * 60_000, "The whole largest-state change phase must fit the posting-to-reader deadline");
    const result = { state, governments: units.length, bodies, hotBodies: cohort === "cold" ? 0 : bodies, promoted, visible, databaseBytesRead, databaseBytesWritten, databaseRequests,
      runtimeMs, maxPublicationWallMs, controlledPostingToCheckMs: maxControlledDelayMs, conservativePostingToReaderMs: maxControlledDelayMs + runtimeMs,
      peakRssBytes, copiesAtMargin: Math.floor((8 * 1024 ** 3 - 768 * 1024 ** 2) / peakRssBytes),
      measurements: "Actual CivicPlus acquisition/parser, PostgresRoutineDataStore candidate validation/promotion, retained response evidence, and body reader retrieval. PostgreSQL runs in a separate process with production migrations and atomic batches. Controlled posting/due times; measured CPU/IO wall time and serialized SQL/result bytes. Deployed HTTP page and Neon wire/storage bytes are not exercised." };
    process.send!({ result }, () => process.disconnect!());
  } catch (error) { process.disconnect!(); throw error; }

}
if (mode === "database") await database();
else if (mode === "worker" || mode === "publisher") await worker();
else await main();
