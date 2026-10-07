import { DEFAULT_STANCE_TOPICS } from "../stances/topics.ts";
import type { SourceSnapshot, StatementCorpus } from "./types.ts";

/**
 * Answers "what has this person said about X" in exactly one of three ways:
 *   MATCHED                   verbatim passages from their published pages
 *   SEARCHED_NOTHING_MATCHED  we read N of their pages and none mentioned it
 *   NOT_YET_COLLECTED         we have not read anything of theirs yet
 * The last two never render as each other or as "no position". Nothing is
 * summarised or characterised. Two snapshots of one URL with different hashes
 * mark that the page changed, with dates only, never what changed.
 */

/** Which of the three answers this is. Closed, and each is a different fact. */
export type PositionAnswerKind =
  | "MATCHED"
  | "SEARCHED_NOTHING_MATCHED"
  | "NOT_YET_COLLECTED";

export interface PositionPassage {
  snapshotId: string;
  /** The page it came from — the reader's own way to check us. */
  url: string;
  kind: SourceSnapshot["kind"];
  title: string | null;
  /** When we read the page. Rendered on every passage, never omitted. */
  retrievedAt: string;
  /** VERBATIM. A contiguous run of the page's own words and nothing else. */
  quote: string;
  /** The reader's own terms that hit, so the match is checkable. */
  matchedTerms: string[];
  /** The page changed between two reads. Dates only, never what changed. */
  changedSince: string | null;
}

export interface PositionAnswer {
  kind: PositionAnswerKind;
  /** What was searched for, as the reader typed it. */
  topic: string;
  /** Only ever non-empty on MATCHED. */
  passages: PositionPassage[];
  /** The denominator, on every answer including the empty ones. */
  searched: {
    /** Distinct URLs of this subject's that we hold readable text for. */
    pages: number;
    /** Snapshots read, which is ≥ pages because the corpus is append-only. */
    snapshots: number;
    /** Snapshots we hold but could not read — named, never counted as read. */
    unreadable: number;
    /**
     * Passages that contain the term but exceed PASSAGE_MAX_CHARS (e.g. a link
     * rail with no full stop), so are not quoted. Counted so the answer does not
     * claim they never mentioned it.
     */
    presentButUnquotable: number;
  };
  /** Their own published page for when we have nothing; never a search engine or a guess. */
  theirPage: string | null;
}

/** How much of a page a single passage may carry. Long enough to be a real
 *  statement in context, short enough not to be a republication. */
export const PASSAGE_MAX_CHARS = 420;

/** The shortest term worth searching. Below this every page matches. */
export const MIN_TERM_CHARS = 3;

/** Words a reader searches with, not for. Stripped from the query; nothing is stemmed. */
const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can",
  "her", "was", "one", "our", "out", "his", "has", "had", "how", "its",
  "who", "did", "does", "what", "when", "where", "why", "about", "with",
  "she", "him", "hers", "theirs", "your", "yours", "mine",
  "from", "that", "this", "they", "them", "their", "there", "would", "should",
  "think", "thinks", "position", "positions", "stance", "say", "says", "said",
  "view", "views", "on",
]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The reader's query, reduced to the words actually worth matching. */
export function searchTerms(topic: string): string[] {
  return [
    ...new Set(
      normalize(topic)
        .split(" ")
        .filter((w) => w.length >= MIN_TERM_CHARS && !STOP_WORDS.has(w)),
    ),
  ];
}

/**
 * Splits extracted page text on sentence punctuation. Each run is returned
 * exactly as it appears apart from trimmed whitespace.
 */
export function passagesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * The `retrievedAt` of the newest EARLIER snapshot of the same URL whose
 * content hash differs — i.e. the page changed between then and this read.
 * Null when we hold only one read, or when every read matched.
 */
function changedSince(
  snapshot: SourceSnapshot,
  all: readonly SourceSnapshot[],
): string | null {
  const earlier = all
    .filter(
      (s) =>
        s.url === snapshot.url &&
        s.retrievedAt < snapshot.retrievedAt &&
        s.contentHash !== snapshot.contentHash,
    )
    .sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt));
  return earlier[0]?.retrievedAt ?? null;
}

/** The subject's campaign site, else an official page, else null. */
function theirPageFrom(mine: readonly SourceSnapshot[]): string | null {
  const campaign = mine.find((s) => s.kind === "CAMPAIGN_SITE");
  return campaign?.url ?? mine[0]?.url ?? null;
}

/** Pure: the corpus is an argument. */
export function positionsFor(
  subjectId: string,
  topic: string,
  corpus: StatementCorpus,
): PositionAnswer {
  const mine = corpus.snapshots.filter((s) => s.subjectId === subjectId);
  const readable = mine.filter((s) => s.extraction === "ok" && s.text);
  const searched = {
    pages: new Set(readable.map((s) => s.url)).size,
    snapshots: readable.length,
    unreadable: mine.length - readable.length,
    presentButUnquotable: 0,
  };
  const theirPage = theirPageFrom(mine);

  // Not yet collected is checked first: there was no search to report on.
  if (readable.length === 0) {
    return {
      kind: "NOT_YET_COLLECTED",
      topic,
      passages: [],
      searched,
      theirPage,
    };
  }

  const terms = searchTerms(topic);
  const hits: PositionPassage[] = [];
  if (terms.length > 0) {
    // Newest first, so a reader sees the most recent thing the page said.
    const ordered = [...readable].sort((a, b) =>
      b.retrievedAt.localeCompare(a.retrievedAt),
    );
    const seen = new Set<string>();
    for (const snapshot of ordered) {
      for (const raw of passagesOf(snapshot.text as string)) {
        if (raw.length > PASSAGE_MAX_CHARS) {
          // Count the too-long passages that would have matched; see `searched.presentButUnquotable`.
          const long = ` ${normalize(raw)} `;
          if (terms.some((t) => long.includes(` ${t} `))) {
            searched.presentButUnquotable += 1;
          }
          continue;
        }
        const normalized = ` ${normalize(raw)} `;
        const matched = terms.filter((t) => normalized.includes(` ${t} `));
        if (matched.length === 0) continue;
        // The same boilerplate sentence on every page of a site counts once.
        const key = normalize(raw);
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          snapshotId: snapshot.id,
          url: snapshot.url,
          kind: snapshot.kind,
          title: snapshot.title,
          retrievedAt: snapshot.retrievedAt,
          quote: raw,
          matchedTerms: matched,
          changedSince: changedSince(snapshot, mine),
        });
      }
    }
  }

  if (hits.length === 0) {
    return {
      kind: "SEARCHED_NOTHING_MATCHED",
      topic,
      passages: [],
      searched,
      theirPage,
    };
  }

  // Ranked only by how many of the reader's terms a passage carries.
  hits.sort(
    (a, b) =>
      b.matchedTerms.length - a.matchedTerms.length ||
      b.retrievedAt.localeCompare(a.retrievedAt),
  );
  return {
    kind: "MATCHED",
    topic,
    passages: hits,
    searched,
    theirPage,
  };
}

/** The count uses the same canonical answer as the visual and Ask surfaces. */
export function positionMatchCount(
  subjectId: string,
  topic: string,
  corpus: StatementCorpus,
): number {
  const answer = positionsFor(subjectId, topic, corpus);
  return answer.passages.length;
}

/**
 * Topic chips beside the search box: curated plain nouns, never derived from
 * the corpus (that would reflect what candidates chose to talk about) and
 * never framings.
 */
export const POSITION_TOPICS: readonly string[] = DEFAULT_STANCE_TOPICS.map((topic) => topic.label);
