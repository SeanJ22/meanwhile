import { agendaItems, type AgendaDocumentLike } from "../routing/agenda-search.ts";
import { isAnotherBodysNoticePage, isWiredNoticePage } from "../meetings/notice-pages.ts";
import type { PersistedSittingOutcomes } from "../outcomes/types.ts";
import { agendaDocumentRepresentation } from "./agenda-publication.ts";
import { ASK_GAP_RECORD_CLASS, type AskGapCode, type AskGapRecordClass } from "./gap-codes.ts";
import { localDate } from "./meeting-time.ts";

/**
 * The gaps Ask states about one body, as codes, decided in one place from what
 * we hold:
 *
 * | code | decided from |
 * |---|---|
 * | `AGENDA_NOT_HELD` | a sitting within the window whose agenda we hold no readable text for |
 * | `OUTCOME_NOT_READ` | a concluded sitting within the window whose agenda we hold and for which no recorded decision is held |
 * | `CALENDAR_STALE` | the body's calendar listings were last read longer ago than `CALENDAR_READ_STALE_MS` |
 * | `OUTCOMES_UNREADABLE` | the recorded-outcome store could not be read (a holding failure of ours) |
 * | `MEETINGS_NOT_HELD` | no held meeting names the body at all ({@link meetingsNotHeldGap}) |
 *
 * Ask calls {@link heldBodyGaps} for its gap sentences, and the runner's
 * `ask-gaps` provider calls the same function to create one tracked obligation
 * per body and code. The input is the promoted meetings, agenda documents and
 * recorded outcomes; nothing about a reader or question.
 *
 * PURE: no clock is read (`now` is supplied) and no store is opened.
 */

export {
  ASK_GAP_CODES,
  ASK_GAP_CODE_WORDS,
  ASK_GAP_RECORD_CLASS,
  isAskGapCode,
  type AskGapCode,
  type AskGapRecordClass,
} from "./gap-codes.ts";

/** Days either side of today in which an unread agenda is worth naming, and a concluded sitting's outcome is owed. */
export const UNREAD_LOOKBACK_DAYS = 45;
export const UNREAD_LOOKAHEAD_DAYS = 21;
/** A calendar read older than this is stated with its date. */
export const CALENDAR_READ_STALE_MS = 36 * 3_600_000;

const DAY_MS = 86_400_000;

/** The fields of a held meeting these gaps are decided from. `TopicMeetingLike` satisfies it. */
export interface HeldGapMeetingLike {
  readonly id: string;
  readonly startsAt: string;
  readonly timeZone?: string | null;
  readonly agendaUrl?: string | null;
  readonly status?: string | null;
  readonly provenance?: { readonly collectedAt?: string | null } | null;
}

export interface UnreadSitting {
  readonly meetingId: string;
  readonly startsAt: string;
  readonly localDay: string;
  readonly past: boolean;
}

/** The sitting a gap is about. */
export interface HeldGapSitting extends UnreadSitting {
  /** The publisher's calendar lists an agenda link for it. */
  readonly agendaLinkListed: boolean;
}

/** One gap Ask would state for a body, with its code. */
export interface HeldAskGap {
  readonly code: AskGapCode;
  readonly bodyId: string;
  readonly recordClass: AskGapRecordClass;
  /** The sitting it is about; null for a body-wide gap (a calendar read, the outcome store). */
  readonly sitting: HeldGapSitting | null;
  /** What the gap dates from: the sitting's start, or the calendar read it names; null when it has no date. */
  readonly since: string | null;
}

export interface HeldBodyGaps {
  readonly bodyId: string;
  /** The body's agenda documents that can be one of its sittings' agendas (never a portal shell or another body's notice page). */
  readonly agendaDocuments: readonly AgendaDocumentLike[];
  /** Recent or imminent sittings whose agenda we have not read, oldest first. */
  readonly unreadSittings: readonly UnreadSitting[];
  /** The OLDEST read among the upcoming listings, or with none upcoming the newest read of any. */
  readonly calendarLastReadAt: string | null;
  /** True when {@link calendarLastReadAt} dates the upcoming listings. */
  readonly calendarReadBoundsUpcoming: boolean;
  /** Ask's order: each unread sitting, the calendar read, the outcome store; then each concluded sitting's unread outcome. */
  readonly gaps: readonly HeldAskGap[];
}

/** The body's local calendar day, `YYYY-MM-DD`; the UTC day when the zone cannot be resolved. */
export function bodyLocalDay(startsAt: string, timeZone: string | null | undefined): string {
  try {
    return localDate({ startsAt, timeZone: timeZone ?? null });
  } catch {
    return startsAt.slice(0, 10);
  }
}

/**
 * What the publisher's record says the body did with one item. `OUTCOME_NOT_READ`
 * when no recorded action and no readable disposition is held for it.
 */
export function recordedOutcomeStatus(
  outcome: Pick<PersistedSittingOutcomes["outcomes"][number], "disposition" | "action"> | null,
): "PASSED" | "FAILED" | "ACTED" | "OUTCOME_NOT_READ" {
  if (!outcome) return "OUTCOME_NOT_READ";
  return outcome.disposition === "PASSED" ? "PASSED" : outcome.disposition === "FAILED" ? "FAILED" : outcome.action ? "ACTED" : "OUTCOME_NOT_READ";
}

/**
 * A body's agenda documents that can be one of its sittings' agendas: never
 * another body's notice page, a notice page stating no agenda item, or a
 * portal shell. `documents` must already be scoped to the body.
 */
export function heldAgendaDocuments(documents: readonly AgendaDocumentLike[], bodyId: string): AgendaDocumentLike[] {
  return documents.filter((document) =>
    agendaDocumentRepresentation(document) !== "PUBLICATION_PORTAL" &&
    !isAnotherBodysNoticePage(document.documentUrl, { bodyId, publisher: document.sourceOrg }) &&
    !(isWiredNoticePage(document.documentUrl) && agendaItems(document.text ?? "").length === 0));
}

/**
 * A body we hold no meeting of. {@link heldBodyGaps} never sees one, since
 * callers group held meetings by body; Ask's route and the runner's provider
 * ask this directly.
 */
export function meetingsNotHeldGap(bodyId: string, heldMeetingsOfBody: number): HeldAskGap | null {
  if (heldMeetingsOfBody > 0) return null;
  return { code: "MEETINGS_NOT_HELD", bodyId, recordClass: ASK_GAP_RECORD_CLASS.MEETINGS_NOT_HELD, sitting: null, since: null };
}

/**
 * Every gap Ask would state for ONE body at `now`, from what we hold.
 * `meetings`, `documents` and `sittings` must already be scoped to that body
 * by the caller; this function never widens a scope.
 */
export function heldBodyGaps(input: {
  readonly bodyId: string;
  readonly meetings: readonly HeldGapMeetingLike[];
  readonly documents: readonly AgendaDocumentLike[];
  readonly sittings: readonly PersistedSittingOutcomes[];
  readonly now: number;
  /** True when the recorded-outcome store failed to load; never inferred from an empty body. */
  readonly outcomesUnavailable?: boolean;
}): HeldBodyGaps {
  const { bodyId, now } = input;
  const readDays = new Set<string>();

  // A sitting is read when the publisher's structured agenda for its day is held …
  for (const sitting of input.sittings) {
    if (!sitting.startsAt || !Number.isFinite(Date.parse(sitting.startsAt))) continue;
    if (sitting.agenda.length > 0) readDays.add(sitting.startsAt.slice(0, 10));
    // … or it was read off its minutes, whose recorded actions carry their passages.
    else if (sitting.extraction === "RETRIEVED" && sitting.outcomes.some((outcome) => outcome.quote)) {
      readDays.add(sitting.startsAt.slice(0, 10));
    }
  }
  // … or an agenda document with text is held for one of its meetings.
  const agendaDocuments = heldAgendaDocuments(input.documents, bodyId);
  const byMeeting = new Map(input.meetings.map((meeting) => [meeting.id, meeting]));
  for (const document of agendaDocuments) {
    const meeting = byMeeting.get(document.meetingId);
    if (meeting && document.text && document.text.trim()) readDays.add(bodyLocalDay(meeting.startsAt, meeting.timeZone));
  }

  // Sittings in the recent window whose agenda we have not read — named, never implied empty.
  const unreadByDay = new Map<string, HeldGapSitting>();
  const concludedReadByDay = new Map<string, { sitting: HeldGapSitting; meeting: HeldGapMeetingLike }>();
  for (const meeting of input.meetings) {
    const at = Date.parse(meeting.startsAt);
    if (!Number.isFinite(at)) continue;
    if (meeting.status === "CANCELED") continue;
    if (at < now - UNREAD_LOOKBACK_DAYS * DAY_MS || at > now + UNREAD_LOOKAHEAD_DAYS * DAY_MS) continue;
    const day = bodyLocalDay(meeting.startsAt, meeting.timeZone);
    const sitting: HeldGapSitting = { meetingId: meeting.id, startsAt: meeting.startsAt, localDay: day, past: at < now, agendaLinkListed: Boolean(meeting.agendaUrl) };
    if (!readDays.has(day)) {
      const prior = unreadByDay.get(day);
      if (!prior || meeting.startsAt > prior.startsAt) unreadByDay.set(day, sitting);
    } else if (sitting.past) {
      // A concluded sitting whose agenda we hold: its outcome is owed (below).
      const prior = concludedReadByDay.get(day);
      if (!prior || meeting.startsAt > prior.sitting.startsAt) concludedReadByDay.set(day, { sitting, meeting });
    }
  }
  const unread = [...unreadByDay.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  /*
   * A body read by two routes can be current on one and old on the other, so
   * upcoming listings are dated by the oldest read among them; only with none
   * upcoming is the body dated by its newest read.
   */
  const readOf = (meeting: HeldGapMeetingLike) => {
    const at = meeting.provenance?.collectedAt ?? null;
    return at && Number.isFinite(Date.parse(at)) ? at : null;
  };
  const upcomingReads = input.meetings
    .filter((meeting) => meeting.status !== "CANCELED" && Date.parse(meeting.startsAt) >= now)
    .map(readOf)
    .filter((at): at is string => at !== null)
    .sort();
  const anyReads = input.meetings.map(readOf).filter((at): at is string => at !== null).sort();
  const calendarReadBoundsUpcoming = upcomingReads.length > 0;
  const calendarLastReadAt = calendarReadBoundsUpcoming ? upcomingReads[0]! : (anyReads.at(-1) ?? null);

  const gap = (code: AskGapCode, sitting: HeldGapSitting | null, since: string | null): HeldAskGap =>
    ({ code, bodyId, recordClass: ASK_GAP_RECORD_CLASS[code], sitting, since });
  const gaps: HeldAskGap[] = unread.map((sitting) => gap("AGENDA_NOT_HELD", sitting, sitting.startsAt));
  if (calendarLastReadAt && now - Date.parse(calendarLastReadAt) > CALENDAR_READ_STALE_MS) {
    gaps.push(gap("CALENDAR_STALE", null, calendarLastReadAt));
  }
  if (input.outcomesUnavailable) {
    gaps.push(gap("OUTCOMES_UNREADABLE", null, null));
  } else {
    /*
     * A concluded sitting whose agenda we hold with no recorded decision held
     * (on its structured record or another listing of the same day). With the
     * store unreadable, the gap is the store's instead.
     */
    const decided = (sitting: PersistedSittingOutcomes) =>
      sitting.outcomes.some((outcome) => recordedOutcomeStatus(outcome) !== "OUTCOME_NOT_READ");
    const concluded = [...concludedReadByDay.values()]
      .filter(({ meeting, sitting }) => !input.sittings.some((held) =>
        decided(held) && (held.meetingId === meeting.id || (held.startsAt !== null && [sitting.localDay, meeting.startsAt.slice(0, 10)].includes(held.startsAt.slice(0, 10))))))
      .map(({ sitting }) => sitting)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    for (const sitting of concluded) gaps.push(gap("OUTCOME_NOT_READ", sitting, sitting.startsAt));
  }

  return {
    bodyId,
    agendaDocuments,
    unreadSittings: unread.map(({ meetingId, startsAt, localDay, past }) => ({ meetingId, startsAt, localDay, past })),
    calendarLastReadAt,
    calendarReadBoundsUpcoming,
    gaps,
  };
}
