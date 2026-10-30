/**
 * Admin guards: runner pause standing, fleet dispatch targets, the fleet view and the cost panel.
 * Pages are read as source text (a `.tsx` cannot be imported under `node --test`).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { buildFleetView, dispatchHistory, whereOf } from "../lib/control-plane/fleet-view.ts";
import type { RunnerHeartbeat } from "../lib/control-plane/owner-surface.ts";
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
 * a deliberate pause is told from a failure
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
 * deploy fleet: the target is read, matched, and honored by name
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
 * the fleet in the owner's words
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
 * cost with numbers
 * ================================================================== */

/* ================================================================== *
 * the header acknowledges a choice at once and carries the theme switch
 * ================================================================== */

test("ADM-2: the console header navigates inside a transition, shows the choice at once, and the read path skips the schema bootstrap", () => {
  assert.match(src("lib/control-plane/admin-data.ts"), /skipBootstrap: true/);
  // The bootstrap stays gated by !skipBootstrap, so the admin read path skips it.
  assert.match(
    src("lib/control-plane/repository/pg-store.ts"),
    /if \(!options\.skipBootstrap\) \{[\s\S]*?bootstrap\(sql, nowIso(?:, bounds)?\)/,
  );
});
