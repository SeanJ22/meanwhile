import { agendaItems, type AgendaDocumentLike } from "../routing/agenda-search.ts";
import { isAnotherBodysNoticePage, isWiredNoticePage } from "../meetings/notice-pages.ts";
import type { PersistedSittingOutcomes } from "../outcomes/types.ts";
import { agendaDocumentRepresentation } from "./agenda-publication.ts";
import { ASK_GAP_RECORD_CLASS, type AskGapCode, type AskGapRecordClass } from "./gap-codes.ts";
import { localDate } from "./meeting-time.ts";

/**
 * **THE GAPS ASK STATES ABOUT ONE BODY, AS CODES — ONE IMPLEMENTATION.**
 * (2026-09-25. The owner's civic accuracy brief: "A discrepancy must create
 * tracked acquisition work that flows through publication", and "Say 'still
 * looking' only when real work exists.")
 *
 * Ask's topic timeline (`topic-timeline.ts`) tells a reader what we do NOT
 * hold for a body: a recent sitting whose agenda we have not read, a calendar
 * read that is days old, a recorded-outcome store that could not be read, and
 * — in the prose of each concluded agenda line — an outcome we have not read.
 * Those sentences had no machine-readable identity, so nothing downstream
 * could turn them into work. This module is the ONE place those gaps are
 * decided, from what we HOLD, and it gives each a closed code:
 *
 * | code | decided from |
 * |---|---|
 * | `AGENDA_NOT_HELD` | a sitting within the window whose agenda we hold no readable text for |
 * | `OUTCOME_NOT_READ` | a concluded sitting within the window whose agenda we hold and for which no recorded decision is held |
 * | `CALENDAR_STALE` | the body's calendar listings were last read longer ago than `CALENDAR_READ_STALE_MS` |
 * | `OUTCOMES_UNREADABLE` | the recorded-outcome store could not be read (a holding failure of ours) |
 * | `MEETINGS_NOT_HELD` | no held meeting names the body at all ({@link meetingsNotHeldGap}) |
 *
 * Ask calls {@link heldBodyGaps} to write its gap sentences (the wording is
 * the timeline's and is unchanged), and the standing runner's `ask-gaps`
 * provider calls the SAME function over the same held projections to create
 * one tracked obligation per body and code (RULING 103: one rule, never a
 * second copy). Nothing here reads a reader, a question, or a log: the input
 * is the promoted meetings, their agenda documents and the recorded outcomes.
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
 * A body's notice page is never one of its sittings' agendas (D1, 2026-09-24):
 * another body's page, or a notice page that states no agenda item, is not
 * searched, not counted among the agendas held, and does not make a sitting
 * read. Nor is a publisher portal's shell, which the publication reading
 * already names as a portal. `documents` must already be scoped to the body.
 */
export function heldAgendaDocuments(documents: readonly AgendaDocumentLike[], bodyId: string): AgendaDocumentLike[] {
  return documents.filter((document) =>
    agendaDocumentRepresentation(document) !== "PUBLICATION_PORTAL" &&
    !isAnotherBodysNoticePage(document.documentUrl, { bodyId, publisher: document.sourceOrg }) &&
    !(isWiredNoticePage(document.documentUrl) && agendaItems(document.text ?? "").length === 0));
}

/**
 * **A BODY WE HOLD NO MEETING OF.** (2026-09-25.) Ask states "We have not
 * recorded any meetings for …" when the held meetings name the body not once.
 * {@link heldBodyGaps} never sees such a body — its callers group the held
 * meetings by body — so this is the rule on its own: Ask's route codes the
 * sentence with it, and the runner's `ask-gaps` provider asks it again of a
 * body a reader was told this about, to know whether the gap is still open.
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
    // … or it was read off its MINUTES (NH332): minutes list every item the body
    // reached, so a sitting whose recorded actions carry their passages is read.
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
   * **THE READ THAT BOUNDS WHAT IS COMING.** (2026-09-24.) A body read by two
   * routes can be current on one and weeks old on the other. At 85701 the
   * Pima Board's API route was read at 11:14Z and carries no upcoming
   * sitting, while every upcoming sitting shown came from the portal's
   * September 8 read. Dating the body by its newest read of ANY row hid that.
   * The upcoming listings are therefore dated by the OLDEST read among them.
   * Only when none is upcoming is the body dated by its newest read.
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
     * A concluded sitting whose agenda we hold and for which no recorded
     * decision is held: every agenda line of it that a reader asks about is
     * answered "we have not read the recorded outcome of that item". The
     * decision may be held on the publisher's structured record for that
     * meeting or for another listing of the same day. With the store
     * unreadable this is not decidable, and the gap is the store's instead.
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
