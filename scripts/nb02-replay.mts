/** Read-only production replay of NB-02's control reads, scheduling decisions and reader requests.
 * This reports its coverage explicitly; it does not claim to execute source acquisition or publication writes.
 * NODE_USE_ENV_PROXY=1 node --env-file=/private/production.env --experimental-strip-types
 *   --import ./scripts/register-test-loader.mjs scripts/nb02-replay.mts --out=.scratch/nb02
 * Connections: NB02_CONTROL_DATABASE_URL and NB02_READER_DATABASE_URL.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { neon, neonConfig } from "@neondatabase/serverless";
import { pgAggregateRepository, pgBoxRepository, pgDoorRepository, pgMethodCandidateSummary, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { CENSUS_DOOR_MATCH_FIELDS, handWiredMeetingDoor } from "../lib/doors/platform-census.ts";
import { readRoutineDoors, ROUTINE_DOOR_FIELDS } from "../lib/doors/routine-reads.ts";
import { projectRecord } from "../lib/control-plane/repository/types.ts";
import { isDoorRecord, type DoorRecord } from "../lib/doors/registry.ts";
import { readNowDueRequests } from "../lib/doors/mission-refresh.ts";
import { editDeriveDueRequests } from "../lib/doors/edit-derive.ts";
import { planProbes } from "../lib/doors/hourly-check.ts";
import { pageDoorsDue } from "../lib/doors/page-refresh.ts";
import { publishNowDoorTasks } from "../lib/civic-data/publish-now.ts";
import { installDoorRecords } from "../lib/doors/meeting-doors.ts";
import { ROUTINE_SOURCE_TASKS, readRoutineTaskClocks, routineTaskDue } from "../lib/civic-data/runner.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { DOOR_DERIVE_CONTRACT_IDS } from "../lib/civic-data/routine-due-request.ts";
import { candidateCounts, type CandidateStore } from "../lib/method/candidate.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { routineTasksWithoutClocks } from "../lib/civic-data/clock-presence.ts";
import type { RoutineSourceTask } from "../lib/civic-data/runner.ts";
import type { BoxFinding, BoxInput } from "../lib/control-plane/box.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const output = resolve(process.argv.find(arg => arg.startsWith("--out="))?.slice(6) ?? ".scratch/nb02");
await mkdir(output, { recursive: true });
const control = process.env.NB02_CONTROL_DATABASE_URL, reader = process.env.NB02_READER_DATABASE_URL;
assert.ok(control && reader, "Both explicit production connections are required");
assert.ok(new URL(reader).hostname.startsWith("ep-dry-river-axwtolzc"), "Refusing a different reader database");
assert.equal(new URL(reader).username, "readonly");
process.env.DATABASE_URL = reader;
process.env.WTP_CONTROL_PLANE_DATABASE_URL = control;
process.env.WTP_DB_ROLE = "production";
process.env.WTP_VITAL_SIGNS_REPORT = "1";

const context = new AsyncLocalStorage<string>(), wire: Record<string, number> = {};
const underlyingFetch = neonConfig.fetchFunction ?? globalThis.fetch;
// Every query, including the real reader-store clock implementation, runs in a server-enforced read-only transaction.
neonConfig.fetchFunction = async (url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)), single = !Array.isArray(body.queries);
  const queries = single ? [body] : body.queries;
  for (const query of queries) assert.match(query.query.trim(), /^(?:SELECT|WITH)\b/i, "Replay refuses non-read statements");
  const headers = new Headers(init.headers);
  headers.set("Neon-Batch-Read-Only", "true");
  const response = await underlyingFetch(url, { ...init, headers, body: JSON.stringify({ queries }) });
  const raw = await response.text(), family = context.getStore() ?? "setup";
  wire[family] = (wire[family] ?? 0) + Buffer.byteLength(raw);
  if (!response.ok || !single) return new Response(raw, { status: response.status, headers: response.headers });
  return new Response(JSON.stringify(JSON.parse(raw).results[0]), { status: response.status, headers: response.headers });
};
const sql = neon(control), query: Sql = { query: (text, params = []) => sql.query(text, [...params]) };
const measured = <T,>(name: string, fn: () => Promise<T>): Promise<T> => context.run(name, fn);
const report: Record<string, unknown> = { scope: "NB-02 control-read and schedule replay; source executions and production writes are excluded", at: new Date().toISOString(), wire };
const save = () => writeFile(`${output}/replay.json`, JSON.stringify(report, null, 2) + "\n");
const vitalSigns = () => measured("setup/vital-signs", () => query.query(`SELECT hour, neon_bytes_read, neon_bytes_by_caller, release_sha
  FROM cp_vital_signs WHERE hour < date_trunc('hour',now()) ORDER BY hour DESC LIMIT 3`, []));
const runner = () => measured("setup/runner", () => query.query(`SELECT value->>'beatAt' AS beat_at, value->>'testedSha' AS tested_sha,
  value->'codeIdentity' AS code_identity, value->'intakeRuntime' AS intake_runtime FROM cp_runner_heartbeat WHERE id='pilot-runner'`, []));
if (process.argv.includes("--live")) {
  report.scope = "Read-only release/runner identity and complete-hour observation; readiness must be established separately";
  report.build = await (await fetch(`${PUBLIC_SITE_ORIGIN}/api/build`, { signal: AbortSignal.timeout(15_000) })).json();
  report.vitalSigns = await vitalSigns();
  report.runner = await runner();
  await save(); console.log(JSON.stringify(report)); process.exit(0);
}
async function schedules(tasks: readonly RoutineSourceTask[], now: number) {
  const store = new PostgresRoutineDataStore(), readerSql = neon(reader!);
  const empty = await measured("reader/clock-presence", () => routineTasksWithoutClocks(tasks,
    (text, params) => readerSql.query(text, [...params])));
  const reads = await readRoutineTaskClocks(tasks, task => empty.has(task.id) ? Promise.resolve(undefined)
    : measured(`reader/clocks/${task.sourceId}`, () => store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion)));
  const families: Record<string, { tasks: number; dueNow: number; dueTomorrow: number }> = {};
  const failures: string[] = [];
  for (const read of reads) {
    if (!read.ok) { failures.push(read.task.id); continue; }
    const { task, clock } = read, family = families[task.sourceId] ??= { tasks: 0, dueNow: 0, dueTomorrow: 0 };
    family.tasks++;
    if (routineTaskDue(task, clock, now)) family.dueNow++;
    if (routineTaskDue(task, clock, now + 86_400_000)) family.dueTomorrow++;
  }
  return { at: new Date(now).toISOString(), tomorrow: new Date(now + 86_400_000).toISOString(),
    taskCount: tasks.length, emptyClocks: empty.size, families, failures };
}
try {
  const controlIdentity = await query.query("SELECT current_user AS role, current_setting('transaction_read_only') AS read_only", []);
  const readerIdentity = await neon(reader).query("SELECT current_user AS role, current_setting('transaction_read_only') AS read_only", []);
  report.identities = { control: controlIdentity, reader: readerIdentity };
  if (process.argv.includes("--schedules-only")) {
    const meetings: DoorRecord[] = [];
    let after = "";
    for (;;) {
      const rows = await measured("setup/meeting-doors", () => query.query(`SELECT id, value FROM cp_doors WHERE id > $1
        AND value->>'status' IN ('OPEN','SHUT') AND value->'meeting' IS NOT NULL AND value->'meeting' <> 'null'::jsonb ORDER BY id LIMIT 100`, [after])) as { id: string; value: DoorRecord }[];
      meetings.push(...rows.map(row => row.value).filter(isDoorRecord));
      if (rows.length < 100) break;
      after = rows.at(-1)!.id;
    }
    installDoorRecords(meetings);
    report.scope = "Normal standing-task clocks with the routine runner's empty-clock optimization; acquisition/publication excluded";
    report.schedules = await schedules(ROUTINE_SOURCE_TASKS, Date.now());
    report.fullRoutineExecutionProven = false;
    report.status = (report.schedules as { failures: string[] }).failures.length ? "SCHEDULE_READ_FAILED" : "CONTROLLED_CLOCK_REPLAY_COMPLETE";
    await save(); console.log(JSON.stringify(report)); process.exit(report.status === "SCHEDULE_READ_FAILED" ? 1 : 0);
  }
  const all = (await measured("before/doors", () => pgAggregateRepository<DoorRecord>(query, "Door", "cp_doors").list())).map(row => row.value).filter(isDoorRecord);
  report.doorFamilies = Object.fromEntries([...new Set(all.map(door => door.kind))].sort().map(kind => {
    const rows = all.filter(door => door.kind === kind);
    return [kind, { rows: rows.length, fullValueJsonBytes: Buffer.byteLength(JSON.stringify(rows)),
      stages: Object.fromEntries(Object.entries(ROUTINE_DOOR_FIELDS).map(([purpose, projection]) => {
        const selected = rows.filter(door => purpose === "refresh" ? door.kind === "page"
          : purpose === "requests" ? ["OPEN", "SHUT"].includes(door.status) : door.status === "OPEN");
        return [purpose, { rows: selected.length, beforeValueJsonBytes: Buffer.byteLength(JSON.stringify(selected)),
          afterValueJsonBytes: Buffer.byteLength(JSON.stringify(selected.map(door => projectRecord(door, projection)))) }];
      })) }];
  }));
  installDoorRecords(all);
  const tasks = [...ROUTINE_SOURCE_TASKS], known = new Set(tasks.map(task => task.id));
  const hot = new Set(MEETING_PARTITION_CONTRACTS.map(task => task.id));
  const repo = pgDoorRepository(query);
  const census = await measured("after/census", () => repo.meetingMatches!(false, CENSUS_DOOR_MATCH_FIELDS));
  assert.deepEqual(census.map(row => row.id), all.filter(handWiredMeetingDoor).map(door => door.doorId));
  const methods = pgAggregateRepository<CandidateStore>(query, "MethodCandidateStore", "cp_method_candidates");
  const beforeMethods = (await measured("before/methods", () => methods.read("live")))?.value.candidates ?? [];
  const afterMethods = await measured("after/methods", () => pgMethodCandidateSummary(query));
  assert.deepEqual(afterMethods, beforeMethods.map(({ id, lifecycle, submittedAt, admission }) => JSON.parse(JSON.stringify({ id, lifecycle, submittedAt, admission }))));
  assert.deepEqual(candidateCounts({ candidates: afterMethods }), candidateCounts({ candidates: beforeMethods }));
  report.methods = { candidates: afterMethods.length, counts: candidateCounts({ candidates: afterMethods }) };
  const now = Date.parse(String(report.at));
  const passes: unknown[] = [];
  for (const at of [now, now + 86_400_000]) {
    const when = new Date(at).toISOString();
    const requests = await measured("after/requests", () => readRoutineDoors(repo, "requests"));
    const probes = await measured("after/probes", () => readRoutineDoors(repo, "probes"));
    const refresh = await measured("after/refresh", () => readRoutineDoors(repo, "refresh"));
    const publication = await measured("after/publication", () => readRoutineDoors(repo, "publication"));
    const readNow = readNowDueRequests(requests, known, when), derive = editDeriveDueRequests(requests, new Set(DOOR_DERIVE_CONTRACT_IDS), when);
    const ids = (rows: readonly DoorRecord[]) => rows.map(row => row.doorId);
    assert.deepEqual(readNow, readNowDueRequests(all, known, when));
    assert.deepEqual(derive, editDeriveDueRequests(all, new Set(DOOR_DERIVE_CONTRACT_IDS), when));
    assert.deepEqual(ids(planProbes(probes, hot, when).doors), ids(planProbes(all, hot, when).doors));
    assert.deepEqual(ids(pageDoorsDue(refresh, when)), ids(pageDoorsDue(all, when)));
    assert.deepEqual(publishNowDoorTasks(publication, tasks, when), publishNowDoorTasks(all, tasks, when));
    passes.push({ at: when, readNow: readNow.length, derive: derive.length, probes: planProbes(probes, hot, when).doors.length,
      refresh: pageDoorsDue(refresh, when).length, publication: publishNowDoorTasks(publication, tasks, when).length });
  }
  report.passes = passes;
  await save();
  report.schedules = await schedules(tasks, now);
  const [finding] = await measured("setup/box", () => query.query(`SELECT value FROM cp_box_findings
    WHERE jsonb_array_length(value->'origins') > 100 ORDER BY id LIMIT 1`, [])) as { value: BoxFinding }[];
  if (finding) {
    const row = finding.value, origin = row.origins[0], input: BoxInput = { subjectId: row.subjectId, exactQuote: row.exactQuote,
      sourceUrl: row.sourceUrl, origin, ...(row.fact ? { fact: row.fact } : {}) };
    await measured("before/box", () => pgAggregateRepository<BoxFinding>(query, "BoxFinding", "cp_box_findings").read(row.id));
    const found = await measured("after/box", () => pgBoxRepository(query).indexedOrigin!(row.id, row.id, input));
    assert.equal(found, row.id); report.boxReplay = { origins: row.origins.length, matched: true };
  }
  report.productionPasses = await measured("setup/pass-outcomes", () => query.query(`SELECT recorded_at, record->'runtimeOutcome' AS outcome
    FROM cp_log_owner_digests WHERE log_key='owner-digest' AND record->'runtimeOutcome'->>'kind'='ROUTINE_CIVIC_DATA_SUPERVISOR'
      AND record->'runtimeOutcome'->>'lane'='routine-civic-data' ORDER BY recorded_at DESC LIMIT 5`, []));
  report.vitalSigns = await vitalSigns();
  report.runner = await runner();
  report.status = (report.schedules as { failures: string[] }).failures.length ? "SCHEDULE_READ_FAILED" : "CONTROL_READS_AND_CONTROLLED_CLOCK_MATCH";
  report.fullRoutineExecutionProven = false;
  await save();
  console.log(JSON.stringify({ status: report.status, fullRoutineExecutionProven: false, output, wire, passes, schedules: report.schedules }));
  if (report.status === "SCHEDULE_READ_FAILED") process.exitCode = 1;
} catch (error) {
  report.status = "FAILED";
  report.error = error instanceof Error ? error.message : String(error);
  await save(); throw error;
}
