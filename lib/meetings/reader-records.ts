import { getOutcomeSnapshot, loadedFrom, outcomeEvidenceFor } from "../outcomes/store.ts";
import type { LegistarAgendaRecord, LegistarOutcomeRecord, LegistarRollCallRecord } from "../sources/legistar/outcomes.ts";

export interface MeetingReaderRecords {
  meetingId: string;
  bodyId: string | null;
  status: "HELD" | "NOT_HELD" | "HOLDING_UNAVAILABLE" | "IDENTITY_UNRESOLVED";
  agenda: readonly LegistarAgendaRecord[];
  actions: readonly LegistarOutcomeRecord[];
  rollCalls: readonly LegistarRollCallRecord[];
  counts: { agenda: number; actions: number; rollCalls: number; votes: number };
  sourceUrl: string | null;
  sourceOrg: string | null;
}

/** The same class-filtered evidence selector Ask uses, scoped to an exact sitting. */
export function meetingReaderRecords(meetingId: string, expectedBodyId?: string | null): MeetingReaderRecords {
  const empty: MeetingReaderRecords = { meetingId, bodyId: expectedBodyId ?? null, status: "NOT_HELD", agenda: [], actions: [], rollCalls: [], counts: { agenda: 0, actions: 0, rollCalls: 0, votes: 0 }, sourceUrl: null, sourceOrg: null };
  const snapshot = getOutcomeSnapshot();
  if (loadedFrom() === "EMPTY_STORE") return { ...empty, status: "HOLDING_UNAVAILABLE" };
  const sittings = snapshot.sittings.filter((s) => s.meetingId === meetingId);
  if (sittings.length === 0) return empty;
  // A duplicate vendor/event key or conflicting body must never choose the first row.
  if (sittings.length !== 1 || (expectedBodyId && sittings[0].bodyId !== expectedBodyId)) return { ...empty, status: "IDENTITY_UNRESOLVED" };
  const sitting = sittings[0];
  const query = { meetingId, bodyId: sitting.bodyId };
  const agenda = outcomeEvidenceFor({ ...query, questionClass: "WHAT_WAS_NOTICED" }).records.filter((r): r is LegistarAgendaRecord => r.recordClass === "AGENDA");
  const actions = outcomeEvidenceFor({ ...query, questionClass: "WHAT_WAS_DECIDED" }).records.filter((r): r is LegistarOutcomeRecord => r.recordClass === "ACTION_SUMMARY");
  const rollCalls = outcomeEvidenceFor({ ...query, questionClass: "HOW_DID_THEY_VOTE" }).records.filter((r): r is LegistarRollCallRecord => r.recordClass === "ROLL_CALL");
  return { meetingId, bodyId: sitting.bodyId, status: "HELD", agenda, actions, rollCalls,
    counts: { agenda: agenda.length, actions: actions.length, rollCalls: rollCalls.length, votes: rollCalls.reduce((n, r) => n + r.votes.length, 0) }, sourceUrl: sitting.sourceUrl, sourceOrg: sitting.sourceOrg };
}
