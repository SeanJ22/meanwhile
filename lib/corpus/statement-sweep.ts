import { POSITION_TOPICS, positionsFor, searchTerms } from "./positions.ts";
import type { PositionAnswerKind } from "./positions.ts";
import { sourceKindLabel } from "./source-kinds.ts";
import type { SourceSnapshot, StatementCorpus } from "./types.ts";

/**
 * One sweep record per person and topic, saying which held sources were
 * searched. A held page counts for a person when it is held under their id or
 * quotes them by name; every topic is searched against the same pages. "Not
 * found in the sources checked" may be shown only when `mayShowNotFound`. Pure.
 */

export interface SweepPerson {
  /** Roster officeholder id or ballot candidacy id, as the corpus keys it. */
  readonly subjectId: string;
  /** Used only to find held pages that quote the person by name. */
  readonly name: string;
}

export interface SweepSource {
  readonly url: string;
  /** Source-kind label, as a reader sees it in a Sources row. */
  readonly kindLabel: string;
  /** Held under their id, or quoting them by name on someone else's page. */
  readonly basis: "THEIRS" | "QUOTES_BY_NAME";
}

export interface TopicSweep {
  readonly topic: string;
  readonly answer: PositionAnswerKind;
  readonly passages: number;
  /** The same list for every topic of the person: equal effort by construction. */
  readonly sourcesSearched: readonly SweepSource[];
}

export interface SweepRecord {
  readonly subjectId: string;
  readonly topics: readonly TopicSweep[];
  /** Pages we hold for them but could not read. Named, never counted as read. */
  readonly unreadable: number;
  /** True when every sweep topic was searched against the same, non-empty set of pages. */
  readonly equalEffort: boolean;
}

/** Collapse whitespace and case so a name matches across line breaks. */
function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

/**
 * A name worth matching on another page's text: at least two words, so a
 * single common first name never makes a page "theirs".
 */
function nameNeedle(name: string): string | null {
  const words = squash(name).replace(/[^\p{L}\p{N} ]/gu, " ").split(" ").filter(Boolean);
  return words.length >= 2 ? words.join(" ") : null;
}

/** Held pages that count for one person: theirs, or quoting them by name. */
export function pagesCountingFor(
  person: SweepPerson,
  corpus: StatementCorpus,
): { readonly pages: readonly SourceSnapshot[]; readonly sources: readonly SweepSource[]; readonly unreadable: number } {
  const needle = nameNeedle(person.name);
  const pages: SourceSnapshot[] = [];
  const basisByUrl = new Map<string, SweepSource>();
  let unreadable = 0;
  for (const s of corpus.snapshots) {
    const theirs = s.subjectId === person.subjectId;
    if (theirs && !(s.extraction === "ok" && s.text)) {
      unreadable += 1;
      continue;
    }
    if (!(s.extraction === "ok" && s.text)) continue;
    const quotes = !theirs && needle !== null && squash(s.text).replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").includes(needle);
    if (!theirs && !quotes) continue;
    pages.push(s);
    const prior = basisByUrl.get(s.url);
    // A page held under their id stays "theirs" even if another copy quotes them.
    if (!prior || (theirs && prior.basis !== "THEIRS")) {
      basisByUrl.set(s.url, {
        url: s.url,
        kindLabel: sourceKindLabel(s.kind),
        basis: theirs ? "THEIRS" : "QUOTES_BY_NAME",
      });
    }
  }
  return { pages, sources: [...basisByUrl.values()].sort((a, b) => a.url.localeCompare(b.url)), unreadable };
}

/** One person's sweep: every topic, over the same pages. */
export function sweepPerson(
  person: SweepPerson,
  corpus: StatementCorpus,
  topics: readonly string[] = POSITION_TOPICS,
): SweepRecord {
  const { pages, sources, unreadable } = pagesCountingFor(person, corpus);
  // Pages that only quote the person are re-keyed to them, so the one
  // three-answer search reads exactly the pages that count.
  const scoped: StatementCorpus = {
    snapshots: pages.map((s) => (s.subjectId === person.subjectId ? s : { ...s, subjectId: person.subjectId })),
  };
  const swept: TopicSweep[] = topics.map((topic) => {
    const answer = positionsFor(person.subjectId, topic, scoped);
    return {
      topic,
      answer: answer.kind,
      passages: answer.passages.length,
      sourcesSearched: sources,
    };
  });
  return {
    subjectId: person.subjectId,
    topics: swept,
    unreadable,
    equalEffort: sources.length > 0 && topics.length > 0 && topics.every((t) => searchTerms(t).length > 0),
  };
}

/**
 * "Not found in the sources checked" is shown only for a topic that an
 * equal-effort sweep searched and found nothing for. Anything else keeps
 * "We're working on getting this info" while the sweep stays standing work.
 */
export function mayShowNotFound(record: SweepRecord, topic: string): boolean {
  if (!record.equalEffort) return false;
  const row = record.topics.find((t) => t.topic === topic);
  return row?.answer === "SEARCHED_NOTHING_MATCHED";
}
