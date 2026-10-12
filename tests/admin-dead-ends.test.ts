/**
 * A dead end explains itself from the records the work already wrote, a missing field names its
 * gap, an assignment is complete only when every member obligation passes the completion
 * evaluator, and a Scout's "why a paid model" is the executor decision's own words.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { assignmentCompletionWords, evaluateAssignmentCompletion, memberObligations } from "../lib/control-plane/assignment-completion.ts";
import { buildBodyViews, type BodyStoreFacts, type WatchedContract } from "../lib/control-plane/admin-view/bodies.ts";
import { latestScout, routineRuledOut, scoutDeadEnd } from "../lib/control-plane/admin-view/dead-ends.ts";
import type { CompletionSnapshot } from "../lib/control-plane/completion.ts";
import type { RouteTask } from "../lib/control-plane/route-task.ts";
import type { ScoutResult, ScoutRung } from "../lib/control-plane/scheduler/scout-result.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";

const NOW = "2026-09-25T12:00:00.000Z";
const PAST = "2026-09-18T12:00:00.000Z";
const OB = "freshness:candidate-enrichment:nj:2026:poe-pat#candidate-authored-awaits-site";

function rung(i: number, ok: boolean | undefined): ScoutRung {
  return { index: i, rung: i === 1 ? "primary-site-navigation" : "open-data-portal", tool: "fetch_public", target: `https://example.gov/${i}`, observed: ok === false ? "HTTP 403" : "HTTP 200", artifactIds: [], note: null, at: NOW, ...(ok === undefined ? {} : { ok }) };
}

function scout(over: Partial<ScoutResult> = {}): ScoutResult {
  return {
    formatVersion: 1,
    attemptId: "at-1",
    obligationId: OB,
    routeTaskId: "rt-1",
    workItemId: "wi-1",
    subjectId: "nj:2026:poe-pat",
    routeId: "candidate-authored-awaits-site",
    recordClass: "candidate-enrichment",
    providerId: "candidate-enrichment",
    reason: "route candidate-authored-awaits-site has no machine-executable opening; genuine unresolved novelty runs a bounded Scout",
    outcome: "NO_PROGRESS",
    stoppedBy: "BOUND",
    rungs: [rung(1, false), rung(2, true)],
    distinctEvidenceRungs: 2,
    candidates: [],
    findings: [],
    nextRungs: ["read the county filing index", "search the clerk's archive"],
    unverified: [],
    narrative: "fixture",
    worker: { provider: "anthropic", model: "claude-opus-5-5", modelReported: "claude-opus-5-5" },
    usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, turns: 1, toolCalls: 2 },
    usd: 0.4,
    elapsedMs: 1000,
    artifactIds: [],
    methodCandidateIds: [],
    refusal: null,
    startedAt: "2026-09-24T09:59:00.000Z",
    recordedAt: "2026-09-24T10:00:00.000Z",
    ...over,
  };
}

/* ------------------------------------------------------------ the walk */

test("MW-016: a walk's failed rungs are what it ruled out, its next rungs what would settle it, its outcome who moves", () => {
  const d = scoutDeadEnd(scout(), { retryAt: "2026-09-25T18:00:00.000Z" });
  assert.match(d.ruledOut ?? "", /^1 rung tried and failed in the walk of .*: primary-site-navigation at https:\/\/example\.gov\/1 \(HTTP 403\)\.$/);
  assert.match(d.wouldSettle ?? "", /The next rungs the walk of .* named: read the county filing index; search the clerk's archive\./);
  assert.match(d.whoMoves ?? "", /^The Scout lane \(automatic, paid model\): it walked the ladder to the floor.*Its retry is not before /);
  assert.deepEqual(d.gaps, {});
});

test("MW-016: a field the walk cannot answer stays null and names its gap", () => {
  const legacy = scoutDeadEnd(scout({ rungs: [rung(1, undefined)], nextRungs: [], outcome: "ROUTE_CANDIDATE" }));
  assert.equal(legacy.ruledOut, null);
  assert.match(legacy.gaps.ruledOut ?? "", /predates recording whether each rung succeeded/);
  assert.equal(legacy.wouldSettle, null);
  assert.match(legacy.gaps.wouldSettle ?? "", /named no next rung/);
  const none = scoutDeadEnd(null);
  assert.equal(none.whoMoves, null);
  assert.match(none.gaps.whoMoves ?? "", /no Scout walk is on record/);
  // A refused finish keeps its machine-derived rungs; its outcome's owner is not believed.
  const refused = scoutDeadEnd(scout({ outcome: "HUMAN_REQUIRED", refusal: [{ code: "SCOUT_EARLY_ABSENCE", detail: "too few rungs" }] as never }));
  assert.notEqual(refused.ruledOut, null);
  assert.match(refused.whoMoves ?? "", /^The Scout lane .*finish was refused \(SCOUT_EARLY_ABSENCE\)/);
  assert.equal(latestScout([scout({ recordedAt: "2026-09-20T00:00:00.000Z", attemptId: "old" }), scout({ attemptId: "new" })])?.attemptId, "new");
});

/* ------------------------------------------------------------ routine reads */

test("MW-016: a run of the same failed read rules out a one-off; our own failure rules out nothing about the site", () => {
  const read = (at: string, failed: boolean, jobFailure = false) => ({ state: failed ? "SOURCE_BLOCKED" : "PROMOTED", failureCode: failed ? "SOURCE_RETRIEVAL_FAILED" : null, acquisitionSucceeded: !failed, attemptedAt: at, failed, jobFailure });
  const words = () => "could not get in";
  assert.match(routineRuledOut([read("2026-09-25T10:00:00.000Z", true), read("2026-09-25T09:00:00.000Z", true), read("2026-09-25T08:00:00.000Z", false)], words).ruledOut ?? "", /^A one-off failure: the last 2 reads/);
  assert.match(routineRuledOut([read("2026-09-25T10:00:00.000Z", true), read("2026-09-25T09:00:00.000Z", false)], words).ruledOut ?? "", /^That the source is gone for good: the read before/);
  assert.match(routineRuledOut([read("2026-09-25T10:00:00.000Z", true, true)], words).gap ?? "", /our own code failed before the site was asked/);

  const contract: WatchedContract = {
    id: "meetings:legistar:pima-bos", scope: "source:legistar:body:pima-bos", bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    ocdId: "ocd-division/country:us/state:az/county:pima", meetingSource: "legistar", jurisdiction: "Pima County", publishingOrg: "Pima County",
    sourceUrl: "https://pima.legistar.com/Calendar.aspx", verifiedAt: null, cadence: { description: "every hour", defaultEveryMs: 3_600_000 },
    retry: { afterMs: 900_000, description: "fifteen minutes later" },
  };
  const attemptRow = (at: string) => ({ scope: contract.scope, candidateId: `cv-${at}`, state: "SOURCE_BLOCKED", failureCode: "SOURCE_RETRIEVAL_FAILED", failureDetail: "HTTP 403", acquisitionSucceeded: false, attemptedAt: at });
  const store: BodyStoreFacts = { asOf: NOW, versions: [], readbacks: [], day: [], changes: [], attempts: [attemptRow("2026-09-25T10:00:00.000Z"), attemptRow("2026-09-25T09:00:00.000Z")] };
  const [body] = buildBodyViews({ contracts: [contract], store, nowIso: NOW, zipOf: () => ({ kind: "NONE" }) });
  assert.match(body!.deadEnd?.ruledOut ?? "", /^A one-off failure: the last 2 reads/, "a body's dead end is no longer always 'nothing ruled out'");
  const [single] = buildBodyViews({ contracts: [contract], store: { ...store, attempts: [attemptRow("2026-09-25T10:00:00.000Z")] }, nowIso: NOW, zipOf: () => ({ kind: "NONE" }) });
  assert.equal(single!.deadEnd?.ruledOut, null);
  assert.match(single!.deadEnd?.gaps?.ruledOut ?? "", /only this one read is recorded/);
});

/* ------------------------------------------------------------ visited is not finished */

function snapshotFor(state: "DONE" | "OUTSTANDING"): CompletionSnapshot {
  const item: WorkItem = {
    id: `wi-${state}`, project: "freshness", subject: "s", obligation: "o", why: "fixture", priority: "P2", state: "OPEN",
    contract: { inheritedRouteFloor: [], requiresValidation: false, requiresAudit: false, requiresCompleteDenominator: false, acceptableDispositions: null, instrumentEvidence: null },
    dependencies: [], routeTaskIds: [], escalations: [], createdAt: PAST, transitions: [],
  };
  const task = { id: `rt-${state}`, workItemId: item.id, routeId: "r", routeLabel: "r", target: "t", inherited: true, state: state === "DONE" ? "DISPOSED" : "PENDING", disposition: state === "DONE" ? { disposition: "INGESTED" } : null, attemptIds: [], createdAt: PAST } as unknown as RouteTask;
  return { item, routeTasks: [task], validations: [], audits: [], contradictions: [], upstreamStates: new Map(), denominatorComplete: null, instrumentGreens: new Set(), now: NOW };
}

test("MW-015: an assignment is COMPLETE only when no member is refused or unsettled, and lists what remains", () => {
  const key = "scope:county:04019";
  const member = (id: string, keys: readonly string[]) => ({ id, assignments: keys.map((k) => ({ assignmentKey: k, relation: "CREATED_FOR", at: PAST })) });
  const obligations = [member("ob-a", [key]), member("ob-b", [key, "scope:state:az"]), member("ob-c", ["scope:state:az"]), { id: "ob-legacy" }];
  assert.deepEqual(memberObligations(obligations, key).map((o) => o.id), ["ob-a", "ob-b"]);

  const done = evaluateAssignmentCompletion({ assignmentKey: key, obligations, snapshotFor: () => snapshotFor("DONE") });
  assert.equal(done.kind, "COMPLETE");

  const visited = evaluateAssignmentCompletion({ assignmentKey: key, obligations, snapshotFor: (id) => (id === "ob-a" ? snapshotFor("DONE") : snapshotFor("OUTSTANDING")) });
  assert.equal(visited.kind, "NOT_COMPLETE");
  if (visited.kind !== "NOT_COMPLETE") throw new Error("unreachable");
  assert.equal(visited.settled, 1);
  assert.deepEqual(visited.exceptions.map((e) => [e.obligationId, e.kind, e.codes]), [["ob-b", "REFUSED", ["ROUTE_TASK_STILL_OUTSTANDING"]]]);
  assert.match(assignmentCompletionWords(visited), /^Not complete: 1 of 2 member obligations passed the completion check; 1 refused and 0 not yet settled remain\.$/);

  const unread = evaluateAssignmentCompletion({ assignmentKey: key, obligations, snapshotFor: (id) => (id === "ob-a" ? snapshotFor("DONE") : null) });
  assert.equal(unread.kind === "NOT_COMPLETE" && unread.exceptions[0]!.kind, "UNSETTLED", "a member not read is unsettled, never assumed done");

  assert.equal(evaluateAssignmentCompletion({ assignmentKey: "scope:nowhere", obligations, snapshotFor: () => snapshotFor("DONE") }).kind, "NO_MEMBERS", "an empty set is never complete");
});
