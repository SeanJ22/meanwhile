import { classifyAcquisition, deriveSanitized, recordAcquisition } from "../control-plane/evidence/artifact.ts";
import type { VotingCapture } from "./voting-source-fetch.ts";

type Capture = Pick<VotingCapture, "url" | "contentType" | "bytes"> & Partial<Pick<VotingCapture, "requestedUrl" | "derivation">>;
type Cleaned<T> = T & Pick<Capture, "derivation">;

/** Spreadsheets, archives and PDFs are parsed from their own bytes; they are never decoded and re-saved as text. */
function votingBinaryDocument(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b || bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/** Exact text of the bytes: UTF-8 where valid, otherwise one character per byte, so blanking changes only the key itself. */
function exactText(bytes: Uint8Array): { text: string; encode: (text: string) => Uint8Array } {
  try { return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), encode: text => new TextEncoder().encode(text) }; }
  catch { return { text: Buffer.from(bytes).toString("latin1"), encode: text => new Uint8Array(Buffer.from(text, "latin1")) }; }
}

function sanitizedText<T extends Capture>(body: T, text: string, at: string, always: boolean): { text: string; derivation: NonNullable<VotingCapture["derivation"]> } | null {
  const captured = recordAcquisition({ canonicalUrl: body.url, retrievedAt: at, httpStatus: 200,
    contentType: body.contentType, sourceId: "official-voting-source", methodRouteId: "official-voting-source",
    workItemId: "official-voting-source", attemptId: `official-voting-source:${at}`, permission: "ALLOWED", transport: "REACHABLE" }, text).artifact;
  if (!always && captured.tier !== "RESTRICTED_RAW") return null;
  const derived = deriveSanitized(captured, text, at);
  return { text: derived.text, derivation: derived.derivation };
}

/**
 * Official pages often print a Maps key or a session token. Every fetched html, text, json, xml or csv
 * body is cleaned here before anything reads, classifies or saves it: each key-like string is blanked by
 * the shipped sanitizer, the derivation records what was blanked, and the facts are read from this copy.
 * Spreadsheets, archives and PDFs pass through unchanged for their parsers; `savedVotingCopy` decides
 * what of them is saved.
 */
export function cleanVotingCapture<T extends Capture>(body: T, at: string): Cleaned<T> {
  if (votingBinaryDocument(body.bytes)) return body;
  const { text, encode } = exactText(body.bytes);
  const cleaned = sanitizedText(body, text, at, false);
  return cleaned ? { ...body, bytes: encode(cleaned.text), derivation: cleaned.derivation } : body;
}

/** The words a reader of a saved document sees: its PDF text, workbook cells or archive members. */
async function documentText(bytes: Uint8Array, url: string): Promise<string> {
  const { decodeVotingBytes, votingArchiveMembers, xlsxVotingTables } = await import("./voting-source-tables.ts");
  // Deployed routes save door copies through here; the runner's OCR fallback stays out of their bundles.
  if (bytes[0] === 0x25) {
    const { extractTextLayer } = await import("../extract/text-layer.ts");
    return (await extractTextLayer(new Uint8Array(bytes), url)).items.map(page => page.text).join("\n");
  }
  const members = votingArchiveMembers(bytes);
  if (members.has("xl/workbook.xml")) {
    return xlsxVotingTables(bytes).flatMap(table => [table.headers.join(" "), ...table.rows.map(row => row.join(" "))]).join("\n");
  }
  const texts: string[] = [];
  for (const [name, member] of members) texts.push(name, votingBinaryDocument(member) ? await documentText(member, `${url}#${name}`) : decodeVotingBytes(member));
  return texts.join("\n");
}

/**
 * The copy saved with a publication. Text bodies are saved cleaned. A spreadsheet, archive or PDF is
 * saved as fetched unless its bytes hold a key-like string; then its extracted text, blanked, is the copy.
 */
export async function savedVotingCopy<T extends Capture>(body: T, at: string): Promise<Cleaned<T>> {
  if (!votingBinaryDocument(body.bytes)) return cleanVotingCapture(body, at);
  if (classifyAcquisition(new TextDecoder().decode(body.bytes)).tier !== "RESTRICTED_RAW") return body;
  const copy = sanitizedText({ ...body, contentType: "text/plain; charset=utf-8" }, await documentText(body.bytes, body.url), at, true)!;
  return { ...body, contentType: "text/plain; charset=utf-8", bytes: new TextEncoder().encode(copy.text), derivation: copy.derivation };
}
