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
