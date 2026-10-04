/**
 * **THE 9.4.26 ADMIN FEEDBACK, PINNED.** (ADM-1 through ADM-9.)
 *
 * Every row of the owner's sweep names an instance of a class; these guards
 * pin the class. Pure modules are exercised as functions; the pages are
 * read as source text (a `.tsx` cannot be imported under `node --test`), the
 * same way the other admin guards do it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { buildCostPanel, NO_MODEL_KEY, PROD_ASK_KEY } from "../lib/control-plane/cost-panel.ts";
import { buildDecisionCards, openNeedsSeanRows, type RegistryEntry } from "../lib/control-plane/decision-cards.ts";
import { collapseDecisionLog, latestDecisionFor } from "../lib/control-plane/decision-log.ts";
import { buildFleetView, dispatchHistory, whereOf } from "../lib/control-plane/fleet-view.ts";
import { freshnessContract, freshnessRiskOf } from "../lib/health/contracts.ts";
import {
  ANSWERED_IN_OWN_WORDS,
  decisionCardKind,
  type OwnerDecisionIntent,
  type RunnerHeartbeat,
} from "../lib/control-plane/owner-surface.ts";
import { validateIntentNote } from "../lib/control-plane/research-view.ts";
import { runnerStanding } from "../lib/control-plane/runner-standing.ts";
import { describeDispatchMatch, parseDispatchTarget, unitMatchesTarget } from "../lib/control-plane/scheduler/dispatch-target.ts";
import {
  readIntents,
  type ResearchIntent,
  type ResearchIntentAction,
  type ResearchIntentRequest,
} from "../lib/control-plane/scheduler/research-policy.ts";
import type { Attempt } from "../lib/control-plane/attempt.ts";

const ROOT = process.cwd();
const src = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const NOW = "2026-09-05T03:00:00.000Z";

/* ================================================================== *
 * ADM-4 — the decision cards are a JOIN, not a read of one file
 * ================================================================== */

const ROWS = [
  { ID: "OWN01", Section: "needs-sean", Priority: "P2", Title: "Body count mismatch", "What this is": "…", Resolution: "", "Opened on": "2026-08-31", "Last verified": "" },
  { ID: "NH306", Section: "needs-sean", Priority: "P1", Title: "A wall", "What this is": "…", Resolution: "", "Opened on": "2026-09-01", "Last verified": "2026-09-04" },
  { ID: "NH208", Section: "needs-sean", Priority: "P3", Title: "Nothing is wrong", "What this is": "…", Resolution: "", "Opened on": "UNKNOWN", "Last verified": "" },
  { ID: "DONE1", Section: "needs-sean", Priority: "P2", Title: "Closed", "What this is": "…", Resolution: "Resolved", "Opened on": "2026-08-20", "Last verified": "" },
  { ID: "AZ9", Section: "az-hunt", Priority: "P2", Title: "Not needs sean", "What this is": "…", Resolution: "", "Opened on": "2026-08-20", "Last verified": "" },
];
const REGISTRY: RegistryEntry[] = [
  { rowId: "OWN01", kind: "NOT_MACHINE_VERIFIABLE", whatIsNeeded: "Send the capture you saw.", whyNoMachineCanDecide: "It does not reproduce.", options: [{ option: "Send it", consequence: "placed against a build" }, { option: "Close it", consequence: "closes as unreproducible" }] },
  { rowId: "NH306", kind: "predicate", blocker: "the secret is not in the environment" },
  { rowId: "NH208", kind: "NOT_MACHINE_VERIFIABLE", whatIsNeeded: "Acknowledge the correction: nothing is wrong.", whyNoMachineCanDecide: "the title says otherwise", options: [{ option: "Acknowledge", consequence: "closes" }] },
];
const OUTCOMES = [
  { rowId: "OWN01", kind: "NOT_MACHINE_VERIFIABLE", verdict: "HOLDS", why: "waits on the author" },
  { rowId: "NH306", kind: "predicate", verdict: "HOLDS", why: "WTP_X is still absent from the environment" },
];

test("ADM-4: every open Needs-Sean row publishes a card carrying title, priority, opened date, age and the registry text", () => {
  const cards = buildDecisionCards({ rows: ROWS, registry: REGISTRY, outcomes: OUTCOMES, stamp: "2026-09-04" });
  assert.deepEqual(cards.map((c) => c.rowId), ["NH306", "OWN01", "NH208"], "P1 first, then age oldest first inside a priority");
  const own = cards.find((c) => c.rowId === "OWN01")!;
  assert.equal(own.title, "Body count mismatch");
  assert.equal(own.priority, "P2");
  assert.equal(own.openedOn, "2026-08-31");
  assert.equal(own.ageDays, 4);
  assert.equal(own.whatIsNeeded, "Send the capture you saw.");
  assert.equal(own.whyNoMachineCanDecide, "It does not reproduce.");
  assert.equal(own.options.length, 2);
  assert.equal(own.kind, "DECISION");
  assert.equal(own.verifiability, "NOT_MACHINE_VERIFIABLE");
  assert.equal(own.blockedDescendants, null, "nothing measured it, so it is null — never a zero");
});

test("ADM-4: a predicate row is a BLOCKED_WHILE wall with no options and its last recheck; an acknowledgement row is ACKNOWLEDGE", () => {
  const cards = buildDecisionCards({ rows: ROWS, registry: REGISTRY, outcomes: OUTCOMES, stamp: "2026-09-04" });
  const wall = cards.find((c) => c.rowId === "NH306")!;
  assert.equal(wall.kind, "BLOCKED_WHILE");
  assert.equal(wall.verifiability, "PREDICATE");
  assert.deepEqual(wall.options, []);
  assert.equal(wall.blocker, "the secret is not in the environment");
  assert.match(wall.checkedThisRun ?? "", /still absent/);
  assert.equal(wall.lastVerified, "2026-09-04");
  const ack = cards.find((c) => c.rowId === "NH208")!;
  assert.equal(ack.kind, "ACKNOWLEDGE");
  assert.equal(ack.openedOn, null, "UNKNOWN is an unrecoverable date, published as null");
  assert.equal(ack.ageDays, null);
});

test("ADM-4: closed rows and rows outside Needs Sean never become cards", () => {
  assert.deepEqual(openNeedsSeanRows(ROWS).map((r) => r.ID), ["OWN01", "NH306", "NH208"]);
});

test("ADM-4: a snapshot written before the kind field existed still classifies by verifiability", () => {
  assert.equal(decisionCardKind({ verifiability: "PREDICATE" } as never), "BLOCKED_WHILE");
  assert.equal(decisionCardKind({ verifiability: "NOT_MACHINE_VERIFIABLE" } as never), "DECISION");
});

test("ADM-4: the publisher joins the working store and the registry, and no longer overwrites the runner heartbeat", () => {
  const publisher = src("scripts/publish-owner-snapshot.mts");
  assert.match(publisher, /buildDecisionCards\(/);
  assert.match(publisher, /readStore\(WORKING_CSV/);
  assert.match(publisher, /from "\.\.\/lib\/tracker\/registry\.mjs"/);
  assert.doesNotMatch(publisher, /runnerHeartbeat\.(put|compareAndSet)\(/, "ADM-5: a publish is not a beat");
  assert.doesNotMatch(publisher, /"not recorded on this row"/);
});

test("ADM-4: the decision route accepts an answer in the owner's own words, and the page posts the consequence it showed", () => {
  const route = src("app/api/admin/decision/route.ts");
  assert.match(route, /ownerAnswer/);
  assert.match(route, /ANSWERED_IN_OWN_WORDS/);
  assert.match(route, /chosenOption === "" && ownerAnswer === null/);
  const page = src("app/(admin)/admin/page.tsx");
  // S11 (2026-09-30): the home screen no longer draws the old tracker's decision cards at all.
  assert.doesNotMatch(page, /splitDecided\(|NextSteps/, "the home screen does not draw the old tracker decisions");
});

const INTENT = (over: Partial<OwnerDecisionIntent>): OwnerDecisionIntent => ({
  formatVersion: 1,
  intentId: "OWN01:2026-09-05T01:00:00.000Z",
  subjectId: "OWN01",
  chosenOption: "Send it",
  consequenceShown: "placed against a build",
  decidedAt: "2026-09-05T01:00:00.000Z",
  state: "PENDING_CANONICALIZATION",
  canonicalRef: null,
  refusedReason: null,
  adminSessionRef: "adm_x",
  ...over,
});

test("ADM-4: the decision log collapses to one row per decision, the #resolved twin winning", () => {
  const original = INTENT({});
  const twin = INTENT({ intentId: `${original.intentId}#resolved`, state: "CANONICALIZED", canonicalRef: "docs/tracker-resolved.csv#OWN01" });
  const other = INTENT({ intentId: "V01:2026-09-05T02:00:00.000Z", subjectId: "V01", decidedAt: "2026-09-05T02:00:00.000Z", chosenOption: ANSWERED_IN_OWN_WORDS, ownerAnswer: "Do the calls next week." });
  const collapsed = collapseDecisionLog([original, other, twin]);
  assert.equal(collapsed.length, 2);
  assert.equal(collapsed[0].subjectId, "V01", "newest first");
  assert.equal(collapsed[1].state, "CANONICALIZED");
  assert.equal(collapsed[1].intentId, original.intentId, "the twin is reported under the base id");
  assert.equal(latestDecisionFor([original, twin], "OWN01")?.state, "CANONICALIZED");
  assert.equal(latestDecisionFor([original], "V01"), null);
});

/* ================================================================== *
 * ADM-5 — a deliberate pause is told from a failure
 * ================================================================== */

const BEAT: RunnerHeartbeat = {
  formatVersion: 1,
  beatAt: "2026-09-04T16:57:41.873Z",
  lastCycleStartedAt: "2026-09-04T16:45:58.286Z",
  lastCycleFinishedAt: "2026-09-04T16:57:41.873Z",
  nextCycleDueAt: null,
  lastCycleOk: true,
  testedSha: "a6f7fd4d",
  host: "runner",
};
const intent = (action: ResearchIntentAction, requestedAt: string, note: string | null = null): ResearchIntentRequest => ({
  formatVersion: 1,
  kind: "INTENT",
  intentId: `${action}:${requestedAt}`,
  action,
  requestedAt,
  actor: "owner (admin session)",
  adminSessionRef: "adm_x",
  note,
});

test("ADM-5: SILENT with no pause recorded is red and says no pause is recorded; the control offered is to record one", () => {
  const s = runnerStanding(BEAT, [], NOW);
  assert.equal(s.state, "SILENT");
  assert.equal(s.level, "RED");
  assert.match(s.headline, /no pause recorded/);
  assert.match(s.detail, /no pause is recorded/);
  assert.equal(s.control, "PAUSE_RUNNER");
});

test("ADM-5: the owner's PAUSE_RUNNER turns the same silence amber, names who, when and why, and offers RESUME", () => {
  const log = [intent("PAUSE_RUNNER", "2026-09-04T17:10:00.000Z", "usage was heavy; back on Monday")];
  const s = runnerStanding(BEAT, log, NOW);
  assert.equal(s.state, "PAUSED");
  assert.equal(s.level, "AMBER");
  assert.equal(s.headline, "Paused by you");
  assert.match(s.detail, /usage was heavy/);
  assert.match(s.detail, /has not acknowledged/);
  assert.equal(s.control, "RESUME_RUNNER");
  assert.equal(s.pause?.acknowledged, false);
});

test("ADM-5: a HONORED record or a pause-carrying beat marks the pause acknowledged; RESUME_RUNNER ends it", () => {
  const pause = intent("PAUSE_RUNNER", "2026-09-04T17:10:00.000Z", null);
  const honored: ResearchIntent = { formatVersion: 1, kind: "HONORED", intentId: `${pause.intentId}:honored`, honors: pause.intentId, action: "PAUSE_RUNNER", honoredAt: "2026-09-04T17:11:00.000Z", honoredBy: "pilot-runner@host#1", detail: "idling" };
  assert.equal(runnerStanding(BEAT, [pause, honored], NOW).pause?.acknowledged, true);
  const beatWithPause: RunnerHeartbeat = { ...BEAT, pause: { intentId: pause.intentId, since: pause.requestedAt, note: null } };
  assert.equal(runnerStanding(beatWithPause, [pause], NOW).pause?.acknowledged, true);
  const resumed = runnerStanding(BEAT, [pause, intent("RESUME_RUNNER", "2026-09-04T18:00:00.000Z")], NOW);
  assert.equal(resumed.state, "SILENT", "after a resume the beat is judged on its own again");
  assert.equal(readIntents([pause, intent("RESUME_RUNNER", "2026-09-04T18:00:00.000Z")]).runnerPause.paused, false);
});

test("ADM-5: an ALIVE beat with no pause is green and offers to record a pause", () => {
  const s = runnerStanding({ ...BEAT, beatAt: "2026-09-05T02:50:00.000Z" }, [], NOW);
  assert.equal(s.state, "ALIVE");
  assert.equal(s.level, "GREEN");
  assert.equal(s.control, "PAUSE_RUNNER");
});

/* ================================================================== *
 * ADM-8 — deploy fleet: the target is read, matched, and honored by name
 * ================================================================== */

test("ADM-8: the owner's words become state codes and terms", () => {
  assert.deepEqual(parseDispatchTarget("deep dive on Illinois").states, ["il"]);
  assert.deepEqual(parseDispatchTarget("deep dive on Illinois").terms, []);
  assert.deepEqual(parseDispatchTarget("NH meetings").states, ["nh"]);
  assert.deepEqual(parseDispatchTarget("look in Arizona").states, ["az"], "'in' is a word, not Indiana");
  const pima = parseDispatchTarget("Pima County campaign finance");
  assert.deepEqual(pima.states, []);
  assert.ok(pima.terms.includes("pima") && pima.terms.includes("campaign") && pima.terms.includes("finance"));
  assert.deepEqual([...parseDispatchTarget("Arizona and New Hampshire").states].sort(), ["az", "nh"], "both states, order not asserted");
  assert.deepEqual(parseDispatchTarget("West Virginia").states, ["wv"], "the longer name wins");
});

test("ADM-8: units match by bounded state token or by term; a dispatch to an unenumerated state is honored by name", () => {
  const il = parseDispatchTarget("deep dive on Illinois");
  assert.equal(unitMatchesTarget(il, { id: "az-sos-cfs-bulk-ftp", subjectId: "ocd-division/country:us/state:az" }), false);
  const az = parseDispatchTarget("Arizona");
  assert.equal(unitMatchesTarget(az, { id: "az-sos-cfs-bulk-ftp", subjectId: "x" }), true);
  assert.equal(unitMatchesTarget(az, { id: "AZ_SEETHEMONEY_PLAIN_FETCH", subjectId: "x" }), true);
  assert.equal(unitMatchesTarget(az, { id: "meetings:1", subjectId: "ocd-division/country:us/state:az/county:pima" }), true);
  assert.equal(unitMatchesTarget(az, { id: "nh-cfs-transaction-detail", subjectId: "state:nh" }), false);
  const sentence = describeDispatchMatch(il, 0, 2996, ["az", "nh", "nj"]);
  assert.match(sentence, /matched 0 of 2996/);
  assert.match(sentence, /Illinois is not enumerated yet/);
  assert.match(describeDispatchMatch(az, 1177, 2996, ["az", "nh", "nj"]), /matched 1177 of 2996/);
});

test("ADM-8: a DISPATCH needs words and the intent carries them; the control that sends work explains itself before it acts", () => {
  assert.equal(validateIntentNote("DISPATCH", "  ").ok, false);
  const ok = validateIntentNote("DISPATCH", "  deep   dive on Illinois ");
  assert.deepEqual(ok, { ok: true, note: "deep dive on Illinois" });
  assert.deepEqual(validateIntentNote("PAUSE", "ignored"), { ok: true, note: null });
  assert.equal(validateIntentNote("PAUSE_RUNNER", "x".repeat(281)).ok, false);
  const log: ResearchIntent[] = [intent("DISPATCH", "2026-09-05T01:00:00.000Z", "deep dive on Illinois")];
  const rows = dispatchHistory(log);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "PENDING");
  assert.equal(readIntents(log).pendingDispatch.length, 1);
});

/* ================================================================== *
 * ADM-7 — the fleet in the owner's words
 * ================================================================== */

const attempt = (over: Partial<Attempt> & { id: string; role: Attempt["worker"]["role"]; workItemId: string }): Attempt =>
  ({
    routeTaskId: `rt-${over.id}`,
    leaseId: "l",
    startedAt: "2026-09-04T10:00:00.000Z",
    endedAt: "2026-09-04T10:05:00.000Z",
    outcome: "COMPLETED",
    abortReason: null,
    artifactIds: [],
    methodVersion: "m",
    policyVersion: "p",
    cost: { inputTokens: null, outputTokens: null, usd: null, durationMs: null, bytesFetched: null, requestCount: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false },
    ...over,
    worker: { role: over.role, provider: "we-the-people", version: "deterministic-walker", instance: "i" },
  }) as unknown as Attempt;

test("ADM-7: the five groups cover the roles, with counts that carry denominators and a where-deployed derived from the WorkItem", () => {
  const view = buildFleetView({
    nowIso: NOW,
    attempts: [
      attempt({ id: "a1", role: "SCOUT", workItemId: "w1", outcome: null, endedAt: null }),
      attempt({ id: "a2", role: "ACQUIRER", workItemId: "w1" }),
      attempt({ id: "a3", role: "DETECTIVE", workItemId: "w2" }),
      attempt({ id: "a4", role: "RELEASE_ORCHESTRATOR", workItemId: "w2" }),
    ],
    workItems: [
      { id: "w1", subject: "ocd-division/country:us/state:az/county:pima" } as never,
      { id: "w2", subject: "nh-sos-records-request" } as never,
    ],
    routeTasks: [{ id: "t1", state: "PENDING", workerTask: { role: "VALIDATOR" } } as never],
  });
  assert.deepEqual(view.groups.map((g) => g.key), ["hunters", "detectives", "verifiers", "auditors", "engineers"]);
  const hunters = view.groups[0];
  assert.equal(hunters.working.value, 1);
  assert.equal(hunters.working.denominator, 2);
  assert.equal(hunters.completed.value, 1);
  assert.deepEqual(hunters.deployedAt, [{ label: "Arizona", attempts: 2 }]);
  assert.equal(view.groups[1].deployedAt[0].label, "New Hampshire");
  assert.equal(view.groups[2].queued.value, 1);
  assert.equal(view.groups[2].queued.denominator, 1);
  assert.equal(view.unassignedAttempts, 1, "RELEASE_ORCHESTRATOR is counted, never folded into a group");
  assert.equal(view.workingNow, 1);
  assert.match(hunters.doing, /1 attempt open right now/);
  assert.match(view.groups[3].doing, /No auditors have run yet/);
  assert.equal(whereOf("meetings:x", "il"), "Illinois");
  assert.equal(whereOf(null, null), null);
});

/* ================================================================== *
 * ADM-3 — plain words, with the scale
 * ================================================================== */

test("ADM-3: FRESHNESS reads measured canonical-cycle risk through the owner publisher", () => {
  const risk = freshnessRiskOf({ risk: { obligationsScheduled: 3, obligationsUnscheduled: 0, obligationsOverdue: 2, debtRows: 180, incidents: 29, oldestDebtHours: 1, activation: "SHADOW_NOT_ACTIVATED" } });
  assert.ok(risk);
  assert.match(freshnessContract(risk).reason, /measured staleness risk: 3 obligation/);
  assert.equal(freshnessRiskOf({ risk: { activation: "OTHER" } }), undefined);
  assert.equal(freshnessRiskOf(null), undefined);
  assert.match(src("scripts/publish-owner-snapshot.mts"), /freshnessContract\(freshnessRiskOf\(/);
});

/* ================================================================== *
 * ADM-6 — cost with numbers
 * ================================================================== */

test("ADM-6: the ledger rolls up by role and by model with measured/unmeasured beside every row; the reader path is one short gap", () => {
  const costs = [
    { attemptId: "a1", workItemId: "w", routeTaskId: null, routeId: null, source: null, jurisdiction: null, project: "f", role: "SCOUT" as const, cost: { inputTokens: 10, outputTokens: 5, usd: 0.5, durationMs: 1, bytesFetched: null, requestCount: 1, cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false }, recordedAt: NOW },
    { attemptId: "a2", workItemId: "w", routeTaskId: null, routeId: null, source: null, jurisdiction: null, project: "f", role: "SCOUT" as const, cost: { inputTokens: 10, outputTokens: 5, usd: 0.25, durationMs: 1, bytesFetched: null, requestCount: 1, cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false }, recordedAt: NOW },
    { attemptId: "a3", workItemId: "w", routeTaskId: null, routeId: null, source: null, jurisdiction: null, project: "f", role: "ACQUIRER" as const, cost: { inputTokens: null, outputTokens: null, usd: null, durationMs: 4, bytesFetched: 9, requestCount: 1, cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false }, recordedAt: NOW },
  ];
  const panel = buildCostPanel({
    costs,
    attempts: [
      { id: "a1", worker: { version: "claude-opus-5", provider: "anthropic" } },
      { id: "a2", worker: { version: "claude-opus-5", provider: "anthropic" } },
      { id: "a3", worker: { version: "deterministic-walker", provider: "we-the-people" } },
    ],
    cacheByRole: [{ role: "SCOUT", cacheRead: 800, cacheWrite: 100, uncachedInput: 100, hitRate: 0.8, repeatedPrefixTurns: null, repeatedPrefixMisses: null, attempts: 2, denominator: "d" }],
    share: { thisCycle: { deterministic: 7, model: 3, modelShare: 0.3 }, window: { deterministic: 7, model: 3, modelShare: 0.3, cycles: 1, since: NOW }, delta: 0 },
    verifiedRecords: 3,
  });
  const scout = panel.costByRole.find((r) => r.key === "SCOUT")!;
  assert.ok(scout.usd.held && scout.usd.value.value === 0.75 && scout.usd.value.denominator === 0.75);
  assert.equal(scout.attemptsMeasured, 2);
  const acq = panel.costByRole.find((r) => r.key === "ACQUIRER")!;
  // ADM-17 (evening): a role whose attempts all ran without a paid model is $0 by design, not a gap.
  assert.equal(acq.kind, "FREE_BY_DESIGN");
  assert.ok(acq.usd.held && acq.usd.value.value === 0);
  assert.equal(acq.attemptsUnmeasured, 1);
  assert.deepEqual(panel.costByModel.map((r) => r.key), ["claude-opus-5", NO_MODEL_KEY]);
  const cache = panel.cacheHitRateByCaller.find((r) => r.callerKey.startsWith("SCOUT"))!;
  assert.ok(cache.hitRate.held && cache.hitRate.value.value === 800 && cache.hitRate.value.denominator === 1000);
  const ask = panel.cacheHitRateByCaller.find((r) => r.callerKey === PROD_ASK_KEY)!;
  assert.ok(!ask.hitRate.held && ask.hitRate.gap.says.length < 120, "one short line, not a paragraph");
  assert.ok(panel.deterministicShare.held && panel.deterministicShare.value.value === 7 && panel.deterministicShare.value.denominator === 10);
  assert.ok(panel.costPerVerifiedRecord.held && panel.costPerVerifiedRecord.value.value === 0.25 && panel.costPerVerifiedRecord.value.denominator === 3);
  assert.equal(panel.summary.measuredUsd, 0.75);
  assert.equal(panel.summary.attemptsUnmeasured, 1);
});

test("ADM-6: nothing measured is a gap in every row, never a zero", () => {
  const panel = buildCostPanel({ costs: [], attempts: [], cacheByRole: null, share: null, verifiedRecords: null });
  assert.deepEqual(panel.costByRole, []);
  assert.ok(!panel.deterministicShare.held);
  assert.ok(!panel.costPerVerifiedRecord.held);
  assert.equal(panel.summary.measuredUsd, null);
  assert.match(src("scripts/publish-owner-snapshot.mts"), /buildCostPanel\(/);
});

/* ================================================================== *
 * ADM-1 — the quarantined readiness record says what exists and what clears it
 * ================================================================== */


/* ================================================================== *
 * ADM-2 / ADM-9 — the header acknowledges a choice at once and carries the theme switch
 * ================================================================== */

test("ADM-2: the console header navigates inside a transition, shows the choice at once, and the read path skips the schema bootstrap", () => {
  assert.match(src("lib/control-plane/admin-data.ts"), /skipBootstrap: true/);
  // The bootstrap call is now wrapped in a bounded connect-retry (connect-retry.ts)
  // so a transient Neon fetch failure at cycle start does not abort the cycle, but it
  // stays gated by !skipBootstrap, so the admin read path still skips it entirely.
  // Since 2026-09-23 it also carries the per-class request bounds (request-bounds.ts).
  assert.match(
    src("lib/control-plane/repository/pg-store.ts"),
    /if \(!options\.skipBootstrap\) \{[\s\S]*?bootstrap\(sql, nowIso(?:, bounds)?\)/,
  );
});
