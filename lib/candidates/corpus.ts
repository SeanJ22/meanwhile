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

import { copy } from "../design/copy.ts";
import {
  excerptAround,
  looksLikeChrome,
  repeatedBlocks,
} from "../text/boilerplate.ts";

/** Where a document came from. The two D05 permits, and nothing else. */
export type CandidateSourceClass =
  /** The candidate's or campaign's own site. */
  | "CAMPAIGN_SITE"
  /** The official page of an office the person currently holds. */
  | "OFFICIAL_SITE";

/**
 * How we came to have this URL. Two different claims with two different
 * provenances, and `lib/ballot/candidate-sites.ts` already draws the same
 * line: a link a prior session FETCHED AND READ is not the same fact as a
 * URL a candidate typed into a filing, and a reader is entitled to know
 * which one a quote came from.
 */
export type CandidateUrlBasis = "HUNTED_AND_VERIFIED" | "STATED_IN_FILING";

/** A source-stated publication date, not the time our crawler saw the page. */
export interface CandidatePublicationDate {
  readonly date: string;
  readonly basis: "ARTICLE_PUBLISHED_TIME_META";
  readonly artifactId: string;
  readonly rawContentHash: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly offsetUnit: "UTF16_CODE_UNITS";
}

/** One captured source revision; legacy corpus rows may lack this envelope. */
export interface CandidateSourceRevision {
  readonly revisionId: string;
  readonly artifactId: string;
  readonly canonicalUrl: string;
  readonly rawContentHash: string;
  readonly capturedAt: string;
  readonly extractionVersion: number;
  readonly supersedesRevisionId: string | null;
}

/** Exact captured bytes and their transcription, independent of person alias IDs. */
export function sourceCaptureFingerprint(
  revision: CandidateSourceRevision | undefined,
  contentHash: string,
  url: string,
  retrievedAt: string,
): string | null {
  if (!revision || !revision.artifactId || !revision.rawContentHash || !revision.canonicalUrl ||
      !revision.capturedAt || !contentHash || !Number.isInteger(revision.extractionVersion) ||
      revision.extractionVersion < 1 || revision.canonicalUrl !== url || revision.capturedAt !== retrievedAt) return null;
  return JSON.stringify([revision.artifactId, revision.rawContentHash, revision.canonicalUrl,
    revision.capturedAt, revision.extractionVersion, contentHash]);
}

/** One retrieved version of one page. Append-only. */
export interface CandidateDocument {
  /** `<candidateKey>@<contentHash>` — one row per distinct version. */
  id: string;
  /** The ballot candidacy key this belongs to. */
  candidateKey: string;
  sourceClass: CandidateSourceClass;
  basis: CandidateUrlBasis;
  /**
   * **The campaign's own one-line description of itself** — its `og:description`
   * or `<meta name="description">`, verbatim. B14's blurb rung.
   *
   * This is a sentence the campaign wrote to describe itself to a search
   * engine, which makes it the campaign's words about the campaign rather
   * than a passage we chose out of a page. Choosing a lead sentence
   * ourselves would be an editorial act; taking the one they authored for
   * exactly this purpose is not. Null when the page declares none.
   */
  metaDescription: string | null;
  /** Where it was fetched from. Observed, never constructed. */
  documentUrl: string;
  /** SHA-256 of the raw bytes. The revision detector. */
  contentHash: string;
  /** New machine transcriptions keep the actual captured-byte hash separately
   * from the normalized text identity used by the existing corpus. */
  sourceContentHash?: string;
  /** Present on newly derived captures; absent on retained older/manual rows. */
  sourceRevision?: CandidateSourceRevision;
  publicationDate?: CandidatePublicationDate;
  retrievedAt: string;
  contentType: string;
  /**
   * Extracted text, or null when extraction failed. A failed extraction
   * keeps the link and says so — never partial text presented as complete.
   */
  text: string | null;
  extraction: "html" | "failed";
  extractionNote: string | null;
  /**
   * **Which extractor produced `text`** (F01-continued item 11, 2026-08-19).
   * Absent means 1, the pre-chrome-strip extractor.
   *
   * It exists because a corpus keyed on the hash of its own EXTRACTED TEXT
   * cannot otherwise tell "the campaign changed the page" from "we got better
   * at reading it". Stripping template chrome changes every text in the file,
   * and without this the next collection would report 59 REVISIONS — burning
   * out the one signal that carries this product's accountability half, on a
   * day when nothing on any campaign site had changed at all.
   *
   * The file stays APPEND-ONLY: an older-extractor copy is kept, and
   * `currentExtraction` below simply stops READING it once a newer one of the
   * same page exists. The record is preserved; the search is not doubled.
   */
  extractorVersion?: number;
}

/**
 * The documents to actually search: per page, only the copies produced by the
 * newest extractor held for it.
 *
 * Genuine revisions at the SAME extractor all survive — two reads of one URL
 * with different words are two facts, and the corpus exists to keep both. What
 * is dropped is a stale-extractor copy of a page we have since re-read, which
 * would otherwise be quoted beside its own successor as though the campaign
 * had published it twice.
 */
export function currentExtraction(
  documents: readonly CandidateDocument[],
): CandidateDocument[] {
  const newest = new Map<string, number>();
  for (const doc of documents) {
    const version = doc.extractorVersion ?? 1;
    const key = `${doc.candidateKey}|${doc.documentUrl}`;
    newest.set(key, Math.max(newest.get(key) ?? 0, version));
  }
  return documents.filter(
    (doc) =>
      (doc.extractorVersion ?? 1) === newest.get(`${doc.candidateKey}|${doc.documentUrl}`),
  );
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
  /** Source text, verbatim and short; matching alone never establishes a personal stance. */
  quote: string;
  /** The phrase that matched, so the reader can see why this is here. */
  matchedPhrase: string;
  documentUrl: string;
  sourceClass: CandidateSourceClass;
  retrievedAt: string;
  /** Exact span in extracted `document.text`, before display whitespace normalization. */
  textStart?: number;
  textEnd?: number;
  textQuote?: string;
  offsetUnit?: "UTF16_CODE_UNITS";
  textContentHash?: string;
  sourceRevisionId?: string;
  sourceArtifactId?: string;
  sourceContentHash?: string;
  revisionStatus?: "CURRENT" | "HISTORICAL" | "UNKNOWN";
  publicationDate?: CandidatePublicationDate;
}

/** What was actually searched. Rides on every answer that searched anything. */
export interface CorpusScope {
  /** One entry per document searched. */
  documents: Array<{
    documentUrl: string;
    sourceClass: CandidateSourceClass;
    retrievedAt: string;
    revisionStatus?: "CURRENT" | "HISTORICAL" | "UNKNOWN";
  }>;
  /** Documents held but unreadable — counted, never read as empty. */
  unreadable: number;
}

/** How much of a line either side of the match a passage carries. */
const PASSAGE_CHARS = 320;
/** Never more than this many passages per document — a quote, not a copy. */
const MAX_PASSAGES_PER_DOCUMENT = 3;

function exactExcerptSpan(text: string, at: number, matchLength: number): { start: number; end: number; quote: string } {
  const half = Math.floor(PASSAGE_CHARS / 2);
  let start = Math.max(0, at - half), end = Math.min(text.length, at + matchLength + half);
  while (start > 0 && !/\s/.test(text[start - 1]!)) start -= 1;
  while (end < text.length && !/\s/.test(text[end]!)) end += 1;
  return { start, end, quote: text.slice(start, end) };
}

function revisionStatuses(documents: readonly CandidateDocument[]): Map<string, "CURRENT" | "HISTORICAL" | "UNKNOWN"> {
  const latest = new Map<string, CandidateDocument>();
  for (const doc of documents) {
    if (!doc.sourceRevision) continue;
    const key = `${doc.candidateKey}\u0000${doc.documentUrl}\u0000${doc.sourceRevision.extractionVersion}`;
    const previous = latest.get(key);
    if (!previous || doc.retrievedAt > previous.retrievedAt ||
      (doc.retrievedAt === previous.retrievedAt && doc.sourceRevision.revisionId > previous.sourceRevision!.revisionId)) latest.set(key, doc);
  }
  return new Map(documents.map(doc => [doc.id, !doc.sourceRevision ? "UNKNOWN" :
    latest.get(`${doc.candidateKey}\u0000${doc.documentUrl}\u0000${doc.sourceRevision.extractionVersion}`)?.id === doc.id
      ? "CURRENT" : "HISTORICAL"]));
}

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

  // F01-continued item 11: a page re-read by a newer extractor supersedes its
  // own older copy for reading. Both stay in the file.
  const readable = currentExtraction(documents).filter((d) => d.text);
  const statuses = revisionStatuses(readable);
  const ordered = [...readable].sort((a, b) => {
    const rank = (doc: CandidateDocument) => statuses.get(doc.id) === "CURRENT" ? 0 : statuses.get(doc.id) === "UNKNOWN" ? 1 : 2;
    return rank(a) - rank(b) || b.retrievedAt.localeCompare(a.retrievedAt) || a.id.localeCompare(b.id);
  });
  const scope: CorpusScope = {
    documents: readable.map((d) => ({
      documentUrl: d.documentUrl,
      sourceClass: d.sourceClass,
      retrievedAt: d.retrievedAt,
      revisionStatus: statuses.get(d.id) ?? "UNKNOWN",
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

  /*
   * F01-continued item 11 — the REPETITION half of the boilerplate test,
   * computed per SITE across the pages we hold from it. Runs only where three
   * or more pages of a site are held; `ran` says which, so a caller can report
   * how many sites got structural exclusion alone instead of implying both
   * were applied. (`scripts/chrome-sweep.mts` prints that number.)
   */
  const bySite = new Map<string, string[]>();
  const repetitionPages = new Set<string>();
  for (const doc of readable.filter(row => statuses.get(row.id) !== "HISTORICAL")) {
    // Three captures of the same URL and text are one page for the
    // cross-page chrome test. The source versions remain held and searchable;
    // they cannot manufacture a three-page repetition signal.
    const pageIdentity = `${doc.documentUrl}\u0000${doc.text}`;
    if (repetitionPages.has(pageIdentity)) continue;
    repetitionPages.add(pageIdentity);
    let host = doc.documentUrl;
    try {
      host = new URL(doc.documentUrl).host;
    } catch {
      /* a malformed URL is its own site; it cannot repeat with anything. */
    }
    bySite.set(host, [...(bySite.get(host) ?? []), doc.text!]);
  }
  const repeatsBySite = new Map<string, ReturnType<typeof repeatedBlocks>>();
  for (const [host, texts] of bySite) repeatsBySite.set(host, repeatedBlocks(texts));

  const seenSourcePassages = new Set<string>();
  for (const doc of ordered) {
    const haystack = doc.text!;
    const lower = haystack.toLowerCase();
    let host = doc.documentUrl;
    try {
      host = new URL(doc.documentUrl).host;
    } catch {
      /* as above */
    }
    const repeats = repeatsBySite.get(host)?.fingerprints ?? new Set<string>();
    let found = 0;
    const seen = new Set<string>();
    for (const phrase of wanted) {
      let from = 0;
      while (found < MAX_PASSAGES_PER_DOCUMENT) {
        const at = lower.indexOf(phrase, from);
        if (at === -1) break;
        from = at + phrase.length;
        // RULING 10, at the shared helper: the window grows OUT to a word
        // boundary, and the ellipsis sits outside the word.
        const quote = excerptAround(haystack, at, phrase.length, PASSAGE_CHARS);
        /*
         * RULING 9: text from a navigation rail, a press-release index, a
         * related-links list or a signature block is NOT the candidate's
         * words. It may not be quoted, and — because this is the only place a
         * passage is created — it therefore cannot feed the "mentions N of
         * them" tally either. That is deliberate: filtering the display and
         * not the count would leave the asymmetry in the number being sold
         * while hiding it from the reader.
         */
        if (looksLikeChrome(quote)) continue;
        const key = quote.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
        if (repeats.has(key)) continue;
        if (seen.has(quote)) continue;
        const sourcePassageKey = `${doc.candidateKey}\u0000${doc.documentUrl}\u0000${key}`;
        if (seenSourcePassages.has(sourcePassageKey)) continue;
        seen.add(quote);
        seenSourcePassages.add(sourcePassageKey);
        const span = exactExcerptSpan(haystack, at, phrase.length);
        passages.push({
          quote,
          matchedPhrase: phrase,
          documentUrl: doc.documentUrl,
          sourceClass: doc.sourceClass,
          retrievedAt: doc.retrievedAt,
          textStart: span.start,
          textEnd: span.end,
          textQuote: span.quote,
          offsetUnit: "UTF16_CODE_UNITS",
          ...(doc.sourceRevision ? {
            textContentHash: doc.contentHash,
            sourceRevisionId: doc.sourceRevision.revisionId,
            sourceArtifactId: doc.sourceRevision.artifactId,
            sourceContentHash: doc.sourceRevision.rawContentHash,
            revisionStatus: statuses.get(doc.id) ?? "UNKNOWN",
            ...(doc.publicationDate ? { publicationDate: doc.publicationDate } : {}),
          } : { revisionStatus: "UNKNOWN" as const }),
        });
        found += 1;
      }
    }
  }

  // THE SECOND ANSWER. It carries the scope, so the sentence a reader gets
  // is "nothing matching in their campaign site as retrieved on <date>" and
  // never a bare "no".
  //
  // A candidate whose only matches were chrome lands HERE, which is the
  // correct answer and not a downgrade: we read their pages and nothing they
  // wrote mentioned it. The alternative — crediting them with their CMS —
  // is the defect this replaces.
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
  if (answer.kind === "NOTHING_COLLECTED") return copy("copy.working");
  const n = answer.scope.documents.length;
  const dates = [...new Set(answer.scope.documents.map((d) => d.retrievedAt.slice(0, 10)))]
    .sort()
    .join(", ");
  const versioned = answer.scope.documents.some(doc => doc.revisionStatus !== "UNKNOWN");
  const base = n === 1
    ? `We searched the one page we hold from them, read ${dates}`
    : `We searched the ${n} ${versioned ? "page versions" : "pages"} we hold from them, read ${dates}`;
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
    `${topicLabel}, in the source pages below.${unreadable}`
  );
}
