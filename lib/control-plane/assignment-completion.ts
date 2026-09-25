/**
 * **AN ASSIGNMENT IS COMPLETE ONLY WHEN EVERY MEMBER OBLIGATION IS.** (MW-015,
 * 2026-09-25.)
 *
 * Visited is not finished. An assignment — a geography the owner sent, a
 * dispatch target — owns a set of member obligations (each obligation lists
 * the assignments it belongs to, `obligation.assignments[]`). The assignment
 * is COMPLETE only when every member's work item passes the one completion
 * evaluator (`evaluateCompletion`) for VERIFIED_COMPLETE: no refusal, nothing
 * unsettled. Anything else is NOT_COMPLETE, and the exceptions that remain are
 * listed by obligation with the refusal codes that hold each one. An
 * assignment with no members is never complete — an empty set is not
 * evidence that the work is done.
 *
 * Membership is written by the assignment-identity work; this module reads the
 * shape it writes (`{ assignmentKey, relation, at }` on the obligation value)
 * and nothing else. The caller supplies each member's completion snapshot —
 * a member whose snapshot was not read is UNSETTLED, never assumed complete.
 * PURE and TOTAL, like the evaluator it applies.
 */
import { evaluateCompletion, type CompletionSnapshot, type RefusalCode } from "./completion.ts";
import type { WorkItemState } from "./work-item.ts";

/** One membership record, as the obligation carries it. */
export interface AssignmentMembership {
  readonly assignmentKey: string;
  /** How the obligation belongs (e.g. created for it, placed by it); every relation counts as membership. */
  readonly relation: string;
  readonly at: string;
}

/** An obligation value, as far as membership needs it. Absent `assignments` is a row written before membership. */
export interface MemberCandidate {
  readonly id: string;
  readonly assignments?: readonly AssignmentMembership[] | null;
}

/** Why a member keeps the assignment open. */
export interface CompletionException {
  readonly obligationId: string;
  /** REFUSED: the evaluator refused it. UNSETTLED: nothing was there to evaluate (no work item, or not read). */
  readonly kind: "REFUSED" | "UNSETTLED";
  readonly codes: readonly RefusalCode[];
  readonly says: string;
}

export type AssignmentCompletion =
  | {
      readonly kind: "COMPLETE";
      readonly assignmentKey: string;
      readonly members: number;
      /** Each member's satisfied clauses, so a PASS is auditable too. */
      readonly satisfied: readonly { readonly obligationId: string; readonly clauses: readonly string[] }[];
    }
  | {
      readonly kind: "NOT_COMPLETE";
      readonly assignmentKey: string;
      readonly members: number;
      /** Members the evaluator passed. */
      readonly settled: number;
      readonly exceptions: readonly CompletionException[];
    }
  | { readonly kind: "NO_MEMBERS"; readonly assignmentKey: string; readonly says: string };

/** The obligations that name this assignment, in id order. */
export function memberObligations<T extends MemberCandidate>(obligations: readonly T[], assignmentKey: string): T[] {
  return obligations
    .filter((o) => (o.assignments ?? []).some((m) => m.assignmentKey === assignmentKey))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Evaluate an assignment. `snapshotFor` returns the completion snapshot of a
 * member's current work item, or null when it has none or it was not read.
 * `proposedState` is the state each member would have to reach; the default is
 * VERIFIED_COMPLETE, because a member parked in any other terminal state (a
 * records request, a human act) is an exception the owner should see.
 */
export function evaluateAssignmentCompletion(input: {
  readonly assignmentKey: string;
  readonly obligations: readonly MemberCandidate[];
  readonly snapshotFor: (obligationId: string) => CompletionSnapshot | null;
  readonly proposedState?: WorkItemState;
}): AssignmentCompletion {
  const members = memberObligations(input.obligations, input.assignmentKey);
  if (members.length === 0) {
    return {
      kind: "NO_MEMBERS",
      assignmentKey: input.assignmentKey,
      says: "No obligation names this assignment, so nothing can be shown finished. An empty set of work is not evidence that the work is done.",
    };
  }
  const proposed = input.proposedState ?? "VERIFIED_COMPLETE";
  const exceptions: CompletionException[] = [];
  const satisfied: { obligationId: string; clauses: readonly string[] }[] = [];
  for (const member of members) {
    const snapshot = input.snapshotFor(member.id);
    if (snapshot === null) {
      exceptions.push({
        obligationId: member.id,
        kind: "UNSETTLED",
        codes: [],
        says: "No work item was read for this obligation, so whether it is finished cannot be evaluated.",
      });
      continue;
    }
    const verdict = evaluateCompletion(snapshot, proposed);
    if (verdict.mayComplete) {
      satisfied.push({ obligationId: member.id, clauses: verdict.satisfied });
      continue;
    }
    exceptions.push({
      obligationId: member.id,
      kind: "REFUSED",
      codes: [...new Set(verdict.refusals.map((r) => r.code))],
      says: verdict.refusals.map((r) => `${r.code} (${r.subject})`).join("; "),
    });
  }
  return exceptions.length === 0
    ? { kind: "COMPLETE", assignmentKey: input.assignmentKey, members: members.length, satisfied }
    : { kind: "NOT_COMPLETE", assignmentKey: input.assignmentKey, members: members.length, settled: satisfied.length, exceptions };
}

/** One plain sentence for the instruction view, generated from the evaluation. */
export function assignmentCompletionWords(c: AssignmentCompletion): string {
  if (c.kind === "NO_MEMBERS") return c.says;
  if (c.kind === "COMPLETE") return `Complete: all ${c.members.toLocaleString("en-US")} member obligations passed the completion check.`;
  const refused = c.exceptions.filter((e) => e.kind === "REFUSED").length;
  const unsettled = c.exceptions.length - refused;
  return (
    `Not complete: ${c.settled.toLocaleString("en-US")} of ${c.members.toLocaleString("en-US")} member obligations passed the completion check; ` +
    `${refused.toLocaleString("en-US")} refused and ${unsettled.toLocaleString("en-US")} not yet settled remain.`
  );
}
