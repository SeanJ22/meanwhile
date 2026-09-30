import assert from "node:assert/strict";
import test from "node:test";
import { nextAuditEscalation } from "../lib/control-plane/workers/audit-escalation.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import { MODEL_FOR_CLASS } from "../lib/control-plane/scheduler/model-routing.ts";

function inconclusive(model: string): WorkerResultRecord {
  return {
    id: "held-audit",
    result: { role: "ADVERSARIAL_AUDITOR", verdict: "INCONCLUSIVE", findings: [] },
    modelReview: { model, verdict: "INCONCLUSIVE", challenges: [], validationError: "No grounded model conclusion" },
  } as unknown as WorkerResultRecord;
}

test("a held Sonnet 5 audit can finish its original escalation without rewriting its model identity", () => {
  const previous = inconclusive("claude-sonnet-5");
  assert.deepEqual(nextAuditEscalation(previous), {
    previousResultId: previous.id, from: "claude-sonnet-5", to: "frontier",
    reason: "No grounded model conclusion",
  });
  assert.equal(nextAuditEscalation(inconclusive(MODEL_FOR_CLASS.sonnet))?.to, "frontier");
  assert.equal(nextAuditEscalation(inconclusive("claude-sonnet-4-5")), null,
    "an unrelated historical model is not silently treated as the active Sonnet tier");
  assert.equal(nextAuditEscalation({ ...previous, modelReview: { ...previous.modelReview!, challenges: [{ code: "GROUNDED", detail: "Repair source", artifactId: "held-artifact", quote: "official record" }] } } as WorkerResultRecord), null,
    "a grounded challenge still requires evidence repair rather than model shopping");
});
