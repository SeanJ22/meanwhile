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
  /** Dispositions that would satisfy this obligation, if narrower than the default. */
  readonly acceptableDispositions: readonly Disposition[] | null;
}

export const DEFAULT_CONTRACT: CompletionContract = {
  inheritedRouteFloor: [],
  requiresValidation: true,
  requiresAudit: false,
  requiresCompleteDenominator: false,
  acceptableDispositions: null,
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
  readonly snoozedUntil: string | null;
}

export interface WorkItem {
  readonly id: string;
  readonly project: string;
  /** Canonical subject identity — an OCD-ID, a contest id, a source id. */
  readonly subject: string;
  /** What is owed, in one line. */
  readonly obligation: string;
  /** Why it is owed. A WorkItem with no reason is a WorkItem nobody can retire. */
  readonly why: string;
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

export function openEscalations(item: WorkItem, now: string): readonly Escalation[] {
  return item.escalations.filter(
    (e) =>
      e.resolvedAt === null &&
      (e.snoozedUntil === null || Date.parse(e.snoozedUntil) <= Date.parse(now)),
  );
}

/** How long an escalation has waited, in hours. For the Needs You queue. */
export function escalationAgeHours(e: Escalation, now: string): number {
  return (Date.parse(now) - Date.parse(e.openedAt)) / 3_600_000;
}
