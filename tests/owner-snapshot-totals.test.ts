import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleAssignmentView,
  assignmentPartOf,
  buildAssignmentView,
  deriveAssignmentEntries,
  mergeAssignmentParts,
  type AssignmentListRow,
  type AssignmentSources,
  type AssignmentView,
  type IndexSegment,
} from "../lib/control-plane/assignment-view.ts";
import { pipelineStatesOf } from "../lib/control-plane/assignment-read.ts";
import { ASK_GAP_NAMESPACE } from "../lib/control-plane/ask-gap-id.ts";
import type { AskGapObservation } from "../lib/control-plane/ask-gap-observations.ts";
import type { Attempt, AttemptCost, ExecutionLease, WorkerRef } from "../lib/control-plane/attempt.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { buildCostPanel, buildSpendByPlace, costPanelOf, spendByDay, spendByDayOf } from "../lib/control-plane/cost-panel.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import { OWNER_SNAPSHOT_TOTALS_ID, OwnerSnapshotFold, readingWindows, type OwnerSnapshotTotals } from "../lib/control-plane/owner-snapshot-totals.ts";
import { ownerSnapshotStateId, type OwnerSnapshotState } from "../lib/control-plane/owner-surface.ts";
import { stageCounts } from "../lib/control-plane/promotion/pipeline.ts";
import type { PromotionPipelineRecord } from "../lib/control-plane/promotion/types.ts";
import type { ProviderReading } from "../lib/control-plane/provider-billing.ts";
import { billingAttributionOf, providerBillingAttribution } from "../lib/control-plane/provider-billing-attribution.ts";
import { searchLedgersOf } from "../lib/control-plane/provider-billing-collector.ts";
import { exactScopeMembers } from "../lib/control-plane/provider-billing-scope-members.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { RouteTask } from "../lib/control-plane/route-task.ts";
import type { FreshnessDebt } from "../lib/control-plane/scheduler/debt.ts";
import type { FreshnessOccurrence, StandingObligation } from "../lib/control-plane/scheduler/durable.ts";
import { SCOUT_PREWARM_ROUTE_ID } from "../lib/control-plane/scheduler/research-policy.ts";
import { unitCarriesState } from "../lib/control-plane/scheduler/dispatch-target.ts";
import { US_STATES } from "../lib/control-plane/readiness/catalog.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import type { ServedReaderReadback } from "../lib/control-plane/served-reader.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";

const T1 = "2026-10-17T15:00:00.000Z";
const T2 = "2026-10-18T17:30:00.000Z";
const T3 = "2026-11-01T02:00:00.000Z";
const T4 = "2026-11-01T09:00:00.000Z";
const at = (iso: string, hours: number) => new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
const STATES = ["nj", "az", "nh", "oh", "tx", "ca", "ny", "fl", "wa", "mi"];
const HUNT: ExpansionScopeDecision = { key: "zcta:2020/85635", receiptId: "receipt-hunt", budgetStartedAt: "2026-10-01T00:00:00.000Z", budgetUsd: 50,
  priority: 1, note: null, decidedAt: "2026-10-01T00:00:00.000Z", decidedBy: "fixture", previous: null,
  geography: { label: "85635" } as never };
const PLAIN: WorkerRef = { role: "ACQUIRER", provider: "we-the-people", version: "route-executor/1.0 (fixture)", instance: "x" };
const MODEL: WorkerRef = { role: "SCOUT", provider: "anthropic", version: "claude-opus-5", instance: "x" };

const baseCost = (over: Partial<AttemptCost> = {}): AttemptCost => ({ inputTokens: null, outputTokens: null, usd: null, durationMs: null, bytesFetched: null,
  requestCount: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null,
  uncachedInputTokens: null, batch: false, ...over });

interface World {
  readonly obligations: StandingObligation[];
  readonly occurrences: FreshnessOccurrence[];
  readonly workItems: WorkItem[];
  readonly routeTasks: RouteTask[];
  readonly attempts: Attempt[];
  readonly debts: FreshnessDebt[];
  readonly leases: ExecutionLease[];
  readonly costs: { entry: CostEntry; stampedAt: string }[];
  readonly artifacts: ArtifactRecord[];
  readonly scouts: ScoutResult[];
  readonly workerResults: WorkerResultRecord[];
  readonly pipeline: PromotionPipelineRecord[];
  readonly observations: AskGapObservation[];
}

const emptyWorld = (): World => ({ obligations: [], occurrences: [], workItems: [], routeTasks: [], attempts: [], debts: [], leases: [], costs: [],
  artifacts: [], scouts: [], workerResults: [], pipeline: [], observations: [] });

const obligationId = (i: number) => `freshness:candidate-enrichment:${STATES[i % STATES.length]}:2026:state-${STATES[i % STATES.length]}-place-p${i}:mayor:cand-${i}#route-${i % 3}`;

function workItem(id: string, clause: string, over: Partial<WorkItem> = {}): WorkItem {
  return { id, project: "freshness", subject: `subject-${id}`, obligation: clause, why: "fixture", priority: "P2", state: "OPEN",
    contract: { inheritedRouteFloor: [], requiresValidation: true, requiresAudit: false, requiresCompleteDenominator: false, acceptableDispositions: null, instrumentEvidence: null },
    dependencies: [], routeTaskIds: [], escalations: [], createdAt: "2026-09-01T00:00:00.000Z",
    transitions: [{ from: null, to: "OPEN", at: "2026-09-01T00:00:00.000Z", by: "control-plane", why: "fixture" }], ...over } as WorkItem;
}

/** Adds one round of work to `w`: its task, attempt, charge(s), artifact, and a Scout or worker result. */
function round(w: World, wi: string, id: string, input: { worker: WorkerRef; startedAt: string; open?: boolean; usd?: number | null; obligation?: string;
  stampedAt?: string; entry?: Partial<CostEntry>; cost?: Partial<AttemptCost>; leaseUntil?: string }): Attempt {
  const rt = `rt-${id}`;
  const a: Attempt = { id: `at-${id}`, routeTaskId: rt, workItemId: wi, worker: input.worker, leaseId: `ls-${id}`, startedAt: input.startedAt,
    endedAt: input.open ? null : at(input.startedAt, 0.1), outcome: input.open ? null : "COMPLETED", abortReason: null, artifactIds: [`ar-${id}`],
    cost: baseCost({ durationMs: 400 }), methodVersion: 1, policyVersion: "fixture" } as Attempt;
  w.routeTasks.push({ id: rt, workItemId: wi, routeId: `route-${id.length % 3}`, routeLabel: "fixture", target: "fixture", inherited: true,
    state: input.open ? "CLAIMED" : "DISPOSED", disposition: null, attemptIds: [a.id], createdAt: input.startedAt } as RouteTask);
  w.attempts.push(a);
  if (input.open) w.leases.push({ id: a.leaseId, routeTaskId: rt, holder: "fixture", claimedAt: input.startedAt, expiresAt: input.leaseUntil ?? at(input.startedAt, 1),
    heartbeatAt: input.startedAt, released: false });
  const recordedAt = at(input.startedAt, 0.1);
  if (input.usd !== undefined) {
    w.costs.push({ stampedAt: input.stampedAt ?? recordedAt, entry: { attemptId: a.id, workItemId: wi, routeTaskId: rt, routeId: `route-${id.length % 3}`,
      source: null, jurisdiction: null, project: "freshness", role: input.worker.role, recordedAt,
      cost: baseCost({ usd: input.usd, requestCount: 1, bytesFetched: 2048, durationMs: 900, ...(input.worker === MODEL ? { inputTokens: 1200, outputTokens: 300,
        cacheReadInputTokens: 800, cacheCreationInputTokens: 100, cacheCreation5mInputTokens: 100, cacheCreation1hInputTokens: 0, uncachedInputTokens: 300 } : {}),
        ...input.cost }), ...input.entry } as CostEntry });
  }
  w.artifacts.push({ artifactId: `ar-${id}`, workItemId: wi, routeTaskId: rt, attemptId: a.id, tier: "RAW", contentHash: `sha256-${id}`, byteLength: 4096,
    contentType: "text/html", canonicalUrl: `https://example.gov/${id}`, partial: false, recordedAt });
  if (input.worker === MODEL && input.obligation) {
    w.scouts.push({ formatVersion: 1, attemptId: a.id, obligationId: input.obligation, routeTaskId: rt, workItemId: wi, subjectId: "fixture",
      routeId: "candidate-authored-awaits-site", recordClass: "candidate-enrichment", providerId: "candidate-enrichment", reason: "fixture",
      outcome: "NO_PROGRESS", stoppedBy: "BOUND", rungs: [], distinctEvidenceRungs: 0, candidates: [], findings: [], nextRungs: [], unverified: [],
      narrative: "fixture", worker: { provider: "anthropic", model: "claude-opus-5", modelReported: "claude-opus-5" },
      usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, turns: 1, toolCalls: 1 }, usd: 0.5, elapsedMs: 1000,
      artifactIds: [], methodCandidateIds: [], refusal: null, startedAt: input.startedAt, recordedAt } as ScoutResult);
  }
  return a;
}

function parserResult(a: Attempt): WorkerResultRecord {
  return { id: `wr-${a.id}`, schemaVersion: 1, workItemId: a.workItemId, routeTaskId: a.routeTaskId, attemptId: a.id, worker: { ...PLAIN, role: "PARSER" },
    methodVersion: 1, policyVersion: "fixture", startedAt: a.startedAt, endedAt: a.endedAt ?? a.startedAt, executionMode: "DETERMINISTIC", cost: a.cost,
    inputArtifactIds: a.artifactIds, inputResultIds: [], semanticHash: `hash-${a.id}`,
    result: { role: "PARSER", attemptId: a.id, implementation: "fixture", version: "1", schemaVersion: 1, recordClass: "OFFICIAL_ROSTER", artifactId: a.artifactIds[0],
      contentHash: "sha256", acquiredByAttemptId: a.id, subjectId: "fixture", verdict: "EXTRACTED", records: [{ id: `rec-${a.id}`, subjectId: "fixture",
        fields: { name: "Morgan Example" }, evidenceSpanIds: [] }], spans: [], warnings: [], declaredRowCount: 1, sourceRowCount: 1, actualRowCount: 1 },
  } as unknown as WorkerResultRecord;
}

function scouted(itemId: string, source: object, recordedAt: string): PromotionPipelineRecord {
  return { formatVersion: 1, recordId: `${itemId}:scouted`, itemId, at: recordedAt, actor: { role: "SCOUT", lane: "BOUNDED_MODEL_WORKER", instance: "x" }, stage: "SCOUTED",
    source, recordClass: "candidate-enrichment", subjectId: "fixture", canonicalUrl: null, artifactIds: [], scoutAttemptId: "x", summary: "fixture" } as PromotionPipelineRecord;
}

const verified = (itemId: string, recordedAt: string): PromotionPipelineRecord => ({ formatVersion: 1, recordId: `${itemId}:verified`, itemId, at: recordedAt,
  actor: { role: "VALIDATOR", lane: "DETERMINISTIC", instance: "x" }, stage: "VERIFIED", checks: [] } as unknown as PromotionPipelineRecord);

/** Forty standing obligations across ten states with rounds over the last four months, plus the cases a fold must not get wrong. */
function initialWorld(): World {
  const w = emptyWorld();
  for (let i = 0; i < 40; i += 1) {
    const id = obligationId(i);
    const rounds = 1 + (i % 4);
    const marked = i % 7 === 0;
    w.obligations.push({ id, recordClass: "candidate-enrichment", subjectId: `${STATES[i % STATES.length]}:2026:state-p${i}:mayor:cand-${i}`, routeId: `route-${i % 3}`,
      active: i % 11 !== 3, readerImpactAt: i % 6 === 0 ? at(T1, 24 * (i % 5) - 30) : null, observedChangeRateHours: 24, lastWorkedAt: null,
      nextDueAt: at(T1, (i % 9) * 6 - 20), occurrenceCount: rounds, openOccurrenceId: null, updatedAt: T1,
      ...(marked ? { assignments: [{ assignmentKey: HUNT.key, ref: HUNT.receiptId, relation: "CREATED", at: "2026-10-01T00:00:00.000Z" }] } : {}),
      ...(i % 11 === 3 ? { retiredAt: at(T1, -100), retirementReason: "fixture" } : {}) } as StandingObligation);
    for (let s = 1; s <= rounds; s += 1) {
      const wi = `wi-${i}-${s}`;
      const startedAt = at(T1, -24 * 7 * (rounds - s) - 3 * (i % 8) - 1);
      const open = s === rounds && i % 5 === 1;
      const worker = i % 3 === 0 ? MODEL : PLAIN;
      w.workItems.push(workItem(wi, `${id}#${s}`, { routeTaskIds: [`rt-${i}-${s}`], createdAt: startedAt,
        ...(s === rounds && i % 9 === 0 ? { autonomousPlan: { publication: { contractId: "official-roster", bodyId: `ocd-division/country:us/state:${STATES[i % 10]}/place:p${i}` },
          contract: { recordClass: "OFFICIAL_ROSTER" } } as never, publicationOutcome: { at: at(startedAt, 1), workerResultId: `wr-at-${i}-${s}`, status: "PUBLISHED",
          code: "PUBLISHED", detail: "fixture", candidateId: null, versionId: `v-${i}` } } : {}) }));
      w.occurrences.push({ id: `occ-${id}-${String(s).padStart(6, "0")}`, obligationId: id, sequence: s, dueAt: startedAt, workItemId: wi, routeTaskId: `rt-${i}-${s}`,
        openedAt: startedAt, closedAt: open ? null : at(startedAt, 0.2), disposition: null, unresolvedReason: null } as FreshnessOccurrence);
      const a = round(w, wi, `${i}-${s}`, { worker, startedAt, open, obligation: id, leaseUntil: at(T1, 1 + (i % 3)),
        usd: i % 4 === 2 ? null : worker === MODEL ? 0.0123 * (1 + (i % 7)) + s / 1000 : 0,
        entry: marked ? { assignmentRefs: [{ key: HUNT.key, ref: HUNT.receiptId }], assignmentKeys: [HUNT.key], jurisdiction: `${STATES[i % 10]}:2026:place-p${i}`,
          source: `${STATES[i % 10]}:2026:state-${STATES[i % 10]}-place-p${i}:mayor:cand-${i}` } : i % 2 === 0 ? { source: `${STATES[i % 10]}:2026:state-${STATES[i % 10]}-county-c${i % 4}:clerk:x` } : {} });
      if (s === rounds && i % 9 === 0) w.workerResults.push(parserResult(a));
      if (i % 6 === 0 && s === 1) {
        w.pipeline.push(scouted(`item-${i}`, { kind: "SCOUT_RESULT", attemptId: a.id, obligationId: id, outcome: "EVIDENCE_FOUND", routeId: null }, at(startedAt, 0.3)));
        if (i % 12 === 0) w.pipeline.push(verified(`item-${i}`, at(startedAt, 0.5)));
      }
    }
    if (i % 5 === 0) w.debts.push({ obligationId: id, cause: "UPSTREAM_ERROR", detail: "fixture debt", target: "fixture", dueAt: T1, firstFailedAt: at(T1, -48),
      lastFailedAt: at(T1, -2), consecutiveFailures: i % 10 === 0 ? 0 : 2, retryAt: at(T1, (i % 3) * 5 - 4) } as FreshnessDebt);
  }
  /* A created work item whose clause names an obligation registered only later; a directory child; a dependency. */
  w.workItems.push(workItem("wi-late", `${obligationId(90)}#1`, { routeTaskIds: ["rt-late"] }));
  round(w, "wi-late", "late", { worker: PLAIN, startedAt: at(T1, -30), usd: 0 });
  w.workItems.push(workItem("wi-child", "directory child", { directoryParent: { workItemId: "wi-0-1", bodyId: "body-x" } as never,
    dependencies: [{ upstreamId: "wi-0-1", kind: "BLOCKS" } as never], routeTaskIds: ["rt-child"] }));
  round(w, "wi-child", "child", { worker: PLAIN, startedAt: at(T1, -10), usd: null });
  /* Shared pre-warm cost, a model split, search charges, a charge whose Attempt and work item are not on record. */
  w.costs.push({ stampedAt: at(T1, -5), entry: { attemptId: "scout-prewarm:1", workItemId: "scout-prewarm", routeTaskId: null, routeId: SCOUT_PREWARM_ROUTE_ID,
    source: null, jurisdiction: null, project: "freshness", role: "SCOUT", recordedAt: at(T1, -5), cost: baseCost({ usd: 0.031, requestCount: 1, inputTokens: 4000,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 4000, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 4000, uncachedInputTokens: 0, batch: true }) } as CostEntry });
  w.costs.push({ stampedAt: at(T1, -2), entry: { attemptId: "at-3-1", workItemId: "wi-3-1", routeTaskId: "rt-3-1", routeId: "route-1", source: "api.anthropic.com",
    jurisdiction: null, project: "freshness", role: "SCOUT", recordedAt: at(T1, -2), byModel: [
      { model: "claude-opus-5", usd: 0.02, requestCount: 1, inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0, uncachedInputTokens: 10 },
      { model: "claude-haiku-4-5-20251001", usd: 0.01, requestCount: 1, inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2, cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0, uncachedInputTokens: 8 }],
    cost: baseCost({ usd: 0.03, requestCount: 2, inputTokens: 20, outputTokens: 10, cacheReadInputTokens: 2, cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0, uncachedInputTokens: 18 }) } as CostEntry });
  for (const [k, host] of [[1, "api.exa.ai"], [2, "api.search.brave.com"], [3, "api.exa.ai"]] as const) {
    w.costs.push({ stampedAt: at(T1, -k * 30), entry: { attemptId: `search-${k}`, workItemId: "wi-6-1", routeTaskId: null, routeId: "search", source: host,
      jurisdiction: null, project: "freshness", role: "DISCOVERY_SEARCH" as never, recordedAt: at(T1, -k * 30), cost: baseCost({ usd: k === 3 ? null : 0.005 * k, requestCount: k }) } as CostEntry });
  }
  w.costs.push({ stampedAt: at(T1, -3), entry: { attemptId: "at-unrecorded", workItemId: "wi-unrecorded", routeTaskId: null, routeId: "route-0", source: null,
    jurisdiction: null, project: "freshness", role: "SCOUT", recordedAt: at(T1, -3), cost: baseCost({ usd: 0.044, requestCount: 1 }) } as CostEntry });
  /* Charges from earlier months, on the fortnight's edge, and one whose row was stamped an hour after its own time. */
  for (const [k, hours] of [[1, -24 * 80], [2, -24 * 45], [3, -24 * 14 - 2], [4, -24 * 14 + 20], [5, -23.5], [6, -24 * 14 + 8]] as const) {
    const a = round(w, "wi-9-1", `edge-${k}`, { worker: k % 2 ? MODEL : PLAIN, startedAt: at(T1, hours), usd: 0.0071 * k, obligation: obligationId(9),
      ...(k === 6 ? { stampedAt: at(T1, hours + 1.1) } : {}) });
    (w.workItems.find((x) => x.id === "wi-9-1")!.routeTaskIds as string[]).push(a.routeTaskId);
  }
  w.obligations.push({ ...w.obligations[0]!, id: `${ASK_GAP_NAMESPACE}ocd-division/country:us/state:nj/place:p1#AGENDA_NOT_HELD`, occurrenceCount: 0,
    assignments: undefined } as StandingObligation);
  w.observations.push({ bodyId: "ocd-division/country:us/state:nj/place:p1", code: "AGENDA_NOT_HELD", recordClass: "MEETING", day: T1.slice(0, 10), count: 3 });
  w.pipeline.push(scouted("item-unlinked", { kind: "SCOUT_RESULT", attemptId: "at-arrives-later", obligationId: obligationId(1), outcome: "EVIDENCE_FOUND", routeId: null }, T1));
  return w;
}

/** The second publish's changes: new rounds, late and early charges, a lease that lapses, a new obligation that takes in a created work item. */
function changesBeforeT2(w: World): World {
  const c = emptyWorld();
  for (const i of [1, 4, 13, 22]) {
    const a = round(c, `wi-${i}-1`, `${i}-again`, { worker: i % 3 === 0 ? MODEL : PLAIN, startedAt: at(T2, -6 - i / 10), usd: 0.0091 * i, obligation: obligationId(i) });
    (w.workItems.find((x) => x.id === `wi-${i}-1`)!.routeTaskIds as string[]).push(a.routeTaskId);
    c.workItems.push(w.workItems.find((x) => x.id === `wi-${i}-1`)!);
  }
  round(c, "wi-2-1", "back-dated", { worker: MODEL, startedAt: at(T1, -24 * 14 + 30), usd: 0.0333, obligation: obligationId(2) });
  round(c, "wi-5-1", "ahead", { worker: MODEL, startedAt: at(T2, 2), usd: 0.05, obligation: obligationId(5) });
  round(c, "wi-8-1", "skewed", { worker: MODEL, startedAt: at(T2, -20), usd: 0.07, obligation: obligationId(8), stampedAt: at(T2, -19.5 + 1) });
  const late = obligationId(90);
  c.obligations.push({ ...w.obligations[1]!, id: late, subjectId: "nj:2026:state-p90:mayor:cand-90", occurrenceCount: 0 } as StandingObligation);
  const ob = w.obligations.find((o) => o.id === obligationId(10))!;
  c.obligations.push({ ...ob, nextDueAt: at(T2, 2) });
  c.debts.push({ obligationId: obligationId(15), cause: "UPSTREAM_ERROR", detail: "fresh failure", target: "fixture", dueAt: T2, firstFailedAt: at(T2, -3),
    lastFailedAt: at(T2, -1), consecutiveFailures: 1, retryAt: at(T2, 4) } as FreshnessDebt);
  c.pipeline.push(verified("item-6", at(T2, -1)));
  c.observations.push({ bodyId: "ocd-division/country:us/state:nj/place:p1", code: "AGENDA_NOT_HELD", recordClass: "MEETING", day: T2.slice(0, 10), count: 2 });
  return c;
}

/** The third publish's changes: the Attempt and work item the ledger named appear, and the hunt takes in another subject. */
function changesBeforeT3(w: World): World {
  const c = emptyWorld();
  c.workItems.push(workItem("wi-unrecorded", "unrecorded clause", { routeTaskIds: ["rt-unrecorded"] }));
  c.attempts.push({ ...w.attempts[0]!, id: "at-unrecorded", workItemId: "wi-unrecorded", routeTaskId: "rt-unrecorded", worker: MODEL });
  c.attempts.push({ ...w.attempts[0]!, id: "at-arrives-later", workItemId: "wi-1-1", routeTaskId: "rt-1-1" });
  const ob = w.obligations.find((o) => o.id === obligationId(3))!;
  c.obligations.push({ ...ob, assignments: [{ assignmentKey: HUNT.key, ref: HUNT.receiptId, relation: "CREATED", at: "2026-10-01T00:00:00.000Z" }] } as StandingObligation);
  c.costs.push({ stampedAt: at(T3, -0.5), entry: { attemptId: "at-3-1", workItemId: "wi-3-1", routeTaskId: "rt-3-1", routeId: "route-1", source: null,
    jurisdiction: null, project: "freshness", role: "SCOUT", recordedAt: at(T3, 1), cost: baseCost({ usd: 0.017, requestCount: 1 }) } as CostEntry });
  c.costs.push({ stampedAt: at(T3, -1), entry: { attemptId: "at-3-1", workItemId: "wi-3-1", routeTaskId: "rt-3-1", routeId: "route-1", source: null,
    jurisdiction: ob.subjectId, project: "freshness", role: "SCOUT", recordedAt: at(T3, -1), cost: baseCost({ usd: 0.019, requestCount: 1 }) } as CostEntry });
  return c;
}

async function seed(repos: ControlPlaneRepositories, w: World): Promise<void> {
  const write = async <T,>(repo: ControlPlaneRepositories["workItems"] | ControlPlaneRepositories["obligations"], rows: readonly T[], id: (row: T) => string) => {
    for (const row of rows) {
      const held = await (repo as never as { read(id: string): Promise<{ revision: number } | null> }).read(id(row));
      if (held === null) await (repo as never as { put(id: string, v: T, now: string): Promise<unknown> }).put(id(row), row, T1);
      else await (repo as never as { compareAndSet(id: string, r: number, v: T, now: string): Promise<unknown> }).compareAndSet(id(row), held.revision, row, T1);
    }
  };
  await write(repos.obligations, w.obligations, (r) => r.id);
  await write(repos.occurrences as never, w.occurrences, (r) => r.id);
  await write(repos.workItems, w.workItems, (r) => r.id);
  await write(repos.routeTasks as never, w.routeTasks, (r) => r.id);
  await write(repos.attempts as never, w.attempts, (r) => r.id);
  await write(repos.debts as never, w.debts, (r) => r.obligationId);
  await write(repos.leases as never, w.leases, (r) => r.routeTaskId);
  for (const o of w.observations) await write(repos.askGapObservations as never, [o], (r) => `${r.bodyId}#${r.code}#${r.day}`);
  for (const { entry, stampedAt } of w.costs) await repos.costs.append(entry.workItemId, `${entry.attemptId}:${entry.recordedAt}`, entry, stampedAt);
  for (const r of w.artifacts) await repos.artifacts.append(r.workItemId, r.artifactId, r, r.recordedAt);
  for (const r of w.scouts) await repos.scoutResults.append(r.obligationId, r.attemptId, r, r.recordedAt);
  for (const r of w.workerResults) await repos.workerResults.append(r.workItemId, r.id, r, r.endedAt);
  for (const r of w.pipeline) await repos.promotionPipeline.append(r.itemId, r.recordId, r, r.at);
}

function readings(now: string, carried: readonly ProviderReading[]): ProviderReading[] {
  const start = now.slice(0, 7) + "-01T00:00:00.000Z";
  const fresh = (provider: ProviderReading["provider"], usd: number): ProviderReading => ({ provider, attemptedAt: now, syncedAt: now, periodStart: start,
    periodEnd: now, status: "REPORTED", reportedUsd: usd, estimatedUsd: null, credits: null, days: [],
    units: provider === "anthropic-api" ? [{ label: "Token usage cost (part of total)", value: usd, unit: "USD" }] : [], accountIds: [], existingLimits: [],
    source: "fixture", detail: "fixture", error: null });
  const reuse = carried.find((r) => r.provider === "anthropic-api" && r.periodStart === start);
  return [reuse ? { ...reuse, attemptedAt: now } : fresh("anthropic-api", 1.5), fresh("exa", 0.2), fresh("brave", 0.1),
    { ...fresh("netlify", 3), periodStart: "2026-10-05T00:00:00.000Z" }];
}

const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface Published {
  readonly totals: OwnerSnapshotTotals;
  readonly servedReader: ServedReaderReadback | null;
  readonly readings: readonly ProviderReading[];
}

/** Every state's published rows as a reader sees them at `at`: each assignment's index row as it holds then. */
function rowsAt(states: ReadonlyMap<string, OwnerSnapshotState>, at: string) {
  const all = [...states.values()];
  const holds = (r: IndexSegment) => (r.from === null || r.from <= at) && (r.until === null || at < r.until);
  return {
    allRowsIndex: all.flatMap((r) => r.allRowsIndex).filter(holds).map(({ from: _from, until: _until, ...row }) => row).sort((a, b) => a.id.localeCompare(b.id)),
    bodyAttempts: all.flatMap((r) => r.bodyAttempts).sort((a, b) => b.at.localeCompare(a.at) || a.workItemId.localeCompare(b.workItemId)),
  };
}

/** One publish exactly as `scripts/publish-owner-snapshot.mts` composes it, every panel read back with each state's rows joined in. */
async function publish(repos: ControlPlaneRepositories, now: string, prior: Published | null, scopes: readonly ExpansionScopeDecision[], served: ServedReaderReadback | null,
  heldRows?: number) {
  const priorRow = await repos.ownerSnapshotTotals.read(OWNER_SNAPSHOT_TOTALS_ID);
  const askGapObservations = (await repos.askGapObservations.list()).map((r) => r.value);
  const fold = await OwnerSnapshotFold.fold(repos, priorRow?.value ?? null, { nowIso: now, slackMs: 0, servedReader: prior?.servedReader ?? null,
    askGapObservations, scopes, carried: prior?.readings ?? [], write: true, heldRows, log: () => {} });
  const read = readings(now, prior?.readings ?? []);
  const attribution = billingAttributionOf({ now, scopes, holds: {}, readings: read, hunts: fold.costs.hunts, windowOf: readingWindows(fold.costs, read, now) });
  await fold.readBack(served);
  const view = await fold.view({ activation: null });
  const totals = json(fold.totals());
  const states = new Map<string, OwnerSnapshotState>();
  for (const state of Object.keys(totals.assignments!.states)) states.set(state, json((await repos.ownerSnapshotStates.read(ownerSnapshotStateId(state)))!.value));
  const spend = fold.spendByPlace();
  const publications:string[]=[];
  for(const state of fold.publicationStates()) publications.push(...(await fold.publications(state)).map(w=>w.id));
  const panels = {
    costPanel: costPanelOf(fold.costs.ledger, fold.costs.scouts, { cacheByRole: null, share: null, verifiedRecords: fold.pipeline.verified, nowIso: now }),
    spendByDay: spendByDayOf(fold.costs.days),
    spendByPlace: { ...spend, states: spend.states.map((row) => ({ ...row, places: states.get(row.state)?.spendByPlace ?? [] })) },
    attribution,
    searches: fold.costs.searches[now.slice(0, 7)] ?? {},
    obligationsByState: fold.obligationsByState(),
    publications: publications.sort(),
    rows: rowsAt(states, now),
  };
  if (priorRow === null) await repos.ownerSnapshotTotals.put(OWNER_SNAPSHOT_TOTALS_ID, totals, now);
  else await repos.ownerSnapshotTotals.compareAndSet(OWNER_SNAPSHOT_TOTALS_ID, priorRow.revision, totals, now);
  return { panels: json(panels), view: json(view), states, published: { totals, servedReader: served, readings: read } satisfies Published };
}

async function sourcesAt(repos: ControlPlaneRepositories, now: string, served: ServedReaderReadback | null): Promise<AssignmentSources> {
  const values = async <T,>(repo: { list(): Promise<readonly { value: T }[]> }) => (await repo.list()).map((r) => r.value);
  const attempts = await values(repos.attempts as never as { list(): Promise<readonly { value: Attempt }[]> });
  const open = new Set(attempts.filter((a) => a.outcome === null).map((a) => a.routeTaskId));
  return { nowIso: now, obligations: await values(repos.obligations), occurrences: await values(repos.occurrences), workItems: await values(repos.workItems),
    routeTasks: await values(repos.routeTasks), attempts, debts: await values(repos.debts),
    leases: (await values(repos.leases)).filter((l) => open.has(l.routeTaskId)), dispositions: null, artifacts: await repos.artifacts.readAll(),
    costs: await repos.costs.readAll(), scoutResults: await repos.scoutResults.readAll(), workerResults: await repos.workerResults.readAll(),
    pipeline: pipelineStatesOf(await repos.promotionPipeline.readAll()), activation: null, servedReader: served, pilotZips: [],
    askGapObservations: (await repos.askGapObservations.list()).map((r) => r.value) };
}

/** Every panel from every row, as the publisher computed it before it kept totals. */
async function fromScratch(repos: ControlPlaneRepositories, now: string, scopes: readonly ExpansionScopeDecision[], served: ServedReaderReadback | null,
  read: readonly ProviderReading[]) {
  const sources = await sourcesAt(repos, now, served);
  const { costs, attempts, obligations } = sources;
  const verifiedRecords = stageCounts(sources.pipeline!).byStage.VERIFIED;
  const byState: Record<string, number> = {};
  for (const o of obligations) {
    const hay = `${o.id} ${o.subjectId}`.toLowerCase();
    const name = US_STATES.find((st) => unitCarriesState(hay, st.code))?.name ?? "other";
    byState[name] = (byState[name] ?? 0) + 1;
  }
  const { allRowsIndex, bodyAttempts } = buildAssignmentView(sources);
  return json({
    costPanel: buildCostPanel({ costs, attempts, cacheByRole: null, share: null, verifiedRecords, nowIso: now }),
    spendByDay: spendByDay(costs, now),
    spendByPlace: buildSpendByPlace(costs),
    attribution: providerBillingAttribution({ now, costs, attempts, scopes, holds: {}, scopeMembers: exactScopeMembers(scopes, obligations), readings: read }),
    searches: searchLedgersOf(costs, now),
    obligationsByState: byState,
    publications: sources.workItems.filter((w) => w.publicationOutcome).map((w) => w.id).sort(),
    rows: { allRowsIndex, bodyAttempts },
  });
}

/** The national view from scratch with each state's assignments as they stood at that state's last fold, which is what the view states. */
async function viewAsOfFolds(repos: ControlPlaneRepositories, published: Published, states: ReadonlyMap<string, OwnerSnapshotState>, now: string,
  servedAt: (at: string) => ServedReaderReadback | null): Promise<AssignmentView> {
  const parts = [];
  const lists = new Map<string, AssignmentListRow>();
  for (const [state, part] of Object.entries(published.totals.assignments!.states)) {
    const ids = new Set(states.get(state)!.allRowsIndex.map((r) => r.id));
    const own = [...deriveAssignmentEntries(await sourcesAt(repos, part.builtAt, servedAt(part.builtAt)))].filter(([id]) => ids.has(id));
    parts.push(assignmentPartOf(own, part.builtAt));
    for (const [id, e] of own) if (e.list) lists.set(id, e.list);
  }
  const scratch = buildAssignmentView(await sourcesAt(repos, now, servedAt(now)));
  const linked = scratch.summary.pipeline.held ? scratch.summary.pipeline.value.linked : null;
  return json(assembleAssignmentView({ nowIso: now, part: mergeAssignmentParts(parts, now), lists: (id) => lists.get(id), activation: null,
    totals: { costs: scratch.summary.costs, pipeline: linked && { items: linked.denominator, linked: linked.value },
      askGapObservations: (await repos.askGapObservations.list()).map((r) => r.value) } }));
}

function assertSamePanels(label: string, folded: Record<string, unknown>, scratch: Record<string, unknown>): void {
  for (const panel of Object.keys(scratch)) assert.deepEqual(folded[panel], scratch[panel], `${label}: ${panel} differs from the from-scratch computation`);
}

for (const [held, says] of [[undefined, "held in memory"], [1, "each written to its state's inbox row as it is routed"]] as const) test(
  `the folded owner snapshot shows every panel exactly as a from-scratch computation over the same rows, publish after publish and between (routed rows ${says})`, async () => {
  const repos = createMemoryRepositories();
  const w = initialWorld();
  await seed(repos, w);
  const witness = (itemId: string, approvalId: string, checkedAt: string) => ({ itemId, approvalId, versionId: "v", readerKey: "k", url: "https://example.org",
    checkedAt, state: "CONFIRMED" as const, reason: "fixture", responseSha256: null });
  const served1: ServedReaderReadback = { checkedAt: T1, witnesses: [witness("wi-0-1", "wr-at-0-1", at(T1, -1))], errors: [] };
  const served2: ServedReaderReadback = { checkedAt: T2, witnesses: [witness("wi-9-1", "wr-at-9-1", at(T2, -1)), witness("wi-27-4", "wr-at-27-4", at(T2, -0.5))], errors: [] };
  const servedAt = (t: string) => (t < T2 ? served1 : served2);
  /* Between publishes a reader evaluates each row at its own clock; the published rows must already hold what a publish then would show. */
  const between = async (label: string, states: ReadonlyMap<string, OwnerSnapshotState>, from: string) => {
    for (const hours of [1.5, 9, 30, 24 * 40]) {
      const later = at(from, hours);
      const scratch = await fromScratch(repos, later, [HUNT], servedAt(later), []) as { rows: unknown };
      assert.deepEqual(json(rowsAt(states, later)), scratch.rows, `${label}, ${hours} hours on with no publish: the rows a reader sees differ from the from-scratch computation`);
    }
  };

  const one = await publish(repos, T1, null, [HUNT], served1, held);
  assertSamePanels("first publish", one.panels, await fromScratch(repos, T1, [HUNT], served1, one.published.readings));
  const { allRowsIndex: _rows, bodyAttempts: _bodies, ...national } = json(buildAssignmentView(await sourcesAt(repos, T1, served1)));
  assert.deepEqual(one.view, national, "first publish: with every state folded now, the view is exactly the from-scratch view");
  assert.ok(one.states.size > 5, "every state's rows are published on their own row");
  assert.ok(one.view.summary.total > 40 && one.view.rows.length > 0, "the fixture publishes a real list");
  assert.equal(one.published.totals.costs!.skewed.length, 1, "the charge stamped an hour off its row is carried by itself");
  await between("after the first publish", one.states, T1);

  const c2 = changesBeforeT2(w);
  await seed(repos, c2);
  const two = await publish(repos, T2, one.published, [HUNT], served2, held);
  assertSamePanels("second publish", two.panels, await fromScratch(repos, T2, [HUNT], served2, two.published.readings));
  assert.deepEqual(two.view, await viewAsOfFolds(repos, two.published, two.states, T2, servedAt), "second publish: the view differs from each state's figures at its fold");
  assert.ok(two.published.readings.some((r) => r.provider === "anthropic-api" && r.periodEnd === T1), "the second publish carries a reading forward");
  assert.equal(two.panels.rows.allRowsIndex.length, two.view.summary.total);
  assert.ok(!two.panels.rows.allRowsIndex.some((row) => row.id === "wi-late"), "the created work item joined the obligation its clause names");
  assert.equal(two.published.totals.costs!.ahead.length, 1, "a charge stamped after the clock waits for it");
  assert.ok(two.published.totals.costs!.orphans.includes("at-unrecorded"), "the second publish folded only what changed");
  await between("after the second publish", two.states, T2);

  const c3 = changesBeforeT3(w);
  await seed(repos, c3);
  const three = await publish(repos, T3, two.published, [HUNT], served2, held);
  assertSamePanels("third publish (a new month; the ledger refolded)", three.panels, await fromScratch(repos, T3, [HUNT], served2, three.published.readings));
  assert.deepEqual(three.view, await viewAsOfFolds(repos, three.published, three.states, T3, servedAt), "third publish: the view differs from each state's figures at its fold");
  assert.equal(three.published.totals.costs!.orphans.includes("at-unrecorded"), false, "the Attempt's appearance refolded the ledger");
  assert.equal(three.published.totals.costs!.ahead.length, 1);

  const four = await publish(repos, T4, three.published, [HUNT], served2, held);
  assertSamePanels("fourth publish (the clock alone)", four.panels, await fromScratch(repos, T4, [HUNT], served2, four.published.readings));
  assert.deepEqual(four.view, await viewAsOfFolds(repos, four.published, four.states, T4, servedAt), "fourth publish: the view differs from each state's figures at its fold");
  const foldedAt = (p: Published, t: string) => Object.entries(p.totals.assignments!.states).filter(([, s]) => s.builtAt === t).map(([state]) => state);
  assert.ok(foldedAt(four.published, T4).every((state) => foldedAt(three.published, T3).includes(state)), "the clock alone folds no state; only the last changes are read once more");
  assert.ok(Object.values(four.published.totals.assignments!.states).some((s) => s.builtAt < T3), "a state no changed row reached keeps the rows it was folded with");
  assert.equal(four.published.totals.costs!.ahead.length, 0, "the clock passed the held-back charge");
  await between("after the fourth publish", four.states, T4);
});

test("a steady publish reads only the rows changed since the last one and derives only the assignments they touch", async () => {
  const repos = createMemoryRepositories();
  const w = initialWorld();
  await seed(repos, w);
  const one = await publish(repos, T1, null, [HUNT], null);
  const c = emptyWorld();
  const a = round(c, "wi-12-1", "one-more", { worker: MODEL, startedAt: at(T1, 0.5), usd: 0.021, obligation: obligationId(12) });
  c.workItems.push({ ...w.workItems.find((x) => x.id === "wi-12-1")!, routeTaskIds: ["rt-12-1", a.routeTaskId] });
  await seed(repos, c);
  const derivedFor = new Set<string>();
  const loaded = new Set<string>();
  const whole: string[] = [];
  const watched = Object.fromEntries(Object.entries(repos).map(([name, repo]) => [name, typeof repo !== "object" || repo === null || name === "askGapObservations"
    || name === "ownerSnapshotTotals" ? repo : new Proxy(repo, { get(target, member, receiver) {
      const value = Reflect.get(target, member, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (["list", "listNarrowed", "readAll", "readAllNarrowed", "keys"].includes(String(member))) whole.push(`${name}.${String(member)}`);
        if (name === "occurrences" && member === "listWhereIn" && (args[0] as string[])[0] === "obligationId") for (const id of args[1] as string[]) derivedFor.add(id);
        if (name === "ownerSnapshotStateTotals" && member === "read") loaded.add(String(args[0]));
        return value.apply(target, args);
      };
    } })])) as unknown as ControlPlaneRepositories;
  const now = at(T1, 1);
  const two = await publish(watched, now, one.published, [HUNT], null);
  assert.deepEqual(whole, [], "no control-plane table is read whole");
  assert.ok(derivedFor.has(obligationId(12)), "the assignment the new round belongs to is derived again");
  assert.deepEqual([...derivedFor], [obligationId(12)], "only the assignment the changed rows reach is derived");
  assert.deepEqual([...loaded], ["totals:nh"], "only the state the changed rows reach is read");
  assertSamePanels("steady publish", two.panels, await fromScratch(repos, now, [HUNT], null, two.published.readings));
  /* A changed-row read starts where the last one began, so the publish right after a change reads it once more. */
  const settled = await publish(watched, at(T1, 2), two.published, [HUNT], null);
  loaded.clear();
  derivedFor.clear();
  const idle = at(T1, 9);
  const three = await publish(watched, idle, settled.published, [HUNT], null);
  assert.deepEqual([...loaded], [], "an idle publish reads no state, however far the clock has moved");
  assert.deepEqual(whole, [], "no control-plane table is read whole");
  assertSamePanels("idle publish", three.panels, await fromScratch(repos, idle, [HUNT], null, three.published.readings));
});

test("a state whose rows do not pair with the national totals has every state derived again, exactly as from scratch", async () => {
  const repos = createMemoryRepositories();
  await seed(repos, initialWorld());
  const one = await publish(repos, T1, null, [HUNT], null);
  const row = (await repos.ownerSnapshotStates.read(ownerSnapshotStateId("nj")))!;
  await repos.ownerSnapshotStates.compareAndSet(ownerSnapshotStateId("nj"), row.revision, { ...row.value, builtAt: at(T1, -1) }, T1);
  const c = emptyWorld();
  round(c, "wi-0-1", "nj-again", { worker: PLAIN, startedAt: at(T1, 0.5), usd: 0.004 });
  await seed(repos, c);
  const now = at(T1, 1);
  const two = await publish(repos, now, one.published, [HUNT], null);
  assertSamePanels("after an unpaired state", two.panels, await fromScratch(repos, now, [HUNT], null, two.published.readings));
});
