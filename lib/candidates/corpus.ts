import { copy } from "../design/copy.ts";
import {
  excerptAround,
  looksLikeChrome,
  repeatedBlocks,
} from "../text/boilerplate.ts";

export type CandidateSourceClass =
  | "CAMPAIGN_SITE"
  | "OFFICIAL_SITE";

export type CandidateUrlBasis = "HUNTED_AND_VERIFIED" | "STATED_IN_FILING";

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

export interface CandidateSourceRevision {
  readonly revisionId: string;
  readonly artifactId: string;
  readonly canonicalUrl: string;
  readonly rawContentHash: string;
  readonly capturedAt: string;
  readonly extractionVersion: number;
  readonly supersedesRevisionId: string | null;
}

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
  candidateKey: string;
  sourceClass: CandidateSourceClass;
  basis: CandidateUrlBasis;
  metaDescription: string | null;
  documentUrl: string;
  /** SHA-256 of the raw bytes. The revision detector. */
  contentHash: string;
  /** New machine transcriptions keep the actual captured-byte hash separately
   * from the normalized text identity used by the existing corpus. */
  sourceContentHash?: string;
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
  /** Which extractor produced `text`; absent means 1. A hash of extracted text cannot otherwise tell a page change from an extractor change. */
  extractorVersion?: number;
}

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

export interface CandidateCorpus {
  formatVersion: 1;
  fetchedAt: string;
  attempted: number;
  documents: CandidateDocument[];
  failures: Array<{
    candidateKey: string;
    documentUrl: string;
    reason: string;
    attemptedAt: string;
  }>;
}

export type CandidateAnswer =
  | {
      kind: "MATCHED";
      passages: MatchedPassage[];
      scope: CorpusScope;
    }
  | {
      kind: "SEARCHED_NOTHING_MATCHED";
      scope: CorpusScope;
    }
  | {
      kind: "NOTHING_COLLECTED";
      ownSiteUrl: string | null;
    };

export interface MatchedPassage {
  quote: string;
  matchedPhrase: string;
  documentUrl: string;
  sourceClass: CandidateSourceClass;
  retrievedAt: string;
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

export interface CorpusScope {
  documents: Array<{
    documentUrl: string;
    sourceClass: CandidateSourceClass;
    retrievedAt: string;
    revisionStatus?: "CURRENT" | "HISTORICAL" | "UNKNOWN";
  }>;
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

export function answerFor(
  documents: readonly CandidateDocument[],
  phrases: readonly string[],
  ownSiteUrl: string | null = null,
): CandidateAnswer {
  if (documents.length === 0) {
    return { kind: "NOTHING_COLLECTED", ownSiteUrl };
  }

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
        const quote = excerptAround(haystack, at, phrase.length, PASSAGE_CHARS);
        // Navigation, index, related-links and signature text is not the candidate's words: never quoted, never counted.
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

  if (passages.length === 0) return { kind: "SEARCHED_NOTHING_MATCHED", scope };
  return { kind: "MATCHED", passages, scope };
}

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
