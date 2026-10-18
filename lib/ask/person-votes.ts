import { normalizeName } from "../routing/exact-name.ts";
import type { EvidenceRecord } from "./evidence.ts";
import type { LocalVoteRecord } from "../outcomes/local-votes.ts";
import { formatDateLong } from "../text/format-date.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { readerOfficialsQuestion, type ReaderOfficialsAsk, type HeldOfficial } from "./reader-officials.ts";

export interface PersonVotesQuestion {
  slot: string;
  topic: string | null;
}

/* Written against `normalizeName` (lowercase, punctuation to a space, one leading "the" dropped). */
const FORMS: readonly RegExp[] = [
  /^how (?:has|have) (.+?) voted(?: (?:recently|lately|this year|in congress|so far))?$/,
  /^how (?:did|does|do) (.+?) vote(?: (?:recently|lately|last|so far))?$/,
  /^how (?:has|have) (.+?) voted (?:on|about|regarding|concerning|for|against) (.+)$/,
  /^how (?:did|does|do) (.+?) vote (?:on|about|regarding|concerning|for|against) (.+)$/,
  /^what (?:is|s|are) (.+?) s (?:voting record|votes|recent votes)$/,
];

const PRONOUNS = /\b(?:he|she|they|them|his|her|their|it|its|my|our|your|i|me|we|you)\b/;

export function personVotesQuestionShape(question: string): PersonVotesQuestion | null {
  return voteQuestionShape(question, false);
}

function voteQuestionShape(question: string, officePronouns: boolean): PersonVotesQuestion | null {
  const normalized = normalizeName(question);
  if (!normalized || normalized.length > 400) return null;
  for (const form of FORMS) {
    const match = form.exec(normalized);
    const slot = match?.[1]?.trim();
    if (!slot || !officePronouns && PRONOUNS.test(slot)) continue;
    const topic = match?.[2]?.trim().replace(/^(?:the|a|an) /, "") ?? null;
    if (topic !== null && /\b(?:and|or|but)\b/.test(topic) && !/^(?:confirmation|nomination)\b/.test(topic)) return null;
    return { slot, topic: topic && topic.length > 0 ? topic : null };
  }
  return null;
}

interface ReaderPersonVotesQuestion {
  office: ReaderOfficialsAsk;
  topic: string | null;
}

/** A reader's own legislative office is resolved from their divisions, never a name guess. */
export function readerPersonVotesQuestion(question: string): ReaderPersonVotesQuestion | null {
  const shape = voteQuestionShape(question, true);
  if (!shape || !/^(?:my|our) /.test(shape.slot)) return null;
  const office = readerOfficialsQuestion(`Who is ${shape.slot}?`);
  const legislative = new Set(["us_senator", "us_representative", "state_senator", "state_lower_house"]);
  return office && office.keys.every(key => legislative.has(key)) ? { office, topic: shape.topic } : null;
}

export function readerPersonVoteOfficials(
  ask: ReaderPersonVotesQuestion,
  held: readonly HeldOfficial[],
): HeldOfficial[] {
  return [...new Map(held.filter(row => ask.office.keys.includes(officeIdentity(row.seat.officeTitle.replace(/\s*\([^)]*\)\s*$/, "")) ?? ""))
    .map(row => [row.seat.id, row])).values()];
}

const FILLER: ReadonlySet<string> = new Set([
  "vote", "voted", "votes", "voting", "record", "bill", "bills", "law", "laws", "measure", "measures", "legislation", "issue", "issues", "thing", "things",
  "that", "this", "with", "from", "have", "been", "were", "was", "are", "the", "and", "for", "their", "they", "them",
]);

export function topicTerms(topic: string): string[] {
  return [...new Set(normalizeName(topic).split(" ")
    .filter((word) => word.length >= 4 && !FILLER.has(word))
    .map((word) => word.replace(/(?:ing|es|s)$/, ""))
    .filter((word) => word.length >= 3))];
}

const MOST_RECENT_SHOWN = 3;

type RollCallRecord = EvidenceRecord & { rollCall: NonNullable<EvidenceRecord["rollCall"]> };

export function matchingPersonVotes(records: readonly EvidenceRecord[], topic: string | null): RollCallRecord[] | null {
  const held = records.filter((record): record is RollCallRecord => (record.kind === "ROLL_CALL_VOTE" || record.kind === "KEY_VOTE_POSITION") && Boolean(record.rollCall) && Boolean(record.sourceUrl));
  if (!topic) return held;
  const words = normalizeName(topic);
  const bill = /\b(h\s*r|hr|s|h\s*(?:con\s*)?res|s\s*(?:con\s*)?res)\s*(\d+)\b/.exec(words);
  if (bill) {
    const qualification = words.replace(bill[0], "");
    const year = qualification.match(/\b((?:19|20)\d{2})\b/)?.[1];
    const congress = qualification.match(/\b(\d{1,3})(?:st|nd|rd|th)? congress\b/)?.[1];
    return held.filter(record => (!year || (record.keyVote
      ? String(1787 + record.keyVote.congress * 2 + record.keyVote.session - 1)
      : record.occurredAt?.slice(0, 4) ?? record.rollCall.when.match(/\b(?:19|20)\d{2}\b/)?.[0]) === year) &&
      (!congress || record.keyVote?.congress === Number(congress)) && [...normalizeName(record.rollCall.what)
    .matchAll(/\b(h\s*r|hr|s|h\s*(?:con\s*)?res|s\s*(?:con\s*)?res)\s*(\d+)\b/g)]
    .some(match => `${match[1].replace(/\s/g, "")}:${match[2]}` === `${bill[1].replace(/\s/g, "")}:${bill[2]}`));
  }
  const terms = topicTerms(topic);
  if (!terms.length) return null;
  const exact = held.filter(record => normalizeName(record.rollCall.what).includes(words));
  return exact.length ? exact : held.filter(record => terms.every(term => `${record.rollCall.what} ${record.text}`.toLowerCase().includes(term)));
}

export function composePersonVotes(input: {
  name: string;
  topic: string | null;
  records: readonly EvidenceRecord[];
}): { answer: string; citedUrls: string[]; missingAnswer?: boolean } | null {
  const bill = input.topic && /\b(h\s*r|hr|s|h\s*(?:con\s*)?res|s\s*(?:con\s*)?res)\s*(\d+)\b/.exec(normalizeName(input.topic));
  const missing = { answer: "We don't have that answer yet.", citedUrls: [], missingAnswer: true };
  const matching = matchingPersonVotes(input.records, input.topic);
  if (!matching) return null;
  if (matching.length === 0) return bill ? missing : null;
  const shown = [...matching].sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "")).slice(0, MOST_RECENT_SHOWN);
  const billLabels: Readonly<Record<string, string>> = { hr: "H.R.", s: "S.", hres: "H.Res.", hconres: "H.Con.Res.", sres: "S.Res.", sconres: "S.Con.Res." };
  const billName = bill && (billLabels[bill[1].replace(/\s/g, "")] ?? bill[1].toUpperCase());
  const items = shown.map((record) => `${record.rollCall.position} on ${billName && matching.length === 1 ? `${billName} ${bill![2]}` : record.rollCall.what}${input.topic && matching.length === 1 ? "" : ` (${record.rollCall.when}; ${record.rollCall.result})`}`);
  const list = items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join("; ")}; and ${items.at(-1)}`;
  const lead = !input.topic ? `${input.name}'s latest votes: ` : `${input.name} voted `;
  const sentences = [`${lead}${list}`];
  return { answer: `${sentences.join(". ")}.`, citedUrls: [...new Set(shown.map((record) => record.sourceUrl!))] };
}

export function composeLocalMemberVotes(input: {
  name: string;
  topic: string | null;
  votes: readonly LocalVoteRecord[];
}): { answer: string; citedUrls: string[] } | null {
  const terms = input.topic ? topicTerms(input.topic) : [];
  if (input.topic && terms.length === 0) return null;
  const matching = terms.length === 0 ? input.votes : input.votes.filter((vote) => terms.some((term) => vote.subject.toLowerCase().includes(term)));
  const shown = [...matching].filter((vote) => formatDateLong(vote.date)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, MOST_RECENT_SHOWN);
  if (shown.length === 0) return null;
  const items = shown.map((vote) => `${vote.position} on ${vote.subject} (${formatDateLong(vote.date)}${vote.result ? `; ${vote.result}` : ""})`);
  const list = items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join("; ")}; and ${items.at(-1)}`;
  const lead = terms.length === 0 ? `${input.name}'s latest votes: ` : `${input.name} voted `;
  const sentences = [`${lead}${list}`];
  return { answer: `${sentences.join(". ")}.`, citedUrls: [...new Set(shown.map((vote) => vote.sourceUrl))] };
}
