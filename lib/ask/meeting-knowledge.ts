import { minutesSummaryForMeeting } from "../meetings/minutes-summaries.ts";
import { readSnapshot } from "../meetings/snapshot.ts";
import { commentAccessFor } from "../registry/comment-access.ts";
import { outcomeQuestionClass } from "./outcome-question.ts";
import { noticeSummaryFor, NOTICE_SUMMARIES } from "../meetings/notice-summary.ts";
import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";

/** A notice paraphrase describes only the exact held document version it cites. */
export function noticeSummaryEvidenceFor(bodyId: string, meetingId: string, question: string, read: typeof readSnapshot = readSnapshot) {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  if (outcomeQuestionClass(question) || !/\b(?:agenda|notice|noticed|summary|summarize)\b/i.test(question) || !NOTICE_SUMMARIES.some((summary) => summary.meetingId === meetingId)) return { records, gaps };
  let snapshot: ReturnType<typeof readSnapshot>;
  try { snapshot = read(); } catch { snapshot = null; }
  if (!snapshot) return { records, gaps: [{ whose: "OURS" as const, statement: "The meeting and document identities for the held notice summary could not be read, so no summary has been attached without its exact source version." }] };
  const meetings = snapshot?.meetings.filter((meeting) => meeting.id === meetingId) ?? [];
  if (meetings.length !== 1 || meetings[0].bodyId !== bodyId) return { records, gaps };
  const document = [...(snapshot?.agendaDocuments ?? [])].filter((row) => row.meetingId === meetingId).sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt))[0];
  if (!document) return { records, gaps };
  const summary = noticeSummaryFor(meetingId, document.contentHash);
  if (!summary || summary.summarizesUrl !== document.documentUrl) return { records, gaps };
  records.push({ kind: "MEETING_NOTICE_SUMMARY", id: `${meetingId}#notice-summary:${document.contentHash}`, bodyId,
    text: `Meanwhile's plain-language summary of this meeting notice: ${summary.summary}`,
    occurredAt: meetings[0].startsAt, sourceUrl: summary.summarizesUrl, sourceOrg: document.sourceOrg ?? null, retrievedAt: document.retrievedAt,
    noticeSummary: { documentId: document.id, contentHash: document.contentHash, writtenAt: summary.writtenAt } });
  return { records, gaps };
}

/** The existing map summary is our sourced paraphrase, never a member roll call. */
export function minutesSummaryEvidenceFor(bodyId: string, meetingId: string, question: string, read: typeof readSnapshot = readSnapshot) {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const questionClass = outcomeQuestionClass(question);
  if (questionClass === "HOW_DID_THEY_VOTE" || (questionClass !== "WHAT_WAS_DECIDED" && !/\b(?:minutes|summary|summarize|discuss(?:ed)?|happened)\b/i.test(question))) return { records, gaps };
  const summary = minutesSummaryForMeeting(meetingId);
  if (!summary) return { records, gaps };
  let snapshot: ReturnType<typeof readSnapshot>;
  try { snapshot = read(); } catch { snapshot = null; }
  if (!snapshot) return { records, gaps: [{ whose: "OURS" as const, statement: "The meeting identity for the held minutes summary could not be read, so it has not been attached to another sitting." }] };
  const meetings = snapshot.meetings.filter((meeting) => meeting.id === meetingId);
  if (meetings.length !== 1 || meetings[0].bodyId !== bodyId) return { records, gaps };
  records.push({ kind: "MEETING_MINUTES_SUMMARY", id: `${meetingId}#minutes-summary`, bodyId,
    text: `Meanwhile's plain-language summary of the source record: ${summary.summary}`,
    occurredAt: meetings[0].startsAt, sourceUrl: summary.minutesUrl, sourceOrg: summary.sourceOrg, retrievedAt: summary.readAt });
  return { records, gaps };
}

/** Standing rules use the same exact-body selector as the meeting panel. */
export function commentAccessEvidenceFor(bodyId: string, ocdId: string | null, bodyName: string) {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const access = commentAccessFor(ocdId, bodyName, bodyId);
  if (!access) return { records, gaps };
  if (access.commentPeriod === "UNKNOWN") {
    gaps.push({ whose: "OURS", statement: `We have not established ${bodyName}'s standing public-comment rules; its own page is ${access.sourceUrl}.` });
    return { records, gaps };
  }
  const fields = ["commentPeriodDetail", "timeLimit", "signup", "writtenComment", "attend"] as const;
  const period = access.commentPeriod === "YES" ? "These standing rules provide a public-comment period." : "These standing rules do not provide a public-comment period.";
  records.push({ kind: "PUBLIC_COMMENT_ACCESS", id: `${bodyId}#comment-access:commentPeriod`, bodyId,
    text: `Standing public-comment rules: ${period} These are the body's published standing rules, not a verified change for a particular meeting.`,
    sourceUrl: access.sourceUrl, retrievedAt: access.collectedAt, accessRule: { field: "commentPeriod", value: access.commentPeriod, standingRule: true } });
  for (const field of fields) if (access[field]) records.push({ kind: "PUBLIC_COMMENT_ACCESS", id: `${bodyId}#comment-access:${field}`, bodyId,
    text: access[field], sourceUrl: access.sourceUrl, retrievedAt: access.collectedAt, accessRule: { field, value: access[field], standingRule: true } });
  return { records, gaps };
}
