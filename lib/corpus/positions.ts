import type { SourceSnapshot, StatementCorpus } from "./types.ts";

/**
 * D35 — THE THREE-ANSWER MACHINERY (built 2026-08-17).
 *
 * ## Why three answers and not two
 *
 * The corpus has held snapshots of what candidates and officials publish
 * since 3e, and nothing has rendered from it. `types.ts` says why in as many
 * words: *"rendering requires the three-answer machinery first — matched /
 * searched-and-nothing / not-yet-collected, each with its denominator —
 * because without it an empty match silently reads as 'this person has no
 * position on X', which is a false claim about a person."*
 *
 * That is the whole design. An empty result is not one fact, it is two, and
 * they are not close:
 *
 * | answer | what it says | whose fact it is |
 * |---|---|---|
 * | `MATCHED` | here is what they published, verbatim | theirs |
 * | `SEARCHED_NOTHING_MATCHED` | we read N pages of theirs and none mentioned it | ours, and bounded |
 * | `NOT_YET_COLLECTED` | we have not read anything of theirs yet | ours, and open |
 *
 * The second and third must never render as one another, and neither may ever
 * render as "no position" — which would be the third fact, the one nobody
 * here is entitled to state. This is CLAUDE.md's named-gap rule applied to a
 * corpus: the gap gets a name of its own and the name says WHOSE gap it is.
 *
 * ## Quote and link, never characterize
 *
 * A matched answer is a VERBATIM passage from a page the subject published,
 * carrying its URL and the date we read it. Nothing is summarised, condensed,
 * paraphrased or labelled. There is no model in this path and no sentence in
 * this file that describes a person — the only prose here describes OUR
 * search, which is a fact about us.
 *
 * ## The change marker
 *
 * The corpus is append-only, so two snapshots of one URL with different
 * hashes mean the page changed between the dates. The surface says THAT and
 * shows both dates. It never says what changed and never interprets it —
 * never "flip-flopped", never "softened", never anything. The rule from
 * `types.ts` is unchanged and it is the reason the marker carries dates and
 * not adjectives.
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
  /**
   * The page changed between two reads. Dates only — the marker says THAT it
   * changed, never what, and never what it means.
   */
  changedSince: string | null;
}

export interface PositionAnswer {
  kind: PositionAnswerKind;
  /** What was searched for, as the reader typed it. */
  topic: string;
  /** Only ever non-empty on MATCHED. */
  passages: PositionPassage[];
  /**
   * THE DENOMINATOR, on every answer including the empty ones. "We found
   * nothing" is worth nothing without "in how much" — a search of zero pages
   * and a search of nine are opposite claims and used to render alike.
   */
  searched: {
    /** Distinct URLs of this subject's that we hold readable text for. */
    pages: number;
    /** Snapshots read, which is ≥ pages because the corpus is append-only. */
    snapshots: number;
    /** Snapshots we hold but could not read — named, never counted as read. */
    unreadable: number;
    /**
     * **Passages that CONTAIN the term and are not quotable** (item 13,
     * 2026-08-19). Found by the item-13 verification, not by reading code.
     *
     * `passagesOf` splits on sentence-ending punctuation, and a passage over
     * `PASSAGE_MAX_CHARS` is skipped. A press-release rail — a run of
     * headlines with no full stop in it — is therefore one enormous
     * "passage", and it is skipped. That skip is CORRECT: quoting a link rail
     * as somebody's own words is RULING 6, and clipping 420 characters out of
     * a 1,428-character run breaks a word, which is RULING 7.
     *
     * What was NOT correct is what the reader was then told. Andy Biggs's
     * house.gov page carries "Mining Engineering" in exactly such a rail, and
     * the answer rendered as *"we read their pages and none of them mentions
     * mining"* — a checkable, false statement about a named person, produced
     * by our own passage cap. The named-gap rule is explicit that our gap and
     * their absence may never render as the same sentence.
     *
     * So the skip is counted, and the surface says which happened.
     */
    presentButUnquotable: number;
  };
  /**
   * Somewhere of theirs to go when we have nothing. Their own published page,
   * never a search engine and never a guess — null is a fine answer and the
   * surface says so plainly.
   */
  theirPage: string | null;
}

/** How much of a page a single passage may carry. Long enough to be a real
 *  statement in context, short enough not to be a republication. */
export const PASSAGE_MAX_CHARS = 420;

/** The shortest term worth searching. Below this every page matches. */
export const MIN_TERM_CHARS = 3;

/**
 * Terms a reader is likely to be searching FOR rather than WITH. Stripped so
 * "what does she think about housing" searches for `housing`, not for `what`.
 * Mechanical and reviewable: the list is here, whole, and nothing stems it.
 */
const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can",
  "her", "was", "one", "our", "out", "his", "has", "had", "how", "its",
  "who", "did", "does", "what", "when", "where", "why", "about", "with",
  // Third-person pronouns. A reader asking "what does she think about
  // housing" is searching for `housing`; leaving `she` in makes every page
  // that happens to use the word a hit, which is a match on nothing.
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
 * Split extracted page text into sentence-ish runs.
 *
 * Deliberately crude, and it has to be: this text came off a scraped page with
 * its navigation flattened into it, so a clever parser would be inventing
 * structure the source does not have. A run bounded by sentence punctuation is
 * the most that can be claimed, and every run is returned EXACTLY as it
 * appears — trimming whitespace is the only edit this function makes.
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

/**
 * The subject's own page, for the NOT_YET_COLLECTED answer. Their campaign
 * site is preferred over an official page because the question is what THEY
 * say; either is theirs, and null when we hold neither.
 */
function theirPageFrom(mine: readonly SourceSnapshot[]): string | null {
  const campaign = mine.find((s) => s.kind === "CAMPAIGN_SITE");
  return campaign?.url ?? mine[0]?.url ?? null;
}

/**
 * Answer "what has this person said about X" in one of exactly three ways.
 *
 * Pure: the corpus is an argument, so the identical function runs in the tests
 * against the committed file and on the surface against the same file.
 */
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
    // Filled below, once the terms are known. Declared here so every return
    // path carries the field rather than some of them.
    presentButUnquotable: 0,
  };
  const theirPage = theirPageFrom(mine);

  // ── Answer three: we have not read anything of theirs. ──────────────────
  // Checked FIRST and on the corpus rather than on the match, because "we
  // searched and found nothing" is a claim about a search that did not happen.
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
    // Newest first, so the passage a reader sees is the most recent thing the
    // page said, and an older read is never mistaken for a current one.
    const ordered = [...readable].sort((a, b) =>
      b.retrievedAt.localeCompare(a.retrievedAt),
    );
    const seen = new Set<string>();
    for (const snapshot of ordered) {
      for (const raw of passagesOf(snapshot.text as string)) {
        if (raw.length > PASSAGE_MAX_CHARS) {
          // Item 13: the skip is right and the silence about it was not.
          // Count the ones that would have matched, so the answer can say
          // "we hold it and will not quote it" rather than "they never said
          // it" — see `searched.presentButUnquotable`.
          const long = ` ${normalize(raw)} `;
          if (terms.some((t) => long.includes(` ${t} `))) {
            searched.presentButUnquotable += 1;
          }
          continue;
        }
        const normalized = ` ${normalize(raw)} `;
        const matched = terms.filter((t) => normalized.includes(` ${t} `));
        if (matched.length === 0) continue;
        // The same boilerplate sentence appears on every page of a site.
        // Quoting it three times is not three pieces of evidence.
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

  // ── Answer two: we read their pages and none of them mentioned it. ──────
  if (hits.length === 0) {
    return {
      kind: "SEARCHED_NOTHING_MATCHED",
      topic,
      passages: [],
      searched,
      theirPage,
    };
  }

  // ── Answer one: here is what they published, in their own words. ────────
  // Ranked by how many of the reader's terms a passage carries, which is the
  // only ordering here and is mechanical. Nothing is ranked by sentiment,
  // relevance-as-judged, or anything a model could have an opinion about.
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
 * The topics offered as chips beside the search box. CURATED and committed —
 * not derived from the corpus, because a topic list read off what a candidate
 * happens to have published would silently become a list of what THEY chose
 * to talk about, which is a characterisation by omission.
 *
 * They are also deliberately plain nouns rather than framings: "housing", not
 * "the housing crisis". A framing in the search box is the product taking a
 * position through the question.
 */
export const POSITION_TOPICS: readonly string[] = [
  "housing",
  "water",
  "schools",
  "taxes",
  "immigration",
  "health care",
  "public safety",
  "jobs",
  "environment",
  "transportation",
];
