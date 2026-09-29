import { MODEL_FOR_CLASS } from "../scheduler/model-routing.ts";
import type { WorkerResultRecord, WorkerTaskSpec } from "./types.ts";

/** Escalate an unresolved model response, never shop for a model to dismiss
 * a grounded challenge or a failed deterministic verification. Each step is
 * its own durable attempt, with its own reservation and provider receipt. */
export function nextAuditEscalation(record: WorkerResultRecord): WorkerTaskSpec["auditEscalation"] | null {
  const review = record.modelReview;
  if (record.result.role !== "ADVERSARIAL_AUDITOR" || record.result.verdict !== "INCONCLUSIVE" ||
    !review || review.verdict !== "INCONCLUSIVE" || review.challenges.length ||
    record.result.findings.some(f => f.severity !== "INFO" && f.code !== "AUDIT_MODEL_HYPOTHESIS_REQUIRES_MACHINE_EVIDENCE")) return null;
  // A held Sonnet 5 result keeps its exact identity and can still advance to
  // the unchanged frontier after the active Sonnet class moves to 5.5.
  const to = review.model === MODEL_FOR_CLASS.haiku ? "sonnet"
    : review.model === MODEL_FOR_CLASS.sonnet || review.model === "claude-sonnet-5" ? "frontier" : null;
  if (!to) return null;
  return { previousResultId: record.id, from: review.model, to,
    reason: review.validationError ?? "The independent model returned INCONCLUSIVE without an evidence-grounded challenge; the deterministic audit passed." };
}
