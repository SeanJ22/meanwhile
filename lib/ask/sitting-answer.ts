import { floored, floorLine } from "../ops/denominator-floor.ts";
import { formatDateLong } from "../text/format-date.ts";
import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";
import type { SittingShape } from "./lexical-reading.ts";
import { overLengthBudget } from "./length-contract.ts";
import type { HeldMeetingAction } from "./meeting-outcomes.ts";
import { localDate, localTime, localWeekday, startTimePosted, zoneOf } from "./meeting-time.ts";
import type { ValidationVerdict } from "./validate.ts";

/**
 * **WHEN A BODY MEETS IS A FACT WE HOLD, NOT A PARAGRAPH TO WRITE.**
 * (2026-09-25, the Ask latency repair.)
 *
 * Measured on production 2026-09-25: *"When does the Mesa City Council meet
 * next?"* spent 7.2 s in the synthesis rung on a cold instance and 4-6.5 s on
 * a warm one, to say what two MEETING records already said — the sitting, its
 * date and time in the body's own zone, and the named gap about its agenda.
 * The model also opened with a definition of a city council that no record
 * supplied. Sean's bar is three seconds to a usable answer.
 *
 * So when a question asks WHEN a named body sits — or asks for its agenda or
 * its decisions and the pack holds nothing to summarise, only the sitting and
 * the named gaps — the answer is composed here, in code, from those records,
 * exactly as a topic timeline is (`lib/ask/topic-timeline.ts`):
 *
 * - every date and time is the MEETING record's own, read in the body's zone
 *   through `lib/ask/meeting-time.ts`, the module the record text uses;
 * - every title is the publisher's calendar title, quoted;
 * - every limitation is a named gap the route attached to THAT sitting, in its
 *   own words, so OURS and THEIRS can never be swapped by a paraphrase;
 * - the whole stays inside the one length contract, and the caller holds it to
 *   the same validator a model answer faces.
 *
 * It returns null — and the model writes the answer exactly as before —
 * whenever there is something to summarise (agenda items, recorded actions,
 * votes, minutes or notice summaries on an agenda or outcome question), when a
 * calendar listing's meeting identity is unresolved, when a sitting is
 * cancelled, or when a body's time zone is not recorded. Composition never
 * decides that a record does not matter; it only answers where no record
 * needs explaining.
 *
 * Two outcome answers ARE the records, and are read off them rather than
 * summarised: how each member voted (the publisher's roll calls,
 * `composeVoteAnswer`) and what the body decided (its recorded actions, each
 * motion and result in the record's own words, `composeDecisionAnswer`).
 */

/** A sitting as the route resolved it (`AskSitting`), narrowed to what is read here. */
export interface ComposableSitting {
  id: string;
  title: string;
  startsAt: string;
  timeZone?: string | null;
  /** `DAY`: a date-only posting — the date is stated and no time is printed. */
  startPrecision?: "MINUTE" | "DAY";
  status: string;
  location?: { name: string; address: string | null } | null;
}

/** A venue is held meeting data, never a body's contact address. */
export function sittingVenue(sitting: ComposableSitting): string {
  return sitting.location
    ? [...new Set([sitting.location.name, sitting.location.address].filter(Boolean))].join(", ")
    : "";
}

/** " at 5:45 PM MST", or nothing for a date-only posting (its midnight is never a time). */
function atTime(sitting: ComposableSitting): string {
  return startTimePosted(sitting) ? ` at ${localTime(sitting)}` : "";
}

/**
 * Why a gap was attached to the sitting. The order a composed answer states
 * them in depends on the question: an outcome question leads with whether the
 * outcome is held.
 */
export type SittingGapRole = "NO_SITTING" | "LISTING" | "AGENDA" | "NOTICE" | "MINUTES" | "OUTCOME";

export interface SittingGap {
  role: SittingGapRole;
  gap: EvidenceGap;
  /** The sitting the gap was attached for, where the route attached it for one. */
  meetingId?: string;
}

/** Records that carry something to summarise, not merely a sitting or a gap. */
const CONTENT_KINDS: ReadonlySet<EvidenceRecord["kind"]> = new Set([
  "AGENDA_ITEM",
  "AGENDA_MENTION",
  "MEETING_ACTION",
  "MEETING_MEMBER_VOTE",
  "MEETING_MINUTES_SUMMARY",
  "MEETING_NOTICE_SUMMARY",
]);

export interface SittingAnswerInput {
  shape: SittingShape;
  subjectName: string;
  /** The chosen sitting FIRST, then any other sitting the body holds that local day. */
  sittings: readonly ComposableSitting[];
  /** The gated pack records — the same ones the validator checks. */
  records: readonly EvidenceRecord[];
  /** The gaps the route attached to these sittings, in the order it attached them. */
  sittingGaps: readonly SittingGap[];
  now: number;
  includeLocation?: boolean;
  /** Exact date already selected by the route; never label it next or latest. */
  requestedLocalDate?: string | null;
  /** The route's own reading of an outcome question (`outcomeQuestionClass`), when it made one. */
  questionClass?: string | null;
  /**
   * The recorded actions the route held for these sittings, read beside the
   * records (`lib/ask/meeting-outcomes.ts` `HeldMeetingAction`). Only a "what
   * did they decide" answer reads them, and only through the records they name.
   */
  actions?: readonly HeldMeetingAction[];
  /**
   * Whether one described action may be quoted: the caller's validator over
   * the phrase alone, so an item whose own title names another government is
   * left to the records rather than failing the whole answer.
   */
  admissible?: (text: string) => boolean;
}

/** `On "<title>", <member> voted <value>.` — the text `lib/ask/meeting-outcomes.ts` mints for a member-vote row. */
const MEMBER_VOTE_TEXT = /^On "([\s\S]+)", (.+) voted (.+)\.$/;

/**
 * A clerk's item title, quoted from its start with its line breaks read as
 * spaces, cut at a word under ~110 characters. Not the first line alone: a
 * Legistar title's first line is often a section heading ("UNFINISHED
 * BUSINESS (6/23/26)") or a class ("Board of Supervisors Policy") that two
 * items share.
 */
function titleQuote(title: string): string {
  const line = title.replace(/\s+/g, " ").trim();
  if (line.length <= 110) return line;
  const cut = line.slice(0, 110);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 50 ? cut.lastIndexOf(" ") : 110)}…`;
}

function joined(names: readonly string[]): string {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * **HOW EACH MEMBER VOTED, READ OFF THE PUBLISHER'S OWN ROLL CALLS.**
 * (2026-09-25, the Ask latency repair.)
 *
 * Measured that day on the Pima County Board of Supervisors' September 22
 * sitting (48 roll calls): the fast model writer took 2.8-3.7 s and, on one
 * draw, wrote that a member "voted no" on an item the roll call records him
 * as "Recused". A vote is the one fact a reader asks this question for, and
 * the rows already say it exactly. So a "how did they vote" question is
 * answered from the member-vote rows the route retrieved, in their order —
 * the items the question names, then split votes, first — each member's
 * value in the publisher's own word ("Aye", "Nay", "Recused", "Not
 * Present"), never mapped and never totalled. Every row stays in the records
 * the reader sees. Null when a row's text is not the shape
 * `lib/ask/meeting-outcomes.ts` mints, or nothing fits the length contract.
 */
function composeVoteAnswer(input: SittingAnswerInput, chosen: ComposableSitting, meetingUrls: readonly string[]): { answer: string; citedUrls: string[] } | null {
  const rows = input.records.filter((record) => record.kind === "MEETING_MEMBER_VOTE");
  const items: { key: string; title: string; url: string | null; values: Map<string, string[]> }[] = [];
  for (const row of rows) {
    const match = MEMBER_VOTE_TEXT.exec(row.text);
    if (!match) return null;
    const key = row.id.slice(0, row.id.lastIndexOf("#"));
    let item = items.find((entry) => entry.key === key);
    if (!item) {
      item = { key, title: match[1], url: row.sourceUrl ?? null, values: new Map() };
      items.push(item);
    }
    item.values.set(match[3], [...(item.values.get(match[3]) ?? []), match[2]]);
  }
  if (items.length === 0) return null;
  const sentences: string[] = [];
  const cited = [...meetingUrls];
  const fits = (next: string) => overLengthBudget(`${[...sentences, next].join(". ")}.`) === null;
  const lead = `At its ${dayOf(chosen)} meeting, the ${proseName(input.subjectName)} recorded each member's vote on ${items.length} item${items.length === 1 ? "" : "s"}`;
  if (!fits(lead)) return null;
  sentences.push(lead);
  for (const item of items) {
    const votes = [...item.values].map(([value, names]) => `${joined(names)}: ${value}`).join("; ");
    const sentence = `On "${titleQuote(item.title).replace(/"/g, "'")}": ${votes}`;
    if (!fits(sentence)) break;
    sentences.push(sentence);
    if (item.url && !cited.includes(item.url)) cited.push(item.url);
  }
  if (sentences.length < 2) return null;
  return { answer: `${sentences.join(". ")}.`, citedUrls: cited };
}

/** Whitespace is not content: a clerk's line break reads as a space. */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A verbatim span: the text's first sentence when that is a sentence of its
 * own under `max` characters (a clerk's item is often a sentence and then its
 * detail), else cut at a word under `max` and marked "…".
 */
function clip(text: string, max: number): string {
  const line = squash(text);
  if (line.length <= max) return line;
  const first = /^.{30,}?[a-z]{3}[.!?](?=\s+["'(A-Z])/.exec(line)?.[0];
  if (first && first.length <= max) return first;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max / 2 ? space : max).replace(/[\s,;:]+$/, "")}…`;
}

/** Quoted without changing a word: an inner double quote reads as a single one, as every composed quote here does. */
function inQuotes(text: string): string {
  return `"${text.replace(/"/g, "'")}"`;
}

/**
 * **WHAT A BODY DECIDED, READ OFF ITS OWN RECORD OF THE SITTING.**
 * (2026-09-25, the Ask three-second repair.)
 *
 * Measured warm, locally, that day: *"What did the Pima board decide at its
 * last meeting?"* took 3.1-3.8 s end to end, all but ~0.3 s of it the fast
 * model writing a paragraph out of the `MEETING_ACTION` records — the
 * publisher's own verb for each motion and its own pass/fail word. Sean's bar
 * is three seconds. So this answer is composed here, exactly as the vote
 * answer above is:
 *
 * - the sitting's date in the body's own zone, and how many actions its record
 *   holds;
 * - the result counts, each with its denominator (`floored` / `floorLine`),
 *   in the publisher's own result words — never mapped to "passed";
 * - as many actions as fit the one length contract, each as the item, the
 *   motion and the result in the record's own words — failed motions and
 *   split roll calls first, then the publisher's order, motions with no
 *   result recorded last;
 * - an action with no result recorded is SAID to have none. A result is never
 *   inferred from a motion, a tally or a roll call;
 * - minutes that are not the approved record say so, in their own words;
 * - how many actions are described, of how many — the records carry them all.
 *
 * Every quoted span is checked to be a span of the record the reader is
 * shown before it is quoted. Null — and the model writes, as before — when the
 * chosen sitting holds no action, a sitting is cancelled, unzoned or an
 * unresolved listing, a same-day sitting holds neither an action nor a named
 * outcome gap, two action records share an id, or any span fails that check.
 */
function composeDecisionAnswer(input: SittingAnswerInput, chosen: ComposableSitting): { answer: string; citedUrls: string[] } | null {
  const actionRecords = input.records.filter((record) => record.kind === "MEETING_ACTION");
  if (new Set(actionRecords.map((record) => record.id)).size !== actionRecords.length) return null;
  const held = input.actions ?? [];
  if (new Set(held.map((action) => action.recordId)).size !== held.length) return null;
  const byId = new Map(actionRecords.map((record) => [record.id, record]));
  // Every recorded action in the pack is one the route held for these sittings, and the reverse.
  if (held.length !== actionRecords.length || !held.every((action) => byId.has(action.recordId))) return null;
  for (const action of held) {
    const text = squash(byId.get(action.recordId)!.text);
    for (const span of [action.item, action.motion, action.result, action.standing, action.matterFile]) {
      if (span && !text.includes(squash(span))) return null;
    }
  }
  const meetings = new Map(input.records.filter((record) => record.kind === "MEETING").map((record) => [record.id, record]));
  if (!input.sittings.every((sitting) => meetings.has(sitting.id))) return null;

  const mine = held.filter((action) => action.meetingId === chosen.id);
  if (mine.length === 0) return null;
  const total = mine.length;
  const where = `a composed decisions answer for sitting ${chosen.id}`;
  const minutes = mine.every((action) => action.source === "MINUTES");
  const others = input.sittings.slice(1);

  /* 1. The sitting, how many actions its record holds, and the results, each counted over them. */
  const results = new Map<string, number>();
  for (const action of mine) if (action.resultState === "STATED") results.set(action.result!, (results.get(action.result!) ?? 0) + 1);
  const counts: string[] = [];
  // A result a clerk wrote as a sentence is quoted per action below, never repeated as a count label.
  if ([...results.keys()].every((word) => word.length <= 40)) {
    for (const [word, count] of results) counts.push(floorLine(floored(`${minutes ? "result in the minutes" : "published result"} ${inQuotes(word)}`, where, total, count)));
  }
  const absent = mine.filter((action) => action.resultState === "ABSENT").length;
  if (absent > 0) counts.push(floorLine(floored(minutes ? "without a result in the minutes text we could read" : "without a published result", where, total, absent)));
  const contradictory = mine.filter((action) => action.resultState === "CONTRADICTORY").length;
  if (contradictory > 0) counts.push(floorLine(floored("with a published result that contradicts itself", where, total, contradictory)));
  const titled = others.length > 0 ? ` (${quoted(chosen.title)})` : "";
  const lead = `At its ${dayOf(chosen)} meeting${titled}, the ${proseName(input.subjectName)} recorded ${total} action${total === 1 ? "" : "s"}, ` +
    `${total === 1 ? "in the records" : "each in the records"} with this answer${counts.length ? `; ${counts.join("; ")}` : ""}`;

  /* 2. Every other sitting that day: its own actions counted, or its named outcome gap. */
  const afterwards: string[] = [];
  for (const sitting of others) {
    const theirs = held.filter((action) => action.meetingId === sitting.id).length;
    const when = startTimePosted(chosen) && startTimePosted(sitting)
      ? sitting.startsAt < chosen.startsAt ? "earlier that day" : sitting.startsAt > chosen.startsAt ? "later that day" : "at the same time"
      : "that day";
    if (theirs > 0) {
      afterwards.push(`The ${quoted(sitting.title)} sitting ${when} recorded ${theirs} more action${theirs === 1 ? "" : "s"}`);
      continue;
    }
    const gaps = input.sittingGaps.filter((entry) => entry.meetingId === sitting.id && (entry.role === "OUTCOME" || entry.role === "MINUTES"));
    if (gaps.length === 0) return null;
    for (const { gap } of gaps) {
      const plain = plainGapStatement(gap.statement, chosen.timeZone ?? null);
      if (plain === null) return null;
      afterwards.push(`For the ${quoted(sitting.title)} sitting ${when}: ${plain.replace(/[.\s]+$/, "")}`);
    }
  }
  // The standing of minutes that are not the approved record travels with any answer read from them.
  const standing = [...new Set(mine.flatMap((action) => action.standing ? [squash(action.standing)] : []))];

  /* 3. As many actions as fit, the decisive first: a failed motion, a result
     that contradicts itself, a split roll call, then the publisher's order —
     its own agenda before its consent calendar, and an item it records no
     result for last (the count above already says how many there are). */
  const rank = (action: HeldMeetingAction) => action.disposition === "FAILED" ? 0
    : action.resultState === "CONTRADICTORY" ? 1
      : action.resultState === "ABSENT" ? 5
        : action.divided ? 2
          : action.consent ? 4 : 3;
  const ordered = mine.map((action, index) => ({ action, index }))
    .sort((a, b) => rank(a.action) - rank(b.action) || a.index - b.index)
    .map(({ action }) => action);
  /* An action with nothing to name it by is left to the records. */
  const phrase = (action: HeldMeetingAction): string | null => {
    const label = action.item ? inQuotes(clip(action.item, 80)) : action.matterFile ?? "";
    const head = [action.itemReference ? `Item ${action.itemReference}` : "", label].filter(Boolean).join(", ");
    if (!head) return null;
    const motion = action.motion ? inQuotes(clip(action.motion, 90)) : "";
    const result = action.resultState === "STATED" ? `result ${inQuotes(action.result!)}`
      : action.resultState === "CONTRADICTORY" ? "its published result contradicts itself"
        : action.source === "MINUTES" ? "without a result in the minutes text we could read" : "without a published result";
    return `${head}: ${[motion, result].filter(Boolean).join(", ")}`;
  };
  // The described actions are counted over all of them, in the sentence that describes them.
  const described = (shown: readonly string[]) => `${floorLine(floored("Recorded actions described here", where, total, shown.length))} — ${shown.join("; ")}`;
  const assemble = (shown: readonly string[]) => [lead, described(shown), ...afterwards, ...standing]
    .map((sentence) => sentence.replace(/[.\s]+$/, ""));
  const fits = (sentences: readonly string[]) => overLengthBudget(`${sentences.join(". ")}.`) === null;
  const shown: string[] = [];
  for (const action of ordered) {
    const next = phrase(action);
    if (next === null || (input.admissible && !input.admissible(next))) continue;
    if (!fits(assemble([...shown, next]))) continue;
    shown.push(next);
  }
  if (shown.length === 0) return null;

  const cited: string[] = [];
  for (const sitting of input.sittings) {
    const url = meetings.get(sitting.id)?.sourceUrl;
    if (url && !cited.includes(url)) cited.push(url);
  }
  for (const action of mine) {
    const url = byId.get(action.recordId)?.sourceUrl;
    if (url && !cited.includes(url)) cited.push(url);
  }
  return { answer: `${assemble(shown).join(". ")}.`, citedUrls: cited };
}

function dayOf(sitting: ComposableSitting): string {
  const day = localDate(sitting);
  return `${localWeekday(sitting)}, ${formatDateLong(day) ?? day}`;
}

function quoted(title: string): string {
  return `"${title.replace(/"/g, "'").trim()}"`;
}

/** "Pima County Board Of Supervisors" reads as "Pima County Board of Supervisors" in a sentence. */
export function proseName(name: string): string {
  const connectors = new Set(["Of", "And", "The", "For", "In", "On", "At", "To"]);
  return name.split(" ").map((word, index) => (index > 0 && connectors.has(word) ? word.toLowerCase() : word)).join(" ");
}

const ISO_INSTANT_SOURCE = "(\\bat )?\\b(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:\\d{2}))";

/**
 * A named gap in its own words, with any machine timestamp it carries spelled
 * out in the body's own zone — the plain-language rule for prose. The instant
 * is the same instant; only its spelling changes. Null when a timestamp is
 * present and no zone is known to spell it in.
 */
export function plainGapStatement(statement: string, zone: string | null): string | null {
  if (!new RegExp(ISO_INSTANT_SOURCE).test(statement)) return statement;
  if (!zone) return null;
  return statement.replace(new RegExp(ISO_INSTANT_SOURCE, "g"), (_all: string, at: string | undefined, iso: string) => {
    if (!Number.isFinite(Date.parse(iso))) return _all;
    const sitting = { startsAt: iso, timeZone: zone };
    const day = localDate(sitting);
    return `${at ? "on " : ""}${formatDateLong(day) ?? day} at ${localTime(sitting)}`;
  });
}

function listed(sittings: readonly ComposableSitting[]): string {
  const parts = sittings.map((sitting) => startTimePosted(sitting)
    ? `${quoted(sitting.title)} at ${localTime(sitting)}`
    : `${quoted(sitting.title)} (start time not posted)`);
  return parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * **A COMPOSED ANSWER SHIPS ONLY ON A PASSING VERDICT.** The composition is
 * held to the validator a model answer faces, and a failed check discards it
 * whole — the caller then asks the model exactly as it did before this module
 * existed. It is never repaired, trimmed or shipped with a warning.
 */
export function settleSittingComposition(
  composed: { answer: string; citedUrls: string[] } | null,
  validate: (answer: string, citedUrls: readonly string[]) => ValidationVerdict,
): { composed: { answer: string; citedUrls: string[] } | null; verdict: ValidationVerdict | null } {
  if (!composed) return { composed: null, verdict: null };
  const verdict = validate(composed.answer, composed.citedUrls);
  return { composed: verdict.kind === "PASSED" ? composed : null, verdict };
}

/** Which records a composed sitting answer was read from, for the trace. */
export type SittingAnswerBasis = "RECORDED_ACTIONS" | "ROLL_CALLS" | "SITTING_AND_GAPS";

/** The composed answer and the records it was read from; `composed` is null when a model should write it. */
export function composeSittingAnswerWithBasis(input: SittingAnswerInput): { composed: { answer: string; citedUrls: string[] } | null; basis: SittingAnswerBasis } {
  if (input.shape === "MEETING_OUTCOME" && input.questionClass === "WHAT_WAS_DECIDED" &&
    input.records.some((record) => record.kind === "MEETING_ACTION")) {
    return { composed: decisionAnswer(input), basis: "RECORDED_ACTIONS" };
  }
  const basis: SittingAnswerBasis = input.shape === "MEETING_OUTCOME" && input.questionClass === "HOW_DID_THEY_VOTE" &&
    input.records.some((record) => record.kind === "MEETING_MEMBER_VOTE") ? "ROLL_CALLS" : "SITTING_AND_GAPS";
  return { composed: composeSittingAnswer(input), basis };
}

/** The decisions answer's own gate: a concluded, zoned, uncancelled sitting whose identity is resolved. */
function decisionAnswer(input: SittingAnswerInput): { answer: string; citedUrls: string[] } | null {
  const [chosen] = input.sittings;
  if (!chosen || Date.parse(chosen.startsAt) >= input.now) return null;
  if (input.sittings.some((sitting) => sitting.status === "CANCELED" || !zoneOf(sitting).known)) return null;
  if (input.records.some((record) => record.kind === "MEETING" && record.meetingListingIdentity)) return null;
  return composeDecisionAnswer(input, chosen);
}

/**
 * Compose the answer, or null when a model should write it. See the module
 * note for exactly when each applies.
 */
export function composeSittingAnswer(input: SittingAnswerInput): { answer: string; citedUrls: string[] } | null {
  if (input.shape === "MEETING_OUTCOME" && input.questionClass === "WHAT_WAS_DECIDED" &&
    input.records.some((record) => record.kind === "MEETING_ACTION")) {
    return decisionAnswer(input);
  }
  if (input.shape === "MEETING_OUTCOME" && input.questionClass === "HOW_DID_THEY_VOTE" &&
    input.records.some((record) => record.kind === "MEETING_MEMBER_VOTE")) {
    const [chosen] = input.sittings;
    if (!chosen || Date.parse(chosen.startsAt) >= input.now) return null;
    if (input.sittings.some((sitting) => sitting.status === "CANCELED" || !zoneOf(sitting).known)) return null;
    if (input.records.some((record) => record.kind === "MEETING" && record.meetingListingIdentity)) return null;
    const meetings = input.records.filter((record) => record.kind === "MEETING");
    if (!input.sittings.every((sitting) => meetings.some((record) => record.id === sitting.id))) return null;
    const urls = [...new Set(input.sittings.flatMap((sitting) => meetings.find((record) => record.id === sitting.id)?.sourceUrl ?? []))];
    return composeVoteAnswer(input, chosen, urls);
  }
  const summarisable = input.records.some((record) => CONTENT_KINDS.has(record.kind) &&
    !(input.shape === "MEETING_OUTCOME" && (record.kind === "AGENDA_ITEM" || record.kind === "AGENDA_MENTION")));
  if (input.shape !== "MEETING_TIME" && summarisable) return null;
  /* An agenda or outcome question about a sitting is answered by the gap that
     says what is not held. Without one, there is no composed answer to give. */
  const roles = new Set(input.sittingGaps.map((entry) => entry.role));
  if (input.sittings.length > 0 && input.shape === "MEETING_OUTCOME" && !roles.has("OUTCOME") && !roles.has("MINUTES")) return null;
  if (input.sittings.length > 0 && input.shape === "BODY_AGENDA" && !roles.has("AGENDA")) return null;
  if (input.records.some((record) => record.kind === "MEETING" && record.meetingListingIdentity)) return null;

  const sentences: string[] = [];
  const cited: string[] = [];
  const add = (sentence: string): boolean => {
    const clean = sentence.trim().replace(/[.\s]+$/, "");
    if (!clean) return false;
    const candidate = [...sentences, clean];
    if (overLengthBudget(`${candidate.join(". ")}.`) !== null) return false;
    sentences.push(clean);
    return true;
  };

  const [chosen, ...sameDay] = input.sittings;
  const subjectName = proseName(input.subjectName);
  if (chosen) {
    if (input.sittings.some((sitting) => sitting.status === "CANCELED" || !zoneOf(sitting).known)) return null;
    const meetingRecords = new Map(input.records.filter((record) => record.kind === "MEETING").map((record) => [record.id, record]));
    // Every sitting described must be a record the reader is shown.
    if (!input.sittings.every((sitting) => meetingRecords.has(sitting.id))) return null;
    const upcoming = Date.parse(chosen.startsAt) >= input.now;
    const lead = input.requestedLocalDate
      ? `The ${subjectName} meeting we hold for ${dayOf(chosen)}${atTime(chosen)} is listed as ${quoted(chosen.title)}`
      : upcoming
      ? `The next ${subjectName} meeting is on ${dayOf(chosen)}${atTime(chosen)}, listed as ${quoted(chosen.title)}`
      : `The most recent ${subjectName} meeting we hold was on ${dayOf(chosen)}${atTime(chosen)}, listed as ${quoted(chosen.title)}`;
    if (!add(lead)) return null;
    if (input.includeLocation) {
      const venue = sittingVenue(chosen);
      if (!add(venue ? `The listed location is ${venue}` : "We do not hold a verified location for this meeting")) return null;
    }
    if (!startTimePosted(chosen)) add("Its start time has not been posted");
    for (const sitting of input.sittings) {
      const url = meetingRecords.get(sitting.id)?.sourceUrl;
      if (url && !cited.includes(url)) cited.push(url);
    }
    /* Before/after is only meaningful between two posted times; a date-only
       sitting (either side) is simply "also that day". */
    const timed = startTimePosted(chosen) ? sameDay.filter(startTimePosted) : [];
    const untimed = sameDay.filter((sitting) => !timed.includes(sitting));
    const later = timed.filter((sitting) => sitting.startsAt > chosen.startsAt);
    const earlier = timed.filter((sitting) => sitting.startsAt < chosen.startsAt);
    const alongside = timed.filter((sitting) => sitting.startsAt === chosen.startsAt);
    if (alongside.length) add(`At the same time: ${listed(alongside)}`);
    if (later.length) add(`Later that day: ${listed(later)}`);
    if (earlier.length) add(`Earlier that day: ${listed(earlier)}`);
    if (untimed.length) add(`Also that day: ${listed(untimed)}`);
    if (input.shape === "MEETING_TIME") {
      // Held agenda items, counted per sitting: two sittings one day are two dockets.
      for (const sitting of input.sittings) {
        const items = input.records.filter((record) => record.kind === "AGENDA_ITEM" &&
          (record.meetingId ?? chosen.id) === sitting.id).length;
        if (items > 0) add(`The ${quoted(sitting.title)} agenda we hold lists ${items} item${items === 1 ? "" : "s"}`);
      }
    }
  }

  /* The named gaps, in their own words. An outcome question leads with
     whether the outcome is held; every other question with the agenda. */
  const order: readonly SittingGapRole[] = input.shape === "MEETING_OUTCOME"
    ? ["NO_SITTING", "OUTCOME", "MINUTES", "AGENDA", "NOTICE", "LISTING"]
    : ["NO_SITTING", "AGENDA", "LISTING", "NOTICE", "MINUTES", "OUTCOME"];
  const required: readonly SittingGapRole[] = input.shape === "MEETING_OUTCOME"
    ? ["NO_SITTING", "OUTCOME", "MINUTES"]
    : input.shape === "BODY_AGENDA" ? ["NO_SITTING", "AGENDA"] : ["NO_SITTING"];
  const said = new Set<string>();
  const zone = chosen?.timeZone ?? null;
  for (const role of order) {
    for (const { gap } of input.sittingGaps.filter((entry) => entry.role === role)) {
      if (said.has(gap.statement)) continue;
      said.add(gap.statement);
      const plain = plainGapStatement(gap.statement, zone);
      // A gap that cannot be said plainly is never dropped from a composed
      // answer: the model writes the answer instead.
      if (plain === null) return null;
      // The gap that IS the answer (no sitting; no outcome for an outcome
      // question; no agenda for an agenda question) must fit, or the model
      // writes it. Any other gap that does not fit stays in the named gaps.
      if (!add(plain) && required.includes(role)) return null;
    }
  }

  if (sentences.length === 0) return null;
  // With no sitting, the answer is the named gap and nothing else.
  if (!chosen && !input.sittingGaps.some((entry) => entry.role === "NO_SITTING")) return null;
  return { answer: `${sentences.join(". ")}.`, citedUrls: cited };
}
