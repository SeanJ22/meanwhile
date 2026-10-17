import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { Attempt, ExecutionLease, WorkerRole } from "../lib/control-plane/attempt.ts";
import {
  OBLIGATION_PROVIDER_PREFIXES,
  buildAssignmentView,
  bodyPublicationAttempts,
  buildAssignments,
  assignmentCountClaims,
  assignmentRenderedNumbers,
  assignmentRowNumbers,
  combinedCountNumbers,
  combinedCounts,
  eligibleAtOf,
  isSharedCost,
  jurisdictionKeyOf,
  listRowOf,
  workerModelOf,
  type AssignmentRow,
  type AssignmentSources,
} from "../lib/control-plane/assignment-view.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { assertAggregateOnly, auditRenderedNumbers, checkStatedEqualsRendered } from "../lib/control-plane/owner-surface.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { AggregateRepository } from "../lib/control-plane/repository/types.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { readAllAssignmentSources } from "../lib/control-plane/assignment-read.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import type { RouteDisposition, RouteTask } from "../lib/control-plane/route-task.ts";
import type { FreshnessDebt } from "../lib/control-plane/scheduler/debt.ts";
import type { FreshnessOccurrence, StandingObligation } from "../lib/control-plane/scheduler/durable.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";

const NOW = "2026-09-22T12:00:00.000Z";
const PAST = "2026-09-15T12:00:00.000Z";
const FUTURE = "2026-09-23T12:00:00.000Z";

const CE = "freshness:candidate-enrichment:nj:2026:state-nj-place-rockaway:member-of-the-borough-council";

function obligation(id: string, over: Partial<StandingObligation> = {}): StandingObligation {
  const route = id.split("#")[1] ?? null;
  return {
    id,
    recordClass: "candidate-enrichment",
    subjectId: id.replace(/^freshness:candidate-enrichment:/, "").replace(/#.*$/, ""),
    routeId: route,
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: null,
    nextDueAt: PAST,
    occurrenceCount: 1,
    openOccurrenceId: null,
    updatedAt: PAST,
    ...over,
  };
}

function occurrence(obligationId: string, seq: number, wi: string, rt: string, over: Partial<FreshnessOccurrence> = {}): FreshnessOccurrence {
  return {
    id: `occ-${obligationId}-${String(seq).padStart(6, "0")}`,
    obligationId,
    sequence: seq,
    dueAt: PAST,
    workItemId: wi,
    routeTaskId: rt,
    openedAt: PAST,
    closedAt: "2026-09-22T10:00:00.000Z",
    disposition: null,
    unresolvedReason: null,
    ...over,
  };
}

function workItem(id: string, over: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    project: "freshness",
    subject: "nj:county:county-of-atlantic",
    obligation: "Acquire the official county clerk publication",
    why: "fixture",
    priority: "P2",
    state: "OPEN",
    contract: {
      inheritedRouteFloor: [],
      requiresValidation: true,
      requiresAudit: false,
      requiresCompleteDenominator: false,
      acceptableDispositions: null,
      instrumentEvidence: null,
    },
    dependencies: [],
    routeTaskIds: [],
    escalations: [],
    createdAt: PAST,
    transitions: [{ from: null, to: "OPEN", at: PAST, by: "control-plane", why: "fixture" }],
    ...over,
  };
}

function disposition(p: Partial<RouteDisposition> & Pick<RouteDisposition, "disposition" | "attemptId">): RouteDisposition {
  return {
    at: "2026-09-22T10:00:00.000Z",
    artifactIds: [],
    observation: null,
    permission: "ALLOWED",
    transport: "REACHABLE",
    note: "fixture note",
    ...p,
  };
}

function routeTask(id: string, workItemId: string, over: Partial<RouteTask> = {}): RouteTask {
  return {
    id,
    workItemId,
    routeId: "fixture-route",
    routeLabel: "fixture-route",
    target: "fixture",
    inherited: true,
    state: "PENDING",
    disposition: null,
    attemptIds: [],
    createdAt: PAST,
    ...over,
  };
}

const PLAIN = { role: "ACQUIRER" as WorkerRole, provider: "we-the-people", version: "route-executor/1.0 (fixture)", instance: "fixture@1" };
const OPUS = { role: "SCOUT" as WorkerRole, provider: "anthropic", version: "claude-opus-5", instance: "fixture@2" };

function attempt(id: string, routeTaskId: string, workItemId: string, over: Partial<Attempt> = {}): Attempt {
  return {
    id,
    routeTaskId,
    workItemId,
    worker: PLAIN,
    leaseId: `ls-${id}`,
    startedAt: "2026-09-22T09:59:00.000Z",
    endedAt: "2026-09-22T10:00:00.000Z",
    outcome: "COMPLETED",
    abortReason: null,
    artifactIds: [],
    cost: {
      inputTokens: null,
      outputTokens: null,
      usd: null,
      durationMs: null,
      bytesFetched: null,
      requestCount: null,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      cacheCreation5mInputTokens: null,
      cacheCreation1hInputTokens: null,
      uncachedInputTokens: null,
      batch: false,
    },
    methodVersion: 1,
    policyVersion: "fixture",
    ...over,
  };
}

function cost(a: Attempt, usd: number | null, over: Partial<CostEntry["cost"]> = {}, entry: Partial<CostEntry> = {}): CostEntry {
  return {
    attemptId: a.id,
    workItemId: a.workItemId,
    routeTaskId: a.routeTaskId,
    routeId: "fixture-route",
    source: null,
    jurisdiction: null,
    project: "freshness",
    role: a.worker.role,
    cost: { ...a.cost, usd, requestCount: 1, bytesFetched: 1000, durationMs: 800, ...over },
    recordedAt: "2026-09-22T10:00:00.000Z",
    ...entry,
  };
}

function artifact(id: string, a: Attempt, over: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    artifactId: id,
    workItemId: a.workItemId,
    routeTaskId: a.routeTaskId,
    attemptId: a.id,
    tier: "RAW",
    contentHash: `sha256-${id}`,
    byteLength: 1000,
    contentType: "application/json",
    canonicalUrl: `https://example.gov/${id}`,
    partial: false,
    recordedAt: "2026-09-22T10:00:00.000Z",
    ...over,
  };
}

function scout(a: Attempt, obligationId: string, over: Partial<ScoutResult> = {}): ScoutResult {
  return {
    formatVersion: 1,
    attemptId: a.id,
    obligationId,
    routeTaskId: a.routeTaskId,
    workItemId: a.workItemId,
    subjectId: "fixture",
    routeId: "candidate-authored-awaits-site",
    recordClass: "candidate-enrichment",
    providerId: "candidate-enrichment",
    reason: "fixture",
    outcome: "NO_PROGRESS",
    stoppedBy: "BOUND",
    rungs: [],
    distinctEvidenceRungs: 0,
    candidates: [],
    findings: [],
    nextRungs: [],
    unverified: [],
    narrative: "fixture",
    worker: { provider: "anthropic", model: "claude-opus-5", modelReported: "claude-opus-5" },
    usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, turns: 1, toolCalls: 1 },
    usd: 0.5,
    elapsedMs: 1000,
    artifactIds: [],
    methodCandidateIds: [],
    refusal: null,
    startedAt: "2026-09-22T09:59:00.000Z",
    recordedAt: "2026-09-22T10:00:00.000Z",
    ...over,
  };
}

function debt(obligationId: string, over: Partial<FreshnessDebt> = {}): FreshnessDebt {
  return {
    obligationId,
    cause: "UPSTREAM_ERROR",
    detail: "fixture debt",
    target: "fixture",
    dueAt: PAST,
    firstFailedAt: "2026-09-19T00:00:00.000Z",
    lastFailedAt: "2026-09-22T10:00:00.000Z",
    consecutiveFailures: 2,
    retryAt: "2026-09-22T11:00:00.000Z",
    ...over,
  };
}

function rung(i: number) {
  return { index: i, rung: "primary-site-navigation", tool: "fetch_public", target: `https://example.gov/${i}`, observed: "HTTP 200", artifactIds: [`ar-r${i}`], note: null, at: NOW };
}

function empty(): AssignmentSources {
  return {
    nowIso: NOW,
    obligations: [],
    occurrences: [],
    workItems: [],
    routeTasks: [],
    attempts: [],
    debts: [],
    leases: [],
    dispositions: null,
    artifacts: [],
    costs: [],
    scoutResults: [],
    workerResults: [],
    pipeline: [],
    activation: null,
    servedReader: null,
    pilotZips: ["07866"],
  };
}

test("body publication attempts expose only recorded public-safe outcomes and retain partial status", () => {
  const work = workItem("wi-body", { autonomousPlan: { publication: { contractId: "registry-runtime:NJ", bodyId: "body-1" },
    contract: { schemaVersion: 2, sourceScope: { canonicalUrls: ["https://example.gov/roster"] } } } as never,
    publicationOutcome: { at: NOW, workerResultId: "wr-1", status: "PARTIALLY_PUBLISHED", code: "MORE_IDENTITIES_OWED",
      detail: "private detail", candidateId: "candidate-1", versionId: "version-1",
      acceptedMembers: [{ recordId: "record-1", memberId: "member-1" }] } });
  assert.deepEqual(bodyPublicationAttempts([work, workItem("wi-no-attempt")]), [{
    bodyId: "body-1", family: "people", workItemId: "wi-body", assignmentKeys: [], assignmentRefs: [], at: NOW, status: "PARTIALLY_PUBLISHED", code: "MORE_IDENTITIES_OWED",
    sourceUrl: "https://example.gov/roster", workerResultId: "wr-1", acceptedCount: 1, versionId: "version-1",
  }]);
  const owned = bodyPublicationAttempts([work], [occurrence("ob-body", 1, "wi-body", "rt-body")],
    [obligation("ob-body", { assignments: [{ assignmentKey: "exact-send", ref: "receipt", relation: "CREATED", at: PAST }] })]);
  assert.deepEqual(owned[0]?.assignmentKeys, ["exact-send"]);
});

test("a later same-key Send does not claim an earlier body publication", () => {
  const key="zcta:2020/85635", oldRef="old-receipt", nextRef="new-receipt";
  const contract={schemaVersion:2,sourceScope:{canonicalUrls:["https://example.gov/roster"]}};
  const publication={contractId:"registry-runtime:NJ",bodyId:"body-1"};
  const prior=workItem("wi-prior",{autonomousPlan:{publication,contract,ownerInstructions:[oldRef]} as never,
    publicationOutcome:{at:"2026-09-18T00:00:00Z",workerResultId:"wr-old",status:"PUBLISHED",code:"ACCEPTED",
      candidateId:"candidate-old",versionId:"version-old"} as never});
  const later=workItem("wi-later",{autonomousPlan:{publication,contract,ownerInstructions:[nextRef]} as never,
    publicationOutcome:{at:NOW,workerResultId:"wr-new",status:"PUBLISHED",code:"ACCEPTED",
      candidateId:"candidate-new",versionId:"version-new"} as never});
  const owner=obligation("ob-body",{assignments:[
    {assignmentKey:key,ref:oldRef,relation:"CREATED",at:PAST},
    {assignmentKey:key,ref:nextRef,relation:"REORDERED",at:"2026-09-20T00:00:00Z"},
  ]});
  const rows=bodyPublicationAttempts([prior,later],[occurrence("ob-body",1,prior.id,"rt-prior"),
    occurrence("ob-body",2,later.id,"rt-later")],[owner]);
  assert.deepEqual(rows.find(row=>row.workItemId===prior.id)?.assignmentRefs,[{key,ref:oldRef}]);
  assert.deepEqual(rows.find(row=>row.workItemId===later.id)?.assignmentRefs,[{key,ref:nextRef}]);
});

test("full index separates latest Attempt from activity and counts only measured dependency unlocks", () => {
  const depends = (upstreamId:string) => ({upstreamId,kind:"PRODUCES_CONSUMES" as const,reason:"Source prerequisite",evidence:["recorded dependency"]});
  const src = { ...empty(), workItems: [
    workItem("upstream"),workItem("verified",{state:"VERIFIED_COMPLETE"}),workItem("other-open"),
    workItem("ready-dependent",{dependencies:[depends("upstream"),depends("verified")]}),
    workItem("still-blocked",{dependencies:[depends("upstream"),depends("other-open")]}),
  ],attempts:[attempt("at-old","route-old","upstream",{startedAt:"2026-09-20T10:00:00.000Z"}),
    attempt("at-new","route-new","upstream",{startedAt:"2026-09-21T10:00:00.000Z",abortReason:"SOURCE_UNAVAILABLE"})] };
  const indexed=buildAssignmentView(src).allRowsIndex?.find(row=>row.id==="upstream");
  assert.equal(indexed?.lastAttemptAt,"2026-09-21T10:00:00.000Z");
  assert.equal(indexed?.directDependentCount,2);
  assert.equal(indexed?.readyAfterThisSettlesCount,1);
  assert.ok(indexed?.historyTerms?.includes("at-new"));
  const unknown={...src,workItems:src.workItems.filter(item=>item.id!=="other-open")};
  assert.equal(buildAssignmentView(unknown).allRowsIndex?.find(row=>row.id==="upstream")?.readyAfterThisSettlesCount,null,
    "an unread upstream cannot be counted as satisfied");
});

test("repair successor costs and publication remain on the original Send assignment", () => {
  const parent = workItem("parent", { obligation: "hunt-root#1" });
  const child = { ...workItem("child"), planRepair: { parentWorkItemId: parent.id, authority: "WORK_INSTRUCTIONS_ONLY" },
    publicationOutcome: { at: NOW, workerResultId: "audit-child", status: "HELD" as const, code: "EXTERNAL_EVIDENCE_MISSING",
      detail: "Independent verification continues automatically", recovery: "WORKER" as const, candidateId: null, versionId: null } };
  const src = { ...empty(), obligations: [obligation("hunt-root", { assignments: [{ assignmentKey: "state:oh", relation: "CREATED" as const, ref: "send-oh", at: PAST }] })],
    workItems: [parent, child] };
  const rows = buildAssignments(src);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "hunt-root");
  assert.deepEqual(buildAssignmentView(src).rows[0].assignmentKeys, ["state:oh"]);
  assert.ok(rows[0].delivery.blockers.some(reason => reason.includes("EXTERNAL_EVIDENCE_MISSING")));
  const orphan = { ...child, planRepair: { ...child.planRepair, parentWorkItemId: "missing-parent" } };
  assert.equal(buildAssignments({ ...src, workItems: [parent, orphan] }).length, 2, "invalid ancestry must remain separately visible");
});

test("state assignment counts cover omitted rows and retain shared or unplaced work separately", () => {
  const src = { ...empty(), workItems: [
    workItem("az-one", { subject: "ocd-division/country:us/state:az/county:cochise" }),
    workItem("az-two", { subject: "ocd-division/country:us/state:az/place:sierra_vista" }),
    workItem("nh-one", { subject: "ocd-division/country:us/state:nh/county:merrimack" }),
    workItem("shared", { subject: "ocd-division/country:us" }),
  ] };
  const view = buildAssignmentView(src, { perGroup: 1 });
  assert.equal(Object.values(view.geographicCounts?.az ?? {}).reduce((a, b) => a + b, 0), 2);
  assert.equal(Object.values(view.geographicCounts?.nh ?? {}).reduce((a, b) => a + b, 0), 1);
  assert.equal(Object.values(view.geographicCounts?.[""] ?? {}).reduce((a, b) => a + b, 0), 1);
  assert.equal(Object.values(view.geographicCounts ?? {}).flatMap(Object.values).reduce((a, b) => a + b, 0), view.summary.total);
  assert.ok(view.selection.omitted > 0);
  assert.equal(view.allRowsIndex?.length, view.summary.total);
  assert.deepEqual(new Set(view.allRowsIndex?.map(row => row.id)), new Set(["az-one", "az-two", "nh-one", "shared"]));
  assert.ok(view.allRowsIndex?.some(row => !view.rows.some(listed => listed.id === row.id)), "an omitted detail retains its exact drilldown id");
  for (const row of buildAssignmentView(src).rows) assert.equal(row.stateCode, row.id.startsWith("az") ? "az" : row.id.startsWith("nh") ? "nh" : null);
});

test("exact Send counts survive trimming and count shared work once per instruction without copying the work", () => {
  const mark = (assignmentKey: string, relation: "CREATED" | "REORDERED" = "CREATED") => ({ assignmentKey, relation, ref: `receipt:${assignmentKey}`, at: NOW });
  const src = { ...empty(), obligations: [
    obligation("hunt-local", { subjectId: "ocd-division/country:us/state:az/place:sierra_vista", assignments: [mark("zip:85635"), mark("zip:85635", "REORDERED")] }),
    obligation("hunt-shared", { subjectId: "ocd-division/country:us", assignments: [mark("zip:85635"), mark("zip:85650")] }),
    obligation("other", { subjectId: "ocd-division/country:us/state:az", assignments: [mark("zip:85001")] }),
  ] };
  const bounded = buildAssignmentView(src, { perGroup: 1 });
  const total = (key: string) => Object.values(bounded.instructionCounts?.[key] ?? {}).reduce((a, b) => a + b, 0);
  assert.deepEqual([total("zip:85635"), total("zip:85650"), total("zip:85001")], [2, 1, 1]);
  assert.equal(bounded.summary.total, 3, "overlapping instructions do not manufacture another work item");
  assert.ok(bounded.selection.omitted > 0);
  assert.deepEqual(bounded.allRowsIndex?.filter(row => row.assignmentKeys.includes("zip:85635")).map(row => row.id).sort(), ["hunt-local", "hunt-shared"]);
  const complete = buildAssignmentView(src);
  assert.deepEqual(complete.rows.find(row => row.id === "hunt-shared")?.assignmentKeys, ["zip:85635", "zip:85650"]);
  assert.deepEqual(complete.rows.find(row => row.id === "hunt-local")?.assignmentKeys, ["zip:85635"]);
});

function merge(...parts: Partial<AssignmentSources>[]): AssignmentSources {
  const out = empty() as { -readonly [K in keyof AssignmentSources]: AssignmentSources[K] };
  for (const p of parts) {
    for (const [k, v] of Object.entries(p)) {
      const key = k as keyof AssignmentSources;
      if (Array.isArray(v) && Array.isArray(out[key])) (out as Record<string, unknown>)[key] = [...(out[key] as unknown[]), ...v];
      else (out as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}

/** A: a plain-code acquisition that INGESTED one document; next reading not yet due. */
function worldA(): Partial<AssignmentSources> {
  const id = `${CE}:doe-jane#candidate-marginalia-index`;
  const a = attempt("at-a1", "rt-a1", "wi-a1", { artifactIds: ["ar-a1"] });
  return {
    obligations: [obligation(id, { nextDueAt: FUTURE, lastWorkedAt: "2026-09-22T10:00:00.000Z" })],
    occurrences: [occurrence(id, 1, "wi-a1", "rt-a1", { disposition: "INGESTED" })],
    workItems: [workItem("wi-a1", { obligation: `${id}#1` })],
    routeTasks: [
      routeTask("rt-a1", "wi-a1", {
        state: "DISPOSED",
        attemptIds: ["at-a1"],
        disposition: disposition({
          disposition: "INGESTED",
          attemptId: "at-a1",
          artifactIds: ["ar-a1"],
          observation: { rawCount: 20, normalizedCount: 0, routeOnlyCount: null, earliest: null, latest: null },
          note: "Marginalia keyword index: HTTP 200, 20 rows. ACQUISITION ONLY: nothing here is normalized and nothing is promoted to reader truth.",
        }),
      }),
    ],
    attempts: [a],
    costs: [cost(a, null, { requestCount: 1, bytesFetched: 9615, durationMs: 800 })],
    artifacts: [artifact("ar-a1", a, { byteLength: 9615 })],
  };
}

/** B: a Scout that proposed a route with vaulted evidence; the found route does not discharge the record. */
function worldB(): Partial<AssignmentSources> {
  const id = `${CE}:roe-rick#candidate-authored-awaits-site`;
  const a = attempt("at-b1", "rt-b1", "wi-b1", { worker: OPUS, artifactIds: ["ar-b1", "ar-b2"] });
  const s = scout(a, id, {
    outcome: "ROUTE_CANDIDATE",
    stoppedBy: "MODEL",
    rungs: [rung(1), rung(2), rung(3)],
    distinctEvidenceRungs: 2,
    candidates: [
      {
        routeId: "vote411-race",
        title: "VOTE411 race view",
        url: "https://onyourballot.example.org/race?id=1",
        procedure: "GET the race page",
        relevance: "the candidate's own answers",
        permission: "ALLOWED",
        permissionReading: "robots allow",
        evidenceArtifactIds: ["ar-b1"],
        observedOn: "2026-09-22",
        recordClass: "candidate-enrichment",
        deterministic: true,
        unverified: [],
      },
    ],
    findings: [{ summary: "The candidate's filing names no campaign site.", artifactIds: ["ar-b2"], kind: "RECORD" }],
    artifactIds: ["ar-b1", "ar-b2"],
    usd: 0.75,
  });
  return {
    obligations: [obligation(id, { nextDueAt: PAST })],
    occurrences: [occurrence(id, 1, "wi-b1", "rt-b1")],
    workItems: [workItem("wi-b1", { obligation: `${id}#1` })],
    routeTasks: [
      routeTask("rt-b1", "wi-b1", {
        state: "DISPOSED",
        attemptIds: ["at-b1"],
        disposition: disposition({ disposition: "DISCOVERED", attemptId: "at-b1", artifactIds: ["ar-b1", "ar-b2"], note: "ROUTE CANDIDATE(S) proposed" }),
      }),
    ],
    attempts: [a],
    scoutResults: [s],
    costs: [cost(a, 0.75, { requestCount: 12 })],
    artifacts: [artifact("ar-b1", a), artifact("ar-b2", a, { canonicalUrl: "https://clerk.example.gov/filings.pdf" })],
    debts: [debt(id, { cause: "REFUSED_BY_HOST", consecutiveFailures: 2, retryAt: "2026-09-22T18:00:00.000Z" })],
  };
}

/** C: a Scout that walked the ladder and found nothing; failure backoff has elapsed. */
function worldC(): Partial<AssignmentSources> {
  const id = `${CE}:poe-pat#candidate-authored-awaits-site`;
  const a = attempt("at-c1", "rt-c1", "wi-c1", {
    worker: OPUS,
    outcome: "ABORTED",
    abortReason: "the worker reached no boundary. SCOUT_NO_PROGRESS (BOUND): 4 rung(s) walked",
  });
  return {
    obligations: [obligation(id, { nextDueAt: PAST })],
    occurrences: [occurrence(id, 1, "wi-c1", "rt-c1", { unresolvedReason: "no terminal disposition was reached: SCOUT_NO_PROGRESS" })],
    workItems: [workItem("wi-c1", { obligation: `${id}#1` })],
    routeTasks: [routeTask("rt-c1", "wi-c1", { state: "RECLAIMABLE", attemptIds: ["at-c1"] })],
    attempts: [a],
    scoutResults: [scout(a, id, { outcome: "NO_PROGRESS", rungs: [rung(1), rung(2), rung(3), rung(4)], distinctEvidenceRungs: 4, nextRungs: ["re-poll the race page", "read the county filing"], usd: 0.4 })],
    costs: [cost(a, 0.4, { requestCount: 9 })],
    debts: [debt(id, { consecutiveFailures: 3, retryAt: "2026-09-22T11:00:00.000Z" })],
  };
}

/** D: a plain-code walk that hit a wall (BLOCKED_CURRENTLY). */
function worldD(): Partial<AssignmentSources> {
  const id = "freshness:jurisdiction:nh:city:town-of-sutton#meetings-1";
  const a = attempt("at-d1", "rt-d1", "wi-d1");
  return {
    obligations: [obligation(id, { recordClass: "local-jurisdiction", subjectId: "nh:city:town-of-sutton", routeId: "meetings-1" })],
    occurrences: [occurrence(id, 1, "wi-d1", "rt-d1")],
    workItems: [workItem("wi-d1", { obligation: `${id}#1` })],
    routeTasks: [
      routeTask("rt-d1", "wi-d1", {
        state: "DISPOSED",
        attemptIds: ["at-d1"],
        disposition: disposition({ disposition: "BLOCKED_CURRENTLY", attemptId: "at-d1", transport: "CHALLENGED", permission: "CANNOT_TELL", note: "the host answered HTTP 403 to this client" }),
      }),
    ],
    attempts: [a],
    costs: [cost(a, null)],
  };
}

/** E: REQUIRES_NEW_ADAPTER — blocked, and engineering owns the next step. */
function worldE(): Partial<AssignmentSources> {
  const id = "freshness:campaign-finance:az:county:county-of-pima#AZ_SEETHEMONEY_PLAIN_FETCH";
  const a = attempt("at-e1", "rt-e1", "wi-e1");
  return {
    obligations: [obligation(id, { recordClass: "campaign-finance", subjectId: "az:county:county-of-pima", routeId: "AZ_SEETHEMONEY_PLAIN_FETCH" })],
    occurrences: [occurrence(id, 1, "wi-e1", "rt-e1")],
    workItems: [workItem("wi-e1", { obligation: `${id}#1` })],
    routeTasks: [
      routeTask("rt-e1", "wi-e1", {
        state: "DISPOSED",
        attemptIds: ["at-e1"],
        disposition: disposition({ disposition: "REQUIRES_NEW_ADAPTER", attemptId: "at-e1", transport: "OTHER_NAMED_FAILURE", permission: "CANNOT_TELL", note: "seethemoney.az.gov needs an adapter this process does not have" }),
      }),
    ],
    attempts: [a],
    costs: [cost(a, null)],
  };
}

/** F: never reached; its round is open and overdue, and it sits in a failure backoff for being undispatched. */
function worldF(): Partial<AssignmentSources> {
  const id = "freshness:jurisdiction:nj:county:county-of-morris#meetings-1";
  const occ = occurrence(id, 1, "wi-f1", "rt-f1", { closedAt: null, openedAt: "2026-09-10T00:00:00.000Z" });
  return {
    obligations: [
      obligation(id, { recordClass: "local-jurisdiction", subjectId: "nj:county:county-of-morris", routeId: "meetings-1", nextDueAt: PAST, openOccurrenceId: occ.id }),
    ],
    occurrences: [occ],
    workItems: [workItem("wi-f1", { obligation: `${id}#1` })],
    routeTasks: [routeTask("rt-f1", "wi-f1")],
    debts: [debt(id, { cause: "NEVER_DISPATCHED", consecutiveFailures: 2, firstFailedAt: "2026-09-16T00:00:00.000Z", retryAt: "2026-09-22T06:00:00.000Z" })],
  };
}

/** G: the shared Scout pre-warm cost, keyed to no assignment. */
function worldG(): Partial<AssignmentSources> {
  return {
    costs: [
      {
        attemptId: "scout-prewarm:2026-09-22T10:00:00.000Z",
        workItemId: "scout-prewarm",
        routeTaskId: null,
        routeId: "scout:prewarm",
        source: "api.anthropic.com",
        jurisdiction: null,
        project: "freshness",
        role: "SCOUT",
        cost: { ...attempt("x", "x", "x").cost, usd: 0.031, requestCount: 1 },
        recordedAt: "2026-09-22T10:00:10.000Z",
      },
    ],
  };
}

/** H: model work that reported no dollar figure. */
function worldH(): Partial<AssignmentSources> {
  const id = `${CE}:loe-lou#candidate-authored-awaits-site`;
  const a = attempt("at-h1", "rt-h1", "wi-h1", { worker: OPUS, outcome: "ABORTED", abortReason: "the worker reached no boundary. SCOUT_RESULT_REFUSED: SCOUT_TRANSPORT_FAILED" });
  return {
    obligations: [obligation(id)],
    occurrences: [occurrence(id, 1, "wi-h1", "rt-h1")],
    workItems: [workItem("wi-h1", { obligation: `${id}#1` })],
    routeTasks: [routeTask("rt-h1", "wi-h1", { state: "RECLAIMABLE", attemptIds: ["at-h1"] })],
    attempts: [a],
    scoutResults: [scout(a, id, { refusal: [{ code: "SCOUT_TRANSPORT_FAILED", detail: "the provider did not answer" }], usd: null })],
    costs: [cost(a, null, { requestCount: 3 })],
  };
}

/** I: an old Attempt whose model was never recorded. */
function worldI(): Partial<AssignmentSources> {
  const id = `${CE}:moe-mia#candidate-authored-awaits-site`;
  const a = attempt("at-i1", "rt-i1", "wi-i1", { worker: { role: "SCOUT", provider: "anthropic", version: "", instance: "old@1" }, outcome: "ABORTED", abortReason: "an old run" });
  return {
    obligations: [obligation(id)],
    occurrences: [occurrence(id, 1, "wi-i1", "rt-i1")],
    workItems: [workItem("wi-i1", { obligation: `${id}#1` })],
    routeTasks: [routeTask("rt-i1", "wi-i1", { state: "RECLAIMABLE", attemptIds: ["at-i1"] })],
    attempts: [a],
  };
}

/** J: a created fleet work item waiting for its validator. K: a conformance row. L: a retired clock. M: a live worker. N: a lost worker. */
function worldJKLMN(): Partial<AssignmentSources> {
  const aj = attempt("at-j1", "rt-j1", "wi-j", { artifactIds: ["ar-j1"] });
  const wr = {
    id: "wr-j1",
    schemaVersion: 1,
    workItemId: "wi-j",
    routeTaskId: "rt-j1",
    attemptId: "at-j1",
    endedAt: "2026-09-22T10:00:00.000Z",
    result: { role: "ACQUIRER", attemptId: "at-j1", verdict: "ACQUIRED", findings: [], blockers: [], artifactIds: ["ar-j1"] },
  } as unknown as WorkerResultRecord;
  const lOb = obligation("freshness:meetings:az:pima#legacy", { active: false, nextDueAt: null, retiredAt: "2026-09-10T00:00:00.000Z", retirementReason: "authority transferred to the routine meeting-partition contract" });
  const mId = `${CE}:zoe-zed#candidate-wikipedia-api`;
  const mOcc = occurrence(mId, 1, "wi-m1", "rt-m1", { closedAt: null });
  const am = attempt("at-m1", "rt-m1", "wi-m1", { outcome: null, endedAt: null, leaseId: "ls-m1" });
  const nId = `${CE}:yoe-yan#candidate-wikipedia-api`;
  const an = attempt("at-n1", "rt-n1", "wi-n1", { outcome: null, endedAt: null, leaseId: "ls-n1" });
  const leases: ExecutionLease[] = [
    { id: "ls-m1", routeTaskId: "rt-m1", holder: "runner", claimedAt: NOW, expiresAt: "2026-09-22T12:05:00.000Z", heartbeatAt: NOW, released: false },
    { id: "ls-n1", routeTaskId: "rt-n1", holder: "runner", claimedAt: PAST, expiresAt: "2026-09-15T12:05:00.000Z", heartbeatAt: PAST, released: false },
  ];
  return {
    obligations: [lOb, obligation(mId, { openOccurrenceId: mOcc.id }), obligation(nId)],
    occurrences: [mOcc, occurrence(nId, 1, "wi-n1", "rt-n1", { closedAt: null })],
    workItems: [
      workItem("wi-j", { state: "AWAITING_VALIDATION", routeTaskIds: ["rt-j1"], obligation: "Acquire and independently verify the official meeting-document source universe" }),
      workItem("wi-k", { project: "conformance-abc123", obligation: "prove:the-interface" }),
      workItem("wi-m1", { obligation: `${mId}#1` }),
      workItem("wi-n1", { obligation: `${nId}#1` }),
    ],
    routeTasks: [
      routeTask("rt-j1", "wi-j", { state: "RESULT_RECORDED", attemptIds: ["at-j1"] }),
      routeTask("rt-m1", "wi-m1", { state: "CLAIMED", attemptIds: ["at-m1"] }),
      routeTask("rt-n1", "wi-n1", { state: "CLAIMED", attemptIds: ["at-n1"] }),
    ],
    attempts: [aj, am, an],
    workerResults: [wr],
    leases,
  };
}

function world(): AssignmentSources {
  return merge(worldA(), worldB(), worldC(), worldD(), worldE(), worldF(), worldG(), worldH(), worldI(), worldJKLMN());
}

function rowOf(rows: readonly AssignmentRow[], idPart: string): AssignmentRow {
  const row = rows.find((r) => r.id.includes(idPart));
  assert.ok(row, `no assignment matching ${idPart}`);
  return row;
}

test("projected publisher listings retain the full assignment view and named gaps", async () => {
  const original = world();
  const scope = { key: "exact-send", receiptId: "receipt" } as ExpansionScopeDecision;
  const source = { ...original,
    obligations: [...original.obligations, obligation("timed-obligation", { subjectId: "timed-subject",
      assignments: [{ assignmentKey: scope.key, ref: scope.receiptId, relation: "CREATED" as const, at: PAST }] })],
    occurrences: [...original.occurrences, occurrence("timed-obligation", 1, "timed-work", "timed-route")],
    workItems: [...original.workItems, workItem("timed-work", { subject: "timed-subject", createdAt: PAST,
      autonomousPlan: { contract: { recordClass: "OFFICIAL_ROSTER" }, ownerInstructions: [scope.receiptId] } as never })],
    attempts: [...original.attempts, attempt("timed-attempt", "timed-route", "timed-work", {
      startedAt: NOW, endedAt: NOW, cost: { ...original.attempts[0].cost, durationMs: 43131 } })],
  };
  const repos = createMemoryRepositories();
  const seed = async <T,>(repo: AggregateRepository<T>, rows: readonly T[], id: (row: T) => string) => {
    for (const row of rows) await repo.put(id(row), row, NOW);
  };
  await seed(repos.obligations, source.obligations, row => row.id);
  await seed(repos.occurrences, source.occurrences, row => row.id);
  await seed(repos.workItems, source.workItems, row => row.id);
  await seed(repos.routeTasks, source.routeTasks, row => row.id);
  await seed(repos.attempts, source.attempts, row => row.id);
  await seed(repos.debts, source.debts, row => row.obligationId);
  await seed(repos.leases, source.leases ?? [], row => row.routeTaskId);
  for (const [i, row] of source.artifacts.entries()) await repos.artifacts.append(row.workItemId, `artifact-${i}`, row, NOW);
  for (const [i, row] of source.scoutResults.entries()) await repos.scoutResults.append(row.workItemId, `scout-${i}`, row, NOW);
  for (const [i, row] of source.workerResults.entries()) await repos.workerResults.append(row.workItemId, `worker-${i}`, row, NOW);
  const full = <T,>(repo: AggregateRepository<T>): AggregateRepository<T> => ({ ...repo, listNarrowed: () => repo.list() });
  const fullRepos = { ...repos, obligations: full(repos.obligations), occurrences: full(repos.occurrences),
    workItems: full(repos.workItems), routeTasks: full(repos.routeTasks), attempts: full(repos.attempts), debts: full(repos.debts) };
  const base = { nowIso: NOW, activation: source.activation, pilotZips: source.pilotZips };
  const already = { costs: source.costs, pipeline: source.pipeline };
  const before = await readAllAssignmentSources(fullRepos, base, already);
  const after = await readAllAssignmentSources(repos, base, already);
  assert.deepEqual(buildAssignments(after), buildAssignments(before));
  assert.deepEqual(buildAssignmentView(after), buildAssignmentView(before));
  assert.ok(Buffer.byteLength(JSON.stringify(after)) < Buffer.byteLength(JSON.stringify(before)),
    "unused replay and task fields no longer reach the publisher");
  assert.ok(after.attempts.every(row => !("usd" in row.cost) && !("policyVersion" in row)));
  assert.ok((await repos.attempts.list()).every(row => "cost" in row.value && "policyVersion" in row.value));
});

test("succeeded (plain code, INGESTED with a document): downloads counted, the parse gap named, the cost plain code — never $0", () => {
  const rows = buildAssignments(world());
  const a = rowOf(rows, "doe-jane");
  assert.equal(a.state, "SUCCEEDED");
  assert.equal(a.lane, "ROUTINE");
  assert.equal(a.kind, "STANDING_OBLIGATION");
  // 1 — where comes from the candidacy's own jurisdiction segment, through the one display projection.
  assert.ok(a.what.where.held && a.what.where.value.name === "Rockaway, New Jersey");
  assert.ok(a.what.workers.held && a.what.workers.value[0].model.kind === "PLAIN_CODE");
  assert.notEqual(a.what.why.band?.band, undefined, "the row is placed in a band by its own provider, not by a pilot list")
  assert.ok((a.what.why.band?.band ?? 0) >= 2, "CH-12: a former pilot place has no band 1 of its own");
  // 2 — the source's own row count, and the one vaulted document.
  assert.ok(a.discovery.discovered.held && a.discovery.discovered.value.sourceRows === 20);
  assert.ok(a.discovery.downloaded.held);
  assert.equal(a.discovery.downloaded.value.count, 1);
  assert.deepEqual([a.discovery.downloaded.value.complete.value, a.discovery.downloaded.value.complete.denominator], [1, 1]);
  assert.equal(a.discovery.downloaded.value.items[0].url, "https://example.gov/ar-a1");
  // 3 — acquisition-only: a named gap, not "0 usable records".
  assert.equal(a.parsing.parsed.held, false);
  assert.match(!a.parsing.parsed.held ? a.parsing.parsed.gap.says : "", /acquisition-only.*20 rows/);
  // 5 — the live gate is open; acquisition alone proves no publication.
  assert.equal(a.delivery.promoted.held, false);
  assert.equal(a.delivery.publiclyAvailable.held, false);
  assert.equal(!a.delivery.publiclyAvailable.held && a.delivery.publiclyAvailable.gap.whose, "OURS");
  // 6 — plain code: no model charge, and no $0 figure pretending to be one.
  assert.equal(a.cost.dollars.kind, "PLAIN_CODE");
  assert.equal(listRowOf(a).cost.usd, null);
  assert.equal(a.cost.nonDollar?.bytes, 9615);
  // 7 — nothing waiting; the next reading is in the future.
  assert.equal(a.waiting.waiting, false);
  assert.equal(a.waiting.overdue, false);
  assert.equal(a.waiting.owner, "RUNNER");
  assert.match(a.waiting.nextAction, /Next reading due 2026-09-23/);
  // Evidence carries the disposition note verbatim.
  assert.ok(a.evidence.notes.some((n) => /ACQUISITION ONLY/.test(n.text)));
});

test("succeeded (Scout ROUTE_CANDIDATE with artifacts): the model recorded", () => {
  const rows = buildAssignments(world());
  const b = rowOf(rows, "roe-rick");
  assert.equal(b.state, "SUCCEEDED");
  assert.equal(b.lane, "SCOUT");
  assert.ok(b.what.workers.held);
  const w = b.what.workers.value[0];
  assert.deepEqual([w.role, w.model.kind, w.model.kind === "MODEL" ? w.model.id : null, w.reportedModels], ["SCOUT", "MODEL", "claude-opus-5", ["claude-opus-5"]]);
  assert.ok(b.discovery.discovered.held);
  assert.deepEqual([b.discovery.discovered.value.routes, b.discovery.discovered.value.records, b.discovery.discovered.value.sourceRows], [1, 1, null]);
  assert.ok(b.discovery.downloaded.held && b.discovery.downloaded.value.count === 2);
  // 6 — measured dollars with a denominator.
  assert.equal(b.cost.dollars.kind, "MEASURED");
  assert.ok(b.cost.dollars.kind === "MEASURED" && b.cost.dollars.usd.held && b.cost.dollars.usd.value.value === 0.75);
  // 7 — a found route does not discharge the record: still owed, held by its backoff until the retry time.
  assert.ok(b.waiting.backoff !== null);
  assert.equal(b.waiting.eligibleAt, "2026-09-22T18:00:00.000Z");
  assert.equal(b.waiting.overdue, false);
  assert.equal(b.waiting.blocker.kind, "NONE");
  assert.match(b.waiting.nextAction, /still owed/);
});

test("failed: a Scout that found nothing and a wall at the source read FAILED; REQUIRES_NEW_ADAPTER reads BLOCKED on engineering", () => {
  const rows = buildAssignments(world());
  const c = rowOf(rows, "poe-pat");
  assert.equal(c.state, "FAILED");
  assert.equal(c.lane, "SCOUT");
  assert.match(c.stateSays, /found no route and no record/);
  assert.equal(c.waiting.blocker.kind, "NAMED");
  assert.equal(c.waiting.owner, "RUNNER");
  assert.equal(c.waiting.overdue, true, "due, and its backoff retry has passed");
  assert.equal(c.waiting.since, "2026-09-19T00:00:00.000Z", "the failure streak's age runs from its first failure");
  assert.ok(c.evidence.notes.some((n) => /SCOUT_NO_PROGRESS/.test(n.text)), "the raw abort reason survives in the evidence");

  const d = rowOf(rows, "town-of-sutton");
  assert.equal(d.state, "FAILED");
  assert.equal(d.lane, "ROUTINE");
  assert.match(d.stateSays, /wall/);

  const e = rowOf(rows, "SEETHEMONEY");
  assert.equal(e.state, "BLOCKED");
  assert.equal(e.waiting.owner, "ENGINEERING");
  assert.match(e.waiting.nextAction, /adapter/);
});

test("a Scout that says only a person can move it is BLOCKED on you, though the runner committed it as a wall", () => {
  const id = `${CE}:hoe-hal#candidate-authored-awaits-site`;
  const a = attempt("at-hr1", "rt-hr1", "wi-hr1", { worker: OPUS, artifactIds: ["ar-hr1"] });
  const rows = buildAssignments(
    merge({
      obligations: [obligation(id)],
      occurrences: [occurrence(id, 1, "wi-hr1", "rt-hr1")],
      workItems: [workItem("wi-hr1", { obligation: `${id}#1` })],
      routeTasks: [
        routeTask("rt-hr1", "wi-hr1", {
          state: "DISPOSED",
          attemptIds: ["at-hr1"],
          // HUMAN_REQUIRED is committed as BLOCKED_CURRENTLY; the Scout's own typed outcome says more.
          disposition: disposition({ disposition: "BLOCKED_CURRENTLY", attemptId: "at-hr1", artifactIds: ["ar-hr1"], note: "PUBLIC RECORD STILL OWED — HUMAN/OFFLINE ACCESS REQUIRED." }),
        }),
      ],
      attempts: [a],
      scoutResults: [scout(a, id, { outcome: "HUMAN_REQUIRED", stoppedBy: "MODEL", rungs: [rung(1), rung(2)], distinctEvidenceRungs: 2 })],
      costs: [cost(a, 0.6)],
      artifacts: [artifact("ar-hr1", a)],
    }),
  );
  const h = rowOf(rows, "hoe-hal");
  assert.equal(h.state, "BLOCKED");
  assert.equal(h.waiting.owner, "OWNER");
  assert.match(h.stateSays, /Only a person or an offline act can move this/);
  assert.match(h.waiting.nextAction, /human or offline step/);
  assert.ok(h.evidence.notes.some((n) => /HUMAN\/OFFLINE ACCESS REQUIRED/.test(n.text)), "the committed disposition's own note is still in the evidence");
});

test("waiting: overdue, in failure backoff, with a named blocker and the owner of the next step", () => {
  const f = rowOf(buildAssignments(world()), "county-of-morris#meetings-1");
  assert.equal(f.state, "WAITING");
  assert.equal(f.lane, "UNASSIGNED");
  assert.equal(f.waiting.waiting, true);
  assert.equal(f.waiting.overdue, true);
  assert.ok(f.waiting.backoff !== null && f.waiting.backoff.failures === 2);
  assert.equal(f.waiting.blocker.kind, "NAMED");
  assert.match(f.waiting.blocker.kind === "NAMED" ? f.waiting.blocker.says : "", /Round 1 was opened .* no worker has reached it yet\..*undispatched in 2 cycles/);
  assert.equal(f.waiting.owner, "RUNNER");
  assert.match(f.waiting.nextAction, /band/);
  assert.ok(f.waiting.openRound !== null && f.waiting.openRound.reached === false);
  // Nothing ran: every part says so by name.
  assert.equal(f.discovery.discovered.held, false);
  assert.equal(f.what.workers.held, false);
  assert.equal(f.cost.dollars.kind, "NOTHING_RAN");
});

test("a shared cost (the Scout pre-warm) is named as shared, joined to no assignment, and never split", () => {
  const src = world();
  const view = buildAssignmentView(src);
  const c = view.summary.costs;
  assert.equal(isSharedCost(src.costs.find((e) => e.workItemId === "scout-prewarm") as CostEntry), true);
  assert.equal(c.shared.rows, 1);
  assert.ok(c.shared.usd.held && c.shared.usd.value.value === 0.031);
  assert.match(c.shared.says, /pre-warm.*not split across assignments/);
  // The ledger total includes it; the attributed total does not.
  assert.ok(c.attributed.held && c.ledgerMeasuredUsd !== null);
  assert.equal(Math.round((c.ledgerMeasuredUsd - c.attributed.value.value) * 1000) / 1000, 0.031);
  assert.ok(buildAssignments(src).every((r) => r.id !== "scout-prewarm"), "the pre-warm is not an assignment");
  assert.equal(c.unattributed.rows, 0);
});

test("an unmeasured cost (usd null on model work) is a named gap in the row, the list row and the summary — never $0", () => {
  const src = world();
  const h = rowOf(buildAssignments(src), "loe-lou");
  assert.equal(h.state, "FAILED");
  assert.equal(h.cost.dollars.kind, "UNMEASURED");
  assert.ok(h.cost.dollars.kind === "UNMEASURED" && /unknown, not zero/.test(h.cost.dollars.gap.says));
  assert.equal(h.cost.unmeasured, 1);
  const list = listRowOf(h);
  assert.equal(list.cost.kind, "UNMEASURED");
  assert.equal(list.cost.usd, null, "an unmeasured cost carries no dollar figure at all");
  assert.equal(list.cost.unmeasured, 1);
  const summary = buildAssignmentView(src).summary.costs.unmeasuredModelRows;
  assert.ok(summary.held && summary.value.value >= 1);
  // And the model transport failure is the blocker, in words.
  assert.match(h.stateSays, /model provider did not answer/);
});

test("a refused hunter finish carries when it was refused, so a refusal quoting an old limit never reads as current", () => {
  const h = rowOf(buildAssignments(world()), "loe-lou");
  assert.equal(h.verification.refusedFinishCount, 1);
  assert.deepEqual(
    h.verification.refusedFinishes.map((r) => [r.attemptId, r.at, r.codes]),
    [["at-h1", "2026-09-22T10:00:00.000Z", ["SCOUT_TRANSPORT_FAILED"]]],
  );
});

test("an Attempt with no model recorded says 'model not recorded' — never an assumed model", () => {
  const i = rowOf(buildAssignments(world()), "moe-mia");
  assert.ok(i.what.workers.held);
  const model = i.what.workers.value[0].model;
  assert.equal(model.kind, "NOT_RECORDED");
  assert.match(model.kind === "NOT_RECORDED" ? model.says : "", /model not recorded/);
  assert.deepEqual(workerModelOf({ role: "SCOUT", provider: "anthropic", version: "", instance: "x" }).kind, "NOT_RECORDED");
  assert.deepEqual(workerModelOf(null).kind, "NOT_RECORDED");
  assert.deepEqual(workerModelOf({ role: "ACQUIRER", provider: "we-the-people", version: "route-executor/1.0 (x)", instance: "x" }).kind, "PLAIN_CODE");
  // Its missing cost row on model work is unknown, not free.
  assert.equal(i.cost.dollars.kind, "UNMEASURED");
});

test("working, worker lost, retired, created and proof: each lands in its own state and lane", () => {
  const rows = buildAssignments(world());
  const m = rowOf(rows, "zoe-zed");
  assert.equal(m.state, "WORKING", "an open attempt holding a live lease");
  const n = rowOf(rows, "yoe-yan");
  assert.equal(n.state, "FAILED", "an open attempt whose lease expired is a lost worker, never 'working'");
  assert.match(n.stateSays, /never closed and holds no live lease/);
  const l = rowOf(rows, "freshness:meetings:az:pima#legacy");
  assert.equal(l.state, "RETIRED");
  assert.equal(l.waiting.owner, "NOBODY");
  const j = rowOf(rows, "wi-j");
  assert.equal(j.kind, "WORK_ITEM");
  assert.equal(j.lane, "CREATED");
  assert.equal(j.state, "WAITING");
  assert.equal(j.waiting.owner, "FLEET");
  const k = rowOf(rows, "wi-k");
  assert.equal(k.lane, "PROOF");
});

test("every number the view draws carries a denominator and a contract, and every stated N equals the rows", () => {
  const src = world();
  const view = buildAssignmentView(src);
  const rows = buildAssignments(src);
  const numbers = [
    ...assignmentRenderedNumbers(view, view.rows),
    ...rows.flatMap(assignmentRowNumbers),
    ...combinedCountNumbers(combinedCounts(view, [])),
  ];
  assert.ok(numbers.length > 20);
  const audit = auditRenderedNumbers(numbers);
  assert.equal(audit.ok, true, audit.detail);
  const claims = checkStatedEqualsRendered(assignmentCountClaims(view));
  assert.equal(claims.ok, true, claims.detail);
  assert.equal(view.summary.total, rows.length);
  assert.equal(view.summary.byState.reduce((n, s) => n + s.count.value, 0), rows.length);
});

test("the published list is bounded, fair across groups, and states exactly what it left out", () => {
  // Thirty never-reached obligations and one of everything else.
  const many = Array.from({ length: 30 }, (_, i) => obligation(`freshness:jurisdiction:nj:city:city-${i}#meetings-1`, { recordClass: "local-jurisdiction", subjectId: `nj:city:city-${i}` }));
  const src = merge(world(), { obligations: many });
  const view = buildAssignmentView(src, { perGroup: 4 });
  const waitingUnassigned = view.summary.groups.find((g) => g.state === "WAITING" && g.lane === "UNASSIGNED");
  assert.ok(waitingUnassigned);
  assert.equal(waitingUnassigned.total, 31);
  assert.equal(waitingUnassigned.published, 4, "a group is capped at perGroup");
  assert.equal(view.selection.published + view.selection.omitted, view.summary.total);
  assert.ok(view.summary.groups.every((g) => g.published >= 1), "every group gets a row before any gets a second");
  // A byte budget too small for everything: the trimmed rows are counted, and the list stays inside it.
  const tight = buildAssignmentView(src, { perGroup: 4, byteBudget: 6_000 });
  assert.ok(tight.selection.trimmedForBytes > 0);
  assert.ok(tight.rows.reduce((n, r) => n + JSON.stringify(r).length, 0) <= 6_000);
  assert.equal(tight.selection.published + tight.selection.omitted, tight.summary.total);
});

test("the byte budget is spent one rank at a time across groups, so a large group never crowds out a small one", () => {
  // Thirty never-reached obligations (WAITING, listed before SUCCEEDED) and one succeeded acquisition.
  const many = Array.from({ length: 30 }, (_, i) => obligation(`freshness:jurisdiction:nj:city:city-${i}#meetings-1`, { recordClass: "local-jurisdiction", subjectId: `nj:city:city-${i}` }));
  const src = merge(worldA(), { obligations: many });
  const open = buildAssignmentView(src, { perGroup: 20, byteBudget: 10_000_000 });
  const size = (r: { readonly id: string }): number => JSON.stringify(r).length;
  const waiting = open.rows.filter((r) => r.state === "WAITING");
  const succeeded = open.rows.filter((r) => r.state === "SUCCEEDED");
  assert.deepEqual([waiting.length, succeeded.length], [20, 1]);
  assert.ok(size(succeeded[0]) > size(waiting[2]), "fixture: the lone succeeded row is larger than a waiting one");
  // Room for exactly two waiting rows and the succeeded one — if, and only if, the ranks interleave.
  const budget = size(waiting[0]) + size(succeeded[0]) + size(waiting[1]);
  const tight = buildAssignmentView(src, { perGroup: 20, byteBudget: budget });
  assert.deepEqual(tight.rows.map((r) => r.id).sort(), [waiting[0].id, waiting[1].id, succeeded[0].id].sort());
  assert.equal(tight.selection.trimmedForBytes, 18, "the other 18 waiting rows the group cap allowed are counted as trimmed");
  assert.equal(tight.selection.omitted, 31 - 3);
  assert.equal(tight.summary.groups.find((g) => g.state === "SUCCEEDED")?.published, 1);
  assert.equal(tight.summary.groups.find((g) => g.state === "WAITING")?.published, 2);
});

test("the published view is aggregate-only and its unknowns stay unknown", () => {
  const view = buildAssignmentView(world());
  assert.doesNotThrow(() => assertAggregateOnly(view, "assignment view"));
  for (const r of view.rows) {
    if (r.cost.kind !== "MEASURED") assert.equal(r.cost.usd, null, `${r.id}: a cost that was not measured carries no figure`);
    if (r.discovered === null) assert.equal(r.downloaded, null, `${r.id}: nothing ran, so nothing is counted as downloaded`);
  }
});

test("the jurisdiction of a candidacy is named through the one display projection; anything else passes through", () => {
  assert.equal(jurisdictionKeyOf("nj:2026:state-nj-place-rockaway:member-of-the-borough-council:x"), "ocd-division/country:us/state:nj/place:rockaway");
  assert.equal(
    jurisdictionKeyOf("nj:2026:state-nj-county-morris-place-randolph-township:member-of-the-township-council:x"),
    "ocd-division/country:us/state:nj/county:morris/place:randolph-township",
  );
  assert.equal(jurisdictionKeyOf("az:2026:state-az-sldl-5:state-representative-district-5:x"), "ocd-division/country:us/state:az/sldl:5");
  assert.equal(jurisdictionKeyOf("nh:2026:state-nh-county-merrimack:merrimack-county-sheriff:x"), "ocd-division/country:us/state:nh/county:merrimack");
  assert.equal(
    jurisdictionKeyOf("nj:2026:state-nj-school-district-randolph-township-school-district:member-of-the-board-of-education:x"),
    "ocd-division/country:us/state:nj/school_district:randolph-township-school-district",
  );
  assert.equal(jurisdictionKeyOf("nj:county:county-of-atlantic"), "nj:county:county-of-atlantic");
  assert.equal(jurisdictionKeyOf("nj:2026:state-nj-weird-thing:office:x"), "nj:2026:state-nj-weird-thing:office:x", "an unrecognised shape is left alone, never guessed");
});

test("the obligation provider prefixes are each provider's own scheduledId template", () => {
  for (const { prefix, providerId } of OBLIGATION_PROVIDER_PREFIXES) {
    const file = `lib/control-plane/scheduler/providers/${providerId}.ts`;
    const source = readFileSync(file, "utf8");
    assert.ok(source.includes(`\`${prefix}\${record.subjectId}#\${route.routeId}\``), `${file} emits ids starting ${prefix}`);
  }
});

test("eligibility is the later of the next-due and the backoff retry", () => {
  assert.equal(eligibleAtOf(PAST, FUTURE), FUTURE);
  assert.equal(eligibleAtOf(FUTURE, PAST), FUTURE);
  assert.equal(eligibleAtOf(null, PAST), PAST);
  assert.equal(eligibleAtOf(null, null), null);
});

test("a retry is work repeated after a failure — a scheduled re-reading after a discharged round is not one", () => {
  // Healthy and recurring: two rounds, each INGESTED on its only attempt.
  const healthyId = "freshness:jurisdiction:nj:county:county-of-sussex#meetings-1";
  const h1 = attempt("at-h-1", "rt-h-1", "wi-h-1");
  const h2 = attempt("at-h-2", "rt-h-2", "wi-h-2", { startedAt: "2026-09-22T10:59:00.000Z", endedAt: "2026-09-22T11:00:00.000Z" });
  // Failing, then recovered: round 1 hit a wall; round 2 aborted once and then ingested.
  const failingId = "freshness:jurisdiction:nj:county:county-of-warren#meetings-1";
  const f1 = attempt("at-f-1", "rt-f-1", "wi-f-1");
  const f2a = attempt("at-f-2a", "rt-f-2", "wi-f-2", { outcome: "ABORTED", abortReason: "timed out", startedAt: "2026-09-22T10:30:00.000Z", endedAt: "2026-09-22T10:31:00.000Z" });
  const f2b = attempt("at-f-2b", "rt-f-2", "wi-f-2", { startedAt: "2026-09-22T10:59:00.000Z", endedAt: "2026-09-22T11:00:00.000Z" });
  const ingested = (id: string) => disposition({ disposition: "INGESTED", attemptId: id });
  const rows = buildAssignments(
    merge({
      obligations: [obligation(healthyId, { recordClass: "local-jurisdiction", subjectId: "nj:county:county-of-sussex", nextDueAt: FUTURE }), obligation(failingId, { recordClass: "local-jurisdiction", subjectId: "nj:county:county-of-warren", nextDueAt: FUTURE })],
      occurrences: [
        occurrence(healthyId, 1, "wi-h-1", "rt-h-1", { disposition: "INGESTED" }),
        occurrence(healthyId, 2, "wi-h-2", "rt-h-2", { disposition: "INGESTED" }),
        occurrence(failingId, 1, "wi-f-1", "rt-f-1"),
        occurrence(failingId, 2, "wi-f-2", "rt-f-2", { disposition: "INGESTED" }),
      ],
      workItems: [workItem("wi-h-1"), workItem("wi-h-2"), workItem("wi-f-1"), workItem("wi-f-2")],
      routeTasks: [
        routeTask("rt-h-1", "wi-h-1", { state: "DISPOSED", attemptIds: ["at-h-1"], disposition: ingested("at-h-1") }),
        routeTask("rt-h-2", "wi-h-2", { state: "DISPOSED", attemptIds: ["at-h-2"], disposition: ingested("at-h-2") }),
        routeTask("rt-f-1", "wi-f-1", { state: "DISPOSED", attemptIds: ["at-f-1"], disposition: disposition({ disposition: "BLOCKED_CURRENTLY", attemptId: "at-f-1", transport: "CHALLENGED" }) }),
        routeTask("rt-f-2", "wi-f-2", { state: "DISPOSED", attemptIds: ["at-f-2a", "at-f-2b"], disposition: ingested("at-f-2b") }),
      ],
      attempts: [h1, h2, f1, f2a, f2b],
    }),
  );
  const healthy = rowOf(rows, "county-of-sussex");
  assert.deepEqual([healthy.state, healthy.cost.attempts, healthy.cost.rounds, healthy.cost.retries], ["SUCCEEDED", 2, 2, 0]);
  const recovered = rowOf(rows, "county-of-warren");
  assert.equal(recovered.state, "SUCCEEDED");
  assert.deepEqual([recovered.cost.attempts, recovered.cost.rounds], [3, 2]);
  assert.equal(recovered.cost.retries, 2, "one extra attempt on round 2, and round 2 itself followed a round that did not discharge");
  assert.match(recovered.cost.says, /3 attempts over 2 rounds \(2 of them retries\)/);
});

test("a parser attempt that aborted without a result is a failed parse run, counted — never 'no parse has run'", () => {
  const parser = { role: "PARSER" as WorkerRole, provider: "we-the-people", version: "civic-record-workers/2.0.0", instance: "fixture@p" };
  const tries = [1, 2, 3].map((i) =>
    attempt(`at-p-${i}`, "rt-p-1", "wi-p", {
      worker: parser,
      outcome: "ABORTED",
      abortReason: "WORKER_ARTIFACT_NOT_IN_VAULT",
      startedAt: `2026-09-22T0${i}:00:00.000Z`,
      endedAt: `2026-09-22T0${i}:01:00.000Z`,
    }),
  );
  const rows = buildAssignments(
    merge({
      workItems: [workItem("wi-p", { obligation: "Parse the vaulted meeting schedule", routeTaskIds: ["rt-p-1"] })],
      routeTasks: [routeTask("rt-p-1", "wi-p", { state: "RECLAIMABLE", attemptIds: tries.map((a) => a.id) })],
      attempts: tries,
    }),
  );
  const p = rowOf(rows, "wi-p");
  assert.equal(p.lane, "CREATED");
  assert.equal(p.state, "FAILED");
  assert.ok(p.parsing.parsed.held, "three parse steps ran");
  assert.deepEqual([p.parsing.parsed.value.runs, p.parsing.parsed.value.succeeded, p.parsing.parsed.value.failed], [3, 0, 3]);
  assert.equal(p.parsing.parsed.value.usable.held, false, "no records were produced: a named gap, not zero usable records");
  assert.deepEqual(p.parsing.parsed.value.failures.length, 1, "the same failure three times is one line with its count");
  assert.match(p.parsing.parsed.value.failures[0], /^3 times: .*WORKER_ARTIFACT_NOT_IN_VAULT/);
  assert.equal(p.cost.retries, 2, "three attempts on one step: two retries");
  assert.deepEqual(listRowOf(p).parsed, { succeeded: 0, failed: 3, usable: null });
});

test("filter counts say which half is missing, so an unpublished view or an unread routine plane never draws as zero", () => {
  const unpublished = combinedCounts(null, []);
  assert.deepEqual(unpublished.missing, ["the assignment view is not on the published snapshot yet"]);
  assert.deepEqual(combinedCountNumbers(unpublished), [], "incomplete counts are not drawn, so they are not audited as numbers");
  const view = buildAssignmentView(world());
  const whole = combinedCounts(view, []);
  assert.deepEqual(whole.missing, []);
  assert.ok(combinedCountNumbers(whole).length > 0);
  assert.deepEqual(combinedCounts(view, [], "Error").missing, ["routine contracts could not be read (Error)"]);
});

test("DP-06: a detective's argued absence says in Admin what would unlock it, from the condition stored with it", async () => {
  const { stuckViews } = await import("../lib/control-plane/admin-view/v6-stuck-read.ts");
  const c = worldC();
  const id = c.obligations![0]!.id;
  const unlock = { text: "a records request to the county clerk; the filing portal once it opens.", recordedAt: PAST,
    triggers: [{ kind: "DATE" as const, at: FUTURE }] };
  const argued = { ...c, obligations: [obligation(id, { nextDueAt: FUTURE, absentUntil: FUTURE, absenceUnlock: unlock })] };
  const row = rowOf(buildAssignments(merge(argued)), "poe-pat");
  assert.equal(row.waiting.nextAction,
    "Recorded as not published; it is looked for again by September 23, 8:00 AM ET. Would unlock: a records request to the county clerk; the filing portal once it opens.");

  // The published index carries it, and the stuck list's box shows it as the next step.
  const indexed = buildAssignmentView(merge(argued)).allRowsIndex!.find((r) => r.id.includes("poe-pat"))!;
  assert.match(indexed.nextAction ?? "", /^Recorded as not published.*Would unlock: a records request/);
  const views = stuckViews([{ id: indexed.id, state: "FAILED", lane: indexed.lane, owner: null, blocker: null, label: indexed.label,
    subjectName: indexed.subjectName, stateCode: indexed.stateCode, overdue: true, band: null, waitingSince: null, eligibleAt: null,
    lastActivityAt: null, nextAction: indexed.nextAction ?? null, assignmentKeys: [] }], "us", NOW);
  assert.match(views.items[0]!.next, /Would unlock: a records request to the county clerk/);

  // Without a stored condition the recheck is still said; once the absence lapses, the ordinary next step returns.
  const bare = rowOf(buildAssignments(merge({ ...c, obligations: [obligation(id, { nextDueAt: FUTURE, absentUntil: FUTURE })] })), "poe-pat");
  assert.equal(bare.waiting.nextAction, "Recorded as not published; it is looked for again by September 23, 8:00 AM ET.");
  const lapsed = rowOf(buildAssignments(merge({ ...c, obligations: [obligation(id, { absentUntil: PAST, absenceUnlock: unlock })] })), "poe-pat");
  assert.doesNotMatch(lapsed.waiting.nextAction, /Would unlock|Recorded as not published/);
});
