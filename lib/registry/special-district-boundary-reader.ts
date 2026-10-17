import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { scopedManualContractScope } from "../civic-data/scoped-manual-contracts.ts";
import { specialDistrictBoundaryIssue, type SpecialDistrictBoundary } from "./special-district-boundary.ts";
export async function readSpecialDistrictBoundaries(countyOcdId: string, options: PromotedCivicDataReadOptions = {}) {
  const read = await readPromotedCivicData<{ kind: "special-district-boundaries"; records: readonly SpecialDistrictBoundary[] }>(
    "CURATED_READER_RECORD", scopedManualContractScope("special-district-boundaries", countyOcdId), options);
  if (read.kind === "PROMOTED" && (read.value.kind !== "special-district-boundaries" || !Array.isArray(read.value.records) ||
    read.value.records.some(row => specialDistrictBoundaryIssue(row) || row.ocdId !== countyOcdId))) throw new Error("Published district boundaries have invalid geometry or jurisdiction identity.");
  return read;
}

/** Address requests consume only scoped entries already present in their edge
 * bundle; a missing optional boundary family never opens the database. */
export async function readSpecialDistrictBoundariesForCounties(countyOcdIds: readonly string[], options: PromotedCivicDataReadOptions = {}) {
  const { currentReaderAuthorityEdge, ensurePromotedEdge } = await import("./runtime-edge.ts");
  const edgeContext = !options.store && currentReaderAuthorityEdge();
  const reads = await Promise.all([...new Set(countyOcdIds)].map(async county => {
    const scope = scopedManualContractScope("special-district-boundaries", county);
    const served = edgeContext ? await ensurePromotedEdge("CURATED_READER_RECORD", scope) : null;
    if (edgeContext && !served) return null;
    return readSpecialDistrictBoundaries(county, { ...options, ...(served ? { edge: served.value } : {}) });
  }));
  return reads.flatMap(read => read?.kind === "PROMOTED" ? read.value.records : []);
}
