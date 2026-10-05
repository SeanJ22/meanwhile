/**
 * THE WORK ITEM — the durable obligation.
 *
 * A WorkItem outlives every worker that ever touches it. It is the answer to
 * "what does this project still owe?", and it is deliberately not a task, not a
 * ticket, and not a chat session. Workers are per-Attempt and disposable; this
 * is the thing that is not.
 *
 * The completion contract is the part that matters most. `lib/workstate` already
 * establishes that item completion is DERIVED from child state and that a model
 * may not type "done" while unresolved required children exist. This file
 * carries that rule into route-level execution: a WorkItem may not reach a
 * terminal state while an applicable INHERITED route has no disposition, which
 * is the mechanical form of "a worker cannot silently forget a known API".
 */

import type { Disposition } from "../workstate/types.ts";
import { workItemId } from "./ids.ts";
import type { WorkQuestion } from "./work-question.ts";

/**
 * The states a WorkItem may occupy.
 *
 * The terminal set is drawn from the target architecture's list, and every
 * member of it is an AFFIRMATIVE finding. There is deliberately no
 * `NOT_FOUND`, no `EXHAUSTED`, and no `GAVE_UP`: those describe a session, and
 * a session is not allowed to describe a government (RULING 170, RULING 184).
 */
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

/**
 * Why one WorkItem waits for another.
 *
 * The `reason` is prose for a human, but `kind` is what the orchestration guard
 * can actually check. RULING 194 and `classifyOrchestration` already refuse an
 * edge backed by prose alone; the same standard applies here.
 */
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

/**
 * What this WorkItem must satisfy before it may reach a terminal state.
 *
 * Every flag here defaults to the SAFE reading. A contract that requires
 * nothing is a contract a worker can satisfy by doing nothing.
 */
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
   * The dispositions permitted to satisfy this obligation, if narrower than the
   * governed default. `null` means "the governed default", which is the
   * `OPEN_DISPOSITIONS` / `TERMINAL_DISPOSITIONS` split in
   * `lib/workstate/types.ts` and nothing else.
   *
   * ## What it is applied TO, and why that is the narrow reading
   *
   * When non-null, this list narrows the clause it is written next to: the
   * INHERITED ROUTE FLOOR. `evaluateCompletion` therefore applies it to route
   * tasks with `inherited === true` that carry a disposition, and refuses
   * `DISPOSITION_OUTSIDE_CONTRACT` when one of them landed outside the set.
   *
   * Two wider readings were considered and rejected:
   *
   *   1. **Every RouteTask, inherited or not.** Rejected because it would let a
   *      contract written about the floor silently govern routes the contract
   *      never contemplated. Discovery is a tree (RULING 52) and a route found
   *      mid-walk is, by construction, not part of the floor computed at
   *      preflight. Under this reading a scout that discovered a bonus endpoint
   *      and honestly recorded `POINTER_ONLY` on it would BLOCK an obligation
   *      whose whole floor was walked clean — punishing extra hunting, which is
   *      exactly backwards for this product.
   *   2. **Only route tasks whose `routeId` appears literally in
   *      `inheritedRouteFloor`.** Rejected as too narrow in the unsafe
   *      direction: `inheritedRouteFloor` holds route ids while a RouteTask is
   *      keyed on (route id, target), so a floor route walked against a second
   *      target — the same Legistar route against a second host — would escape
   *      the filter entirely. `inherited` is the flag the preflight actually
   *      sets when it materialises the floor, so it is the honest join.
   *
   * The chosen reading is strictly narrower than (1) and strictly safer than
   * (2). It also fails CLOSED in the only direction that matters: a route the
   * contract cares about that landed on a disposition the contract does not
   * accept refuses completion rather than being averaged away.
   *
   * This list never WIDENS anything. An `OPEN_DISPOSITION` named here does not
   * become terminal; clause 2 of the evaluator still refuses it as outstanding.
   * A contract may only ever tighten what closes an obligation.
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
 * **A VERDICT AN OBLIGATION MUST EARN FROM A NAMED INSTRUMENT.**
 * (A.1 WI3, 2026-08-30.)
 *
 * ## Why prose was not enough
 *
 * `diagnosticWorkItemFor` wrote the completion condition into `why`:
 * *"The completion contract is that question turning green on a recorded
 * evaluation run."* That sentence is correct and it is not a contract. Nothing
 * read it, nothing could check it, and the item it described carried
 * `{...DEFAULT_CONTRACT}` — which requires a validation record and nothing
 * about the question at all. An item created because a reader could not learn
 * a fact could therefore be closed by a validator that never asked the
 * question again.
 *
 * A completion condition a machine cannot evaluate is a completion condition
 * that closes on someone's judgement, and the whole point of the control plane
 * is that obligations do not close on judgement.
 *
 * ## What this requires, and why each field is here
 *
 * `instanceId` is THAT question, not a question like it: the reader contract
 * is per-instance, and a sibling instance turning green says nothing about
 * this one. `createdAtSha` is the tree the failure was observed on, so a run
 * recorded BEFORE the defect existed cannot close it — an older green is
 * evidence about older code. `requiredVerdict` is stated rather than assumed
 * so the field cannot quietly come to mean "any recorded verdict".
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
   * Whether this escalation still stands between the obligation and a terminal
   * state, independent of whether anyone wants to look at it today.
   *
   * The two questions are separate and were previously conflated. Snoozing is a
   * statement about the Needs Sean queue — "not this week" — and a snooze that
   * could retire an obligation would mean an owner dismissing a notification
   * had, without ever deciding anything, converted an unanswered question into
   * a settled fact about a government. That is the same class of error as a
   * timeout becoming an emptiness.
   *
   * So `completionBlockingEscalations` reads THIS field and ignores the snooze
   * entirely, and it is `true` by default everywhere an Escalation is built in
   * this module. A field nobody set must never be the reason an obligation
   * closed. `false` is an affirmative decision that this escalation is about
   * US — a vendor account, a spend approval, a naming choice — and therefore
   * cannot make a public record any less true.
   */
  readonly blocksCompletion: boolean;
}

/**
 * Build an Escalation with the safe defaults already in place.
 *
 * `blocksCompletion` defaults to `true` and `resolvedAt`/`snoozedUntil` to
 * `null`, so the value a caller gets for free is the value that refuses. A
 * caller that genuinely knows the question is about us rather than about a
 * publisher has to say so, in writing, at the call site.
 */
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
    readonly mode: "REVIEWED_INPUT" | "SCOPED_ADAPTER_OWED";
    readonly reason: string;
    readonly instructionReceipt: string;
    readonly assignmentKey?: string;
  };
  readonly directoryParent?: { readonly workItemId: string; readonly bodyId: string; readonly versionId: string };
  readonly publicationOutcome?: {
    readonly at: string; readonly workerResultId: string; readonly status: "PUBLISHED" | "PARTIALLY_PUBLISHED" | "HELD";
    readonly code: string; readonly detail: string; readonly candidateId: string | null; readonly versionId: string | null;
    readonly recovery?: "WORKER" | "PUBLISHER";
    /** The door (registry id of the saved page) the published facts were read through (DB-28). */
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
  /**
   * MW-002: which of the six questions this work asks of its record. Absent
   * when nothing recorded it — a page says "not recorded", never a guess.
   */
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
  /** MW-002. Not part of the id: the same work asks the same question. */
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

/**
 * THE QUEUE VIEW. What the Needs Sean queue shows at `now`, and nothing else.
 *
 * Unresolved, and either never snoozed or snoozed to a moment that has passed.
 * That is a rendering question — which rows an owner should be looking at
 * today — and it is answered against a caller-supplied clock because rendering
 * is the one place a clock genuinely belongs.
 *
 * **This function must never be used as a completion input.** It was, and the
 * consequence was mechanical: snoozing an escalation past `now` removed it from
 * this list, clause 7 of the evaluator read this list, and the obligation
 * completed. An owner pressing "not this week" is not an owner answering the
 * question, and a notification preference cannot be allowed to decide whether a
 * public record is settled. Completion asks
 * `completionBlockingEscalations(item)`, which takes no clock at all.
 */
export function openEscalations(item: WorkItem, now: string): readonly Escalation[] {
  return item.escalations.filter(
    (e) =>
      e.resolvedAt === null &&
      (e.snoozedUntil === null || Date.parse(e.snoozedUntil) <= Date.parse(now)),
  );
}

/**
 * THE COMPLETION VIEW. Escalations that still stand between this obligation and
 * a terminal state.
 *
 * Unresolved AND `blocksCompletion`. The snooze is not consulted, and there is
 * deliberately no `now` parameter — a function that cannot see the clock cannot
 * be talked out of a refusal by moving it. The only thing that clears a
 * blocking escalation is `resolvedAt`: somebody actually answered.
 */
export function completionBlockingEscalations(item: WorkItem): readonly Escalation[] {
  return item.escalations.filter((e) => e.resolvedAt === null && e.blocksCompletion);
}

/** How long an escalation has waited, in hours. For the Needs You queue. */
export function escalationAgeHours(e: Escalation, now: string): number {
  return (Date.parse(now) - Date.parse(e.openedAt)) / 3_600_000;
}
