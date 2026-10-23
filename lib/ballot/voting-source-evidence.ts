import { classifyAcquisition, deriveSanitized, recordAcquisition } from "../control-plane/evidence/artifact.ts";
import type { VotingCapture } from "./voting-source-fetch.ts";

/** Government link pages often embed a Maps key. The existing sanitizer keeps
 * the official links and civic text, and records the original hash without
 * putting restricted bytes in the ordinary evidence store. */
export function votingOfficialLinkEvidence(body: VotingCapture, at: string): VotingCapture {
  if (!/html|text\//i.test(body.contentType)) return body;
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body.bytes);
  const captured = recordAcquisition({ canonicalUrl: body.url, retrievedAt: at, httpStatus: 200,
    contentType: body.contentType, sourceId: "official-voting-source", methodRouteId: "official-voting-link",
    workItemId: "official-voting-link", attemptId: `official-voting-link:${at}`, permission: "ALLOWED", transport: "REACHABLE" }, text).artifact;
  if (captured.tier !== "RESTRICTED_RAW") return body;
  const derived = deriveSanitized(captured, text, at);
  return { ...body, bytes: new TextEncoder().encode(derived.text), derivation: derived.derivation };
}

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
