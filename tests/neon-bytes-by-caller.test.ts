import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { databaseTransferFetch } from "../lib/db/transfer.ts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";
import { boundedQuery } from "../lib/control-plane/repository/request-bounds.ts";
import { pathToFileURL } from "node:url";
import {
  VITAL_SIGNS_LINE_PREFIX, VITAL_SIGNS_REPORT_ENV, callerFromStack, countNeonBytes, formatNeonBytesLine, formatVitalSignsReport,
  hourStart, parseVitalSignsReport, processNeonBytes, reportNeonBytes, summarizeNeonBytes, vitalSignsLineFilter,
  type NeonBytesHour,
} from "../lib/db/transfer-by-caller.ts";
import { keepNeonBytesPart, pruneNeonBytes, readNeonBytesHour } from "../lib/ops/vital-signs-hours.ts";
import { mayCountAsProgress } from "../lib/control-plane/scheduler/round-progress.ts";
import { receiveChildVitalSigns, runRuntimeChildren } from "../scripts/pilot-runtime-child.mts";

const callerBytes = (prefix: string) => processNeonBytes().flatMap(hour => Object.entries(hour.byCaller))
  .filter(([caller]) => caller.startsWith(prefix));

test("a real control-plane read counts its response bytes under the operation and the code that asked", async () => {
  const saved = { fetch: neonConfig.fetchFunction, env: { ...process.env } };
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://local:local@ep-reader-bytes-test.us-east-2.aws.neon.tech/neondb",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@ep-cp-bytes-test.us-east-2.aws.neon.tech/neondb",
  });
  const response = JSON.stringify({ command: "SELECT", rowCount: 1, rowAsArray: true,
    fields: ["id", "revision", "updated_at", "value"].map(name => ({ name, dataTypeID: 25 })),
    rows: [["admin", "1", "2026-10-02T00:00:00.000Z", "{\"padding\":\"" + "x".repeat(5000) + "\"}"]] });
  neonConfig.fetchFunction = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.queries) return new Response(JSON.stringify({ results: body.queries.map(() => ({ command: "INSERT", rowCount: 1, rowAsArray: true, fields: [], rows: [] })) }));
    return new Response(response);
  };
  try {
    const repos = await createPgRepositories(process.env.WTP_CONTROL_PLANE_DATABASE_URL!, undefined, { skipBootstrap: true });
    for (let i = 0; i < 2; i++) await repos.adminConfig.read("admin");
    const counted = callerBytes("cp_admin_config.");
    assert.equal(counted.length, 1, `one caller key, got ${JSON.stringify(counted)}`);
    const [caller, bytes] = counted[0]!;
    assert.match(caller, /^cp_admin_config\.\w+ ← tests\/neon-bytes-by-caller\.test\.ts:\d+$/);
    assert.equal(bytes, 2 * Buffer.byteLength(response));
  } finally {
    neonConfig.fetchFunction = saved.fetch;
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
  }
});

test("a read whose query is sent after the repository's own awaits counts under the code that called it, not unknown", async () => {
  const saved = { fetch: neonConfig.fetchFunction, env: { ...process.env } };
  Object.assign(process.env, { WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@ep-pinned-bytes-test.us-east-2.aws.neon.tech/neondb" });
  const answer = JSON.stringify({ command: "SELECT", rowCount: 0, rowAsArray: true, fields: [{ name: "record", dataTypeID: 25 }], rows: [] });
  neonConfig.fetchFunction = databaseTransferFetch(async () => new Response(answer), row => { countNeonBytes(row.database, row.responseBytes); });
  try {
    const repos = await createPgRepositories(process.env.WTP_CONTROL_PLANE_DATABASE_URL!, undefined, { skipBootstrap: true });
    // A callback, not an awaiting async function, so no async stack leads back here once the read has awaited.
    await new Promise(resolve => setImmediate(() => resolve(repos.costs.readSince("2026-10-01T00:00:00.000Z"))));
    assert.deepEqual(callerBytes("cp_log_costs.").map(([caller]) => caller.replace(/:\d+$/, "")),
      ["cp_log_costs.readSince ← tests/neon-bytes-by-caller.test.ts"]);
  } finally {
    neonConfig.fetchFunction = saved.fetch;
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
  }
});

test("a whole-table read answered from its held copy still counts its bytes under the code that asked", async () => {
  const saved = { fetch: neonConfig.fetchFunction, env: { ...process.env } };
  const dir = mkdtempSync(join(tmpdir(), "held-bytes-"));
  Object.assign(process.env, { WTP_CONTROL_PLANE_READS_DIR: dir,
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@ep-held-bytes-test.us-east-2.aws.neon.tech/neondb" });
  const answer = (fields: string[], rows: unknown[][]) => JSON.stringify({ command: "SELECT", rowCount: rows.length, rowAsArray: true,
    fields: fields.map(name => ({ name, dataTypeID: 25 })), rows });
  // The counter wraps the driver's fetch once per process; an earlier test restored the bare one.
  neonConfig.fetchFunction = databaseTransferFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return new Response(/now\(\) AS read_at/.test(body.query) ? answer(["read_at"], [["2026-10-07T00:00:00.000Z"]])
      : answer(["id", "revision", "updated_at", "value"], [["door-a", "1", "2026-10-02T00:00:00.000Z", "{\"status\":\"OPEN\"}"]]));
  }, row => { countNeonBytes(row.database, row.responseBytes); });
  try {
    readFromHeldCopies();
    const repos = await createPgRepositories(process.env.WTP_CONTROL_PLANE_DATABASE_URL!, undefined, { skipBootstrap: true });
    for (let i = 0; i < 2; i++) assert.equal((await repos.doors.list()).length, 1);
    assert.ok(readdirSync(dir).length === 1, "the copy was kept on the runner's disk");
    const counted = callerBytes("cp_doors.");
    assert.deepEqual(counted.map(([caller]) => caller.replace(/:\d+$/, "")).sort(), [
      "cp_doors.listChangedSince ← tests/neon-bytes-by-caller.test.ts",
      "cp_doors.listChangedSince:clock ← tests/neon-bytes-by-caller.test.ts",
    ]);
  } finally {
    neonConfig.fetchFunction = saved.fetch;
    for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bytes counted when a lazy query is awaited inside boundedQuery stay under its operation", async () => {
  // The Neon driver's query is a thenable that sends its request only when awaited.
  const lazy = { query: () => ({ then: (resolve: (rows: unknown[]) => void) => { countNeonBytes("control-plane", 700); resolve([]); } }) };
  await boundedQuery(lazy as never, { operation: "cp_lazy_probe.list", callClass: "PAGE" }, "select 1");
  assert.deepEqual(callerBytes("cp_lazy_probe."), [[callerBytes("cp_lazy_probe.")[0]![0], 700]]);
  assert.match(callerBytes("cp_lazy_probe.")[0]![0], / ← tests\/neon-bytes-by-caller\.test\.ts:\d+$/);
});

test("the caller is the first frame outside the database layers, repo-relative", () => {
  const stack = [
    "Error",
    "    at callSite (/srv/releases/abc/lib/db/transfer-by-caller.ts:80:9)",
    "    at boundedQuery (/srv/releases/abc/lib/control-plane/repository/request-bounds.ts:250:12)",
    "    at async Object.list (/srv/releases/abc/lib/control-plane/repository/pg-store.ts:400:5)",
    "    at async Promise.all (index 0)",
    "    at async runCycle (/srv/releases/abc/node_modules/x/lib/y.js:1:1)",
    "    at async publicationCycle (/srv/releases/abc/lib/control-plane/promotion/campaign-publication-cycle.ts:56:21)",
  ].join("\n");
  assert.equal(callerFromStack(stack), "lib/control-plane/promotion/campaign-publication-cycle.ts:56");
  assert.equal(callerFromStack("Error\n    at file:///srv/x/scripts/freshness-shadow.mts:3507:11"), "scripts/freshness-shadow.mts:3507");
  assert.equal(callerFromStack([
    "Error",
    "    at async file:///srv/x/lib/ops/neon-request-deadline.ts:33:14",
    "    at async Object.observed (file:///srv/x/lib/control-plane/scheduler/cycle-phases.ts:23:52)",
    "    at Object.tracked (file:///srv/x/lib/control-plane/scheduler/cycle-stall.ts:147:39)",
    "    at async PostgresRoutineDataStore.readPromotion (file:///srv/x/lib/civic-data/store.ts:1676:19)",
  ].join("\n")), "lib/civic-data/store.ts:1676", "the request deadline and the cycle's call counter and tracker are wrappers, never the caller");
  assert.equal(callerFromStack(undefined), "unknown");
});

test("each process reports its hour as a line, the parent keeps and sums the hour, and old hours are pruned", () => {
  const dir = mkdtempSync(join(tmpdir(), "neon-bytes-"));
  const savedEnv = process.env[VITAL_SIGNS_REPORT_ENV];
  try {
    const now = Date.parse("2020-01-06T07:30:00Z");
    countNeonBytes("control-plane", 1_000, now);
    countNeonBytes("reader", 50, now);
    let printed = "";
    delete process.env[VITAL_SIGNS_REPORT_ENV];
    assert.equal(reportNeonBytes(now, text => { printed += text; }), false, "outside the runner nothing is printed");
    process.env[VITAL_SIGNS_REPORT_ENV] = "1";
    assert.equal(reportNeonBytes(now, text => { printed += text; }), true);
    const own = printed.split("\n").filter(Boolean).map(parseVitalSignsReport).find(part => part?.hour === "2020-01-06T07:00:00.000Z");
    assert.ok(own, printed);
    assert.equal(own.pid, process.pid);
    assert.equal(keepNeonBytesPart(dir, own), true);
    // A second process's part for the same hour (a research child), a reused pid that started later, and a half-written file.
    const child: NeonBytesHour = { hour: "2020-01-06T07:00:00.000Z", requests: 3, pid: 999_999, startedMs: 1,
      bytes: { reader: 0, "control-plane": 4_000 }, byCaller: { "cp_attempts.list ← lib/a.ts:1": 4_000 }, processes: ["freshness-shadow#999999"] };
    assert.equal(keepNeonBytesPart(dir, { ...child, requests: 1, bytes: { reader: 0, "control-plane": 1 }, byCaller: {} }), true);
    assert.equal(keepNeonBytesPart(dir, child), true, "a later line from the same process replaces its earlier one");
    assert.equal(keepNeonBytesPart(dir, { ...child, startedMs: 2, requests: 1, bytes: { reader: 0, "control-plane": 7 },
      byCaller: { "x ← lib/b.ts:2": 7 } }), true);
    writeFileSync(join(dir, "2020-01-06T07--1.json"), "{\"hour\":");
    writeFileSync(join(dir, "2020-01-03T01--1.json"), "{}");
    const hour = readNeonBytesHour(dir, hourStart(now));
    assert.equal(hour.bytes["control-plane"], 5_007);
    assert.equal(hour.bytes.reader, 50);
    assert.equal(hour.processes.length, 3);
    const summary = summarizeNeonBytes(hour, 1);
    assert.deepEqual(summary.byCaller[0], { caller: "cp_attempts.list ← lib/a.ts:1", bytes: 4_000 });
    assert.equal(summary.byCaller.at(-1)!.caller, "other");
    assert.equal(summary.byCaller.at(-1)!.bytes, 1_057);
    assert.match(formatNeonBytesLine(summary, "last full hour"), /control plane 0\.0 MB, reader 0\.0 MB; largest: 0\.0 MB cp_attempts\.list/);
    // Nothing new to report once reported; the finished hour is forgotten once the next hour reports.
    printed = "";
    reportNeonBytes(now, text => { printed += text; });
    assert.equal(printed, "");
    assert.equal(processNeonBytes().some(h => h.hour === "2020-01-06T07:00:00.000Z"), true);
    reportNeonBytes(Date.parse("2020-01-06T08:01:00Z"), () => undefined);
    assert.equal(processNeonBytes().some(h => h.hour === "2020-01-06T07:00:00.000Z"), false);
    pruneNeonBytes(dir, Date.parse("2020-01-06T08:01:00Z"));
    assert.equal(readdirSync(dir).some(name => name.startsWith("2020-01-03")), false);
    assert.equal(readdirSync(dir).filter(name => name.startsWith("2020-01-06T07")).length, 4);
  } finally {
    if (savedEnv === undefined) delete process.env[VITAL_SIGNS_REPORT_ENV]; else process.env[VITAL_SIGNS_REPORT_ENV] = savedEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a report line fits one atomic pipe write, keeps its totals, and is never the round's progress", () => {
  const byCaller: Record<string, number> = {};
  for (let i = 0; i < 400; i++) byCaller[`cp_table_${i}.list ← lib/control-plane/some/long/module/path-${i}.ts:${i}`] = 10 + i;
  const part: NeonBytesHour = { hour: "2020-01-06T07:00:00.000Z", requests: 400, pid: 42, startedMs: 7,
    bytes: { reader: 0, "control-plane": 400 * 10 + (399 * 400) / 2 }, byCaller, processes: ["freshness-shadow#42"] };
  const line = formatVitalSignsReport(part);
  assert.ok(Buffer.byteLength(line) <= 3_800, `${Buffer.byteLength(line)} bytes`);
  const back = parseVitalSignsReport(line)!;
  assert.equal(Object.values(back.byCaller).reduce((a, b) => a + b, 0), part.bytes["control-plane"]);
  assert.ok(back.byCaller.other! > 0);
  assert.equal(back.byCaller["cp_table_399.list ← lib/control-plane/some/long/module/path-399.ts:399"], 409, "the largest are kept");
  assert.equal(mayCountAsProgress(line), false);
  assert.equal(parseVitalSignsReport("vital-signs-bytes {not json"), null);
  assert.equal(parseVitalSignsReport("round progress: 3 tasks"), null);
});

test("the runner's filter takes report lines out of a child's stream however the chunks fall, and leaves the rest in order", () => {
  const part: NeonBytesHour = { hour: "2020-01-06T07:00:00.000Z", requests: 1, pid: 7, bytes: { reader: 0, "control-plane": 9 },
    byCaller: { "a ← lib/a.ts:1": 9 }, processes: ["x#7"] };
  const stream = `round progress: 1\n${formatVitalSignsReport(part)}\nvital-signs is a word\npartial`;
  for (const size of [1, 3, 17, 64, stream.length]) {
    const got: NeonBytesHour[] = [];
    const filter = vitalSignsLineFilter(p => got.push(p));
    let out = "";
    for (let at = 0; at < stream.length; at += size) out += filter.take(stream.slice(at, at + size));
    out += filter.end();
    assert.equal(out, "round progress: 1\nvital-signs is a word\npartial", `chunks of ${size}`);
    assert.deepEqual(got, [part]);
  }
  // An ordinary line that merely starts like the prefix is passed on once it is known not to be one.
  const filter = vitalSignsLineFilter(() => assert.fail("not a report"));
  assert.equal(filter.take("vital"), "");
  assert.equal(filter.take("ity\n"), "vitality\n");
  assert.equal(filter.take(`${VITAL_SIGNS_LINE_PREFIX}{broken\n`), `${VITAL_SIGNS_LINE_PREFIX}{broken\n`);
});

test("a real child's hour reaches the runner's sink, and its output and progress never carry the report", async () => {
  const got: NeonBytesHour[] = [];
  receiveChildVitalSigns(part => got.push(part));
  try {
    const moduleUrl = pathToFileURL(join(process.cwd(), "lib/db/transfer-by-caller.ts")).href;
    const code = `const m = await import(${JSON.stringify(moduleUrl)}); m.countNeonBytes("control-plane", 1234); ` +
      `console.log("child worked"); m.installNeonBytesReport();`;
    let shown = "";
    const [run] = await runRuntimeChildren([{ id: "child", executable: process.execPath,
      args: ["--experimental-strip-types", "--input-type=module", "-e", code],
      env: { ...process.env, [VITAL_SIGNS_REPORT_ENV]: "1" } }], {
      cwd: process.cwd(), env: process.env, maxBufferBytes: 1024 * 1024, onStdout: (_id, output) => { shown += output; } });
    assert.equal(run!.status, 0, run!.stderr);
    assert.equal(run!.stdout, "child worked\n");
    assert.equal(shown, "child worked\n");
    assert.equal(got.length, 1, "the exit report arrived");
    assert.equal(got[0]!.bytes["control-plane"], 1234);
    assert.equal(got[0]!.pid !== process.pid, true);
  } finally { receiveChildVitalSigns(null); }
});
