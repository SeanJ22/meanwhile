/**
 * The completion evaluator: the only place that decides whether an obligation
 * may end. Pure and total; every refusal is enumerable and named. It refuses by
 * default: an input it was not given is a reason to refuse.
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
  /** A named instrument has not returned the verdict the contract requires. */
  "INSTRUMENT_VERDICT_NOT_EARNED",
  /** The contract names an instrument verdict but no SHA to qualify a run against. */
  "INSTRUMENT_EVIDENCE_UNANCHORED",
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
  /** Terminal state of every upstream dependency, by WorkItem id. An absent id is UNRESOLVED. */
  readonly upstreamStates: ReadonlyMap<string, WorkItemState>;
  /** Whether the coverage denominator is known complete. Only an affirmative `true` satisfies the clause. */
  readonly denominatorComplete: boolean | null;
  /**
   * Instance/check ids a canonical run record has evaluated green on a
   * qualifying tree. Per instance, not per suite; an absent id is unsatisfied.
   */
  readonly instrumentGreens: ReadonlySet<string>;
  readonly now: string;
}

export interface CompletionVerdict {
  readonly mayComplete: boolean;
  readonly proposedState: WorkItemState | null;
  readonly refusals: readonly Refusal[];
  /** Contract clauses that were checked and passed. Makes a PASS auditable too. */
  readonly satisfied: readonly string[];
}

/** Evaluate whether a WorkItem may move to `proposedState`, which must itself be terminal. */
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

  // ---- 1. The inherited route floor ----------------------------------------
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
  // Applies to inherited route tasks that carry a disposition; a route found
  // mid-walk is not part of the floor. It only tightens: naming an open
  // disposition here does not make it terminal.
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
  // Three refusals: nobody audited, the audit used our own summary, or the
  // audit broke the claim.
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
  // Only escalations that block terminal truth (`blocksCompletion`). Snoozing
  // does not clear one; only `resolvedAt` does, so this takes no clock.
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

  // ---- The named-instrument verdict ---------------------------------------
  //
  // An item created because a reader could not learn a fact closes only when
  // the instrument that found the failure says, on a tree at or after the one
  // it was observed on, that that question is green.
  const evidence = item.contract.instrumentEvidence;
  if (evidence !== null) {
    if (evidence.createdAtSha === null) {
      refusals.push({
        code: "INSTRUMENT_EVIDENCE_UNANCHORED",
        subject: evidence.instanceId,
        detail:
          `The contract requires a ${evidence.instrument} ${evidence.requiredVerdict} for ` +
          `${evidence.instanceId}, but no SHA was recorded when the failure was observed. ` +
          "Without one, no run can be shown to have tested the code that failed, so nothing " +
          "can satisfy this clause. That is a defect in how the item was created, and it " +
          "refuses rather than closing on an unanchored green.",
      });
    } else if (!snapshot.instrumentGreens.has(evidence.instanceId)) {
      refusals.push({
        code: "INSTRUMENT_VERDICT_NOT_EARNED",
        subject: evidence.instanceId,
        detail:
          `No canonical ${evidence.instrument} run at or after ${evidence.createdAtSha} has ` +
          `evaluated ${evidence.instanceId} as ${evidence.requiredVerdict}. The obligation is ` +
          "that specific question turning green, not this one being worked on.",
      });
    } else {
      satisfied.push(
        `${evidence.instrument} evaluated ${evidence.instanceId} ${evidence.requiredVerdict} ` +
          `on a run at or after ${evidence.createdAtSha}`,
      );
    }
  }

  return {
    mayComplete: refusals.length === 0,
    proposedState: refusals.length === 0 ? proposedState : null,
    refusals,
    satisfied,
  };
}

/** Renders a refusal set as what is missing, not a verdict on the session. */
export function explainRefusals(verdict: CompletionVerdict): string {
  if (verdict.mayComplete) {
    return `MAY COMPLETE as ${verdict.proposedState}. Satisfied: ${verdict.satisfied.join("; ")}.`;
  }
  const lines = verdict.refusals.map((r) => `  [${r.code}] ${r.subject}\n      ${r.detail}`);
  return `COMPLETION REFUSED — ${verdict.refusals.length} reason(s):\n${lines.join("\n")}`;
}
