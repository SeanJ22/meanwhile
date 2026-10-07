/** A recorded Legistar events capture and its artifact record, shared by the fact-bridge and fact-verification suites. */
import { readFileSync } from "node:fs";

import { contentHash } from "../lib/control-plane/ids.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";

export const PIMA_EVENTS_TEXT = readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url), "utf8");

export function pimaArtifact(text: string = PIMA_EVENTS_TEXT, overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    artifactId: "ar-pima-events", workItemId: "wi-pima", routeTaskId: "rt-pima", attemptId: "at-acquire-1",
    tier: "A1" as never, contentHash: contentHash(text), byteLength: Buffer.byteLength(text), contentType: "application/json",
    canonicalUrl: "https://webapi.legistar.com/v1/pima/events", partial: false, recordedAt: "2026-09-05T18:00:00.000Z",
    ...overrides,
  };
}
