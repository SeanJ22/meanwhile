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
  readonly itemText: string;
  readonly agendaNumber: string | null;
  readonly matterFile: string | null;
  readonly status: TopicEntryStatus;
  readonly action: string | null;
  readonly tallyText: string | null;
  readonly sourceUrl: string | null;
  readonly sourceOrg: string | null;
  readonly retrievedAt: string | null;
  readonly basis: "STRUCTURED_AGENDA_RECORD" | "AGENDA_DOCUMENT_LINE" | "MINUTES_RECORD";
}

export interface TopicTimeline {
  readonly topic: AgendaTopic;
  readonly bodyName: string;
  readonly outcomesUnavailable: boolean;
  readonly entries: readonly TopicTimelineEntry[];
  readonly unreadSittings: readonly UnreadSitting[];
  readonly calendarLastReadAt: string | null;
  readonly calendarReadBoundsUpcoming: boolean;
  readonly records: EvidenceRecord[];
  readonly gaps: EvidenceGap[];
  readonly heldGaps: readonly HeldAskGap[];
  readonly denominators: Record<string, number>;
}

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

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? text.trim();
}

export function quotable(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, " ").trim().replace(/[.;:,]+$/, "");
  const enumerator = /^(?:\d{1,3}|[A-Z])[.)]\s+/.exec(flat)?.[0].length ?? 0;
  const inner = flat.slice(enumerator).search(/[.!?]\s/);
  const boundary = inner >= 0 ? inner + enumerator : -1;
  let out = boundary >= 0 ? `${flat.slice(0, boundary)}…` : flat;
  if (out.length > maxChars) out = `${out.slice(0, maxChars).replace(/\s+\S*$/, "")}…`;
  return out;
}

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
  const reach = Math.max(0, at - (maxChars - 60));
  const starts = [...flat.slice(reach, at).matchAll(/(?:^|\s)(?:\d{1,3}\.\s+[A-Z(]|[A-Z]{1,3}-\d{2}-\d{2,3}\s)/g)];
  let start: number;
  if (starts.length > 0) {
    const last = starts[starts.length - 1]!;
    start = reach + (last.index ?? 0) + (last[0].startsWith(" ") ? 1 : 0);
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

function finalMotion(text: string): string {
  const parts = text.split(/\s*(?=Motion\s+\d+\s*:)/i).map((part) => part.trim()).filter(Boolean);
  const last = parts.at(-1) ?? text;
  return last.replace(/^Motion\s+\d+\s*:\s*/i, "");
}

export function tallyClause(text: string | null): string | null {
  if (!text) return null;
  const motion = finalMotion(text).replace(/\s+/g, " ").trim();
  const sentences = motion.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  const carrying = sentences.find((part) => /\b\d{1,2}\s*[-–]\s*\d{1,2}\b|\bunanimous/i.test(part));
  return carrying ? carrying.replace(/[.;:,]+$/, "") : null;
}

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
  const held = heldBodyGaps({
    bodyId: input.bodyId,
    meetings: input.meetings,
    documents: input.documents,
    sittings: input.sittings,
    now,
    outcomesUnavailable: input.outcomesUnavailable,
  });

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

    if (sitting.agenda.length > 0 || sitting.extraction !== "RETRIEVED") continue;
    for (const outcome of sitting.outcomes) {
      if (!outcome.quote || !outcome.itemQuote || !matchesTopic(outcome.itemQuote, topic)) continue;
      structuredDays.add(day);
      const past = Date.parse(sitting.startsAt) < now;
      const status: TopicEntryStatus = !past
        ? "SCHEDULED"
        : outcome.disposition === "PASSED" ? "PASSED" : outcome.disposition === "FAILED" ? "FAILED" : "ACTED";
      const sourceUrl = outcome.provenance.endpoint || sitting.sourceUrl;
      const retrievedAt = outcome.provenance.readOn === "NEVER_READ" ? null : outcome.provenance.readOn;
      entries.push({
        key: `${sitting.meetingId}#${outcome.eventItemId}`,
        meetingId: sitting.meetingId,
        startsAt: sitting.startsAt,
        localDay: day,
        itemText: topicWindow(outcome.itemQuote, topic),
        agendaNumber: outcome.itemReference ?? null,
        matterFile: outcome.matterFile,
        status,
        action: outcome.action,
        tallyText: outcome.tallyText,
        sourceUrl,
        sourceOrg: sitting.sourceOrg,
        retrievedAt,
        basis: "MINUTES_RECORD",
      });
      records.push({
        kind: "MEETING_ACTION",
        id: `${outcome.eventItemId}#action`,
        bodyId: input.bodyId,
        meetingId: sitting.meetingId,
        text: [
          `Item ${outcome.itemReference ?? ""}${outcome.sectionQuote ? ` (under "${outcome.sectionQuote}")` : ""}: "${outcome.itemQuote}".`,
          `The minutes record: "${outcome.quote}"`,
          sitting.minutesDocument ? sitting.minutesDocument.approval.detail : null,
        ].filter(Boolean).join(" "),
        occurredAt: sitting.startsAt,
        sourceUrl,
        sourceOrg: sitting.sourceOrg,
        retrievedAt,
      });
    }
  }

  const documents = held.agendaDocuments;
  const byMeeting = new Map(input.meetings.map((meeting) => [meeting.id, meeting]));
  const { hits, searched, unreadable } = searchAgendas(documents, topic);
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
        break;
    }
  }

  const count = (status: TopicEntryStatus) => entries.filter((entry) => entry.status === status).length;
  const denominators: Record<string, number> = {
    topicTimelineEntries: entries.length,
    topicStructuredAgendaItems: entries.filter((entry) => entry.basis === "STRUCTURED_AGENDA_RECORD").length,
    topicAgendaDocumentLines: entries.filter((entry) => entry.basis === "AGENDA_DOCUMENT_LINE").length,
    topicMinutesRecords: entries.filter((entry) => entry.basis === "MINUTES_RECORD").length,
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
  const quote = entry.basis === "STRUCTURED_AGENDA_RECORD" ? quotable(entry.itemText, 150) : entry.itemText;
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
    const searched = timeline.denominators.topicAgendaDocumentsSearched ?? 0;
    add(searched > 0
      ? `No mention of ${timeline.topic.label} in the ${searched} agenda${searched === 1 ? "" : "s"} we hold for ${timeline.bodyName}`
      : `We don't hold any readable agendas for ${timeline.bodyName} yet, so nothing was searched for ${timeline.topic.label}`);
  }
  if (lead && !add(entrySentence(lead, timeline.bodyName, true, timeline.outcomesUnavailable), lead)) {
    add(entrySentence({ ...lead, itemText: quotable(lead.itemText, 110), basis: "STRUCTURED_AGENDA_RECORD" }, timeline.bodyName, true, timeline.outcomesUnavailable), lead);
  }
  const nextUp = upcoming.find((entry) => !used.has(entry.key));
  if (nextUp) add(entrySentence(nextUp, timeline.bodyName, !lead, timeline.outcomesUnavailable), nextUp);
  const earlier = past.find((entry) => !used.has(entry.key) && entry.localDay !== lead?.localDay);
  if (earlier) add(`Earlier, ${entrySentence(earlier, timeline.bodyName, false, timeline.outcomesUnavailable).replace(/^./, (c) => c.toLowerCase())}`, earlier);

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
