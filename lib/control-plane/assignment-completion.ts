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
import { instructionReceiptKey } from "./scheduler/obligation.ts";
import type { PlaceOwedItem } from "../coverage/place-owed.ts";

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

/**
 * **THE MISSION MAP'S COUNT FOR ONE SEND (CH-19).** Rows its places owe, and of those the ones still unfilled:
 * due, and neither held fresh nor waiting on the government to publish. `before` is the unfilled count when the
 * map was first read for this Send, carried from reading to reading.
 */
export interface MissionMapCount {
  readonly owed: number;
  readonly unfilled: number;
  /** Of the unfilled, the ones held once and now stale. */
  readonly stale: number;
  readonly before: number;
}

export type AssignmentCompletion =
  | {
      readonly kind: "COMPLETE";
      readonly assignmentKey: string;
      readonly members: number;
      /** The mission map when Done was decided by it (CH-19). */
      readonly map?: MissionMapCount;
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
      readonly map?: MissionMapCount;
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
  /** When this door is next read; a door with none does not refresh. */
  readonly nextDueAt?: string | null;
  readonly absentUntil?: string | null;
  /** Current receipt's own durable join; older work is not its completion. */
  readonly instructionJoinedAt?: string;
}

/** Use the same recorded membership that the Send's created/reordered counts use.
 * A newly created obligation may not be in the cycle's earlier sync snapshot;
 * it is still a real, unsettled member, never an empty completed assignment.
 */
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

/**
 * A row still unfilled on the mission map: it is due (or its due date cannot be told), and it is neither held
 * fresh nor resolved by the government not publishing it (checked and not posted, awaiting or not published).
 */
export function isUnfilledRow(item: PlaceOwedItem): boolean {
  if (item.state !== "missing" && item.state !== "stale") return false;
  if (item.statuses.due === "not-yet-due") return false;
  if (item.statuses.found === "checked-not-posted") return false;
  return item.statuses.published !== "awaiting-publication" && item.statuses.published !== "not-published";
}

/** The mission map's count for a Send's places. `before` is the earlier reading's, or this one's when it is the first. */
export function missionMapCount(items: readonly PlaceOwedItem[], before: number | null): MissionMapCount {
  const unfilled = items.filter(isUnfilledRow);
  return { owed: items.length, unfilled: unfilled.length, stale: unfilled.filter((item) => item.state === "stale").length,
    before: before ?? unfilled.length };
}

/**
 * **A MISSION IS DONE WHEN ITS MAP IS FULL AND ITS DOORS REFRESH.** (CH-19.)
 *
 * A Send is Done only when its places have no unfilled row (government-unpublished items count as resolved)
 * and every door it opened (each member obligation) has a next scheduled read. Done never ends standing work:
 * this reads the records and changes none, and a newly found owed row is unfilled on the next reading, which
 * reopens the mission. A map that was not read is never Done. Member failures are listed, but the map decides.
 */
export function evaluateMissionDone(input: {
  readonly assignmentKey: string;
  readonly obligations: readonly MemberRecord[];
  readonly debtFor: (obligationId: string) => MemberDebt | null;
  /** This Send's mission map, or why it was not read. */
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

/** One plain sentence for a Send decided by its mission map. */
export function missionDoneWords(c: AssignmentCompletion): string {
  if (c.kind === "NO_MEMBERS" || !c.map) return assignmentCompletionWords(c);
  const owed = `${c.map.owed.toLocaleString("en-US")} owed`;
  if (c.kind === "COMPLETE") return `Done: every one of ${owed} is filled or waiting on the government, and every door has its next read scheduled (${c.map.before.toLocaleString("en-US")} were open when the map was first read).`;
  return `Not done: ${c.map.unfilled.toLocaleString("en-US")} of ${owed} still open (${c.map.before.toLocaleString("en-US")} when the map was first read).`;
}
