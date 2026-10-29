import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as nodeModule from "node:module";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { IndependentRuntimeLaneScheduler, passDeadlineFromEnv, withPassDeadline } from "../lib/ops/independent-runtime-pass.ts";
import { PendingRestart } from "../lib/ops/pending-restart.ts";
import { readIntents } from "../lib/control-plane/scheduler/research-policy.ts";
import { admitJobLaunch, JOB_BREAKER_PATH_ENV, saveBreakerSnapshot } from "../lib/control-plane/job-breaker-local.ts";
import { ROUTINE_ENTRY_PEAK_MIB, WORKER_MEMORY_HEADROOM_MIB, routineProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { PLACE_PACKAGE_SQL } from "../lib/reader/place-builder.ts";
import { drainPlacePageQueue, placePagesLane, placePageTurnResult, PLACE_PAGE_TURN_GRACE_MS, PLACE_PAGE_TURN_LINE,
  rebuildPlacePageTurn } from "../lib/reader/place-page-worker.ts";
import { queueUnbuiltPlacePages } from "../scripts/prepare-place-pages.mts";
import type { FactDb } from "../lib/facts/publish.ts";
import { factDb } from "./helpers/fact-db.ts";

const source = readFileSync(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");
const { stripTypeScriptTypes } = nodeModule as typeof nodeModule & { stripTypeScriptTypes(source: string): string };
const MIB = 1024 * 1024;
const STATE = "ocd-division/country:us/state:az";

function runnerFunction(name: string): string {
  const fn = source.match(new RegExp(`\\n(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(fn, `pilot-runner.mts has no ${name}()`);
  return fn;
}

const rawPage = (id: string) => ({ division_ids: [id], entities: [], fields: [], rosters: [], comments: [], sittings: [],
  meeting_rows: [], archived_meetings: [], archived_documents: [], parts: {}, registry: null, governments: [], divisions: [] });

/** The runner's own place-page functions over a fixture database; only the turn process is run in this process. */
async function placePageRunner(options: { readonly turnMs: number }) {
  const db = await factDb({ withHourlyCounts: true });
  const wrapped: FactDb = { transaction: run => db.transaction(query => run(async (text, params) => {
    if (text !== PLACE_PACKAGE_SQL) return query(text, params);
    await new Promise(resolve => setTimeout(resolve, 10));
    return [rawPage(String((params?.[1] as string[])[0]))];
  })) };
  const turns: { at: number; deadline: number; ended?: number }[] = [];
  const reservations: string[] = [];
  const log: string[] = [];
  let pause: unknown[] | Error = [];
  let childStatus = 0;
  let onTurn: (index: number) => void = () => {};
  const memory = routineProcessSlots({ availableBytes: () => 64 * 1024 * MIB, admissionsOpen: () => !context.runtimeAdmissionsHeld });
  const context = createContext({
    provider: "postgres", canary: false, AUTO_RELEASE_HANDOFF: false, runtimeAdmissionsHeld: false, placePagePauseUnread: false, admitJobLaunch,
    pendingRestart: new PendingRestart(), standingBeat: async () => {}, researchCycleActive: false, researchCycleChild: null, drainHunterLane: () => {}, drainDoorProbes: () => {},
    TS_CHILD: ["--experimental-strip-types"], CODE_ROOT: process.cwd(), process,
    ownerRepositories: async () => ({}),
    readRunnerPauseIntents: async () => { if (pause instanceof Error) throw pause; return pause; },
    readIntents,
    placePageMemory: { acquire: (entry: string, deadline: number) => { reservations.push(entry); return memory.acquire(entry, deadline); } },
    standingChildEnvironment: (capability: string) => ({ ...process.env, CAPABILITY: capability }),
    withPassDeadline, drainPlacePageQueue, placePageTurnResult, PLACE_PAGE_TURN_GRACE_MS,
    runRuntimeChildren: async (commands: { id: string; args: string[]; env: NodeJS.ProcessEnv }[], run: { deadlineMs: number }) => {
      const [command] = commands;
      assert.equal(command!.id, "place-pages");
      assert.ok(command!.args.includes("scripts/rebuild-place-pages.mts"));
      assert.equal(command!.env.CAPABILITY, "ROUTINE_SUPERVISOR", "the turn writes through the runner's routine write admission");
      const deadline = passDeadlineFromEnv(command!.env);
      assert.equal(run.deadlineMs, deadline + PLACE_PAGE_TURN_GRACE_MS);
      const turn: { at: number; deadline: number; ended?: number } = { at: Date.now(), deadline };
      turns.push(turn);
      onTurn(turns.length);
      if (childStatus) return [{ status: childStatus, stdout: "", errorMessage: null }];
      // The turn process's own work, with its turn shortened so the test sees several.
      const result = await rebuildPlacePageTurn(wrapped, Math.min(deadline, Date.now() + options.turnMs), async () => ({ purged: true }));
      turn.ended = Date.now();
      return [{ status: 0, stdout: `progress\n${PLACE_PAGE_TURN_LINE}${JSON.stringify(result)}\n`, errorMessage: null }];
    },
    console: { log: (line: string) => log.push(line), error: (line: string) => log.push(line) },
    Date,
  });
  runInContext(stripTypeScriptTypes(["jobLaunchAllowed", "placePagesAdmitted", "runPlacePageTurn", "runPlacePages", "holdForRestart",
    "checkReleaseForRestart", "runStandingRuntimeTick"].map(runnerFunction).join("\n")), context);
  context.standingRuntimeScheduler = new IndependentRuntimeLaneScheduler([placePagesLane(context.runPlacePages)],
    outcome => { if (outcome.state === "FAILED") log.push(`FAILED ${outcome.error}`); });
  const queuePlaces = async (from: number, count: number) => {
    for (let n = from; n < from + count; n++)
      await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$1,'AZ')", [`${STATE}/county:c${n}`]);
    return queueUnbuiltPlacePages(db.query);
  };
  const count = async (table: string) => Number((await db.query(`SELECT count(*)::int AS n FROM ${table}`))[0]!.n);
  return { db, context, turns, reservations, log, queuePlaces, count,
    setPause: (value: unknown[] | Error) => { pause = value; },
    setChildStatus: (status: number) => { childStatus = status; },
    onTurn: (hook: (index: number) => void) => { onTurn = hook; } };
}

test("the runner's place-page lane drains queued pages in turns, then waits for the standing clock", async () => {
  const runner = await placePageRunner({ turnMs: 60 });
  try {
    assert.equal(await runner.queuePlaces(0, 16), 16, "the deployment queues every unbuilt place for the runner");
    assert.deepEqual(runInContext(`runStandingRuntimeTick("test", true)`, runner.context), undefined);
    assert.deepEqual(runner.context.standingRuntimeScheduler.inFlightIds(), ["place-pages"]);
    await runner.context.standingRuntimeScheduler.waitForIdle();
    assert.equal(await runner.count("place_page"), 16, "every queued place now has a built page");
    assert.equal(await runner.count("rebuild_queue"), 0);
    assert.ok(runner.turns.length > 1, `the lane kept taking turns while pages were owed (${runner.turns.length})`);
    assert.ok(runner.reservations.length === runner.turns.length && runner.reservations.every(entry => entry === "rebuild-place-pages.mts"));
    assert.ok(runner.log.some(line => /place pages: \d+ rebuilt, 0 failed and still queued, 0 waiting/.test(line)), runner.log.join("\n"));
    const before = runner.turns.length;
    // An empty queue ends the run; the lane's minute interval is the bounded wait before it looks again.
    runInContext(`runStandingRuntimeTick("test")`, runner.context);
    assert.deepEqual(runner.context.standingRuntimeScheduler.inFlightIds(), [], "no new run before its interval");
    runInContext(`runStandingRuntimeTick("test", true)`, runner.context);
    await runner.context.standingRuntimeScheduler.waitForIdle();
    assert.equal(runner.turns.length, before + 1, "an empty queue takes one look and stops");
  } finally { await runner.db.pg.close(); }
});

test("a pending restart stops new place-page turns and waits for no more than the turn in progress", async () => {
  const runner = await placePageRunner({ turnMs: 150 });
  try {
    await runner.queuePlaces(0, 400);
    let heldAt = 0;
    runner.onTurn(index => {
      if (index === 2) setTimeout(() => { heldAt = Date.now(); runInContext(`holdForRestart("${"b".repeat(40)}")`, runner.context); }, 20);
    });
    runInContext(`runStandingRuntimeTick("test", true)`, runner.context);
    await runner.context.standingRuntimeScheduler.waitForIdle();
    const idleAfter = Date.now() - heldAt;
    assert.equal(runner.context.runtimeAdmissionsHeld, true);
    assert.equal(runner.turns.length, 2, "no turn started after the restart became pending");
    assert.ok(runner.turns[1]!.at < heldAt && runner.turns[1]!.ended! >= heldAt, "the hold came during the second turn");
    assert.ok(idleAfter <= 150 + 250, `the lane went idle ${idleAfter}ms after the hold, beyond one turn`);
    assert.ok(runner.log.some(line => /loads by restart: no new standing run starts; place-pages end by their deadlines/.test(line)), runner.log.join("\n"));
    const waiting = await runner.count("rebuild_queue");
    assert.ok(waiting > 0 && await runner.count("place_page") === 400 - waiting, "unbuilt pages stay queued for the restarted runner");
    assert.equal(await runner.count("rebuild_queue WHERE lease_token IS NOT NULL"), 0, "every claimed page finished inside its turn");
    runInContext(`runStandingRuntimeTick("test", true)`, runner.context);
    assert.deepEqual(runner.context.standingRuntimeScheduler.inFlightIds(), [], "the standing clock launches nothing while held");
    await runner.context.runPlacePages(Date.now() + 60_000);
    assert.equal(runner.turns.length, 2, "a run already admitted takes no turn once held");
  } finally { await runner.db.pg.close(); }
});

test("a breaker pause written during a run stops place pages after the turn in progress, until Release", async () => {
  const runner = await placePageRunner({ turnMs: 150 });
  const root = mkdtempSync(join(tmpdir(), "place-pages-breaker-")), path = join(root, "breaker.json"), previous = process.env[JOB_BREAKER_PATH_ENV];
  const snapshot = (mode?: "PAUSED" | "RELEASED") => saveBreakerSnapshot(path, { checkedAt: new Date().toISOString(),
    states: mode ? { "place-pages": { job: "place-pages", mode, at: new Date().toISOString(), hour: new Date().toISOString(), offsetBytes: 0 } } : {} });
  process.env[JOB_BREAKER_PATH_ENV] = path;
  try {
    snapshot();
    await runner.queuePlaces(0, 400);
    let pausedAt = 0;
    runner.onTurn(index => { if (index === 2) setTimeout(() => { pausedAt = Date.now(); snapshot("PAUSED"); }, 20); });
    runInContext(`runStandingRuntimeTick("test", true)`, runner.context);
    await runner.context.standingRuntimeScheduler.waitForIdle();
    assert.equal(runner.turns.length, 2, "no turn starts after the check that paused the job, though the run's hour is not over");
    assert.ok(runner.turns[1]!.at < pausedAt && runner.turns[1]!.ended! >= pausedAt, "the pause came during the second turn");
    assert.ok(runner.log.some(line => /place-pages is paused until released in Admin/.test(line)), runner.log.join("\n"));
    await runner.context.runPlacePages(Date.now() + 60_000);
    assert.equal(runner.turns.length, 2, "a paused job launches nothing on the next run either");
    snapshot("RELEASED");
    await runner.context.runPlacePages(Date.now() + 60_000);
    assert.ok(runner.turns.length > 2, "Release lets the next run take turns again");
  } finally {
    if (previous === undefined) delete process.env[JOB_BREAKER_PATH_ENV]; else process.env[JOB_BREAKER_PATH_ENV] = previous;
    rmSync(root, { recursive: true, force: true });
    await runner.db.pg.close();
  }
});

test("the owner's pause, an unreadable pause and a failed turn leave pages queued without failing the runner", async () => {
  const runner = await placePageRunner({ turnMs: 60 });
  try {
    await runner.queuePlaces(0, 3);
    runner.setPause([{ kind: "INTENT", action: "PAUSE_RUNNER", intentId: "pause-1", requestedAt: "2026-10-26T12:00:00.000Z", note: null }]);
    await runner.context.runPlacePages(Date.now() + 60_000);
    assert.equal(runner.turns.length, 0, "no turn starts while Admin has the runner paused");
    runner.setPause(new Error("control plane unavailable"));
    await runner.context.runPlacePages(Date.now() + 60_000);
    await runner.context.runPlacePages(Date.now() + 60_000);
    assert.equal(runner.turns.length, 0, "no turn starts while the pause cannot be read");
    assert.equal(runner.log.filter(line => /the owner.s pause could not be read \((?:Error: )?control plane unavailable\)/.test(line)).length, 1, "said once");
    runner.setPause([]);
    runner.setChildStatus(1);
    await runner.context.runPlacePages(Date.now() + 60_000);
    assert.equal(runner.turns.length, 1);
    assert.ok(runner.log.some(line => /place pages: turn ended without a result \(.*PLACE_PAGE_TURN_FAILED: 1\); its pages stay queued/.test(line)), runner.log.join("\n"));
    assert.ok(!runner.log.some(line => line.startsWith("FAILED")));
    assert.equal(await runner.count("rebuild_queue"), 3);
    runner.setChildStatus(0);
    await runner.context.runPlacePages(Date.now() + 60_000);
    assert.equal(await runner.count("place_page"), 3, "the next turn builds what the failed turn left");
  } finally { await runner.db.pg.close(); }
});

test("a place-page turn reserves its measured peak on the shared host memory", async () => {
  assert.equal(ROUTINE_ENTRY_PEAK_MIB["rebuild-place-pages.mts"], Math.ceil(835_284_992 / (1024 * 1024) * 1.05));
  const reserve = (availableMiB: number) => routineProcessSlots({ availableBytes: () => availableMiB * MIB })
    .acquire("rebuild-place-pages.mts", Date.now() + 50);
  const release = await reserve(WORKER_MEMORY_HEADROOM_MIB + 837);
  release();
  await assert.rejects(reserve(WORKER_MEMORY_HEADROOM_MIB + 836), /WORKER_MEMORY_DEADLINE/, "a turn waits rather than starving other workers");
});
