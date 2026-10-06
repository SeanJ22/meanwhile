import { normalizeName } from "../routing/exact-name.ts";
import type { EvidenceRecord } from "./evidence.ts";
import type { LocalVoteRecord } from "../outcomes/local-votes.ts";
import { formatDateLong } from "../text/format-date.ts";

/**
 * **HOW A NAMED PERSON VOTED IS A LIST WE HOLD, NOT A PARAGRAPH TO WRITE.**
 * (2026-09-29, S3.)
 *
 * Measured on staging that day: *"How did Juan Ciscomani vote on the budget?"* sent
 * the fast writer 104 records (about 36,000 tokens) and took 11.6 s — the fast
 * writer timed out and the escalation writer answered — and *"How has Juan
 * Ciscomani voted?"* was rejected for length by both writers and shipped as bare
 * records after 8 s. Every roll call we hold for a person is one record that
 * already states the position, the measure, the day and the result in the
 * chamber's own words. So the answer is composed from those records:
 *
 * - **No topic** ("How has X voted?"): the most recent recorded votes, newest first.
 * - **A topic** ("...on the budget"): the recorded votes whose own words share a
 *   content word with it, newest first — only when at least one does. A question
 *   whose topic no roll-call title carries ("immigration": the Laken Riley Act's
 *   title says nothing of it) is the writer's, over the relevant selection
 *   (`lib/ask/writer-selection.ts`), exactly as before.
 *
 * Every figure and every position is a record's own field; nothing is summed,
 * characterised or inferred, and the answer says how many recorded votes we hold
 * so a short list never reads as the whole record. It faces the same validator a
 * model answer does.
 */

export interface PersonVotesQuestion {
  /** The words naming the person. Nothing is bound here. */
  slot: string;
  /** What the votes are asked to be about, or null for "how has X voted?". */
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
  const normalized = normalizeName(question);
  if (!normalized || normalized.length > 140) return null;
  for (const form of FORMS) {
    const match = form.exec(normalized);
    const slot = match?.[1]?.trim();
    if (!slot || PRONOUNS.test(slot)) continue;
    const topic = match?.[2]?.trim().replace(/^(?:the|a|an) /, "") ?? null;
    if (topic !== null && (topic.split(" ").length > 6 || /\b(?:and|or|but)\b/.test(topic))) return null;
    return { slot, topic: topic && topic.length > 0 ? topic : null };
  }
  return null;
}

/** Words that name what is asked rather than what it is about (the writer selection's list, for the same reason). */
const FILLER: ReadonlySet<string> = new Set([
  "vote", "voted", "votes", "voting", "record", "bill", "bills", "law", "laws", "measure", "measures", "legislation", "issue", "issues", "thing", "things",
  "that", "this", "with", "from", "have", "been", "were", "was", "are", "the", "and", "for", "their", "they", "them",
]);

/** The content words of a topic, lightly stemmed ("budgets" and "budget" are one). */
export function topicTerms(topic: string): string[] {
  return [...new Set(normalizeName(topic).split(" ")
    .filter((word) => word.length >= 4 && !FILLER.has(word))
    .map((word) => word.replace(/(?:ing|es|s)$/, ""))
    .filter((word) => word.length >= 3))];
}

const MOST_RECENT_SHOWN = 3;

type RollCallRecord = EvidenceRecord & { rollCall: NonNullable<EvidenceRecord["rollCall"]> };

/**
 * Compose the answer, or null when a writer should: no roll call is held for the
 * person, a topic is named that no held roll call's own words carry, or the
 * answer would not fit the length contract.
 */
export function composePersonVotes(input: {
  name: string;
  topic: string | null;
  records: readonly EvidenceRecord[];
}): { answer: string; citedUrls: string[] } | null {
  const held = input.records.filter((record): record is RollCallRecord => record.kind === "ROLL_CALL_VOTE" && Boolean(record.rollCall) && Boolean(record.sourceUrl));
  if (held.length === 0) return null;
  const terms = input.topic ? topicTerms(input.topic) : [];
  if (input.topic && terms.length === 0) return null;
  const matching = terms.length === 0 ? held : held.filter((record) => terms.some((term) => `${record.rollCall.what} ${record.text}`.toLowerCase().includes(term)));
  if (matching.length === 0) return null;
  const shown = [...matching].sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "")).slice(0, MOST_RECENT_SHOWN);
  const items = shown.map((record) => `${record.rollCall.position} on ${record.rollCall.what} (${record.rollCall.when}; ${record.rollCall.result})`);
  const list = items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join("; ")}; and ${items.at(-1)}`;
  const lead = terms.length === 0 ? `${input.name}'s most recent recorded votes: ` : `${input.name}'s recorded votes that match the question, newest first: `;
  const sentences = [`${lead}${list}`];
  const more = matching.length - shown.length;
  if (more > 0) sentences.push(`We hold ${matching.length} ${terms.length === 0 ? "recorded votes" : "matching recorded votes"} for ${input.name}; the rest are listed below`);
  return { answer: `${sentences.join(". ")}.`, citedUrls: [...new Set(shown.map((record) => record.sourceUrl!))] };
}

/**
 * A local official's votes, composed from the records the outcome store links to
 * them by roster member (BX-11). The position is the publisher's own word, the
 * item is the agenda's own title, and the sitting page is the citation. Null
 * when none is held, a topic is named that no item title carries, or nothing
 * shown would carry a date we can state.
 */
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
  const lead = terms.length === 0 ? `${input.name}'s most recent recorded votes: ` : `${input.name}'s recorded votes that match the question, newest first: `;
  const sentences = [`${lead}${list}`];
  const more = matching.length - shown.length;
  if (more > 0) sentences.push(`We hold ${matching.length} ${terms.length === 0 ? "recorded votes" : "matching recorded votes"} for ${input.name}; the rest are listed below`);
  return { answer: `${sentences.join(". ")}.`, citedUrls: [...new Set(shown.map((vote) => vote.sourceUrl))] };
}
