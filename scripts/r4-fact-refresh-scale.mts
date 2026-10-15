import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const NOW = "2026-10-15T12:00:00.000Z", OLD = "2026-09-01T12:00:00.000Z";
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
interface Statement { text: string; params: unknown[] }
interface Message { id: number; statement?: Statement; value?: unknown; error?: string; result?: Record<string, unknown> }

function launch(mode: string, extra: string[] = []) {
  return fork(fileURLToPath(import.meta.url), [`--mode=${mode}`, ...extra], {
    execArgv: ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs"],
    stdio: ["ignore", "inherit", "inherit", "ipc"], serialization: "json",
  });
}

function client(endpoint: Pick<ChildProcess, "on" | "send">) {
  let next = 0;
  const waiting = new Map<number, { resolve(value: Record<string, unknown>[]): void; reject(error: Error): void }>();
  endpoint.on("message", (message: Message) => {
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.value as Record<string, unknown>[]);
  });
  return (text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject }); endpoint.send({ id, statement: { text, params } });
  });
}

async function database() {
  const { factDb } = await import("../tests/helpers/fact-db.ts");
  const db = await factDb();
  let pending = Promise.resolve();
  process.on("message", (message: Message) => {
    if (!message.statement) return;
    pending = pending.then(async () => {
      try { process.send!({ id: message.id, value: await db.query(message.statement!.text, message.statement!.params) }); }
      catch (error) { process.send!({ id: message.id, error: String(error) }); }
    });
  });
  process.on("disconnect", () => { void pending.then(() => db.pg.close()); });
}

async function worker() {
  const { refreshStaleFacts } = await import("../lib/facts/refresh.ts");
  const { factClocks } = await import("../lib/facts/clocks.ts");
  const { MemoryEvidenceStore } = await import("../lib/control-plane/evidence/store.ts");
  const { createMemoryRepositories } = await import("../lib/control-plane/repository/memory.ts");
  const { factsVersion } = await import("../lib/facts/db.ts");
  const { readFactCommentAccess } = await import("../lib/facts/comment-read.ts");
  const { withMeetingFacts } = await import("../lib/facts/meeting-read.ts");
  type Meeting = import("../lib/sources/types.ts").Meeting;
  const remote = client(process as unknown as ChildProcess), statements: Statement[] = [];
  let read = 0, written = 0, largestResult = 0, requests = 0, queries = 0;
  const query = async (text: string, params: readonly unknown[] = []) => {
    const statement = { text, params: [...params] };
    written += size(statement); queries++;
    const rows = await remote(text, [...params]);
    const bytes = size(rows); read += bytes; largestResult = Math.max(largestResult, bytes);
    if (/^WITH (?:due|candidates)/.test(text) || (text.startsWith("WITH RECURSIVE") && !statements.some(row => row.text === text)) ||
      (/FROM entity [eb] CROSS JOIN LATERAL/.test(text) && !text.startsWith("WITH"))) statements.push(statement);
    return rows;
  };
  const facts = { query, transaction: async <T,>(work: (read: typeof query) => Promise<T>) => {
    await query("BEGIN");
    try { const value = await work(query); await query("COMMIT"); return value; }
    catch (error) { await query("ROLLBACK"); throw error; }
  } };
  const started = performance.now();
  const result = await refreshStaleFacts({ facts, repos: createMemoryRepositories(), vault: new MemoryEvidenceStore(),
    state: arg("state")!, clocks: factClocks(null), now: NOW, limit: 100,
    fetchImpl: async () => { requests++; return new Response("Council meeting YES"); } });
  const runtimeMs = performance.now() - started;
  assert.equal(result.checked, 100); assert.equal(result.confirmed, 100);
  const refreshRead = read, refreshWritten = written, publishStarted = performance.now();
  const version = await factsVersion(query, "meeting:", arg("state"));
  const comments = await readFactCommentAccess(query, null, arg("state"));
  const meetings = await withMeetingFacts(Array.from({ length: 100 }, (_, i) => ({ id: `${arg("state")}:${i + 1}`, title: "old", provenance: {} } as Meeting)), query, arg("state"));
  assert.equal(comments.length, Number(arg("governments")));
  assert.ok(comments.every(row => row.bodyId.startsWith(`meeting:${arg("state")}:`)));
  assert.ok(meetings.every(row => row.title === "Council meeting"));
  const statePublication = { version, comments: comments.length, meetings: meetings.length, databaseBytesRead: read - refreshRead,
    databaseBytesWritten: written - refreshWritten, runtimeMs: performance.now() - publishStarted };
  const plans = [];
  for (const statement of statements) plans.push(await remote(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.text}`, statement.params));
  const peakRssBytes = process.resourceUsage().maxRSS * 1024;
  process.send!({ result: { ...result, state: arg("state"), requests, queries, databaseBytesRead: refreshRead,
    databaseBytesWritten: refreshWritten, largestResultBytes: largestResult, runtimeMs, peakRssBytes, statePublication,
    copiesAtMargin: Math.floor((8 * 1024 ** 3 - 768 * 1024 ** 2) / peakRssBytes), plans } }, () => process.disconnect!());
}

async function main() {
  const states = readdirSync("data/derived/place-reference").filter(name => /^[a-z]{2}\.json$/.test(name)).map(name => {
    const reference = JSON.parse(readFileSync(join("data/derived/place-reference", name), "utf8")) as { state: string; units: unknown[] };
    return { state: reference.state, governments: reference.units.length };
  }).sort((a, b) => b.governments - a.governments);
  const largest = states[0]!;
  const db = launch("database"), query = client(db);
  const seed = async (state: string, governments: number) => {
    await query(`INSERT INTO entity (id,kind,name,state)
      SELECT 'meeting:' || $1 || ':' || n, 'meeting', 'Council', $1 FROM generate_series(1,$2::int) n`, [state, governments]);
    await query(`INSERT INTO entity_host (entity_id,host) SELECT id, 'fixture.gov' FROM entity WHERE state = $1`, [state]);
    await query(`INSERT INTO source_copy (url,final_url,fetched_at,http_status,sha256,blob_key)
      SELECT 'https://fixture.gov/' || id, 'https://fixture.gov/' || id, $2, 200, repeat('a',64), 'held:' || id
      FROM entity WHERE state = $1`, [state, OLD]);
    await query(`INSERT INTO fact (entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by)
      SELECT e.id, CASE n WHEN 1 THEN 'title' WHEN 2 THEN 'comment:period' ELSE 'field:' || n END,
        CASE n WHEN 2 THEN '"YES"'::jsonb ELSE '"Council meeting"'::jsonb END,
        CASE n WHEN 2 THEN 'YES' ELSE 'Council meeting' END, 'live', 'OFFICIAL', s.id,
        CASE n WHEN 2 THEN 'YES' ELSE 'Council meeting' END, $2, $2, 'generated-scale'
      FROM entity e JOIN source_copy s ON s.blob_key = 'held:' || e.id CROSS JOIN generate_series(1,10) n WHERE e.state = $1`, [state, OLD]);
  };
  const run = (): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const child = launch("worker", [`--state=${largest.state}`, `--governments=${largest.governments}`]);
    let result: Record<string, unknown> | undefined;
    child.on("message", (message: Message) => {
      if (message.result) result = message.result;
      if (message.statement) void query(message.statement.text, message.statement.params).then(
        value => child.send({ id: message.id, value }), error => child.send({ id: message.id, error: String(error) }));
    });
    child.on("error", reject);
    child.on("exit", code => code === 0 && result ? resolve(result) : reject(new Error(`Worker failed: ${code}`)));
  });
  try {
    await seed(largest.state, largest.governments); await query("ANALYZE");
    const baseline = await run();
    await query("UPDATE fact SET checked_at = $1 WHERE checked_at <> $1", [OLD]);
    for (const row of states.slice(1)) await seed(row.state, row.governments);
    await query("VACUUM ANALYZE");
    const national = await run();
    const [counts] = await query("SELECT (SELECT count(*) FROM entity) governments, count(*) facts FROM fact");
    const project = (batches: number) => ({ batches, databaseBytesRead: Number(national.databaseBytesRead) * batches,
      databaseBytesWritten: Number(national.databaseBytesWritten) * batches, runtimeMs: Number(national.runtimeMs) * batches });
    process.stdout.write(`${JSON.stringify({ states: states.length, ...counts, largest, baseline, national,
      dailyEstimates: { basis: "Measured 100-fact batch multiplied by batch count; does not measure a full day or include publisher latency.",
        uniformSevenDayExpiry: project(Math.ceil(largest.governments * 10 / 7 / 100)),
        allFactsDue: project(Math.ceil(largest.governments * 10 / 100)) },
      measurements: "Actual generated fact refresh, separate PostgreSQL process excluded from worker RSS. Database bytes are serialized SQL/parameters and result JSON; plans include PostgreSQL buffer accesses. Per-day batch traffic depends on configured clocks and failures; 100 facts were due in each measured batch." }, null, 2)}\n`);
  } finally { db.disconnect(); }
}

const mode = arg("mode");
if (mode === "database") await database();
else if (mode === "worker") await worker();
else await main();
