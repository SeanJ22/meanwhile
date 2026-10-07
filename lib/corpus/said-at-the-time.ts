import { PASSAGE_MAX_CHARS, normalize, passagesOf, searchTerms } from "./positions.ts";
import { pagesCountingFor } from "./statement-sweep.ts";
import { sourceKindLabel } from "./source-kinds.ts";
import type { SourceSnapshot, StatementCorpus } from "./types.ts";

/**
 * For one person's recorded vote on one agenda item, attaches their verbatim
 * statements around it from two held sources: passages of that sitting's
 * minutes that name them and share the item's content words, and their own
 * dated social posts within SAID_AT_THE_TIME_DAYS of the vote sharing those
 * words. An undated post is never tied to a vote. The vote is never
 * characterised. An empty answer says which case it is: NOT_YET_COLLECTED, or
 * `searched` pages with no matching passage. Pure.
 */

export interface VoteMoment {
  /** Roster officeholder id or ballot candidacy id, as the corpus keys it. */
  readonly subjectId: string;
  readonly personName: string;
  /** The agenda item as the publisher titles it. */
  readonly itemTitle: string;
  /** The sitting's calendar day (YYYY-MM-DD). */
  readonly votedOn: string;
  /** The sitting's minutes document, when one is held; its address is the page's own. */
  readonly minutesUrl: string | null;
}

export interface SaidAtTheTime {
  readonly kind: "MINUTES" | "SOCIAL_POST";
  /** Reader label for the Sources row. */
  readonly kindLabel: string;
  readonly url: string;
  /** VERBATIM: one passage of the source, edited only by trimming whitespace. */
  readonly quote: string;
  /** The day the post was published, for a social post; the sitting's day for minutes. */
  readonly dated: string;
  readonly retrievedAt: string;
}

export interface SaidAtTheTimeResult {
  readonly state: "FOUND" | "SEARCHED_NOTHING_MATCHED" | "NOT_YET_COLLECTED";
  readonly statements: readonly SaidAtTheTime[];
  /** The denominator, on every answer: distinct pages read, and pages held but unreadable. */
  readonly searched: { readonly pages: number; readonly unreadable: number };
}

/** A post this many days either side of the vote still counts as "at the time". */
export const SAID_AT_THE_TIME_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00.000Z`) - Date.parse(`${b}T00:00:00.000Z`)) / DAY_MS;
}

/** A passage shares the item when it carries at least min(2, number of item words) of them, as whole words. */
function carriesItem(passage: string, terms: readonly string[]): boolean {
  const padded = ` ${normalize(passage)} `;
  const hits = terms.filter((term) => padded.includes(` ${term} `)).length;
  return hits >= Math.min(2, terms.length);
}

function nameWords(name: string): string[] {
  return normalize(name).split(" ").filter((word) => word.length >= 3);
}

/** The minutes name the person when their surname (the last word of the name) stands as a whole word. */
function namesPerson(passage: string, name: string): boolean {
  const last = nameWords(name).at(-1);
  return last !== undefined && ` ${normalize(passage)} `.includes(` ${last} `);
}

export function saidAtTheTime(
  moment: VoteMoment,
  corpus: StatementCorpus,
  windowDays: number = SAID_AT_THE_TIME_DAYS,
): SaidAtTheTimeResult {
  const theirs = pagesCountingFor({ subjectId: moment.subjectId, name: moment.personName }, corpus);
  // The sitting's minutes are usually held under the body, not the person, and name a member by surname alone.
  const readable = (page: SourceSnapshot) => page.extraction === "ok" && Boolean(page.text);
  const minutesPages = moment.minutesUrl === null ? [] : corpus.snapshots.filter((page) => page.kind === "MINUTES" && page.url === moment.minutesUrl);
  const pages = [...new Map([...theirs.pages, ...minutesPages.filter(readable)].map((page) => [page.id, page])).values()];
  const searched = {
    pages: new Set(pages.map((page) => page.url)).size,
    unreadable: theirs.unreadable + minutesPages.filter((page) => !readable(page) && page.subjectId !== moment.subjectId).length,
  };
  if (pages.length === 0) return { state: "NOT_YET_COLLECTED", statements: [], searched };
  const terms = searchTerms(moment.itemTitle);
  const statements: SaidAtTheTime[] = [];
  const seen = new Set<string>();
  const add = (page: SourceSnapshot, passage: string, kind: SaidAtTheTime["kind"], dated: string) => {
    const key = `${page.url}|${normalize(passage)}`;
    if (seen.has(key)) return;
    seen.add(key);
    statements.push({ kind, kindLabel: sourceKindLabel(kind), url: page.url, quote: passage, dated, retrievedAt: page.retrievedAt });
  };
  if (terms.length > 0) {
    for (const page of pages) {
      if (!page.text) continue;
      if (page.kind === "MINUTES" && page.url === moment.minutesUrl) {
        for (const passage of passagesOf(page.text)) {
          if (passage.length <= PASSAGE_MAX_CHARS && namesPerson(passage, moment.personName) && carriesItem(passage, terms)) add(page, passage, "MINUTES", moment.votedOn);
        }
      } else if (page.kind === "SOCIAL_POST" && page.subjectId === moment.subjectId && page.postedOn && daysApart(page.postedOn, moment.votedOn) <= windowDays) {
        for (const passage of passagesOf(page.text)) {
          if (passage.length <= PASSAGE_MAX_CHARS && carriesItem(passage, terms)) add(page, passage, "SOCIAL_POST", page.postedOn);
        }
      }
    }
  }
  statements.sort((a, b) => a.dated.localeCompare(b.dated) || a.url.localeCompare(b.url));
  return { state: statements.length > 0 ? "FOUND" : "SEARCHED_NOTHING_MATCHED", statements, searched };
}
