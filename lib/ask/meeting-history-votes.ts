import { normalizeName } from "../routing/exact-name.ts";
import { formatDateLong } from "../text/format-date.ts";
import { topicTerms } from "./person-votes.ts";
import type { PersistedSittingOutcomes } from "../outcomes/types.ts";

/**
 * **HOW A BODY OR ONE MEMBER VOTED ON AN ITEM, ACROSS EVERY SITTING WE HOLD.** (CA-41.)
 *
 * The outcome store keeps every sitting past the routine window (DB-07), and a
 * concluded sitting's record lives in the meeting history projection (DB-06).
 * Ask used to read one chosen sitting at a time, so "how did the board vote on
 * the library budget" about a sitting 120 or more days back had no way in unless
 * the reader named the date. This module reads all of a body's held sittings,
 * by body or by person, with no date window, and composes the answer from the
 * publisher's own rows: the date, the item as the agenda titles it, the
 * publisher's result words, and each member's recorded word, unmapped and never
 * summed. It adds no claim; what is not matched is the writer's, as before.
 *
 * Pure: the sittings are an argument (`sittingsForBody(bodyId)` in the route).
 */

export interface HistoricalVote {
  readonly person: string;
  /** The publisher's own word: "Aye", "Nay", "Recused", "Not Present". */
  readonly value: string;
}

export interface HistoricalVoteItem {
  readonly meetingId: string;
  readonly bodyName: string;
  /** The sitting's own calendar day, as the publisher dated it. */
  readonly date: string;
  readonly eventItemId: number;
  /** The item as the agenda prints it. */
  readonly item: string;
  /** The publisher's own result words, or null when none is recorded. */
  readonly result: string | null;
  readonly votes: readonly HistoricalVote[];
  readonly sourceUrl: string;
  readonly retrievedAt: string | null;
}

/** Courtesy and office words that name a role, not the person. */
const ROLE_WORDS: ReadonlySet<string> = new Set([
  "mayor", "vice", "chair", "chairman", "chairwoman", "chairperson", "member", "councilmember", "councilman", "councilwoman", "council",
  "supervisor", "commissioner", "trustee", "director", "board", "dr", "mr", "mrs", "ms", "the", "of", "president", "senator", "representative",
]);

function nameTokens(name: string): string[] {
  return normalizeName(name).split(" ").filter((word) => word.length > 0);
}

/** The person's own words in the question, with titles dropped: "Mayor Romero" is `romero`. */
function personTokens(person: string): string[] {
  return nameTokens(person).filter((word) => !ROLE_WORDS.has(word));
}

/**
 * A recorded vote belongs to the person asked about when every name word the
 * reader gave appears in the publisher's name for the voter (as whole words),
 * and the reader gave at least one. "Romero" matches "Regina Romero"; "Regina
 * Romero" does not match "Romero, Carlos". The comparison is on words, so a
 * surname inside a longer one never matches.
 */
export function voteIsBy(personName: string | null, asked: string): boolean {
  if (!personName) return false;
  const wanted = personTokens(asked);
  if (wanted.length === 0) return false;
  const have = new Set(nameTokens(personName));
  return wanted.every((word) => have.has(word));
}

function itemTitleFor(sitting: PersistedSittingOutcomes, eventItemId: number): string | null {
  const agenda = sitting.agenda.find((record) => record.eventItemId === eventItemId);
  if (agenda?.title) return agenda.title;
  const action = sitting.outcomes.find((record) => record.eventItemId === eventItemId);
  return action?.itemQuote ?? null;
}

/**
 * Every held per-member vote item across the given sittings that matches the
 * question: for the named person when one is given (only the items that member
 * has a recorded word on), and whose title shares a content word with the topic
 * when one is given. Newest first. No window: a sitting of any age counts.
 */
export function historicalVoteItems(
  sittings: readonly PersistedSittingOutcomes[],
  ask: { readonly person: string | null; readonly topic: string | null },
): HistoricalVoteItem[] {
  const terms = ask.topic ? topicTerms(ask.topic) : [];
  if (ask.topic && terms.length === 0) return [];
  const items: HistoricalVoteItem[] = [];
  for (const sitting of sittings) {
    const date = sitting.startsAt?.slice(0, 10);
    if (!date || !formatDateLong(date)) continue;
    for (const roll of sitting.rollCalls) {
      const item = itemTitleFor(sitting, roll.eventItemId);
      if (!item) continue;
      if (terms.length > 0) {
        const lowered = normalizeName(item);
        if (!terms.some((term) => lowered.includes(term))) continue;
      }
      const recorded = roll.votes.filter((vote): vote is typeof vote & { personName: string; value: string } => Boolean(vote.personName && vote.value));
      const votes = (ask.person ? recorded.filter((vote) => voteIsBy(vote.personName, ask.person!)) : recorded)
        .map((vote) => ({ person: vote.personName, value: vote.value }));
      if (votes.length === 0) continue;
      const action = sitting.outcomes.find((record) => record.eventItemId === roll.eventItemId);
      items.push({
        meetingId: sitting.meetingId,
        bodyName: sitting.bodyName,
        date,
        eventItemId: roll.eventItemId,
        item,
        result: action?.dispositionRaw ?? null,
        votes,
        sourceUrl: roll.provenance.endpoint,
        retrievedAt: roll.provenance.readOn === "NEVER_READ" ? null : roll.provenance.readOn,
      });
    }
  }
  return items.sort((a, b) => b.date.localeCompare(a.date) || b.eventItemId - a.eventItemId);
}

const SHOWN = 3;

/** "Aye: A, B; Nay: C", in the order the publisher's words first appear. */
function votesPhrase(votes: readonly HistoricalVote[]): string {
  const groups = new Map<string, string[]>();
  for (const vote of votes) groups.set(vote.value, [...(groups.get(vote.value) ?? []), vote.person]);
  return [...groups].map(([value, people]) => `${value}: ${people.join(", ")}`).join("; ");
}

/**
 * Compose the answer, or null when a writer should: nothing held matches, or a
 * topic is named that no item title carries. The date span of everything held
 * matching is stated so a short list never reads as the whole record.
 */
export function composeHistoricalVotes(input: {
  /** The words naming the person, or null for the body as a whole. */
  person: string | null;
  /** The body's name as the reader knows it, for "the board voted". */
  bodyName: string;
  topic: string | null;
  items: readonly HistoricalVoteItem[];
}): { answer: string; citedUrls: string[]; held: number } | null {
  if (input.items.length === 0) return null;
  const shown = input.items.slice(0, SHOWN);
  const lines = shown.map((entry) => {
    const when = formatDateLong(entry.date)!;
    const result = entry.result ? `; the published result was "${entry.result}"` : "";
    return input.person
      ? `On ${when}, ${entry.votes.map((vote) => `${vote.person} voted ${vote.value}`).join(" and ")} on "${entry.item}" (${entry.bodyName}${result})`
      : `On ${when}, on "${entry.item}" (${entry.bodyName}${result}), the recorded votes were ${votesPhrase(entry.votes)}`;
  });
  const sentences = [...lines];
  const oldest = input.items.at(-1)!.date;
  const newest = input.items[0]!.date;
  const span = oldest === newest ? `on ${formatDateLong(newest)}` : `from ${formatDateLong(oldest)} to ${formatDateLong(newest)}`;
  const noun = input.items.length === 1 ? "recorded vote item" : "recorded vote items";
  const who = input.person ? `for ${input.person}` : `for ${input.bodyName}`;
  sentences.push(`We hold ${input.items.length} matching ${noun} ${who}, ${span}${input.items.length > shown.length ? "; the rest are listed below" : ""}`);
  return {
    answer: `${sentences.join(". ")}.`,
    citedUrls: [...new Set(shown.map((entry) => entry.sourceUrl))],
    held: input.items.length,
  };
}
