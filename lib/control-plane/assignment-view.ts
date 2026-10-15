import { attemptFamilyOf, type AttemptFamily } from "../registry/attempt-families.ts";
import { ASK_GAP_CODES, ASK_GAP_CODE_WORDS, type AskGapCode } from "../ask/gap-codes.ts";
import { askGapNoteParts, askGapTitle, parseAskGapObligationId } from "./ask-gap-id.ts";
import {
  ASK_GAP_OBSERVATION_WINDOW_DAYS,
  askedGapKey,
  askedWords,
  foldAskGapObservations,
  type AskedGap,
  type AskGapObservation,
} from "./ask-gap-observations.ts";
import type { Attempt, ExecutionLease, WorkerRef } from "./attempt.ts";
import { isProofProject, type CostEntry } from "./cost.ts";
import { NO_MODEL_KEY, ROLE_COST_POLICY, modelKeyOf } from "./cost-panel.ts";
import { displayNameOf, words } from "./display-name.ts";
import { servedWitness } from "./served-reader.ts";
import {
  gap,
  held,
  measured,
  type CountClaim,
  type Gap,
  type Held,
  type Measured,
  type RenderedNumber,
} from "./owner-surface.ts";
import { plainCode } from "./plain-words.ts";
import { formatEastern } from "./eastern-time.ts";
import {
  PIPELINE_STAGES,
  type ActivationGateReading,
  type PipelineItemState,
  type PipelineStage,
  type RefusedRecord,
} from "./promotion/types.ts";
import type { ArtifactRecord, DispositionCommit } from "./repository/types.ts";
import { bandFor } from "./research-metrics.ts";
import type { RouteDisposition, RouteTask } from "./route-task.ts";
import type { FreshnessDebt } from "./scheduler/debt.ts";
import type { FreshnessOccurrence, StandingObligation } from "./scheduler/durable.ts";
import { DISCHARGING_DISPOSITIONS } from "./scheduler/dispatch.ts";
import { instructionReceiptKey, isScheduled, scheduleObligation, type ObligationAssignment } from "./scheduler/obligation.ts";
import { SCOUT_PREWARM_ROUTE_ID } from "./scheduler/research-policy.ts";
import type { ScoutResult } from "./scheduler/scout-result.ts";
import { isTerminalState, type WorkItem, type WorkItemState } from "./work-item.ts";
import type { WorkQuestion } from "./work-question.ts";
import { US_STATES } from "./readiness/catalog.ts";
import type { WorkerResultRecord } from "./workers/types.ts";
import { assignmentHistoryTerms } from "./admin-view/assignment-history.ts";

export const ASSIGNMENT_VIEW_VERSION = "assignment-view/v1" as const;
const STATE_CODE_BY_NAME = new Map(US_STATES.map(state => [state.name, state.code.toLowerCase()]));
function assignmentStateCode(row: AssignmentRow): string | null {
  return row.what.where.held ? STATE_CODE_BY_NAME.get(row.what.where.value.state ?? "") ?? null : null;
}

export const ASSIGNMENT_ROWS_PER_GROUP = 20;
export const ASSIGNMENT_PROOF_ROWS_PER_GROUP = 5;
/** Rows are admitted one rank at a time across every group until the next would cross this, and every row left out is counted. */
export const ASSIGNMENT_VIEW_BYTE_BUDGET = 300_000;
export const ASSIGNMENT_TEXT_CLIP = 160;
export const ASSIGNMENT_LIST_CLIP = 2;
export const DRILLDOWN_TEXT_CLIP = 4000;
export const DRILLDOWN_LIST_CLIP = 60;

export const ASSIGNMENT_KINDS = ["STANDING_OBLIGATION", "WORK_ITEM", "ROUTINE_CONTRACT"] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

export const ASSIGNMENT_LANES = ["SCOUT", "ROUTINE", "CREATED", "UNASSIGNED", "PROOF"] as const;
export type AssignmentLane = (typeof ASSIGNMENT_LANES)[number];

export const ASSIGNMENT_STATES = ["WORKING", "BLOCKED", "FAILED", "WAITING", "SUCCEEDED", "RETIRED", "UNKNOWN"] as const;
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];

export const LANE_WORDS: Readonly<Record<AssignmentLane, { readonly label: string; readonly means: string }>> = {
  SCOUT: {
    label: "Scout (paid model)",
    means: "The last worker on it was a bounded model worker, used because no known plain-code route exists.",
  },
  ROUTINE: {
    label: "Routine (plain code)",
    means:
      "Plain code walks a known route: the standing runner's deterministic lane, and the routine civic-data contracts.",
  },
  CREATED: {
    label: "Created work",
    means: "A piece of work created for one job (acquire, parse, validate, audit), not a round of a recurring clock.",
  },
  UNASSIGNED: {
    label: "Not yet taken",
    means: "Owed, and no worker has taken it yet, so which lane runs it is decided by the runner when it dispatches.",
  },
  PROOF: {
    label: "Test and proof runs",
    means: "Rows that conformance tests and proof runs wrote into the control plane; kept apart so they never count as real work.",
  },
};

export const STATE_WORDS: Readonly<Record<AssignmentState, { readonly label: string; readonly means: string; readonly tone: "green" | "amber" | "red" | "unknown" | "working" }>> = {
  WORKING: { label: "Working", means: "A worker holds it right now.", tone: "working" },
  BLOCKED: {
    label: "Blocked",
    means: "The last round ended in a way a retry alone will not fix; someone named has to act first.",
    tone: "red",
  },
  FAILED: {
    label: "Failed",
    means: "The last round ended without a result; the runner tries it again on its own.",
    tone: "red",
  },
  WAITING: { label: "Waiting", means: "Owed, and no worker has produced an outcome for it yet.", tone: "amber" },
  SUCCEEDED: { label: "Succeeded", means: "The last round produced a result.", tone: "green" },
  RETIRED: { label: "Retired", means: "No longer owed on this clock; its history stays readable.", tone: "unknown" },
  UNKNOWN: {
    label: "Cannot tell",
    means: "The records disagree with each other, so no state is claimed for it.",
    tone: "unknown",
  },
};

export type NextStepOwner = "RUNNER" | "SCOUT_LANE" | "FLEET" | "ENGINEERING" | "OWNER" | "SOURCE" | "NOBODY";

export const OWNER_WORDS: Readonly<Record<NextStepOwner, string>> = {
  RUNNER: "The runner (automatic)",
  SCOUT_LANE: "The Scout lane (automatic, paid model)",
  FLEET: "The fleet's next worker (automatic)",
  ENGINEERING: "Engineering",
  OWNER: "You",
  SOURCE: "The publisher",
  NOBODY: "Nobody — nothing is owed",
};

export type WorkerModel =
  | { readonly kind: "MODEL"; readonly id: string }
  | { readonly kind: "PLAIN_CODE"; readonly tool: string }
  | { readonly kind: "NOT_RECORDED"; readonly says: string };

export interface AssignmentWorker {
  readonly role: string;
  readonly model: WorkerModel;
  readonly attempts: number | null;
  readonly reportedModels: readonly string[];
}

export interface AssignmentWhat {
  readonly title: string;
  readonly recordClass: string | null;
  readonly subject: string | null;
  readonly subjectName: string | null;
  readonly route: string | null;
  readonly where: Held<{ readonly name: string; readonly state: string | null }>;
  readonly why: {
    readonly says: string;
    readonly dueAt: string | null;
    readonly cadence: string | null;
    readonly readerImpactAt: string | null;
    readonly band: { readonly band: 1 | 2 | 3; readonly why: string } | null;
  };
  readonly workers: Held<readonly AssignmentWorker[]>;
  readonly question?: WorkQuestion | null;
  readonly assignments?: readonly ObligationAssignment[];
}

export interface AssignmentLead {
  readonly kind: "ROUTE" | "RECORD" | "POINTER" | "SOURCE_ROWS";
  readonly says: string;
  readonly url: string | null;
  readonly artifactIds: readonly string[];
}

export interface AssignmentDownload {
  readonly artifactId: string;
  readonly url: string;
  readonly bytes: number;
  readonly contentType: string;
  readonly partial: boolean;
  readonly at: string;
  readonly attemptId: string;
}

export interface AssignmentDiscovery {
  readonly rounds: number | null;
  readonly attempts: number | null;
  readonly discovered: Held<{
    readonly routes: number;
    readonly records: number;
    readonly pointers: number;
    readonly sourceRows: number | null;
    readonly rungsWalked: number | null;
    readonly leads: readonly AssignmentLead[];
    readonly moreLeads: number;
    readonly says: string;
  }>;
  readonly downloaded: Held<{
    readonly count: number;
    readonly complete: Measured;
    readonly bytes: number | null;
    readonly items: readonly AssignmentDownload[];
    readonly more: number;
    readonly says: string;
  }>;
}

export interface AssignmentParsing {
  readonly parsed: Held<{
    readonly runs: number;
    readonly succeeded: number;
    readonly failed: number;
    readonly usable: Held<Measured>;
    readonly failures: readonly string[];
    readonly says: string;
  }>;
}

export interface AssignmentCheck {
  readonly who: string;
  readonly verdict: string;
  readonly at: string;
  readonly says: string;
  readonly resultId: string;
}

export interface AssignmentRejection {
  readonly stage: string;
  readonly code: string;
  readonly says: string;
  /** A guard code (duplicate or out-of-order write) is not a record rejected on quality. */
  readonly guard: boolean;
  readonly itemId: string;
}

export interface AssignmentVerification {
  readonly pipeline: Held<{
    readonly unit: "pipeline item" | "validation check";
    readonly items: number;
    readonly passed: Measured;
    readonly needsMoreEvidence: Measured;
    readonly rejected: Measured;
    readonly furthest: Readonly<Record<PipelineStage, number>> | null;
    readonly rejections: readonly AssignmentRejection[];
    readonly moreRejections: number;
    readonly guardRefusals: number;
    readonly itemIds: readonly string[];
    readonly says: string;
  }>;
  readonly checks: readonly AssignmentCheck[];
  readonly moreChecks: number;
    /** Dated, because a refusal's text states the limit in force when it was recorded. */
  readonly refusedFinishes: readonly { readonly attemptId: string; readonly at: string; readonly codes: readonly string[]; readonly says: string }[];
  readonly refusedFinishCount: number;
}

export interface PromotionStatus {
  readonly state: "PROMOTED" | "NOT_PROMOTED";
  readonly says: string;
  readonly versionId: string | null;
  readonly at: string | null;
}

export interface PublicAvailability {
  readonly state: "CONFIRMED" | "NO_READER_PAGE";
  readonly at: string | null;
  readonly says: string;
  readonly proof: string | null;
}

export interface AssignmentDelivery {
  readonly records?: { readonly added: number; readonly changed: number; readonly reused: number };
  readonly recordChanges?: NonNullable<WorkItem["publicationOutcome"]>["recordChanges"];
  readonly approved: Held<Measured> | null;
  readonly promoted: Held<PromotionStatus>;
  readonly publiclyAvailable: Held<PublicAvailability>;
  readonly blockers: readonly string[];
}

export type AssignmentDollars =
  | { readonly kind: "MEASURED"; readonly usd: Held<Measured>; readonly amount: number }
  | { readonly kind: "PLAIN_CODE"; readonly says: string }
  | { readonly kind: "UNMEASURED"; readonly gap: Gap }
  | { readonly kind: "NOTHING_RAN"; readonly says: string };

export interface AssignmentCost {
  readonly dollars: AssignmentDollars;
  readonly entries: number;
  readonly measured: number;
  readonly unmeasured: number;
  readonly plainCode: number;
  readonly noModelCall: number;
  readonly attemptsWithoutCostRow: number;
  readonly plainAttemptsWithoutCostRow: number | null;
  readonly rounds: number | null;
  readonly attempts: number | null;

  readonly retries: number | null;
  readonly escalations: { readonly toOwner: number; readonly modelRouting: Gap | null };
  readonly nonDollar: { readonly requests: number; readonly bytes: number; readonly durationMs: number } | null;
  readonly says: string;
}

export type AssignmentBlocker =
  | { readonly kind: "NONE"; readonly says: string }
  | { readonly kind: "NAMED"; readonly says: string }
  | { readonly kind: "UNKNOWN"; readonly gap: Gap };

export interface AssignmentWaiting {
  readonly waiting: boolean;
  readonly since: string | null;
  readonly overdue: boolean | null;
  readonly dueAt: string | null;
  readonly retryAt: string | null;
  /** When the runner may next dispatch it: the later of `dueAt` and `retryAt`. */
  readonly eligibleAt: string | null;
  readonly backoff: {
    readonly failures: number;
    readonly since: string;
    readonly retryClass: string;
    readonly says: string;
  } | null;
  readonly blocker: AssignmentBlocker;
  readonly owner: NextStepOwner;
  readonly nextAction: string;
  readonly openRound: { readonly id: string; readonly openedAt: string; readonly dueAt: string; readonly reached: boolean } | null;
}

export interface AssignmentNote {
  readonly at: string | null;
  readonly from: string;
  readonly text: string;
}

export interface AssignmentEvidence {
  readonly obligationId: string | null;
  readonly workItemIds: readonly string[];
  readonly routeTaskIds: readonly string[];
  readonly attemptIds: readonly string[];
  readonly occurrenceIds: readonly string[];
  readonly dispositionCommitIds: readonly string[];
  readonly otherIds: readonly { readonly what: string; readonly id: string }[];
  readonly notes: readonly AssignmentNote[];
  readonly more: {
    readonly workItems: number;
    readonly routeTasks: number;
    readonly attempts: number;
    readonly occurrences: number;
    readonly dispositionCommits: number;
    readonly otherIds: number;
    readonly notes: number;
  };
}

export interface AssignmentRow {
  readonly id: string;
  readonly kind: AssignmentKind;
  readonly lane: AssignmentLane;
  readonly state: AssignmentState;
  readonly stateSays: string;
  readonly lastActivityAt: string | null;
  readonly what: AssignmentWhat;
  readonly discovery: AssignmentDiscovery;
  readonly parsing: AssignmentParsing;
  readonly verification: AssignmentVerification;
  readonly delivery: AssignmentDelivery;
  readonly cost: AssignmentCost;
  readonly waiting: AssignmentWaiting;
  readonly evidence: AssignmentEvidence;
}

export interface AssignmentListRow {
  readonly id: string;
  readonly kind: AssignmentKind;
  readonly lane: AssignmentLane;
  readonly state: AssignmentState;
  readonly stateSays: string;
  readonly lastActivityAt: string | null;
  readonly title: string;
  readonly subjectName: string | null;
  readonly where: string | null;
  readonly stateCode?: string | null;
  readonly assignmentKeys?: readonly string[];
  readonly band: 1 | 2 | 3 | null;
  readonly workers: readonly { readonly role: string; readonly model: WorkerModel; readonly attempts: number | null }[] | null;
  readonly discovered: { readonly routes: number; readonly records: number; readonly pointers: number; readonly sourceRows: number | null } | null;
  readonly downloaded: Measured | null;
  readonly parsed: { readonly succeeded: number; readonly failed: number; readonly usable: Measured | null } | null;
  readonly verification: {
    readonly unit: "pipeline item" | "validation check";
    readonly items: number;
    readonly passed: number;
    readonly needsMoreEvidence: number;
    readonly rejected: number;
    readonly refusedFinishes: number;
  } | null;
  readonly promoted: PromotionStatus["state"] | null;
  readonly publiclyAvailable: PublicAvailability["state"] | null;
  readonly cost: {
    readonly kind: AssignmentDollars["kind"];
    readonly usd: Measured | null;
    readonly unmeasured: number;
    readonly attempts: number | null;
    readonly retries: number | null;
  };
  readonly waiting: {
    readonly waiting: boolean;
    readonly since: string | null;
    readonly overdue: boolean | null;
    readonly eligibleAt: string | null;
    readonly blocker: string | null;
    readonly owner: NextStepOwner;
    readonly nextAction: string;
  };
}

export function listRowOf(row: AssignmentRow, textClip = ASSIGNMENT_TEXT_CLIP): AssignmentListRow {
  const discovered = row.discovery.discovered.held ? row.discovery.discovered.value : null;
  const parsed = row.parsing.parsed.held ? row.parsing.parsed.value : null;
  const pipeline = row.verification.pipeline.held ? row.verification.pipeline.value : null;
  const w = row.waiting;
  return {
    id: row.id,
    kind: row.kind,
    lane: row.lane,
    state: row.state,
    stateSays: clip(row.stateSays, textClip),
    lastActivityAt: row.lastActivityAt,
    title: clip(row.what.title, textClip),
    subjectName: row.what.subjectName,
    where: row.what.where.held ? row.what.where.value.name : null,
    stateCode: assignmentStateCode(row),
    assignmentKeys: [...new Set((row.what.assignments ?? []).map(mark => mark.assignmentKey))],
    band: row.what.why.band?.band ?? null,
    workers: row.what.workers.held ? row.what.workers.value.map((x) => ({ role: x.role, model: x.model, attempts: x.attempts })) : null,
    discovered: discovered ? { routes: discovered.routes, records: discovered.records, pointers: discovered.pointers, sourceRows: discovered.sourceRows } : null,
    downloaded: row.discovery.downloaded.held ? row.discovery.downloaded.value.complete : null,
    parsed: parsed ? { succeeded: parsed.succeeded, failed: parsed.failed, usable: parsed.usable.held ? parsed.usable.value : null } : null,
    verification: pipeline
      ? {
          unit: pipeline.unit,
          items: pipeline.items,
          passed: pipeline.passed.value,
          needsMoreEvidence: pipeline.needsMoreEvidence.value,
          rejected: pipeline.rejected.value,
          refusedFinishes: row.verification.refusedFinishCount,
        }
      : null,
    promoted: row.delivery.promoted.held ? row.delivery.promoted.value.state : null,
    publiclyAvailable: row.delivery.publiclyAvailable.held ? row.delivery.publiclyAvailable.value.state : null,
    cost: {
      kind: row.cost.dollars.kind,
      usd: row.cost.dollars.kind === "MEASURED" && row.cost.dollars.usd.held ? row.cost.dollars.usd.value : null,
      unmeasured: row.cost.unmeasured + row.cost.attemptsWithoutCostRow,
      attempts: row.cost.attempts,
      retries: row.cost.retries,
    },
    waiting: {
      waiting: w.waiting,
      since: w.since,
      overdue: w.overdue,
      eligibleAt: w.eligibleAt,
      blocker: w.blocker.kind === "NONE" ? null : w.blocker.kind === "NAMED" ? clip(w.blocker.says, textClip) : clip(w.blocker.gap.says, textClip),
      owner: w.owner,
      nextAction: clip(w.nextAction, textClip),
    },
  };
}

export interface AssignmentSources {
  readonly nowIso: string;
  readonly obligations: readonly StandingObligation[];
  readonly occurrences: readonly FreshnessOccurrence[];
  readonly workItems: readonly WorkItem[];
  readonly routeTasks: readonly RouteTask[];
  readonly attempts: readonly Attempt[];
  readonly debts: readonly FreshnessDebt[];
  readonly leases: readonly ExecutionLease[] | null;
  readonly dispositions: readonly DispositionCommit[] | null;
  readonly artifacts: readonly ArtifactRecord[];
  readonly inheritedOrigins?: readonly { readonly artifact: ArtifactRecord; readonly attempt: Attempt; readonly originWorkItemId: string }[] | null;
  readonly costs: readonly CostEntry[];
  readonly scoutResults: readonly ScoutResult[];
  readonly workerResults: readonly WorkerResultRecord[];
  readonly pipeline: readonly PipelineItemState[] | null;
  readonly activation: ActivationGateReading | null;
    /** No served-reader readback producer is wired yet, so this is always null today. */
  readonly servedReader: import("./served-reader.ts").ServedReaderReadback | null;
  readonly pilotZips: readonly string[];
  readonly askGapObservations?: readonly AskGapObservation[] | null;
}

export interface AssignmentBuildOptions {
  readonly textClip?: number;
  readonly listClip?: number;
  readonly costDenominatorUsd?: number | null;
}

const HOUR_MS = 3_600_000;

function ms(iso: string | null | undefined): number {
  if (typeof iso !== "string") return Number.NaN;
  return Date.parse(iso);
}

function clip(text: string | null | undefined, max: number): string {
  const raw = (text ?? "").replace(/\s+/g, " ").trim();
  if (raw.length <= max) return raw;
  return `${raw.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export const clipText = clip;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function sentenceCase(slug: string | null | undefined): string {
  const text = (slug ?? "").replace(/[-_]+/g, " ").trim();
  return text === "" ? "" : text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function latestIso(values: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    const t = ms(v);
    if (Number.isFinite(t) && t > bestMs) {
      best = v as string;
      bestMs = t;
    }
  }
  return best;
}

function attemptTime(a: Attempt): number {
  const end = ms(a.endedAt);
  if (Number.isFinite(end)) return end;
  return ms(a.startedAt);
}

function byAttemptTime(a: Attempt, b: Attempt): number {
  return ms(a.startedAt) - ms(b.startedAt) || attemptTime(a) - attemptTime(b) || a.id.localeCompare(b.id);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function bounded<T>(items: readonly T[], n: number): { readonly items: readonly T[]; readonly more: number } {
  return { items: items.slice(0, n), more: Math.max(0, items.length - n) };
}

export const OBLIGATION_PROVIDER_PREFIXES: readonly { readonly prefix: string; readonly providerId: string }[] = [
  { prefix: "freshness:candidate-enrichment:", providerId: "candidate-enrichment" },
  { prefix: "freshness:jurisdiction:", providerId: "local-jurisdictions" },
  { prefix: "freshness:campaign-finance:", providerId: "campaign-finance" },
  { prefix: "freshness:meetings-discovery:", providerId: "meetings-discovery" },
  { prefix: "freshness:ask-gap:", providerId: "ask-gaps" },
];

export function providerOfObligation(id: string): string | null {
  return OBLIGATION_PROVIDER_PREFIXES.find((p) => id.startsWith(p.prefix))?.providerId ?? null;
}

export function isProofRecord(input: { readonly obligationId?: string | null; readonly project?: string | null }): boolean {
  if (typeof input.obligationId === "string" && input.obligationId.startsWith("proof-")) return true;
  return isProofProject(input.project);
}

export function isSharedCost(entry: Pick<CostEntry, "routeId" | "attemptId">): boolean {
  return entry.routeId === SCOUT_PREWARM_ROUTE_ID || entry.attemptId.startsWith("scout-prewarm:");
}

export function workerModelOf(worker: WorkerRef | null | undefined): WorkerModel {
  if (!worker) return { kind: "NOT_RECORDED", says: "model not recorded — the attempt carries no worker identity" };
  const version = (worker.version ?? "").trim();
  const provider = (worker.provider ?? "").trim();
  if (version === "") return { kind: "NOT_RECORDED", says: "model not recorded on this attempt" };
  if (version === "DETERMINISTIC_NO_MODEL") return { kind: "PLAIN_CODE", tool: version };
  if (modelKeyOf({ version, provider }) === NO_MODEL_KEY) return { kind: "PLAIN_CODE", tool: version };
  return { kind: "MODEL", id: version };
}

function canReachPaidModel(role: string, attempt: Attempt | undefined): boolean {
  if (attempt) {
    const model = workerModelOf(attempt.worker);
    if (model.kind === "MODEL") return true;
    if (model.kind === "PLAIN_CODE") return false;
  }
  const policy = (ROLE_COST_POLICY as Record<string, { readonly access: string } | undefined>)[role];
  // An unknown role is treated as able to spend, so its missing figure reads as unknown, never as free.
  return policy === undefined ? true : policy.access === "ROUTED_TO_A_PAID_MODEL";
}

type CostRowKind = "MEASURED" | "NO_MODEL_CALL" | "PLAIN_CODE" | "UNMEASURED";

function costRowKind(entry: CostEntry, attempt: Attempt | undefined): CostRowKind {
  const usd = entry.cost.usd;
  const modelCapable = canReachPaidModel(entry.role, attempt);
  if (typeof usd === "number" && Number.isFinite(usd)) {
    return usd === 0 && entry.cost.requestCount === 0 && modelCapable ? "NO_MODEL_CALL" : "MEASURED";
  }
  return modelCapable ? "UNMEASURED" : "PLAIN_CODE";
}

const GUARD_CODES = new Set(["STAGE_ALREADY_REACHED", "STAGE_OUT_OF_ORDER"]);
const stageIndex = (stage: PipelineStage | null): number => (stage === null ? -1 : PIPELINE_STAGES.indexOf(stage));

interface Index {
  readonly now: number;
  readonly obligations: Map<string, StandingObligation>;
  readonly occurrencesByObligation: Map<string, FreshnessOccurrence[]>;
  readonly occurrenceByWorkItem: Map<string, FreshnessOccurrence>;
  readonly workItems: Map<string, WorkItem>;
  readonly routeTasks: Map<string, RouteTask>;
  readonly routeTasksByWorkItem: Map<string, RouteTask[]>;
  readonly attempts: Map<string, Attempt>;
  readonly attemptsByRouteTask: Map<string, Attempt[]>;
  readonly attemptsByWorkItem: Map<string, Attempt[]>;
  readonly debts: Map<string, FreshnessDebt>;
  readonly leases: Map<string, ExecutionLease> | null;
  readonly commitsByRouteTask: Map<string, DispositionCommit[]>;
  readonly artifactsByWorkItem: Map<string, ArtifactRecord[]>;
  readonly costsByWorkItem: Map<string, CostEntry[]>;
  readonly scoutByAttempt: Map<string, ScoutResult>;
  readonly scoutsByWorkItem: Map<string, ScoutResult[]>;
  readonly workerResultsByWorkItem: Map<string, WorkerResultRecord[]>;
  readonly workerResultByAttempt: Map<string, WorkerResultRecord>;
  readonly pipelineByAttempt: Map<string, PipelineItemState[]>;
  readonly pipelineByWorkItem: Map<string, PipelineItemState[]>;
  readonly askedGaps: ReadonlyMap<string, AskedGap> | null;
}

function indexSources(src: AssignmentSources): Index {
  const obligations = new Map(src.obligations.map((o) => [o.id, o]));
  const occurrencesByObligation = new Map<string, FreshnessOccurrence[]>();
  const occurrenceByWorkItem = new Map<string, FreshnessOccurrence>();
  for (const occ of src.occurrences) {
    push(occurrencesByObligation, occ.obligationId, occ);
    occurrenceByWorkItem.set(occ.workItemId, occ);
  }
  for (const list of occurrencesByObligation.values()) list.sort((a, b) => a.sequence - b.sequence);

  const workItems = new Map(src.workItems.map((w) => [w.id, w]));
  const routeTasks = new Map(src.routeTasks.map((t) => [t.id, t]));
  const routeTasksByWorkItem = new Map<string, RouteTask[]>();
  for (const t of src.routeTasks) push(routeTasksByWorkItem, t.workItemId, t);
  for (const list of routeTasksByWorkItem.values()) list.sort((a, b) => ms(a.createdAt) - ms(b.createdAt) || a.id.localeCompare(b.id));

  const attempts = new Map(src.attempts.map((a) => [a.id, a]));
  const attemptsByRouteTask = new Map<string, Attempt[]>();
  const attemptsByWorkItem = new Map<string, Attempt[]>();
  for (const a of src.attempts) {
    push(attemptsByRouteTask, a.routeTaskId, a);
    push(attemptsByWorkItem, a.workItemId, a);
  }
  for (const list of attemptsByRouteTask.values()) list.sort(byAttemptTime);
  for (const list of attemptsByWorkItem.values()) list.sort(byAttemptTime);

  const debts = new Map(src.debts.map((d) => [d.obligationId, d]));
  const leases = src.leases === null ? null : new Map(src.leases.map((l) => [l.routeTaskId, l]));
  const commitsByRouteTask = new Map<string, DispositionCommit[]>();
  for (const c of src.dispositions ?? []) push(commitsByRouteTask, c.routeTaskId, c);

  const artifactsByWorkItem = new Map<string, ArtifactRecord[]>();
  for (const a of src.artifacts) push(artifactsByWorkItem, a.workItemId, a);
  const costsByWorkItem = new Map<string, CostEntry[]>();
  for (const c of src.costs) push(costsByWorkItem, c.workItemId, c);

  const scoutByAttempt = new Map<string, ScoutResult>();
  const scoutsByWorkItem = new Map<string, ScoutResult[]>();
  for (const r of src.scoutResults) {
    const held = scoutByAttempt.get(r.attemptId);
    if (held === undefined || ms(r.recordedAt) >= ms(held.recordedAt)) scoutByAttempt.set(r.attemptId, r);
    push(scoutsByWorkItem, r.workItemId, r);
  }

  const workerResultsByWorkItem = new Map<string, WorkerResultRecord[]>();
  const workerResultByAttempt = new Map<string, WorkerResultRecord>();
  for (const r of src.workerResults) {
    push(workerResultsByWorkItem, r.workItemId, r);
    workerResultByAttempt.set(r.attemptId, r);
  }

  const pipelineByAttempt = new Map<string, PipelineItemState[]>();
  const pipelineByWorkItem = new Map<string, PipelineItemState[]>();
  for (const state of src.pipeline ?? []) {
    const scouted = state.byStage.SCOUTED;
    if (!scouted) continue;
    const source = scouted.source;
    if (source.kind === "FLEET_EXTRACTION") push(pipelineByWorkItem, source.workItemId, state);
    else if (source.kind !== "PROMOTED_CANDIDACY") push(pipelineByAttempt, source.attemptId, state);
  }

  return {
    now: Date.parse(src.nowIso),
    obligations,
    occurrencesByObligation,
    occurrenceByWorkItem,
    workItems,
    routeTasks,
    routeTasksByWorkItem,
    attempts,
    attemptsByRouteTask,
    attemptsByWorkItem,
    debts,
    leases,
    commitsByRouteTask,
    artifactsByWorkItem,
    costsByWorkItem,
    scoutByAttempt,
    scoutsByWorkItem,
    workerResultsByWorkItem,
    workerResultByAttempt,
    pipelineByAttempt,
    pipelineByWorkItem,
    askedGaps: src.askGapObservations ? foldAskGapObservations(src.askGapObservations, src.nowIso).asked : null,
  };
}

function obligationOfWorkItem(workItemId: string, idx: Index, seen = new Set<string>()): string | null {
  if (seen.has(workItemId)) return null;
  seen.add(workItemId);
  const occ = idx.occurrenceByWorkItem.get(workItemId);
  if (occ) return occ.obligationId;
  const item = idx.workItems.get(workItemId);
  const directory = item?.directoryParent;
  const directoryParent = directory && idx.workItems.get(directory.workItemId);
  if (directoryParent && directoryParent.project === item?.project && directoryParent.subject === item.subject &&
    directoryParent.publicationOutcome?.bodyIds?.includes(directory!.bodyId) &&
    item.autonomousPlan?.publication?.bodyId === directory!.bodyId) return obligationOfWorkItem(directoryParent.id, idx, seen);
  const clause = item?.obligation ?? "";
  const m = /^(.*)#(\d+)$/.exec(clause);
  if (m && idx.obligations.has(m[1])) return m[1];
  const link = (item as (WorkItem & { planRepair?: { parentWorkItemId: string; authority: string } }) | undefined)?.planRepair;
  const parent = link && idx.workItems.get(link.parentWorkItemId);
  // A repair retains the original assignment and its Send attribution. Do not
  // hide an orphan, changed subject, or cyclic link inside an unrelated row.
  return parent && link?.authority === "WORK_INSTRUCTIONS_ONLY" && parent.subject === item?.subject
    ? obligationOfWorkItem(parent.id, idx, seen) : null;
}

interface Members {
  readonly id: string;
  readonly kind: "STANDING_OBLIGATION" | "WORK_ITEM";
  readonly obligationId: string | null;
  readonly workItemIds: Set<string>;
}

function members(idx: Index): Map<string, Members> {
  const out = new Map<string, Members>();
  const standing = (obligationId: string): Members => {
    const held = out.get(obligationId);
    if (held) return held;
    const created: Members = { id: obligationId, kind: "STANDING_OBLIGATION", obligationId, workItemIds: new Set() };
    out.set(obligationId, created);
    return created;
  };
  for (const id of idx.obligations.keys()) standing(id);
  for (const [obligationId, occs] of idx.occurrencesByObligation) {
    const m = standing(obligationId);
    for (const occ of occs) m.workItemIds.add(occ.workItemId);
  }
  const workItemIds = new Set<string>([
    ...idx.workItems.keys(),
    ...idx.routeTasksByWorkItem.keys(),
    ...idx.attemptsByWorkItem.keys(),
    ...idx.workerResultsByWorkItem.keys(),
  ]);
  for (const wi of workItemIds) {
    const obligationId = obligationOfWorkItem(wi, idx);
    if (obligationId !== null) {
      standing(obligationId).workItemIds.add(wi);
      continue;
    }
    if (!out.has(wi)) out.set(wi, { id: wi, kind: "WORK_ITEM", obligationId: null, workItemIds: new Set([wi]) });
  }
  return out;
}

interface Round {
  readonly occurrence: FreshnessOccurrence | null;
  readonly routeTask: RouteTask | null;
  readonly routeTaskId: string | null;
  readonly attempts: readonly Attempt[];
}

interface RoundOutcome {
  readonly state: "WORKING" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "UNKNOWN";
  readonly code: string;
  readonly says: string;
  readonly at: string | null;
  readonly owner: NextStepOwner;
  readonly nextAction: string;
}

function leaseLive(attempt: Attempt, idx: Index): boolean | null {
  if (idx.leases === null) return null;
  const lease = idx.leases.get(attempt.routeTaskId);
  if (!lease) return false;
  return lease.id === attempt.leaseId && !lease.released && ms(lease.expiresAt) > idx.now;
}

function fromDisposition(d: RouteDisposition, clipAt: number): RoundOutcome {
  const note = clip(d.note, clipAt);
  const count = d.artifactIds.length;
  switch (d.disposition) {
    case "INGESTED":
      return { state: "SUCCEEDED", code: d.disposition, says: `A record was acquired (${plural(count, "document")} vaulted).`, at: d.at, owner: "RUNNER", nextAction: "" };
    case "DISCOVERED":
      return { state: "SUCCEEDED", code: d.disposition, says: "A route to the record was found; the record itself is still owed.", at: d.at, owner: "RUNNER", nextAction: "" };
    case "POINTER_ONLY":
      return { state: "SUCCEEDED", code: d.disposition, says: "A pointer to the record was acquired, not the record itself.", at: d.at, owner: "RUNNER", nextAction: "" };
    case "WALKED_NO_YIELD":
      return {
        state: "SUCCEEDED",
        code: d.disposition,
        says: "The route was walked and returned nothing on this date — a finished reading of this route, not a finding that the record does not exist.",
        at: d.at,
        owner: "RUNNER",
        nextAction: "",
      };
    case "NOT_APPLICABLE":
      return { state: "SUCCEEDED", code: d.disposition, says: "The route was found not to apply to this subject.", at: d.at, owner: "RUNNER", nextAction: "" };
    case "RECHECK_DUE":
      return { state: "SUCCEEDED", code: d.disposition, says: "A reading is held and its recheck is due.", at: d.at, owner: "RUNNER", nextAction: "" };
    case "BLOCKED_CURRENTLY":
      return {
        state: "FAILED",
        code: d.disposition,
        says: `A wall at the source stopped this route: ${note}`,
        at: d.at,
        owner: "RUNNER",
        nextAction: "The runner tries the route again on its backoff; if the wall stands, another route to the same record is owed.",
      };
    case "REQUIRES_NEW_ADAPTER":
      return {
        state: "BLOCKED",
        code: d.disposition,
        says: `It needs an adapter this system does not have yet — a missing capability of ours, not a fact about the source: ${note}`,
        at: d.at,
        owner: "ENGINEERING",
        nextAction: "Build (or admit) an adapter for this route; until then the record stays owed and its clock keeps running.",
      };
    case "RECORDS_REQUEST_PENDING":
      return {
        state: "BLOCKED",
        code: d.disposition,
        says: `A records request is outstanding with the publisher: ${note}`,
        at: d.at,
        owner: "SOURCE",
        nextAction: "Wait for the publisher's answer to the records request.",
      };
    case "UNWALKED":
    case "IN_PROGRESS":
      return {
        state: "UNKNOWN",
        code: d.disposition,
        says: `The route was closed as "${plainCode(d.disposition).toLowerCase()}", which describes no outcome: ${note}`,
        at: d.at,
        owner: "ENGINEERING",
        nextAction: "Inspect the route task: a closed round should carry an outcome.",
      };
  }
}

function fromScout(s: ScoutResult, clipAt: number): RoundOutcome {
  if (s.refusal !== null && s.refusal.length > 0) {
    const codes = s.refusal.map((r) => r.code);
    const transport = codes.includes("SCOUT_TRANSPORT_FAILED");
    return {
      state: "FAILED",
      code: codes.join(", "),
      says: transport
        ? "The model provider did not answer the hunter, so nothing it said stands (the model transport failed)."
        : `The hunter's finish was refused: ${codes.map((c) => plainCode(c).toLowerCase()).join("; ")} — ${clip(s.refusal[0]?.detail, clipAt)}`,
      at: s.recordedAt,
      owner: "RUNNER",
      nextAction: "The obligation stays owed; the runner sends a hunter again when it comes due.",
    };
  }
  const walked = `${plural(s.rungs.length, "rung")} walked, ${plural(s.distinctEvidenceRungs, "rung")} backed by evidence`;
  switch (s.outcome) {
    case "ROUTE_CANDIDATE":
      return { state: "SUCCEEDED", code: s.outcome, says: `The hunter proposed ${plural(s.candidates.length, "route")} to the record, each backed by evidence it downloaded (${walked}).`, at: s.recordedAt, owner: "RUNNER", nextAction: "" };
    case "EVIDENCE_FOUND":
      return { state: "SUCCEEDED", code: s.outcome, says: `The hunter found evidence of the record itself (${plural(s.findings.length, "finding")}; ${walked}).`, at: s.recordedAt, owner: "RUNNER", nextAction: "" };
    case "NO_PROGRESS":
      return {
        state: "FAILED",
        code: s.outcome,
        says: `The hunter found no route and no record (${walked}); it named ${plural(s.nextRungs.length, "next rung")} to try.`,
        at: s.recordedAt,
        owner: "RUNNER",
        nextAction: "The obligation stays owed; the next hunter resumes from the named next rungs rather than starting over.",
      };
    case "BLOCKED":
      return {
        state: "FAILED",
        code: s.outcome,
        says: `Every route the hunter tried was walled (${walked}).`,
        at: s.recordedAt,
        owner: "RUNNER",
        nextAction:
          "Walls can lift: the runner tries again on its backoff. An access control (a login, a bot check, a rate limit) is never bypassed, and another public route is still owed; a robots file no longer counts as a wall.",
      };
    case "NEEDS_ADAPTER":
      return {
        state: "BLOCKED",
        code: s.outcome,
        says: `The hunter found where the record lives, and it needs an adapter this system does not have (${walked}).`,
        at: s.recordedAt,
        owner: "ENGINEERING",
        nextAction: "Build the adapter the hunter named; the record stays owed until then.",
      };
    case "HUMAN_REQUIRED":
      return {
        state: "BLOCKED",
        code: s.outcome,
        says: `Only a person or an offline act can move this (${walked}).`,
        at: s.recordedAt,
        owner: "OWNER",
        nextAction: "Decide who makes the human or offline step; nothing automatic can.",
      };
  }
}

function fromWorkerResult(r: WorkerResultRecord, clipAt: number): RoundOutcome {
  const result = r.result;
  const finding = (): string => {
    const f = (result as { readonly findings?: readonly { readonly detail: string }[] }).findings?.[0]?.detail ?? "";
    return f === "" ? "" : ` — ${clip(f, clipAt)}`;
  };
  const at = r.endedAt;
  switch (result.role) {
    case "ACQUIRER": {
      const blocker = result.blockers[0]?.description ?? "";
      if (result.verdict === "BLOCKED") {
        return {
          state: "BLOCKED",
          code: `ACQUIRER_${result.verdict}`,
          says: `The acquirer was blocked${blocker ? `: ${clip(blocker, clipAt)}` : finding()}`,
          at,
          owner: "ENGINEERING",
          nextAction: "Clear the named blocker (an access control met by another public route, an adapter or a decision), then acquire again.",
        };
      }
      return {
        state: "SUCCEEDED",
        code: `ACQUIRER_${result.verdict}`,
        says: result.verdict === "EMPTY" ? "The acquirer reached the source and it returned nothing." : `The acquirer ${result.verdict === "PARTIAL" ? "partly " : ""}acquired the source.`,
        at,
        owner: "FLEET",
        nextAction: "",
      };
    }
    case "PARSER":
      return result.verdict === "EXTRACTED"
        ? { state: "SUCCEEDED", code: "PARSER_EXTRACTED", says: `The parser extracted ${plural(result.actualRowCount, "record")} with evidence spans.`, at, owner: "FLEET", nextAction: "" }
        : { state: "FAILED", code: `PARSER_${result.verdict}`, says: `The parser could not turn the download into records (${plainCode(result.verdict).toLowerCase()})${finding()}`, at, owner: "FLEET", nextAction: "Another extraction path is owed: the download stays vaulted." };
    case "VALIDATOR":
      return result.verdict === "PASS"
        ? { state: "SUCCEEDED", code: "VALIDATOR_PASS", says: `The validator passed ${plural(result.validatedRecordCount, "record")}.`, at, owner: "FLEET", nextAction: "" }
        : result.verdict === "FAIL"
          ? { state: "FAILED", code: "VALIDATOR_FAIL", says: `The validator failed the extraction${finding()}`, at, owner: "FLEET", nextAction: "The extraction is re-derived before it can pass." }
          : { state: "BLOCKED", code: "VALIDATOR_INCONCLUSIVE", says: `The validator could not decide — more evidence is needed${finding()}`, at, owner: "FLEET", nextAction: "Acquire the independent evidence the validator needs." };
    case "ADVERSARIAL_AUDITOR":
      return result.verdict === "SURVIVED"
        ? { state: "SUCCEEDED", code: "AUDIT_SURVIVED", says: `The claim survived the adversarial audit (${plural(result.survivingRecordCount, "record")}).`, at, owner: "FLEET", nextAction: "" }
        : result.verdict === "BROKE"
          ? { state: "FAILED", code: "AUDIT_BROKE", says: `The auditor broke the claim${finding()}`, at, owner: "FLEET", nextAction: "The work is reopened; the broken claim cannot promote." }
          : { state: "BLOCKED", code: "AUDIT_INCONCLUSIVE", says: `The audit could not decide — more evidence is needed${finding()}`, at, owner: "FLEET", nextAction: "Supply the independent evidence the audit asked for." };
    case "DETECTIVE":
      return result.verdict === "SUPPORTED"
        ? { state: "SUCCEEDED", code: "DETECTIVE_SUPPORTED", says: `The detective's evidence supports the answer: ${clip(result.conclusion, clipAt)}`, at, owner: "FLEET", nextAction: "" }
        : { state: "FAILED", code: `DETECTIVE_${result.verdict}`, says: `The detective did not settle it (${plainCode(result.verdict).toLowerCase()}): ${clip(result.nextAction, clipAt)}`, at, owner: "FLEET", nextAction: clip(result.nextAction, clipAt) };
  }
}

function roundOutcome(round: Round, idx: Index, clipAt: number): RoundOutcome | null {
  if (round.attempts.length === 0) return null;
  for (const a of round.attempts) {
    if (a.outcome === null && leaseLive(a, idx) === true) {
      return {
        state: "WORKING",
        code: "IN_FLIGHT",
        says: `${plainCode(a.worker.role)} ${a.id} is on it now (started ${a.startedAt}).`,
        at: a.startedAt,
        owner: a.worker.role === "SCOUT" ? "SCOUT_LANE" : "RUNNER",
        nextAction: "Let it finish; its lease is renewed while it works.",
      };
    }
  }
  const d = round.routeTask?.disposition ?? null;
  if (d) {
        /* A Scout's own typed outcome says more than the disposition it was mapped to, so it leads. */
    const scout = idx.scoutByAttempt.get(d.attemptId);
    if (scout && (scout.refusal === null || scout.refusal.length === 0)) return fromScout(scout, clipAt);
    return fromDisposition(d, clipAt);
  }
  if (round.routeTask?.state === "POLICY_DENIED" && round.routeTask.policyDenial) {
    return {
      state: "BLOCKED",
      code: "POLICY_DENIED",
      says: `Our own policy refused a capability this route needs: ${clip(round.routeTask.policyDenial.reason, clipAt)}`,
      at: round.routeTask.policyDenial.at,
      owner: "ENGINEERING",
      nextAction: clip(round.routeTask.policyDenial.requiredChange, clipAt),
    };
  }
  const last = [...round.attempts].sort((a, b) => attemptTime(a) - attemptTime(b)).at(-1) as Attempt;
  if (last.outcome === null) {
    const live = leaseLive(last, idx);
    return live === null
      ? {
          state: "UNKNOWN",
          code: "OPEN_ATTEMPT_LEASE_NOT_READ",
          says: `Attempt ${last.id} is open and its lease was not read, so whether a worker still holds it cannot be told.`,
          at: last.startedAt,
          owner: "ENGINEERING",
          nextAction: "Read the lease for this route task.",
        }
      : {
          state: "FAILED",
          code: "WORKER_LOST",
          says: `Attempt ${last.id} was never closed and holds no live lease: the worker stopped without reaching a boundary.`,
          at: last.startedAt,
          owner: "RUNNER",
          nextAction: "The expired lease is closed and the route task reclaimed; a replacement attempt starts fresh.",
        };
  }
  const scout = idx.scoutByAttempt.get(last.id);
  if (scout) return fromScout(scout, clipAt);
  const worker = idx.workerResultByAttempt.get(last.id);
  if (worker) return fromWorkerResult(worker, clipAt);
  if (last.outcome === "COMPLETED") {
    return {
      state: "FAILED",
      code: "COMPLETED_WITHOUT_DISPOSITION",
      says: `Attempt ${last.id} completed and no disposition was recorded — a lost disposition in our writer, not a fact about the source.`,
      at: last.endedAt,
      owner: "ENGINEERING",
      nextAction: "Find why the completed attempt's disposition was not committed.",
    };
  }
  if (last.outcome === "DENIED_BY_POLICY") {
    return {
      state: "BLOCKED",
      code: last.outcome,
      says: `Our own policy refused this attempt: ${clip(last.abortReason, clipAt)}`,
      at: last.endedAt,
      owner: "ENGINEERING",
      nextAction: "Change the grant or policy named in the refusal before retrying; an identical retry is refused identically.",
    };
  }
  return {
    state: "FAILED",
    code: last.outcome,
    says: `The attempt ${plainCode(last.outcome).toLowerCase()}: ${clip(last.abortReason, clipAt) || "no reason was recorded"}`,
    at: last.endedAt,
    owner: "RUNNER",
    nextAction: "The route task is reclaimable; the runner starts a fresh attempt when the work comes due.",
  };
}

interface Gathered {
  readonly members: Members;
  readonly obligation: StandingObligation | null;
  readonly occurrences: readonly FreshnessOccurrence[];
  readonly workItems: readonly WorkItem[];
  readonly missingWorkItems: readonly string[];
  readonly rounds: readonly Round[];
  readonly attempts: readonly Attempt[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly costs: readonly CostEntry[];
  readonly scouts: readonly ScoutResult[];
  readonly workerResults: readonly WorkerResultRecord[];
  readonly pipeline: readonly PipelineItemState[];
  readonly commits: readonly DispositionCommit[];
  readonly debt: FreshnessDebt | null;
  readonly observed: readonly RouteDisposition[];
}

function gather(m: Members, idx: Index): Gathered {
  const obligation = m.obligationId === null ? null : (idx.obligations.get(m.obligationId) ?? null);
  const occurrences = m.obligationId === null ? [] : (idx.occurrencesByObligation.get(m.obligationId) ?? []);
  const workItemIds = [...m.workItemIds];
  const workItems = workItemIds.map((id) => idx.workItems.get(id)).filter((w): w is WorkItem => w !== undefined);
  const missingWorkItems = workItemIds.filter((id) => !idx.workItems.has(id) && !idx.occurrenceByWorkItem.has(id));

  const rounds: Round[] = [];
  const seenTasks = new Set<string>();
  for (const occ of occurrences) {
    seenTasks.add(occ.routeTaskId);
    rounds.push({
      occurrence: occ,
      routeTask: idx.routeTasks.get(occ.routeTaskId) ?? null,
      routeTaskId: occ.routeTaskId,
      attempts: idx.attemptsByRouteTask.get(occ.routeTaskId) ?? [],
    });
  }
  for (const wi of workItemIds) {
    for (const task of idx.routeTasksByWorkItem.get(wi) ?? []) {
      if (seenTasks.has(task.id)) continue;
      seenTasks.add(task.id);
      rounds.push({ occurrence: null, routeTask: task, routeTaskId: task.id, attempts: idx.attemptsByRouteTask.get(task.id) ?? [] });
    }
    for (const a of idx.attemptsByWorkItem.get(wi) ?? []) {
      if (seenTasks.has(a.routeTaskId)) continue;
      seenTasks.add(a.routeTaskId);
      rounds.push({ occurrence: null, routeTask: null, routeTaskId: a.routeTaskId, attempts: idx.attemptsByRouteTask.get(a.routeTaskId) ?? [a] });
    }
  }

  const attempts = rounds.flatMap((r) => r.attempts).sort(byAttemptTime);
  const attemptIds = new Set(attempts.map((a) => a.id));
  const artifacts = workItemIds.flatMap((wi) => idx.artifactsByWorkItem.get(wi) ?? []);
  const costs = workItemIds.flatMap((wi) => idx.costsByWorkItem.get(wi) ?? []);
  const scoutSeen = new Set<string>();
  const scouts: ScoutResult[] = [];
  for (const r of [...attempts.map((a) => idx.scoutByAttempt.get(a.id)), ...workItemIds.flatMap((wi) => idx.scoutsByWorkItem.get(wi) ?? [])]) {
    if (!r || scoutSeen.has(`${r.attemptId}|${r.recordedAt}`)) continue;
    scoutSeen.add(`${r.attemptId}|${r.recordedAt}`);
    scouts.push(r);
  }
  scouts.sort((a, b) => ms(a.recordedAt) - ms(b.recordedAt));
  const workerResults = workItemIds.flatMap((wi) => idx.workerResultsByWorkItem.get(wi) ?? []).sort((a, b) => ms(a.endedAt) - ms(b.endedAt));
  const pipelineSeen = new Set<string>();
  const pipeline: PipelineItemState[] = [];
  for (const s of [...[...attemptIds].flatMap((id) => idx.pipelineByAttempt.get(id) ?? []), ...workItemIds.flatMap((wi) => idx.pipelineByWorkItem.get(wi) ?? [])]) {
    if (pipelineSeen.has(s.itemId)) continue;
    pipelineSeen.add(s.itemId);
    pipeline.push(s);
  }
  const commits = rounds.flatMap((r) => (r.routeTaskId === null ? [] : (idx.commitsByRouteTask.get(r.routeTaskId) ?? [])));
  const debt = m.obligationId === null ? null : (idx.debts.get(m.obligationId) ?? null);
  const observed = rounds
    .map((r) => r.routeTask?.disposition ?? null)
    .filter((d): d is RouteDisposition => d !== null && d.observation !== null)
    .filter((d) => workerModelOf(idx.attempts.get(d.attemptId)?.worker).kind === "PLAIN_CODE")
    .sort((a, b) => ms(a.at) - ms(b.at));
  return { members: m, obligation, occurrences, workItems, missingWorkItems, rounds, attempts, artifacts, costs, scouts, workerResults, pipeline, commits, debt, observed };
}

interface Clips {
  readonly text: number;
  readonly list: number;
}

function laneOf(g: Gathered): AssignmentLane {
  if (isProofRecord({ obligationId: g.members.obligationId, project: g.workItems[0]?.project ?? null })) return "PROOF";
  if (g.workItems.some((w) => isProofRecord({ project: w.project }))) return "PROOF";
  if (g.members.kind === "WORK_ITEM") return "CREATED";
  const last = g.attempts.at(-1);
  if (!last) return "UNASSIGNED";
  return last.worker.role === "SCOUT" ? "SCOUT" : "ROUTINE";
}

function workersOf(g: Gathered): Held<readonly AssignmentWorker[]> {
  if (g.attempts.length === 0) {
    return gap("OURS", "no worker has taken this yet, so no role or model is on record for it");
  }
  const reported = new Map<string, Set<string>>();
  for (const s of g.scouts) {
    if (s.worker.modelReported) {
      const set = reported.get(s.attemptId) ?? new Set<string>();
      set.add(s.worker.modelReported);
      reported.set(s.attemptId, set);
    }
  }
  const byKey = new Map<string, { role: string; model: WorkerModel; attempts: number; reported: Set<string> }>();
  for (const a of g.attempts) {
    const model = workerModelOf(a.worker);
    const key = `${a.worker?.role ?? "UNKNOWN"}|${model.kind}|${model.kind === "MODEL" ? model.id : model.kind === "PLAIN_CODE" ? model.tool : ""}`;
    const row = byKey.get(key) ?? { role: a.worker?.role ?? "UNKNOWN", model, attempts: 0, reported: new Set<string>() };
    row.attempts += 1;
    for (const r of reported.get(a.id) ?? []) row.reported.add(r);
    byKey.set(key, row);
  }
  return held(
    [...byKey.values()]
      .sort((a, b) => b.attempts - a.attempts || a.role.localeCompare(b.role))
      .map((r) => ({ role: r.role, model: r.model, attempts: r.attempts, reportedModels: [...r.reported].sort() })),
  );
}

/** A candidacy key carries its jurisdiction in the contest segment; it is rewritten as the OCD path it spells. Other shapes are left alone. */
export function jurisdictionKeyOf(subject: string): string {
  const m = /^[a-z]{2}:\d{4}:(state-[a-z]{2}(?:-[a-z0-9-]+)?):[a-z0-9-]+:[a-z0-9-]+$/i.exec(subject);
  if (!m) return subject;
  const contest = m[1].toLowerCase();
  const parts = ["country:us", `state:${contest.slice(6, 8)}`];
  let rest = contest.slice(8);
  const county = /^-county-(.+?)(?=-place-|-school-district-|$)/.exec(rest);
  if (county) {
    parts.push(`county:${county[1]}`);
    rest = rest.slice(county[0].length);
  }
  const tail = /^-(place|sldl|sldu|cd|school-district)-(.+)$/.exec(rest);
  if (tail) parts.push(`${tail[1] === "school-district" ? "school_district" : tail[1]}:${tail[2]}`);
  else if (rest !== "") return subject;
  return `ocd-division/${parts.join("/")}`;
}

function whereOf(subject: string | null): Held<{ readonly name: string; readonly state: string | null }> {
  if (subject === null || subject.trim() === "") return gap("OURS", "no subject is recorded on this assignment, so its jurisdiction cannot be named");
  const d = displayNameOf(jurisdictionKeyOf(subject));
  return held({ name: d.name, state: d.state });
}

function askedSays(idx: Index, bodyId: string, code: AskGapCode): string {
  if (idx.askedGaps === null) return "";
  const told = idx.askedGaps.get(askedGapKey(bodyId, code));
  return told === undefined ? ` No reader was told it in the last ${ASK_GAP_OBSERVATION_WINDOW_DAYS} days.` : ` ${askedWords(told)}`;
}

function whatOfStanding(g: Gathered, idx: Index, src: AssignmentSources, clips: Clips): AssignmentWhat {
  const ob = g.obligation;
  if (ob === null) {
    const occ = g.occurrences[0];
    return {
      title: `Standing obligation ${g.members.id}`,
      recordClass: null,
      subject: null,
      subjectName: null,
      route: null,
      where: gap("OURS", "the standing obligation row is not on record, only its rounds; its subject cannot be read"),
      why: {
        says: "Rounds of this obligation are recorded, but the obligation row itself is not, so why it is owed cannot be read.",
        dueAt: occ?.dueAt ?? null,
        cadence: null,
        readerImpactAt: null,
        band: null,
      },
      workers: workersOf(g),
    };
  }
  const scheduled = scheduleObligation(ob, idx.now);
  const band = bandFor(
    {
      id: ob.id,
      subjectId: ob.subjectId,
      readerImpactAt: ob.readerImpactAt,
      providerId: providerOfObligation(ob.id),
      nextDueAt: ob.nextDueAt ?? "",
    },
    { pilotZips: src.pilotZips },
  );
  const cadence = isScheduled(scheduled) ? clip(scheduled.basis, clips.text) : clip(`the scheduler cannot place it: ${scheduled.reason}`, clips.text);
  const routeWords = ob.routeId === null ? "no route named yet" : words(ob.routeId);
  const askGap = parseAskGapObligationId(ob.id);
  const latestRound = [...g.workItems].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0] ?? null;
  return {
    question: latestRound?.question ?? null,
    assignments: ob.assignments ?? [],
    title: askGap ? `${askGapTitle(askGap.code)} — ${displayNameOf(askGap.bodyId).short}` : `${sentenceCase(ob.recordClass)} via ${routeWords}`,
    recordClass: ob.recordClass,
    subject: ob.subjectId,
    subjectName: displayNameOf(ob.subjectId).short,
    route: ob.routeId,
    where: whereOf(ob.subjectId),
    why: {
      says: ob.active && askGap
        ? "Owed because Ask tells anyone who asks about this body that we do not hold this yet; it closes when a read holds the record." +
          askedSays(idx, askGap.bodyId, askGap.code)
        : ob.active
        ? `Owed on a standing freshness clock: ${sentenceCase(ob.recordClass).toLowerCase()} for this subject, through ${routeWords}.`
        : `This clock was retired${ob.retiredAt ? ` on ${ob.retiredAt}` : ""}: ${clip(ob.retirementReason ?? "no reason was recorded", clips.text)}`,
      dueAt: ob.nextDueAt ?? null,
      cadence,
      readerImpactAt: ob.readerImpactAt,
      band: { band: band.band, why: band.why },
    },
    workers: workersOf(g),
  };
}

function whatOfWorkItem(g: Gathered, clips: Clips): AssignmentWhat {
  const item = g.workItems[0] ?? null;
  const task = g.rounds.find((r) => r.routeTask?.workerTask)?.routeTask ?? g.rounds[0]?.routeTask ?? null;
  const recordClass = task?.workerTask?.contract.recordClass ?? g.scouts[0]?.recordClass ?? null;
  if (item === null) {
    return {
      title: `Work item ${g.members.id}`,
      recordClass,
      subject: null,
      subjectName: null,
      route: task?.routeId ?? null,
      where: gap("OURS", "the work item record is not on record — only work that names it — so its subject cannot be read"),
      why: { says: "Execution records name this work item, and the work item itself is not on record.", dueAt: null, cadence: null, readerImpactAt: null, band: null },
      workers: workersOf(g),
    };
  }
  return {
    title: clip(item.obligation, clips.text),
    recordClass,
    subject: item.subject,
    subjectName: displayNameOf(item.subject).short,
    route: task?.routeId ?? null,
    where: whereOf(item.subject),
    why: {
      says: clip(item.why, clips.text) || "No reason was recorded on the work item.",
      dueAt: null,
      cadence: null,
      readerImpactAt: null,
      band: null,
    },
    workers: workersOf(g),
  };
}

function discoveryOf(g: Gathered, clips: Clips): AssignmentDiscovery {
  const leads: AssignmentLead[] = [];
  const routeKeys = new Set<string>();
  const findingKeys = new Set<string>();
  let records = 0;
  let pointers = 0;
  let rungsWalked: number | null = null;
  const accepted = g.scouts.filter((s) => s.refusal === null || s.refusal.length === 0);
  for (const s of [...accepted].reverse()) {
    if (rungsWalked === null) rungsWalked = s.distinctEvidenceRungs;
    for (const c of s.candidates) {
      const key = `${c.routeId}|${c.url}`;
      if (routeKeys.has(key)) continue;
      routeKeys.add(key);
      leads.push({ kind: "ROUTE", says: clip(`${c.title}${c.procedure ? ` — ${c.procedure}` : ""}`, clips.text), url: c.url, artifactIds: c.evidenceArtifactIds });
    }
    for (const f of s.findings) {
      const key = `${f.kind}|${f.summary}`;
      if (findingKeys.has(key)) continue;
      findingKeys.add(key);
      if (f.kind === "RECORD") records += 1;
      else pointers += 1;
      leads.push({ kind: f.kind, says: clip(f.summary, clips.text), url: null, artifactIds: f.artifactIds });
    }
  }
  const observed = g.observed.at(-1);
  const sourceRows = observed?.observation?.rawCount ?? null;
  if (observed && sourceRows !== null) {
    leads.push({ kind: "SOURCE_ROWS", says: `The source returned ${plural(sourceRows, "row")} on ${observed.at.slice(0, 10)}.`, url: null, artifactIds: observed.artifactIds });
  }
  const listed = bounded(leads, clips.list);
  const discovered: AssignmentDiscovery["discovered"] =
    g.attempts.length === 0
      ? gap("OURS", "no worker has walked it yet, so nothing has been discovered — not a finding that nothing exists")
      : held({
          routes: routeKeys.size,
          records,
          pointers,
          sourceRows,
          rungsWalked,
          leads: listed.items,
          moreLeads: listed.more,
          says:
            routeKeys.size + records + pointers === 0 && sourceRows === null
              ? `${plural(g.attempts.length, "attempt")} ran and none recorded a route, a finding or a source row count.`
              : [
                  routeKeys.size > 0 ? `${plural(routeKeys.size, "route")} proposed` : null,
                  records > 0 ? `${plural(records, "record finding")}` : null,
                  pointers > 0 ? `${plural(pointers, "pointer")}` : null,
                  sourceRows !== null ? `${plural(sourceRows, "source row")} returned on the newest walk` : null,
                ]
                  .filter(Boolean)
                  .join("; ") + ".",
        });

  const artifacts = [...g.artifacts].sort((a, b) => ms(b.recordedAt) - ms(a.recordedAt));
  const partial = artifacts.filter((a) => a.partial).length;
  const bytes = artifacts.reduce((n, a) => n + (Number.isFinite(a.byteLength) ? a.byteLength : 0), 0);
  const items = bounded(artifacts, clips.list);
  const downloaded: AssignmentDiscovery["downloaded"] =
    g.attempts.length === 0 && artifacts.length === 0
      ? gap("OURS", "no worker has walked it yet, so nothing has been downloaded")
      : held({
          count: artifacts.length,
          complete: measured(
            artifacts.length - partial,
            artifacts.length,
            "complete captures, of the documents vaulted",
            "cp_log_artifacts",
          ),
          bytes,
          items: items.items.map((a) => ({
            artifactId: a.artifactId,
            url: a.canonicalUrl,
            bytes: a.byteLength,
            contentType: a.contentType,
            partial: a.partial,
            at: a.recordedAt,
            attemptId: a.attemptId,
          })),
          more: items.more,
          says:
            artifacts.length === 0
              ? `${plural(g.attempts.length, "attempt")} ran and vaulted no document.`
              : `${plural(artifacts.length, "document")} vaulted${partial > 0 ? `, ${partial} of them partial captures` : ""}.`,
        });
  return { rounds: g.rounds.length, attempts: g.attempts.length, discovered, downloaded };
}

const ACQUISITION_ONLY = /acquisition only|nothing here is normali[sz]ed/i;

function parsingOf(g: Gathered, clips: Clips): AssignmentParsing {
  const parsers = g.workerResults.filter((r) => r.result.role === "PARSER");
  const resulted = new Set(parsers.map((r) => r.attemptId));
  const closedParsers = g.attempts.filter((a) => a.worker?.role === "PARSER" && a.outcome !== null && !resulted.has(a.id));
  const abortedParsers = closedParsers.filter((a) => a.outcome !== "COMPLETED");
  const lostResults = closedParsers.length - abortedParsers.length;
  const failures: string[] = [];
  let succeeded = 0;
  let failed = 0;
  let usable: Held<Measured> = gap("OURS", "no parse has produced records for this assignment yet");
  for (const a of abortedParsers) {
    failed += 1;
    failures.push(clip(`${plainCode(a.outcome ?? "")}: ${a.abortReason ?? "no reason recorded"}`, clips.text));
  }
  for (const r of parsers) {
    const p = r.result;
    if (p.role !== "PARSER") continue;
    if (p.verdict === "EXTRACTED") {
      succeeded += 1;
      const rows = p.sourceRowCount ?? p.declaredRowCount;
      usable = held(
        rows !== null && rows >= p.actualRowCount
          ? measured(p.actualRowCount, rows, "records the newest parse extracted with evidence spans, of the rows the source held", `worker result ${r.id}`)
          : measured(p.actualRowCount, p.actualRowCount, "records the newest parse extracted, of the rows it extracted (the source row count was not recorded)", `worker result ${r.id}`),
      );
    } else {
      failed += 1;
      failures.push(clip(`${plainCode(p.verdict)}: ${p.warnings[0]?.detail ?? "no warning recorded"}`, clips.text));
    }
  }
  const normalizing = g.observed.filter((d) => !ACQUISITION_ONLY.test(d.note));
  const acquisitionOnly = g.observed.filter((d) => ACQUISITION_ONLY.test(d.note));
  for (const d of normalizing) {
    const o = d.observation;
    if (o === null) continue;
    succeeded += 1;
    if (o.rawCount >= o.normalizedCount) {
      usable = held(
        measured(o.normalizedCount, o.rawCount, "records the newest walk normalized, of the rows the source returned", `disposition at ${d.at}`),
      );
    }
  }
  const runs = parsers.length + normalizing.length + closedParsers.length;
  if (runs === 0) {
    const newest = acquisitionOnly.at(-1)?.observation ?? null;
    return {
      parsed: gap(
        "OURS",
        newest
          ? `no parse step has run: this route is acquisition-only, so the ${plural(newest.rawCount, "row")} the source returned were vaulted and not turned into records`
          : g.artifacts.length > 0
            ? "no parse step has run on the documents this assignment vaulted, so no usable records have been produced from them yet"
            : "no parse step has run, and nothing was vaulted for one to run on",
      ),
    };
  }
  const repeats = new Map<string, number>();
  for (const f of failures) repeats.set(f, (repeats.get(f) ?? 0) + 1);
  const listed = bounded(
    [...repeats].map(([text, n]) => (n > 1 ? `${n} times: ${text}` : text)),
    clips.list,
  );
  return {
    parsed: held({
      runs,
      succeeded,
      failed,
      usable,
      failures: listed.items,
      says: `${plural(runs, "parse step")} recorded: ${succeeded} produced records, ${failed} failed${lostResults > 0 ? `, ${lostResults} completed with no parse result on record` : ""}.`,
    }),
  };
}

function verificationOf(g: Gathered, src: AssignmentSources, clips: Clips): AssignmentVerification {
  const furthest: Record<PipelineStage, number> = { SCOUTED: 0, VERIFIED: 0, APPROVED_FOR_PROMOTION: 0 };
  const rejections: AssignmentRejection[] = [];
  let passed = 0;
  let rejected = 0;
  let needs = 0;
  let guardRefusals = 0;
  for (const s of g.pipeline) {
    if (s.stage !== null) furthest[s.stage] += 1;
    let quality = false;
    for (const r of s.records) {
      if (r.stage !== "REFUSED") continue;
      const refused = r as RefusedRecord;
      const guard = refused.reasons.every((reason) => GUARD_CODES.has(reason.code));
      if (guard) guardRefusals += 1;
      else quality = true;
      for (const reason of refused.reasons) {
        rejections.push({ stage: refused.atStage, code: reason.code, says: clip(reason.detail, clips.text), guard: GUARD_CODES.has(reason.code), itemId: s.itemId });
      }
    }
    if (stageIndex(s.stage) >= stageIndex("VERIFIED")) passed += 1;
    else if (quality) rejected += 1;
    else needs += 1;
  }
  const items = g.pipeline.length;
  const denominatorSource = "cp_log_promotion_pipeline";
  const listedRejections = bounded(
    [...rejections].sort((a, b) => Number(a.guard) - Number(b.guard)),
    clips.list,
  );
  const pipeline: AssignmentVerification["pipeline"] =
    src.pipeline === null
      ? gap("OURS", "the promotion pipeline could not be read on this publish, so verification is not shown")
      : held({
          unit: "pipeline item" as const,
          items,
          passed: measured(passed, items, "items verified or beyond, of items offered", denominatorSource),
          needsMoreEvidence: measured(needs, items, "items awaiting their next independent check, of items offered", denominatorSource),
          rejected: measured(rejected, items, "items refused on quality, of items offered", denominatorSource),
          furthest,
          rejections: listedRejections.items,
          moreRejections: listedRejections.more,
          guardRefusals,
          itemIds: g.pipeline.slice(0, clips.list).map((s) => s.itemId),
          says:
            items === 0
              ? "Nothing from this assignment has been offered for verification."
              : `${plural(items, "item")} offered for verification: ${passed} passed, ${needs} waiting on more evidence, ${rejected} rejected on quality.`,
        });

  const checks: AssignmentCheck[] = [];
  for (const item of g.workItems) {
    const publication = item.publicationOutcome;
    if (publication) checks.push({ who: "Publication checks", verdict: publication.status === "PUBLISHED" ? "PASS" : "HELD",
      at: publication.at, says: clip(`${publication.code}: ${publication.detail}`, clips.text), resultId: publication.workerResultId });
  }
  for (const r of [...g.workerResults].reverse()) {
    const result = r.result;
    if (result.role === "VALIDATOR") {
      checks.push({
        who: plainCode(result.role),
        verdict: result.verdict,
        at: r.endedAt,
        says: clip(result.findings[0]?.detail ?? `${plural(result.validatedRecordCount, "record")} validated`, clips.text),
        resultId: r.id,
      });
    } else if (result.role === "ADVERSARIAL_AUDITOR") {
      checks.push({
        who: plainCode(result.role),
        verdict: result.verdict,
        at: r.endedAt,
        says: clip(`${r.modelReview?.escalation ? `Escalated ${r.modelReview.escalation.from} → ${r.modelReview.model} at ${r.modelReview.escalation.at}: ${r.modelReview.escalation.reason}. ` : ""}${r.modelReview?.validationError ?? result.findings[0]?.detail ?? `${plural(result.survivingRecordCount, "record")} survived`}`, clips.text),
        resultId: r.id,
      });
    }
  }
  const listedChecks = bounded(checks, clips.list);
  const refused = [...g.scouts].reverse().filter((s) => s.refusal !== null && s.refusal.length > 0);
  const listedRefused = bounded(refused, clips.list);
  return {
    pipeline,
    checks: listedChecks.items,
    moreChecks: listedChecks.more,
    refusedFinishes: listedRefused.items.map((s) => ({
      attemptId: s.attemptId,
      at: s.recordedAt,
      codes: (s.refusal ?? []).map((i) => i.code),
      says: clip((s.refusal ?? [])[0]?.detail, clips.text),
    })),
    refusedFinishCount: refused.length,
  };
}

function deliveryOf(g: Gathered, src: AssignmentSources): AssignmentDelivery {
  const workerPublications = g.workItems.flatMap(item => item.publicationOutcome ? [item.publicationOutcome] : []);
  const items = g.pipeline.length + workerPublications.length;
  const approved = g.pipeline.filter((s) => s.stage === "APPROVED_FOR_PROMOTION").length + workerPublications.filter(p => p.status === "PUBLISHED").length;
  const blockers: string[] = [];
  const approvedHeld: Held<Measured> =
    src.pipeline === null && !workerPublications.length
      ? gap("OURS", "the promotion pipeline could not be read on this publish")
      : items === 0
        ? gap("OURS", "nothing from this assignment has entered the promotion pipeline, so there is nothing to approve yet")
        : held(measured(approved, items, "items with all required publication checks passed, of items offered", "cp_log_promotion_pipeline + WorkItem.publicationOutcome"));
  let promoted: Held<PromotionStatus>;
  const witnesses = [...g.pipeline.flatMap(s => {
    const a = s.byStage.APPROVED_FOR_PROMOTION;
    const w = a ? servedWitness(src.servedReader, s.itemId, a.recordId, src.nowIso) : null;
    return w ? [w] : [];
  }), ...g.workItems.flatMap(item => {
    const publication = item.publicationOutcome;
    if (!publication || publication.status === "HELD") return [];
    const witness = servedWitness(src.servedReader, item.id, publication.workerResultId, src.nowIso);
    return witness?.versionId === (publication.versionId ?? publication.workerResultId) ? [witness] : [];
  })];
  const witness = witnesses[0];
  const workerPublication = g.workItems.flatMap(item => item.publicationOutcome ? [item.publicationOutcome] : [])
    .sort((left, right) => right.at.localeCompare(left.at))[0];
  if (witness) {
    promoted = held({ state: "PROMOTED", says: `${witnesses.length} exact approval(s) observed on the public site.`, versionId: witness.versionId, at: witness.checkedAt });
  } else if (workerPublication) {
    promoted = held({ state: workerPublication.status !== "HELD" ? "PROMOTED" : "NOT_PROMOTED",
      says: `${workerPublication.code}: ${workerPublication.detail}`, versionId: workerPublication.versionId, at: workerPublication.at });
  } else if (src.activation === null) {
    promoted = gap("OURS", "the activation gate was not read on this publish, so whether promotion is on is not shown");
  } else if (!src.activation.promotionEnabled) {
    promoted = held({
      state: "NOT_PROMOTED",
      says: "Not promoted: the activation gate is off.",
      versionId: null,
      at: null,
    });
    blockers.push("The activation gate is off: nothing reaches a reader until it opens.");
  } else {
    promoted = gap("OURS", "The activation gate is open, but no current public readback proves delivery for this assignment.");
  }
  for (const publication of workerPublications) if (publication.status !== "PUBLISHED") blockers.push(`${publication.code}: ${publication.detail}`);
  if (!witness) blockers.push("No current public readback confirms this assignment's exact approvals.");
  if (witnesses.length < approved) blockers.push(`${approved - witnesses.length} approved item(s) still lack a current public readback.`);
  return {
    approved: approvedHeld,
    ...(workerPublication && workerPublication.status !== "HELD" && workerPublication.records ? { records: workerPublication.records,
      recordChanges: workerPublication.recordChanges } : {}),
    promoted,
    publiclyAvailable: witness ? held<PublicAvailability>({ state: "CONFIRMED", at: witness.checkedAt, says: `${witnesses.length} item(s) confirmed; this does not complete outstanding assignment scope.`, proof: witness.url }) : gap<PublicAvailability>(
      "OURS",
      "no served-reader readback exists yet (the witness bridge), so reaching a reader is not observed — our gap, not a measured zero",
    ),
    blockers,
  };
}

/** A scheduled re-reading after a discharged round is routine, not a retry; a round after an unrecorded RouteTask claims no retry. */
function retriesOf(g: Gathered): number {
  let retries = 0;
  for (const r of g.rounds) retries += Math.max(0, r.attempts.length - 1);
  if (g.members.kind !== "STANDING_OBLIGATION") return retries;
  const worked = g.rounds
    .filter((r): r is Round & { readonly occurrence: FreshnessOccurrence } => r.occurrence !== null && r.attempts.length > 0)
    .sort((a, b) => a.occurrence.sequence - b.occurrence.sequence);
  for (let i = 1; i < worked.length; i += 1) {
    const before = worked[i - 1].routeTask;
    if (before === null) continue;
    const d = before.disposition?.disposition ?? null;
    if (d === null || !DISCHARGING_DISPOSITIONS.includes(d)) retries += 1;
  }
  return retries;
}

function costOf(g: Gathered, idx: Index, denominatorUsd: number | null): AssignmentCost {
  let measuredRows = 0;
  let unmeasured = 0;
  let plainCodeRows = 0;
  let noModelCall = 0;
  let usd = 0;
  let requests = 0;
  let bytes = 0;
  let durationMs = 0;
  const costAttempts = new Set<string>();
  for (const e of g.costs) {
    costAttempts.add(e.attemptId);
    const kind = costRowKind(e, idx.attempts.get(e.attemptId));
    if (kind === "MEASURED" || kind === "NO_MODEL_CALL") {
      measuredRows += 1;
      usd += e.cost.usd ?? 0;
      if (kind === "NO_MODEL_CALL") noModelCall += 1;
    } else if (kind === "PLAIN_CODE") plainCodeRows += 1;
    else unmeasured += 1;
    requests += Number.isFinite(e.cost.requestCount ?? 0) ? (e.cost.requestCount ?? 0) : 0;
    bytes += Number.isFinite(e.cost.bytesFetched ?? 0) ? (e.cost.bytesFetched ?? 0) : 0;
    durationMs += Number.isFinite(e.cost.durationMs ?? 0) ? (e.cost.durationMs ?? 0) : 0;
  }
  const withoutRow = g.attempts.filter((a) => !costAttempts.has(a.id));
  const attemptsWithoutCostRow = withoutRow.filter((a) => canReachPaidModel(a.worker?.role ?? "", a)).length;
  const plainAttemptsWithoutCostRow = withoutRow.length - attemptsWithoutCostRow;
  const roundsWorked = g.rounds.filter((r) => r.attempts.length > 0).length;
  const attempts = g.attempts.length;
  const retries = retriesOf(g);
  const toOwner = g.workItems.reduce((n, w) => n + (w.escalations?.length ?? 0), 0);
  const amount = Math.round(usd * 1_000_000) / 1_000_000;

  let dollars: AssignmentDollars;
  if (g.costs.length === 0 && attempts === 0) {
    dollars = { kind: "NOTHING_RAN", says: "Nothing has run on it, so nothing has been spent." };
  } else if (measuredRows > 0) {
    const denominator = denominatorUsd !== null && denominatorUsd >= amount ? denominatorUsd : amount;
    dollars = {
      kind: "MEASURED",
      amount,
      usd: held(
        measured(
          amount,
          denominator,
          "measured dollars across every attempt and retry, of all dollars attributed to assignments",
          "cp_log_costs",
        ),
      ),
    };
  } else if (unmeasured > 0 || attemptsWithoutCostRow > 0) {
    const pieces = [
      unmeasured > 0 ? `${plural(unmeasured, "model attempt")} reported no dollar figure` : null,
      attemptsWithoutCostRow > 0 ? `${plural(attemptsWithoutCostRow, "model attempt")} left no cost row` : null,
    ].filter(Boolean);
    dollars = {
      kind: "UNMEASURED",
      gap: { whose: "OURS", says: `${pieces.join(", and ")} — the cost is unknown, not zero and not free.` },
    };
  } else {
    dollars = {
      kind: "PLAIN_CODE",
      says: `Plain code only: ${plural(plainCodeRows + plainAttemptsWithoutCostRow, "attempt")} ran with no paid model, so there is no model charge to measure. Requests, bytes and time are counted instead where they were recorded.`,
    };
  }
  const parts: string[] = [];
  parts.push(`${plural(attempts, "attempt")} over ${plural(roundsWorked, "round")}${retries > 0 ? ` (${retries} of them retries)` : ""}`);
  if (measuredRows > 0) parts.push(`${measuredRows} reported dollars${noModelCall > 0 ? ` (${noModelCall} made no model request)` : ""}`);
  if (unmeasured > 0) parts.push(`${unmeasured} model attempt(s) reported no dollars — unknown`);
  if (attemptsWithoutCostRow > 0) parts.push(`${attemptsWithoutCostRow} model attempt(s) left no cost row — unknown`);
  if (plainCodeRows > 0) parts.push(`${plainCodeRows} ran as plain code, no model charge`);
  if (plainAttemptsWithoutCostRow > 0) parts.push(`${plainAttemptsWithoutCostRow} plain-code attempt(s) left no cost row, so their requests and time were not recorded`);
  return {
    dollars,
    entries: g.costs.length,
    measured: measuredRows,
    unmeasured,
    plainCode: plainCodeRows,
    noModelCall,
    attemptsWithoutCostRow,
    plainAttemptsWithoutCostRow,
    rounds: roundsWorked,
    attempts,
    retries,
    escalations: {
      toOwner,
      modelRouting: {
        whose: "OURS",
        says: "model-routing escalations are recorded on each Scout result (since Sep 25) but not yet joined to this view, so they are not counted here — not zero",
      },
    },
    nonDollar: { requests, bytes, durationMs },
    says: `${parts.join("; ")}.`,
  };
}

function notesOf(g: Gathered, clips: Clips): { readonly items: readonly AssignmentNote[]; readonly more: number } {
  const notes: AssignmentNote[] = [];
  for (const r of g.rounds) {
    const d = r.routeTask?.disposition ?? null;
    if (d) notes.push({ at: d.at, from: `disposition ${d.disposition} on ${r.routeTaskId}`, text: clip(d.note, clips.text) });
    if (r.occurrence?.unresolvedReason) {
      notes.push({ at: r.occurrence.closedAt, from: `round ${r.occurrence.sequence} closed unresolved`, text: clip(r.occurrence.unresolvedReason, clips.text) });
    }
    if (r.routeTask?.policyDenial) {
      notes.push({ at: r.routeTask.policyDenial.at, from: `policy denial on ${r.routeTaskId}`, text: clip(`${r.routeTask.policyDenial.reason} — required change: ${r.routeTask.policyDenial.requiredChange}`, clips.text) });
    }
  }
  for (const a of g.attempts) {
    if (a.outcome !== null && a.outcome !== "COMPLETED" && a.abortReason) {
      notes.push({ at: a.endedAt, from: `attempt ${a.id} ${a.outcome.toLowerCase()}`, text: clip(a.abortReason, clips.text) });
    }
  }
  if (g.debt && g.debt.consecutiveFailures > 0) {
    notes.push({ at: g.debt.lastFailedAt, from: `freshness debt (${g.debt.consecutiveFailures} consecutive failures)`, text: clip(g.debt.detail, clips.text) });
  }
  for (const w of g.workItems) {
    const last = w.transitions.at(-1);
    if (last && last.from !== null) notes.push({ at: last.at, from: `work item ${w.id} ${last.from} → ${last.to}`, text: clip(last.why, clips.text) });
  }
  notes.sort((a, b) => (ms(b.at) || 0) - (ms(a.at) || 0));
  return bounded(notes, clips.list);
}

function evidenceOf(g: Gathered, clips: Clips): AssignmentEvidence {
  const workItemIds = [...g.members.workItemIds].reverse();
  const routeTaskIds = g.rounds.map((r) => r.routeTaskId).filter((id): id is string => id !== null).reverse();
  const attemptIds = [...g.attempts].reverse().map((a) => a.id);
  const occurrenceIds = [...g.occurrences].reverse().map((o) => o.id);
  const commitIds = [...g.commits].sort((a, b) => ms(b.committedAt) - ms(a.committedAt)).map((c) => c.commitId);
  const notes = notesOf(g, clips);
  const b = <T>(xs: readonly T[]) => bounded(xs, clips.list);
  return {
    obligationId: g.members.obligationId,
    workItemIds: b(workItemIds).items,
    routeTaskIds: b(routeTaskIds).items,
    attemptIds: b(attemptIds).items,
    occurrenceIds: b(occurrenceIds).items,
    dispositionCommitIds: b(commitIds).items,
    otherIds: b(g.pipeline.map((s) => ({ what: "promotion-pipeline item", id: s.itemId }))).items,
    notes: notes.items,
    more: {
      workItems: b(workItemIds).more,
      routeTasks: b(routeTaskIds).more,
      attempts: b(attemptIds).more,
      occurrences: b(occurrenceIds).more,
      dispositionCommits: b(commitIds).more,
      otherIds: b(g.pipeline).more,
      notes: notes.more,
    },
  };
}

const WORK_ITEM_STATE_READING: Partial<Record<WorkItemState, { readonly state: AssignmentState; readonly owner: NextStepOwner; readonly says: string; readonly next: string }>> = {
  BLOCKED: { state: "BLOCKED", owner: "ENGINEERING", says: "The work item is blocked.", next: "Clear the blocker its last result names, then run it again." },
  AWAITING_VALIDATION: { state: "WAITING", owner: "FLEET", says: "The work item is waiting for an independent validator.", next: "The fleet's validator checks the extraction next." },
  AWAITING_AUDIT: { state: "WAITING", owner: "FLEET", says: "The work item is waiting for the adversarial audit.", next: "The fleet's auditor attacks the claim next." },
  AWAITING_OWNER: { state: "BLOCKED", owner: "OWNER", says: "The work item is waiting on you.", next: "Answer the question the work item raised." },
  AUTHOR_DECISION_REQUIRED: { state: "BLOCKED", owner: "OWNER", says: "The work item needs an author decision.", next: "Make the decision the work item names." },
  HUMAN_INTERACTION_REQUIRED: { state: "BLOCKED", owner: "OWNER", says: "Only a person can take the next step.", next: "Arrange the human step the work item names." },
  RECORDS_REQUEST_REQUIRED: { state: "BLOCKED", owner: "OWNER", says: "A public-records request is required to go further.", next: "Decide whether and how the records request is made." },
  OFFLINE_PUBLIC_ACCESS: { state: "BLOCKED", owner: "OWNER", says: "The record is public only offline.", next: "Arrange the offline access the work item names." },
  VERIFIED_COMPLETE: { state: "SUCCEEDED", owner: "NOBODY", says: "The work item is verified complete.", next: "Nothing — it is complete." },
  NOT_YET_PUBLISHED: { state: "SUCCEEDED", owner: "SOURCE", says: "Finished with a recorded finding: the record is not yet published.", next: "It is checked again when the publisher can have published it." },
  RECORD_NOT_YET_CREATED: { state: "SUCCEEDED", owner: "SOURCE", says: "Finished with a recorded finding: the record has not been created yet.", next: "It is checked again when the record can exist." },
  LEGALLY_WITHHELD: { state: "SUCCEEDED", owner: "SOURCE", says: "Finished with a recorded finding: the record is legally withheld.", next: "Nothing automatic; the finding stands with its evidence." },
};

interface Derived {
  readonly state: AssignmentState;
  readonly stateSays: string;
  readonly waiting: AssignmentWaiting;
}

function latestWorkedRound(g: Gathered): Round | null {
  let best: Round | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const r of g.rounds) {
    for (const a of r.attempts) {
      const t = attemptTime(a);
      if (Number.isFinite(t) && t >= bestAt) {
        bestAt = t;
        best = r;
      }
    }
  }
  return best;
}

function backoffOf(debt: FreshnessDebt | null, clipAt: number): AssignmentWaiting["backoff"] {
  if (!debt || debt.consecutiveFailures <= 0) return null;
  return {
    failures: debt.consecutiveFailures,
    since: debt.firstFailedAt,
    retryClass: debt.cause,
    says: clip(debt.detail, clipAt),
  };
}

export function eligibleAtOf(dueAt: string | null, retryAt: string | null): string | null {
  return latestIso([dueAt, retryAt]);
}

function nextStepWords(input: {
  readonly state: AssignmentState;
  readonly outcome: RoundOutcome | null;
  readonly overdue: boolean | null;
  readonly dueAt: string | null;
  readonly retryAt: string | null;
  readonly eligibleAt: string | null;
  readonly backoff: boolean;
  readonly band: 1 | 2 | 3 | null;
}): string {
  const heldBy = input.retryAt !== null && input.retryAt === input.eligibleAt ? "its failure backoff" : "its next-due time";
  const when =
    input.eligibleAt === null
      ? "No next-due time is stored on the obligation; the scheduler owes it one."
      : input.overdue
        ? `Eligible again since ${input.eligibleAt}; the runner dispatches it when its turn comes.`
        : `Not before ${input.eligibleAt} (${heldBy}); then the runner dispatches it on its own.`;
  if (input.state === "FAILED" || input.state === "BLOCKED" || input.state === "UNKNOWN") {
    return `${input.outcome?.nextAction ?? ""} ${input.state === "FAILED" ? when : ""}`.trim();
  }
  if (input.state === "SUCCEEDED") {
    return input.backoff
      ? `The record itself is still owed — this round's result does not discharge the obligation, so it stays on the runner's retry clock. ${when}`
      : input.eligibleAt === null
        ? when
        : input.overdue
          ? `Due again since ${input.eligibleAt}; the runner takes the next reading when its turn comes.`
          : `Next reading due ${input.eligibleAt}.`;
  }
  if (input.state === "WAITING") {
    if (input.overdue === false && input.eligibleAt !== null) return `First reading not before ${input.eligibleAt} (${heldBy}).`;
    return `The runner dispatches it when its turn comes${input.band !== null ? ` (reader-impact band ${input.band}; within a band the longest wait goes first)` : ""}.`;
  }
  return input.outcome?.nextAction ?? "";
}

function askGapStep(d: RouteDisposition | null, clipAt: number): { readonly owner: NextStepOwner; readonly nextAction: string } | null {
  if (d === null) return null;
  const parts = askGapNoteParts(d.note);
  if (d.disposition === "DISCOVERED") {
    return parts.cadenceFailure !== null
      ? {
          owner: "RUNNER",
          nextAction: clip(
            `Named failure, CADENCE_BROKEN as of ${d.at}: ${parts.cadenceFailure} Find why the routine runner is not reading it on cadence; the gap closes when a read holds the record.`,
            clipAt,
          ),
        }
      : {
          owner: "RUNNER",
          nextAction: clip(
            `The routine read closes it${parts.nextRead ? ` — its next read is ${parts.nextRead}` : ""} (as of ${d.at}); nothing is owed by anyone else.`,
            clipAt,
          ),
        };
  }
  if (d.disposition === "REQUIRES_NEW_ADAPTER") {
    return {
      owner: "ENGINEERING",
      nextAction: clip(
        `Build the adapter owed${parts.nextMove ? `: ${parts.nextMove}` : ""}. Until it exists no scheduled read can close this gap; when a routine contract carries it, this becomes the runner's on the next cycle.`,
        clipAt,
      ),
    };
  }
  return null;
}

export function arguedAbsenceWords(ob: Pick<StandingObligation, "absentUntil" | "absenceUnlock"> | null, now: number, clipAt: number): string | null {
  if (ob === null || !ob.absentUntil || !(ms(ob.absentUntil) > now)) return null;
  const recheck = `Recorded as not published; it is looked for again by ${formatEastern(ob.absentUntil)}.`;
  const text = ob.absenceUnlock?.text.trim() ?? "";
  return text === "" ? recheck : `${recheck} Would unlock: ${clip(text.replace(/[.\s]+$/, ""), clipAt)}.`;
}

function deriveStanding(g: Gathered, idx: Index, what: AssignmentWhat, clips: Clips): Derived {
  const ob = g.obligation;
  const now = idx.now;
  const dueAt = ob?.nextDueAt ?? null;
  const active = ob?.active ?? true;
  const backoff = backoffOf(g.debt, clips.text);
  const retryAt = backoff ? (g.debt?.retryAt ?? null) : null;
  const eligibleAt = active ? eligibleAtOf(dueAt, retryAt) : null;
  const overdue = !active ? false : eligibleAt === null ? null : ms(eligibleAt) <= now;
  const open = ob?.openOccurrenceId ? g.occurrences.find((o) => o.id === ob.openOccurrenceId && o.closedAt === null) ?? null : null;
  const openRound = open
    ? {
        id: open.id,
        openedAt: open.openedAt,
        dueAt: open.dueAt,
        reached: (idx.attemptsByRouteTask.get(open.routeTaskId) ?? []).length > 0,
      }
    : null;
  const band = what.why.band?.band ?? null;

  const stepWords = (state: AssignmentState, outcome: RoundOutcome | null): string =>
    nextStepWords({ state, outcome, overdue, dueAt, retryAt, eligibleAt, backoff: backoff !== null, band });

  for (const r of g.rounds) {
    const out = roundOutcome(r, idx, clips.text);
    if (out?.state === "WORKING") {
      return {
        state: "WORKING",
        stateSays: out.says,
        waiting: {
          waiting: false,
          since: out.at,
          overdue,
          dueAt,
          retryAt,
          eligibleAt,
          backoff,
          blocker: { kind: "NONE", says: "Nothing is blocking it: a worker holds it now." },
          owner: out.owner,
          nextAction: out.nextAction,
          openRound,
        },
      };
    }
  }

  const latest = latestWorkedRound(g);
  const outcome = latest ? roundOutcome(latest, idx, clips.text) : null;

  if (ob !== null && !ob.active) {
    return {
      state: "RETIRED",
      stateSays: `Retired${ob.retiredAt ? ` ${ob.retiredAt}` : ""}: ${clip(ob.retirementReason ?? "no reason recorded", clips.text)}${outcome ? ` Its last round: ${outcome.says}` : ""}`,
      waiting: {
        waiting: false,
        since: ob.retiredAt ?? null,
        overdue: false,
        dueAt: null,
        retryAt: null,
        eligibleAt: null,
        backoff,
        blocker: { kind: "NONE", says: "Nothing is owed on a retired clock." },
        owner: "NOBODY",
        nextAction: "None — this clock is retired and its history stays readable.",
        openRound,
      },
    };
  }

  if (outcome === null) {
    const neverDispatched = g.debt?.cause === "NEVER_DISPATCHED" && g.debt.consecutiveFailures > 0;
    const blocker = openRound
      ? `Round ${open?.sequence ?? ""} was opened ${openRound.openedAt} and no worker has reached it yet.`
      : g.occurrences.length > 0
        ? `${plural(g.occurrences.length, "round")} opened and closed without any worker reaching them.`
        : overdue === false
          ? "Nothing yet: its first reading is not due."
          : "No worker has reached it yet: the runner has not dispatched it.";
    return {
      state: "WAITING",
      stateSays: g.occurrences.length === 0 ? "Registered and never reached by a worker." : "Opened and never reached by a worker.",
      waiting: {
        waiting: overdue !== false,
        since: overdue ? eligibleAt : overdue === false ? null : (openRound?.openedAt ?? null),
        overdue,
        dueAt,
        retryAt,
        eligibleAt,
        backoff,
        blocker:
          overdue === false && !openRound
            ? { kind: "NONE", says: blocker }
            : {
                kind: "NAMED",
                says: neverDispatched
                  ? `${blocker} Its due time passed undispatched in ${plural(g.debt?.consecutiveFailures ?? 0, "cycle")} in a row.`
                  : blocker,
              },
        owner: "RUNNER",
        nextAction: stepWords("WAITING", outcome),
        openRound,
      },
    };
  }

  const state: AssignmentState = outcome.state === "WORKING" ? "WORKING" : outcome.state;
  const blocker: AssignmentBlocker =
    state === "SUCCEEDED"
      ? {
          kind: "NONE",
          says: backoff
            ? "Nothing is blocking it; the record itself is still owed."
            : overdue
              ? "Nothing is blocking it; the next reading is simply overdue."
              : "Nothing is blocking it.",
        }
      : state === "UNKNOWN"
        ? { kind: "UNKNOWN", gap: { whose: "UNKNOWABLE_NOW", says: outcome.says } }
        : { kind: "NAMED", says: outcome.says };
  const since =
    state === "FAILED"
      ? (backoff?.since ?? outcome.at)
      : state === "SUCCEEDED"
        ? (backoff?.since ?? (overdue ? eligibleAt : null))
        : outcome.at;
  const askGap = ob !== null && parseAskGapObligationId(ob.id) !== null ? askGapStep(latest?.routeTask?.disposition ?? null, clips.text) : null;
  const argued = arguedAbsenceWords(ob, now, clips.text);
  return {
    state,
    stateSays: outcome.says,
    waiting: {
      waiting: state !== "SUCCEEDED" || overdue === true || backoff !== null,
      since,
      overdue,
      dueAt,
      retryAt,
      eligibleAt,
      backoff,
      blocker,
      owner: askGap?.owner ?? (state === "SUCCEEDED" ? "RUNNER" : outcome.owner),
      nextAction: askGap?.nextAction ?? argued ?? stepWords(state, outcome),
      openRound,
    },
  };
}

function deriveWorkItem(g: Gathered, idx: Index, clips: Clips): Derived {
  for (const r of g.rounds) {
    const out = roundOutcome(r, idx, clips.text);
    if (out?.state === "WORKING") {
      return {
        state: "WORKING",
        stateSays: out.says,
        waiting: { waiting: false, since: out.at, overdue: null, dueAt: null, retryAt: null, eligibleAt: null, backoff: null, blocker: { kind: "NONE", says: "Nothing is blocking it: a worker holds it now." }, owner: "FLEET", nextAction: out.nextAction, openRound: null },
      };
    }
  }
  const item = g.workItems[0] ?? null;
  const latest = latestWorkedRound(g);
  const outcome = latest ? roundOutcome(latest, idx, clips.text) : null;
  const transitionAt = item?.transitions.at(-1)?.at ?? item?.createdAt ?? null;
  const reading = item ? WORK_ITEM_STATE_READING[item.state] : undefined;
  if (item && reading) {
    const why = reading.state === "BLOCKED" && outcome ? `${reading.says} ${outcome.says}` : reading.says;
    return {
      state: reading.state,
      stateSays: why,
      waiting: {
        waiting: reading.state !== "SUCCEEDED",
        since: transitionAt,
        overdue: null,
        dueAt: null,
        retryAt: null,
        eligibleAt: null,
        backoff: null,
        blocker:
          reading.state === "SUCCEEDED"
            ? { kind: "NONE", says: "Nothing is blocking it." }
            : { kind: "NAMED", says: clip(why, clips.text) },
        owner: reading.owner,
        nextAction: reading.state === "BLOCKED" && outcome?.nextAction ? outcome.nextAction : reading.next,
        openRound: null,
      },
    };
  }
  const pending = g.rounds.find((r) => r.attempts.length === 0 && r.routeTask !== null && (r.routeTask.state === "PENDING" || r.routeTask.state === "RECLAIMABLE"));
  if (outcome === null) {
    return {
      state: "WAITING",
      stateSays: item === null ? "Execution records name this work item and no worker outcome is recorded." : "Created and never reached by a worker.",
      waiting: {
        waiting: true,
        since: item?.createdAt ?? null,
        overdue: null,
        dueAt: null,
        retryAt: null,
        eligibleAt: null,
        backoff: null,
        blocker: { kind: "NAMED", says: pending ? `Step ${pending.routeTaskId} is queued and no worker has taken it.` : "No step of this work has been taken by a worker." },
        owner: "FLEET",
        nextAction: "The fleet's next worker takes the queued step.",
        openRound: null,
      },
    };
  }
  if (outcome.state === "SUCCEEDED" && pending) {
    return {
      state: "WAITING",
      stateSays: `The last step finished (${outcome.says}) and the next step is queued.`,
      waiting: {
        waiting: true,
        since: outcome.at,
        overdue: null,
        dueAt: null,
        retryAt: null,
        eligibleAt: null,
        backoff: null,
        blocker: { kind: "NAMED", says: `Step ${pending.routeTaskId} is queued and no worker has taken it yet.` },
        owner: "FLEET",
        nextAction: "The fleet's next worker takes the queued step.",
        openRound: null,
      },
    };
  }
  const state: AssignmentState = outcome.state === "WORKING" ? "WORKING" : outcome.state;
  return {
    state,
    stateSays: outcome.says,
    waiting: {
      waiting: state !== "SUCCEEDED",
      since: state === "SUCCEEDED" ? null : outcome.at,
      overdue: null,
      dueAt: null,
      retryAt: null,
      eligibleAt: null,
      backoff: null,
      blocker:
        state === "SUCCEEDED"
          ? { kind: "NONE", says: "Nothing is blocking it." }
          : state === "UNKNOWN"
            ? { kind: "UNKNOWN", gap: { whose: "UNKNOWABLE_NOW", says: outcome.says } }
            : { kind: "NAMED", says: outcome.says },
      owner: outcome.owner,
      nextAction: outcome.nextAction || (state === "SUCCEEDED" ? "Nothing further is queued for this work item." : "The fleet decides the next step."),
      openRound: null,
    },
  };
}

function lastActivityOf(g: Gathered): string | null {
  return latestIso([
    ...g.attempts.map((a) => a.endedAt ?? a.startedAt),
    ...g.scouts.map((s) => s.recordedAt),
    ...g.artifacts.map((a) => a.recordedAt),
    ...g.workerResults.map((r) => r.endedAt),
    ...g.occurrences.map((o) => o.closedAt ?? o.openedAt),
  ]);
}

function attributedUsd(all: readonly Gathered[], idx: Index): number | null {
  let total = 0;
  let any = false;
  for (const g of all) {
    for (const e of g.costs) {
      const kind = costRowKind(e, idx.attempts.get(e.attemptId));
      if (kind === "MEASURED" || kind === "NO_MODEL_CALL") {
        total += e.cost.usd ?? 0;
        any = true;
      }
    }
  }
  return any ? Math.round(total * 1_000_000) / 1_000_000 : null;
}

function buildRow(g: Gathered, idx: Index, src: AssignmentSources, clips: Clips, denominatorUsd: number | null): AssignmentRow {
  const what = g.members.kind === "STANDING_OBLIGATION" ? whatOfStanding(g, idx, src, clips) : whatOfWorkItem(g, clips);
  const baseDerived = g.members.kind === "STANDING_OBLIGATION" ? deriveStanding(g, idx, what, clips) : deriveWorkItem(g, idx, clips);
  const publication = g.workItems.flatMap(item => item.publicationOutcome ? [item.publicationOutcome] : [])
    .sort((left, right) => right.at.localeCompare(left.at))[0];
  const derived: Derived = publication && publication.status !== "PUBLISHED" && baseDerived.state !== "WORKING"
    ? { state: "WAITING", stateSays: `${publication.code}: ${publication.detail}`,
      waiting: { ...baseDerived.waiting, waiting: true, since: publication.at, owner: "FLEET",
        blocker: { kind: "NAMED", says: publication.code },
        nextAction: publication.recovery === "PUBLISHER" ? "The existing publisher retries with retained verified evidence; no new research or owner approval is needed."
          : "The worker receives the exact failed check and continues verification or source repair automatically." } }
    : baseDerived;
  return {
    id: g.members.id,
    kind: g.members.kind,
    lane: laneOf(g),
    state: derived.state,
    stateSays: clip(derived.stateSays, clips.text),
    lastActivityAt: lastActivityOf(g),
    what,
    discovery: discoveryOf(g, clips),
    parsing: parsingOf(g, clips),
    verification: verificationOf(g, src, clips),
    delivery: deliveryOf(g, src),
    cost: costOf(g, idx, denominatorUsd),
    waiting: derived.waiting,
    evidence: evidenceOf(g, clips),
  };
}

interface Built {
  readonly idx: Index;
  readonly memberships: Map<string, Members>;
  readonly rows: AssignmentRow[];
}

function buildAll(src: AssignmentSources, options: AssignmentBuildOptions): Built {
  const idx = indexSources(src);
  const clips: Clips = { text: options.textClip ?? DRILLDOWN_TEXT_CLIP, list: options.listClip ?? DRILLDOWN_LIST_CLIP };
  const memberships = members(idx);
  const gathered = [...memberships.values()].map((m) => gather(m, idx));
  const denominatorUsd = options.costDenominatorUsd !== undefined ? options.costDenominatorUsd : attributedUsd(gathered, idx);
  const rows = gathered.map((g) => buildRow(g, idx, src, clips, denominatorUsd)).sort((a, b) => a.id.localeCompare(b.id));
  return { idx, memberships, rows };
}

export function buildAssignments(src: AssignmentSources, options: AssignmentBuildOptions = {}): AssignmentRow[] {
  return buildAll(src, options).rows;
}

export interface AssignmentGroup {
  readonly state: AssignmentState;
  readonly lane: AssignmentLane;
  readonly total: number;
  readonly published: number;
}

export interface AssignmentCostSummary {
  readonly ledgerRows: number;
  readonly ledgerMeasuredUsd: number | null;
  readonly attributed: Held<Measured>;
  readonly shared: { readonly rows: number; readonly usd: Held<Measured>; readonly says: string };
  readonly unattributed: { readonly rows: number; readonly usd: Held<Measured>; readonly says: string };
  readonly unmeasuredModelRows: Held<Measured>;
  readonly plainCodeRows: number;
}

export interface AssignmentSummary {
  readonly total: number;
  readonly byState: readonly { readonly state: AssignmentState; readonly count: Measured }[];
  readonly byLane: readonly { readonly lane: AssignmentLane; readonly count: Measured }[];
  readonly groups: readonly AssignmentGroup[];
  readonly overdue: Held<Measured>;
  readonly inBackoff: Held<Measured>;
  readonly costs: AssignmentCostSummary;
  readonly pipeline: Held<{ readonly linked: Measured; readonly unlinked: number }>;
  readonly askGaps?: Held<{
    readonly open: number;
    readonly byCode: readonly { readonly code: AskGapCode; readonly count: Measured }[];
    readonly told?: {
      readonly gaps: Measured;
      readonly mostTold: readonly { readonly bodyId: string; readonly code: AskGapCode; readonly asks: Measured; readonly lastDay: string }[];
    };
  }>;
}

export const MOST_TOLD_ASK_GAPS = 5;

export interface AssignmentView {
  readonly version: typeof ASSIGNMENT_VIEW_VERSION;
  readonly builtAt: string;
  readonly summary: AssignmentSummary;
  readonly rows: readonly AssignmentListRow[];
  readonly allRowsIndex?: readonly AssignmentIndexRow[];
  readonly bodyAttempts?: readonly BodyPublicationAttempt[];
  readonly geographicCounts?: Readonly<Record<string, Readonly<Record<AssignmentState, number>>>>;
  readonly instructionCounts?: Readonly<Record<string, Readonly<Record<AssignmentState, number>>>>;
  /** Current work status by immutable key+receipt. A new same-key hunt never
   * inherits an old completed row as its own completed work. */
  readonly instructionCountsByReceipt?: Readonly<Record<string, Readonly<Record<AssignmentState, number>>>>;
  readonly selection: {
    readonly rule: string;
    readonly perGroup: number;
    readonly byteBudget: number;
    readonly published: number;
    readonly omitted: number;
    readonly trimmedForBytes: number;
  };
  readonly reads: readonly { readonly what: string; readonly held: boolean; readonly says: string }[];
  readonly activation: ActivationGateReading | null;
}

export interface AssignmentIndexRow {
  readonly id: string;
  readonly kind: AssignmentKind;
  readonly lane: AssignmentLane;
  readonly state: AssignmentState;
  readonly label: string;
  readonly subjectName: string | null;
  readonly stateCode: string | null;
  readonly assignmentKeys: readonly string[];
  readonly assignmentRefs?: readonly { readonly key: string; readonly ref: string; readonly at: string }[];
  /** Receipt-specific state; an unproven carried row is UNKNOWN. */
  readonly instructionStates?: Readonly<Record<string, AssignmentState>>;
  readonly historyTerms?: readonly string[];
  readonly lastActivityAt: string | null;
  readonly lastAttemptAt?: string | null;
  readonly directDependentCount?: number | null;
  readonly readyAfterThisSettlesCount?: number | null;
  readonly band: 1 | 2 | 3 | null;
  readonly overdue: boolean | null;
  readonly waitingSince: string | null;
  readonly eligibleAt: string | null;
  readonly blocker: string | null;
  readonly owner: AssignmentListRow["waiting"]["owner"];
  readonly nextAction: string;
}

export interface BodyPublicationAttempt {
  readonly bodyId: string;
  readonly family: AttemptFamily | null;
  readonly workItemId: string;
  readonly assignmentKeys: readonly string[];
  readonly assignmentRefs?: readonly { readonly key: string; readonly ref: string }[];
  readonly at: string;
  readonly status: "PUBLISHED" | "PARTIALLY_PUBLISHED" | "HELD";
  readonly code: string;
  readonly sourceUrl: string | null;
  readonly workerResultId: string;
  readonly acceptedCount: number | null;
  readonly versionId: string | null;
  readonly recordChanges?: NonNullable<WorkItem["publicationOutcome"]>["recordChanges"];
}

export function bodyPublicationAttempts(workItems: readonly WorkItem[],
  occurrences: readonly FreshnessOccurrence[] = [], obligations: readonly StandingObligation[] = []): BodyPublicationAttempt[] {
  const obligationById = new Map(obligations.map(row => [row.id, row] as const));
  const workById = new Map(workItems.map(item => [item.id,item] as const));
  const assignmentMarksByWorkItem = new Map<string, readonly ObligationAssignment[]>();
  for (const round of occurrences) {
    const owner = obligationById.get(round.obligationId);
    if (!owner) continue;
    assignmentMarksByWorkItem.set(round.workItemId, owner.assignments ?? []);
  }
  const marksFor = (item: WorkItem): readonly ObligationAssignment[] => {
    let current = item;
    const seen = new Set<string>();
    while (!assignmentMarksByWorkItem.has(current.id) && !seen.has(current.id)) {
      const link=(current as WorkItem & {readonly planRepair?:{readonly parentWorkItemId:string;readonly authority:string}}).planRepair;
      if (!link) break;
      seen.add(current.id);
      const parent = workById.get(link.parentWorkItemId);
      if (!parent || link.authority !== "WORK_INSTRUCTIONS_ONLY" ||
        parent.project !== item.project || parent.subject !== item.subject) return [];
      current = parent;
    }
    return assignmentMarksByWorkItem.get(current.id) ?? [];
  };
  return workItems.flatMap(item => {
    const outcome = item.publicationOutcome;
    const bodyId = item.autonomousPlan?.publication?.bodyId;
    if (!outcome || !bodyId) return [];
    const marks=marksFor(item);
    const effective = new Map<string,ObligationAssignment>();
    for (const mark of marks) {
      const acknowledged=item.autonomousPlan?.ownerInstructions?.includes(mark.ref) === true ||
        (item.autonomousPlan?.ownerInstructions === undefined && !marks.some(other=>other.assignmentKey===mark.assignmentKey&&other.ref!==mark.ref));
      if (!Number.isFinite(Date.parse(mark.at)) || Date.parse(mark.at) > Date.parse(outcome.at) ||
        !acknowledged) continue;
      const old = effective.get(mark.assignmentKey);
      if (!old || mark.at > old.at || (mark.at === old.at && mark.ref > old.ref)) effective.set(mark.assignmentKey,mark);
    }
    const assignmentRefs=[...effective.values()].map(mark=>({key:mark.assignmentKey,ref:mark.ref}));
    return [{ bodyId, family: attemptFamilyOf(item.autonomousPlan?.publication?.contractId), workItemId: item.id, assignmentKeys: assignmentRefs.map(mark=>mark.key), assignmentRefs,
      at: outcome.at, status: outcome.status,
      code: outcome.code, sourceUrl: item.autonomousPlan?.contract.schemaVersion === 2
        ? item.autonomousPlan.contract.sourceScope.canonicalUrls[0] ?? null : null,
      workerResultId: outcome.workerResultId, acceptedCount: outcome.acceptedMembers?.length ?? outcome.acceptedRecordIds?.length ?? outcome.bodyIds?.length ?? null,
      versionId: outcome.versionId, ...(outcome.status !== "HELD" && outcome.recordChanges ? { recordChanges: outcome.recordChanges } : {}) }];
  }).sort((a, b) => b.at.localeCompare(a.at) || a.workItemId.localeCompare(b.workItemId));
}

export type AssignmentPublication =
  | { readonly kind: "BUILT"; readonly view: AssignmentView }
  | { readonly kind: "NOT_BUILT"; readonly at: string; readonly says: string };

export const ASSIGNMENT_SELECTION_RULE =
  `For each state and lane, the published list carries up to ${ASSIGNMENT_ROWS_PER_GROUP} assignments ` +
  `(test and proof runs: up to ${ASSIGNMENT_PROOF_ROWS_PER_GROUP}): ` +
  "working and waiting — reader-impact band first, then the longest overdue; blocked and failed — the longest-waiting first; " +
  "succeeded and retired — the most recent first; cannot tell — the oldest first. Rows are admitted one rank at a time " +
  "across every group until the size budget is reached, so no state is crowded out. " +
  "Every other assignment is counted in the totals and opens by its id.";

function groupOrder(state: AssignmentState, now: number): (a: AssignmentRow, b: AssignmentRow) => number {
  const since = (r: AssignmentRow): number => {
    const t = ms(r.waiting.since);
    return Number.isFinite(t) ? t : now;
  };
  const recent = (r: AssignmentRow): number => {
    const t = ms(r.lastActivityAt);
    return Number.isFinite(t) ? t : 0;
  };
  const band = (r: AssignmentRow): number => r.what.why.band?.band ?? 4;
  switch (state) {
    case "WORKING":
    case "WAITING":
      return (a, b) => band(a) - band(b) || since(a) - since(b) || a.id.localeCompare(b.id);
    case "BLOCKED":
    case "FAILED":
    case "UNKNOWN":
      return (a, b) => since(a) - since(b) || a.id.localeCompare(b.id);
    case "SUCCEEDED":
    case "RETIRED":
      return (a, b) => recent(b) - recent(a) || a.id.localeCompare(b.id);
  }
}

function summarize(built: Built, src: AssignmentSources, published: ReadonlyMap<string, number>): AssignmentSummary {
  const { rows, idx } = built;
  const total = rows.length;
  const source = "every standing obligation, work item and orphaned execution record the control plane holds, joined at publish";
  const byState = ASSIGNMENT_STATES.map((state) => ({
    state,
    count: measured(rows.filter((r) => r.state === state).length, total, `assignments whose state is ${STATE_WORDS[state].label.toLowerCase()}, of every assignment`, source),
  }));
  const byLane = ASSIGNMENT_LANES.map((lane) => ({
    lane,
    count: measured(rows.filter((r) => r.lane === lane).length, total, `assignments in the ${LANE_WORDS[lane].label.toLowerCase()} lane, of every assignment`, source),
  }));
  const groups: AssignmentGroup[] = [];
  for (const state of ASSIGNMENT_STATES) {
    for (const lane of ASSIGNMENT_LANES) {
      const n = rows.filter((r) => r.state === state && r.lane === lane).length;
      if (n === 0) continue;
      groups.push({ state, lane, total: n, published: published.get(`${state}|${lane}`) ?? 0 });
    }
  }

  const active = src.obligations.filter((o) => o.active);
  const liveRetry = (id: string): string | null => {
    const debt = idx.debts.get(id);
    return debt && debt.consecutiveFailures > 0 ? debt.retryAt : null;
  };
  const eligible = active.map((o) => eligibleAtOf(o.nextDueAt ?? null, liveRetry(o.id))).filter((e): e is string => e !== null);
  const overdueCount = eligible.filter((e) => ms(e) <= idx.now).length;
  const overdue: Held<Measured> =
    eligible.length === 0
      ? gap("OURS", "no active standing obligation carries a stored next-due, so overdue cannot be counted")
      : held(
          measured(
            overdueCount,
            eligible.length,
            "active standing obligations eligible for dispatch now — due, and past any failure backoff — and not yet dispatched, of every active standing obligation with a stored next-due",
            "cp_obligations (nextDueAt) joined to cp_debts (retryAt)",
          ),
        );
  const backoffCount = active.filter((o) => (idx.debts.get(o.id)?.consecutiveFailures ?? 0) > 0).length;
  const inBackoff: Held<Measured> =
    active.length === 0
      ? gap("OURS", "no active standing obligation is on record")
      : held(measured(backoffCount, active.length, "active standing obligations carrying a live freshness debt (failed and waiting on a backoff retry), of every active standing obligation", "cp_obligations joined to cp_debts"));

  const assigned = new Set<string>();
  for (const m of built.memberships.values()) for (const wi of m.workItemIds) assigned.add(wi);
  let ledgerUsd = 0;
  let ledgerMeasured = 0;
  let attributed = 0;
  let sharedRows = 0;
  let sharedUsd = 0;
  let unattributedRows = 0;
  let unattributedUsd = 0;
  let modelRows = 0;
  let unmeasuredModel = 0;
  let plainCodeRows = 0;
  for (const e of src.costs) {
    const kind = costRowKind(e, idx.attempts.get(e.attemptId));
    const usd = kind === "MEASURED" || kind === "NO_MODEL_CALL" ? (e.cost.usd ?? 0) : 0;
    if (kind === "MEASURED" || kind === "NO_MODEL_CALL") {
      ledgerMeasured += 1;
      ledgerUsd += usd;
    }
    if (kind === "PLAIN_CODE") plainCodeRows += 1;
    else modelRows += 1;
    if (kind === "UNMEASURED") unmeasuredModel += 1;
    if (isSharedCost(e)) {
      sharedRows += 1;
      sharedUsd += usd;
    } else if (assigned.has(e.workItemId)) {
      attributed += usd;
    } else {
      unattributedRows += 1;
      unattributedUsd += usd;
    }
  }
  const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;
  const ledgerTotal = ledgerMeasured === 0 ? null : round6(ledgerUsd);
  const ledgerSource = "cp_log_costs (every row, read at publish)";
  const ofLedger = (value: number, contract: string): Held<Measured> =>
    ledgerTotal === null
      ? gap("OURS", "no ledger row reported a dollar figure, so there is no measured total to state this against")
      : held(measured(Math.min(round6(value), ledgerTotal), ledgerTotal, contract, ledgerSource));
  const costs: AssignmentCostSummary = {
    ledgerRows: src.costs.length,
    ledgerMeasuredUsd: ledgerTotal,
    attributed: ofLedger(attributed, "measured dollars joined to an assignment through its work items, of every measured dollar in the ledger"),
    shared: {
      rows: sharedRows,
      usd: ofLedger(sharedUsd, "measured dollars spent on shared work (the Scout prompt-cache pre-warm), of every measured dollar in the ledger"),
      says:
        sharedRows === 0
          ? "No shared cost row is in the ledger."
          : `${plural(sharedRows, "row")} of shared cost — the Scout prompt-cache pre-warm, which readies the cache for every hunter in a cycle and belongs to no single assignment. It is not split across assignments by guesswork, and the model it ran is not recorded on these rows.`,
    },
    unattributed: {
      rows: unattributedRows,
      usd: ofLedger(unattributedUsd, "measured dollars on ledger rows whose work item joins no assignment, of every measured dollar in the ledger"),
      says:
        unattributedRows === 0
          ? "Every other ledger row joined an assignment."
          : `${plural(unattributedRows, "ledger row")} name a work item no assignment holds — spend we can see and cannot attribute.`,
    },
    unmeasuredModelRows:
      modelRows === 0
        ? gap("OURS", "no ledger row came from work that can reach a paid model")
        : held(measured(unmeasuredModel, modelRows, "ledger rows from work that can reach a paid model and reported no dollar figure (unknown, never zero), of every such row", ledgerSource)),
    plainCodeRows,
  };

  const pipelineHeld: AssignmentSummary["pipeline"] =
    src.pipeline === null
      ? gap("OURS", "the promotion pipeline could not be read on this publish")
      : (() => {
          const linkedCount = src.pipeline.filter((s) => {
            const scouted = s.byStage.SCOUTED;
            if (!scouted) return false;
            const source = scouted.source;
            return source.kind === "FLEET_EXTRACTION" ? idx.workItems.has(source.workItemId) || assigned.has(source.workItemId) : source.kind !== "PROMOTED_CANDIDACY" && idx.attempts.has(source.attemptId);
          }).length;
          return held({
            linked: measured(linkedCount, src.pipeline.length, "promotion-pipeline items whose source names an attempt or work item an assignment holds, of every pipeline item", "cp_log_promotion_pipeline"),
            unlinked: src.pipeline.length - linkedCount,
          });
        })();

  const askGapRows = src.obligations.flatMap((o) => {
    const parsed = parseAskGapObligationId(o.id);
    return parsed === null ? [] : [{ bodyId: parsed.bodyId, code: parsed.code, active: o.active }];
  });
  const openAskGaps = askGapRows.filter((row) => row.active);
  const told = (() => {
    const asked = built.idx.askedGaps;
    if (asked === null) return undefined;
    const openTold = openAskGaps.flatMap((row) => asked.get(askedGapKey(row.bodyId, row.code)) ?? []);
    const allAsks = openTold.reduce((n, t) => n + t.asks, 0);
    const source = `cp_ask_gap_observations (the last ${ASK_GAP_OBSERVATION_WINDOW_DAYS} days) joined to cp_obligations (active freshness:ask-gap: rows)`;
    return {
      gaps: measured(openTold.length, openAskGaps.length, `open Ask gaps a reader was told in the last ${ASK_GAP_OBSERVATION_WINDOW_DAYS} days, of every open Ask gap`, source),
      mostTold: [...openTold]
        .sort((a, b) => b.asks - a.asks || (a.lastDay < b.lastDay ? 1 : a.lastDay > b.lastDay ? -1 : 0) || askedGapKey(a.bodyId, a.code).localeCompare(askedGapKey(b.bodyId, b.code)))
        .slice(0, MOST_TOLD_ASK_GAPS)
        .map((t) => ({
          bodyId: t.bodyId,
          code: t.code,
          asks: measured(t.asks, allAsks, "answers that told a reader this body's gap, of every answer that told a reader an open Ask gap, in the window", source),
          lastDay: t.lastDay,
        })),
    };
  })();
  const askGaps: AssignmentSummary["askGaps"] =
    askGapRows.length === 0
      ? gap("OURS", "no Ask-gap obligation is on record: the ask-gaps provider has registered none yet, so open Ask gaps are not counted — never read as zero")
      : held({
          open: openAskGaps.length,
          byCode: ASK_GAP_CODES.map((code) => ({
            code,
            count: measured(
              openAskGaps.filter((row) => row.code === code).length,
              openAskGaps.length,
              `open Ask gaps coded ${code}, of every open Ask gap`,
              "cp_obligations (active freshness:ask-gap: rows)",
            ),
          })),
          ...(told !== undefined ? { told } : {}),
        });

  return { total, byState, byLane, groups, overdue, inBackoff, costs, pipeline: pipelineHeld, askGaps };
}

export function buildAssignmentView(
  src: AssignmentSources,
  options: { readonly perGroup?: number; readonly byteBudget?: number; readonly reads?: AssignmentView["reads"] } = {},
): AssignmentView {
  const perGroup = options.perGroup ?? ASSIGNMENT_ROWS_PER_GROUP;
  const byteBudget = options.byteBudget ?? ASSIGNMENT_VIEW_BYTE_BUDGET;
  const built = buildAll(src, { textClip: ASSIGNMENT_TEXT_CLIP, listClip: ASSIGNMENT_LIST_CLIP });
  const rows = built.rows;
  const manualGapByItem = new Map(src.workItems.flatMap(item => item.manualSourceGap?.assignmentKey
    ? [[item.id, item.manualSourceGap] as const] : []));
  const historyTerms = assignmentHistoryTerms(src,built.memberships);
  const dependentsByUpstream = new Map<string,Set<string>>();
  const workById = new Map(src.workItems.map(item=>[item.id,item] as const));
  for (const item of src.workItems) for (const dependency of item.dependencies) {
    const dependents = dependentsByUpstream.get(dependency.upstreamId) ?? new Set<string>();
    dependents.add(item.id); dependentsByUpstream.set(dependency.upstreamId,dependents);
  }
  const allRowsIndex: AssignmentIndexRow[] = rows.map(row => {
    const listed = listRowOf(row, 160);
    const manualGap = manualGapByItem.get(row.id);
    const membership = built.memberships.get(row.id);
    const workIds = membership?.workItemIds ?? new Set<string>();
    const graphReadable = membership !== undefined && [...workIds].every(id=>workById.has(id));
    const relatedAttempts = [...workIds].flatMap(id=>built.idx.attemptsByWorkItem.get(id)??[]);
    const directDependents = graphReadable ? new Set([...workIds].flatMap(id=>[...(dependentsByUpstream.get(id)??[])])) : null;
    for (const id of workIds) directDependents?.delete(id);
    const dependentGraphReadable = directDependents !== null && [...directDependents].every(id=>{
      const dependent=workById.get(id);
      return dependent !== undefined && dependent.dependencies.every(edge=>workById.has(edge.upstreamId));
    });
    const readyAfterThisSettlesCount = !dependentGraphReadable || directDependents === null ? null : [...directDependents].reduce((count,id)=>{
      const dependent = workById.get(id);
      if (!dependent || isTerminalState(dependent.state)) return count;
      const outstanding = dependent.dependencies.filter(edge=>workById.get(edge.upstreamId)?.state !== "VERIFIED_COMPLETE");
      return outstanding.length === 1 && workIds.has(outstanding[0]!.upstreamId) ? count+1 : count;
    },0);
    const assignmentRefs = [...(row.what.assignments??[]).map(mark=>({key:mark.assignmentKey,ref:mark.ref,at:mark.at})),
      ...(manualGap?.assignmentKey ? [{key:manualGap.assignmentKey,ref:manualGap.instructionReceipt,at:src.workItems.find(item=>item.id===row.id)?.createdAt??src.nowIso}] : [])];
    const instructionStates: Record<string,AssignmentState> = {};
    for (const mark of assignmentRefs) {
      const sameKey=assignmentRefs.filter(other=>other.key===mark.key);
      instructionStates[instructionReceiptKey(mark.key,mark.ref)] = sameKey.some(other=>other.ref!==mark.ref)
        ? "UNKNOWN" : listed.state;
    }
    return { id: listed.id, kind: listed.kind, lane: listed.lane, state: listed.state,
      label: listed.title, subjectName: listed.subjectName, stateCode: listed.stateCode ?? null,
      assignmentKeys: [...new Set([...(listed.assignmentKeys ?? []), ...(manualGap?.assignmentKey ? [manualGap.assignmentKey] : [])])],
      assignmentRefs,instructionStates,
      historyTerms:historyTerms.get(row.id)??[],lastActivityAt: listed.lastActivityAt,
      lastAttemptAt:relatedAttempts.map(attempt=>attempt.startedAt).sort().at(-1)??null,
      directDependentCount:directDependents?.size??null,readyAfterThisSettlesCount,
      band: listed.band, overdue: listed.waiting.overdue, waitingSince: listed.waiting.since,
      eligibleAt: listed.waiting.eligibleAt, blocker: listed.waiting.blocker,
      owner: listed.waiting.owner, nextAction: listed.waiting.nextAction };
  });
  const indexedKeys = new Map(allRowsIndex.map(row => [row.id, row.assignmentKeys] as const));
  const bodyAttempts = bodyPublicationAttempts(src.workItems, src.occurrences, src.obligations);

  const geographicCounts: Record<string, Record<AssignmentState, number>> = {};
  const instructionCounts: Record<string, Record<AssignmentState, number>> = {};
  const instructionCountsByReceipt: Record<string, Record<AssignmentState, number>> = {};
  for (const row of rows) {
    const state = assignmentStateCode(row) ?? "";
    const counts = geographicCounts[state] ??= Object.fromEntries(ASSIGNMENT_STATES.map(s => [s, 0])) as Record<AssignmentState, number>;
    counts[row.state] += 1;
    for (const key of indexedKeys.get(row.id) ?? []) {
      const attributed = instructionCounts[key] ??= Object.fromEntries(ASSIGNMENT_STATES.map(s => [s, 0])) as Record<AssignmentState, number>;
      attributed[row.state] += 1;
    }
  }
  for (const row of allRowsIndex) for (const [identity,state] of Object.entries(row.instructionStates ?? {})) {
    const attributed = instructionCountsByReceipt[identity] ??= Object.fromEntries(ASSIGNMENT_STATES.map(s=>[s,0])) as Record<AssignmentState,number>;
    attributed[state] += 1;
  }

  const groups: AssignmentListRow[][] = [];
  for (const state of ASSIGNMENT_STATES) {
    const order = groupOrder(state, built.idx.now);
    for (const lane of ASSIGNMENT_LANES) {
      const cap = lane === "PROOF" ? Math.min(perGroup, ASSIGNMENT_PROOF_ROWS_PER_GROUP) : perGroup;
      const group = rows.filter((r) => r.state === state && r.lane === lane).sort(order).slice(0, cap);
      if (group.length > 0) groups.push(group.map((r) => listRowOf(r)));
    }
  }
    /* Rows are admitted one rank at a time across every group, so an early-spent budget never leaves a whole state unlisted. */
  const kept: AssignmentListRow[] = [];
  let bytes = 0;
  let trimmed = 0;
  for (let rank = 0; rank < perGroup; rank += 1) {
    for (const group of groups) {
      const row = group[rank];
      if (row === undefined) continue;
      const size = JSON.stringify(row).length;
      if (bytes + size > byteBudget) {
        trimmed += 1;
        continue;
      }
      bytes += size;
      kept.push(row);
    }
  }
  kept.sort((a, b) => ASSIGNMENT_STATES.indexOf(a.state) - ASSIGNMENT_STATES.indexOf(b.state) || ASSIGNMENT_LANES.indexOf(a.lane) - ASSIGNMENT_LANES.indexOf(b.lane));
  const published = new Map<string, number>();
  for (const r of kept) published.set(`${r.state}|${r.lane}`, (published.get(`${r.state}|${r.lane}`) ?? 0) + 1);

  return {
    version: ASSIGNMENT_VIEW_VERSION,
    builtAt: src.nowIso,
    summary: summarize(built, src, published),
    rows: kept,
    allRowsIndex,
    bodyAttempts,
    geographicCounts,
    instructionCounts,
    instructionCountsByReceipt,
    selection: {
      rule: ASSIGNMENT_SELECTION_RULE,
      perGroup,
      byteBudget,
      published: kept.length,
      omitted: rows.length - kept.length,
      trimmedForBytes: trimmed,
    },
    reads: options.reads ?? [],
    activation: src.activation,
  };
}

function pushHeld(out: RenderedNumber[], label: string, h: Held<Measured>): void {
  if (h.held) out.push({ label, value: h.value.value, denominator: h.value.denominator, contract: h.value.contract });
}

function pushMeasured(out: RenderedNumber[], label: string, m: Measured): void {
  out.push({ label, value: m.value, denominator: m.denominator, contract: m.contract });
}

export function assignmentRowNumbers(row: AssignmentRow): RenderedNumber[] {
  const out: RenderedNumber[] = [];
  const at = `assignment ${row.id}`;
  if (row.discovery.downloaded.held) pushMeasured(out, `${at} · complete downloads`, row.discovery.downloaded.value.complete);
  if (row.parsing.parsed.held) pushHeld(out, `${at} · usable records`, row.parsing.parsed.value.usable);
  if (row.verification.pipeline.held) {
    const p = row.verification.pipeline.value;
    pushMeasured(out, `${at} · passed verification`, p.passed);
    pushMeasured(out, `${at} · needs more evidence`, p.needsMoreEvidence);
    pushMeasured(out, `${at} · rejected on quality`, p.rejected);
  }
  if (row.delivery.approved !== null) pushHeld(out, `${at} · approved for promotion`, row.delivery.approved);
  if (row.cost.dollars.kind === "MEASURED") pushHeld(out, `${at} · measured dollars`, row.cost.dollars.usd);
  return out;
}

export function groupMeasures(g: AssignmentGroup): { readonly listed: Measured; readonly leftOut: Measured } {
  const source = "the published assignment view's group counts";
  return {
    listed: measured(g.published, g.total, "assignments of this state and lane carried on the published list, of every one", source),
    leftOut: measured(g.total - g.published, g.total, "assignments of this state and lane not on the published list — each still opens by id", source),
  };
}

export interface AssignmentCounts {
  readonly total: number;
  readonly byState: readonly { readonly state: AssignmentState; readonly count: Measured }[];
  readonly byLane: readonly { readonly lane: AssignmentLane; readonly count: Measured }[];
    /** Non-empty when a half was not published or not read: the page must not draw these sums as counts. */
  readonly missing: readonly string[];
}

export function combinedCounts(
  view: AssignmentView | null,
  routine: readonly { readonly state: AssignmentState; readonly lane: AssignmentLane }[],
  routineUnreadBecause: string | null = null,
): AssignmentCounts {
  const total = (view?.summary.total ?? 0) + routine.length;
  const source = `${view ? "the published assignment view" : "no published assignment view"} plus ${routine.length} routine contract(s) read live`;
  const missing = [
    ...(view === null ? ["the assignment view is not on the published snapshot yet"] : []),
    ...(routineUnreadBecause === null ? [] : [`routine contracts could not be read (${routineUnreadBecause})`]),
  ];
  return {
    missing,
    total,
    byState: ASSIGNMENT_STATES.map((state) => ({
      state,
      count: measured(
        (view?.summary.byState.find((s) => s.state === state)?.count.value ?? 0) + routine.filter((r) => r.state === state).length,
        total,
        `assignments whose state is ${STATE_WORDS[state].label.toLowerCase()}, of every assignment on this page`,
        source,
      ),
    })),
    byLane: ASSIGNMENT_LANES.map((lane) => ({
      lane,
      count: measured(
        (view?.summary.byLane.find((l) => l.lane === lane)?.count.value ?? 0) + routine.filter((r) => r.lane === lane).length,
        total,
        `assignments in the ${LANE_WORDS[lane].label.toLowerCase()} lane, of every assignment on this page`,
        source,
      ),
    })),
  };
}

export function assignmentListRowNumbers(row: AssignmentListRow): RenderedNumber[] {
  const out: RenderedNumber[] = [];
  const at = `assignment ${row.id}`;
  if (row.downloaded) pushMeasured(out, `${at} · complete downloads`, row.downloaded);
  if (row.parsed?.usable) pushMeasured(out, `${at} · usable records`, row.parsed.usable);
  if (row.cost.usd) pushMeasured(out, `${at} · measured dollars`, row.cost.usd);
  return out;
}

export function assignmentRenderedNumbers(view: AssignmentView, renderedRows: readonly AssignmentListRow[] = []): RenderedNumber[] {
  const out: RenderedNumber[] = [];
  for (const s of view.summary.byState) pushMeasured(out, `assignments · ${STATE_WORDS[s.state].label}`, s.count);
  for (const l of view.summary.byLane) pushMeasured(out, `assignments · ${LANE_WORDS[l.lane].label}`, l.count);
  pushHeld(out, "assignments · overdue", view.summary.overdue);
  pushHeld(out, "assignments · in failure backoff", view.summary.inBackoff);
  pushHeld(out, "assignment costs · attributed", view.summary.costs.attributed);
  pushHeld(out, "assignment costs · shared pre-warm", view.summary.costs.shared.usd);
  pushHeld(out, "assignment costs · unattributed", view.summary.costs.unattributed.usd);
  pushHeld(out, "assignment costs · unmeasured model rows", view.summary.costs.unmeasuredModelRows);
  if (view.summary.pipeline.held) pushMeasured(out, "assignments · pipeline items linked", view.summary.pipeline.value.linked);
  out.push(...askGapRenderedNumbers(view));
  out.push({
    label: "assignments · published rows",
    value: view.selection.published,
    denominator: view.summary.total,
    contract: "assignments carried on the published list, of every assignment counted; the rest open by id",
  });
  for (const g of view.summary.groups) {
    const m = groupMeasures(g);
    pushMeasured(out, `assignments · listed ${g.state} ${g.lane}`, m.listed);
    pushMeasured(out, `assignments · left out ${g.state} ${g.lane}`, m.leftOut);
  }
  for (const row of renderedRows) out.push(...assignmentListRowNumbers(row));
  return out;
}

export function askGapCountWords(view: Pick<AssignmentView, "summary">): string {
  const counted = view.summary.askGaps;
  if (counted === undefined) return "Open Ask gaps are not counted on this published list: it was built before the count existed.";
  if (!counted.held) return `Open Ask gaps are not counted: ${counted.gap.says}.`;
  const told = counted.value.told;
  const tellings =
    told === undefined
      ? " How often readers were told them is not on this list: the Ask-gap observations were not read for it."
      : told.gaps.value === 0
        ? ` No reader was told any of them in the last ${ASK_GAP_OBSERVATION_WINDOW_DAYS} days.`
        : ` Readers were told ${told.gaps.value.toLocaleString("en-US")} of them in the last ${ASK_GAP_OBSERVATION_WINDOW_DAYS} days; most told: ` +
          told.mostTold
            .map((t) => `${displayNameOf(t.bodyId).short}, ${ASK_GAP_CODE_WORDS[t.code].toLowerCase()} — ${t.asks.value.toLocaleString("en-US")} of ${t.asks.denominator.toLocaleString("en-US")} tellings, latest ${t.lastDay}`)
            .join(" · ") +
          ".";
  return (
    `Open Ask gaps — ${counted.value.open.toLocaleString("en-US")}: ` +
    counted.value.byCode.map((c) => `${ASK_GAP_CODE_WORDS[c.code].toLowerCase()} ${c.count.value.toLocaleString("en-US")}`).join(" · ") +
    "." +
    tellings
  );
}

export function askGapRenderedNumbers(view: Pick<AssignmentView, "summary">): RenderedNumber[] {
  const out: RenderedNumber[] = [];
  const counted = view.summary.askGaps;
  if (!counted?.held) return out;
  for (const c of counted.value.byCode) pushMeasured(out, `open Ask gaps · ${c.code}`, c.count);
  const told = counted.value.told;
  if (told !== undefined) {
    pushMeasured(out, "open Ask gaps · told to a reader", told.gaps);
    for (const t of told.mostTold) pushMeasured(out, `open Ask gaps · tellings · ${t.bodyId}#${t.code}`, t.asks);
  }
  return out;
}

export function combinedCountNumbers(counts: AssignmentCounts): RenderedNumber[] {
  const out: RenderedNumber[] = [];
  if (counts.missing.length > 0) return out;
  for (const s of counts.byState) pushMeasured(out, `assignments on this page · ${STATE_WORDS[s.state].label}`, s.count);
  for (const l of counts.byLane) pushMeasured(out, `assignments on this page · ${LANE_WORDS[l.lane].label}`, l.count);
  return out;
}

export function assignmentCountClaims(view: AssignmentView): CountClaim[] {
  const byState = view.summary.byState.reduce((n, s) => n + s.count.value, 0);
  const byLane = view.summary.byLane.reduce((n, l) => n + l.count.value, 0);
  const groups = view.summary.groups.reduce((n, g) => n + g.published, 0);
  return [
    { label: "assignments counted by state", stated: view.summary.total, rendered: byState },
    { label: "assignments counted by lane", stated: view.summary.total, rendered: byLane },
    { label: "published assignment rows", stated: view.selection.published, rendered: view.rows.length },
    { label: "published rows by group", stated: view.selection.published, rendered: groups },
    { label: "published plus omitted", stated: view.summary.total, rendered: view.selection.published + view.selection.omitted },
    ...(view.summary.askGaps?.held
      ? [{ label: "open Ask gaps by code", stated: view.summary.askGaps.value.open, rendered: view.summary.askGaps.value.byCode.reduce((n, c) => n + c.count.value, 0) }]
      : []),
  ];
}

export function waitingHours(row: { readonly waiting: { readonly since: string | null } }, nowIso: string): number | null {
  const since = ms(row.waiting.since);
  const now = ms(nowIso);
  if (!Number.isFinite(since) || !Number.isFinite(now)) return null;
  return Math.max(0, (now - since) / HOUR_MS);
}
