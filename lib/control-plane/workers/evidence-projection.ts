import { contentHash } from "../ids.ts";
import { isParserInput, type ParserInput } from "../evidence/parser-boundary.ts";
import type { IndependentAuditContext, WorkerEvidence } from "./types.ts";
import type { VerifiedReplayFiles } from "../../sources/verified-replay.ts";

const auditOwners = new WeakMap<IndependentAuditContext, AuditEvidenceReplays>();

/** A standing runtime owns its audit files until that task ends or the runtime closes. */
export class AuditEvidenceReplays {
  private readonly contexts = new Map<IndependentAuditContext, VerifiedReplayFiles>();
  hold(context: IndependentAuditContext, files: VerifiedReplayFiles): IndependentAuditContext {
    this.contexts.set(context, files);
    auditOwners.set(context, this);
    return context;
  }
  release(context: IndependentAuditContext): void {
    this.contexts.get(context)?.dispose();
    this.contexts.delete(context);
    auditOwners.delete(context);
  }
  close(): void { for (const context of this.contexts.keys()) this.release(context); }
}

export function releaseAuditContextEvidence(context: IndependentAuditContext | undefined): void {
  if (context) auditOwners.get(context)?.release(context);
}

/** Record source identity without evaluating an optional disk-backed text property. */
export function workerEvidenceMetadata(evidence: WorkerEvidence): Omit<WorkerEvidence, "text"> {
  return { artifactId: evidence.artifactId, contentHash: evidence.contentHash, acquiredByAttemptId: evidence.acquiredByAttemptId,
    canonicalUrl: evidence.canonicalUrl, retrievedAt: evidence.retrievedAt, sourceId: evidence.sourceId, methodRouteId: evidence.methodRouteId,
    ...(evidence.sourceDocument ? { sourceDocument: evidence.sourceDocument } : {}) };
}

/** Validate the immutable sanitized input without importing worker execution. */
export function evidenceProjection(input: ParserInput): WorkerEvidence {
  if (!isParserInput(input) || contentHash(input.text) !== input.contentHash || input.tier === "RESTRICTED_RAW") throw new Error("WORKER_VAULT_INPUT_REFUSED");
  return { artifactId: input.artifactId, contentHash: input.contentHash, text: input.text, acquiredByAttemptId: input.attemptId,
    canonicalUrl: input.canonicalUrl, retrievedAt: input.retrievedAt, sourceId: input.sourceId, methodRouteId: input.methodRouteId,
    ...(input.sourceDocument ? { sourceDocument: input.sourceDocument } : {}) };
}
