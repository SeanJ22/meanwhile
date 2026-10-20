import { contentHash } from "../ids.ts";
import { isParserInput, type ParserInput } from "../evidence/parser-boundary.ts";
import type { WorkerEvidence } from "./types.ts";

/** Validate the immutable sanitized input without importing worker execution. */
export function evidenceProjection(input: ParserInput): WorkerEvidence {
  if (!isParserInput(input) || contentHash(input.text) !== input.contentHash || input.tier === "RESTRICTED_RAW") throw new Error("WORKER_VAULT_INPUT_REFUSED");
  return { artifactId: input.artifactId, contentHash: input.contentHash, text: input.text, acquiredByAttemptId: input.attemptId,
    canonicalUrl: input.canonicalUrl, retrievedAt: input.retrievedAt, sourceId: input.sourceId, methodRouteId: input.methodRouteId,
    ...(input.sourceDocument ? { sourceDocument: input.sourceDocument } : {}) };
}
