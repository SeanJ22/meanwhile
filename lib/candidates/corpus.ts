/**
 * **The candidate statement corpus** — tracker **D05**, built 2026-08-19
 * (g20) to the design recorded in `docs/ballot-research-2026.md`.
 *
 * The reader must be able to ask "has this person said anything about data
 * centers?" and get an answer they can verify. Everything below exists to
 * make that answer checkable rather than persuasive.
 *
 * ## Two corpora, never merged
 *
 * A statement and a vote are different kinds of fact, and collapsing them is
 * the composite-score failure wearing a new coat. This module holds
 * STATEMENTS only — text the person or their campaign published on their own
 * site or in their own filing. Votes live in `lib/votes/`, state votes in the
 * LegiScan adapter, and nothing here ever joins to them.
 *
 * Per D05, and this is a source rule rather than a preference: **never an
 * advocacy organization, never an endorsement site, never a news
 * characterization of what somebody said.** Only the person's own words on
 * their own page.
 *
 * ## Quote and link. Never characterize.
 *
 * An answer is a set of matched passages, each rendered verbatim and short,
 * each with its URL and retrieval date. No synthesis sentence sits on top.
 * "3 passages matched on their campaign site" is a fact and is allowed;
 * "they support data centers" is an editorial act attributed to a real
 * person and is forbidden — including when it would be true.
 *
 * Short passages, always: campaign sites are copyrighted, and
 * quote-with-attribution-and-link is both the honest form and the defensible
 * one. The full retrieved text is stored so a search can run over it; it is
 * never rendered whole.
 *
 * ## Snapshots, because sites change
 *
 * `contentHash` and `retrievedAt` on every document, appended and never
 * overwritten — the `lib/meetings/agenda-documents.ts` pattern, transcribed.
 * A position that appeared on a campaign site in September and vanished in
 * October is the accountability half of this product, and it exists only if
 * the prior version was kept.
 */

/** Where a document came from. The two D05 permits, and nothing else. */
export type CandidateSourceClass =
  /** The candidate's or campaign's own site. */
  | "CAMPAIGN_SITE"
  /** The official page of an office the person currently holds. */
  | "OFFICIAL_SITE";

/** One retrieved version of one page. Append-only. */
export interface CandidateDocument {
  /** `<candidateKey>@<contentHash>` — one row per distinct version. */
  id: string;
  /** The ballot candidacy key this belongs to. */
  candidateKey: string;
  sourceClass: CandidateSourceClass;
  /** Where it was fetched from. Observed, never constructed. */
  documentUrl: string;
  /** SHA-256 of the raw bytes. The revision detector. */
  contentHash: string;
  retrievedAt: string;
  contentType: string;
  /**
   * Extracted text, or null when extraction failed. A failed extraction
   * keeps the link and says so — never partial text presented as complete.
   */
  text: string | null;
  extraction: "html" | "failed";
  extractionNote: string | null;
}

/** The committed corpus. */
export interface CandidateCorpus {
  formatVersion: 1;
  fetchedAt: string;
  /** Every candidate a retrieval was ATTEMPTED for. The denominator. */
  attempted: number;
  documents: CandidateDocument[];
  /**
   * A candidate we tried and could not retrieve, with the reason. Named,
   * because "we tried and the site refused us" and "we have never looked"
   * are different facts and the surface says which.
   */
  failures: Array<{
    candidateKey: string;
    documentUrl: string;
    reason: string;
    attemptedAt: string;
  }>;
}

/* ────────────────────────────── the three answers ───────────────────── */

/**
 * **Three answers, and conflating any two is the failure.**
 *
 * "This candidate has said nothing about X" is itself a damaging claim about
 * a real person, so the shape below refuses to let a reader arrive at it by
 * accident. Every variant carries its corpus scope; without the denominator
 * the second and third read identically, and both read as findings about the
 * candidate rather than about our coverage.
 */
export type CandidateAnswer =
  | {
      kind: "MATCHED";
      passages: MatchedPassage[];
      /** What was searched, so the count above has a base. */
      scope: CorpusScope;
    }
  | {
      kind: "SEARCHED_NOTHING_MATCHED";
      scope: CorpusScope;
    }
  | {
      kind: "NOTHING_COLLECTED";
      /** Their own site, where we know it — the reader goes there instead. */
      ownSiteUrl: string | null;
    };

export interface MatchedPassage {
  /** The candidate's own words, verbatim and short. */
  quote: string;
  /** The phrase that matched, so the reader can see why this is here. */
  matchedPhrase: string;
  documentUrl: string;
  sourceClass: CandidateSourceClass;
  retrievedAt: string;
}

/** What was actually searched. Rides on every answer that searched anything. */
export interface CorpusScope {
  /** One entry per document searched. */
  documents: Array<{
    documentUrl: string;
    sourceClass: CandidateSourceClass;
    retrievedAt: string;
  }>;
  /** Documents held but unreadable — counted, never read as empty. */
  unreadable: number;
}

/** How much of a line either side of the match a passage carries. */
const PASSAGE_CHARS = 320;
/** Never more than this many passages per document — a quote, not a copy. */
const MAX_PASSAGES_PER_DOCUMENT = 3;

/**
 * Search one candidate's documents for a phrase set and build the answer.
 *
 * The phrases come from the caller (the agenda-topic vocabulary, or an issue
 * table). Nothing here decides what a match MEANS: it returns the sentences
 * the phrase appears in, and the caller renders them verbatim.
 */
export function answerFor(
  documents: readonly CandidateDocument[],
  phrases: readonly string[],
  ownSiteUrl: string | null = null,
): CandidateAnswer {
  if (documents.length === 0) {
    // THE THIRD ANSWER. Not "nothing found" — nothing collected. The
    // difference is the whole point of having three.
    return { kind: "NOTHING_COLLECTED", ownSiteUrl };
  }

  const readable = documents.filter((d) => d.text);
  const scope: CorpusScope = {
    documents: readable.map((d) => ({
      documentUrl: d.documentUrl,
      sourceClass: d.sourceClass,
      retrievedAt: d.retrievedAt,
    })),
    unreadable: documents.length - readable.length,
  };

  if (readable.length === 0) {
    // Held but unreadable is not searched-and-empty. Our extraction failing
    // must never become a claim about what a candidate has said.
    return { kind: "NOTHING_COLLECTED", ownSiteUrl };
  }

  const passages: MatchedPassage[] = [];
  const wanted = phrases.map((p) => p.toLowerCase()).filter(Boolean);

  for (const doc of readable) {
    const haystack = doc.text!;
    const lower = haystack.toLowerCase();
    let found = 0;
    const seen = new Set<string>();
    for (const phrase of wanted) {
      let from = 0;
      while (found < MAX_PASSAGES_PER_DOCUMENT) {
        const at = lower.indexOf(phrase, from);
        if (at === -1) break;
        from = at + phrase.length;
        const start = Math.max(0, at - PASSAGE_CHARS / 2);
        const end = Math.min(haystack.length, at + phrase.length + PASSAGE_CHARS / 2);
        const raw = haystack.slice(start, end).replace(/\s+/g, " ").trim();
        const quote =
          (start > 0 ? "…" : "") + raw + (end < haystack.length ? "…" : "");
        if (seen.has(quote)) continue;
        seen.add(quote);
        passages.push({
          quote,
          matchedPhrase: phrase,
          documentUrl: doc.documentUrl,
          sourceClass: doc.sourceClass,
          retrievedAt: doc.retrievedAt,
        });
        found += 1;
      }
    }
  }

  // THE SECOND ANSWER. It carries the scope, so the sentence a reader gets
  // is "nothing matching in their campaign site as retrieved on <date>" and
  // never a bare "no".
  if (passages.length === 0) return { kind: "SEARCHED_NOTHING_MATCHED", scope };
  return { kind: "MATCHED", passages, scope };
}

/**
 * The sentence for an answer, in the reader's words.
 *
 * **Level register**: this is a claim surface about a real person. It states
 * what was searched and what was found; it never says what the person
 * believes, and it never characterizes a passage.
 */
export function answerSentence(answer: CandidateAnswer, topicLabel: string): string {
  if (answer.kind === "NOTHING_COLLECTED") {
    return (
      `We haven't collected anything this candidate has published, so we ` +
      `can't answer this yet. That's a gap in our research, not a statement ` +
      `about them.`
    );
  }
  const n = answer.scope.documents.length;
  const dates = [...new Set(answer.scope.documents.map((d) => d.retrievedAt.slice(0, 10)))]
    .sort()
    .join(", ");
  const base =
    n === 1
      ? `We searched the one page we hold from them, read ${dates}`
      : `We searched the ${n} pages we hold from them, read ${dates}`;
  const unreadable =
    answer.scope.unreadable > 0
      ? ` We hold ${answer.scope.unreadable} more we couldn't read, so ${answer.scope.unreadable === 1 ? "it isn't" : "they aren't"} included.`
      : "";

  if (answer.kind === "SEARCHED_NOTHING_MATCHED") {
    return `${base}. Nothing in them mentions ${topicLabel}.${unreadable}`;
  }
  const count = answer.passages.length;
  return (
    `${base}. ${count} passage${count === 1 ? "" : "s"} mention${count === 1 ? "s" : ""} ` +
    `${topicLabel}, in their own words below.${unreadable}`
  );
}
