import { formatDateLong } from "../text/format-date.ts";
import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";
import type { SittingShape } from "./lexical-reading.ts";
import { overLengthBudget } from "./length-contract.ts";
import type { HeldMeetingAction } from "./meeting-outcomes.ts";
import { localDate, localTime, startTimePosted, zoneOf } from "./meeting-time.ts";
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

function composeVoteAnswer(input: SittingAnswerInput, chosen: ComposableSitting, meetingUrls: readonly string[]): { answer: string; citedUrls: string[]; missingAnswer?: boolean } | null {
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
  for (const item of items) {
    const votes = [...item.values].map(([value, names]) => `${joined(names)}: ${value}`).join("; ");
    const sentence = `On "${titleQuote(item.title).replace(/"/g, "'")}": ${votes}`;
    if (!fits(sentence)) break;
    sentences.push(sentence);
    if (item.url && !cited.includes(item.url)) cited.push(item.url);
  }
  if (sentences.length === 0) return null;
  return { answer: `${sentences.join(". ")}.`, citedUrls: cited };
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Remove portal document labels and a repeated date without changing the event's name. */
function eventTitle(title: string): string {
  let text = squash(title).replace(/\s*[-–—]\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}$/i, "");
  text = text.replace(/\s+agenda$/i, "");
  if (text.split(" ").length > 2) text = text.replace(/\s+meeting$/i, "");
  return text;
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

function composeDecisionAnswer(input: SittingAnswerInput, chosen: ComposableSitting): { answer: string; citedUrls: string[]; missingAnswer?: boolean } | null {
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
  const rank = (action: HeldMeetingAction) => action.disposition === "FAILED" ? 0
    : action.resultState === "CONTRADICTORY" ? 1 : action.divided ? 2 : action.consent ? 4 : 3;
  const ordered = mine.map((action, index) => ({ action, index }))
    .sort((a, b) => rank(a.action) - rank(b.action) || a.index - b.index);
  const sentences: string[] = [];
  const cited = new Set<string>();
  for (const { action } of ordered) {
    const label = action.item ? inQuotes(clip(action.item, 100)) : action.matterFile;
    if (!label) continue;
    const motion = action.motion ? inQuotes(clip(action.motion, 110)) : "";
    const result = action.resultState === "STATED" ? inQuotes(action.result!)
      : action.resultState === "CONTRADICTORY" ? "the published result contradicts itself"
        : "we don't have the result yet";
    const sentence = `${label}: ${[motion, result].filter(Boolean).join("; ")}`;
    if (input.admissible && !input.admissible(sentence)) continue;
    const next = [...sentences, sentence];
    if (overLengthBudget(`${next.join(". ")}.`) !== null) continue;
    sentences.push(sentence);
    const url = byId.get(action.recordId)?.sourceUrl;
    if (url) cited.add(url);
  }
  if (!sentences.length) return null;
  const url = meetings.get(chosen.id)?.sourceUrl;
  if (url) cited.add(url);
  return { answer: `${sentences.join(". ")}.`, citedUrls: [...cited] };
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

/** A composed answer ships only on a passing verdict; a failed one is discarded whole and the model writes. */
export function settleSittingComposition(
  composed: { answer: string; citedUrls: string[]; missingAnswer?: boolean } | null,
  validate: (answer: string, citedUrls: readonly string[]) => ValidationVerdict,
): { composed: { answer: string; citedUrls: string[]; missingAnswer?: boolean } | null; verdict: ValidationVerdict | null } {
  if (!composed) return { composed: null, verdict: null };
  const verdict = validate(composed.answer, composed.citedUrls);
  return { composed: verdict.kind === "PASSED" ? composed : null, verdict };
}

export type SittingAnswerBasis = "RECORDED_ACTIONS" | "ROLL_CALLS" | "SITTING_AND_GAPS";

export function composeSittingAnswerWithBasis(input: SittingAnswerInput): { composed: { answer: string; citedUrls: string[]; missingAnswer?: boolean } | null; basis: SittingAnswerBasis } {
  if (input.shape === "MEETING_OUTCOME" && input.questionClass === "WHAT_WAS_DECIDED" &&
    input.records.some((record) => record.kind === "MEETING_ACTION")) {
    return { composed: decisionAnswer(input), basis: "RECORDED_ACTIONS" };
  }
  const basis: SittingAnswerBasis = input.shape === "MEETING_OUTCOME" && input.questionClass === "HOW_DID_THEY_VOTE" &&
    input.records.some((record) => record.kind === "MEETING_MEMBER_VOTE") ? "ROLL_CALLS" : "SITTING_AND_GAPS";
  return { composed: composeSittingAnswer(input), basis };
}

function decisionAnswer(input: SittingAnswerInput): { answer: string; citedUrls: string[]; missingAnswer?: boolean } | null {
  const [chosen] = input.sittings;
  if (!chosen || Date.parse(chosen.startsAt) >= input.now) return null;
  if (input.sittings.some((sitting) => sitting.status === "CANCELED" || !zoneOf(sitting).known)) return null;
  if (input.records.some((record) => record.kind === "MEETING" && record.meetingListingIdentity)) return null;
  return composeDecisionAnswer(input, chosen);
}

export function composeSittingAnswer(input: SittingAnswerInput): { answer: string; citedUrls: string[]; missingAnswer?: boolean } | null {
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
  const subjectName = proseName(input.subjectName);
  const roles = new Set(input.sittingGaps.map(entry => entry.role));
  const missing = (what: string) => ({ answer: `We don't have ${subjectName}'s ${what} yet.`, citedUrls: [] as string[], missingAnswer: true });
  if (input.shape === "BODY_AGENDA") {
    if (input.records.some(row => CONTENT_KINDS.has(row.kind))) return null;
    return roles.has("AGENDA") || roles.has("NO_SITTING") ? missing("agenda details") : null;
  }
  if (input.shape === "MEETING_OUTCOME") {
    if (input.records.some(row => CONTENT_KINDS.has(row.kind) && row.kind !== "AGENDA_ITEM" && row.kind !== "AGENDA_MENTION")) return null;
    return roles.has("OUTCOME") || roles.has("MINUTES") || roles.has("NO_SITTING") ? missing("meeting decisions") : null;
  }
  if (input.shape === "PUBLIC_COMMENT") {
    const rules = input.records.filter(row => row.kind === "PUBLIC_COMMENT_ACCESS");
    const answer = rules.map(row => row.text.trim().replace(/[.\s]+$/, "")).join(". ");
    if (answer && !overLengthBudget(`${answer}.`)) return { answer: `${answer}.`,
      citedUrls: [...new Set(rules.flatMap(row => row.sourceUrl ?? []))] };
    return roles.has("COMMENT") || roles.has("NO_SITTING") ? missing("public-comment rules") : null;
  }

  const [chosen] = input.sittings;
  if (!chosen) return roles.has("NO_SITTING") ? missing("requested meeting date") : null;
  if (chosen.status === "CANCELED" || !zoneOf(chosen).known) return null;
  const record = input.records.find(row => row.kind === "MEETING" && row.id === chosen.id);
  if (!record || record.meetingListingIdentity) return null;
  const upcoming = Date.parse(chosen.startsAt) >= input.now;
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: chosen.timeZone!, month: "long", day: "numeric",
    ...(new Date(input.now).getUTCFullYear() !== Number(localDate(chosen).slice(0, 4)) ? { year: "numeric" } : {}),
  }).format(new Date(chosen.startsAt));
  const time = startTimePosted(chosen) ? ` at ${new Intl.DateTimeFormat("en-US", {
    timeZone: chosen.timeZone!, hour: "numeric", minute: "2-digit",
  }).format(new Date(chosen.startsAt))}` : "; the start time isn't posted";
  const title = eventTitle(chosen.title);
  const titled = /^(?:the|a|an)\s/i.test(title) ? title : `the ${title}`;
  const event = title.toLowerCase().includes(subjectName.toLowerCase()) ? title : `${subjectName} ${title}`;
  const lead = input.requestedLocalDate ? `${event} ${upcoming ? "is" : "was"} on ${day}${time}`
    : `The ${upcoming ? "next" : "most recent"} ${subjectName} meeting ${upcoming ? "is" : "was"} ${titled} on ${day}${time}`;
  const answer = `${lead}.${input.includeLocation ? ` ${sittingVenue(chosen) || "We don't have its location yet"}.` : ""}`;
  if (overLengthBudget(answer)) return null;
  return { answer, citedUrls: record.sourceUrl ? [record.sourceUrl] : [] };
}
