import { normalizeName } from "../routing/exact-name.ts";
import { SECTION3_MINIMUMS } from "../control-plane/promotion/section3.ts";
import type { PersistedSittingOutcomes } from "./types.ts";

/**
 * **LOCAL VOTES, LINKED TO THE PEOPLE WHO CAST THEM.** (BX-11.)
 *
 * A roll call from a body's minutes names each voter as the publisher printed
 * the name. Until now a reader asking how their mayor voted got that string
 * matched against the question by words (`voteIsBy`), so "Romero" matched any
 * voter whose name held the word. This module joins each recorded vote to the
 * published roster member who sits on the SAME body, and keeps only the votes
 * that join exactly one member:
 *
 * - The roster is the body's own (`rosterForBody`), so a same-named person on
 *   another body is never a candidate.
 * - The names are compared as whole name words, in any order, ignoring case,
 *   punctuation, titles and a single middle initial. "Romero, Regina" joins
 *   "Regina Romero"; "Romero" alone does not join anyone, and neither does a
 *   voter two members could be.
 * - A vote the roster cannot place is counted as unlinked and is not shown on
 *   any card; it stays in the sitting's roll call, whole, for the meeting page.
 *
 * Each linked vote is a VOTE record at the design minimum
 * (`SECTION3_MINIMUMS.VOTE`: person, subject, position, date). The position is
 * the publisher's own word, unmapped; the subject is the item as the agenda
 * prints it; the source is the sitting's own page. Nothing is summed or
 * characterised.
 */

/** The roster members of a body, as far as the join needs them. */
export interface LocalVoteRosterMember {
  readonly id: string;
  readonly name: string;
  readonly officeTitle?: string | null;
}
export type LocalVoteRosterFor = (bodyId: string) => readonly LocalVoteRosterMember[];

export interface LocalVoteRecord {
  readonly recordClass: "VOTE";
  /** Stable for one vote of one member on one item: `<meetingId>#<eventItemId>:<memberId>`. */
  readonly id: string;
  /** The published roster member this vote belongs to. */
  readonly personId: string;
  /** The roster's name for them. */
  readonly person: string;
  /** The voter as the publisher printed them. */
  readonly votedAs: string;
  readonly bodyId: string;
  readonly bodyName: string;
  readonly meetingId: string;
  readonly eventItemId: number;
  /** The item as the agenda prints it. */
  readonly subject: string;
  /** The publisher's own word, unmapped: "Aye", "Nay", "Recused". */
  readonly position: string;
  /** The sitting's calendar day, `YYYY-MM-DD`. */
  readonly date: string;
  /** The publisher's own result words for the item, or null when none is recorded. */
  readonly result: string | null;
  readonly sourceUrl: string;
  readonly retrievedAt: string | null;
}

export interface LocalVoteLinking {
  readonly records: readonly LocalVoteRecord[];
  /** Recorded votes by a named voter that no single roster member could be joined to. */
  readonly unlinked: number;
  /** Recorded votes held in the sittings read (named voter with a word). */
  readonly considered: number;
}

/** Courtesy and office words that name a role, not the person. */
const ROLE_WORDS: ReadonlySet<string> = new Set([
  "mayor", "vice", "chair", "chairman", "chairwoman", "chairperson", "member", "councilmember", "councilman", "councilwoman", "council",
  "supervisor", "commissioner", "trustee", "director", "board", "dr", "mr", "mrs", "ms", "president", "senator", "representative",
  "alderman", "alderwoman", "selectman", "selectwoman", "jr", "sr", "ii", "iii", "iv",
]);

/** The name words that identify a person: titles and suffixes dropped, one-letter middle initials dropped. */
export function identityWords(name: string): string[] {
  const words = normalizeName(name).split(" ").filter((word) => word.length > 0 && !ROLE_WORDS.has(word));
  return words.length > 2 ? words.filter((word) => word.length > 1) : words;
}

const sameWords = (a: readonly string[], b: readonly string[]): boolean =>
  a.length >= 2 && a.length === b.length && [...a].sort().join(" ") === [...b].sort().join(" ");

/**
 * The one roster member a voter's printed name joins, or null. Two or more
 * members the same name could mean, or none, is no join.
 */
export function rosterMemberForVoter(
  voter: string,
  roster: readonly LocalVoteRosterMember[],
): LocalVoteRosterMember | null {
  const wanted = identityWords(voter);
  if (wanted.length < 2) return null;
  const matches = roster.filter((member) => sameWords(wanted, identityWords(member.name)));
  return matches.length === 1 ? matches[0]! : null;
}

function itemTitle(sitting: PersistedSittingOutcomes, eventItemId: number): string | null {
  const agenda = sitting.agenda.find((record) => record.eventItemId === eventItemId);
  if (agenda?.title) return agenda.title;
  return sitting.outcomes.find((record) => record.eventItemId === eventItemId)?.itemQuote ?? null;
}

/** The minimum a VOTE record needs before it is a fact (§3): every named field holds a value. */
export function voteMeetsMinimum(record: Pick<LocalVoteRecord, "person" | "subject" | "position" | "date">): boolean {
  return (SECTION3_MINIMUMS.VOTE ?? []).every((field) => String((record as unknown as Record<string, unknown>)[field] ?? "").trim().length > 0);
}

/** Join every sitting's recorded votes to the roster of the body that sat. Pure. */
export function linkLocalVotes(
  sittings: readonly PersistedSittingOutcomes[],
  rosterFor: LocalVoteRosterFor,
): LocalVoteLinking {
  const records: LocalVoteRecord[] = [];
  let unlinked = 0;
  let considered = 0;
  for (const sitting of sittings) {
    const date = sitting.startsAt?.slice(0, 10) ?? "";
    const roster = sitting.bodyId ? rosterFor(sitting.bodyId) : [];
    for (const roll of sitting.rollCalls) {
      const subject = itemTitle(sitting, roll.eventItemId);
      const result = sitting.outcomes.find((record) => record.eventItemId === roll.eventItemId)?.dispositionRaw ?? null;
      for (const vote of roll.votes) {
        if (!vote.personName || !vote.value) continue;
        considered += 1;
        const member = sitting.bodyId && sitting.sourceUrl ? rosterMemberForVoter(vote.personName, roster) : null;
        const record: LocalVoteRecord | null = member && subject && sitting.bodyId && sitting.sourceUrl
          ? {
              recordClass: "VOTE",
              id: `${sitting.meetingId}#${roll.eventItemId}:${member.id}`,
              personId: member.id,
              person: member.name,
              votedAs: vote.personName,
              bodyId: sitting.bodyId,
              bodyName: sitting.bodyName,
              meetingId: sitting.meetingId,
              eventItemId: roll.eventItemId,
              subject,
              position: vote.value,
              date,
              result,
              sourceUrl: sitting.sourceUrl,
              retrievedAt: roll.provenance.readOn === "NEVER_READ" ? null : roll.provenance.readOn,
            }
          : null;
        if (record && voteMeetsMinimum(record)) records.push(record);
        else unlinked += 1;
      }
    }
  }
  records.sort((a, b) => b.date.localeCompare(a.date) || b.eventItemId - a.eventItemId || a.id.localeCompare(b.id));
  return { records, unlinked, considered };
}

/** One member's linked votes, newest first. */
export function localVotesForMember(records: readonly LocalVoteRecord[], personId: string): LocalVoteRecord[] {
  return records.filter((record) => record.personId === personId);
}
