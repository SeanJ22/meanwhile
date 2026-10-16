import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
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
import { setTimeout as delay } from "node:timers/promises";
import { readStateReference } from "../lib/control-plane/expansion/state-references.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { installDoorHosts } from "../lib/civic-data/source-authority.ts";
import { MEETING_PARTITION_CONTRACTS, refreshMeetingPartitions } from "../lib/civic-data/meeting-partitions.ts";
import { ROUTINE_SOURCE_TASKS, readRoutineTaskClocks, routineAdmissionClock, routineTaskDueAtMs, routineTaskFromContract, sittingWindowSignals, type RoutineSourceTask } from "../lib/civic-data/runner.ts";
import { statedSittingEndsByScope, statedSittingEndsRead } from "../lib/civic-data/sitting-window-admission.ts";
import { OUTCOME_PARTITION_CONTRACTS } from "../lib/civic-data/outcome-partitions.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { routineScopeState } from "../lib/civic-data/state-scope.ts";
import { prefetchSourceRequests, runWithSourceFetch } from "../lib/sources/fetch-source.ts";
import { postgresSourceFetchStore, SOURCE_FETCH_DDL } from "../lib/sources/fetch-source-state.ts";
import { repairMeetingReaderProjectionReadbacks } from "../lib/civic-data/reader-verification.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import { installMeetingDoors, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { WEBSITE_PACING_DDL } from "../lib/control-plane/website-pacing.ts";
import { RUNTIME_AUTHORITY_ENV } from "../lib/civic-data/runtime-authority.ts";
import { runMeetingPartition } from "./ingest.ts";
import { MEETING_STATE_BUCKETS, MEETING_STATE_CONCURRENCY, meetingTaskBucket, runMeetingBatchPass } from "../lib/civic-data/meeting-batch.ts";
import { meetingPrefetchSeeds } from "../lib/civic-data/meeting-prefetch.ts";
import { MEETING_DOCUMENT_TURN_URLS } from "../lib/meetings/document-checks.ts";
import { readMeetingBodiesForPublication } from "../lib/civic-data/meeting-dependencies.ts";
import { durableRoutineRunnerReceiptIssue, parseMeetingPartitionRunnerReceipts } from "../lib/civic-data/runner-receipt.ts";
import { recordDoorOutcome, taskDoorIds } from "../lib/doors/outcome.ts";
import { reopenDoorIfShut } from "../lib/doors/ingest-evidence.ts";
import { runWithKnownReleaseCache } from "../lib/sources/known-release.ts";
import type { DoorRepository } from "../lib/doors/registry.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { installDoorRecords } from "../lib/doors/meeting-doors.ts";
import { refreshDoorsForPass } from "../lib/doors/install.ts";
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
interface Message { id?: number; ready?: boolean; flushStats?: boolean; resourceUsage?: boolean; session?: string; statements?: Statement[]; transaction?: boolean; results?: ResultRows[]; error?: string; result?: Record<string, number | string> }
const mode = arg("mode");
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
function launch(args: string[]) { return fork(fileURLToPath(import.meta.url), args, {
  execArgv: ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs"], stdio: ["ignore", "inherit", "inherit", "ipc"],
}); }
async function database() {
  const { Pool, types } = await import("pg");
  for (const oid of [1082, 1114, 1184]) types.setTypeParser(oid, value => value);
  const pool = new Pool({ connectionString: process.env.R4_SCALE_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:54329/r4", max: 48 });
  const initialized = await pool.query("SELECT to_regclass('civic_data_promotions') AS table_name");
  if (!initialized.rows[0]!.table_name) for (const name of ["0025_typical_fixer.sql", "0026_lame_sunset_bain.sql", "0027_pdc_candidate_history_shape.sql", "0028_wise_ikaris.sql", "0029_unchanged_confirmation_receipts.sql", "0031_civic_payload_parts.sql"]) {
    for (const sql of readFileSync(join("lib/db/migrations", name), "utf8").split("--> statement-breakpoint")) if (sql.trim()) await pool.query(sql);
  }
  for (const sql of [...SOURCE_FETCH_DDL, ...WEBSITE_PACING_DDL]) await pool.query(sql);
  for (const [table, names] of [["fact", ["0035_r1_fact_store.sql", "R4_source_copy_observations.sql", "R4_source_copy_blob_identity.sql"]],
    ["civic_meeting_dependencies", ["R4_meeting_dependencies.sql"]]] as const) {
    const result = await pool.query("SELECT to_regclass($1) AS table_name", [table]);
    if (!result.rows[0]!.table_name) for (const name of names) await pool.query(readFileSync(join("lib/db/migrations", name), "utf8"));
  }
  await pool.query("CREATE TABLE IF NOT EXISTS r4_scale_doors (body_id text PRIMARY KEY,value jsonb NOT NULL,revision integer NOT NULL DEFAULT 1)");
  await pool.query("CREATE INDEX IF NOT EXISTS r4_scale_doors_identity ON r4_scale_doors ((value->>'doorId'))");
  const sessions = new Map<string, import("pg").PoolClient>(), pending = new Set<Promise<void>>();
  process.on("message", (message: Message) => {
    if (!message.statements) return;
    const operation = (async () => {
      let owned: import("pg").PoolClient | undefined;
      const action = message.statements!.length === 1 ? message.statements![0]!.sql : "";
      try {
        if (message.resourceUsage) { process.send!({ id: message.id, results: [{ rows: [process.resourceUsage()] }] }); return; }
        if (message.flushStats) {
          assert.equal(sessions.size, 0);
          const clients = await Promise.all(Array.from({ length: pool.totalCount }, () => pool.connect()));
          try { await Promise.all(clients.map(async client => { await client.query("SELECT pg_stat_force_next_flush()"); await client.query("SELECT 1"); })); }
          finally { clients.forEach(client => client.release()); }
          process.send!({ id: message.id, results: [] }); return;
        }
        if (action === "BEGIN") {
          assert.ok(message.session); assert.ok(!sessions.has(message.session));
          sessions.set(message.session, await pool.connect());
        }
        const held = message.session ? sessions.get(message.session) : undefined;
        if (message.session) assert.ok(held, "Transaction session must retain its connection");
        if (message.transaction) { assert.ok(!held); owned = await pool.connect(); await owned.query("BEGIN"); }
        const client = held ?? owned ?? pool, results: ResultRows[] = [];
        for (const statement of message.statements!) {
          const result = await client.query({ text: statement.sql, values: statement.params, ...(statement.arrayMode ? { rowMode: "array" } : {}) });
          results.push({ rows: result.rows });
        }
        if (owned) await owned.query("COMMIT");
        process.send!({ id: message.id, results });
      } catch (error) {
        if (owned) await owned.query("ROLLBACK");
        console.error(`SCALE_DATABASE_FAILED: ${message.statements!.map(statement => statement.params.length).join(",")} parameters; ${error instanceof Error ? error.stack : String(error)}`);
        process.send!({ id: message.id, error: String(error) });
      } finally {
        owned?.release();
        if ((action === "COMMIT" || action === "ROLLBACK") && message.session) { sessions.get(message.session)?.release(); sessions.delete(message.session); }
      }
    })();
    pending.add(operation); void operation.finally(() => pending.delete(operation));
  });
  process.on("disconnect", () => { void Promise.allSettled([...pending]).then(async () => {
    for (const client of sessions.values()) { await client.query("ROLLBACK"); client.release(); }
    await pool.end();
  }); });
  process.send?.({ ready: true });
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
  return (statements: Statement[], transaction: boolean, session?: string, flushStats = false, resourceUsage = false): Promise<ResultRows[]> => new Promise((resolve, reject) => {
    const id = ++next; waiting.set(id, { resolve, reject });
    const message = { id, statements, transaction, session, flushStats, resourceUsage };
    if (child) child.send(message); else process.send!(message);
  });
}
async function main() {
  const root = arg("root") ?? mkdtempSync(join(tmpdir(), "r4-meeting-delivery-"));
  mkdirSync(root, { recursive: true });
  const publish = arg("publish") === "only", cohort = arg("cohort") ?? (publish ? "all" : "hot");
  const workers = publish ? 1 : Number(arg("workers") ?? 1), started = performance.now(), startedAt = new Date().toISOString();
  console.log(JSON.stringify({ persistentRoot: root, publish }));
  const database = launch(["--mode=database", `--root=${root}`]), request = clientFor(database);
  await new Promise<void>((resolve, reject) => {
    database.on("message", (message: Message) => { if (message.ready) resolve(); });
    database.on("exit", code => reject(new Error(`Database setup exited ${code}`)));
  });
  const state = arg("state") ?? "IL", doorSeedStarted = performance.now();
  const [doorCount] = await request([{ sql: "SELECT count(*)::integer AS count FROM r4_scale_doors WHERE value->>'scopeState'=$1", params: [`US-${state}`] }], false);
  const heldDoorCount = (doorCount!.rows[0] as { count: number }).count;
  let fixtureDoorSeedBytes = 0;
  if (heldDoorCount !== readStateReference(process.cwd(), state, { units: "state" }).units.length * 3) {
    const all = inventory(state, "all", Number.POSITIVE_INFINITY, 0), at = "2026-10-15T12:00:00.000Z";
    for (let offset = 0; offset < all.length; offset += 128) {
      const doors = all.slice(offset, offset + 128).flatMap(doorsFromWiringRow).map(draft => {
        const checked = checkDoorDraft(draft); if (!checked.ok) throw new Error(checked.why);
        return applyDerivedRow(null, checked.value, at, at)!;
      });
      const value = JSON.stringify(doors); fixtureDoorSeedBytes += Buffer.byteLength(value);
      await request([{ sql: `INSERT INTO r4_scale_doors(body_id,value)
        SELECT value->'bodyIds'->>0,value FROM jsonb_array_elements($1::jsonb) ON CONFLICT DO NOTHING`, params: [value] }], false);
    }
  }
  const fixtureDoorSeed = { runtimeMs: performance.now() - doorSeedStarted, existingRows: heldDoorCount, serializedInputBytes: fixtureDoorSeedBytes };
  const databaseIo = async () => {
    await request([], false, undefined, true);
    const [result] = await request([{ sql: `SELECT d.blks_read*8192 AS block_read_bytes,d.blks_hit*8192 AS cached_block_bytes,
      w.wal_bytes,pg_wal_lsn_diff(pg_current_wal_insert_lsn(),'0/0') AS wal_insert_bytes,
      coalesce(i.read_bytes,0) AS cluster_io_read_bytes,coalesce(i.write_bytes,0) AS cluster_io_write_bytes,
      coalesce(i.writeback_bytes,0) AS cluster_io_writeback_bytes FROM pg_stat_database d CROSS JOIN pg_stat_wal w
      CROSS JOIN (SELECT sum(reads*op_bytes) AS read_bytes,sum(writes*op_bytes) AS write_bytes,
        sum(writebacks*op_bytes) AS writeback_bytes FROM pg_stat_io) i WHERE d.datname=current_database()`, params: [] }], false);
    return Object.fromEntries(Object.entries(result!.rows[0] as Record<string, unknown>).map(([key, value]) => [key, Number(value)]));
  };
  const databaseIoBefore = await databaseIo();
  const activeWorkers = new Set<number>();
  let peakConcurrentWorkerRssBytes = 0;
  const sampleWorkers = setInterval(() => {
    const total = [...activeWorkers].reduce((sum, pid) => {
      try { return sum + Number(readFileSync(`/proc/${pid}/status`, "utf8").match(/^VmRSS:\s+(\d+) kB$/m)?.[1] ?? 0) * 1024; }
      catch { return sum; }
    }, 0);
    peakConcurrentWorkerRssBytes = Math.max(peakConcurrentWorkerRssBytes, total);
  }, 100);
  const results: Record<string, number | string>[] = [];
  try {
    assert.ok(Number.isInteger(workers) && workers > 0 && workers <= MEETING_STATE_CONCURRENCY);
    await Promise.all(Array.from({ length: workers }, (_, index) => new Promise<void>((resolve, reject) => {
      const child = launch([`--mode=${publish ? "publisher" : "worker"}`, `--worker=${index}`, `--workers=${workers}`, `--root=${root}`,
        `--state=${arg("state") ?? "IL"}`, `--cohort=${cohort}`,
        ...(arg("shift-minutes") ? [`--shift-minutes=${arg("shift-minutes")}`] : []),
        ...(arg("latency-ms") ? [`--latency-ms=${arg("latency-ms")}`] : []),
        ...(arg("title-suffix") ? [`--title-suffix=${arg("title-suffix")}`] : []),
        ...(arg("admission") ? ["--admission=only"] : []),
        ...(arg("offset") ? [`--offset=${arg("offset")}`] : []),
        ...(arg("verify") ? ["--verify=only"] : []), ...(arg("recheck") ? ["--recheck=true"] : []), ...(arg("limit") ? [`--limit=${arg("limit")}`] : [])]);
      activeWorkers.add(child.pid!); child.on("exit", () => activeWorkers.delete(child.pid!));
      child.on("message", (message: Message) => {
        if (message.result) results.push(message.result);
        if (message.statements) void request(message.statements, Boolean(message.transaction), message.session).then(
          rows => child.send({ id: message.id, results: rows }), error => child.send({ id: message.id, error: String(error) }));
      });
      child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Delivery worker ${index} exited ${code}`)));
    })));
    const allocation = (await request([{ sql: "SELECT pg_database_size(current_database())::bigint AS bytes", params: [] }], false))[0]!.rows[0] as { bytes: string };
    await delay(1100);
    const databaseIoAfter = await databaseIo();
    const databaseBridgeUsage = (await request([], false, undefined, false, true))[0]!.rows[0] as NodeJS.ResourceUsage;
    const databaseIoDelta = Object.fromEntries(Object.entries(databaseIoAfter).map(([key, value]) => [key, value - databaseIoBefore[key]!]));
    const total = (field: string) => results.reduce((sum, row) => sum + Number(row[field]), 0);
    const peak = Math.max(...results.map(row => Number(row.peakRssBytes)));
    const previousRuntime = (name: string) => publish && existsSync(join(root, name)) ? Number(JSON.parse(readFileSync(join(root, name), "utf8")).runtimeMs) : 0;
    const deliveryRuntimeMs = previousRuntime("batch-delivery.json"), coldSeedRuntimeMs = previousRuntime("cold-batch-delivery.json");
    const result = { databaseBackend: "native-postgresql", state: arg("state") ?? "IL", root, cohort, workers, startedAt, offset: Number(arg("offset") ?? 0), shiftMinutes: Number(arg("shift-minutes") ?? 10), titleSuffix: arg("title-suffix") ?? "", meetingsPerBody: MEETINGS_PER_BODY, responseBytes: RESPONSE_BYTES,
      databaseAllocatedBytes: Number(allocation.bytes), fixtureDoorSeed, databaseIoBefore, databaseIoAfter, databaseIoDelta,
      databaseIoDescription: "PostgreSQL block reads may hit the operating-system cache; cached block visits are not transferred bytes. Cluster I/O includes background flushes, while the WAL insert delta measures generated WAL. Every connection flushes its statistics at each boundary. SQL/result traffic is separate; fixture setup is included in database counters.",
      stateWorkers: workers, stateTurns: publish ? 0 : total("stateTurns"), bodies: total("bodies"), hotBodies: total("hotBodies"), promoted: total("promoted"), visible: total("visible"),
      runtimeMs: performance.now() - started, deliveryRuntimeMs, coldSeedRuntimeMs, peakCoordinatorRssBytes: process.resourceUsage().maxRSS * 1024, peakWorkerRssBytes: peak, peakConcurrentWorkerRssBytes, copiesAtMargin: Math.floor((8_326_938_624 - 768 * 1024 ** 2) / peak),
      coordinatorCpuUserMicroseconds: process.resourceUsage().userCPUTime, coordinatorCpuSystemMicroseconds: process.resourceUsage().systemCPUTime,
      databaseBridgeCpuUserMicroseconds: databaseBridgeUsage.userCPUTime, databaseBridgeCpuSystemMicroseconds: databaseBridgeUsage.systemCPUTime,
      databaseBytesRead: total("databaseBytesRead"), databaseBytesWritten: total("databaseBytesWritten"), databaseRequests: total("databaseRequests"),
      controlledPostingToCheckMs: Math.max(...results.map(row => Number(row.controlledPostingToCheckMs))),
      conservativePostingToReaderMs: Math.max(...results.map(row => Number(row.controlledPostingToCheckMs))) + deliveryRuntimeMs + performance.now() - started, results };
    assert.ok(result.conservativePostingToReaderMs < 90 * 60_000);
    writeFileSync(join(root, publish ? "publication.json" : arg("admission") ? "admission.json" : arg("verify") ? "reader-verification.json" : arg("recheck") ? "unchanged-batch-delivery.json" : cohort === "cold" ? "cold-batch-delivery.json" : "batch-delivery.json"), JSON.stringify(result));
    console.log(JSON.stringify(result));
  } finally {
    clearInterval(sampleWorkers);
    if (database.connected) database.disconnect();
    if (database.exitCode === null && database.signalCode === null) await new Promise<void>(resolve => database.on("exit", () => resolve()));
  }
}
function inventory(state: string, cohort: string, limit = Number(arg("limit") ?? Number.POSITIVE_INFINITY), offset = Number(arg("offset") ?? 0)): BodySourceWiring[] {
  return readStateReference(process.cwd(), state, { units: "state" }).units.flatMap((unit, index) =>
    cohort === "hot" && index % 4 !== 0 || cohort === "cold" && index % 4 === 0 ? [] : ["governing", "planning", "finance"].map((role): BodySourceWiring => {
      const division = `ocd-division/country:us/state:${state.toLowerCase()}/government:${unit.pid6}`;
      return { bodyId: `${division}#${role}`, ocdId: division, agendaSourceType: "CIVICPLUS", jurisdiction: unit.name,
        publishingOrg: unit.name, timeZone: "America/Chicago", verifiedAt: "2026-10-15T12:00:00.000Z",
        config: { slug: `${unit.pid6}-${role}`, bodyName: unit.name, icalUrl: `https://${state.toLowerCase()}-${unit.pid6}-${role}.example.gov/calendar.ics` } };
    })).slice(offset, offset + limit);
}
function calendarFor(wiring: BodySourceWiring, cold: boolean, changed: boolean, shiftMinutes = 0, titleSuffix = ""): string {
  const stamp = (time: number) => new Date(time).toISOString().replaceAll(/[-:]/g, "").replace(".000", "");
  const events = Array.from({ length: MEETINGS_PER_BODY }, (_, index) => {
    const originalStart = cold ? Date.parse("2026-10-15T12:00:00.000Z") + (14 + index * 3) * 86_400_000
      : Date.parse("2026-10-17T18:00:00.000Z") + (index - 11) * 7 * 86_400_000;
    const starts = originalStart + (index === 11 ? shiftMinutes * 60_000 : 0);
    return ["BEGIN:VEVENT", `UID:${wiring.config.slug}-${index}`, `SUMMARY:${changed && index === 11 ? `Canceled public hearing${titleSuffix ? ` ${titleSuffix}` : ""}` : "Public hearing"}`,
      `DTSTART:${stamp(starts)}`, `DTEND:${stamp(starts + 2 * 3_600_000)}`, "LOCATION:Virtual meeting", "END:VEVENT"].join("\r\n");
  });
  const parts = ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "X-PUBLISHER-PAGE:", "END:VCALENDAR"];
  parts[parts.length - 2] += "x".repeat(RESPONSE_BYTES - Buffer.byteLength(parts.join("\r\n")));
  return parts.join("\r\n");
}
async function worker() {
  Object.assign(process.env, { WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", DATABASE_URL: "postgresql://local:local@localhost/r4",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@localhost/r4", [RUNTIME_AUTHORITY_ENV.repo]: process.cwd(),
    [RUNTIME_AUTHORITY_ENV.sha]: "a".repeat(40), [RUNTIME_AUTHORITY_ENV.capability]: "ROUTINE_CONTRACT",
    [RUNTIME_AUTHORITY_ENV.parentPid]: String(process.ppid), [RUNTIME_AUTHORITY_ENV.nonce]: randomUUID().replaceAll("-", "").repeat(2) });
  const send = clientFor(), transactionSessions = new AsyncLocalStorage<string>();
  let databaseBytesRead = 0, databaseBytesWritten = 0, databaseRequests = 0;
  const request = async (statements: Statement[], transaction: boolean) => {
    databaseBytesWritten += size({ statements, transaction }); databaseRequests++;
    const result = await send(statements, transaction, transactionSessions.getStore()); databaseBytesRead += size(result); return result;
  };
  const query = (sql: string, params: unknown[], config: { arrayMode?: boolean } = {}) => {
    const statement = { sql, params, arrayMode: config.arrayMode };
    return { statement, then: <T, R>(resolve: (value: ResultRows) => T, reject: (error: unknown) => R) => request([statement], false).then(rows => rows[0]!).then(resolve, reject) };
  };
  const client = { query, transaction: (queries: { statement: Statement }[]) => request(queries.map(row => row.statement), true) };
  const db = drizzle(client as unknown as NeonQueryFunction<false, false>, { schema });
  const state = arg("state") ?? "IL", NOW = Date.parse("2026-10-15T12:00:00.000Z");
  const heldSizes = websiteSizeFromHoldings([state]);
  const websiteSize = (url: string) => heldSizes(url) ?? { kind: "local-government" as const, population: 9999, students: null };
  const units = readStateReference(process.cwd(), state, { units: "state" }).units;
  const cohort = arg("cohort") ?? "hot";
  const hotGovernmentIds = new Set(units.filter((_unit, index) => index % 4 === 0).map(unit => unit.pid6));
  const wirings = inventory(state, cohort).filter((wiring, index) => mode !== "worker" ||
    (arg("admission") ? meetingTaskBucket({ id: "", scope: wiring.bodyId }) : index % Number(arg("workers") ?? 1)) === Number(arg("worker") ?? 0));
  let retainedStandingTasks: readonly RoutineSourceTask[] = [];
  let metadataSetup: Record<string, number> | null = null;
  if (mode === "worker") {
    const setupStarted = performance.now(), setupCpuStarted = process.cpuUsage();
    const repo = new Proxy(createMemoryRepositories().doors, { get(target, key) {
      if (key === "listWhere") return async (path: string[], scope: string) => {
        assert.deepEqual(path, ["scopeState"]); assert.equal(scope, `US-${state}`);
        const rows = (await request([{ sql: "SELECT revision,value FROM r4_scale_doors WHERE value->>'scopeState'=$1", params: [scope] }], false))[0]!.rows as { revision: number; value: { doorId: string } }[];
        return rows.map(row => ({ id: row.value.doorId, revision: row.revision, updatedAt: new Date(NOW).toISOString(), value: row.value }));
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } }) as DoorRepository;
    const installed = await refreshDoorsForPass(repo, `US-${state}`);
    assert.equal(installed.partitions?.refreshed, true); assert.equal(installed.partitions?.skipped.length, 0);
    assert.equal(installed.rows, units.length * 3);
    retainedStandingTasks = [...ROUTINE_SOURCE_TASKS, ...OUTCOME_PARTITION_CONTRACTS.map(routineTaskFromContract), ...AUTOMATIC_REFRESH_TASKS]
      .filter(task => routineScopeState(task.scope, task.command) === `US-${state}`);
    metadataSetup = { runtimeMs: performance.now() - setupStarted, doors: installed.rows, tasks: retainedStandingTasks.length,
      cpuMicroseconds: Object.values(process.cpuUsage(setupCpuStarted)).reduce((a, b) => a + b, 0),
      databaseBytesRead, databaseBytesWritten, databaseRequests };
    databaseBytesRead = databaseBytesWritten = databaseRequests = 0;
  } else {
    installMeetingDoors(wirings);
    installDoorHosts(wirings.map(wiring => new URL(wiring.config.icalUrl!).hostname));
    const installed = refreshMeetingPartitions(wirings);
    assert.equal(installed.refreshed, true); assert.equal(installed.skipped.length, 0);
  }
  const partitions = new Map(MEETING_PARTITION_CONTRACTS.map(row => [row.bodyId, row]));
  const bucketStarted = performance.now(), bucketCpuStarted = process.cpuUsage();
  const bucketTasks = retainedStandingTasks.filter(task => task.recordClass === "MEETING" &&
    meetingTaskBucket(task) === Number(arg("worker") ?? 0) % MEETING_STATE_BUCKETS);
  const bucketStore = new PostgresRoutineDataStore(db, null);
  const bucketClockReads = await readRoutineTaskClocks(bucketTasks, tasks => bucketStore.clocks(tasks.map(task => ({
    sourceId: task.sourceId, recordClass: task.recordClass, scope: task.scope, parserVersion: task.parserVersion,
  }))));
  for (const read of bucketClockReads) assert.equal(read.ok, true, read.error ?? "Bucket clock read failed");
  const bucketEnds = bucketTasks.length ? statedSittingEndsByScope(await statedSittingEndsRead(db, bucketTasks.map(task => task.scope))) : new Map<string, Map<string, number>>();
  const endsById = new Map(bucketTasks.flatMap(task => bucketEnds.has(task.scope) ? [[task.id, bucketEnds.get(task.scope)!] as const] : []));
  const bucketSignals = sittingWindowSignals(bucketClockReads, Date.now(), endsById);
  const bucketAdmission = { runtimeMs: performance.now() - bucketStarted, bodies: bucketTasks.length,
    hotBodies: [...bucketSignals.values()].filter(Boolean).length,
    dueBodies: bucketClockReads.filter(read => routineTaskDueAtMs(read.task, read.clock, Date.now(), bucketSignals.get(read.task.id)) <= Date.now()).length,
    cpuMicroseconds: Object.values(process.cpuUsage(bucketCpuStarted)).reduce((a, b) => a + b, 0), databaseBytesRead, databaseBytesWritten, databaseRequests };
  databaseBytesRead = databaseBytesWritten = databaseRequests = 0;
  if (arg("admission")) {
    const result = { state, promoted: 0, visible: 0, stateTurns: 0,
      ...bucketAdmission, metadataSetup: JSON.stringify(metadataSetup), peakRssBytes: process.resourceUsage().maxRSS * 1024,
      controlledPostingToCheckMs: 0, measurements: "Actual full-state door/task installation, production bucket selection, bounded batched durable clocks and scoped sitting-window end reads; no source execution." };
    process.send!({ result }, () => process.disconnect!()); return;
  }
  const root = arg("root")!;
  if (mode === "publisher") {
    process.env[RUNTIME_AUTHORITY_ENV.capability] = "ROUTINE_SUPERVISOR";
    installDoorRecords(wirings.flatMap(doorsFromWiringRow).map(draft => {
      const checked = checkDoorDraft(draft);
      if (!checked.ok) throw new Error(checked.why);
      return applyDerivedRow(null, checked.value, new Date(NOW).toISOString(), new Date(NOW).toISOString())!;
    }), `state:US-${state}`);
    const postgres = new PostgresRoutineDataStore(db, null), registryVersion = "scale-registry";
    let identityMetadataBytes = 0;
    const store = new Proxy(postgres, { get(target, key) {
      if (key === "writePreparedReaderProjection") return async (...args: Parameters<typeof target.writePreparedReaderProjection>) => {
        const payload = args[0].payload as { formatVersion?: number; chunks?: readonly { meetingIds?: readonly string[]; documentIds?: readonly string[] }[];
          heldChunks?: readonly { meetingIds?: readonly string[]; documentIds?: readonly string[] }[] };
        if (payload.formatVersion === 2 && payload.chunks) identityMetadataBytes = [...payload.chunks, ...(payload.heldChunks ?? [])]
          .reduce((total, chunk) => total + size({ meetingIds: chunk.meetingIds, documentIds: chunk.documentIds }), 0);
        return target.writePreparedReaderProjection(...args);
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const publicationQuery = async (sql: string, params: readonly unknown[] = []) => (await request([{ sql, params: [...params] }], false))[0]!.rows as Record<string, unknown>[];
    installFactReader(publicationQuery);
    const seedStarted = performance.now(), seedAt = new Date(NOW).toISOString(), sourceId = "registry-reviewed-bindings", recordClass = "REGISTRY_RUNTIME_BINDING";
    const rootDivision = "ocd-division/country:us", stateDivision = `${rootDivision}/state:${state.toLowerCase()}`;
    const registry = { generatedAt: seedAt, bodies: wirings.map(wiring => ({ id: wiring.bodyId, ocdId: wiring.ocdId, name: wiring.jurisdiction })),
      divisions: [{ ocdId: rootDivision, parentOcdId: null }, { ocdId: stateDivision, parentOcdId: rootDivision },
        ...[...new Set(wirings.map(wiring => wiring.ocdId!))].map(ocdId => ({ ocdId, parentOcdId: stateDivision }))] };
    const candidate = { id: registryVersion, sourceId, recordClass, scope: REGISTRY_RUNTIME_SCOPE, identities: [],
      retrieval: { succeeded: true, retrievedAt: seedAt, rawHash: null }, normalization: { parserVersion: "r4-scale-fixture", normalizedHash: null },
      temporal: { sourceThrough: seedAt }, readModel: { registry } };
    const receipt = { contractVersion: 2, decision: "GOOD", candidateId: registryVersion, sourceId, recordClass, scope: REGISTRY_RUNTIME_SCOPE, validatedAt: seedAt };
    await request([{ sql: `INSERT INTO civic_data_candidates
      (id,source_id,record_class,scope,state,acquisition_succeeded,retrieved_at,source_through,parser_version,identity,candidate,validation_receipt,promoted_version_id,last_known_good_version_id)
      VALUES ($1,$2,$3,$4,'PROMOTED',true,($5::text)::timestamptz,$5::text,'r4-scale-fixture','[]'::jsonb,$6::jsonb,$7::jsonb,$1,$1) ON CONFLICT DO NOTHING`,
      params: [registryVersion, sourceId, recordClass, REGISTRY_RUNTIME_SCOPE, seedAt, JSON.stringify(candidate), JSON.stringify(receipt)] },
      ...["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED"].map((event, index) => ({
        sql: `INSERT INTO civic_data_candidate_events (candidate_id,sequence,state,at,detail)
          SELECT $1,$2,$3,$4,'Generated registry fixture' WHERE NOT EXISTS (SELECT 1 FROM civic_data_candidate_events WHERE candidate_id=$1 AND sequence=$2)`,
        params: [registryVersion, index + 1, event, seedAt],
      })),
      { sql: `INSERT INTO civic_data_promotions (key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,payload,validation_receipt)
      VALUES ($1,$2,$3,$4,$5,$5,$6,$7::jsonb,$8::jsonb) ON CONFLICT DO NOTHING`, params: [`${recordClass}:${REGISTRY_RUNTIME_SCOPE}`, sourceId,
        recordClass, REGISTRY_RUNTIME_SCOPE, registryVersion, seedAt, JSON.stringify({ registry }), JSON.stringify(receipt)] }], true);
    const seed = { runtimeMs: performance.now() - seedStarted, databaseBytesRead, databaseBytesWritten, databaseRequests };
    databaseBytesRead = databaseBytesWritten = databaseRequests = 0;
    const baseArtifacts = new LocalFileArtifactStore(join(root, "reader"));
    let artifactReads = 0, artifactBytesRead = 0, immutableWrites = 0, artifactBytesWritten = 0, locatorWrites = 0;
    const artifacts = new Proxy(baseArtifacts, { get(target, key) {
      if (key === "readBytes") return async (name: string) => { const value = await target.readBytes(name); artifactReads++; artifactBytesRead += value?.byteLength ?? 0; return value; };
      if (key === "readArtifact") return async (name: string) => { const value = await target.readArtifact(name); artifactReads++; artifactBytesRead += size(value); return value; };
      if (key === "readManifest") return async (scope?: string) => { const value = await target.readManifest(scope); artifactReads++; artifactBytesRead += size(value); return value; };
      if (key === "putImmutable") return async (bytes: Uint8Array, suffix: "json" | "json.gz") => { immutableWrites++; artifactBytesWritten += bytes.byteLength; return target.putImmutable(bytes, suffix); };
      if (key === "writeMeetingStates") return async (ids: readonly string[], scope: string) => { locatorWrites += ids.length; return target.writeMeetingStates(ids, scope); };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const priorBatch = existsSync(join(root, "batch-delivery.json")) ? JSON.parse(readFileSync(join(root, "batch-delivery.json"), "utf8")) as { startedAt?: string; offset?: number; shiftMinutes?: number; bodies?: number; titleSuffix?: string } : null;
    const latestBodies = new Set(inventory(state, "hot", Number.POSITIVE_INFINITY, priorBatch?.offset ?? 0).slice(0, priorBatch?.bodies).map(wiring => wiring.bodyId));
    const started = performance.now(), publicationCpuStarted = process.cpuUsage(), at = new Date(priorBatch ? Date.now() : NOW + 35 * 60_000).toISOString();
    const publication = await publishRoutineReaderEdgeOutcome(store, at, wirings.map(wiring => partitions.get(wiring.bodyId)!), {
      artifactStore: artifacts, state, readMeetingRegistry: async (_divisions, ids, versionId) => {
        assert.equal(versionId, registryVersion);
        const bodies = await readMeetingBodiesForPublication(ids, publicationQuery);
        assert.equal(bodies.length, ids.length);
        return { kind: "PROMOTED", metadata: { recordClass: "REGISTRY_RUNTIME_BINDING", scope: REGISTRY_RUNTIME_SCOPE, versionId },
          value: { registry: { divisions: [], bodies } } as unknown as RegistryRuntimeReadModel };
      },
    });
    const publicationRuntimeMs = performance.now() - started, publicationPeakRssBytes = process.resourceUsage().maxRSS * 1024;
    const publicationCpu = process.cpuUsage(publicationCpuStarted);
    if (!publication.ok) console.error(JSON.stringify({ publicationFailure: { publicationRuntimeMs, publicationPeakRssBytes,
      databaseBytesRead, databaseBytesWritten, databaseRequests } }));
    assert.equal(publication.ok, true, JSON.stringify(publication));
    const beforePlace = { calls: artifactReads, bytes: artifactBytesRead, time: performance.now() };
    const place = await readReaderEdgeMeetings({ store: artifacts, states: [state.toLowerCase()], ocdIds: [wirings[0]!.ocdId!], now: at,
      settings: meetingSettingsFromValues(), fallback: async () => { throw new Error("Place reader cannot fall back to the database"); } });
    const placeReader = { runtimeMs: performance.now() - beforePlace.time, artifactReads: artifactReads - beforePlace.calls, bytes: artifactBytesRead - beforePlace.bytes };
    assert.ok(placeReader.runtimeMs < 3000, "Cold place reader must be usable within three seconds");
    assert.equal(place.kind, "PROMOTED");
    if (place.kind === "PROMOTED") assert.equal(place.value.meetings.length, 3 * MEETINGS_PER_BODY);
    const beforeState = { calls: artifactReads, bytes: artifactBytesRead, time: performance.now() };
    const reader = await readReaderEdgeMeetings({ store: artifacts, states: [state.toLowerCase()], now: at,
      settings: meetingSettingsFromValues(), fallback: async () => { throw new Error("Edge reader cannot fall back to the database"); } });
    const stateReader = { runtimeMs: performance.now() - beforeState.time, artifactReads: artifactReads - beforeState.calls, bytes: artifactBytesRead - beforeState.bytes };
    assert.equal(reader.kind, "PROMOTED");
    if (reader.kind !== "PROMOTED") throw new Error("Published state missing");
    const canceled = reader.value.meetings.filter(meeting => meeting.status === "CANCELED");
    assert.equal(reader.value.meetings.length, wirings.length * MEETINGS_PER_BODY);
    const hotBodies = wirings.filter(wiring => hotGovernmentIds.has(wiring.config.slug!.split("-")[0]!)).length;
    assert.equal(canceled.length, hotBodies);
    assert.equal(new Set(canceled.map(meeting => meeting.bodyId)).size, hotBodies);
    for (const meeting of canceled) {
      if (!priorBatch || latestBodies.has(meeting.bodyId!)) assert.ok(Date.parse(meeting.provenance.collectedAt) >= Date.parse(priorBatch?.startedAt ?? new Date(NOW + 35 * 60_000).toISOString()));
      if (priorBatch) assert.equal(Date.parse(meeting.startsAt), Date.parse("2026-10-17T18:00:00.000Z") + (priorBatch.shiftMinutes ?? 10) * 60_000);
      if (priorBatch?.titleSuffix && latestBodies.has(meeting.bodyId!)) assert.ok(meeting.title.includes(priorBatch.titleSuffix));
    }
    const beforeExact = { calls: artifactReads, bytes: artifactBytesRead, time: performance.now() };
    const exact = await readReaderEdgeMeetings({ store: artifacts, meetingId: canceled[0]!.id, now: at,
      settings: meetingSettingsFromValues(), fallback: async () => { throw new Error("Exact reader cannot fall back to the database"); } });
    const exactReader = { runtimeMs: performance.now() - beforeExact.time, artifactReads: artifactReads - beforeExact.calls, bytes: artifactBytesRead - beforeExact.bytes };
    assert.equal(exact.kind, "PROMOTED");
    if (exact.kind === "PROMOTED") assert.equal(exact.value.meetings[0]!.status, "CANCELED");
    const result = { state, bodies: wirings.length, hotBodies, promoted: 0, visible: canceled.length, databaseBytesRead, databaseBytesWritten, databaseRequests,
      publicationRuntimeMs, publicationPeakRssBytes, publicationCpuUserMicroseconds: publicationCpu.user, publicationCpuSystemMicroseconds: publicationCpu.system,
      publicationSetupRuntimeMs: started, publicationSetupCpuMicroseconds: publicationCpuStarted.user + publicationCpuStarted.system,
      identityMetadataBytes, seed: JSON.stringify(seed), stateReader: JSON.stringify(stateReader), placeReader: JSON.stringify(placeReader), exactReader: JSON.stringify(exactReader), immutableWrites, artifactBytesWritten, locatorWrites,
      runtimeMs: performance.now() - started, peakRssBytes: process.resourceUsage().maxRSS * 1024,
      controlledPostingToCheckMs: 34 * 60_000, measurements: "Actual PostgreSQL composition and prepared projection, state artifact publication and scoped/exact-ID edge retrieval. Registry territory metadata uses version-joined production SQL over generated fixture rows; seed traffic is separate; fact overlay uses the actual fixture database. Database metrics are serialized SQL/results, not storage/WAL." };
    process.send!({ result }, () => process.disconnect!());
    return;
  }
  const vault = new DurableEvidenceStore(join(root, "vault"), { remote: null });
  const fetchStore = postgresSourceFetchStore(async (sql, params) => (await request([{ sql, params: [...params ?? []] }], false))[0]!.rows as Record<string, unknown>[]);
  const locks = createMemoryRepositories().locks;
  {
    const factQuery: Query = async (sql, params = []) => (await request([{ sql, params: [...params] }], false))[0]!.rows as Record<string, unknown>[];
    let factTransactions = 0;
    const facts: FactDb & { query: Query } = { query: factQuery, transaction: work => transactionSessions.run(randomUUID(), async () => {
      await factQuery("BEGIN"); factTransactions++;
      try { const result = await work(factQuery); await factQuery("COMMIT"); return result; }
      catch (error) { await factQuery("ROLLBACK"); throw error; }
    }) };
    installFactReader(factQuery);
    process.env[RUNTIME_AUTHORITY_ENV.capability] = "ROUTINE_SUPERVISOR";
    const taskAt = new Date().toISOString();
    const tasks = wirings.map(wiring => {
      const partition = partitions.get(wiring.bodyId)!;
      return { id: partition.id, dueAt: taskAt, calendarDueAt: taskAt,
        nextDueAt: new Date(Date.parse(taskAt) + 60 * 60_000).toISOString(),
        meetingSchedule: partition.schedule, documentRetryEveryMs: partition.retry.afterMs };
    });
    const selected = new Map(wirings.map(wiring => [partitions.get(wiring.bodyId)!.id, wiring]));
    const dependencyQuery = async (sql: string, params: readonly unknown[] = []) => (await request([{ sql, params: [...params] }], false))[0]!.rows as Record<string, unknown>[];
    const seedStarted = performance.now(), seedCpuStarted = process.cpuUsage();
    const rootDivision = "ocd-division/country:us", stateDivision = `${rootDivision}/state:${state.toLowerCase()}`;
    await dependencyQuery(`INSERT INTO civic_meeting_dependencies VALUES ('registry',$1,$1,$1,'scale-registry',$2::jsonb) ON CONFLICT DO NOTHING`,
      [REGISTRY_RUNTIME_SCOPE, JSON.stringify({ generatedAt: new Date(NOW).toISOString() })]);
    for (const [ocdId, parentOcdId] of [[rootDivision, null], [stateDivision, rootDivision]]) await dependencyQuery(
      `INSERT INTO civic_meeting_dependencies VALUES ('division',$1,$1,$1,'scale-registry',$2::jsonb) ON CONFLICT DO NOTHING`,
      [ocdId, JSON.stringify({ ocdId, parentOcdId })]);
    for (const task of tasks) {
      const wiring = selected.get(task.id)!;
      const drafts = doorsFromWiringRow(wiring);
      assert.equal(drafts.length, 1);
      const checked = checkDoorDraft(drafts[0]!); if (!checked.ok) throw new Error(checked.why);
      const value = applyDerivedRow(null, checked.value, new Date(NOW).toISOString(), new Date(NOW).toISOString())!;
      await request([{ sql: `INSERT INTO r4_scale_doors (body_id,value) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING`, params: [wiring.bodyId, JSON.stringify(value)] },
        { sql: `INSERT INTO civic_meeting_dependencies VALUES ('body',$1,$2,$3,'scale-registry',$4::jsonb) ON CONFLICT DO NOTHING`, params: [wiring.bodyId, `US-${state}`, REGISTRY_RUNTIME_SCOPE, JSON.stringify({ id: wiring.bodyId, ocdId: wiring.ocdId, name: wiring.jurisdiction })] },
        { sql: `INSERT INTO civic_meeting_dependencies VALUES ('division',$1,$1,$2,'scale-registry',$3::jsonb) ON CONFLICT DO NOTHING`, params: [wiring.ocdId, REGISTRY_RUNTIME_SCOPE, JSON.stringify({ ocdId: wiring.ocdId, parentOcdId: stateDivision })] }], true);
    }
    const seed = { runtimeMs: performance.now() - seedStarted, cpuMicroseconds: Object.values(process.cpuUsage(seedCpuStarted)).reduce((a, b) => a + b, 0), databaseBytesRead, databaseBytesWritten, databaseRequests };
    databaseBytesRead = databaseBytesWritten = databaseRequests = 0;
    const doors = new Proxy(createMemoryRepositories().doors, { get(target, key) {
      if (key === "read") return async (doorId: string) => {
        const [row] = await dependencyQuery("SELECT revision,value FROM r4_scale_doors WHERE value->>'doorId'=$1", [doorId]);
        return row ? { id: doorId, revision: row.revision, value: row.value, updatedAt: new Date(NOW).toISOString() } : null;
      };
      if (key === "compareAndSet") return async (doorId: string, revision: number, value: unknown, updatedAt: string) => {
        const rows = await dependencyQuery("UPDATE r4_scale_doors SET value=$3::jsonb,revision=revision+1 WHERE value->>'doorId'=$1 AND revision=$2 RETURNING revision", [doorId, revision, JSON.stringify(value)]);
        assert.equal(rows.length, 1);
        return { id: doorId, revision: rows[0]!.revision, value, updatedAt };
      };
      if (key === "listWhere") return async (path: string[], bodyId: string) => {
        assert.deepEqual(path, ["bodyIds", "0"]);
        const rows = await dependencyQuery("SELECT revision,value FROM r4_scale_doors WHERE body_id=$1", [bodyId]);
        return rows.map(row => ({ id: bodyId, revision: row.revision, updatedAt: new Date(NOW).toISOString(), value: row.value }));
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } }) as DoorRepository;
    let visible = 0, hotBodies = 0, promoted = 0, physicalRequests = 0, activeRequests = 0, peakActiveRequests = 0;
    const transportFor = (wiring: BodySourceWiring): typeof fetch => async (_url, init) => {
      physicalRequests++; activeRequests++; peakActiveRequests = Math.max(peakActiveRequests, activeRequests);
      try {
        if (arg("latency-ms")) await delay(Number(arg("latency-ms")), undefined, { signal: init?.signal ?? undefined });
        if (arg("recheck")) { assert.ok(new Headers(init?.headers).get("if-none-match")); return new Response(null, { status: 304 }); }
        const hot = hotGovernmentIds.has(wiring.config.slug!.split("-")[0]!);
        const calendar = calendarFor(wiring, !hot, hot, hot ? Number(arg("shift-minutes") ?? 10) : 0, arg("title-suffix"));
        return new Response(calendar, { headers: { "content-type": "text/calendar", etag: `"batch-${Date.now()}"` } });
      } finally { activeRequests--; }
    };
    const started = performance.now(), sourceCpuStarted = process.cpuUsage();
    let stateTurns = 0, bodyRuntimeMs = 0;
    const completed = new Set<string>();
    const memberStartedAt = new Map<string, string>();
    const admission = { runtimeMs: 0, databaseBytesRead: 0, databaseBytesWritten: 0, databaseRequests: 0 };
    const settlement = { ...admission };
    const readerVerification = { ...admission };
    const measure = async (into: typeof admission, run: () => Promise<void>) => {
      const before = { time: performance.now(), databaseBytesRead, databaseBytesWritten, databaseRequests };
      await run();
      into.runtimeMs += performance.now() - before.time; into.databaseBytesRead += databaseBytesRead - before.databaseBytesRead;
      into.databaseBytesWritten += databaseBytesWritten - before.databaseBytesWritten; into.databaseRequests += databaseRequests - before.databaseRequests;
    };
    const verify = async (ids: readonly string[]) => measure(readerVerification, async () => {
      const contracts = ids.map(id => partitions.get(selected.get(id)!.bodyId)!);
      const results = await repairMeetingReaderProjectionReadbacks(new PostgresRoutineDataStore(db, null), contracts,
        new Date().toISOString(), "a".repeat(40));
      for (const result of results) {
        assert.equal(result.ok, true, result.error ?? "Reader verification failed");
        assert.ok(result.value?.kind === "CURRENT" || result.value?.receipt?.status === "PASS", JSON.stringify(result));
      }
    });
    if (arg("verify")) {
      for (let offset = 0; offset < tasks.length; offset += 1000) {
        const ids = tasks.slice(offset, offset + 1000).map(task => task.id);
        await verify(ids); ids.forEach(id => completed.add(id));
      }
      visible = tasks.length;
    }
    while (completed.size < tasks.length) {
      stateTurns++;
      const turnResults = await runMeetingBatchPass(tasks.filter(task => !completed.has(task.id)), {
        prefetch: async (member, signal, acquire, phase) => {
          const partition = partitions.get(selected.get(member.id)!.bodyId)!;
          const store = new PostgresRoutineDataStore(db, null);
          const seeds = phase === "CALENDAR" ? await meetingPrefetchSeeds(store, partition) : [];
          const checks = phase === "DOCUMENT" ? await store.meetingCheckState(partition.sourceId, partition.scope) : undefined;
          const documents = checks?.meetingChecks?.documents.filter(check => Date.parse(check.nextDueAt) <= Date.now()).slice(0, MEETING_DOCUMENT_TURN_URLS);
          await runWithSourceFetch({ vault, state, sourceId: member.id,
            runtime: { store: fetchStore, transport: transportFor(selected.get(member.id)!), now: Date.now },
            websiteSize },
            () => prefetchSourceRequests({ sourceId: member.id, state, dueAt: member.dueAt, calendarDueAt: member.calendarDueAt,
              signal, acquire, seeds, phase, documents }));
        }, onMemberStarted: id => {
        memberStartedAt.set(id, new Date().toISOString());
      }, onSettled: async (task, result) => {
        if (result.errorMessage?.startsWith("PASS_TIME_BUDGET:")) return;
        assert.equal(result.status, 0, result.errorMessage ?? "State member failed");
        assert.equal(result.settlementErrorMessage ?? null, null);
        await measure(settlement, async () => {
          const partition = partitions.get(selected.get(task.id)!.bodyId)!, store = new PostgresRoutineDataStore(db, null);
          const parsed = parseMeetingPartitionRunnerReceipts(result.stdout);
          if (!parsed.ok) throw new Error(parsed.detail);
          assert.equal(parsed.receipts.length, 1);
          const receipt = parsed.receipts[0]!;
          assert.equal(await durableRoutineRunnerReceiptIssue(receipt, partition, store, "SUCCESS"), null);
          if (receipt.confirmedAt === undefined) promoted++;
          const checked = await store.clock(partition.sourceId, partition.recordClass, partition.scope);
          for (const doorId of await taskDoorIds(doors, task.id)) {
            const at = checked.lastSucceededObservedAt!;
            await recordDoorOutcome(doors, doorId, "SUCCESS", at, receipt.confirmedAt === undefined);
            assert.equal(await reopenDoorIfShut(doors, doorId, at), false);
          }
          const clock = await store.clock(partition.sourceId, partition.recordClass, partition.scope);
          const sourceTask = routineTaskFromContract(partition), now = Date.now();
          const admittedClock = routineAdmissionClock(clock, memberStartedAt.get(task.id), now);
          const hot = sittingWindowSignals([{ task: sourceTask, clock: admittedClock, ok: true }], now, endsById).get(task.id);
          const due = routineTaskDueAtMs(sourceTask, admittedClock, now, hot);
          await dependencyQuery("UPDATE cp_source_checks SET next_due_at=$2::timestamptz WHERE source_id=$1", [task.id, new Date(due).toISOString()]);
        });
        completed.add(task.id);
      } }, async (id, options) => {
      const wiring = selected.get(id)!, store = new PostgresRoutineDataStore(db, null);
      const hot = hotGovernmentIds.has(wiring.config.slug!.split("-")[0]!);
      if (hot) hotBodies++;
      const at = Date.now(), transport = transportFor(wiring);
      const bodyStarted = performance.now();
      await runWithKnownReleaseCache({ store: vault, locks, now: () => new Date(at).toISOString() }, () => runWithSourceFetch({ vault, state, sourceId: id,
        runtime: { store: fetchStore, transport, now: () => at }, websiteSize },
        () => runMeetingPartition(id, { ...options, doors, store, dependencyQuery, facts: { db: facts, vault } })));
      bodyRuntimeMs += performance.now() - bodyStarted;
      visible++;
      });
      for (const result of turnResults) assert.ok(!result.settlementErrorMessage, result.settlementErrorMessage ?? "State settlement failed");
      await verify(turnResults.filter(result => result.status === 0).map(result => result.id));
    }
    assert.equal(visible, tasks.length);
    assert.ok(retainedStandingTasks.length >= units.length * 3);
    assert.equal(bucketClockReads.length, bucketTasks.length);
    if (arg("recheck")) {
      const counts = await dependencyQuery("SELECT count(*)::integer AS count FROM cp_source_checks WHERE source_id=ANY($1::text[]) AND unchanged", [tasks.map(task => task.id)]);
      assert.equal(counts[0]!.count, tasks.length);
    }
    const factCounts = arg("verify") ? null : (await factQuery(`SELECT count(*) FILTER (WHERE f.status='live')::integer AS live,
        count(*) FILTER (WHERE f.status='live' AND f.field='starts_at')::integer AS starts
      FROM entity e JOIN fact f ON f.entity_id=e.id WHERE e.parent_id=ANY($1::text[])`, [wirings.map(wiring => wiring.bodyId)]))[0]!;
    if (factCounts) { assert.equal(factCounts.live, tasks.length * MEETINGS_PER_BODY * 2); assert.equal(factCounts.starts, tasks.length * MEETINGS_PER_BODY); }
    const sourceCpu = process.cpuUsage(sourceCpuStarted);
    const result = { state, bodies: tasks.length, stateTurns, hotBodies, promoted, visible, unchanged: arg("recheck") ? visible : 0, databaseBytesRead, databaseBytesWritten, databaseRequests,
      runtimeMs: performance.now() - started, peakRssBytes: process.resourceUsage().maxRSS * 1024, cpuUserMicroseconds: process.resourceUsage().userCPUTime, cpuSystemMicroseconds: process.resourceUsage().systemCPUTime, controlledPostingToCheckMs: cohort === "cold" ? 0 : 34 * 60_000,
      sourceCpuUserMicroseconds: sourceCpu.user, sourceCpuSystemMicroseconds: sourceCpu.system, bodyRuntimeMs,
      metadataSetup: JSON.stringify(metadataSetup), bucketAdmission: JSON.stringify({ ...bucketAdmission, scopes: bucketEnds.size }), seed: JSON.stringify(seed), settlement: JSON.stringify(settlement), readerVerification: JSON.stringify(readerVerification), factTransactions, physicalRequests, peakActiveRequests, latencyMs: Number(arg("latency-ms") ?? 0), factCounts: JSON.stringify(factCounts),
      measurements: "Actual full-state metadata and batched bucket admission, in-process state turns and runMeetingPartition; durable receipt verification, door outcomes and next-due settlement. Indexed fixture doors; actual dependency SQL, parser, reconciliation and PostgreSQL publication. Canonical fact mirroring and scoped reader verification share this process. Member execution is forced after measured admission. Serialized SQL/result bytes; fixture seeding and admission reported separately." };
    process.send!({ result }, () => process.disconnect!());
    return;
  }

}
if (mode === "database") await database();
else if (mode === "worker" || mode === "publisher") await worker();
else await main();
