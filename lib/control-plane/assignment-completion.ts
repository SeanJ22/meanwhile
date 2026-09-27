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
import type { AssignmentMembership as SendMembership } from "./expansion/assignment-budget.ts";
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
      /** Whole counts when `exceptions` is capped; absent means the list is whole. */
      readonly refusedCount?: number;
      readonly unsettledCount?: number;
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
  const refused = c.refusedCount ?? c.exceptions.filter((e) => e.kind === "REFUSED").length;
  const unsettled = c.unsettledCount ?? c.exceptions.length - c.exceptions.filter((e) => e.kind === "REFUSED").length;
  return (
    `Not complete: ${c.settled.toLocaleString("en-US")} of ${c.members.toLocaleString("en-US")} member obligations passed the completion check; ` +
    `${refused.toLocaleString("en-US")} refused and ${unsettled.toLocaleString("en-US")} not yet settled remain.`
  );
}

/**
 * **WHAT THE RUNNER CAN SAY EVERY CYCLE: EACH MEMBER'S OWN RECORD.** (MW-015, 2026-09-25.)
 *
 * `evaluateAssignmentCompletion` needs each member's full completion snapshot
 * (work item, route tasks, validations, audits), which the runner does not hold
 * per cycle. What it does hold is each member obligation's own record and its
 * freshness debt, and that is enough to keep "visited" from reading as
 * "finished": a member is settled only when it has been worked to a
 * disposition, has no open failure, no recorded absence standing in for a
 * record, and nothing in progress. Everything else is an exception, named.
 * The result is the same shape, so the page renders both the same way.
 */
export interface MemberRecord {
  readonly id: string;
  readonly assignments?: readonly AssignmentMembership[] | null;
  readonly lastWorkedAt?: string | null;
  readonly openOccurrenceId?: string | null;
  readonly absentUntil?: string | null;
}

/** Use the same recorded membership that the Send's created/reordered counts use.
 * A newly created obligation may not be in the cycle's earlier sync snapshot;
 * it is still a real, unsettled member, never an empty completed assignment.
 */
export function memberRecordsForSend(
  key: string,
  membership: SendMembership,
  records: readonly MemberRecord[],
): MemberRecord[] {
  const slot = membership.byKey.get(key);
  if (!slot) return [];
  const byId = new Map(records.map((record) => [record.id, record]));
  return [...slot.created.values(), ...slot.reordered.values()].map((member) => {
    const held = byId.get(member.obligationId);
    const relation = slot.created.has(member.obligationId) ? "CREATED" : "REORDERED";
    return {
      ...held,
      id: member.obligationId,
      assignments: [...(held?.assignments ?? []), { assignmentKey: key, relation, at: member.joinedAt }],
    };
  });
}

export interface MemberDebt {
  readonly consecutiveFailures: number;
  readonly detail: string;
  readonly retryAt: string;
}

/** At most this many exceptions ride on a reading; the count is always whole. */
export const COMPLETION_EXCEPTION_CAP = 12;

export function evaluateAssignmentFromRecords(input: {
  readonly assignmentKey: string;
  readonly obligations: readonly MemberRecord[];
  readonly debtFor: (obligationId: string) => MemberDebt | null;
  readonly now: string;
}): AssignmentCompletion {
  const members = memberObligations(input.obligations, input.assignmentKey);
  if (members.length === 0) {
    return {
      kind: "NO_MEMBERS",
      assignmentKey: input.assignmentKey,
      says: "No obligation names this assignment, so nothing can be shown finished. An empty set of work is not evidence that the work is done.",
    };
  }
  const exceptions: CompletionException[] = [];
  let settled = 0;
  for (const member of members) {
    const debt = input.debtFor(member.id);
    if (debt !== null && debt.consecutiveFailures > 0) {
      exceptions.push({
        obligationId: member.id,
        kind: "REFUSED",
        codes: [],
        says: `its last ${debt.consecutiveFailures} ${debt.consecutiveFailures === 1 ? "attempt" : "attempts"} failed (${debt.detail.slice(0, 160)}); the next try is at ${debt.retryAt}`,
      });
    } else if (member.absentUntil && Date.parse(member.absentUntil) > Date.parse(input.now)) {
      exceptions.push({ obligationId: member.id, kind: "UNSETTLED", codes: [], says: `recorded as absent until ${member.absentUntil}; an argued absence is not a record held` });
    } else if (!member.lastWorkedAt) {
      exceptions.push({ obligationId: member.id, kind: "UNSETTLED", codes: [], says: "not worked yet" });
    } else if (member.openOccurrenceId) {
      exceptions.push({ obligationId: member.id, kind: "UNSETTLED", codes: [], says: "a round of work is open on it now" });
    } else {
      settled += 1;
    }
  }
  return exceptions.length === 0
    ? { kind: "COMPLETE", assignmentKey: input.assignmentKey, members: members.length, satisfied: [] }
    : {
        kind: "NOT_COMPLETE",
        assignmentKey: input.assignmentKey,
        members: members.length,
        settled,
        exceptions: exceptions.slice(0, COMPLETION_EXCEPTION_CAP),
        refusedCount: exceptions.filter((e) => e.kind === "REFUSED").length,
        unsettledCount: exceptions.filter((e) => e.kind === "UNSETTLED").length,
      };
}
