import type { AuditorResult, AuditorWorkerInput } from "./types.ts";
import { auditGeneralizedExtraction } from "./generalized-auditor.ts";

export function auditExtraction(input: AuditorWorkerInput): AuditorResult {
  if (input.context.contract.schemaVersion !== 2) throw new Error("AUDITOR_CONTRACT_UNSUPPORTED");
  return auditGeneralizedExtraction(input, input.context.contract);
}
