import type { AuditorResult, AuditorWorkerInput } from "./types.ts";
import { auditExtraction as auditLegacyExtraction } from "./legacy-auditor.ts";
import { auditGeneralizedExtraction } from "./generalized-auditor.ts";

export { AUDITOR_IMPLEMENTATION, AUDITOR_VERSION, AUDITOR_ATTACK_MODES } from "./legacy-auditor.ts";

/** Version routing stays separate from the legacy procedure's type-only import boundary. */
export function auditExtraction(input: AuditorWorkerInput): AuditorResult {
  return input.context.contract.schemaVersion === 2
    ? auditGeneralizedExtraction(input, input.context.contract)
    : auditLegacyExtraction(input);
}
