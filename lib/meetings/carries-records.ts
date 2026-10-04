import type { Meeting } from "../sources/types.ts";

/**
 * Whether a meeting row carries a record readers can still be owed: it
 * concluded and holds an agenda, minutes, an outcome or a vote. Such a row is
 * kept for good (DB-01) and, once it is older than the held window, moves to
 * its partition's durable history instead of leaving (DB-06).
 */
export function meetingCarriesRecords(meeting: Meeting, hasAgendaDocument: boolean): boolean {
  if (meeting.status !== "CONCLUDED") return false;
  if (hasAgendaDocument || meeting.agendaUrl) return true;
  if ((meeting.publishedLinks ?? []).some((link) => /minutes|outcome|vote|result/i.test(link.label))) return true;
  const extra = meeting as unknown as { outcome?: unknown; votes?: unknown };
  return extra.outcome != null || (Array.isArray(extra.votes) ? extra.votes.length > 0 : extra.votes != null);
}
