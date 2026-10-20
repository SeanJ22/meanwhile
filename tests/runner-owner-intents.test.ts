import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import { CONTROL_WAKE_POLL_MS } from "../scripts/pilot-runtime-control.mts";
import { consolePublisher } from "../scripts/pilot-runtime-publish.mts";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { buildResearchIntent } from "../lib/control-plane/research-view.ts";
import {
  RESEARCH_FORMAT_VERSION,
  RESEARCH_INTENT_LOG_KEY,
  readIntents,
  type ResearchIntentAction,
  type ResearchIntentHonored,
  type ResearchIntentRequest,
} from "../lib/control-plane/scheduler/research-policy.ts";
import {
  describeDispatchMatch,
  parseDispatchTarget,
  unitMatchesTarget,
} from "../lib/control-plane/scheduler/dispatch-target.ts";
import { placeFirstRows } from "../lib/control-plane/scheduler/shadow-loop.ts";

/** Long-running or host-bound scripts are pinned as source text with positive controls; runner-pause-note.mts runs against a throwaway file store. */
const ROOT = process.cwd();
const source = (rel: string): string => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const intent = (action: ResearchIntentAction, at: string, note: string | null = null): ResearchIntentRequest =>
  buildResearchIntent(action, at, "session:test", note, "owner (test)");

const honored = (of: ResearchIntentRequest, at: string, detail = "acknowledged"): ResearchIntentHonored => ({
  formatVersion: RESEARCH_FORMAT_VERSION,
  kind: "HONORED",
  intentId: `${of.intentId}:honored`,
  honors: of.intentId,
  action: of.action,
  honoredAt: at,
  honoredBy: "pilot-runner@test#1",
  detail,
});

function fails(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

test("readIntents: pendingDispatch lists the unhonored DISPATCH intents oldest first and drops the honored ones", () => {
  const later = intent("DISPATCH", "2026-09-04T10:00:00.000Z", "deep dive on Illinois");
  const earlier = intent("DISPATCH", "2026-09-04T09:00:00.000Z", "NH");
  const done = intent("DISPATCH", "2026-09-04T11:00:00.000Z", "Arizona");
  const reading = readIntents([later, done, earlier, honored(done, "2026-09-04T11:05:00.000Z")]);
  assert.deepEqual(
    reading.pendingDispatch.map((i) => i.intentId),
    [earlier.intentId, later.intentId],
    "oldest first, honored excluded",
  );
  assert.deepEqual(
    reading.pendingDispatch.map((i) => i.note),
    ["NH", "deep dive on Illinois"],
    "the owner's words travel on the pending intent",
  );
  assert.equal(reading.pendingRunNow.length, 0);
  assert.equal(reading.runnerPause.paused, false, "a DISPATCH is not a pause");
});

test("readIntents: runnerPause reads paused, then honored, then cleared by RESUME_RUNNER, then paused again", () => {
  const pause = intent("PAUSE_RUNNER", "2026-09-04T10:00:00.000Z", "pnpm pilot:stop on HOST");

  const unacknowledged = readIntents([pause]).runnerPause;
  assert.equal(unacknowledged.paused, true);
  assert.equal(unacknowledged.intent?.intentId, pause.intentId);
  assert.equal(unacknowledged.intent?.note, "pnpm pilot:stop on HOST");
  assert.equal(unacknowledged.honored, null, "the runner has not acknowledged it yet, and the page says so");

  const ack = honored(pause, "2026-09-04T10:01:00.000Z", "idling on the owner's pause; no cycle starts until RESUME_RUNNER");
  const acknowledged = readIntents([pause, ack]).runnerPause;
  assert.equal(acknowledged.paused, true);
  assert.equal(acknowledged.honored?.honors, pause.intentId, "the honored lookup finds the runner's record");
  assert.equal(acknowledged.honored?.detail, ack.detail);

  const resume = intent("RESUME_RUNNER", "2026-09-04T10:30:00.000Z", "pnpm pilot:start on HOST");
  const resumed = readIntents([pause, ack, resume]);
  assert.equal(resumed.runnerPause.paused, false, "RESUME_RUNNER clears the pause");
  assert.equal(resumed.runnerPause.intent, null);
  assert.equal(resumed.runnerPause.honored, null);
  assert.equal(resumed.pendingRunNow.length, 0, "a resume is not a RUN_CYCLE_NOW");
  assert.equal(resumed.pendingDispatch.length, 0);

  const again = intent("PAUSE_RUNNER", "2026-09-04T11:00:00.000Z", "maintenance");
  const repaused = readIntents([pause, ack, resume, again]).runnerPause;
  assert.equal(repaused.paused, true);
  assert.equal(repaused.intent?.intentId, again.intentId, "the LATEST pause/resume decides");
  assert.equal(repaused.honored, null, "the new pause has its own acknowledgement to earn");

  /* The research-lane PAUSE and the runner pause are different statements. */
  const lane = readIntents([intent("PAUSE", "2026-09-04T12:00:00.000Z")]);
  assert.equal(lane.paused, true);
  assert.equal(lane.runnerPause.paused, false, "a research-lane PAUSE never pauses the runner");
});

test("parseDispatchTarget reads the owner's words into state codes and terms", () => {
  const illinois = parseDispatchTarget("deep dive on Illinois");
  assert.deepEqual(illinois.states, ["il"]);
  assert.deepEqual(illinois.stateNames, ["Illinois"]);
  assert.deepEqual(illinois.terms, [], "deep / dive / on carry no target");

  assert.deepEqual(parseDispatchTarget("NH").states, ["nh"], "an upper-case two-letter code is a state");

  const arizona = parseDispatchTarget("in Arizona");
  assert.deepEqual(arizona.states, ["az"], "'in' is a preposition here, never Indiana");
  assert.deepEqual(arizona.terms, []);

  const pima = parseDispatchTarget("Pima County campaign finance");
  assert.deepEqual(pima.states, [], "no state named");
  for (const term of ["pima", "campaign", "finance"]) assert.ok(pima.terms.includes(term), `terms carry ${term}`);
  assert.ok(!pima.terms.includes("county"), "'county' is filler");

  const both = parseDispatchTarget("Arizona and New Hampshire");
  assert.deepEqual([...both.states].sort(), ["az", "nh"], "both states, whichever was seen first");
  assert.deepEqual([...both.stateNames].sort(), ["Arizona", "New Hampshire"]);
  assert.deepEqual(both.terms, [], "'and' is filler");
});

test("unitMatchesTarget matches state codes as bounded tokens in every id shape, and terms as words", () => {
  const unit = (id: string, subjectId = "") => ({ id, subjectId });
  const arizona = parseDispatchTarget("Arizona");
  assert.equal(unitMatchesTarget(arizona, unit("az-sos-cfs-bulk-ftp", "ocd-division/country:us/state:az")), true);
  assert.equal(unitMatchesTarget(arizona, unit("AZ_SEETHEMONEY_PLAIN_FETCH", "ocd-division/country:us/state:az")), true);
  assert.equal(unitMatchesTarget(arizona, unit("ocd-division/country:us/state:az/county:pima", "ocd-division/country:us/state:az/county:pima")), true);
  assert.equal(unitMatchesTarget(arizona, unit("nh-cfs-transaction-detail", "ocd-division/country:us/state:nh")), false);

  const illinois = parseDispatchTarget("deep dive on Illinois");
  assert.equal(unitMatchesTarget(illinois, unit("nh-cfs-transaction-detail", "ocd-division/country:us/state:nh")), false, "il matches nothing registered for nh");
  assert.equal(unitMatchesTarget(illinois, unit("az-sos-cfs-bulk-ftp", "ocd-division/country:us/state:az")), false);

  const indiana = parseDispatchTarget("IN");
  assert.deepEqual(indiana.states, ["in"]);
  assert.equal(
    unitMatchesTarget(indiana, unit("nh-cfs-transaction-detail", "ocd-division/country:us/state:nh")),
    false,
    "'in' inside 'transaction' is not a state token",
  );

  const pima = parseDispatchTarget("Pima County campaign finance");
  assert.equal(unitMatchesTarget(pima, unit("ocd-division/country:us/state:az/county:pima")), true, "the term pima matches");
  assert.equal(unitMatchesTarget(pima, unit("AZ_CAMPAIGN_FINANCE_BULK")), true, "the term campaign matches");
  assert.equal(unitMatchesTarget(pima, unit("nh-cfs-transaction-detail", "ocd-division/country:us/state:nh")), false);

  const scoped = parseDispatchTarget("Arizona campaign finance");
  assert.equal(unitMatchesTarget(scoped, unit("AZ_CAMPAIGN_FINANCE_BULK")), true, "state and a term");
  assert.equal(unitMatchesTarget(scoped, unit("az-sos-cfs-bulk-ftp", "ocd-division/country:us/state:az")), false, "state but no term");
  assert.equal(unitMatchesTarget(scoped, unit("NH_CAMPAIGN_FINANCE_BULK", "ocd-division/country:us/state:nh")), false, "term but the wrong state");
});

test("describeDispatchMatch names the missing registry, the registry failure, and the placement — with the denominator", () => {
  const REGISTERED_STATES = ["az", "nh", "nj"];

  const illinois = describeDispatchMatch(parseDispatchTarget("deep dive on Illinois"), 0, 120, REGISTERED_STATES);
  assert.match(illinois, /matched 0 of 120 registered units/);
  assert.match(illinois, /Illinois is not enumerated yet: no jurisdiction registry exists for it/);
  assert.match(illinois, /goes to you as a row, never a button/);

  const nothing = describeDispatchMatch(parseDispatchTarget("Arizona"), 0, 0, REGISTERED_STATES);
  assert.match(nothing, /registry failure, not an idle fleet/);

  const words = describeDispatchMatch(parseDispatchTarget("Pima County campaign finance"), 0, 120, REGISTERED_STATES);
  assert.match(words, /matched 0 of 120 registered units\. Nothing registered carries those words\./);

  const placed = describeDispatchMatch(parseDispatchTarget("Arizona"), 4, 120, REGISTERED_STATES);
  assert.match(placed, /matched 4 of 120 registered units for Arizona; they were placed first in both lanes this cycle/);
});

test("placeFirstRows moves the dispatched rows to the front, keeps both groups' order, and is a no-op with nothing dispatched", () => {
  const row = (id: string) => ({ obligation: { id }, nextDueAt: id });
  const rows = [row("a"), row("b"), row("c"), row("d")];
  assert.deepEqual(
    placeFirstRows(rows, new Set(["c", "a"])).map((r) => r.obligation.id),
    ["a", "c", "b", "d"],
    "dispatched first, in their original relative order; the rest untouched",
  );
  assert.equal(placeFirstRows(rows, new Set()), rows, "an empty set returns the rows as they were");
  assert.equal(placeFirstRows(rows, undefined), rows);
  assert.deepEqual(
    placeFirstRows(rows, new Set(["zzz"])).map((r) => r.obligation.id),
    ["a", "b", "c", "d"],
    "a dispatch that matches nothing due changes nothing — it never adds a row",
  );
});

function checkRunnerPublishesConsole(src: string): void {
  const list = src.match(/const CONSOLE_PUBLISHERS[^\n]*\n[\s\S]*?\n\];/);
  assert.ok(list, "pilot-runner.mts names no CONSOLE_PUBLISHERS list");
  const snapshot = list[0].indexOf("scripts/publish-owner-snapshot.mts");
  assert.ok(snapshot >= 0, "publishConsole does not run publish-owner-snapshot.mts");

  const fn = src.match(/async function publishConsole\(\): Promise<void> \{[\s\S]*?\n\}/);
  assert.ok(fn, "pilot-runner.mts has no publishConsole()");
  assert.match(fn[0], /await publishChangedConsole\(\)/, "publishConsole does not check changed inputs");
  assert.match(src, /publish: publishConsoleChildren/, "changed inputs do not reach the publishers");
  const children = src.match(/async function publishConsoleChildren\(\): Promise<boolean> \{[\s\S]*?\n\}/);
  assert.ok(children, "pilot-runner.mts has no console publisher children");
  const body = children[0];
  assert.match(body, /for \(const publisher of CONSOLE_PUBLISHERS\)/, "changed inputs do not run every listed publisher");
  assert.match(body, /await runRuntimeChildren\(/, "each publisher is an asynchronous child process");
  assert.match(body, /args: \[\.\.\.TS_CHILD, \.\.\.publisher\.args\]/, "a publisher does not start the way every runner child starts");
  assert.doesNotMatch(src, /--env-file=\.env\.local/, "a standing child reopens cwd-relative environment state instead of inheriting the validated parent environment");
  assert.match(body, /env: process\.env/, "the child does not inherit the validated parent environment");
  assert.match(body, /console publish: \$\{publisher\.name\} OK/, "no OK line");
  assert.match(body, /console publish: \$\{publisher\.name\} FAILED exit/, "no FAILED line");
  assert.doesNotMatch(body, /\bthrow\b/, "a publish failure is printed, never thrown");

  const call = src.indexOf("\n  await publishConsole();");
  assert.ok(call >= 0, "the loop never calls publishConsole()");
  const delivered = src.indexOf("const delivered = deliver(");
  const sleep = src.indexOf("await sleepUnlessRunNow(", call);
  assert.ok(delivered >= 0 && sleep >= 0, "the loop's delivery and sleep anchors moved");
  assert.ok(call > delivered, "publishConsole() runs BEFORE the digest is delivered");
  assert.ok(call < sleep, "publishConsole() runs after the inter-cycle sleep, not after the digest");
  assert.ok(call > src.indexOf("console.log(`  ${headline}`)"), "publishConsole() runs before the headline log");
}

function checkRunnerHonorsOwnerIntents(src: string): void {
  const says = src.match(/async function ownerSays\(\): Promise<OwnerSays> \{[\s\S]*?\n\}/);
  assert.ok(says, "pilot-runner.mts has no ownerSays()");
  const body = says[0];
  assert.match(body, /readIntents\(log\)/, "ownerSays does not read the intent log through readIntents");
  assert.equal((body.match(/readRunnerControls\(repos\)/g) ?? []).length, 1, "ownerSays must use the changed-control cache");
  assert.match(body, /\.runnerPause\b/, "ownerSays never looks at runnerPause");
  assert.match(body, /\.pendingRunNow\.length > 0/, "a pending RUN_CYCLE_NOW no longer ends the sleep");
  assert.match(body, /\.pendingDispatch\.length > 0/, "a pending DISPATCH does not end the sleep early");
  assert.match(body, /return "HOLD"/, "a standing pause does not hold the cycle");
  assert.match(body, /idling on the owner's pause; no cycle starts until RESUME_RUNNER/, "the pause's HONORED detail is missing");
  assert.match(body, /resumed; next cycle starts now/, "the resume's HONORED detail is missing");
  assert.match(body, /runner paused by owner since \$\{pause\.intent\.requestedAt\}: /, "the pause is not printed with its reason");

  const beat = src.match(/async function beatWhilePaused\([\s\S]*?\n\}/);
  assert.ok(beat, "no beatWhilePaused()");
  assert.match(beat[0], /pause: \{ intentId: intent\.intentId, since: intent\.requestedAt, note: intent\.note \}/, "the paused beat does not carry the pause");
  assert.match(beat[0], /runnerHeartbeat\.put\(RUNNER_ID/, "no create path for a first beat");
  assert.match(beat[0], /runnerHeartbeat\.compareAndSet\(RUNNER_ID, current\.revision/, "an existing beat is not moved by compareAndSet");
  assert.match(beat[0], /\.\.\.base,\s*beatAt: now/, "the paused beat does not keep the last beat's fields");
  assert.match(src, /const PAUSE_BEAT_MS = 30 \* 60_000/, "the paused beat cadence is not thirty minutes");
  assert.match(src, /const POLL_MS = 60_000/, "the poll is no longer once a minute");

  const honor = src.match(/async function honorRunnerIntent\([\s\S]*?\n\}/);
  assert.ok(honor, "no honorRunnerIntent()");
  assert.match(honor[0], /kind: "HONORED"/);
  assert.match(honor[0], /intentId: id,\s*honors: intent\.intentId/);
  assert.match(honor[0], /honoredBy: `pilot-runner@\$\{hostname\(\)\}#\$\{process\.pid\}`/, "honoredBy does not name pilot-runner@host#pid");

  assert.match(src, /new IndependentRuntimeLaneScheduler\(\[[\s\S]*run: runRoutineCivicData[\s\S]*run: runIntakeRuntime/, "the two permanent runtime lanes are not independently scheduled");
  assert.match(src, /function startStandingRuntimeClock\(\)[\s\S]*standingRuntimeTimer = setInterval\([\s\S]*runStandingRuntimeTick\("independent standing clock"\)/, "the runtime clock is not independently startable");
  assert.ok(src.indexOf("startStandingRuntimeClock();") < src.indexOf("while (cycle < CYCLES)"), "the runtime clock starts after research");
  assert.match(src, /if \(runtimeAdmissionsHeld\) return;/, "a release hold cannot close runtime admission");
  assert.match(src, /await standingRuntimeScheduler\.waitForIdle\(\)/, "release handoff does not wait for independently running source lanes");
  assert.match(src, /const AUTO_RELEASE_HANDOFF = !STAGING && argv\.includes\("--release-handoff"\)/, "developer checkouts cannot be distinguished from the installed runtime checkout");
  assert.doesNotMatch(src, /--installed-sha=/, "runner still relies on an immutable installed SHA instead of automatic release handoff");
  assert.match(src, /await holdWhilePaused\(\);[\s\S]*cycle \+= 1;/, "the owner pause no longer holds research cycles");
  const hold = src.match(/async function holdWhilePaused\(\): Promise<\{ readonly ownerIntentsUnreadable: boolean \}> \{[\s\S]*?\n\}/);
  assert.ok(hold, "pilot-runner.mts has no holdWhilePaused()");
  assert.doesNotMatch(hold[0], /runStandingRuntimeTick/, "a research pause must not own or stop the independent runtime clock");
  assert.match(src, /const says = await ownerSays\(\);\s*if \(says === "START_NOW"\) return;/, "the sleep does not end on the owner's word");
  const sleepLoop = src.match(/async function sleepUnlessRunNow\(totalMs: number\): Promise<void> \{[\s\S]*?\n\}/);
  assert.ok(sleepLoop, "pilot-runner.mts has no sleepUnlessRunNow()");
  assert.match(sleepLoop[0], /if \(says === "HOLD"\) continue;/, "the owner's PAUSE_RUNNER does not hold between cycles");
}

test("pilot-runner.mts checks console publication after every digest (ADM-1)", async () => {
  checkRunnerPublishesConsole(source("scripts/pilot-runner.mts"));
  let signature = "first", readsFail = false, succeeds = true, calls = 0;
  let duringPublish: (() => void) | null = null;
  const publish = consolePublisher({
    readInputs: async () => { if (readsFail) throw new Error("offline"); return signature; },
    publish: async () => { calls++; duringPublish?.(); return succeeds; },
  });
  assert.equal(await publish(), "PUBLISHED");
  for (let i = 0; i < 100; i++) assert.equal(await publish(), "UNCHANGED");
  assert.equal(calls, 1);
  signature = "changed";
  assert.equal(await publish(), "PUBLISHED", "changed inputs run the publishers");
  assert.equal(calls, 2);
  readsFail = true;
  assert.equal(await publish(), "PUBLISHED", "a failed input check is never unchanged");
  readsFail = false;
  assert.equal(await publish(), "PUBLISHED", "a failed input read cannot remember success");
  signature = "failed";
  succeeds = false;
  assert.equal(await publish(), "FAILED");
  signature = "changed"; // A partial failed write invalidated even the older success.
  succeeds = true;
  assert.equal(await publish(), "PUBLISHED");
  signature = "before";
  duringPublish = () => { signature = "after"; };
  assert.equal(await publish(), "PUBLISHED");
  duringPublish = null;
  assert.equal(await publish(), "PUBLISHED", "a commit during the children stays eligible");
  assert.equal(await publish(), "UNCHANGED");
});

test("pilot-runner.mts honors PAUSE_RUNNER / RESUME_RUNNER and ends the sleep on a pending DISPATCH (ADM-5, ADM-8)", async () => {
  const src = source("scripts/pilot-runner.mts");
  checkRunnerHonorsOwnerIntents(src);
  const clock = src.match(/function startStandingRuntimeClock\(\): void \{[\s\S]*?\n\}/)?.[0];
  assert.ok(clock);
  let tick: (() => void) | null = null;
  let finishRead: (value: string) => void = () => { throw new Error("read not started"); };
  let reads = 0;
  const context = createContext({
    runtimeAdmissionsHeld: false, standingRuntimeTimer: null, ownerControlTimer: null, researchCycleActive: false,
    canary: false, activeControlRead: null, ownerWakePending: false, POLL_MS: 60_000, CONTROL_WAKE_POLL_MS,
    runStandingRuntimeTick: () => {}, startScheduledOrderClock: () => {}, console,
    provider: "postgres", STAGING: false, auditPasses: { start: () => {} },
    setInterval: (callback: () => void) => { tick = callback; return 1; },
    ownerSays: () => { reads++; return new Promise<string>(resolve => { finishRead = resolve; }); },
  });
  runInContext(clock.replace("(): void", "()") + "\nstartStandingRuntimeClock();", context);
  assert.ok(tick);
  const advance = tick as () => void;
  advance();
  assert.equal(reads, 0, "idle polling remains with the existing sleep path");
  context.researchCycleActive = true;
  advance(); advance();
  assert.equal(reads, 1, "a long active cycle reads controls without overlapping reads");
  finishRead("START_NOW");
  await context.activeControlRead;
  assert.equal(context.ownerWakePending, true, "the wake survives the active child finishing");
  assert.equal(context.activeControlRead, null);
});

test("POSITIVE CONTROL: a runner that drops the publish call or the dispatch check fails its checker", () => {
  const src = source("scripts/pilot-runner.mts");

  const noCall = src.replace("\n  await publishConsole();", "\n  /* not published */");
  assert.notEqual(noCall, src, "the mutation did not apply; the test would prove nothing");
  assert.ok(fails(() => checkRunnerPublishesConsole(noCall)), "a loop that never publishes passed");

  const noDispatch = src.replace("reading.pendingDispatch.length > 0", "false");
  assert.notEqual(noDispatch, src);
  assert.ok(fails(() => checkRunnerHonorsOwnerIntents(noDispatch)), "a runner blind to DISPATCH passed");

  const noHold = src.replace("const owner = await holdWhilePaused();", "const owner = { ownerIntentsUnreadable: false };");
  assert.notEqual(noHold, src);
  assert.ok(fails(() => checkRunnerHonorsOwnerIntents(noHold)), "a runner that cycles through a pause passed");

  const sleepThroughPause = src.replace('\n    if (says === "HOLD") continue;', "");
  assert.notEqual(sleepThroughPause, src);
  assert.ok(fails(() => checkRunnerHonorsOwnerIntents(sleepThroughPause)), "a runner whose sleep runs through a pause passed");

  const starvedRuntime = src.replace('{ id: "intake-runtime", everyMs: INTAKE_RUNTIME_TICK_MS, budgetMs: INTAKE_RUNTIME_BUDGET_MS, run: runIntakeRuntime },\n', "");
  assert.notEqual(starvedRuntime, src);
  assert.ok(fails(() => checkRunnerHonorsOwnerIntents(starvedRuntime)), "a standing clock missing an independent lane passed");
});

function checkCycleHonorsDispatch(src: string): void {
  assert.match(src, /for \(const pending of intents\.pendingDispatch\)/, "the cycle never walks pendingDispatch");
  assert.match(src, /parseDispatchTarget\(pending\.note \?\? ""\)/, "the target is not parsed from the owner's note");
  assert.match(src, /allUnits\.filter\(\(u\) =>\s*unitMatchesTarget\(target, \{ id: u\.obligation\.id, subjectId: u\.obligation\.subjectId \}\)/, "matching does not run over the whole registered universe");
  assert.match(src, /describeDispatchMatch\(target, matched\.length, allUnits\.length, trackedStateCodes\)/, "the HONORED detail is not the shared sentence, over the tracked states read as data");
  assert.match(src, /honorIntent\(intent, work === null \? detail : `\$\{detail\} \$\{dispatchWorkSentence\(work\)\}`\)/, "the HONORED detail does not carry what the dispatch created");
  assert.ok(src.indexOf("await applyDispatchWork(") < src.indexOf("honorIntent(intent, work === null"), "a DISPATCH is honored before its missing work is created");
  assert.match(src, /plannerOrder\("due-dispatch-order", dueThisCycle, row => dispatchPriority\.has\(row\.obligation\.id\) \? 0 : 1\)/, "the deterministic lane is not reordered behind the dispatch");
  assert.match(src, /plannerOrder\("scout-dispatch-order", modelOrder\.ordered, row => dispatchPriority\.has\(row\.row\.id\) \? 0 : 1\)/, "the Scout lane is not reordered behind the dispatch");
  assert.match(src, /placeFirst: dispatchPriority,/, "the dispatcher itself is not told to place the dispatch first");
  assert.match(src, /owner dispatch: \$\{detail\}/, "the dispatch line is not printed");
  assert.match(src, /ownerDispatch: ownerDispatches\.at\(-1\) \?\? null/, "the research state does not carry ownerDispatch");

  const read = src.indexOf("const intents = readIntents(intentLog);");
  const sort = src.indexOf("let dueOrdered = ");
  const bands = src.indexOf("orderByReaderImpact(");
  assert.ok(read >= 0 && sort >= 0 && bands >= 0, "an anchor moved");
  assert.ok(read < sort, "the intent log is read AFTER the deterministic sort, so a dispatch cannot reorder it");
  assert.ok(sort < bands, "the reader-impact bands come before the deterministic order");

  assert.match(src, /pendingResearchLaneAcknowledgment\(/, "lane PAUSE and RESUME acknowledgments use the shared owner-intent boundary");
  assert.match(src, /pause: null,/, "the working heartbeat does not say it is not paused");
}

test("freshness-shadow.mts honors DISPATCH before ordering both lanes and acknowledges the lane PAUSE / RESUME", () => {
  checkCycleHonorsDispatch(source("scripts/freshness-shadow.mts"));
  const loop = source("lib/control-plane/scheduler/shadow-loop.ts");
  assert.match(source("lib/control-plane/scheduler/streamed-cycle.ts"), /workset\.add\(row,input\.placeFirst\?\.has\(obligation\.id\)\?\?false,nowMs\)/, "runCycle does not apply placeFirst to its own disk due order");
  assert.match(loop, /readonly placeFirst\?: ReadonlySet<string>;/, "CycleInput has no optional placeFirst");
});

test("POSITIVE CONTROL: a cycle that reads intents after the sort, or drops the dispatcher's placeFirst, fails the checker", () => {
  const src = source("scripts/freshness-shadow.mts");
  const noPlace = src.replace("placeFirst: dispatchPriority,", "");
  assert.notEqual(noPlace, src);
  assert.ok(fails(() => checkCycleHonorsDispatch(noPlace)), "a cycle whose dispatcher ignores the dispatch passed");

  const late = src.replace("const intents = readIntents(intentLog);", "").replace("let dueModel = ", "const intents = readIntents(intentLog);\nlet dueModel = ");
  assert.notEqual(late, src);
  assert.ok(fails(() => checkCycleHonorsDispatch(late)), "a cycle that reads intents after the sort passed");
});

function runNote(args: readonly string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const run = spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(ROOT, "scripts", "runner-pause-note.mts"), ...args],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      /* No deployed plane can be reached from here: the variable is blank, which the reader treats as unset. */
      env: { ...process.env, WTP_CONTROL_PLANE_DATABASE_URL: "" },
    },
  );
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

test("runner-pause-note.mts appends PAUSE_RUNNER then RESUME_RUNNER to a file store, naming the command and the host", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wtp-pause-note-"));
  try {
    const paused = runNote(["--action=PAUSE_RUNNER", "--note=pnpm pilot:stop on TESTHOST", "--by=pilot:stop", `--file-store=${dir}`]);
    assert.equal(paused.status, 0, `pause note exited ${paused.status}: ${paused.stdout}${paused.stderr}`);
    assert.match(paused.stdout, /pause note recorded: PAUSE_RUNNER:/, "the intent id is not printed");

    const repos = await createFileRepositories(dir);
    const afterPause = await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY);
    assert.equal(afterPause.length, 1, "exactly one record was appended");
    const record = afterPause[0];
    assert.equal(record.kind, "INTENT");
    if (record.kind !== "INTENT") return;
    assert.equal(record.action, "PAUSE_RUNNER");
    assert.equal(record.note, "pnpm pilot:stop on TESTHOST");
    assert.equal(record.actor, `pilot:stop on ${hostname()}`, "--by names the calling command, on this host");
    assert.equal(record.adminSessionRef, `host:${hostname()}`);
    assert.equal(record.intentId, `PAUSE_RUNNER:${record.requestedAt}`);
    const pausedReading = readIntents(afterPause).runnerPause;
    assert.equal(pausedReading.paused, true, "the runner reads the stop as a pause");
    assert.equal(pausedReading.honored, null, "no runner has acknowledged it — and none ran here");

    const resumed = runNote(["--action=RESUME_RUNNER", "--note=pnpm pilot:start on TESTHOST", "--by=pilot:start", `--file-store=${dir}`]);
    assert.equal(resumed.status, 0, `resume note exited ${resumed.status}: ${resumed.stdout}${resumed.stderr}`);
    assert.match(resumed.stdout, /resume note recorded: RESUME_RUNNER:/);
    const afterResume = await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY);
    assert.equal(afterResume.length, 2);
    assert.equal(readIntents(afterResume).runnerPause.paused, false, "RESUME_RUNNER lifts the pause");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runner-pause-note.mts exits 2 on a bad action, and never blocks when the plane cannot be opened", () => {
  const bad = runNote(["--action=NOPE", "--note=x"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /PAUSE_RUNNER or RESUME_RUNNER/);

  const unopened = runNote(["--action=PAUSE_RUNNER", "--note=pnpm pilot:stop on TESTHOST"]);
  assert.equal(unopened.status, 0, "a note that cannot land must not fail the stop");
  assert.match(
    unopened.stdout,
    /pause note NOT recorded: PERMANENT_RUNTIME_AUTHORITY_REFUSED:authority envelope is absent or malformed/,
  );
});
