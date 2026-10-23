/**
 * Census ACS B01003 population by ZCTA and by state, read from the promoted projection. Never called
 * from a request path.
 *
 * An ACS 5-year figure for a small area is an estimate with a published interval, so
 * `zipPopulationReading` returns a disposition rather than a bare number:
 *   COUNTED                 the 90% interval excludes zero; rendered with its ± margin.
 *   WITHIN_MARGIN_OF_ERROR  the margin reaches zero; rendered as a sentence.
 *   RECORDED_AS_NONE        the estimate itself is 0 (not "nobody lives here", not a collection gap).
 *   NO_TABULATION_AREA      the ZIP has no ZCTA row (PO-box or single-site ZIP); a named gap.
 * The dividing line is the Bureau's own margin (`B01003_001M`). An estimate with no published margin
 * (state rows) is COUNTED with a null margin.
 */
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { requiredRoutineContract, routineFreshnessMs } from "../civic-data/contracts.ts";
import type { AcsPopulationRow } from "../sources/census-acs-population/index.ts";
const ACS_CONTRACT = requiredRoutineContract("census-acs-population");
const ACS_SCOPE = ACS_CONTRACT.scope;

export interface PromotedAcsPopulation {
  readonly formatVersion: 1;
  readonly vintage: number;
  readonly zcta: readonly AcsPopulationRow[];
  readonly state: readonly AcsPopulationRow[];
}

function validatePopulation(payload: PromotedAcsPopulation, versionId: string): void {
  if (payload.formatVersion !== 1 || !Number.isInteger(payload.vintage) || !Array.isArray(payload.zcta) || !Array.isArray(payload.state)) {
    throw new Error(`ACS projection ${versionId} does not satisfy the supported Reader contract.`);
  }
}

/** Typed ACS read outcome. */
export async function readPopulationProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<PromotedAcsPopulation>> {
  const now = options.now ?? new Date().toISOString();
  const result = await readPromotedCivicData<PromotedAcsPopulation>("CENSUS_REFERENCE", ACS_SCOPE, {
    ...options,
    now,
    maxAgeMs: options.maxAgeMs ?? routineFreshnessMs(ACS_CONTRACT.id, now),
  });
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validatePopulation(result.value, result.metadata.versionId ?? result.kind);
  }
  return result;
}
