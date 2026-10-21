import { classifyAcquisition } from "../control-plane/evidence/artifact.ts";
import type { VotingCapture } from "./voting-source-fetch.ts";

/** A document needing restricted storage stays held; sibling sources can publish. */
export class VotingSourceDocumentHeld extends Error {
  readonly url: string;
  constructor(url: string) {
    super("This source document requires encrypted restricted evidence storage; continue with the other official files.");
    this.name = "VotingSourceDocumentHeld";
    this.url = url;
  }
}

export function assertVotingEvidenceCanPublish(bodies: readonly VotingCapture[]): void {
  for (const body of bodies) {
    if (classifyAcquisition(new TextDecoder().decode(body.bytes)).tier === "RESTRICTED_RAW") {
      throw new VotingSourceDocumentHeld(body.url);
    }
  }
}

/** Scanned public files use the runner's existing OCR rung; an unreadable scan stays extraction work. */
export async function votingPdfText(bytes: Uint8Array, url: string): Promise<{ text: string; method: "TEXT_LAYER" | "OCR" }> {
  const { extractTextLayer } = await import("../extract/text-layer.ts");
  const read = await extractTextLayer(new Uint8Array(bytes), url);
  if (read.items.length) return { text: read.items.map(page => page.text).join("\n"), method: "TEXT_LAYER" };
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error(read.reason);
  const { runOcr } = await import("../extract/ocr.ts");
  const ocr = await runOcr(bytes, url);
  if (!ocr.items.length) throw new Error(ocr.reason);
  return { text: ocr.items.map(page => page.text).join("\n"), method: "OCR" };
}
