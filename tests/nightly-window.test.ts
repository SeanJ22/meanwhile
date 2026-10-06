/**
 * THE NIGHTLY WINDOW'S DECISIONS AND ITS SEEDED FAILURES. (RULING 242.)
 *
 *   the research window cannot write a reader-truth path — structurally, the
 *   module has no promoter, Git writer, deploy door, or Reader-content writer
 *   the lock refuses a second window; a missed window is caught up by name;
 *   a stage failure opens an incident; the digest states it
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { ACTIVATION_GATE, readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { deriveItemState } from "../lib/control-plane/promotion/pipeline.ts";
import {
  CATCH_UP_GRACE_MS,
  WINDOW_LEASE_ID,
  WindowLockHeld,
  acquireWindowLease,
  buildWindowDigest,
  evaluateItems,
  lastWindowLocalDate,
  localDateOf,
  openIncident,
  releaseWindowLease,
  windowDue,
  windowHeadline,
  withNightlyWindowLease,
  zonedInstant,
} from "../lib/control-plane/promotion/window.ts";
import {
  PROMOTION_PIPELINE_FORMAT_VERSION,
  WINDOW_FORMAT_VERSION,
  type ApprovedRecord,
  type PipelineItemState,
  type ScoutedRecord,
  type WindowRunRecord,
} from "../lib/control-plane/promotion/types.ts";
import { buildWindowView, countClaimsOf, readLastWindow, readWindowIncidents, renderedNumbersOf } from "../lib/control-plane/window-view.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered } from "../lib/control-plane/owner-surface.ts";

const ROOT = process.cwd();

/* ------------------------------------------------------------- the clock */

test("04:00 America/New_York is computed in the zone, so DST is the zone's business", () => {
  assert.equal(zonedInstant("2026-07-15", 4), "2026-07-15T08:00:00.000Z", "EDT: 04:00 is 08:00Z");
  assert.equal(zonedInstant("2026-01-15", 4), "2026-01-15T09:00:00.000Z", "EST: 04:00 is 09:00Z");
  assert.equal(localDateOf("2026-09-03T03:59:00.000Z"), "2026-09-02", "23:59 New York is still the 2nd");
  assert.equal(localDateOf("2026-09-03T04:00:00.000Z"), "2026-09-03");
});

test("the window is due once per local date, and a missed date is caught up BY NAME", () => {
  const before = windowDue({ nowIso: "2026-09-02T07:59:00.000Z", lastWindowLocalDate: "2026-09-01" });
  assert.equal(before.due, false, "03:59 New York on the 2nd: the 2nd's boundary has not passed and the 1st ran");
  const at = windowDue({ nowIso: "2026-09-02T08:00:30.000Z", lastWindowLocalDate: "2026-09-01" });
  assert.equal(at.due, true);
  assert.equal(at.localDate, "2026-09-02");
  assert.equal(at.trigger, "RUNNER_CLOCK");
  assert.deepEqual(at.caughtUp, []);
  const missed = windowDue({ nowIso: "2026-09-05T15:00:00.000Z", lastWindowLocalDate: "2026-09-01" });
  assert.equal(missed.due, true);
  assert.equal(missed.localDate, "2026-09-05");
  assert.deepEqual(missed.caughtUp, ["2026-09-02", "2026-09-03", "2026-09-04"], "every unanswered date, oldest first");
  assert.equal(missed.trigger, "CATCH_UP");
  const late = windowDue({ nowIso: new Date(Date.parse("2026-09-02T08:00:00.000Z") + CATCH_UP_GRACE_MS + 1).toISOString(), lastWindowLocalDate: "2026-09-01" });
  assert.equal(late.trigger, "CATCH_UP", "an hour past the boundary is a catch-up, by name");
  const never = windowDue({ nowIso: "2026-09-05T15:00:00.000Z", lastWindowLocalDate: null });
  assert.deepEqual(never.caughtUp, [], "no prior state is not permission to invent missed dates");
  assert.equal(windowDue({ nowIso: "2026-09-02T12:00:00.000Z", lastWindowLocalDate: "2026-09-02" }).due, false);
});

test("the Sunday-morning window runs and is caught up like every other day", () => {
  const during = windowDue({ nowIso: "2026-09-06T09:00:00.000Z", lastWindowLocalDate: "2026-09-05" });
  assert.equal(during.due, true);
  assert.doesNotMatch(during.reason, /SCHEDULED BLACKOUT/);

  const monday = windowDue({ nowIso: "2026-09-07T15:00:00.000Z", lastWindowLocalDate: "2026-09-05" });
  assert.equal(monday.due, true);
  assert.deepEqual(monday.caughtUp, ["2026-09-06"]);
});

/* -------------------------------------------------------------- the lock */

test("the lease refuses a second window, and a released or expired lease can be re-claimed", async () => {
  const repos = createMemoryRepositories();
  const first = await acquireWindowLease(repos, "window-a", "2026-09-02T08:00:00.000Z", 60_000);
  assert.equal(first.lease.holder, "window-a");
  await assert.rejects(() => acquireWindowLease(repos, "window-b", "2026-09-02T08:00:10.000Z", 60_000), (e: unknown) => e instanceof WindowLockHeld);
  assert.equal(await releaseWindowLease(repos, "window-b", "2026-09-02T08:00:11.000Z"), false, "only the holder releases");
  assert.equal(await releaseWindowLease(repos, "window-a", "2026-09-02T08:00:12.000Z"), true);
  const second = await acquireWindowLease(repos, "window-b", "2026-09-02T08:00:13.000Z", 60_000);
  assert.equal(second.lease.holder, "window-b");
  const expired = await acquireWindowLease(repos, "window-c", "2026-09-02T09:00:00.000Z", 60_000);
  assert.equal(expired.lease.holder, "window-c", "a dead holder holds nothing past the TTL");
  const held = await repos.leases.read(WINDOW_LEASE_ID);
  assert.equal(held?.value.holder, "window-c");
});

test("withNightlyWindowLease releases in a finally and refuses while held", async () => {
  const repos = createMemoryRepositories();
  let t = 0;
  const now = (): string => new Date(Date.parse("2026-09-02T08:00:00.000Z") + t++ * 1000).toISOString();
  await withNightlyWindowLease(repos, "cycle", now, async (facts) => {
    assert.equal(facts.holder, "cycle");
    await assert.rejects(() => withNightlyWindowLease(repos, "window", now, async () => "never"), (e: unknown) => e instanceof WindowLockHeld);
  });
  const after = await repos.leases.read(WINDOW_LEASE_ID);
  assert.equal(after?.value.released, true);
  await assert.rejects(() => withNightlyWindowLease(repos, "window", now, async () => { throw new Error("boom"); }), /boom/);
  assert.equal((await repos.leases.read(WINDOW_LEASE_ID))?.value.released, true, "released even when fn throws");
});

/* ------------------------------------------------------------ evaluation */

function scoutedItem(itemId: string, recordClass: string): ScoutedRecord {
  return {
    formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION,
    recordId: `${itemId}:scouted`,
    itemId,
    at: "2026-09-02T00:00:00.000Z",
    actor: { role: "SCOUT", lane: "BOUNDED_MODEL_WORKER", instance: "at-1" },
    stage: "SCOUTED",
    source: { kind: "SCOUT_RESULT", attemptId: "at-1", obligationId: "ob", outcome: "ROUTE_CANDIDATE", routeId: "r" },
    recordClass,
    subjectId: "s",
    canonicalUrl: "https://example.gov/x",
    artifactIds: [],
    scoutAttemptId: "at-1",
    summary: "s",
  };
}

/** An APPROVED state assembled directly: the evaluation is over STATE, whatever produced it. */
function approvedState(itemId: string, recordClass: string): PipelineItemState {
  const s = scoutedItem(itemId, recordClass);
  const a: ApprovedRecord = {
    formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION,
    recordId: `${itemId}:approved`,
    itemId,
    at: s.at,
    actor: { role: "RELEASE_ORCHESTRATOR", lane: "SESSION", instance: "w" },
    stage: "APPROVED_FOR_PROMOTION",
    chain: { scouted: s.recordId, confirmed: "c", verified: "v", audited: "a" },
    recordClass,
  };
  return { ...deriveItemState(itemId, [s]), stage: "APPROVED_FOR_PROMOTION", byStage: { SCOUTED: s, APPROVED_FOR_PROMOTION: a } };
}

test("CP-14: verified approvals ignore obsolete class gates; unfinished items and execution deferrals remain explicit", () => {
  const states = [
    deriveItemState("pp-s", [scoutedItem("pp-s", "meetings")]),
    approvedState("pp-a-closed", "campaign-finance"),
    approvedState("pp-a-open", "meetings"),
  ];
  const closed = evaluateItems(states, { openRecordClasses: [] });
  assert.deepEqual(closed.verdicts.map((v) => v.verdict), ["REFUSE_WOULD", "PROMOTE_WOULD", "PROMOTE_WOULD"]);
  assert.match(closed.verdicts[0].reason, /at SCOUTED; APPROVED_FOR_PROMOTION is required/);
  assert.match(closed.verdicts[2].reason, /approved for its reader door/);
  const open = evaluateItems(states, { openRecordClasses: ["meetings"] });
  assert.deepEqual(open.verdicts.map((v) => v.verdict), ["REFUSE_WOULD", "PROMOTE_WOULD", "PROMOTE_WOULD"]);
  const meetings = open.byRecordClass.find((t) => t.recordClass === "meetings");
  assert.deepEqual(meetings, { recordClass: "meetings", items: 2, promoteWould: 1, refuseWould: 1, deferred: 0 });
  const deferred = evaluateItems(states, { openRecordClasses: ["meetings"] }, "the research input was unavailable");
  assert.ok(deferred.verdicts.every((v) => v.verdict === "DEFER"));
});

test("SEEDED (a, structural): the window module has no writer for any reader-content path", () => {
  const sources = ["lib/control-plane/promotion/window.ts", "lib/control-plane/promotion/pipeline.ts", "lib/control-plane/promotion/mapping.ts", "lib/control-plane/promotion/activation-gate.ts"];
  for (const file of sources) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const path of ["data/ballot", "data/meetings-snapshot", "data/funding", "data/fec", "data/votes", "data/dotgov", "data/questionnaire"]) {
      assert.equal(text.includes(path), false, `${file} names reader-content path ${path}`);
    }
    if (file.endsWith("window.ts") || file.endsWith("pipeline.ts")) {
      assert.equal(/writeFileSync|appendFileSync|writeFile\(/.test(text), false, `${file} holds a file writer`);
    }
  }
  const script = readFileSync(join(ROOT, "scripts/nightly-window.mts"), "utf8");
  for (const path of ["data/ballot", "data/meetings-snapshot", "data/funding", "data/fec", "data/votes", "data/dotgov", "data/questionnaire"]) {
    assert.equal(script.includes(path), false, `scripts/nightly-window.mts names reader-content path ${path}`);
  }
  assert.match(script, /git push/.test(script) ? /never/ : /./, "sanity");
  assert.equal(/\["push"|"push",|git push|\["commit"|"commit",/.test(script), false, "the window never commits or pushes");
  for (const removed of ["refresh:daily", "runLegacyRefresh", "skip-legacy", "legacyRefreshInShadow", "promoteFacts(", "staging-observer.mts"]) {
    assert.equal(script.includes(removed), false, `the research window retains retired data/release door ${removed}`);
  }
});

/* --------------------------------------------------- failure semantics */

function sampleRun(overrides: Partial<WindowRunRecord> = {}): WindowRunRecord {
  const incident = openIncident({ windowId: "nw-1", stage: "PIPELINE_EVALUATION", code: "PIPELINE_EVALUATION_THREW", detail: "research store unavailable", openedAt: "2026-09-02T08:10:00.000Z", missedScope: ["research evaluation"] });
  return {
    formatVersion: WINDOW_FORMAT_VERSION,
    windowId: "nw-1",
    localDate: "2026-09-02",
    zone: "America/New_York",
    scheduledFor: "2026-09-02T08:00:00.000Z",
    trigger: "CATCH_UP",
    mode: "SHADOW",
    startedAt: "2026-09-02T08:05:00.000Z",
    finishedAt: "2026-09-02T08:20:00.000Z",
    host: "h",
    testedSha: "abc",
    provider: "memory",
    caughtUp: ["2026-09-01"],
    lock: { leaseId: "l", holder: "w", claimedAt: "2026-09-02T08:05:00.000Z", expiresAt: "2026-09-02T09:35:00.000Z", releasedAt: null },
    activationGate: { promotionEnabled: false, mode: "SHADOW", openRecordClasses: [], contracts: { READER: "NOT_READY", TRUTH: "NOT_READY", FRESHNESS: "NOT_READY" }, independentlyReproduced: false, readFrom: null, reason: "SHADOW" },
    stages: [
      { stage: "PIPELINE_EVALUATION", outcome: "FAILED", startedAt: "2026-09-02T08:05:00.000Z", finishedAt: "2026-09-02T08:10:00.000Z", reason: "research store unavailable" },
      { stage: "DIGEST", outcome: "COMPLETED", startedAt: "2026-09-02T08:19:00.000Z", finishedAt: "2026-09-02T08:20:00.000Z", reason: null },
    ],
    pipeline: {
      items: 2,
      byStage: { SCOUTED: 2, CONFIRMED: 0, VERIFIED: 0, AUDITED: 0, APPROVED_FOR_PROMOTION: 0 },
      refused: 0,
      verdicts: [
        { itemId: "pp-1", recordClass: "meetings", stage: "SCOUTED", verdict: "REFUSE_WOULD", reason: "at SCOUTED; APPROVED_FOR_PROMOTION is required" },
        { itemId: "pp-2", recordClass: "campaign-finance", stage: "SCOUTED", verdict: "REFUSE_WOULD", reason: "at SCOUTED; APPROVED_FOR_PROMOTION is required" },
      ],
      byRecordClass: [
        { recordClass: "campaign-finance", items: 1, promoteWould: 0, refuseWould: 1, deferred: 0 },
        { recordClass: "meetings", items: 1, promoteWould: 0, refuseWould: 1, deferred: 0 },
      ],
    },
    promoted: 0,
    controls: null,
    incidents: [incident],
    digestPath: "x/nightly-window-digest.md",
    mirrored: false,
    recordPath: null,
    ...overrides,
  };
}

test("a stage failure is an incident that names what the next window catches up, and the digest and headline state it", () => {
  const run = sampleRun();
  assert.equal(run.incidents[0].stage, "PIPELINE_EVALUATION");
  assert.deepEqual(run.incidents[0].missedScope, ["research evaluation"]);
  const digest = buildWindowDigest(run);
  assert.match(digest, /PIPELINE_EVALUATION — FAILED/);
  assert.match(digest, /next window catches up: research evaluation/);
  assert.match(digest, /CATCH-UP: 1 earlier local date\(s\)[^\n]*2026-09-01/);
  assert.match(digest, /promoted: 0/);
  assert.match(digest, /NOT MEASURED/);
  assert.match(digest, /would promote 0 of 1; refused 1 of 1/);
  assert.match(digest, /GitHub Actions is not a wakeup, clock, or promotion surface for routine civic data/);
  const headline = windowHeadline(run);
  assert.match(headline, /promoted 0 - would promote 0 of 2 - refused 2 of 2 - deferred 0 of 2 - FAILED PIPELINE_EVALUATION - 1 incident\(s\) - caught up 2026-09-01/);
});

/* ------------------------------------------------------- the admin view */

test("the last-window view derives FAILED_STAGE from the stages, carries denominators, and passes its own audits", () => {
  const run = sampleRun();
  const view = buildWindowView({ nowIso: "2026-09-02T09:00:00.000Z", lastWindow: { kind: "HELD", value: { total: 1, last: run } }, incidents: { kind: "HELD", value: run.incidents } });
  assert.equal(view.verdict, "FAILED_STAGE");
  assert.match(view.reasons[0], /PIPELINE_EVALUATION FAILED/);
  assert.ok(view.promoted.held && view.promoted.value.value === 0 && view.promoted.value.denominator === 2);
  assert.ok(view.refused.held && view.refused.value.value === 2);
  assert.ok(view.byRecordClass.held && view.byRecordClass.value.length === 2);
  assert.equal(view.controls.held, false, "unmeasured controls are a named gap, never zero");
  assert.ok(view.proof.held && view.proof.value.windowId === "nw-1");
  assert.equal(auditRenderedNumbers(renderedNumbersOf(view)).ok, true);
  assert.equal(checkStatedEqualsRendered(countClaimsOf(view)).ok, true);
  const never = buildWindowView({ nowIso: "2026-09-02T09:00:00.000Z", lastWindow: { kind: "NOT_RECORDED", detail: "never ran" }, incidents: { kind: "HELD", value: [] } });
  assert.equal(never.verdict, "NEVER_RUN");
  const down = buildWindowView({ nowIso: "2026-09-02T09:00:00.000Z", lastWindow: { kind: "STORE_UNREACHABLE", detail: "down" }, incidents: { kind: "HELD", value: [] } });
  assert.equal(down.verdict, "UNREACHABLE", "an unreachable store never reads as a clean night");
  const clean = buildWindowView({ nowIso: "2026-09-02T09:00:00.000Z", lastWindow: { kind: "HELD", value: { total: 1, last: sampleRun({ stages: run.stages.map((s) => ({ ...s, outcome: "COMPLETED", reason: null })), incidents: [] }) } }, incidents: { kind: "HELD", value: [] } });
  assert.equal(clean.verdict, "COMPLETED");
});

test("a foreign row under window_runs is not a window: the last-window read and the due-check both skip it", async () => {
  const repos = createMemoryRepositories();
  await repos.windowRuns.append("windowRuns-conformance-x", "r-1", { formatVersion: 1, note: "conformance" } as never, "2026-09-02T00:00:00.000Z");
  assert.equal(lastWindowLocalDate(await repos.windowRuns.readAll()), null);
  const none = await readLastWindow(repos);
  assert.equal(none.kind, "NOT_RECORDED", "a foreign row never reads as a window that ran");
  const run = sampleRun();
  await repos.windowRuns.append(run.localDate, run.windowId, run, run.finishedAt);
  assert.equal(lastWindowLocalDate(await repos.windowRuns.readAll()), "2026-09-02");
  const held = await readLastWindow(repos);
  assert.ok(held.kind === "HELD" && held.value.total === 1 && held.value.last.windowId === "nw-1");
  await repos.windowIncidents.append(run.windowId, "foreign", { formatVersion: 1, note: "x" } as never, run.finishedAt);
  await repos.windowIncidents.append(run.windowId, run.incidents[0].incidentId, run.incidents[0], run.finishedAt);
  const incidents = await readWindowIncidents(repos, run.windowId);
  assert.ok(incidents.kind === "HELD" && incidents.value.length === 1);
});

/* ------------------------------------------------------ activation gate */

test("PDC: local shadow run records are diagnostic only and cannot activate promotion", () => {
  const gate = readActivationGate(ROOT);
  /* The open classes are the owner's decision in code (§3, 2026-09-29; tests/campaign-site-gate.test.ts), never a run record. */
  assert.equal(gate.promotionEnabled, true);
  assert.deepEqual(gate.openRecordClasses, ACTIVATION_GATE.openRecordClasses);
  assert.deepEqual(gate.openFields, ACTIVATION_GATE.openFields);
  assert.equal(gate.mode, "SHADOW");
  assert.equal(gate.readFrom, null);
  assert.deepEqual(gate.contracts, { READER: "UNREAD", TRUTH: "UNREAD", FRESHNESS: "UNREAD" });
  assert.match(gate.reason, /non-authoritative diagnostics after PDC/);
  const empty = readActivationGate(mkdtempSync(join(tmpdir(), "wtp-gate-")));
  assert.deepEqual(empty, gate, "filesystem contents cannot change the activation decision");
  const source = readFileSync(join(ROOT, "lib", "control-plane", "promotion", "activation-gate.ts"), "utf8");
  assert.doesNotMatch(source, /readFileSync|readdirSync|freshness-shadow-runs/);
});
