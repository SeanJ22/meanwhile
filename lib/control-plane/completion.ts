/**
 * THE COMPLETION EVALUATOR — one deterministic answer to "may this obligation
 * end?", and the only place in the system permitted to give it.
 *
 * A worker may say "my attempt is finished." Only the control plane may say the
 * obligation is complete. That sentence is the whole reason this file exists as
 * a single function rather than a convention each worker follows. Conventions
 * are what produced "the API returned zero, so there are no meetings."
 *
 * The evaluator is PURE and TOTAL. It takes a snapshot, returns a verdict, and
 * reads no clock, no disk, and no network. Every refusal it can issue is
 * enumerable, testable, and named — which is what lets the seeded-failure suite
 * plant a defect and assert the exact refusal that catches it.
 *
 * It refuses by DEFAULT. `mayComplete` is true only when every clause of the
 * contract is affirmatively satisfied; an input the evaluator was not given is
 * a reason to refuse, never a reason to proceed.
 */

import { OPEN_DISPOSITIONS } from "../workstate/types.ts";
import { isBlocking, dischargesAudit, type AuditFinding, type Contradiction, type ValidationRecord } from "./audit.ts";
import { isOutstanding, type RouteTask } from "./route-task.ts";
import {
  completionBlockingEscalations,
  isTerminalState,
  type WorkItem,
  type WorkItemState,
} from "./work-item.ts";

/** Every distinct reason completion can be refused. Stable identifiers. */
export const REFUSAL_CODES = [
  "INHERITED_ROUTE_WITHOUT_DISPOSITION",
  "DISPOSITION_OUTSIDE_CONTRACT",
  "ROUTE_TASK_STILL_OUTSTANDING",
  "ROUTE_TASK_RECLAIMABLE",
  "ROUTE_TASK_POLICY_DENIED",
  "BLOCKING_CONTRADICTION",
  "VALIDATION_MISSING",
  "VALIDATION_FAILED",
  "AUDIT_MISSING",
  "AUDIT_NOT_INDEPENDENT",
  "AUDIT_BROKE_THE_CLAIM",
  "OWNER_ESCALATION_UNRESOLVED",
  "DENOMINATOR_INCOMPLETE",
  "DEPENDENCY_UNRESOLVED",
  "NOT_A_TERMINAL_STATE",
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

export interface Refusal {
  readonly code: RefusalCode;
  /** The specific thing that is missing — a route id, an escalation id. */
  readonly subject: string;
  readonly detail: string;
}

export interface CompletionSnapshot {
  readonly item: WorkItem;
  readonly routeTasks: readonly RouteTask[];
  readonly validations: readonly ValidationRecord[];
  readonly audits: readonly AuditFinding[];
  readonly contradictions: readonly Contradiction[];
  /**
   * Terminal state of every upstream dependency, by WorkItem id. An id absent
   * from this map is treated as UNRESOLVED — a dependency we failed to look up
   * is not a dependency that is satisfied.
   */
  readonly upstreamStates: ReadonlyMap<string, WorkItemState>;
  /**
   * Whether the coverage denominator for this subject is known to be complete.
   * `null` means "not established", which refuses when the contract asks for
   * it. Only an affirmative `true` satisfies the clause.
   */
  readonly denominatorComplete: boolean | null;
  readonly now: string;
}

export interface CompletionVerdict {
  readonly mayComplete: boolean;
  readonly proposedState: WorkItemState | null;
  readonly refusals: readonly Refusal[];
  /** Contract clauses that were checked and passed. Makes a PASS auditable too. */
  readonly satisfied: readonly string[];
}

/**
 * Evaluate whether a WorkItem may move to `proposedState`.
 *
 * `proposedState` must itself be terminal. Moving an item to OPEN or REOPENED
 * needs no contract — only ENDING an obligation does.
 */
export function evaluateCompletion(
  snapshot: CompletionSnapshot,
  proposedState: WorkItemState,
): CompletionVerdict {
  const refusals: Refusal[] = [];
  const satisfied: string[] = [];
  const { item, routeTasks } = snapshot;

  if (!isTerminalState(proposedState)) {
    return {
      mayComplete: false,
      proposedState: null,
      refusals: [
        {
          code: "NOT_A_TERMINAL_STATE",
          subject: proposedState,
          detail:
            `${proposedState} is not a terminal WorkItem state. The completion evaluator ` +
            "governs the end of an obligation, not ordinary movement through it.",
        },
      ],
      satisfied: [],
    };
  }

  // ---- 1. The inherited route floor. The forgot-the-API refusal. ----------
  //
  // This is first because it is the failure the whole architecture was built
  // around. A worker that never walked /EventDates cannot close Pima meetings,
  // no matter how confident, complete, or internally consistent its report is.
  const disposedRouteIds = new Set(
    routeTasks.filter((t) => t.disposition !== null).map((t) => t.routeId),
  );
  for (const routeId of item.contract.inheritedRouteFloor) {
    if (!disposedRouteIds.has(routeId)) {
      refusals.push({
        code: "INHERITED_ROUTE_WITHOUT_DISPOSITION",
        subject: routeId,
        detail:
          `Inherited route ${routeId} is applicable to this subject and has no disposition. ` +
          "A known route that was never walked cannot be reported as a route that found nothing.",
      });
    }
  }
  if (item.contract.inheritedRouteFloor.length > 0 && refusals.length === 0) {
    satisfied.push(
      `inherited route floor: ${item.contract.inheritedRouteFloor.length} route(s) disposed`,
    );
  }

  // ---- 1b. The contract's narrowed disposition set ------------------------
  //
  // `acceptableDispositions` narrows the clause immediately above it, and until
  // this block existed it narrowed nothing at all: the field was declared,
  // populated by callers, and read by no one. A contract clause the evaluator
  // ignores is worse than an absent one, because it reads as a guarantee.
  //
  // The reading is the narrow one, argued in full on `CompletionContract`: it
  // applies to INHERITED route tasks that carry a disposition. The floor is
  // what the contract is about; a route discovered mid-walk was never part of
  // it, and penalising an honest disposition on a bonus route would punish the
  // extra hunting this product exists to do.
  //
  // It only ever TIGHTENS. Naming an open disposition here does not make it
  // terminal — clause 2 below still refuses it as outstanding.
  const acceptable = item.contract.acceptableDispositions;
  if (acceptable !== null) {
    const governed = routeTasks.filter((t) => t.inherited && t.disposition !== null);
    let outside = 0;
    for (const task of governed) {
      const value = task.disposition!.disposition;
      if (!acceptable.includes(value)) {
        outside += 1;
        refusals.push({
          code: "DISPOSITION_OUTSIDE_CONTRACT",
          subject: task.id,
          detail:
            `Inherited route ${task.routeLabel} is disposed ${value}, which this obligation's ` +
            `contract does not accept (permitted: ${acceptable.length === 0 ? "(none)" : acceptable.join(", ")}). ` +
            "The contract narrowed what may satisfy this obligation; a disposition outside that " +
            "set has not satisfied it, whatever else is green.",
        });
      }
    }
    if (outside === 0) {
      satisfied.push(
        `contract disposition set: ${governed.length} inherited route(s) within ` +
          `{${acceptable.join(", ") || "(none)"}}`,
      );
    }
  }

  // ---- 2. Outstanding, reclaimable and policy-denied route work -----------
  for (const task of routeTasks) {
    if (task.state === "POLICY_DENIED") {
      const denial = task.policyDenial ?? null;
      refusals.push({
        code: "ROUTE_TASK_POLICY_DENIED",
        subject: task.id,
        detail:
          `Route ${task.routeLabel} was refused by OUR capability policy` +
          (denial ? ` (${denial.reason})` : "") +
          ". The route was never walked, so nothing is known about the publisher through it. " +
          "Before a retry can differ from the last one, this must change: " +
          (denial?.requiredChange ?? "no required change was recorded on the task."),
      });
      continue;
    }
    if (task.state === "RECLAIMABLE") {
      refusals.push({
        code: "ROUTE_TASK_RECLAIMABLE",
        subject: task.id,
        detail:
          `Route ${task.routeLabel} has a reclaimable task: a prior Attempt died without ` +
          "reaching a completion boundary. The route has not been walked, only started.",
      });
      continue;
    }
    if (task.state === "CLAIMED") {
      refusals.push({
        code: "ROUTE_TASK_STILL_OUTSTANDING",
        subject: task.id,
        detail: `Route ${task.routeLabel} is currently claimed and still executing.`,
      });
      continue;
    }
    if (isOutstanding(task)) {
      const d = task.disposition?.disposition;
      refusals.push({
        code: "ROUTE_TASK_STILL_OUTSTANDING",
        subject: task.id,
        detail: d
          ? `Route ${task.routeLabel} is disposed ${d}, which is an OPEN state ` +
            `(one of ${OPEN_DISPOSITIONS.join(", ")}). A blocked route is not a settled fact.`
          : `Route ${task.routeLabel} has no disposition.`,
      });
    }
  }

  // ---- 3. Dependencies ---------------------------------------------------
  for (const dep of item.dependencies) {
    const upstream = snapshot.upstreamStates.get(dep.upstreamId);
    if (upstream === undefined || !isTerminalState(upstream)) {
      refusals.push({
        code: "DEPENDENCY_UNRESOLVED",
        subject: dep.upstreamId,
        detail:
          `Upstream ${dep.upstreamId} is ${upstream ?? "not present in the snapshot"} ` +
          `(${dep.kind}: ${dep.reason}).`,
      });
    }
  }

  // ---- 4. Contradictions -------------------------------------------------
  for (const c of snapshot.contradictions) {
    if (isBlocking(c)) {
      refusals.push({
        code: "BLOCKING_CONTRADICTION",
        subject: c.id,
        detail:
          `Unresolved ${c.severity} contradiction: ${c.detail}. Two authoritative sources ` +
          "disagree and neither has been reconciled.",
      });
    }
  }

  // ---- 5. Validation -----------------------------------------------------
  if (item.contract.requiresValidation) {
    const validations = snapshot.validations.filter((v) => v.workItemId === item.id);
    if (validations.length === 0) {
      refusals.push({
        code: "VALIDATION_MISSING",
        subject: item.id,
        detail: "The contract requires validation and no validation record exists.",
      });
    } else if (!validations.some((v) => v.passed)) {
      refusals.push({
        code: "VALIDATION_FAILED",
        subject: item.id,
        detail: `Validation ran and did not pass: ${validations[validations.length - 1].detail}`,
      });
    } else {
      satisfied.push("validation passed");
    }
  }

  // ---- 6. Adversarial audit ----------------------------------------------
  //
  // Three distinct refusals, because "we audited it" hides three different
  // failures: nobody audited, somebody audited our own summary, or somebody
  // audited properly and broke it.
  if (item.contract.requiresAudit) {
    const audits = snapshot.audits.filter((a) => a.workItemId === item.id);
    if (audits.length === 0) {
      refusals.push({
        code: "AUDIT_MISSING",
        subject: item.id,
        detail: "The contract requires an adversarial audit and none has run.",
      });
    } else if (audits.some((a) => !a.survived && a.resolvedAt === null)) {
      const broken = audits.find((a) => !a.survived && a.resolvedAt === null)!;
      refusals.push({
        code: "AUDIT_BROKE_THE_CLAIM",
        subject: broken.id,
        detail: `A ${broken.mode} audit broke this claim and is unresolved: ${broken.detail}`,
      });
    } else if (!audits.some(dischargesAudit)) {
      refusals.push({
        code: "AUDIT_NOT_INDEPENDENT",
        subject: item.id,
        detail:
          "Every audit on this item started from our own summary. An audit that never left " +
          "our pipeline cannot discover that our pipeline mistook one endpoint for the universe.",
      });
    } else {
      satisfied.push("independent adversarial audit survived");
    }
  }

  // ---- 7. Owner escalations ----------------------------------------------
  //
  // Only escalations that BLOCK terminal truth. An owner decision about, say, a
  // vendor account does not prevent an unrelated record from being complete —
  // that carve-out is `blocksCompletion: false`, decided in writing at the call
  // site rather than inferred here.
  //
  // This clause used to read `openEscalations(item, now)`, which is the QUEUE
  // view: it hides anything snoozed past `now`. So snoozing a genuinely
  // blocking escalation into next week removed it from this loop and the
  // obligation completed — an owner dismissing a notification had, without
  // deciding anything, converted an unanswered question into a settled fact
  // about a government. `completionBlockingEscalations` takes no clock, so
  // there is no longer any moment you can move the evaluation to that changes
  // its answer. Only `resolvedAt` clears one: somebody actually answered.
  for (const e of completionBlockingEscalations(item)) {
    if (proposedState !== "AUTHOR_DECISION_REQUIRED" && proposedState !== "HUMAN_INTERACTION_REQUIRED") {
      refusals.push({
        code: "OWNER_ESCALATION_UNRESOLVED",
        subject: e.id,
        detail:
          `Escalation open since ${e.openedAt} and unresolved: ${e.reason}. ` +
          `Requested action: ${e.requestedAction}.`,
      });
    }
  }

  // ---- 8. Coverage denominator -------------------------------------------
  if (item.contract.requiresCompleteDenominator) {
    if (snapshot.denominatorComplete !== true) {
      refusals.push({
        code: "DENOMINATOR_INCOMPLETE",
        subject: item.subject,
        detail:
          snapshot.denominatorComplete === null
            ? "The coverage denominator has not been established. Completeness measured against " +
              "our own output is not completeness."
            : "The coverage denominator is known to be incomplete.",
      });
    } else {
      satisfied.push("coverage denominator complete");
    }
  }

  return {
    mayComplete: refusals.length === 0,
    proposedState: refusals.length === 0 ? proposedState : null,
    refusals,
    satisfied,
  };
}

/**
 * Human-readable rendering of a refusal set.
 *
 * Deliberately states what is MISSING rather than pronouncing a verdict on the
 * session that ran. "Route /EventDates has no disposition" is actionable;
 * "the session failed" is not.
 */
export function explainRefusals(verdict: CompletionVerdict): string {
  if (verdict.mayComplete) {
    return `MAY COMPLETE as ${verdict.proposedState}. Satisfied: ${verdict.satisfied.join("; ")}.`;
  }
  const lines = verdict.refusals.map((r) => `  [${r.code}] ${r.subject}\n      ${r.detail}`);
  return `COMPLETION REFUSED — ${verdict.refusals.length} reason(s):\n${lines.join("\n")}`;
}
