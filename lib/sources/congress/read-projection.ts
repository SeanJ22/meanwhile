import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { FEDERAL_RECORD_CLASS, federalScope, type FederalSourceId } from "./targets.ts";
import type { FederalProjection } from "./types.ts";

export function federalProjectionIssues(value: FederalProjection): string[] {
  if (!value || value.formatVersion !== 1 || !Array.isArray(value.records)) return ["Federal source projection has an invalid shape."];
  const issues: string[] = [];
  if (new Set(value.records.map(row => row.id)).size !== value.records.length) issues.push("Duplicate source-native row IDs.");
  if (value.records.some(row => !row.id || !row.nativeId || row.source !== value.source || row.official !== true ||
    !row.publisher || !/^https:\/\//.test(row.sourceUrl) || !Number.isFinite(Date.parse(row.checkedAt)) ||
    (row.publishedAt !== null && !Number.isFinite(Date.parse(row.publishedAt))))) issues.push("A fact lacks native identity, official source attribution or valid source dates.");
  if (value.source === "senate-lda" && value.records.some(row => row.bioguideId &&
    (row.honoreeJoin?.status !== "JOINED" || row.state !== row.honoreeJoin.state || !row.honoreeName))) {
    issues.push("An LDA member link lacks its unique honoree/roster join evidence.");
  }
  return issues;
}

/** Readers consume validated promoted facts without loading source acquisition or publication code. */
export async function readFederalSourceProjection(source: FederalSourceId, partition = "national", options: PromotedCivicDataReadOptions = {}) {
  const result = await readPromotedCivicData<FederalProjection>(FEDERAL_RECORD_CLASS, federalScope(source, partition), options);
  if (result.kind === "PROMOTED" && (result.value.source !== source || federalProjectionIssues(result.value).length)) {
    return { ...result, kind: "STORE_UNREACHABLE" as const, value: null, code: "PROMOTION_PROOF_INVALID" as const, detail: "Federal source projection failed its typed reader contract." };
  }
  return result;
}
