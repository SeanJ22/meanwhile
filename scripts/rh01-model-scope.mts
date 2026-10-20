import type { ModelRequest } from "../lib/control-plane/scheduler/scout-executor.ts";
import type { DiagnosticRole } from "./rh01-model-budget.mts";

const government = "ocd-division/country:us/state:az/county:pima";
/** Only the genuine county hunt and the prepared official-page body-name audit may use the shared exception. */
export function diagnosticRoleFor(request: ModelRequest): DiagnosticRole {
  if (request.tools.some(tool => tool.name === "record_audit")) {
    const content = request.messages[0]?.content;
    const context = typeof content === "string" ? JSON.parse(content) : null;
    const contract = context?.contract, scope = contract?.sourceScope, extraction = contract?.extraction;
    if (context?.subjectId !== government || contract?.subjectId !== government || contract?.schemaVersion !== 2 ||
        contract.recordClass !== "OFFICIAL_BOARD_DIRECTORY" || contract.jurisdiction?.country !== "US" || contract.jurisdiction?.state !== "AZ" ||
        contract.jurisdiction?.canonicalId !== government || JSON.stringify(contract.requiredFields) !== '["bodyName"]' ||
        JSON.stringify(scope?.canonicalUrls) !== '["https://www.pima.gov/board-of-supervisors"]' || scope.sourceId !== "www.pima.gov" ||
        extraction?.format !== "TEXT_BLOCKS" || extraction.recordStart !== "<title>" || extraction.recordEnd !== " | Pima County, AZ</title>" ||
        extraction.fields?.bodyName?.source !== "<title>" || extraction.fields?.bodyName?.type !== "STRING" || Object.keys(extraction.fields).length !== 1)
      throw Error("RH01 diagnostic audit escaped its genuine official Pima body-title capture");
    return "ADVERSARIAL_AUDITOR";
  }
  if (request.batchContext?.priority?.subjectId === government && request.tools.some(tool => tool.name === "finish")) return "SCOUT";
  throw Error("RH01 diagnostic request is outside the two prepared native roles");
}
