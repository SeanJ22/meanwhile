/**
 * MW-015 / MW-016 / MW-035 — a dead end explains itself from the records the
 * work already wrote, a missing field names its gap, an assignment is complete
 * only when every member obligation passes the completion evaluator, and a
 * Scout's "why a paid model" is the executor decision's own words.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { Attempt } from "../lib/control-plane/attempt.ts";
import { buildAssignments, type AssignmentSources } from "../lib/control-plane/assignment-view.ts";
import { assignmentCompletionWords, evaluateAssignmentCompletion, memberObligations } from "../lib/control-plane/assignment-completion.ts";
import { buildBodyViews, type BodyStoreFacts, type WatchedContract } from "../lib/control-plane/admin-view/bodies.ts";
import { latestScout, routineRuledOut, scoutDeadEnd } from "../lib/control-plane/admin-view/dead-ends.ts";
import { standingDetail } from "../lib/control-plane/admin-view/work-view.ts";
import type { CompletionSnapshot } from "../lib/control-plane/completion.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import type { RouteTask } from "../lib/control-plane/route-task.ts";
import type { StandingObligation } from "../lib/control-plane/scheduler/durable.ts";
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

/* ------------------------------------------------------------ MW-016: the walk */

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

/* ------------------------------------------------------------ MW-016 / MW-035: standing work */

function attempt(id: string): Attempt {
  return {
    id, routeTaskId: "rt-1", workItemId: "wi-1",
    worker: { role: "SCOUT", provider: "anthropic", version: "claude-opus-5-5", instance: "fixture@1" },
    leaseId: `ls-${id}`, startedAt: "2026-09-24T09:59:00.000Z", endedAt: "2026-09-24T10:00:00.000Z", outcome: "ABORTED",
    abortReason: "the worker reached no boundary. SCOUT_NO_PROGRESS (BOUND)", artifactIds: [],
    cost: { inputTokens: null, outputTokens: null, usd: 0.4, durationMs: null, bytesFetched: null, requestCount: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false },
    methodVersion: 1, policyVersion: "fixture",
  };
}

function sources(scouts: readonly ScoutResult[]): AssignmentSources {
  const obligation: StandingObligation = {
    id: OB, recordClass: "candidate-enrichment", subjectId: "nj:2026:poe-pat", routeId: "candidate-authored-awaits-site", active: true,
    readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null, nextDueAt: PAST, occurrenceCount: 1, openOccurrenceId: null, updatedAt: PAST,
  };
  const workItem: WorkItem = {
    id: "wi-1", project: "freshness", subject: "nj:2026:poe-pat", obligation: `${OB}#1`, why: "fixture", priority: "P2", state: "OPEN",
    contract: { inheritedRouteFloor: [], requiresValidation: true, requiresAudit: false, requiresCompleteDenominator: false, acceptableDispositions: null, instrumentEvidence: null },
    dependencies: [], routeTaskIds: [], escalations: [], createdAt: PAST, transitions: [{ from: null, to: "OPEN", at: PAST, by: "control-plane", why: "fixture" }],
  };
  const task: RouteTask = {
    id: "rt-1", workItemId: "wi-1", routeId: "candidate-authored-awaits-site", routeLabel: "candidate-authored-awaits-site", target: "fixture",
    inherited: true, state: "RECLAIMABLE", disposition: null, attemptIds: scouts.map((s) => s.attemptId), createdAt: PAST,
  } as RouteTask;
  return {
    nowIso: NOW,
    obligations: [obligation],
    occurrences: [{ id: `occ-${OB}-000001`, obligationId: OB, sequence: 1, dueAt: PAST, workItemId: "wi-1", routeTaskId: "rt-1", openedAt: PAST, closedAt: "2026-09-24T10:00:00.000Z", disposition: null, unresolvedReason: "no terminal disposition was reached: SCOUT_NO_PROGRESS" }],
    workItems: [workItem],
    routeTasks: [task],
    attempts: scouts.map((s) => attempt(s.attemptId)),
    debts: [{ obligationId: OB, cause: "UPSTREAM_ERROR", detail: "fixture debt", target: "fixture", dueAt: PAST, firstFailedAt: PAST, lastFailedAt: "2026-09-24T10:00:00.000Z", consecutiveFailures: 3, retryAt: "2026-09-25T18:00:00.000Z" }],
    leases: [],
    dispositions: null,
    artifacts: [],
    costs: [],
    scoutResults: scouts,
    workerResults: [],
    pipeline: [],
    activation: readActivationGate(""),
    servedReader: null,
    pilotZips: [],
  };
}

test("MW-016: an opened failed assignment reads its dead end from the latest walk, not the debt's backoff sentence", () => {
  const scouts = [scout()];
  const row = buildAssignments(sources(scouts)).find((r) => r.id === OB)!;
  assert.equal(row.state, "FAILED");
  const [dead] = standingDetail(row, { scouts }).unsettled;
  assert.match(dead!.ruledOut ?? "", /primary-site-navigation at https:\/\/example\.gov\/1 \(HTTP 403\)/);
  assert.match(dead!.wouldSettle ?? "", /read the county filing index/);
  assert.match(dead!.whoMoves ?? "", /walked the ladder to the floor/);
  // Not read with it: each field says so, rather than a backoff sentence posing as "ruled out".
  const [unread] = standingDetail(row).unsettled;
  assert.equal(unread!.ruledOut, null);
  assert.match(unread!.gaps?.ruledOut ?? "", /Scout results for this work were not read/);
});

test("MW-016: a refused finish says what its walk ruled out and would try next", () => {
  const refused = scout({ attemptId: "at-2", recordedAt: "2026-09-24T11:00:00.000Z", refusal: [{ code: "SCOUT_EARLY_ABSENCE", detail: "an absence below the rung minimum" }] as never });
  const scouts = [scout(), refused];
  const row = buildAssignments(sources(scouts)).find((r) => r.id === OB)!;
  const refusedBox = standingDetail(row, { scouts }).unsettled.find((u) => u.pill === "REFUSED")!;
  assert.match(refusedBox.title, /an absence below the rung minimum/);
  assert.notEqual(refusedBox.wouldSettle, null, "a refused finish now names what would settle it");
  assert.match(refusedBox.ruledOut ?? "", /tried and failed/);
});

test("MW-035: the Scout's 'why a paid model' is the executor decision's reason, not a fixed sentence", () => {
  const scouts = [scout()];
  const row = buildAssignments(sources(scouts)).find((r) => r.id === OB)!;
  const model = standingDetail(row, { scouts }).models.find((m) => m.step.includes("Scout"))!;
  assert.match(model.why, /^Executor decision: a bounded model worker \(the Scout\), because route candidate-authored-awaits-site has no machine-executable opening; genuine unresolved novelty runs a bounded Scout\./);
  assert.doesNotMatch(model.why, /by standing rule/);
  assert.match(standingDetail(row).models.find((m) => m.step.includes("Scout"))!.why, /^Why the executor sent this to a paid Scout was not read with it\./);
});

test("MW-031/MW-033: the Scout line states the class chosen, why, and an escalation's evidence and combined cost; the cost line counts escalations from the walks, never 'recorded nowhere'", () => {
  const escalated = scout({
    attemptId: "at-3",
    recordedAt: "2026-09-25T10:00:00.000Z",
    startedAt: "2026-09-25T09:58:00.000Z",
    usd: 0.0429,
    worker: { provider: "anthropic", model: "claude-opus-5-5", modelReported: "claude-opus-5-5" },
    modelClass: "frontier",
    modelClassWhy: "Sonnet 5 is the cheapest class that accepts this loop's request; it moves up to the frontier only when the Sonnet attempt shows a recorded reason (MW-033)",
    escalatedFrom: "sonnet",
    escalationReason: "RESULT_REFUSED",
    escalationEvidence: "finish refused after 4 turn(s): SCOUT_CANDIDATE_WITHOUT_EVIDENCE",
    escalationRefused: null,
    modelAttempts: [
      { modelClass: "sonnet", model: "claude-sonnet-5-5", turns: 4, usd: 0.0124, accepted: false },
      { modelClass: "frontier", model: "claude-opus-5-5", turns: 2, usd: 0.0305, accepted: true },
    ],
  });
  const scouts = [scout(), escalated];
  const row = buildAssignments(sources(scouts)).find((r) => r.id === OB)!;
  const detail = standingDetail(row, { scouts });
  const line = detail.models.find((m) => m.step.includes("Scout"))!;
  assert.match(line.why, /Started on Claude Sonnet 5.5: Sonnet 5 is the cheapest class that accepts this loop's request/, "the class chosen and why, from the result");
  assert.match(line.why, /A Scout moved from Claude Sonnet 5.5 to Claude Opus 5\.5 on Sep 25 because its answer failed our checks and was never fixed \(finish refused after 4 turn\(s\): SCOUT_CANDIDATE_WITHOUT_EVIDENCE\); both tries together cost \$0\.0429 \(\$0\.0124 \+ \$0\.0305\)\./);
  assert.doesNotMatch(line.why, /most capable class by standing rule/);
  const all = `${detail.costLine} ${detail.modelsNote}`;
  assert.doesNotMatch(all, /recorded nowhere/);
  assert.match(detail.modelsNote, /records the class it started on and why, and any move up a class/);

  /* A measured cost line counts the escalations from the walks read with the work — or says they were not read. */
  const counted = standingDetail({ ...row, cost: { ...row.cost, dollars: { kind: "MEASURED", amount: 0.4429 } } } as typeof row, { scouts });
  assert.match(counted.costLine, /Model-routing escalations: 1 on record for this work\. Latest: A Scout moved from Claude Sonnet 5.5 to Claude Opus 5\.5/);
  const none = standingDetail({ ...row, cost: { ...row.cost, dollars: { kind: "MEASURED", amount: 0.4 } } } as typeof row, { scouts: [scout()] });
  assert.match(none.costLine, /Model-routing escalations: none — its Scout walk finished on the class it started on\./);
  const unread = standingDetail({ ...row, cost: { ...row.cost, dollars: { kind: "MEASURED", amount: 0.4 } } } as typeof row);
  assert.match(unread.costLine, /Model-routing escalations: not read with this work\./);
  /* A walk recorded before the ladder says when it ran, not a rule as though it still held. */
  const legacy = standingDetail(row, { scouts: [scout()] }).models.find((m) => m.step.includes("Scout"))!;
  assert.match(legacy.why, /this walk was recorded before the ladder \(Sep 25\), when the research loop always started on the most capable class\./);
});

/* ------------------------------------------------------------ MW-016: routine reads */

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

/* ------------------------------------------------------------ MW-015: visited is not finished */

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
