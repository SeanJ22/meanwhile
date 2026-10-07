/**
 * @freshness-reads-here
 *
 * The clock stamps in this file are minted at the moment of the fetch.
 */
import { createHash } from "node:crypto";

import { extractHtmlText } from "../extract/html-text.ts";
export { extractHtmlText } from "../extract/html-text.ts";
import { agendaItems } from "../routing/agenda-search.ts";
import type { Meeting, OcdId } from "../sources/types.ts";
import { PUBLISHER_PAGE_SIGNAL, agendaReadableText, sameAgendaContent } from "./agenda-content.ts";
import { sourceUserAgent } from "../sources/http.ts";

/**
 * Agenda documents as first-class records: the document itself is retrieved
 * and stored, not only its URL.
 *
 * Append-only, never overwrite: a revised agenda is appended beside the old
 * version, and `contentHash` detects the silent revision. The store is
 * in-memory and per-process.
 */
export interface AgendaDocument {
  /** `<meetingId>@<contentHash>` — one row per distinct version. */
  id: string;
  meetingId: string;
  /** Null for a division-less body's meeting. */
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
 * not Reader text. Keeps the URL/hash receipt and makes the failed extraction
 * explicit; binary bytes are never scrubbed into apparently readable prose.
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
   * address, carries the same content (`sameAgendaContent`). Returns whether
   * anything was stored and whether it superseded a prior version (the
   * silent-revision signal).
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
   * Is this URL already stored against a different meeting? A calendar or
   * portal root retrieved once per sitting is a landing page, not an agenda.
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
   * readable text is word for word this text: the text-level form of the
   * landing-page question.
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
 * Strip an HTML document to its readable text. `repairMojibake` repairs
 * double-encoded UTF-8 some vendors serve, at this custody boundary rather
 * than at render.
 */

/** Extract text from a PDF's bytes. Throws when the file cannot be read. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // Imported lazily so only actual retrieval pays for the PDF engine.
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
   * Fetch this URL instead of the meeting's own agenda link: a body's own
   * notice page that posts before the vendor portal. The document is recorded
   * against the URL it came from.
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
 * A read that returned nothing of the document is a failed read. Two named
 * signals, neither a length threshold (a one-line notice is a whole document):
 *
 * - No readable text: extraction produced no characters.
 * - The publisher's page: an HTML page's text is word for word what the same
 *   host served for a different sitting (`publisherPageWitness`) and holds no
 *   agenda item. PDFs are not judged this way; two sittings sharing one PDF
 *   share an agenda.
 *
 * Each note opens with its signal's name and is written for readers.
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
