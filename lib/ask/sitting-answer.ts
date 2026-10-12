import { floored, floorLine } from "../ops/denominator-floor.ts";
import { formatDateLong } from "../text/format-date.ts";
import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";
import type { SittingShape } from "./lexical-reading.ts";
import { overLengthBudget } from "./length-contract.ts";
import type { HeldMeetingAction } from "./meeting-outcomes.ts";
import { localDate, localTime, localWeekday, startTimePosted, zoneOf } from "./meeting-time.ts";
import type { ValidationVerdict } from "./validate.ts";

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

export function sittingVenue(sitting: ComposableSitting): string {
  return sitting.location
    ? [...new Set([sitting.location.name, sitting.location.address].filter(Boolean))].join(", ")
    : "";
}

function atTime(sitting: ComposableSitting): string {
  return startTimePosted(sitting) ? ` at ${localTime(sitting)}` : "";
}

export type SittingGapRole = "NO_SITTING" | "LISTING" | "AGENDA" | "NOTICE" | "MINUTES" | "OUTCOME" | "COMMENT";

export interface SittingGap {
  role: SittingGapRole;
  gap: EvidenceGap;
  meetingId?: string;
}

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
  sittings: readonly ComposableSitting[];
  records: readonly EvidenceRecord[];
  sittingGaps: readonly SittingGap[];
  now: number;
  includeLocation?: boolean;
  requestedLocalDate?: string | null;
  questionClass?: string | null;
  actions?: readonly HeldMeetingAction[];
  admissible?: (text: string) => boolean;
}

/** `On "<title>", <member> voted <value>.` — the text `lib/ask/meeting-outcomes.ts` mints for a member-vote row. */
const MEMBER_VOTE_TEXT = /^On "([\s\S]+)", (.+) voted (.+)\.$/;

function titleQuote(title: string): string {
  const line = title.replace(/\s+/g, " ").trim();
  if (line.length <= 110) return line;
  const cut = line.slice(0, 110);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 50 ? cut.lastIndexOf(" ") : 110)}…`;
}

function joined(names: readonly string[]): string {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

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

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, max: number): string {
  const line = squash(text);
  if (line.length <= max) return line;
  const first = /^.{30,}?[a-z]{3}[.!?](?=\s+["'(A-Z])/.exec(line)?.[0];
  if (first && first.length <= max) return first;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max / 2 ? space : max).replace(/[\s,;:]+$/, "")}…`;
}

function inQuotes(text: string): string {
  return `"${text.replace(/"/g, "'")}"`;
}

function composeDecisionAnswer(input: SittingAnswerInput, chosen: ComposableSitting): { answer: string; citedUrls: string[] } | null {
  const actionRecords = input.records.filter((record) => record.kind === "MEETING_ACTION");
  if (new Set(actionRecords.map((record) => record.id)).size !== actionRecords.length) return null;
  const held = input.actions ?? [];
  if (new Set(held.map((action) => action.recordId)).size !== held.length) return null;
  const byId = new Map(actionRecords.map((record) => [record.id, record]));
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

  const results = new Map<string, number>();
  for (const action of mine) if (action.resultState === "STATED") results.set(action.result!, (results.get(action.result!) ?? 0) + 1);
  const counts: string[] = [];
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
  const standing = [...new Set(mine.flatMap((action) => action.standing ? [squash(action.standing)] : []))];

  const rank = (action: HeldMeetingAction) => action.disposition === "FAILED" ? 0
    : action.resultState === "CONTRADICTORY" ? 1
      : action.resultState === "ABSENT" ? 5
        : action.divided ? 2
          : action.consent ? 4 : 3;
  const ordered = mine.map((action, index) => ({ action, index }))
    .sort((a, b) => rank(a.action) - rank(b.action) || a.index - b.index)
    .map(({ action }) => action);
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

export function proseName(name: string): string {
  const connectors = new Set(["Of", "And", "The", "For", "In", "On", "At", "To"]);
  return name.split(" ").map((word, index) => (index > 0 && connectors.has(word) ? word.toLowerCase() : word)).join(" ");
}

const ISO_INSTANT_SOURCE = "(\\bat )?\\b(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:\\d{2}))";

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

/** A composed answer ships only on a passing verdict; a failed one is discarded whole and the model writes. */
export function settleSittingComposition(
  composed: { answer: string; citedUrls: string[] } | null,
  validate: (answer: string, citedUrls: readonly string[]) => ValidationVerdict,
): { composed: { answer: string; citedUrls: string[] } | null; verdict: ValidationVerdict | null } {
  if (!composed) return { composed: null, verdict: null };
  const verdict = validate(composed.answer, composed.citedUrls);
  return { composed: verdict.kind === "PASSED" ? composed : null, verdict };
}

export type SittingAnswerBasis = "RECORDED_ACTIONS" | "ROLL_CALLS" | "SITTING_AND_GAPS";

export function composeSittingAnswerWithBasis(input: SittingAnswerInput): { composed: { answer: string; citedUrls: string[] } | null; basis: SittingAnswerBasis } {
  if (input.shape === "MEETING_OUTCOME" && input.questionClass === "WHAT_WAS_DECIDED" &&
    input.records.some((record) => record.kind === "MEETING_ACTION")) {
    return { composed: decisionAnswer(input), basis: "RECORDED_ACTIONS" };
  }
  const basis: SittingAnswerBasis = input.shape === "MEETING_OUTCOME" && input.questionClass === "HOW_DID_THEY_VOTE" &&
    input.records.some((record) => record.kind === "MEETING_MEMBER_VOTE") ? "ROLL_CALLS" : "SITTING_AND_GAPS";
  return { composed: composeSittingAnswer(input), basis };
}

function decisionAnswer(input: SittingAnswerInput): { answer: string; citedUrls: string[] } | null {
  const [chosen] = input.sittings;
  if (!chosen || Date.parse(chosen.startsAt) >= input.now) return null;
  if (input.sittings.some((sitting) => sitting.status === "CANCELED" || !zoneOf(sitting).known)) return null;
  if (input.records.some((record) => record.kind === "MEETING" && record.meetingListingIdentity)) return null;
  return composeDecisionAnswer(input, chosen);
}

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
  const timeLike = input.shape === "MEETING_TIME" || input.shape === "PUBLIC_COMMENT";
  if (!timeLike && summarisable) return null;
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
    if (!input.sittings.every((sitting) => meetingRecords.has(sitting.id))) return null;
    const upcoming = Date.parse(chosen.startsAt) >= input.now;
    const lead = input.requestedLocalDate
      ? `The ${subjectName} meeting we hold for ${dayOf(chosen)}${atTime(chosen)} is listed as ${quoted(chosen.title)}`
      : upcoming
      ? `The next ${subjectName} meeting is on ${dayOf(chosen)}${atTime(chosen)}, listed as ${quoted(chosen.title)}`
      : `The most recent ${subjectName} meeting we hold was on ${dayOf(chosen)}${atTime(chosen)}, listed as ${quoted(chosen.title)}`;
    if (!add(lead)) return null;
    if (input.includeLocation || input.shape === "PUBLIC_COMMENT") {
      const venue = sittingVenue(chosen);
      if (!add(venue ? `The listed location is ${venue}` : "We do not hold a verified location for this meeting")) return null;
    }
    if (!startTimePosted(chosen)) add("Its start time has not been posted");
    for (const sitting of input.sittings) {
      const url = meetingRecords.get(sitting.id)?.sourceUrl;
      if (url && !cited.includes(url)) cited.push(url);
    }
    const timed = startTimePosted(chosen) ? sameDay.filter(startTimePosted) : [];
    const untimed = sameDay.filter((sitting) => !timed.includes(sitting));
    const later = timed.filter((sitting) => sitting.startsAt > chosen.startsAt);
    const earlier = timed.filter((sitting) => sitting.startsAt < chosen.startsAt);
    const alongside = timed.filter((sitting) => sitting.startsAt === chosen.startsAt);
    if (alongside.length) add(`At the same time: ${listed(alongside)}`);
    if (later.length) add(`Later that day: ${listed(later)}`);
    if (earlier.length) add(`Earlier that day: ${listed(earlier)}`);
    if (untimed.length) add(`Also that day: ${listed(untimed)}`);
    if (timeLike) {
      for (const sitting of input.sittings) {
        const items = input.records.filter((record) => record.kind === "AGENDA_ITEM" &&
          (record.meetingId ?? chosen.id) === sitting.id).length;
        if (items > 0) add(`The ${quoted(sitting.title)} agenda we hold lists ${items} item${items === 1 ? "" : "s"}`);
      }
    }
  }

  if (input.shape === "PUBLIC_COMMENT") {
    const rules = input.records.filter((record) => record.kind === "PUBLIC_COMMENT_ACCESS");
    let stated = 0;
    for (const record of rules) {
      if (!add(record.text)) continue;
      stated += 1;
      if (record.sourceUrl && !cited.includes(record.sourceUrl)) cited.push(record.sourceUrl);
    }
    if (rules.length > 0 && stated === 0) return null;
  }

  const order: readonly SittingGapRole[] = input.shape === "MEETING_OUTCOME"
    ? ["NO_SITTING", "OUTCOME", "MINUTES", "AGENDA", "NOTICE", "LISTING"]
    : input.shape === "PUBLIC_COMMENT"
      ? ["NO_SITTING", "COMMENT", "AGENDA", "LISTING", "NOTICE", "MINUTES", "OUTCOME"]
      : ["NO_SITTING", "AGENDA", "COMMENT", "LISTING", "NOTICE", "MINUTES", "OUTCOME"];
  const required: readonly SittingGapRole[] = input.shape === "MEETING_OUTCOME"
    ? ["NO_SITTING", "OUTCOME", "MINUTES"]
    : input.shape === "BODY_AGENDA" ? ["NO_SITTING", "AGENDA"]
      : input.shape === "PUBLIC_COMMENT" && !input.records.some((record) => record.kind === "PUBLIC_COMMENT_ACCESS") ? ["NO_SITTING", "COMMENT"] : ["NO_SITTING"];
  const said = new Set<string>();
  const zone = chosen?.timeZone ?? null;
  for (const role of order) {
    for (const { gap } of input.sittingGaps.filter((entry) => entry.role === role)) {
      if (said.has(gap.statement)) continue;
      said.add(gap.statement);
      const statement = role === "COMMENT" ? gap.statement.replace(/; its own page is \S+?\.?$/, ".") : gap.statement;
      if (role === "COMMENT" && /https?:/.test(statement)) return null;
      const plain = plainGapStatement(statement, zone);
      if (plain === null) return null;
      if (!add(plain) && required.includes(role)) return null;
    }
  }

  if (sentences.length === 0) return null;
  if (!chosen && !input.sittingGaps.some((entry) => entry.role === "NO_SITTING")) return null;
  return { answer: `${sentences.join(". ")}.`, citedUrls: cited };
}
