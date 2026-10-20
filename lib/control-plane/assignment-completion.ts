/** COMPLETE only when every member passes `evaluateCompletion`; an assignment with no members, or a member not read, is never complete. */
import { evaluateCompletion, type CompletionSnapshot, type RefusalCode } from "./completion.ts";
import type { AssignmentMembership as SendMembership } from "./expansion/assignment-budget.ts";
import type { WorkItemState } from "./work-item.ts";
import { instructionReceiptKey } from "./scheduler/obligation.ts";
import type { PlaceOwedItem } from "../coverage/place-owed.ts";
import { DiskRows } from "./scheduler/disk-rows.ts";
import { plannerMap, type PlannerSpool } from "./scheduler/planner-spool.ts";

let nextCompletion = 0;
function* assigned<T extends MemberCandidate>(rows: Iterable<T>, key: string): IterableIterator<T> {
  for (const row of rows) if ((row.assignments ?? []).some(mark => mark.assignmentKey === key)) yield row;
}
function sample<T extends { readonly obligationId: string }>(rows: T[], value: T): void {
  rows.push(value); rows.sort((a, b) => a.obligationId.localeCompare(b.obligationId)); if (rows.length > COMPLETION_EXCEPTION_CAP) rows.pop();
}

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
  readonly obligations: Iterable<MemberCandidate>;
  readonly snapshotFor: (obligationId: string) => CompletionSnapshot | null;
  readonly proposedState?: WorkItemState;
}): AssignmentCompletion {
  const proposed = input.proposedState ?? "VERIFIED_COMPLETE";
  const exceptions: CompletionException[] = [], satisfied: { obligationId: string; clauses: readonly string[] }[] = [];
  let members = 0, settled = 0, refusedCount = 0, unsettledCount = 0;
  for (const member of assigned(input.obligations, input.assignmentKey)) {
    members += 1;
    const snapshot = input.snapshotFor(member.id);
    if (snapshot === null) {
      unsettledCount += 1;
      sample(exceptions, { obligationId: member.id, kind: "UNSETTLED", codes: [], says: "No work item was read for this obligation, so whether it is finished cannot be evaluated." });
      continue;
    }
    const verdict = evaluateCompletion(snapshot, proposed);
    if (verdict.mayComplete) { settled += 1; sample(satisfied, { obligationId: member.id, clauses: verdict.satisfied }); continue; }
    refusedCount += 1;
    sample(exceptions, { obligationId: member.id, kind: "REFUSED", codes: [...new Set(verdict.refusals.map(r => r.code))], says: verdict.refusals.map(r => `${r.code} (${r.subject})`).join("; ") });
  }
  if (members === 0) return { kind: "NO_MEMBERS", assignmentKey: input.assignmentKey, says: "No obligation names this assignment, so nothing can be shown finished. An empty set of work is not evidence that the work is done." };
  return refusedCount + unsettledCount === 0
    ? { kind: "COMPLETE", assignmentKey: input.assignmentKey, members, satisfied }
    : { kind: "NOT_COMPLETE", assignmentKey: input.assignmentKey, members, settled, exceptions, refusedCount, unsettledCount };
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
export function memberRecordsForSend(key: string, membership: SendMembership, records: Iterable<MemberRecord>, ref: string | undefined, planner: PlannerSpool): DiskRows<MemberRecord>;
export function memberRecordsForSend(key: string, membership: SendMembership, records: Iterable<MemberRecord>, ref?: string): MemberRecord[];
export function memberRecordsForSend(key: string, membership: SendMembership, records: Iterable<MemberRecord>, ref?: string, planner?: PlannerSpool): MemberRecord[] | DiskRows<MemberRecord> {
  const slot = ref === undefined ? membership.byKey.get(key) : membership.byInstruction.get(instructionReceiptKey(key, ref));
  const prefix = `completion-${nextCompletion++}`;
  if (!slot) return planner ? new DiskRows(() => [], () => 0) : [];
  const byId = planner ? plannerMap<MemberRecord>(planner, `${prefix}-records`) : new Map<string, MemberRecord>();
  for (const row of records) byId.set(row.id, row);
  const out = planner?.table<MemberRecord>(`${prefix}-members`, row => row.id), native: MemberRecord[] = [];
  for (const member of (function* () { yield* slot.created.values(); yield* slot.reordered.values(); })()) {
    const held = byId.get(member.obligationId), relation = slot.created.has(member.obligationId) ? "CREATED" : "REORDERED";
    const row = { ...held, id: member.obligationId, ...(ref === undefined ? {} : { instructionJoinedAt: member.joinedAt }),
      assignments: [...(held?.assignments ?? []), { assignmentKey: key, relation, at: member.joinedAt }] };
    if (out) out.add(row); else native.push(row);
  }
  return out ? out.rows : native;
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
  readonly obligations: Iterable<MemberRecord>;
  readonly debtFor: (obligationId: string) => MemberDebt | null;
  readonly now: string;
}): AssignmentCompletion {
  const exceptions: CompletionException[] = [];
  let members = 0, settled = 0, refusedCount = 0, unsettledCount = 0;
  for (const member of assigned(input.obligations, input.assignmentKey)) {
    members += 1;
    const debt = input.debtFor(member.id);
    let exception: CompletionException | null = null;
    if (debt !== null && debt.consecutiveFailures > 0) exception = { obligationId: member.id, kind: "REFUSED", codes: [],
      says: `its last ${debt.consecutiveFailures} ${debt.consecutiveFailures === 1 ? "attempt" : "attempts"} failed (${debt.detail.slice(0, 160)}); the next try is at ${debt.retryAt}` };
    else if (member.absentUntil && Date.parse(member.absentUntil) > Date.parse(input.now)) exception = { obligationId: member.id, kind: "UNSETTLED", codes: [], says: `recorded as absent until ${member.absentUntil}; an argued absence is not a record held` };
    else if (!member.lastWorkedAt) exception = { obligationId: member.id, kind: "UNSETTLED", codes: [], says: "not worked yet" };
    else if (member.instructionJoinedAt && Date.parse(member.lastWorkedAt) < Date.parse(member.instructionJoinedAt)) exception = { obligationId: member.id, kind: "UNSETTLED", codes: [], says: "the last completed source round predates this instruction; no new completion or explicit reuse receipt is recorded" };
    else if (member.openOccurrenceId) exception = { obligationId: member.id, kind: "UNSETTLED", codes: [], says: "a round of work is open on it now" };
    if (exception) { if (exception.kind === "REFUSED") refusedCount += 1; else unsettledCount += 1; sample(exceptions, exception); }
    else settled += 1;
  }
  if (members === 0) return { kind: "NO_MEMBERS", assignmentKey: input.assignmentKey, says: "No obligation names this assignment, so nothing can be shown finished. An empty set of work is not evidence that the work is done." };
  return refusedCount + unsettledCount === 0 ? { kind: "COMPLETE", assignmentKey: input.assignmentKey, members, satisfied: [] }
    : { kind: "NOT_COMPLETE", assignmentKey: input.assignmentKey, members, settled, exceptions, refusedCount, unsettledCount };
}

export function isUnfilledRow(item: PlaceOwedItem): boolean {
  if (item.state !== "missing" && item.state !== "stale") return false;
  if (item.statuses.due === "not-yet-due") return false;
  if (item.statuses.found === "checked-not-posted") return false;
  return item.statuses.published !== "awaiting-publication" && item.statuses.published !== "not-published";
}

export function missionMapCount(items: Iterable<PlaceOwedItem>, before: number | null): MissionMapCount {
  let owed = 0, unfilled = 0, stale = 0;
  for (const item of items) { owed += 1; if (isUnfilledRow(item)) { unfilled += 1; if (item.state === "stale") stale += 1; } }
  return { owed, unfilled, stale, before: before ?? unfilled };
}

/** Done only when the map has no unfilled row and every door it opened has a next read; a map that was not read is never Done. */
export function evaluateMissionDone(input: {
  readonly assignmentKey: string;
  readonly obligations: Iterable<MemberRecord>;
  readonly debtFor: (obligationId: string) => MemberDebt | null;
  readonly map: MissionMapCount | { readonly unreadable: string };
}): AssignmentCompletion {
  let members = 0, unscheduled = 0, failing = 0;
  const missing: CompletionException[] = [], failures: CompletionException[] = [];
  for (const member of assigned(input.obligations, input.assignmentKey)) {
    members += 1;
    if ("unreadable" in input.map) { sample(missing, { obligationId: member.id, kind: "UNSETTLED", codes: [], says: `the mission map was not read (${input.map.unreadable.slice(0, 160)})` }); continue; }
    if (!member.nextDueAt && !member.openOccurrenceId) { unscheduled += 1; sample(missing, { obligationId: member.id, kind: "UNSETTLED", codes: [], says: "no next read is scheduled for this door" }); }
    const debt = input.debtFor(member.id);
    if (debt && debt.consecutiveFailures > 0) { failing += 1; sample(failures, { obligationId: member.id, kind: "REFUSED", codes: [],
      says: `its last ${debt.consecutiveFailures} ${debt.consecutiveFailures === 1 ? "attempt" : "attempts"} failed (${debt.detail.slice(0, 160)}); the next try is at ${debt.retryAt}` }); }
  }
  if ("unreadable" in input.map) return members === 0
    ? { kind: "NO_MEMBERS", assignmentKey: input.assignmentKey, says: `The mission map was not read (${input.map.unreadable}), so nothing can be shown finished.` }
    : { kind: "NOT_COMPLETE", assignmentKey: input.assignmentKey, members, settled: 0, refusedCount: 0, unsettledCount: members, exceptions: missing };
  const map = input.map;
  if (members === 0 && map.owed === 0) return { kind: "NO_MEMBERS", assignmentKey: input.assignmentKey, says: "Nothing is owed or assigned yet, so nothing can be shown finished. An empty set of work is not evidence that the work is done." };
  if (map.unfilled === 0 && unscheduled === 0) return { kind: "COMPLETE", assignmentKey: input.assignmentKey, members, satisfied: [], map };
  return { kind: "NOT_COMPLETE", assignmentKey: input.assignmentKey, members, settled: members - unscheduled,
    exceptions: [...missing, ...failures].slice(0, COMPLETION_EXCEPTION_CAP), refusedCount: failing, unsettledCount: map.unfilled + unscheduled, map };
}

export function missionDoneWords(c: AssignmentCompletion): string {
  if (c.kind === "NO_MEMBERS" || !c.map) return assignmentCompletionWords(c);
  const owed = `${c.map.owed.toLocaleString("en-US")} owed`;
  if (c.kind === "COMPLETE") return `Done: every one of ${owed} is filled or waiting on the government, and every door has its next read scheduled (${c.map.before.toLocaleString("en-US")} were open when the map was first read).`;
  return `Not done: ${c.map.unfilled.toLocaleString("en-US")} of ${owed} still open (${c.map.before.toLocaleString("en-US")} when the map was first read).`;
}
