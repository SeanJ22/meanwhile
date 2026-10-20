/** COMPLETE only when every member passes `evaluateCompletion`; an assignment with no members, or a member not read, is never complete. */
import { evaluateCompletion, type CompletionSnapshot, type RefusalCode } from "./completion.ts";
import type { AssignmentMembership as SendMembership } from "./expansion/assignment-budget.ts";
import type { WorkItemState } from "./work-item.ts";
import { instructionReceiptKey } from "./scheduler/obligation.ts";
import type { PlaceOwedItem } from "../coverage/place-owed.ts";

export interface AssignmentMembership {
  readonly assignmentKey: string;
  readonly relation: string;
  readonly at: string;
}

export interface MemberCandidate {
  readonly id: string;
  readonly assignments?: readonly AssignmentMembership[] | null;
}

export interface CompletionException {
  readonly obligationId: string;
  /** REFUSED: the evaluator refused it. UNSETTLED: nothing was there to evaluate (no work item, or not read). */
  readonly kind: "REFUSED" | "UNSETTLED";
  readonly codes: readonly RefusalCode[];
  readonly says: string;
}

export interface MissionMapCount {
  readonly owed: number;
  readonly unfilled: number;
  readonly stale: number;
  readonly before: number;
}

export type AssignmentCompletion =
  | {
      readonly kind: "COMPLETE";
      readonly assignmentKey: string;
      readonly members: number;
      readonly map?: MissionMapCount;
      readonly satisfied: readonly { readonly obligationId: string; readonly clauses: readonly string[] }[];
    }
  | {
      readonly kind: "NOT_COMPLETE";
      readonly assignmentKey: string;
      readonly members: number;
      readonly settled: number;
      readonly exceptions: readonly CompletionException[];
      /** Whole counts when `exceptions` is capped; absent means the list is whole. */
      readonly refusedCount?: number;
      readonly unsettledCount?: number;
      readonly map?: MissionMapCount;
    }
  | { readonly kind: "NO_MEMBERS"; readonly assignmentKey: string; readonly says: string };

export function memberObligations<T extends MemberCandidate>(obligations: readonly T[], assignmentKey: string): T[] {
  return obligations
    .filter((o) => (o.assignments ?? []).some((m) => m.assignmentKey === assignmentKey))
    .sort((a, b) => a.id.localeCompare(b.id));
}

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

/** Settled only when worked to a disposition with no open failure, no recorded absence standing in for a record, and nothing in progress. */
export interface MemberRecord {
  readonly id: string;
  readonly assignments?: readonly AssignmentMembership[] | null;
  readonly lastWorkedAt?: string | null;
  readonly openOccurrenceId?: string | null;
  readonly nextDueAt?: string | null;
  readonly absentUntil?: string | null;
  readonly instructionJoinedAt?: string;
}

/** A newly created obligation may be missing from the cycle's earlier snapshot; it is still an unsettled member. */
export function memberRecordsForSend(
  key: string,
  membership: SendMembership,
  records: readonly MemberRecord[],
  ref?: string,
): MemberRecord[] {
  const slot = ref === undefined ? membership.byKey.get(key) : membership.byInstruction.get(instructionReceiptKey(key,ref));
  if (!slot) return [];
  const byId = new Map(records.map((record) => [record.id, record]));
  return [...slot.created.values(), ...slot.reordered.values()].map((member) => {
    const held = byId.get(member.obligationId);
    const relation = slot.created.has(member.obligationId) ? "CREATED" : "REORDERED";
    return {
      ...held,
      id: member.obligationId,
      ...(ref === undefined ? {} : { instructionJoinedAt: member.joinedAt }),
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
    } else if (member.instructionJoinedAt && Date.parse(member.lastWorkedAt) < Date.parse(member.instructionJoinedAt)) {
      exceptions.push({ obligationId: member.id, kind: "UNSETTLED", codes: [], says: "the last completed source round predates this instruction; no new completion or explicit reuse receipt is recorded" });
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

export function isUnfilledRow(item: PlaceOwedItem): boolean {
  if (item.state !== "missing" && item.state !== "stale") return false;
  if (item.statuses.due === "not-yet-due") return false;
  if (item.statuses.found === "checked-not-posted") return false;
  return item.statuses.published !== "awaiting-publication" && item.statuses.published !== "not-published";
}

export function missionMapCount(items: readonly PlaceOwedItem[], before: number | null): MissionMapCount {
  const unfilled = items.filter(isUnfilledRow);
  return { owed: items.length, unfilled: unfilled.length, stale: unfilled.filter((item) => item.state === "stale").length,
    before: before ?? unfilled.length };
}

/** Done only when the map has no unfilled row and every door it opened has a next read; a map that was not read is never Done. */
export function evaluateMissionDone(input: {
  readonly assignmentKey: string;
  readonly obligations: readonly MemberRecord[];
  readonly debtFor: (obligationId: string) => MemberDebt | null;
  readonly map: MissionMapCount | { readonly unreadable: string };
}): AssignmentCompletion {
  const members = memberObligations(input.obligations, input.assignmentKey);
  if ("unreadable" in input.map) {
    const why = input.map.unreadable;
    return members.length === 0
      ? { kind: "NO_MEMBERS", assignmentKey: input.assignmentKey, says: `The mission map was not read (${why}), so nothing can be shown finished.` }
      : { kind: "NOT_COMPLETE", assignmentKey: input.assignmentKey, members: members.length, settled: 0, refusedCount: 0, unsettledCount: members.length,
        exceptions: members.slice(0, COMPLETION_EXCEPTION_CAP).map((member) => ({ obligationId: member.id, kind: "UNSETTLED" as const, codes: [],
          says: `the mission map was not read (${why.slice(0, 160)})` })) };
  }
  const map = input.map;
  if (members.length === 0 && map.owed === 0) {
    return { kind: "NO_MEMBERS", assignmentKey: input.assignmentKey, says: "Nothing is owed or assigned yet, so nothing can be shown finished. An empty set of work is not evidence that the work is done." };
  }
  const unscheduled = members.filter((member) => !member.nextDueAt && !member.openOccurrenceId);
  const failing = members.filter((member) => (input.debtFor(member.id)?.consecutiveFailures ?? 0) > 0);
  if (map.unfilled === 0 && unscheduled.length === 0) {
    return { kind: "COMPLETE", assignmentKey: input.assignmentKey, members: members.length, satisfied: [], map };
  }
  const exceptions: CompletionException[] = [
    ...unscheduled.map((member) => ({ obligationId: member.id, kind: "UNSETTLED" as const, codes: [], says: "no next read is scheduled for this door" })),
    ...failing.map((member) => {
      const debt = input.debtFor(member.id)!;
      return { obligationId: member.id, kind: "REFUSED" as const, codes: [],
        says: `its last ${debt.consecutiveFailures} ${debt.consecutiveFailures === 1 ? "attempt" : "attempts"} failed (${debt.detail.slice(0, 160)}); the next try is at ${debt.retryAt}` };
    }),
  ];
  return { kind: "NOT_COMPLETE", assignmentKey: input.assignmentKey, members: members.length,
    settled: members.length - unscheduled.length, exceptions: exceptions.slice(0, COMPLETION_EXCEPTION_CAP),
    refusedCount: failing.length, unsettledCount: map.unfilled + unscheduled.length, map };
}

export function missionDoneWords(c: AssignmentCompletion): string {
  if (c.kind === "NO_MEMBERS" || !c.map) return assignmentCompletionWords(c);
  const owed = `${c.map.owed.toLocaleString("en-US")} owed`;
  if (c.kind === "COMPLETE") return `Done: every one of ${owed} is filled or waiting on the government, and every door has its next read scheduled (${c.map.before.toLocaleString("en-US")} were open when the map was first read).`;
  return `Not done: ${c.map.unfilled.toLocaleString("en-US")} of ${owed} still open (${c.map.before.toLocaleString("en-US")} when the map was first read).`;
}
