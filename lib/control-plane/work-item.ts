/** The durable obligation. It outlives every worker, and may not reach a terminal state while an applicable inherited route has no disposition. */

import type { Disposition } from "../workstate/types.ts";
import { workItemId } from "./ids.ts";
import type { WorkQuestion } from "./work-question.ts";

/** The states a WorkItem may occupy. Every terminal state is an affirmative finding; there is no NOT_FOUND, EXHAUSTED or GAVE_UP. */
export const WORK_ITEM_STATES = [
  "OPEN",
  "BLOCKED",
  "AWAITING_VALIDATION",
  "AWAITING_AUDIT",
  "AWAITING_OWNER",
  "REOPENED",
  /** ---- terminal, each requiring affirmative evidence ---- */
  "VERIFIED_COMPLETE",
  "HUMAN_INTERACTION_REQUIRED",
  "OFFLINE_PUBLIC_ACCESS",
  "RECORDS_REQUEST_REQUIRED",
  "NOT_YET_PUBLISHED",
  "RECORD_NOT_YET_CREATED",
  "LEGALLY_WITHHELD",
  "AUTHOR_DECISION_REQUIRED",
] as const;
export type WorkItemState = (typeof WORK_ITEM_STATES)[number];

export const TERMINAL_WORK_ITEM_STATES: readonly WorkItemState[] = [
  "VERIFIED_COMPLETE",
  "HUMAN_INTERACTION_REQUIRED",
  "OFFLINE_PUBLIC_ACCESS",
  "RECORDS_REQUEST_REQUIRED",
  "NOT_YET_PUBLISHED",
  "RECORD_NOT_YET_CREATED",
  "LEGALLY_WITHHELD",
  "AUTHOR_DECISION_REQUIRED",
];

export function isTerminalState(state: WorkItemState): boolean {
  return TERMINAL_WORK_ITEM_STATES.includes(state);
}

/** Why one WorkItem waits for another. `kind` is what the orchestration guard checks; prose alone does not prove an edge. */
export const DEPENDENCY_KINDS = [
  /** Upstream produces data/artifacts this item consumes. */
  "PRODUCES_CONSUMES",
  /** Both write the same canonical store; they cannot run concurrently. */
  "OWNED_DOMAIN_OVERLAP",
  /** Downstream cannot even be defined until upstream resolves. */
  "DEFINES_SCOPE",
] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export interface WorkDependency {
  readonly upstreamId: string;
  readonly kind: DependencyKind;
  readonly reason: string;
  /** The concrete overlap or handoff. Prose alone does not prove an edge. */
  readonly evidence: readonly string[];
}

/** What this WorkItem must satisfy before a terminal state. Every flag defaults to the safe reading. */
export interface CompletionContract {
  /**
   * Route ids from the inherited method floor that are APPLICABLE to this
   * subject. Each one must carry a disposition before completion. This list is
   * computed from the method store at preflight, never typed by a worker.
   */
  readonly inheritedRouteFloor: readonly string[];
  /** A validator must have passed before this item may complete. */
  readonly requiresValidation: boolean;
  /** An adversarial audit must have run and survived. */
  readonly requiresAudit: boolean;
  /**
   * The coverage denominator must be complete: we know how many subjects are
   * owed, not merely how many we found. A denominator that measures our own
   * output is the coverage attack mode.
   */
  readonly requiresCompleteDenominator: boolean;
  /**
   * The dispositions permitted to satisfy this obligation, if narrower than the governed default (`null`).
   * Applied only to inherited route tasks that carry a disposition; one outside the set refuses completion
   * (`DISPOSITION_OUTSIDE_CONTRACT`). It may only tighten, never widen, what closes an obligation.
   */
  readonly acceptableDispositions: readonly Disposition[] | null;
  /**
   * A verdict this obligation must earn from a named instrument before it may
   * reach a terminal state. `null` is the ordinary case and means the other
   * clauses govern alone.
   *
   * Non-null, it is checked by `evaluateCompletion` against the satisfied set
   * the caller supplies from CANONICAL RUN RECORDS — never from an assertion,
   * and never from the item itself. See {@link InstrumentEvidenceRequirement}.
   */
  readonly instrumentEvidence: InstrumentEvidenceRequirement | null;
}

/**
 * A verdict an obligation must earn from a named instrument's canonical run record. `instanceId` is that exact
 * instance; `createdAtSha` is the tree the failure was observed on, so an older run cannot close it.
 */
export interface InstrumentEvidenceRequirement {
  /** Which instrument's canonical run record may satisfy this. */
  readonly instrument: "READER_SUITE" | "VISUAL_SUITE";
  /** The exact instance or check id that must earn the verdict. */
  readonly instanceId: string;
  /**
   * The SHA the failure was observed on. A qualifying run must have tested
   * this commit or a later one; null means no SHA was resolvable, which is
   * itself a fact and is refused as unsatisfiable rather than waved through.
   */
  readonly createdAtSha: string | null;
  readonly requiredVerdict: "GREEN";
}

export const DEFAULT_CONTRACT: CompletionContract = {
  inheritedRouteFloor: [],
  requiresValidation: true,
  requiresAudit: false,
  requiresCompleteDenominator: false,
  acceptableDispositions: null,
  instrumentEvidence: null,
};

/** Why a human is needed, and since when. Escalations have a clock. */
export interface Escalation {
  readonly id: string;
  readonly reason: string;
  /** What the owner is actually being asked to DO. */
  readonly requestedAction: string;
  /** What the system already tried, so the owner is not asked to re-derive it. */
  readonly alreadyTried: readonly string[];
  readonly openedAt: string;
  /** Response target in hours. Visible ageing, never silent ageing. */
  readonly responseTargetHours: number;
  readonly resolvedAt: string | null;
  /**
   * When the owner asked to stop being shown this in the queue. A NOTIFICATION
   * decision and nothing else: see `blocksCompletion` below, and
   * `openEscalations` for the surface it governs.
   */
  readonly snoozedUntil: string | null;
  /**
   * Whether this escalation still stands between the obligation and a terminal state, independent of any snooze.
   * `true` by default; `false` is an affirmative decision that the escalation is about us and cannot change a
   * public fact.
   */
  readonly blocksCompletion: boolean;
}

/** Build an Escalation with the safe defaults: `blocksCompletion` true, `resolvedAt` and `snoozedUntil` null. */
export function createEscalation(input: {
  id: string;
  reason: string;
  requestedAction: string;
  alreadyTried?: readonly string[];
  openedAt: string;
  responseTargetHours: number;
  /** Pass `false` ONLY for a question whose answer cannot change a public fact. */
  blocksCompletion?: boolean;
}): Escalation {
  return {
    id: input.id,
    reason: input.reason,
    requestedAction: input.requestedAction,
    alreadyTried: input.alreadyTried ?? [],
    openedAt: input.openedAt,
    responseTargetHours: input.responseTargetHours,
    resolvedAt: null,
    snoozedUntil: null,
    blocksCompletion: input.blocksCompletion ?? true,
  };
}

export interface WorkItem {
  /** An explicit capability debt, never an executable route or a source refusal. */
  readonly manualSourceGap?: {
    readonly contractId: import("../civic-data/manual-contracts.ts").ManualProductionContractId;
    readonly mode: "SCOPED_ADAPTER_OWED";
    readonly reason: string;
    readonly instructionReceipt: string;
    readonly assignmentKey?: string;
  };
  readonly directoryParent?: { readonly workItemId: string; readonly bodyId: string; readonly versionId: string };
  readonly publicationOutcome?: {
    readonly at: string; readonly workerResultId: string; readonly status: "PUBLISHED" | "PARTIALLY_PUBLISHED" | "HELD";
    readonly code: string; readonly detail: string; readonly candidateId: string | null; readonly versionId: string | null;
    /** Original successful source observation, retained when held bytes are republished. */
    readonly sourceObservedAt?: string;
    readonly sourceArtifactId?: string;
    readonly recovery?: "WORKER" | "PUBLISHER";
    /** The door (registry id of the saved page) the published facts were read through. */
    readonly doorId?: string;
    /** Verified reader records compared with this body's previous published records. */
    readonly records?: { readonly added: number; readonly changed: number; readonly reused: number };
    readonly recordChanges?: readonly import("../civic-data/publication-record-changes.ts").PublicationRecordChange[];
    /** Exact source-record to public-member bindings admitted by this publication. */
    readonly acceptedMembers?: readonly { readonly recordId: string; readonly memberId: string }[];
    readonly acceptedRecordIds?: readonly string[];
    /** Exact admitted body identities; used to recover downstream work after a restart. */
    readonly bodyIds?: readonly string[];
  };
  /** Additive instructions for the standing fleet; observations remain in canonical results. */
  readonly autonomousPlan?: import("./workers/autonomous-plan.ts").AutonomousWorkPlan;
  readonly id: string;
  readonly project: string;
  /** Canonical subject identity — an OCD-ID, a contest id, a source id. */
  readonly subject: string;
  /** What is owed, in one line. */
  readonly obligation: string;
  /** Why it is owed. A WorkItem with no reason is a WorkItem nobody can retire. */
  readonly why: string;
  /** Which of the six questions this work asks of its record. Absent when nothing recorded it. */
  readonly question?: WorkQuestion;
  readonly priority: "P0" | "P1" | "P2" | "P3";
  readonly state: WorkItemState;
  readonly contract: CompletionContract;
  readonly dependencies: readonly WorkDependency[];
  readonly routeTaskIds: readonly string[];
  readonly escalations: readonly Escalation[];
  readonly createdAt: string;
  readonly transitions: readonly WorkItemTransition[];
}

export interface WorkItemTransition {
  readonly from: WorkItemState | null;
  readonly to: WorkItemState;
  readonly at: string;
  readonly by: string;
  readonly why: string;
}

export function createWorkItem(input: {
  project: string;
  subject: string;
  obligation: string;
  why: string;
  /** Not part of the id: the same work asks the same question. */
  question?: WorkQuestion;
  priority?: WorkItem["priority"];
  contract?: Partial<CompletionContract>;
  dependencies?: readonly WorkDependency[];
  now: string;
}): WorkItem {
  const id = workItemId(input.project, input.subject, input.obligation);
  return {
    id,
    project: input.project,
    subject: input.subject,
    obligation: input.obligation,
    why: input.why,
    ...(input.question !== undefined ? { question: input.question } : {}),
    priority: input.priority ?? "P2",
    state: "OPEN",
    contract: { ...DEFAULT_CONTRACT, ...input.contract },
    dependencies: input.dependencies ?? [],
    routeTaskIds: [],
    escalations: [],
    createdAt: input.now,
    transitions: [{ from: null, to: "OPEN", at: input.now, by: "control-plane", why: input.why }],
  };
}

export function withRouteTasks(item: WorkItem, taskIds: readonly string[]): WorkItem {
  const merged = new Set([...item.routeTaskIds, ...taskIds]);
  return { ...item, routeTaskIds: [...merged] };
}

/** The Needs Sean queue at `now`: unresolved and not snoozed past `now`. Never a completion input; use `completionBlockingEscalations`. */
export function openEscalations(item: WorkItem, now: string): readonly Escalation[] {
  return item.escalations.filter(
    (e) =>
      e.resolvedAt === null &&
      (e.snoozedUntil === null || Date.parse(e.snoozedUntil) <= Date.parse(now)),
  );
}

/** Escalations that still block completion: unresolved and `blocksCompletion`. Takes no clock, so a snooze cannot clear one. */
export function completionBlockingEscalations(item: WorkItem): readonly Escalation[] {
  return item.escalations.filter((e) => e.resolvedAt === null && e.blocksCompletion);
}

/** How long an escalation has waited, in hours. For the Needs You queue. */
export function escalationAgeHours(e: Escalation, now: string): number {
  return (Date.parse(now) - Date.parse(e.openedAt)) / 3_600_000;
}
