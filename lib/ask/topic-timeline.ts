import { agendaTopicFor, searchAgendas, type AgendaDocumentLike, type AgendaTopic } from "../routing/agenda-search.ts";
import type { PersistedSittingOutcomes } from "../outcomes/types.ts";
import { formatDateLong } from "../text/format-date.ts";
import { overLengthBudget } from "./length-contract.ts";
import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";
import {
  CALENDAR_READ_STALE_MS,
  bodyLocalDay,
  heldBodyGaps,
  recordedOutcomeStatus,
  type HeldAskGap,
  type UnreadSitting,
} from "./held-gaps.ts";

export {
  CALENDAR_READ_STALE_MS,
  UNREAD_LOOKAHEAD_DAYS,
  UNREAD_LOOKBACK_DAYS,
  type UnreadSitting,
} from "./held-gaps.ts";

/**
 * **A TOPIC QUESTION IS ANSWERED FROM EVERY DATED MENTION, NOT FROM THE NEXT
 * SITTING.** (2026-09-24, the Pima data-center miss.)
 *
 * *"Is Pima County voting on data centers"* was answered by choosing the NEXT
 * Board sitting from the question's tense and handing the synthesis model the
 * topic sweep's quotes as loose context. Three things were wrong with that, and
 * each is a class, not a Pima fact:
 *
 * 1. **The tense chose the evidence.** "Is … voting" read as NEXT, so the
 *    answer led with an unrelated October study session while the sittings that
 *    actually carried the topic sat in the pack as quotes.
 * 2. **A mention was never joined to what the body did with it.** The held
 *    structured outcome record already said the August 11 moratorium item was
 *    acted on and PASSED, with a roll call, and the model — never shown it —
 *    wrote "we have no record of what the Board decided".
 * 3. **A sitting we have not read looked like a sitting where nothing
 *    happened.** The Board's September 22 meeting was on the held calendar with
 *    no agenda read, and nothing in the answer said so.
 *
 * This module builds the TIMELINE for a topic within one bound body: every
 * held agenda line and every held structured agenda item that carries the
 * topic, each dated and each carrying ONE status that the evidence supports —
 *
 * | status | evidence |
 * |---|---|
 * | `SCHEDULED` | on the agenda of a sitting that has not happened yet |
 * | `PASSED` / `FAILED` | the publisher's own recorded disposition for that item |
 * | `ACTED` | a recorded action with no readable disposition — quoted, never read as a result |
 * | `OUTCOME_NOT_READ` | the sitting happened and we hold no recorded action for the item |
 *
 * — plus the sittings in the recent window whose agenda we have not read, so a
 * gap names the exact meeting rather than implying nothing was on it. Nothing
 * here generates a claim: every sentence `composeTopicAnswer` writes quotes a
 * clerk's line, a recorded action, or states a date we hold, and the whole
 * answer passes the same validator a model answer does.
 */

export type TopicEntryStatus = "SCHEDULED" | "PASSED" | "FAILED" | "ACTED" | "OUTCOME_NOT_READ";

export interface TopicMeetingLike {
  readonly id: string;
  readonly bodyName: string;
  readonly title: string;
  readonly startsAt: string;
  readonly timeZone?: string | null;
  readonly agendaUrl?: string | null;
  readonly status?: string | null;
  readonly provenance?: {
    readonly sourceUrl?: string | null;
    readonly sourceOrg?: string | null;
    readonly collectedAt?: string | null;
  } | null;
}

export interface TopicTimelineEntry {
  readonly key: string;
  readonly meetingId: string;
  readonly startsAt: string;
  /** The body's local calendar day, `YYYY-MM-DD`. */
  readonly localDay: string;
  /** The clerk's own words for the item, trimmed; never rewritten. */
  readonly itemText: string;
  readonly agendaNumber: string | null;
  readonly matterFile: string | null;
  readonly status: TopicEntryStatus;
  /** The recorded action, verbatim (`approve as amended`). */
  readonly action: string | null;
  /** The clerk's recorded motion text, verbatim; carries the tally when there is one. */
  readonly tallyText: string | null;
  readonly sourceUrl: string | null;
  readonly sourceOrg: string | null;
  readonly retrievedAt: string | null;
  /** Where the entry came from: the structured agenda record, or a line in a held agenda document. */
  readonly basis: "STRUCTURED_AGENDA_RECORD" | "AGENDA_DOCUMENT_LINE";
}

export interface TopicTimeline {
  readonly topic: AgendaTopic;
  readonly bodyName: string;
  /** The structured outcome store could not be read for this answer (a holding failure). */
  readonly outcomesUnavailable: boolean;
  readonly entries: readonly TopicTimelineEntry[];
  /** Recent or imminent sittings of this body whose agenda we have not read. */
  readonly unreadSittings: readonly UnreadSitting[];
  /**
   * When the body's calendar listings were read: the OLDEST read among its
   * upcoming listings, or, with none upcoming, the newest read of any.
   */
  readonly calendarLastReadAt: string | null;
  /** True when {@link calendarLastReadAt} dates the upcoming listings. */
  readonly calendarReadBoundsUpcoming: boolean;
  readonly records: EvidenceRecord[];
  readonly gaps: EvidenceGap[];
  /**
   * Every gap this body carries, coded, from the ONE decision the standing
   * runner's `ask-gaps` provider also makes (`held-gaps.ts`). `gaps` states
   * all but `OUTCOME_NOT_READ`, which each concluded entry states in its own
   * sentence.
   */
  readonly heldGaps: readonly HeldAskGap[];
  readonly denominators: Record<string, number>;
}

/**
 * Is this a question about a TOPIC across a body's business, rather than about
 * one sitting? A topic question names a curated topic and does not point at one
 * meeting ("the next meeting", "tonight's agenda", "last week's session"). A
 * question that does point at one sitting keeps the ordinary sitting selection.
 */
export function topicFocusedQuestion(question: string): AgendaTopic | null {
  const topic = agendaTopicFor(question);
  if (!topic) return null;
  const onePointedSitting =
    /\b(?:next|upcoming|last|previous|prior|most recent|latest|this week'?s|last week'?s|tonight'?s|today'?s|tomorrow'?s)\s+(?:[\w'.&-]+\s+){0,6}?(?:meeting|sitting|session|agenda|hearing)\b/i;
  return onePointedSitting.test(question) ? null : topic;
}

function matchesTopic(text: string, topic: AgendaTopic): boolean {
  const lower = text.toLowerCase();
  return topic.phrases.some((phrase) => lower.includes(phrase));
}

/** The first line of a clerk's item title — the item's own name. */
function firstLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? text.trim();
}

/**
 * Quote safely inside a sentence budget: collapse whitespace, stop at the
 * clerk's first sentence end so a quoted "NO. 2026" cannot be counted as two of
 * our sentences, and mark any cut with an ellipsis rather than pretending the
 * fragment is the whole.
 */
export function quotable(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, " ").trim().replace(/[.;:,]+$/, "");
  // A clerk's leading item number ("3. ", "B. ") is part of the line, not its end.
  const enumerator = /^(?:\d{1,3}|[A-Z])[.)]\s+/.exec(flat)?.[0].length ?? 0;
  const inner = flat.slice(enumerator).search(/[.!?]\s/);
  const boundary = inner >= 0 ? inner + enumerator : -1;
  let out = boundary >= 0 ? `${flat.slice(0, boundary)}…` : flat;
  if (out.length > maxChars) out = `${out.slice(0, maxChars).replace(/\s+\S*$/, "")}…`;
  return out;
}

/**
 * The part of a clerk's line that carries the topic. A document line can run
 * several items together ("9. … O-26-25 … ADA IMPROVEMENTS … 10. … O-26-23 …
 * DESIGNATE DATA CENTERS AS A PROHIBITED USE"), and cutting it from the front
 * quoted the wrong ordinance to a reader asking about data centers. The window
 * starts at the last item number before the phrase when one is close enough,
 * otherwise a little before the phrase, and every cut is marked with an
 * ellipsis. The words are the clerk's; only the window is ours.
 */
export function topicWindow(text: string, topic: AgendaTopic, maxChars = 260): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  let at = -1;
  let phraseEnd = -1;
  for (const phrase of topic.phrases) {
    const index = lower.indexOf(phrase);
    if (index >= 0 && (at < 0 || index < at)) {
      at = index;
      phraseEnd = index + phrase.length;
    }
  }
  if (at < 0) return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars).replace(/\s+\S*$/, "")}…`;
  // Where this item starts: the last item number, or an item's own file
  // number ("O-26-23"), before the phrase — when it is within reach.
  const reach = Math.max(0, at - (maxChars - 60));
  const starts = [...flat.slice(reach, at).matchAll(/(?:^|\s)(?:\d{1,3}\.\s+[A-Z(]|[A-Z]{1,3}-\d{2}-\d{2,3}\s)/g)];
  let start: number;
  if (starts.length > 0) {
    const last = starts[starts.length - 1]!;
    start = reach + (last.index ?? 0) + (last[0].startsWith(" ") ? 1 : 0);
    // A file number directly under its item heading ("10. ORDINANCE(S) FOR
    // ADOPTION: O-26-23 …") starts at the heading: it says what stage the item is at.
    const heading = [...flat.slice(Math.max(0, start - 60), start).matchAll(/(?:^|\s)\d{1,3}\.\s+[A-Z(]/g)].at(-1);
    if (heading && /^[A-Z]{1,3}-\d/.test(flat.slice(start))) {
      start = Math.max(0, start - 60) + (heading.index ?? 0) + (heading[0].startsWith(" ") ? 1 : 0);
    }
  } else if (flat.length <= maxChars) {
    start = 0;
  } else {
    start = Math.max(0, at - 90);
    const space = flat.indexOf(" ", start);
    if (start > 0 && space >= 0 && space < at) start = space + 1;
  }
  // Where it ends: the next item number, the next item's file number, or a
  // page footer after the phrase — whichever comes first — within the budget.
  const tail = flat.slice(phraseEnd);
  const boundary = tail.search(/\s(?:\d{1,3}\.\s+[A-Z(]|[A-Z]{1,3}-\d{2}-\d{2,3}\b|Agenda Page\b|Page \d+ of \d+\b)/);
  let end = Math.min(flat.length, start + maxChars, boundary >= 0 ? phraseEnd + boundary : flat.length);
  if (end < flat.length && (boundary < 0 || end < phraseEnd + boundary)) {
    const space = flat.lastIndexOf(" ", end);
    if (space > at) end = space;
  }
  const cutBefore = start > 0;
  const cutAfter = end < flat.length;
  return `${cutBefore ? "…" : ""}${flat.slice(start, end).trim()}${cutAfter ? "…" : ""}`;
}

/** The last motion in a clerk's multi-motion text is the one that disposed of the item. */
function finalMotion(text: string): string {
  const parts = text.split(/\s*(?=Motion\s+\d+\s*:)/i).map((part) => part.trim()).filter(Boolean);
  const last = parts.at(-1) ?? text;
  return last.replace(/^Motion\s+\d+\s*:\s*/i, "");
}

/**
 * The sentence of the clerk's text that carries the result — the one with a
 * tally ("3-2") or "unanimous" — quoted whole. Null when no sentence carries
 * one: the mover-and-seconder sentence alone says nothing about the result.
 */
export function tallyClause(text: string | null): string | null {
  if (!text) return null;
  const motion = finalMotion(text).replace(/\s+/g, " ").trim();
  const sentences = motion.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  const carrying = sentences.find((part) => /\b\d{1,2}\s*[-–]\s*\d{1,2}\b|\bunanimous/i.test(part));
  return carrying ? carrying.replace(/[.;:,]+$/, "") : null;
}

/**
 * Is the topic the item's own subject? The phrase must sit near the start of
 * the item's first line. "Moratorium on Data Center Development" is about data
 * centers; a fire district's contract "for data center racks and GIS services"
 * mentions the phrase 140 characters in and is about something else. A
 * non-salient entry stays in the evidence the reader is shown; it never leads
 * the composed prose.
 */
export function salientEntry(entry: Pick<TopicTimelineEntry, "itemText">, topic: AgendaTopic): boolean {
  const head = firstLine(entry.itemText).toLowerCase();
  return topic.phrases.some((phrase) => {
    const at = head.indexOf(phrase);
    return at >= 0 && at <= 80;
  });
}

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

const dayOf = bodyLocalDay;

function statusFor(sitting: PersistedSittingOutcomes, eventItemId: number, now: number): {
  status: TopicEntryStatus;
  action: string | null;
  tallyText: string | null;
} {
  if (!sitting.startsAt || Date.parse(sitting.startsAt) >= now) return { status: "SCHEDULED", action: null, tallyText: null };
  const outcome = sitting.outcomes.find((row) => row.eventItemId === eventItemId) ?? null;
  if (!outcome) return { status: "OUTCOME_NOT_READ", action: null, tallyText: null };
  return { status: recordedOutcomeStatus(outcome), action: outcome.action, tallyText: outcome.tallyText };
}

/**
 * Build the timeline for one bound body. `meetings`, `documents` and
 * `sittings` must already be scoped to that body by the caller; this function
 * never widens a scope.
 */
export function buildTopicTimeline(input: {
  readonly topic: AgendaTopic;
  readonly bodyId: string;
  readonly bodyName: string;
  readonly meetings: readonly TopicMeetingLike[];
  readonly documents: readonly AgendaDocumentLike[];
  readonly sittings: readonly PersistedSittingOutcomes[];
  readonly now: number;
  /** True when the recorded-outcome store failed to load; never inferred from an empty body. */
  readonly outcomesUnavailable?: boolean;
}): TopicTimeline {
  const { topic, now } = input;
  const entries: TopicTimelineEntry[] = [];
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const structuredDays = new Set<string>();
  // What we hold and do not hold for this body, decided once (held-gaps.ts):
  // the sittings read, the agendas that can be searched, and every coded gap.
  const held = heldBodyGaps({
    bodyId: input.bodyId,
    meetings: input.meetings,
    documents: input.documents,
    sittings: input.sittings,
    now,
    outcomesUnavailable: input.outcomesUnavailable,
  });

  // 1. The publisher's structured agenda records, joined to their recorded outcome.
  for (const sitting of input.sittings) {
    if (!sitting.startsAt || !Number.isFinite(Date.parse(sitting.startsAt))) continue;
    const day = sitting.startsAt.slice(0, 10);
    for (const item of sitting.agenda) {
      if (!matchesTopic(item.title, topic)) continue;
      structuredDays.add(day);
      const { status, action, tallyText } = statusFor(sitting, item.eventItemId, now);
      const sourceUrl = sitting.sourceUrl ?? item.provenance.endpoint ?? null;
      const retrievedAt = item.provenance.readOn === "NEVER_READ" ? null : item.provenance.readOn;
      const itemText = firstLine(item.title);
      entries.push({
        key: `${sitting.meetingId}#${item.eventItemId}`,
        meetingId: sitting.meetingId,
        startsAt: sitting.startsAt,
        localDay: day,
        itemText,
        agendaNumber: item.agendaNumber?.replace(/\.$/, "") ?? null,
        matterFile: item.matterFile,
        status,
        action,
        tallyText,
        sourceUrl,
        sourceOrg: sitting.sourceOrg,
        retrievedAt,
        basis: "STRUCTURED_AGENDA_RECORD",
      });
      records.push({
        kind: "AGENDA_ITEM",
        id: `${item.eventItemId}#agenda`,
        bodyId: input.bodyId,
        meetingId: sitting.meetingId,
        text: `${item.agendaNumber ? `Item ${item.agendaNumber.replace(/\.$/, "")}: ` : ""}${itemText}${item.matterFile ? ` (${item.matterFile})` : ""}`,
        occurredAt: sitting.startsAt,
        sourceUrl,
        sourceOrg: sitting.sourceOrg,
        retrievedAt,
      });
      if (status === "PASSED" || status === "FAILED" || status === "ACTED") {
        records.push({
          kind: "MEETING_ACTION",
          id: `${item.eventItemId}#action`,
          bodyId: input.bodyId,
          meetingId: sitting.meetingId,
          text: [
            action ? `The recorded action was "${action}".` : null,
            status === "PASSED" ? "The item is recorded as passed." : status === "FAILED" ? "The item is recorded as failed." : null,
            tallyText ? `The clerk recorded: "${tallyText.replace(/\s+/g, " ").trim()}"` : null,
          ].filter(Boolean).join(" "),
          occurredAt: sitting.startsAt,
          sourceUrl,
          sourceOrg: sitting.sourceOrg,
          retrievedAt,
        });
      }
    }
  }

  // 2. Lines in held agenda documents, for sittings the structured records did not cover.
  // A body's notice page is never one of its sittings' agendas (D1, 2026-09-24):
  // another body's page, or a notice page that states no agenda item, is not
  // searched, not counted among the agendas held, and does not make a sitting
  // read. CAP's meetings page held for Pima's Oct 13 study session is both.
  // Nor is a publisher portal's shell, which the publication reading already
  // names as a portal: Newbury Selectboard's nine held pages (four CivicWeb
  // shells, five copies of Bradford's calendar) were answered as "the 9
  // agendas we hold" beside a gap saying none of them was readable. The one
  // filter is `heldAgendaDocuments` (held-gaps.ts).
  const documents = held.agendaDocuments;
  const byMeeting = new Map(input.meetings.map((meeting) => [meeting.id, meeting]));
  const { hits, searched, unreadable } = searchAgendas(documents, topic);
  // Each occurrence is windowed from the FULL agenda text: the sweep's quote is
  // capped at 400 characters and, on a line that runs items together, can end
  // before the phrase it matched. Versions of one agenda collapse by content.
  const seenWindow = new Set<string>();
  const newestFirst = [...documents].sort((a, b) => String(b.retrievedAt).localeCompare(String(a.retrievedAt)));
  for (const document of newestFirst) {
    if (!document.text || hits.every((hit) => hit.documentUrl !== document.documentUrl || hit.meetingId !== document.meetingId)) continue;
    const meeting = byMeeting.get(document.meetingId);
    if (!meeting) continue;
    const day = dayOf(meeting.startsAt, meeting.timeZone);
    if (structuredDays.has(day)) continue;
    const flat = document.text.replace(/\s+/g, " ");
    const lower = flat.toLowerCase();
    const occurrences: number[] = [];
    for (const phrase of topic.phrases) {
      for (let index = lower.indexOf(phrase); index >= 0; index = lower.indexOf(phrase, index + phrase.length)) {
        if (!occurrences.some((seen) => Math.abs(seen - index) < 250)) occurrences.push(index);
      }
    }
    for (const index of occurrences.sort((a, b) => a - b)) {
      const window = topicWindow(flat.slice(Math.max(0, index - 300), index + 300), topic);
      const identity = `${day}#${window.replace(/^…/, "").slice(0, 120).toLowerCase()}`;
      if (seenWindow.has(identity)) continue;
      seenWindow.add(identity);
      entries.push({
        key: `${meeting.id}#${index}`,
        meetingId: meeting.id,
        startsAt: meeting.startsAt,
        localDay: day,
        itemText: window,
        agendaNumber: null,
        matterFile: null,
        status: Date.parse(meeting.startsAt) >= now ? "SCHEDULED" : "OUTCOME_NOT_READ",
        action: null,
        tallyText: null,
        sourceUrl: meeting.agendaUrl ?? document.documentUrl,
        sourceOrg: document.sourceOrg,
        retrievedAt: document.retrievedAt,
        basis: "AGENDA_DOCUMENT_LINE",
      });
    }
  }
  entries.sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  // 3. Sittings in the recent window whose agenda we have not read — named, never implied empty —
  // and the other gaps this body carries, each stated with its code (held-gaps.ts decides them).
  const { unreadSittings, calendarLastReadAt, calendarReadBoundsUpcoming } = held;
  for (const gap of held.gaps) {
    const coded = { code: gap.code, bodyId: gap.bodyId, recordClass: gap.recordClass };
    switch (gap.code) {
      case "AGENDA_NOT_HELD": {
        const sitting = gap.sitting!;
        const spelled = formatDateLong(sitting.localDay) ?? sitting.localDay;
        gaps.push({
          whose: "OURS",
          statement: sitting.past
            ? `We have not read the agenda of the ${input.bodyName} meeting held ${spelled}, so this answer cannot say whether ${topic.label} was on it.`
            : `The ${input.bodyName} meets next on ${spelled}; we do not yet hold an agenda for that meeting.`,
          ...coded,
        });
        break;
      }
      case "CALENDAR_STALE": {
        const readDay = formatDateLong(gap.since!.slice(0, 10)) ?? gap.since!.slice(0, 10);
        gaps.push({
          whose: "OURS",
          statement: calendarReadBoundsUpcoming
            ? `The upcoming ${input.bodyName} meetings in this answer were last read from its calendar on ${readDay}; anything posted since then is not in this answer yet.`
            : `Our most recent read of the ${input.bodyName} meeting calendar was ${readDay}; anything posted since then is not in this answer yet.`,
          ...coded,
        });
        break;
      }
      case "OUTCOMES_UNREADABLE":
        gaps.push({
          whose: "OURS",
          statement: "The recorded actions and votes we hold could not be read for this answer. This is a failure of our holding, not evidence that the body took no action.",
          ...coded,
        });
        break;
      case "OUTCOME_NOT_READ":
        // Stated in each concluded entry's own sentence ("we have not read the recorded outcome of that item").
        break;
    }
  }

  const count = (status: TopicEntryStatus) => entries.filter((entry) => entry.status === status).length;
  const denominators: Record<string, number> = {
    topicTimelineEntries: entries.length,
    topicStructuredAgendaItems: entries.filter((entry) => entry.basis === "STRUCTURED_AGENDA_RECORD").length,
    topicAgendaDocumentLines: entries.filter((entry) => entry.basis === "AGENDA_DOCUMENT_LINE").length,
    topicItemsScheduled: count("SCHEDULED"),
    topicItemsPassed: count("PASSED"),
    topicItemsFailed: count("FAILED"),
    topicItemsActedWithoutDisposition: count("ACTED"),
    topicItemsOutcomeNotRead: count("OUTCOME_NOT_READ"),
    topicOutcomeSittingsHeld: input.sittings.length,
    topicAgendaDocumentsSearched: searched,
    topicAgendaDocumentsUnreadable: unreadable,
    topicSittingsWithUnreadAgenda: unreadSittings.length,
  };

  return { topic, bodyName: input.bodyName, outcomesUnavailable: Boolean(input.outcomesUnavailable), entries, unreadSittings, calendarLastReadAt, calendarReadBoundsUpcoming, records, gaps, heldGaps: held.gaps, denominators };
}

function spelledDay(entry: Pick<TopicTimelineEntry, "localDay">): string {
  return formatDateLong(entry.localDay) ?? entry.localDay;
}

function itemPhrase(entry: TopicTimelineEntry): string {
  const label = entry.agendaNumber ? `agenda item ${entry.agendaNumber}` : "an agenda item";
  const file = entry.matterFile ? ` (${entry.matterFile})` : "";
  // A document line is already windowed on the topic (topicWindow); a
  // structured title is quoted to its first sentence.
  const quote = entry.basis === "AGENDA_DOCUMENT_LINE" ? entry.itemText : quotable(entry.itemText, 150);
  return `${label}${file}, "${quote}"`;
}

function entrySentence(entry: TopicTimelineEntry, bodyName: string, lead: boolean, outcomesUnavailable = false): string {
  const day = spelledDay(entry);
  const subject = lead ? `the ${bodyName}` : "the board";
  switch (entry.status) {
    case "PASSED":
    case "FAILED": {
      const verdict = entry.status === "PASSED" ? "passed" : "failed";
      const action = entry.action ? ` (recorded action: "${quotable(entry.action, 60)}")` : "";
      const tally = tallyClause(entry.tallyText);
      return `On ${day}, ${subject} ${verdict} ${itemPhrase(entry)}${action}${tally ? `; the clerk recorded "${quotable(tally, 170)}"` : ""}`;
    }
    case "ACTED":
      return `On ${day}, ${subject} acted on ${itemPhrase(entry)}; the recorded action was "${quotable(entry.action ?? "", 60)}"`;
    case "SCHEDULED":
      return `${lead ? `The ${bodyName} has` : "The board has"} ${itemPhrase(entry)} on its agenda for ${day}`;
    case "OUTCOME_NOT_READ":
      return `${itemPhrase(entry).replace(/^./, (c) => c.toUpperCase())} was on ${lead ? `the ${possessive(bodyName)}` : "the board's"} agenda for ${day}; ${outcomesUnavailable ? "the recorded outcomes could not be read for this answer" : "we have not read the recorded outcome of that item"}`;
  }
}

const DECISIVE: readonly TopicEntryStatus[] = ["PASSED", "FAILED", "ACTED"];

/**
 * Compose the answer from the timeline, in plain language, inside the one
 * length contract. Returns null when there is nothing the timeline can say
 * (no entry and no named sitting), so the caller falls through to its ordinary
 * path rather than shipping an empty sentence.
 *
 * Order: the most recent decision; the next scheduled appearance; one earlier
 * appearance; then the sittings we have not read and how old our calendar read
 * is. Each sentence is added only while the whole stays inside the contract.
 */
export function composeTopicAnswer(timeline: TopicTimeline, now: number): { answer: string; citedUrls: string[] } | null {
  const sentences: string[] = [];
  const cited: string[] = [];
  const used = new Set<string>();
  const fits = (next: readonly string[]) => overLengthBudget(`${next.join(". ")}.`) === null;
  const add = (sentence: string, entry?: TopicTimelineEntry): boolean => {
    const candidate = [...sentences, sentence.replace(/[.\s]+$/, "")];
    if (!fits(candidate)) return false;
    sentences.push(sentence.replace(/[.\s]+$/, ""));
    if (entry) {
      used.add(entry.key);
      if (entry.sourceUrl && !cited.includes(entry.sourceUrl)) cited.push(entry.sourceUrl);
    }
    return true;
  };

  const salient = timeline.entries.filter((entry) => salientEntry(entry, timeline.topic));
  const pool = salient.length > 0 ? salient : timeline.entries;
  const past = pool.filter((entry) => Date.parse(entry.startsAt) < now);
  const upcoming = pool.filter((entry) => Date.parse(entry.startsAt) >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const decisive = past.filter((entry) => DECISIVE.includes(entry.status));
  const newestPast = past[0] ?? null;
  const lead = decisive[0] && (!newestPast || decisive[0].localDay >= newestPast.localDay) ? decisive[0] : newestPast ?? upcoming[0] ?? null;

  if (!lead) {
    // Nothing held carries the topic: say what was searched, in the sweep's
    // own words (lib/ask/agenda-topic.ts), so a reader never reads silence as
    // "no". The unread-sitting sentence below says what the search could not see.
    const searched = timeline.denominators.topicAgendaDocumentsSearched ?? 0;
    add(searched > 0
      ? `No mention of ${timeline.topic.label} in the ${searched} agenda${searched === 1 ? "" : "s"} we hold for ${timeline.bodyName}`
      : `We don't hold any readable agendas for ${timeline.bodyName} yet, so nothing was searched for ${timeline.topic.label}`);
  }
  if (lead && !add(entrySentence(lead, timeline.bodyName, true, timeline.outcomesUnavailable), lead)) {
    // The lead is the answer; a long clerk's line is shortened, never dropped.
    add(entrySentence({ ...lead, itemText: quotable(lead.itemText, 110), basis: "STRUCTURED_AGENDA_RECORD" }, timeline.bodyName, true, timeline.outcomesUnavailable), lead);
  }
  const nextUp = upcoming.find((entry) => !used.has(entry.key));
  if (nextUp) add(entrySentence(nextUp, timeline.bodyName, !lead, timeline.outcomesUnavailable), nextUp);
  const earlier = past.find((entry) => !used.has(entry.key) && entry.localDay !== lead?.localDay);
  if (earlier) add(`Earlier, ${entrySentence(earlier, timeline.bodyName, false, timeline.outcomesUnavailable).replace(/^./, (c) => c.toLowerCase())}`, earlier);

  // Only the sittings that could change the answer: after the newest held mention.
  const newestDay = timeline.entries[0]?.localDay ?? "";
  const unread = timeline.unreadSittings.filter((sitting) => sitting.localDay > newestDay);
  const unreadPast = unread.filter((sitting) => sitting.past);
  const unreadNext = unread.filter((sitting) => !sitting.past);
  if (unreadPast.length > 0) {
    const days = unreadPast.slice(-2).map((sitting) => formatDateLong(sitting.localDay) ?? sitting.localDay);
    add(`We have not read the agenda of the ${days.length > 1 ? `${days.join(" and ")} meetings` : `${days[0]} meeting`} yet, so ${days.length > 1 ? "they are" : "it is"} not reflected here`);
  } else if (unreadNext.length > 0 && !nextUp) {
    add(`The next meeting is ${formatDateLong(unreadNext[0].localDay) ?? unreadNext[0].localDay}; we do not yet hold an agenda for it`);
  }
  if (timeline.calendarLastReadAt && now - Date.parse(timeline.calendarLastReadAt) > CALENDAR_READ_STALE_MS) {
    const readDay = formatDateLong(timeline.calendarLastReadAt.slice(0, 10)) ?? timeline.calendarLastReadAt.slice(0, 10);
    add(timeline.calendarReadBoundsUpcoming
      ? `The board's upcoming meetings shown here were last read from its calendar on ${readDay}`
      : `Our most recent read of the board's calendar was ${readDay}`);
  }

  if (sentences.length === 0) return null;
  return { answer: `${sentences.join(". ")}.`, citedUrls: cited };
}

/**
 * **A TOPIC QUESTION ABOUT THE READER'S AREA.** (2026-09-24.)
 *
 * *"Is there a data center coming?"* names no government. The reader's area
 * holds several bodies, and each gets its own timeline — never a merged one,
 * because a Board of Supervisors' vote is not a school board's agenda item.
 * The answer leads with the most recent recorded decision anywhere in the
 * area, then the next scheduled appearance, then one more body's most recent
 * mention; every sentence names the body it is about. Bodies with nothing on
 * the topic are counted, not listed.
 */
export function composeAreaTopicAnswer(
  timelines: readonly TopicTimeline[],
  now: number,
): { answer: string; citedUrls: string[] } | null {
  if (timelines.length === 0) return null;
  const topic = timelines[0]!.topic;
  const tagged = timelines.flatMap((timeline) =>
    timeline.entries
      .filter((entry) => salientEntry(entry, topic) || !timeline.entries.some((other) => salientEntry(other, topic)))
      .map((entry) => ({ entry, timeline })));
  const sentences: string[] = [];
  const cited: string[] = [];
  const usedBodies = new Set<string>();
  const add = (sentence: string, entry: TopicTimelineEntry, timeline: TopicTimeline): void => {
    const candidate = [...sentences, sentence.replace(/[.\s]+$/, "")];
    if (overLengthBudget(`${candidate.join(". ")}.`) !== null) return;
    sentences.push(sentence.replace(/[.\s]+$/, ""));
    usedBodies.add(timeline.bodyName);
    if (entry.sourceUrl && !cited.includes(entry.sourceUrl)) cited.push(entry.sourceUrl);
  };
  const past = tagged.filter(({ entry }) => Date.parse(entry.startsAt) < now).sort((a, b) => b.entry.startsAt.localeCompare(a.entry.startsAt));
  const upcoming = tagged.filter(({ entry }) => Date.parse(entry.startsAt) >= now).sort((a, b) => a.entry.startsAt.localeCompare(b.entry.startsAt));
  const decisive = past.find(({ entry }) => DECISIVE.includes(entry.status));
  const lead = decisive ?? past[0] ?? upcoming[0] ?? null;
  if (!lead) {
    const searched = timelines.reduce((total, timeline) => total + (timeline.denominators.topicAgendaDocumentsSearched ?? 0), 0);
    return {
      answer: searched > 0
        ? `No mention of ${topic.label} in the ${searched} agenda${searched === 1 ? "" : "s"} we hold for the ${timelines.length} bod${timelines.length === 1 ? "y" : "ies"} that govern your area.`
        : `We don't hold any readable agendas for your area yet, so nothing was searched for ${topic.label}.`,
      citedUrls: [],
    };
  }
  add(entrySentence(lead.entry, lead.timeline.bodyName, true, lead.timeline.outcomesUnavailable), lead.entry, lead.timeline);
  const next = upcoming.find(({ entry }) => entry.key !== lead.entry.key);
  if (next) add(entrySentence(next.entry, next.timeline.bodyName, true, next.timeline.outcomesUnavailable), next.entry, next.timeline);
  // The lead body's own sittings after its newest mention whose agenda we have
  // not read: the September 22 case, named rather than implied empty.
  const unread = lead.timeline.unreadSittings.filter((sitting) => sitting.past && sitting.localDay > (lead.timeline.entries[0]?.localDay ?? ""));
  if (unread.length > 0) {
    const days = unread.slice(-2).map((sitting) => formatDateLong(sitting.localDay) ?? sitting.localDay);
    add(`We have not read the ${lead.timeline.bodyName} agenda${days.length > 1 ? "s" : ""} for ${days.join(" and ")} yet, so ${days.length > 1 ? "they are" : "it is"} not reflected here`, lead.entry, lead.timeline);
  }
  const other = past.find(({ entry, timeline }) => entry.key !== lead.entry.key && !usedBodies.has(timeline.bodyName));
  if (other) add(`Also, ${entrySentence(other.entry, other.timeline.bodyName, true, other.timeline.outcomesUnavailable).replace(/^./, (c) => c.toLowerCase())}`, other.entry, other.timeline);
  const quiet = timelines.filter((timeline) => timeline.entries.length === 0).length;
  if (quiet > 0 && sentences.length > 0) {
    const sentence = `No mention of ${topic.label} in the agendas we hold for the other ${quiet} bod${quiet === 1 ? "y" : "ies"} that govern your area`;
    const candidate = [...sentences, sentence];
    if (overLengthBudget(`${candidate.join(". ")}.`) === null) sentences.push(sentence);
  }
  return sentences.length > 0 ? { answer: `${sentences.join(". ")}.`, citedUrls: cited } : null;
}
