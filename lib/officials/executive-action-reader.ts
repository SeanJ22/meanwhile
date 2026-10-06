import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { scopedManualContractScope } from "../civic-data/scoped-manual-contracts.ts";
import { currentReaderAuthorityEdge, currentPromotedEdge } from "../registry/runtime-edge.ts";
import { executiveActionFactIssue, type ExecutiveActionFact } from "./executive-action-contract.ts";

export async function readStateExecutiveActions(division: string, options: PromotedCivicDataReadOptions = {}) {
  const read = await readPromotedCivicData<{ kind: "executive-actions"; records: readonly ExecutiveActionFact[] }>("CURATED_READER_RECORD",
    scopedManualContractScope("executive-actions", division), options);
  if (read.kind === "PROMOTED" && (read.value.kind !== "executive-actions" || !Array.isArray(read.value.records) ||
      read.value.records.some(row => executiveActionFactIssue(row) || row.ocdId !== division))) throw new Error("Executive action projection has invalid source or state identity.");
  return read;
}

/** An optional family absent from an established edge context stays absent;
 * it never starts a database fallback on a reader request. */
export async function stateExecutiveActionsFor(input: { division: string; officialId: string; name: string }, options: PromotedCivicDataReadOptions = {}) {
  const scope = scopedManualContractScope("executive-actions", input.division);
  if (options.store === undefined && currentReaderAuthorityEdge() && !currentPromotedEdge("CURATED_READER_RECORD", scope)) return [];
  const read = await readStateExecutiveActions(input.division, options);
  if (read.kind !== "PROMOTED") return [];
  return read.value.records.filter(row => row.officeholderId === input.officialId && row.officeholderName === input.name);
}
