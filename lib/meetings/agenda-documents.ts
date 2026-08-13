import { createHash } from "node:crypto";

import type { Meeting, OcdId } from "../sources/types.ts";
import { sourceUserAgent } from "../sources/http.ts";

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

export class AgendaDocumentStore {
  private byMeeting = new Map<string, AgendaDocument[]>();

  /**
   * Append a version unless the latest stored version has the same hash.
   * Returns whether anything was stored and whether it superseded a prior
   * version — the second is the "silent revision" signal worth surfacing.
   */
  append(doc: AgendaDocument): { stored: boolean; revised: boolean } {
    const versions = this.byMeeting.get(doc.meetingId) ?? [];
    const latest = versions[versions.length - 1];
    if (latest && latest.contentHash === doc.contentHash) {
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

  get documentCount(): number {
    let n = 0;
    for (const versions of this.byMeeting.values()) n += versions.length;
    return n;
  }
}

/** The per-process store, same lifetime as the composite's cache. */
export const agendaDocumentStore = new AgendaDocumentStore();

export function contentHashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Strip an HTML document to its readable text. */
export function extractHtmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
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
  if (!meeting.agendaUrl) return null;

  const impl = options.fetchImpl ?? fetch;
  const response = await impl(meeting.agendaUrl, {
    headers: { "User-Agent": sourceUserAgent() },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${meeting.agendaUrl}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  const hash = contentHashOf(bytes);
  const retrievedAt = new Date().toISOString();

  const base: Omit<AgendaDocument, "text" | "extraction" | "extractionNote"> = {
    id: `${meeting.id}@${hash}`,
    meetingId: meeting.id,
    ocdId: meeting.ocdId,
    documentUrl: meeting.agendaUrl,
    contentHash: hash,
    retrievedAt,
    contentType,
    sourceUrl: meeting.agendaUrl,
    sourceOrg: meeting.provenance.sourceOrg,
    collectedAt: retrievedAt,
    verifiedAt: null,
  };

  const isPdf =
    contentType.includes("pdf") || meeting.agendaUrl.toLowerCase().includes(".pdf");

  try {
    if (isPdf) {
      const text = await extractPdfText(bytes);
      return { ...base, text, extraction: "pdf", extractionNote: null };
    }
    const text = extractHtmlText(new TextDecoder().decode(bytes));
    return { ...base, text, extraction: "html", extractionNote: null };
  } catch (error) {
    return {
      ...base,
      text: null,
      extraction: "failed",
      extractionNote: String((error as Error)?.message ?? error),
    };
  }
}
