import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const BODY_ROLES = ["governing", "planning", "finance"];
const MEETINGS_PER_BODY = 24;
const BATCH = 32;
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = arg("mode");
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
interface Query { sql: string; params: unknown[] }
interface Message { id: number; query?: Query; value?: unknown; error?: string; result?: Result }
interface Result {
  state: string; governments: number; bodies: number; meetings: number; hot: number; due: number;
  databaseBytesRead: number; databaseBytesWritten: number; queries: number; largestResultBytes: number;
  runtimeMs: number; peakRssBytes: number; copiesAtMargin: number; plan?: unknown;
  fetch?: { checks: number; unchanged: number; downloadedBytes: number; vaultBytesOffered: number; runtimeMs: number;
    databaseBytesRead: number; databaseBytesWritten: number; hours: number; concurrency: number; maxRequestsPerPublisherHour: number; sampleBytes: number;
    cycles: { elapsedMinutes: number; checks: number; unchanged: number; databaseBytesRead: number; databaseBytesWritten: number; runtimeMs: number }[];
    projectedDay?: { checks: number; hotChecksPerBody: number; coldChecksPerBody: number; unchanged: number; databaseBytesRead: number; databaseBytesWritten: number } };
}

function launch(args: string[]): ChildProcess {
  return fork(fileURLToPath(import.meta.url), args, {
    execArgv: ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs"],
    stdio: ["ignore", "inherit", "inherit", "ipc"], serialization: "json",
  });
}

function queryClient(child: ChildProcess) {
  let next = 0;
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  child.on("message", (message: Message) => {
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.value);
  });
  child.on("exit", code => {
    for (const pending of waiting.values()) pending.reject(new Error(`Database exited: ${code}`));
    waiting.clear();
  });
  return (query: Query): Promise<unknown> => new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject }); child.send({ id, query });
  });
}

async function database() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { SOURCE_FETCH_DDL } = await import("../lib/sources/fetch-source-state.ts");
  const { WEBSITE_PACING_DDL } = await import("../lib/control-plane/website-pacing.ts");
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE civic_data_promotions (
    key text PRIMARY KEY, record_class text NOT NULL, scope text NOT NULL, payload jsonb NOT NULL);
    CREATE UNIQUE INDEX civic_data_promotions_record_scope_idx ON civic_data_promotions (record_class, scope);`);
  for (const statement of [...SOURCE_FETCH_DDL, ...WEBSITE_PACING_DDL]) await pg.exec(statement);
  let pending = Promise.resolve();
  process.on("message", (message: Message) => {
    if (!message.query) return;
    pending = pending.then(async () => {
      try {
        const result = await pg.query(message.query!.sql, message.query!.params);
        process.send!({ id: message.id, value: result.rows });
      } catch (error) { process.send!({ id: message.id, error: String(error) }); }
    });
  });
  process.on("disconnect", () => { void pending.then(() => pg.close()); });
}

async function stateBodies(state: string) {
  const { readStateReference } = await import("../lib/control-plane/expansion/state-references.ts");
  const { meetingPartitionScope } = await import("../lib/civic-data/meeting-partitions.ts");
  const units = readStateReference(process.cwd(), state, { units: "state" }).units;
  return units.flatMap((unit, index) => BODY_ROLES.map(role => {
    const bodyId = `ocd-division/country:us/state:${state.toLowerCase()}/government:${unit.pid6}#${role}`;
    return { bodyId, scope: meetingPartitionScope("civicplus", bodyId), name: unit.name, hot: index % 4 === 0 };
  }));
}

async function worker() {
  const state = arg("state")!;
  const started = performance.now();
  const { drizzle } = await import("drizzle-orm/neon-http");
  const { meetingRoutePartition, refreshMeetingPartitions } = await import("../lib/civic-data/meeting-partitions.ts");
  const { routineTaskFromContract, routineTaskDue, routineTaskDueAtMs, sittingWindowSignals } = await import("../lib/civic-data/runner.ts");
  const { statedSittingEndsRead, statedSittingEndsByScope } = await import("../lib/civic-data/sitting-window-admission.ts");
  const bodies = await stateBodies(state);
  const installed = refreshMeetingPartitions(bodies.map((body, index) => ({
    bodyId: body.bodyId, ocdId: null, agendaSourceType: "CIVICPLUS", jurisdiction: body.name, publishingOrg: body.name,
    timeZone: "America/Chicago", verifiedAt: new Date(NOW).toISOString(), config: { agendaCenterUrl: `https://${state.toLowerCase()}-${index}.example.gov/AgendaCenter` },
  })));
  assert.equal(installed.refreshed, true, installed.reason ?? "Body registration failed");
  assert.equal(installed.skipped.length, 0);
  let next = 0, read = 0, written = 0, queries = 0, largestResult = 0;
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  process.on("message", (message: Message) => {
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else { const size = bytes(message.value); read += size; largestResult = Math.max(largestResult, size); pending.resolve(message.value); }
  });
  const query = (value: Query): Promise<unknown> => new Promise((resolve, reject) => {
    written += bytes(value); queries++;
    const id = ++next; waiting.set(id, { resolve, reject }); process.send!({ id, query: value });
  });
  let hot = 0, due = 0, plan: unknown;
  const db = drizzle.mock();
  for (let offset = 0; offset < bodies.length; offset += BATCH) {
    const batch = bodies.slice(offset, offset + BATCH);
    const statement = statedSittingEndsRead(db, batch.map(body => body.scope)).toSQL();
    const raw = await query({ sql: statement.sql, params: statement.params }) as Record<string, unknown>[];
    const rows = raw.map(row => ({ scope: String(Object.values(row)[0]), pairs: Object.values(row)[1] }));
    assert.equal(rows.length, batch.length, "Admission must read exactly the selected bodies");
    const byScope = statedSittingEndsByScope(rows);
    for (const body of batch) {
      const ends = byScope.get(body.scope)!;
      assert.equal(ends.size, MEETINGS_PER_BODY);
      const task = routineTaskFromContract(meetingRoutePartition("civicplus", body.bodyId, {
        wiring: null, ocdId: null, acquisitionFailureDomain: `meeting-upstream:${state.toLowerCase()}-${offset}.example.gov`,
      }));
      const checked = new Date(NOW - 60 * 60_000).toISOString();
      const clock = { lastAttemptedAt: checked, lastSucceededAt: checked, lastSucceededObservedAt: checked, sittingStarts: [...ends.keys()] };
      const signal = sittingWindowSignals([{ task, ok: true, clock }], NOW, new Map([[task.id, ends]])).get(task.id);
      assert.equal(signal, body.hot, "Each body's meetings alone determine its hot flag");
      const owed = routineTaskDue(task, clock, NOW, signal);
      assert.equal(owed, body.hot, "A hot neighbor cannot bring a cold calendar into the hourly pass");
      if (signal) hot++;
      if (owed) due++;
    }
    if (arg("explain") === "true" && offset === 0) {
      plan = await query({ sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`, params: statement.params });
    }
  }
  let fetched: Result["fetch"], executionPeakRssBytes: number | undefined;
  if (arg("fetch") === "true") {
    const { fetchSource, runWithSourceFetch, SourceFetchDeferred } = await import("../lib/sources/fetch-source.ts");
    const { postgresSourceFetchStore } = await import("../lib/sources/fetch-source-state.ts");
    const { DurableEvidenceStore } = await import("../lib/control-plane/evidence/durable-store.ts");
    const { meetingFetchPass } = await import("../lib/meetings/shared-fetch.ts");
    const { runBoundedWorkPool } = await import("../lib/ops/bounded-work-pool.ts");
    const sample = readFileSync(arg("sample") ?? "tests/fixtures/civicplus/alameda-agendacenter.html");
    const directory = mkdtempSync(join(tmpdir(), "r4-fetch-vault-"));
    const backing = new DurableEvidenceStore(directory, { remote: null });
    let vaultBytesOffered = 0, checks = 0, unchanged = 0, downloadedBytes = 0;
    const vault = {
      put: async (...args: Parameters<typeof backing.put>) => { vaultBytesOffered += args[1].byteLength; await backing.put(...args); },
      get: backing.get.bind(backing), head: backing.head.bind(backing), list: backing.list.bind(backing),
    };
    const store = postgresSourceFetchStore(async (sql, params) => await query({ sql, params: [...params] }) as Record<string, unknown>[]);
    const hours = Number(arg("hours") ?? 1), beforeRead = read, beforeWritten = written, before = performance.now();
    const sampled = arg("sample-cycles") === "true" ? [0, 35, 70, 600] : null;
    const concurrency = 8, nextDue = new Float64Array(bodies.length).fill(NOW);
    const cycles: NonNullable<Result["fetch"]>["cycles"] = [];
    try {
      for (let now = NOW, cycle = 0; bodies.length > 0 && (sampled ? cycle < sampled.length : now < NOW + hours * 3_600_000); cycle++) {
        if (sampled) now = NOW + sampled[cycle]! * 60_000;
        const cycleRead = read, cycleWritten = written, cycleChecks = checks, cycleUnchanged = unchanged, cycleStarted = performance.now();
        const outcomes = await runBoundedWorkPool(bodies, concurrency, async (body, index) => {
          if (nextDue[index]! > now) return;
          const pass = meetingFetchPass();
          const url = `https://${state.toLowerCase()}-${Math.floor(index / BODY_ROLES.length)}.example.gov/AgendaCenter?body=${index % BODY_ROLES.length}`;
          const tag = `"r4-${sampled ? Number(cycle >= 2) : Math.floor((now - NOW) / (6 * 3_600_000))}"`;
          const transport: typeof fetch = async (_input, init) => {
            const headers = new Headers(init?.headers);
            assert.match(headers.get("user-agent") ?? "", /meanwhile|we-the-people/i);
            checks++;
            if (headers.get("if-none-match") === tag) {
              unchanged++;
              return new Response(null, { status: 304, headers: { etag: tag } });
            }
            downloadedBytes += sample.byteLength;
            return new Response(sample, { headers: { "content-type": "text/html", etag: tag, "last-modified": new Date(NOW).toUTCString() } });
          };
          try {
            await runWithSourceFetch({ vault, sourceId: body.bodyId, state, websiteSize: { kind: "local-government", population: 9999, students: null },
              dueAt: new Date(now).toISOString(), nextDueAt: new Date(now + (body.hot ? 1 : 12) * 3_600_000).toISOString(), runtime: { store, now: () => now, transport } }, async () => {
              const first = await pass(url); assert.equal((await first.arrayBuffer()).byteLength, sample.byteLength);
              const repeated = await pass(url); assert.equal((await repeated.arrayBuffer()).byteLength, sample.byteLength);
            });
          } finally { pass.clear(); }
          const checked = new Date(now).toISOString();
          const task = routineTaskFromContract(meetingRoutePartition("civicplus", body.bodyId, { wiring: null, ocdId: null, acquisitionFailureDomain: url }));
          nextDue[index] = routineTaskDueAtMs(task, { lastAttemptedAt: checked, lastSucceededObservedAt: checked, sittingStarts: [] }, now, body.hot);
          assert.ok(nextDue[index]! > now);
        });
        const failure = outcomes.find(row => !row.ok);
        assert.ok(!failure, failure?.error ?? "Fetch failed");
        cycles.push({ elapsedMinutes: (now - NOW) / 60_000, checks: checks - cycleChecks, unchanged: unchanged - cycleUnchanged,
          databaseBytesRead: read - cycleRead, databaseBytesWritten: written - cycleWritten, runtimeMs: performance.now() - cycleStarted });
        now = nextDue.reduce((next, value) => Math.min(next, value), Number.POSITIVE_INFINITY);
      }
      let capped = 0;
      await runWithSourceFetch({ vault, state, websiteSize: { kind: "local-government", population: 9999, students: null }, runtime: {
        store, now: () => NOW, transport: async () => { capped++; return new Response("small publisher"); },
      } }, async () => {
        for (let request = 0; request < 10; request++) await (await fetchSource(`https://${state.toLowerCase()}-cap.example.gov/${request}`)).text();
        await assert.rejects(fetchSource(`https://${state.toLowerCase()}-cap.example.gov/overflow`), SourceFetchDeferred);
      });
      assert.equal(capped, 10);
      let projectedDay: NonNullable<Result["fetch"]>["projectedDay"];
      if (sampled) {
        const count = (inside: boolean) => {
          const task = routineTaskFromContract(meetingRoutePartition("civicplus", bodies.find(body => body.hot === inside)!.bodyId,
            { wiring: null, ocdId: null, acquisitionFailureDomain: "https://clock.example.gov" }));
          let checks = 0;
          for (let at = NOW; at < NOW + 24 * 3_600_000;) {
            checks++;
            const checked = new Date(at).toISOString();
            at = routineTaskDueAtMs(task, { lastAttemptedAt: checked, lastSucceededObservedAt: checked, sittingStarts: [] }, at, inside);
          }
          return checks;
        };
        const hotChecksPerBody = count(true), coldChecksPerBody = count(false);
        const [initial, warm, changed, coldMixed] = cycles;
        const projected = (field: "databaseBytesRead" | "databaseBytesWritten") => initial![field] +
          (hotChecksPerBody - 4) * warm![field] + 3 * changed![field] + (coldChecksPerBody - 1) * (coldMixed![field] - warm![field]);
        projectedDay = { checks: hot * hotChecksPerBody + (bodies.length - hot) * coldChecksPerBody,
          hotChecksPerBody, coldChecksPerBody, unchanged: hot * (hotChecksPerBody - 4),
          databaseBytesRead: projected("databaseBytesRead"), databaseBytesWritten: projected("databaseBytesWritten") };
      }
      fetched = { checks, unchanged, downloadedBytes, vaultBytesOffered, runtimeMs: performance.now() - before,
        databaseBytesRead: read - beforeRead, databaseBytesWritten: written - beforeWritten, hours, concurrency, maxRequestsPerPublisherHour: capped, sampleBytes: sample.byteLength, cycles, ...(projectedDay ? { projectedDay } : {}) };
    } finally {
      executionPeakRssBytes = process.resourceUsage().maxRSS * 1024;
      const cleanup = launch(["--mode=cleanup", `--directory=${directory}`]);
      await new Promise<void>((resolve, reject) => cleanup.on("exit", code => code === 0 ? resolve() : reject(new Error(`Cleanup exited ${code}`))));
    }
  }
  const peakRssBytes = executionPeakRssBytes ?? process.resourceUsage().maxRSS * 1024;
  const result: Result = {
    state, governments: bodies.length / BODY_ROLES.length, bodies: bodies.length, meetings: bodies.length * MEETINGS_PER_BODY,
    hot, due, databaseBytesRead: read, databaseBytesWritten: written, queries, largestResultBytes: largestResult,
    runtimeMs: performance.now() - started, peakRssBytes, copiesAtMargin: Math.floor((8 * 1024 ** 3 - 768 * 1024 ** 2) / peakRssBytes),
    ...(plan ? { plan } : {}), ...(fetched ? { fetch: fetched } : {}),
  };
  process.send!({ result }, () => process.disconnect!());
}

async function main() {
  const started = performance.now();
  const states = readdirSync("data/derived/place-reference").filter(name => /^[a-z]{2}\.json$/.test(name)).map(name => {
    const index = JSON.parse(readFileSync(join("data/derived/place-reference", name), "utf8")) as { state: string; units: unknown[] };
    return { state: index.state, governments: index.units.length };
  }).sort((a, b) => b.governments - a.governments);
  const selected = arg("states")?.split(",");
  const inputs = selected ? states.filter(row => selected.includes(row.state)) : states;
  assert.ok(inputs.length);
  const db = launch(["--mode=database"]);
  const query = queryClient(db);
  const run = (state: string, explain = false, fetch = false): Promise<Result> => new Promise((resolve, reject) => {
    const child = launch(["--mode=worker", `--state=${state}`, `--explain=${explain}`, `--fetch=${fetch}`,
      `--hours=${state === inputs[0]!.state ? arg("hours") ?? 1 : 0.001}`, `--sample-cycles=${state === inputs[0]!.state && arg("sample-cycles") !== "false"}`,
      ...(arg("sample") ? [`--sample=${arg("sample")}`] : [])]);
    let result: Result | undefined;
    child.on("message", (message: Message) => {
      if (message.result) result = message.result;
      if (message.query) void query(message.query).then(value => child.send({ id: message.id, value }), error => child.send({ id: message.id, error: String(error) }));
    });
    child.on("error", reject);
    child.on("exit", code => { if (code !== 0 || !result) reject(new Error(`Worker ${state} exited: ${code}`)); else resolve(result); });
  });
  const seed = async (state: string) => {
    const bodies = await stateBodies(state);
    for (let offset = 0; offset < bodies.length; offset += 256) {
      const rows = bodies.slice(offset, offset + 256);
      await query({ sql: `INSERT INTO civic_data_promotions (key, record_class, scope, payload)
        SELECT 'MEETING:' || (entry->>'scope'), 'MEETING', entry->>'scope', jsonb_build_object(
          'bodyId', entry->>'bodyId', 'meetings', (
            SELECT jsonb_agg(jsonb_build_object('id', (entry->>'bodyId') || ':' || n,
              'title', (entry->>'name') || ' public meeting',
              'startsAt', to_char(to_timestamp($2::double precision / 1000) +
                ((CASE WHEN n = 0 AND (entry->>'hot')::boolean THEN 1 ELSE 30 + n * 14 END) || ' days')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'endsAt', to_char(to_timestamp($2::double precision / 1000) +
                ((CASE WHEN n = 0 AND (entry->>'hot')::boolean THEN 1 ELSE 30 + n * 14 END) || ' days')::interval + interval '2 hours', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'agenda', repeat('Published agenda item. ', 20))) FROM generate_series(0, $3::int - 1) n))
        FROM jsonb_array_elements($1::jsonb) entry`, params: [JSON.stringify(rows), NOW, MEETINGS_PER_BODY] });
    }
    console.log(JSON.stringify({ seeded: state, governments: bodies.length / BODY_ROLES.length, bodies: bodies.length }));
  };
  try {
    await seed(inputs[0]!.state);
    await query({ sql: "ANALYZE civic_data_promotions", params: [] });
    const baseline = await run(inputs[0]!.state);
    console.log(JSON.stringify({ baseline }));
    for (const input of inputs.slice(1)) await seed(input.state);
    await query({ sql: "ANALYZE civic_data_promotions", params: [] });
    const results: Result[] = [];
    for (const input of inputs) {
      const result = await run(input.state, false, arg("fetch") !== "none");
      results.push(result); console.log(JSON.stringify({ worker: result }));
    }
    assert.equal(results[0]!.databaseBytesRead - (results[0]!.fetch?.databaseBytesRead ?? 0), baseline.databaseBytesRead, "Other states cannot increase one state's admission payload");
    assert.equal(results[0]!.databaseBytesWritten - (results[0]!.fetch?.databaseBytesWritten ?? 0), baseline.databaseBytesWritten, "Other states cannot increase one state's admission queries");
    const explained = await run(inputs[0]!.state, true);
    console.log(JSON.stringify({ indexedAdmission: explained }));
    const aggregate = {
      states: inputs.length, governments: results.reduce((sum, row) => sum + row.governments, 0), bodies: results.reduce((sum, row) => sum + row.bodies, 0),
      meetings: results.reduce((sum, row) => sum + row.meetings, 0), hot: results.reduce((sum, row) => sum + row.hot, 0),
      databaseBytesReadPerNationalAdmission: results.reduce((sum, row) => sum + row.databaseBytesRead - (row.fetch?.databaseBytesRead ?? 0), 0),
      databaseBytesWrittenPerNationalAdmission: results.reduce((sum, row) => sum + row.databaseBytesWritten - (row.fetch?.databaseBytesWritten ?? 0), 0),
      databaseBytesReadForFetches: results.reduce((sum, row) => sum + (row.fetch?.databaseBytesRead ?? 0), 0),
      databaseBytesWrittenForFetches: results.reduce((sum, row) => sum + (row.fetch?.databaseBytesWritten ?? 0), 0),
      workerRuntimeMs: results.reduce((sum, row) => sum + row.runtimeMs, 0), totalRuntimeMs: performance.now() - started,
      peakWorkerRssBytes: Math.max(...results.map(row => row.peakRssBytes)), largest: results[0],
      baselinePeakRssBytes: baseline.peakRssBytes,
      measurements: "Actual generated-input execution; database bytes are serialized SQL/parameters and result JSON, excluding database storage, WAL, protocol, TLS, and publisher transport. Three generated bodies per held Census unit; no production claims about those bodies.",
    };
    console.log(JSON.stringify({ aggregate }));
  } finally { if (db.connected) db.disconnect(); }
}

if (mode === "cleanup") await rm(arg("directory")!, { recursive: true, force: true });
else if (mode === "database") await database();
else if (mode === "worker") await worker();
else await main();
