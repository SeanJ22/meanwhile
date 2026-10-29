import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { neon } from "../lib/db/client.ts";
import { evaluateJobBreaker, JOB_TRANSFER_SQL, jobTransfers, readJobBreakerState, JOB_BREAKER_INTERVAL_MS, NORMAL_FLOOR_BYTES, SPIKE_TIMES,
  type BreakerSql, type JobBreakerState, type JobTransfer } from "../lib/control-plane/job-transfer-breaker.ts";
import { JOB_BREAKER_DDL } from "../lib/control-plane/repository/migrations/BB-01.ts";
import { admitJobLaunch, JOB_BREAKER_PATH_ENV, jobSlowTimes, saveBreakerSnapshot } from "../lib/control-plane/job-breaker-local.ts";
import { runBoundedChildPass } from "../lib/civic-data/bounded-child-pass.ts";
import { routineDeferral } from "../lib/civic-data/runner.ts";
import { ROUTINE_JOBS, runRoutineJob } from "../lib/civic-data/routine-jobs.ts";
import { JobTransferBreaker } from "../lib/control-plane/job-breaker-loop.ts";
import { readJobBreakerEvents } from "../lib/control-plane/line-keeper/read.ts";
import { withKeeperFixes } from "../lib/control-plane/line-keeper/keep.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { countNeonBytes, processNeonBytes } from "../lib/db/transfer-by-caller.ts";
import { slowedJobsView } from "../lib/control-plane/admin-view/slowed-jobs.ts";
import { jobLabel } from "../lib/control-plane/job-names.ts";
import { SlowedJobsList } from "../app/(admin)/_mw/admin-v6/slowed-jobs-panel.tsx";

const HOUR = Date.parse("2026-10-28T22:00:00Z"), H = 3_600_000, MINUTE = 60_000, MB = 1_000_000;
const iso = (at: number) => new Date(at).toISOString();
const row = (job: string, bytes: number, topTable: string | null = "civic_data_promotions"): JobTransfer => ({ job, requests: 10, bytes, topTable });
const pglite = (db: PGlite): BreakerSql => ({ query: async (text, params = []) => (await db.query<Record<string, unknown>>(text, [...params])).rows });
const hourly = (db: PGlite, at: number, reads: Record<string, readonly number[]>) =>
  db.query("INSERT INTO database_transfer_hourly VALUES($1,'reader',$2::jsonb) ON CONFLICT (hour,database_name) DO UPDATE SET reads=excluded.reads",
    [iso(at), JSON.stringify(reads)]);
const TABLES = `CREATE TABLE database_transfer_hourly(hour timestamptz,database_name text,reads jsonb,PRIMARY KEY(hour,database_name));${JOB_BREAKER_DDL}`;
function breakerFiles() {
  const root = mkdtempSync(join(tmpdir(), "bb-")), path = join(root, "breaker.json");
  return { root, path, env: { ...process.env, [JOB_BREAKER_PATH_ENV]: path } };
}
/** Hour by hour, each check closing the hour before with that hour's last totals, as the controller does. */
function hours(state: JobBreakerState) {
  let previous: JobTransfer[] = [];
  const changes: string[] = [];
  return { changes, get state() { return state; }, at(n: number, rows: JobTransfer[]) {
    const result = evaluateJobBreaker({ now: HOUR + n * H + MINUTE, rows, state, closed: previous });
    state = result.state; previous = rows;
    changes.push(...result.changes.map(c => `${c.kind} ${c.times}`));
    return state.jobs;
  } };
}

test("the 6:59 PM ET place-pages hour is inside its own normal; only a job far above its own normal slows, alone", async () => {
  const db = new PGlite();
  try {
    await db.exec(TABLES);
    await hourly(db, HOUR, { "place-pages\tcivic_data_promotions": [400, 0, 525 * MB], "legiscan-bulk\tcivic_data_candidates": [390, 126850, 1_623_621_517],
      "legiscan-bulk\tother": [543, 340_082_568, 26_896_950], "door-probes\tcp_doors": [10, 0, 41 * MB],
      "pilot-runner\tcp_budget": [100, 0, 9e9], "index\tentity": [100, 0, 9e9], "admin:Now\tcp_doors": [100, 0, 9e9], "publish-now\tcp_doors": [100, 0, 9e9] });
    const rows = jobTransfers(await pglite(db).query(JOB_TRANSFER_SQL, [iso(HOUR)]));
    assert.equal(rows.find(r => r.job === "legiscan-bulk")?.bytes, 1_990_727_885);
    assert.equal(rows.find(r => r.job === "legiscan-bulk")?.topTable, "civic_data_candidates");
    const state: JobBreakerState = { hour: iso(HOUR), jobs: { "place-pages": { normal: 317 * MB, seen: iso(HOUR - H) } } };
    const { state: next, changes } = evaluateJobBreaker({ now: HOUR + 59 * MINUTE, rows, state });
    assert.deepEqual(changes.map(c => [c.kind, c.job, c.times, c.normal, c.topTable]), [["SLOW", "legiscan-bulk", 2, NORMAL_FLOOR_BYTES, "civic_data_candidates"]],
      "0.525 GB is under three times place-pages' normal; supervisors and serving identities are never slowed");
    assert.deepEqual(Object.keys(next.jobs).sort(), ["legiscan-bulk", "place-pages"]);
    assert.equal(next.jobs["place-pages"]!.times, undefined, "place-pages keeps its ordinary pace");
    assert.equal(evaluateJobBreaker({ now: HOUR + 59 * MINUTE, rows, state: next }).changes.length, 0, "a recheck in the same hour is not a new spike");
    for (const bytes of [SPIKE_TIMES * NORMAL_FLOOR_BYTES, 3 * 317 * MB])
      assert.deepEqual(evaluateJobBreaker({ now: HOUR, rows: [row("place-pages", bytes)], state }).changes, [], "three times its normal is not yet a spike");
  } finally { await db.close(); }
});

test("each job learns its own normal from its ordinary hours; a spike or a slowed hour teaches it nothing", () => {
  const run = hours({ hour: iso(HOUR), jobs: {} });
  run.at(0, [row("place-pages", 400 * MB), row("door-probes", 40 * MB), row("people-portraits-ca", 250 * MB)]);
  let jobs = run.at(1, [row("place-pages", 480 * MB), row("people-portraits-ca", 250 * MB)]);
  assert.deepEqual([jobs["place-pages"]?.normal, jobs["door-probes"], jobs["people-portraits-ca"]?.normal], [400 * MB, undefined, 250 * MB],
    "a first ordinary hour at the floor or above is its normal; a job under the floor keeps none");
  jobs = run.at(2, [row("place-pages", 1_500 * MB)]);
  assert.deepEqual([jobs["place-pages"]!.normal, jobs["place-pages"]!.times], [410 * MB, 2], "an eighth of the way to 480 MB, then 1.5 GB is a spike");
  assert.equal(jobs["people-portraits-ca"]!.normal, 250 * MB, "one job's hours never move another's normal");
  run.at(3, [row("place-pages", 300 * MB)]);
  jobs = run.at(4, []);
  assert.deepEqual([jobs["place-pages"]!.normal, jobs["place-pages"]!.times], [410 * MB, undefined], "neither the spike hour nor the slowed hour taught it");
});

test("each spiking hour doubles the spacing up to 8 times; an hour at its normal brings it back; the record stays a week", () => {
  const run = hours({ hour: iso(HOUR), jobs: { "place-pages": { normal: 400 * MB, seen: iso(HOUR) } } });
  const pace = (n: number, bytes: number) => run.at(n, [row("place-pages", bytes)])["place-pages"]!;
  for (const [n, times] of [[0, 2], [1, 4], [2, 8], [3, 8]] as const) assert.equal(pace(n, 2_000 * MB).times, times);
  assert.equal(pace(4, 1_000 * MB).times, 8, "an hour between its normal and three times it keeps the spacing");
  assert.equal(pace(5, 300 * MB).times, 8, "the hour is judged once it is over");
  const back = pace(6, 0);
  assert.equal(back.times, undefined, "after an hour at its normal it is back at its ordinary pace");
  assert.equal(back.slowed!.back, iso(HOUR + 6 * H + MINUTE));
  assert.deepEqual(run.changes, ["SLOW 2", "SLOW 4", "SLOW 8", "SLOW 8", "NORMAL 8"]);
  assert.ok(pace(150, 0).slowed, "the slow-down stays on Admin's record for the week");
  assert.equal(pace(200, 0).slowed, undefined);
});

test("a slowed job's launches wait its own gap times the slow-down, at most an hour more, and never stop; others keep their pace", () => {
  const { root, path, env } = breakerFiles();
  try {
    const launched = new Map<string, number[]>();
    // place-pages takes a turn every 4 minutes, door-probes an hour-long turn, box-facts runs in each publish-now pass.
    const every: Record<string, number> = { "place-pages": 4, "door-probes": 60, "box-facts": 10, "publish-now": 10, "meeting-pins": 10 };
    for (let minute = 0; minute <= 8 * 60; minute++) {
      const slowed = minute >= 120 && minute < 360;
      if (minute % 10 === 0) saveBreakerSnapshot(path, { checkedAt: iso(HOUR + minute * MINUTE), hour: "", jobs: slowed
        ? { "place-pages": { seen: "", times: 8 }, "door-probes": { seen: "", times: 2 }, "box-facts": { seen: "", times: 4 }, "publish-now": { seen: "", times: 8 } } : {} });
      for (const [job, gap] of Object.entries(every)) {
        const times = launched.get(job) ?? [];
        if ((times.at(-1) ?? -Infinity) + gap <= minute && admitJobLaunch(job, env, HOUR + minute * MINUTE)) launched.set(job, [...times, minute]);
      }
    }
    const within = (job: string, from: number, to: number) => launched.get(job)!.filter(m => m >= from && m < to);
    assert.deepEqual(within("place-pages", 120, 360).slice(0, 4), [148, 180, 212, 244], "eight 4-minute gaps apart");
    assert.deepEqual(within("door-probes", 120, 360), [180, 300], "an hour on, an hour off");
    assert.equal(within("box-facts", 120, 360).length, 6, "a publish-now task every 40 minutes instead of 10");
    assert.equal(within("publish-now", 120, 360).length, 24, "the publish-now supervisor is never slowed");
    assert.equal(within("meeting-pins", 120, 360).length, 24, "a job that did not spike keeps its pace");
    for (const job of Object.keys(every)) {
      const minutes = launched.get(job)!;
      assert.ok(minutes.every((m, i) => i === 0 || m - minutes[i - 1]! <= 120), `${job} never waits more than two hours`);
      assert.ok(within(job, 360, 480).length >= 120 / every[job]! - 1, `${job} is back at its ordinary pace`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("production's paused state upgrades to running on deploy: every job launches and Admin lists nothing", async () => {
  const db = new PGlite(), { root, path, env } = breakerFiles();
  try {
    await db.exec(TABLES);
    const sql = pglite(db);
    // The control log as release 146 left it, and the snapshot its runner wrote, in its words and an earlier release's.
    for (const [id, at, action, job] of [["p1", "2026-10-28T03:18:18Z", "PAUSE", "routine-civic-data"], ["p2", "2026-10-28T22:59:02Z", "PAUSE", "place-pages"],
      ["p3", "2026-10-28T08:52:31Z", "PAUSE", "door-probes"], ["c1", "2026-10-29T06:30:00Z", "CHECK", null]] as const)
      await db.query(`INSERT INTO cp_job_transfer_breaker VALUES($1,$2::timestamptz,date_trunc('hour',$2::timestamptz),$3,$4,0.525,NULL,NULL,NULL,'{"pauses":[]}')`, [id, at, action, job]);
    writeFileSync(path, JSON.stringify({ checkedAt: "2026-10-29T06:30:00.000Z", releasesThrough: null, states: {
      "place-pages": { job: "place-pages", mode: "PAUSED", at: "2026-10-28T22:59:02.729Z", hour: "2026-10-28T22:00:00.000Z", offsetBytes: 0 },
      "door-probes": { job: "door-probes", mode: "PAUSED_CODE" }, "voting-sites:WI": { job: "voting-sites:WI", mode: "HALF_RATE" } },
      pendingEvents: [{ id: "old", action: "PAUSE", job: "place-pages" }] }));
    for (const job of ["place-pages", "door-probes", "voting-sites:WI"]) assert.equal(admitJobLaunch(job, env), true, `${job} launches`);
    const now = Date.parse("2026-10-29T06:40:00Z"), top = Date.parse("2026-10-29T06:00:00Z");
    for (let n = 1; n <= 24; n++) await hourly(db, top - n * H, { "place-pages\tcivic_data_promotions": [10, 0, n % 4 ? 317 * MB : 1_500 * MB], "door-probes\tcp_doors": [10, 0, 41 * MB] });
    await hourly(db, top, { "place-pages\tcivic_data_promotions": [10, 0, 600 * MB] });
    await new JobTransferBreaker({ path, reader: sql, control: sql, release: () => "147", meter: () => [] }).check(now);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).jobs, { "place-pages": { normal: 317 * MB, seen: iso(top) } },
      "with no saved state its first normal is its median hour of the last day");
    for (const job of ["place-pages", "door-probes", "voting-sites:WI"]) assert.equal(jobSlowTimes(job, env, now), 1);
    assert.deepEqual((await sql.query("SELECT id FROM cp_job_transfer_breaker WHERE action<>'CHECK' ORDER BY id")).map(r => r.id), ["p1", "p2", "p3"],
      "the old pause entries are history; nothing new is paused");
    assert.deepEqual(slowedJobsView(await readJobBreakerState(sql), iso(now)).jobs, []);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("the controller survives an uncertain control write and a restart; Admin and the daily brief name the slowed job in plain words", async () => {
  const db = new PGlite(), { root, path, env } = breakerFiles(), job = "people-portraits-ca";
  try {
    await db.exec(TABLES);
    let fail = true;
    const sql: BreakerSql = { query: async (text, params = []) => {
      const result = await db.query<Record<string, unknown>>(text, [...params]);
      if (text.startsWith("INSERT INTO cp_job_transfer_breaker") && fail) { fail = false; throw new Error("Connection lost after commit"); }
      return result.rows;
    } };
    const options = { path, reader: sql, control: sql, release: () => "147", meter: () => [] };
    await hourly(db, HOUR, { [`${job}\tcivic_data_promotions:STATE_LEGISLATOR\tlib/photos/portrait-run.ts`]: [40, 0, 700 * MB], "doors\tcp_doors": [5, 0, 20 * MB] });
    await assert.rejects(new JobTransferBreaker(options).check(HOUR + JOB_BREAKER_INTERVAL_MS), /Connection lost after commit/);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).pendingEvents.length, 1, "the check survived the uncertain commit");
    assert.deepEqual([jobSlowTimes(job, env, HOUR + JOB_BREAKER_INTERVAL_MS), jobSlowTimes("doors", env, HOUR + JOB_BREAKER_INTERVAL_MS)], [2, 1]);
    await new JobTransferBreaker(options).check(HOUR + 2 * JOB_BREAKER_INTERVAL_MS);
    assert.equal((await sql.query("SELECT count(*)::int n FROM cp_job_transfer_breaker WHERE action='CHECK'"))[0]!.n, 2, "each check written once");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).pendingEvents, undefined);
    rmSync(path); // A new host: the control plane's last check carries the state.
    await new JobTransferBreaker(options).check(HOUR + 3 * JOB_BREAKER_INTERVAL_MS);
    assert.equal(jobSlowTimes(job, env, HOUR + 3 * JOB_BREAKER_INTERVAL_MS), 2);

    const at = iso(HOUR + 3 * JOB_BREAKER_INTERVAL_MS), view = slowedJobsView(await readJobBreakerState(sql), at);
    assert.deepEqual(view.jobs.map(j => [j.job, j.label, j.gb, j.normalGb, j.times, j.backAt]), [[job, "Portraits · CA", 0.7, 0.2, 2, null]]);
    const html = renderToStaticMarkup(h(SlowedJobsList, { jobs: view.jobs }));
    const face = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.match(face, /Portraits · CA Slowed 2× Read 0\.70 GB in the hour from Oct 28, 6:00 PM ET against its normal 0\.20 GB, most of it from civic data promotions \(state legislator\)\. It keeps running, with launches 2 times further apart, until it reads at its normal again\. Its fix is first on the builders’ list\./);
    assert.doesNotMatch(face, /release|paused/i);
    assert.doesNotMatch(face, /people-portraits-ca|civic_data_promotions/, "the job id and table name stay behind Technical details");

    const events = await readJobBreakerEvents(sql, iso(HOUR), iso(HOUR + H));
    const saved = withKeeperFixes({ ...defaultAdminConfig(at), settingHistory: [] }, { from: iso(HOUR), through: iso(HOUR + H), measuredAt: iso(HOUR + H + 1),
      counts: [], waiting: [], problems: [], own: { bytesRead: 0 }, breakerEvents: events });
    assert.deepEqual(saved.latestBrief!.updates.map(update => update.what), ["Portraits · CA read 0.700 GB in one hour against its normal 0.200 GB. "
      + "It keeps running with launches 2 times further apart until it reads at its normal again; its fix is first on the builders' list."]);
  } finally { await db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("a hot in-process routine task is metered under its own name and slows alone; the other tasks and children still run", async () => {
  const { root, path, env } = breakerFiles(), previousJournal = process.env.WTP_DATABASE_TRANSFER_DIR;
  process.env.WTP_DATABASE_TRANSFER_DIR = join(root, "transfer");
  try {
    saveBreakerSnapshot(path, { checkedAt: new Date().toISOString(), hour: "", jobs: {} });
    const now = Date.now(), portraits = "people-portraits-ca";
    await runRoutineJob({ id: portraits }, async () => { countNeonBytes("reader", 700 * MB, now, { requests: 40, bytes: 0 }, undefined, "civic_data_promotions:STATE_LEGISLATOR"); }, () => undefined, env);
    await runRoutineJob(ROUTINE_JOBS.doors, async () => { countNeonBytes("control-plane", 20 * MB, now, { requests: 5, bytes: 0 }, undefined, "cp_doors"); }, () => undefined, env);
    const reads = processNeonBytes().find(part => Object.keys(part.reads ?? {}).some(key => key.includes(portraits)))!.reads!;
    const byJob = new Map<string, number>();
    for (const [key, [, sent, received]] of Object.entries(reads)) {
      const job = key.split("\t")[1]!;
      if ([portraits, "doors"].includes(job)) byJob.set(job, (byJob.get(job) ?? 0) + sent! + received!);
    }
    assert.deepEqual([...byJob].sort(), [["doors", 20 * MB], [portraits, 700 * MB]], "each task's bytes carry its own name");
    assert.ok(!Object.keys(reads).some(key => key.split("\t")[1] === "routine-civic-data"), "none count as the routine lane's");
    const checked = evaluateJobBreaker({ now, rows: [...byJob].map(([job, bytes]) => row(job, bytes)), state: null });
    assert.deepEqual(checked.changes.map(change => change.job), [portraits], "only the hot task slows");
    saveBreakerSnapshot(path, { checkedAt: new Date().toISOString(), ...checked.state });
    const ran: string[] = [];
    for (const job of [{ id: portraits }, ROUTINE_JOBS.doors, ROUTINE_JOBS.meetingPins])
      await runRoutineJob(job, async () => { ran.push(job.id); }, id => { ran.push(`slowed ${id}`); }, env);
    assert.deepEqual(ran, [`slowed ${portraits}`, "doors", "meeting-pins"], "it ran a moment ago, so its next run waits; the others run");
    const launched: string[] = [];
    const results = await runBoundedChildPass([{ id: portraits, executable: process.execPath, args: ["scripts/people-portraits-refresh.mts"] },
      { id: "place-map-ca", executable: process.execPath, args: ["scripts/place-map-refresh.mts"] }], { cwd: root, env }, async command => {
      launched.push(command.id); return { id: command.id, status: 0, signal: null, stdout: "", stderr: "", termination: "EXITED", errorMessage: null };
    });
    assert.deepEqual(launched, ["place-map-ca"], "the slowed task's child waits its turn; another state's map launches");
    assert.match(routineDeferral(results[0]!, false)!, /^JOB_TRANSFER_BREAKER: people-portraits-ca read far more than its normal, so its launches are spaced out/);
  } finally {
    if (previousJournal === undefined) delete process.env.WTP_DATABASE_TRANSFER_DIR; else process.env.WTP_DATABASE_TRANSFER_DIR = previousJournal;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing, torn or stale snapshot slows nothing; supervisors are never slowed", () => {
  const { root, path, env } = breakerFiles();
  try {
    assert.equal(jobSlowTimes("place-pages", env), 1, "no snapshot");
    writeFileSync(path, "{");
    assert.equal(jobSlowTimes("place-pages", env), 1, "a torn snapshot");
    saveBreakerSnapshot(path, { checkedAt: iso(HOUR), hour: "", jobs: { "place-pages": { seen: "", times: 8 }, "routine-civic-data": { seen: "", times: 8 } } });
    assert.equal(jobSlowTimes("place-pages", env, HOUR + H), 8);
    assert.equal(jobSlowTimes("place-pages", env, HOUR + 2 * H), 1, "a snapshot two hours old");
    for (const supervisor of ["routine-civic-data", "publish-now", "pilot-runner"]) assert.equal(jobSlowTimes(supervisor, env, HOUR), 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the runner's first breaker check runs before the release handoff can reopen the standing clock", () => {
  const runner = readFileSync(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");
  const first = runner.indexOf("\nawait jobTransferTick();"), handoff = runner.indexOf("\nlet handoffExitCode = await reconcileRuntimeReleaseAtBoundary();");
  assert.ok(first > 0 && handoff > first, "the breaker writes this release's snapshot before anything launches");
  assert.equal(runner.split("\nawait jobTransferTick();").length, 2, "one startup check");
});

test("plain job names: per-state tasks say their state, in-process tasks their own words", () => {
  assert.equal(jobLabel("people-portraits-ca"), "Portraits · CA");
  assert.equal(jobLabel("voting-sites:TX"), "Voting places · TX");
  assert.equal(jobLabel("place-map-ny"), "Place maps · NY");
  assert.equal(jobLabel("door-sync"), "Door registry sync");
  assert.equal(jobLabel("place-pages"), "Place pages");
  assert.equal(jobLabel("meeting-partition:legistar-tucson"), "Meeting calendar");
  for (const job of Object.values(ROUTINE_JOBS)) {
    assert.ok(Number.isSafeInteger(job.databaseBytesPerRun) && job.databaseBytesPerRun > 0, `${job.id} states its bytes per run`);
    assert.ok(job.databaseBytesPerRun <= SPIKE_TIMES * NORMAL_FLOOR_BYTES, `${job.id}: one run alone never reads as a spike`);
  }
});

test("each scheduled check reads one keyed hour, under 5 MB/hour including real Neon request and response envelopes", async (t) => {
  const db = new PGlite(), { root } = breakerFiles(), previous = neonConfig.fetchFunction, previousReport = process.env.WTP_VITAL_SIGNS_REPORT;
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  let sent = 0, received = 0;
  const queries: string[] = [];
  try {
    await db.exec(TABLES);
    await hourly(db, HOUR, { "normal\tcp_doors": [10, 1000, 10000] });
    neonConfig.fetchFunction = async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = String(init?.body); sent += Buffer.byteLength(body);
      const query = JSON.parse(body), result = await db.query<Record<string, unknown>>(query.query, query.params);
      queries.push(String(query.query).trim().split(/\s+/)[0]!);
      const fields = result.fields;
      const encode = (value: unknown) => value == null ? null : value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
      const answer = JSON.stringify({ command: "SELECT", rowCount: result.rows.length, rowAsArray: true, fields,
        rows: result.rows.map(r => fields.map(field => encode(r[field.name]))) });
      received += Buffer.byteLength(answer);
      return new Response(answer);
    };
    const sql = neon("postgresql://fixture:fixture@ep-bb-wire-fixture.us-east-2.aws.neon.tech/neondb");
    const breaker = new JobTransferBreaker({ path: join(root, "breaker.json"), reader: sql, control: sql, release: () => "v1", meter: () => [] });
    await breaker.check(HOUR);
    const reads = () => queries.splice(0).filter(query => query !== "INSERT").length;
    assert.equal(reads(), 3, "start: the saved state, the one-time first normals, the hour");
    for (let tick = 1; tick <= 6; tick++) await breaker.check(HOUR + tick * JOB_BREAKER_INTERVAL_MS);
    assert.equal(reads(), 6, "each check reads only its hour; closing the hour reads nothing more");
    assert.ok(sent + received < 5_000_000, `${sent + received} bytes/hour`);
    t.diagnostic(JSON.stringify({ testStore: true, requestBytes: sent, responseBytes: received }));
  } finally {
    neonConfig.fetchFunction = previous;
    if (previousReport === undefined) delete process.env.WTP_VITAL_SIGNS_REPORT; else process.env.WTP_VITAL_SIGNS_REPORT = previousReport;
    await db.close(); rmSync(root, { recursive: true, force: true });
  }
});
