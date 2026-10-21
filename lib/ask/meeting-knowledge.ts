import { minutesSummaryForMeeting } from "../meetings/minutes-summaries.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import { commentAccessFor } from "../registry/comment-access.ts";
import { outcomeQuestionClass } from "./outcome-question.ts";
import { noticeSummaryFor, NOTICE_SUMMARIES } from "../meetings/notice-summary.ts";
import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";
import type { Meeting } from "../sources/types.ts";
import { meetingListingIdentity } from "../meetings/listing-identity.ts";
import { canonicalBodyIdentity } from "./body-identity.ts";
import { readTranslations } from "../translate/projection-reader.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";

export type MeetingSnapshotRead = () => MeetingsSnapshot | null;

/** Checked translations attach only to their held body/sitting; agendas also require the current document revision. */
export async function translatedMeetingEvidenceFor(bodyId: string, meetingId: string, question: string,
  snapshot: MeetingsSnapshot | null, options: PromotedCivicDataReadOptions = {}) {
  const records: EvidenceRecord[] = [], gaps: EvidenceGap[] = [];
  const meetings = snapshot?.meetings.filter(meeting => meeting.id === meetingId && meeting.bodyId === bodyId) ?? [];
  if (meetings.length !== 1 || !meetings[0].ocdId || outcomeQuestionClass(question) === "HOW_DID_THEY_VOTE") return { records, gaps };
  const wantMinutes = outcomeQuestionClass(question) === "WHAT_WAS_DECIDED" || /\b(?:minutes|happened|discussed)\b/i.test(question);
  const wantAgenda = !wantMinutes && /\b(?:agenda|notice|noticed|summary|summarize)\b/i.test(question);
  if (!wantMinutes && !wantAgenda) return { records, gaps };
  const kind = wantMinutes ? "MINUTES" : "AGENDA";
  const held = await readTranslations([meetings[0].ocdId], options).catch(() => []);
  const matching = held.filter(row => row.kind === kind && row.subjectId === `${kind.toLowerCase()}:${meetingId}` &&
    row.ocdId === meetings[0].ocdId && row.meeting?.bodyId === bodyId && row.meeting.id === meetingId);
  if (matching.length !== 1) return { records, gaps };
  const row = matching[0];
  if (row.kind === "MEASURE") return { records, gaps };
  const document = [...snapshot?.agendaDocuments ?? []].filter(row => row.meetingId === meetingId && row.ocdId === meetings[0].ocdId)
    .sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt))[0];
  if (kind === "AGENDA" && (!document || document.documentUrl !== row.sourceUrl ||
      document.contentHash.replace(/^sha256-/, "") !== row.sourceHash)) return { records, gaps };
  records.push({ kind: wantMinutes ? "MEETING_MINUTES_SUMMARY" : "MEETING_NOTICE_SUMMARY",
    id: row.id, bodyId, text: `Plain-English summary of the published ${wantMinutes ? "minutes" : "agenda"}: ${row.text}`,
    occurredAt: meetings[0].startsAt, sourceUrl: row.sourceUrl, sourceOrg: kind === "AGENDA" ? document?.sourceOrg ?? null : null,
    retrievedAt: row.retrievedAt, ...(!wantMinutes && document ? { noticeSummary: {
      documentId: document.id, contentHash: document.contentHash, writtenAt: row.writtenAt } } : {}) });
  gaps.push(...meetingListingKnowledgeFor(snapshot?.meetings ?? [], [meetingId]).gaps);
  return { records, gaps };
}

/** Source IDs remain distinct; equal body/time listings are not a proved event count. */
export function meetingListingKnowledgeFor(meetings: readonly Meeting[], selectedSourceIds: readonly string[]) {
  const selected = new Set(selectedSourceIds);
  const all = meetingListingIdentity(meetings, canonicalBodyIdentity);
  const relatedGroups = all.groups.filter(group => group.sourceIds.some(id => selected.has(id)));
  for (const group of relatedGroups) for (const id of group.sourceIds) selected.add(id);
  const readback = meetingListingIdentity(meetings.filter(meeting => selected.has(meeting.id)), canonicalBodyIdentity);
  return { readback, gaps: readback.groups.map(group => ({ whose: "OURS" as const, statement: group.reason })) };
}

/** A notice paraphrase describes only the exact held document version it cites. */
export function noticeSummaryEvidenceFor(bodyId: string, meetingId: string, question: string, read: MeetingSnapshotRead) {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  if (outcomeQuestionClass(question) || !/\b(?:agenda|notice|noticed|summary|summarize)\b/i.test(question) || !NOTICE_SUMMARIES.some((summary) => summary.meetingId === meetingId)) return { records, gaps };
  let snapshot: ReturnType<MeetingSnapshotRead>;
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
  gaps.push(...meetingListingKnowledgeFor(snapshot.meetings, [meetingId]).gaps);
  return { records, gaps };
}

/** The existing map summary is our sourced paraphrase, never a member roll call. */
export function minutesSummaryEvidenceFor(bodyId: string, meetingId: string, question: string, read: MeetingSnapshotRead) {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const questionClass = outcomeQuestionClass(question);
  if (questionClass === "HOW_DID_THEY_VOTE" || (questionClass !== "WHAT_WAS_DECIDED" && !/\b(?:minutes|summary|summarize|discuss(?:ed)?|happened)\b/i.test(question))) return { records, gaps };
  const summary = minutesSummaryForMeeting(meetingId);
  if (!summary) return { records, gaps };
  let snapshot: ReturnType<MeetingSnapshotRead>;
  try { snapshot = read(); } catch { snapshot = null; }
  if (!snapshot) return { records, gaps: [{ whose: "OURS" as const, statement: "The meeting identity for the held minutes summary could not be read, so it has not been attached to another sitting." }] };
  const meetings = snapshot.meetings.filter((meeting) => meeting.id === meetingId);
  if (meetings.length !== 1 || meetings[0].bodyId !== bodyId) return { records, gaps };
  records.push({ kind: "MEETING_MINUTES_SUMMARY", id: `${meetingId}#minutes-summary`, bodyId,
    text: `Meanwhile's plain-language summary of the source record: ${summary.summary}`,
    occurredAt: meetings[0].startsAt, sourceUrl: summary.minutesUrl, sourceOrg: summary.sourceOrg, retrievedAt: summary.readAt });
  gaps.push(...meetingListingKnowledgeFor(snapshot.meetings, [meetingId]).gaps);
  return { records, gaps };
}

/** Standing rules use the same exact-body selector as the meeting panel. */
export function commentAccessEvidenceFor(bodyId: string, ocdId: string | null, bodyName: string, projection?: Parameters<typeof commentAccessFor>[3]) {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const access = commentAccessFor(ocdId, bodyName, bodyId, projection);
  if (!access) return { records, gaps };
  if (access.commentPeriod === "UNKNOWN") {
    gaps.push({ whose: "OURS", statement: `We have not established ${bodyName}'s standing public-comment rules; its own page is ${access.sourceUrl}.` });
  }
  const fields = ["commentPeriodDetail", "timeLimit", "signup", "writtenComment", "attend"] as const;
  const period = access.commentPeriod === "YES" ? "These standing rules provide a public-comment period." : "These standing rules do not provide a public-comment period.";
  const sourceFor = (field: keyof NonNullable<typeof access.fieldSources>) => access.fieldSources?.[field] ?? access;
  if (access.commentPeriod !== "UNKNOWN") records.push({ kind: "PUBLIC_COMMENT_ACCESS", id: `${bodyId}#comment-access:commentPeriod`, bodyId,
    text: `Standing public-comment rules: ${period} These are the body's published standing rules, not a verified change for a particular meeting.`,
    sourceUrl: sourceFor("commentPeriod").sourceUrl, retrievedAt: sourceFor("commentPeriod").collectedAt, accessRule: { field: "commentPeriod", value: access.commentPeriod, standingRule: true } });
  for (const field of fields) if (access[field]) records.push({ kind: "PUBLIC_COMMENT_ACCESS", id: `${bodyId}#comment-access:${field}`, bodyId,
    text: access[field], sourceUrl: sourceFor(field).sourceUrl, retrievedAt: sourceFor(field).collectedAt, accessRule: { field, value: access[field], standingRule: true } });
  return { records, gaps };
}
