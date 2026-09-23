/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps in this file are minted by the code path that
 * performs the read: the freshness date is taken at the moment of the fetch,
 * which is what the ruling asks for rather than what it forbids. Verified
 * 2026-08-23 by reading each stamp site against the retrieval it sits in.
 */
import { createHash } from "node:crypto";

import { readableContent } from "../extract/html-content.ts";
import { agendaItems } from "../routing/agenda-search.ts";
import type { Meeting, OcdId } from "../sources/types.ts";
import { PUBLISHER_PAGE_SIGNAL, agendaReadableText, sameAgendaContent } from "./agenda-content.ts";
import { sourceUserAgent } from "../sources/http.ts";
import { repairMojibake } from "../text/mojibake.ts";

/**
 * Agenda documents as first-class records — item 1 of the reprioritization.
 *
 * A link is not searchable. Every downstream feature — topic notification,
 * "what is on this agenda", agenda Q&A, local votes out of minutes (D04) —
 * needs the *text*, so the document itself is retrieved and stored, not only
 * its URL.
 *
 * **Append-only, never overwrite.** Agendas are revised, and a silently
 * revised agenda is itself news. A meeting can therefore hold several
 * documents over time; `contentHash` is what detects the silent revision. The
 * store refuses to duplicate an unchanged document and refuses to *replace*
 * a changed one — a new version is appended beside the old.
 *
 * This is written as the table it will become (the Phase 5 migration is a
 * transcription, like `MeetingBody` in attribution.ts). Until persistence
 * lands the store is in-memory and per-process, which is the same lifetime
 * the composite's meeting cache already has.
 */
export interface AgendaDocument {
  /** `<meetingId>@<contentHash>` — one row per distinct version. */
  id: string;
  meetingId: string;
  /** Null for a division-less body's meeting (D28). */
  ocdId: OcdId | null;
  /** Where the document was fetched from. Observed, never constructed. */
  documentUrl: string;
  /** SHA-256 of the raw bytes. The revision detector. */
  contentHash: string;
  retrievedAt: string;
  contentType: string;
  /**
   * Extracted text, or null when extraction failed. Never partial text
   * presented as complete — a failed extraction keeps the link and says so.
   */
  text: string | null;
  extraction: "html" | "pdf" | "failed";
  extractionNote: string | null;
  sourceUrl: string;
  sourceOrg: string;
  collectedAt: string;
  verifiedAt: string | null;
}

/**
 * PostgreSQL JSONB cannot represent U+0000, and binary Office documents are
 * not Reader text. Older tracked snapshots accidentally decoded a DOCX ZIP as
 * UTF-8 and retained the resulting `PK\u0003\u0004...` byte soup in `text`.
 * Preserve the immutable URL/hash receipt while making the failed extraction
 * explicit; never silently scrub binary bytes into apparently readable prose.
 */
export function canonicalAgendaDocument(document: AgendaDocument): AgendaDocument {
  if (
    document.text === null ||
    (
      document.extraction !== "failed" &&
      !document.text.includes("\u0000") &&
      !/^(?:PK\u0003\u0004|%PDF-)/.test(document.text)
    )
  ) {
    return document;
  }
  return {
    ...document,
    text: null,
    extraction: "failed",
    extractionNote:
      "Non-text or binary document bytes were retained by URL and SHA-256, but were never promoted as Reader text.",
  };
}

export class AgendaDocumentStore {
  private byMeeting = new Map<string, AgendaDocument[]>();

  /**
   * Append a version unless the latest stored version, read from the same
   * address, carries the same content (`sameAgendaContent`: identical bytes,
   * or identical readable text whose bytes differ — a page that stamps each
   * response anew is re-read, not revised). Returns whether anything was
   * stored and whether it superseded a prior version — the second is the
   * "silent revision" signal worth surfacing.
   *
   * (2026-09-22.) This compared bytes alone, and Tucson Unified's meeting page
   * never answers with the same bytes twice: sitting 499 gained 88 stored
   * "versions" in four days with one unchanged text. Rows already stored stay
   * exactly as they are.
   */
  append(doc: AgendaDocument): { stored: boolean; revised: boolean } {
    const versions = this.byMeeting.get(doc.meetingId) ?? [];
    const latest = versions[versions.length - 1];
    if (latest && latest.documentUrl === doc.documentUrl && sameAgendaContent(latest, doc)) {
      return { stored: false, revised: false };
    }
    versions.push(doc);
    this.byMeeting.set(doc.meetingId, versions);
    return { stored: true, revised: versions.length > 1 };
  }

  /** All versions for a meeting, oldest first. */
  versionsFor(meetingId: string): AgendaDocument[] {
    return [...(this.byMeeting.get(meetingId) ?? [])];
  }

  latestFor(meetingId: string): AgendaDocument | null {
    const versions = this.byMeeting.get(meetingId);
    return versions?.length ? versions[versions.length - 1] : null;
  }

  /** The hash an unchanged document would carry — the never-re-fetch guard. */
  latestHashFor(meetingId: string): string | null {
    return this.latestFor(meetingId)?.contentHash ?? null;
  }

  /**
   * Is this URL already stored against a DIFFERENT meeting? (2026-08-27.)
   *
   * The landing-page signal. A body's calendar or portal root gets retrieved
   * once per sitting and stored as though it were each one's agenda — and
   * measured across the committed snapshot, 56 of 198 documents share a URL
   * this way and **not one of them yields a single agenda item**, while 47% of
   * the documents on a URL of their own do.
   *
   * Exposed as a question rather than as `all()`, so the rule lives with the
   * store instead of being re-expressed by every caller that wants it.
   */
  isUrlOnAnotherMeeting(documentUrl: string, meetingId: string): boolean {
    for (const [id, versions] of this.byMeeting) {
      if (id === meetingId) continue;
      if (versions.some((v) => v.documentUrl === documentUrl)) return true;
    }
    return false;
  }

  /**
   * Another sitting's held HTML document, from the same publisher host, whose
   * readable text is word for word this text. (2026-09-23.)
   *
   * The text-level form of the landing-page question above: two sittings'
   * pages that say exactly the same words say nothing about either sitting,
   * so the words are the publisher's page. Measured across the composed
   * Reader snapshot before this was adopted: 14 texts on 10 hosts were held
   * for more than one sitting, every one a portal page, a calendar, a board's
   * front page or a skip link — Diligent's header-only rows, CivicClerk's
   * "enable JavaScript" shell, Bradford's and Warner's calendars — and not
   * one yielded an agenda item.
   */
  publisherPageWitness(doc: {
    readonly meetingId: string;
    readonly documentUrl: string;
    readonly text: string | null;
  }): AgendaDocument | null {
    const text = agendaReadableText(doc);
    const host = hostOf(doc.documentUrl);
    if (text === null || host === null) return null;
    for (const [id, versions] of this.byMeeting) {
      if (id === doc.meetingId) continue;
      const witness = versions.find(
        (v) => v.extraction === "html" && hostOf(v.documentUrl) === host && agendaReadableText(v) === text,
      );
      if (witness) return witness;
    }
    return null;
  }

  get documentCount(): number {
    let n = 0;
    for (const versions of this.byMeeting.values()) n += versions.length;
    return n;
  }
}

/** The per-process store, same lifetime as the composite's cache. */
export const agendaDocumentStore = new AgendaDocumentStore();

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function contentHashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Strip an HTML document to its readable text.
 *
 * The final `repairMojibake` is not defensive tidying (M60, 2026-08-15):
 * Diligent's BoardDocs portal serves DOUBLE-ENCODED bytes. Its pages declare
 * and send UTF-8, and the UTF-8 they send spells out U+00C2 U+00BB where the
 * breadcrumb should read a single U+00BB guillemet — verified against the raw
 * bytes of TUSD's MeetingInformation page, which carries two of the corrupt
 * pairs and not one clean separator.
 * Our decode is correct; the vendor's text is wrong, and a reader was seeing
 * it in the agenda excerpt. This is our custody boundary, so it is repaired
 * here on the way in rather than at render — a render-time patch would leave
 * every stored row and every later consumer holding the broken text.
 */
export function extractHtmlText(html: string): string {
  /*
   * DATA-1 (2026-08-28): this used to be `<main>` or ELSE THE WHOLE DOCUMENT.
   *
   * The fallback is what put 9,007 characters of the CAP website's menu tree
   * into a reader's "what this meeting is about" — because that page declares
   * no `<main>`, no `<nav>`, no `<header>` and no ARIA roles at all. The
   * region choice, the chrome removal and the link-density backstop now live
   * in `lib/extract/html-content.ts`, which `scripts/fetch-corpus.mts` also
   * calls: one extractor, so the two can no longer disagree.
   */
  const text = readableContent(html)
    .html.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    // Numeric references generically — &times; reached readers literally.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&times;/gi, "×")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return repairMojibake(text);
}

/** Extract text from a PDF's bytes. Throws when the file cannot be read. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // Imported lazily so nothing that merely types against this module pays for
  // the PDF engine — only actual retrieval does.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({
    data: bytes,
    // No worker in Node; extraction runs on the main thread.
    useWorkerFetch: false,
  }).promise;

  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" "),
      );
    }
    return pages.join("\n").replace(/[ \t]+/g, " ").trim();
  } finally {
    await doc.cleanup();
  }
}

export interface RetrieveOptions {
  fetchImpl?: typeof fetch;
  /** Skip the fetch entirely when the stored hash is known-current. */
  knownHash?: string | null;
  /**
   * Fetch this URL instead of the meeting's own agenda link — the curated
   * notice channel (4c): a body that posts its meeting notice on its own
   * page before the vendor portal publishes the agenda. The document is
   * recorded against the notice URL it actually came from.
   */
  urlOverride?: string;
  /**
   * What is already held, for the one judgment a page cannot make about
   * itself: whether another sitting's page says the same words. Defaults to
   * the per-process store the ingest seeds and appends to.
   */
  held?: Pick<AgendaDocumentStore, "publisherPageWitness">;
}

/**
 * **A READ THAT RETURNED NOTHING OF THE DOCUMENT IS A FAILED READ.**
 * (RULING 269, 2026-09-23.)
 *
 * The retrieval used to store whatever text survived extraction as a
 * successful one: the empty string, and 54 to 69 characters of Diligent skip
 * links that 18 sittings then showed readers as their agenda. Two named
 * signals now record such a read as `failed`. Neither is a length threshold,
 * because a one-line notice ("This meeting is cancelled") is a whole
 * document:
 *
 * - **No readable text.** Extraction produced no characters at all.
 * - **The publisher's page.** An HTML page's text is word for word what the
 *   same host served for a different sitting (`publisherPageWitness`) and
 *   holds no agenda item. A joint agenda two sittings share yields items and
 *   stays a document, exactly as the ingest's landing-page rule keeps one.
 *   PDFs are not judged this way: a PDF is a document, and two sittings
 *   holding the same one is a shared agenda, not a page.
 *
 * Each note opens with its signal's name, and the notes are written for the
 * reader who may be shown them.
 */
const NO_READABLE_TEXT = "No readable text";

function failedRead(
  base: Omit<AgendaDocument, "text" | "extraction" | "extractionNote">,
  note: string,
): AgendaDocument {
  return { ...base, text: null, extraction: "failed", extractionNote: note };
}

/**
 * Fetch a meeting's agenda document and turn it into an `AgendaDocument`.
 *
 * Returns null when the meeting has no agenda URL — that is a real state, not
 * a failure. Extraction failure is *recorded on the row*, never thrown away:
 * the link survives, the text is null, and `extractionNote` says why.
 */
export async function retrieveAgendaDocument(
  meeting: Meeting,
  options: RetrieveOptions = {},
): Promise<AgendaDocument | null> {
  const url = options.urlOverride ?? meeting.agendaUrl;
  if (!url) return null;

  const impl = options.fetchImpl ?? fetch;
  const response = await impl(url, {
    headers: { "User-Agent": sourceUserAgent() },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  const hash = contentHashOf(bytes);
  const retrievedAt = new Date().toISOString();

  const base: Omit<AgendaDocument, "text" | "extraction" | "extractionNote"> = {
    id: `${meeting.id}@${hash}`,
    meetingId: meeting.id,
    ocdId: meeting.ocdId,
    documentUrl: url,
    contentHash: hash,
    retrievedAt,
    contentType,
    sourceUrl: url,
    sourceOrg: meeting.provenance.sourceOrg,
    collectedAt: retrievedAt,
    verifiedAt: null,
  };

  const isPdf =
    contentType.includes("pdf") || url.toLowerCase().includes(".pdf");

  try {
    if (isPdf) {
      const text = await extractPdfText(bytes);
      if (!text.trim()) {
        return failedRead(
          base,
          `${NO_READABLE_TEXT}: the PDF has no text layer to read, which is how a scanned page reads.`,
        );
      }
      return { ...base, text, extraction: "pdf", extractionNote: null };
    }
    const decoded = new TextDecoder().decode(bytes);
    const looksLikeText =
      contentType.toLowerCase().startsWith("text/") ||
      /(?:html|xhtml|xml|json)/i.test(contentType) ||
      /^\s*</.test(decoded);
    if (!looksLikeText || decoded.includes("\u0000") || /^(?:PK\u0003\u0004|%PDF-)/.test(decoded)) {
      return canonicalAgendaDocument({
        ...base,
        text: decoded,
        extraction: "failed",
        extractionNote: null,
      });
    }
    const text = extractHtmlText(decoded);
    if (!text) {
      return failedRead(
        base,
        `${NO_READABLE_TEXT}: once its scripts, controls and site navigation were set aside, the page held no words.`,
      );
    }
    const witness = (options.held ?? agendaDocumentStore).publisherPageWitness({
      meetingId: meeting.id,
      documentUrl: url,
      text,
    });
    if (witness && agendaItems(text).length === 0) {
      return failedRead(
        base,
        `${PUBLISHER_PAGE_SIGNAL}: its text is word for word the page ${hostOf(url)} serves for another ` +
          `meeting (${witness.meetingId}), so it is the publisher's page rather than this meeting's document.`,
      );
    }
    return canonicalAgendaDocument({ ...base, text, extraction: "html", extractionNote: null });
  } catch (error) {
    return {
      ...base,
      text: null,
      extraction: "failed",
      extractionNote: String((error as Error)?.message ?? error),
    };
  }
}
