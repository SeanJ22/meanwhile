/** Scoped public population evidence. Postgres selects only the requested geographies;
 * reader requests never download the national ACS payload or contact Census. */
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { AcsPopulationRow } from "../sources/census-acs-population/index.ts";
import type { AcsLoadCounts } from "../sources/census-acs-population/national.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { readPlacePayloadParts } from "../civic-data/place-payload-slices.ts";

export interface PopulationFact extends AcsPopulationRow {
  readonly geography: NonNullable<AcsPopulationRow["geography"]>;
  readonly attribution: NonNullable<AcsPopulationRow["attribution"]>;
}
interface PopulationFactsRead { readonly kind: "HELD" | "NOT_PUBLISHED" | "UNREAD"; readonly rows: readonly PopulationFact[] }
export const statePopulationId = (state: string): string | null => {
  const entry = Object.entries(FIPS_TO_STATE).find(([, value]) => value.postal.toLowerCase() === state.toLowerCase());
  return entry ? `state:${entry[0]}` : null;
};

export async function readPopulationFacts(ids: readonly string[], query: ReadOnlyQuery | null = readerQuery(2000)): Promise<PopulationFactsRead> {
  if (!ids.length) return { kind: "HELD", rows: [] };
  if (!query) return { kind: "UNREAD", rows: [] };
  try {
    const [pointer] = await query([
      { text: "SELECT current_version_id FROM civic_data_promotions WHERE record_class = 'CENSUS_REFERENCE' AND scope = 'acs-population'", params: [] },
    ]);
    if (!pointer.length) return { kind: "NOT_PUBLISHED", rows: [] };
    const version = String(pointer[0].current_version_id);
    const values = await readPlacePayloadParts(query, "CENSUS_REFERENCE", ["acs-population"], [...new Set(ids)], [], [], new Map([["acs-population", version]]));
    const payload = values.get("acs-population") as { state: PopulationFact[]; zcta: PopulationFact[]; geographies: PopulationFact[] };
    const rows = [...payload.state, ...payload.zcta, ...payload.geographies];
    if (rows.some(row => !row.attribution || row.attribution.sourceKind !== "OFFICIAL" || !row.geography || !Number.isSafeInteger(row.population) || row.population < 0)) return { kind: "UNREAD", rows: [] };
    return { kind: "HELD", rows };
  } catch { return { kind: "UNREAD", rows: [] }; }
}

export async function readPopulationLoadCounts(query: ReadOnlyQuery | null = readerQuery(2000)): Promise<readonly AcsLoadCounts[] | null> {
  if (!query) return null;
  try {
    const [rows] = await query([{ text: "SELECT (CASE WHEN part.hash IS NULL THEN p.payload ELSE part.payload->'value' END)->'counts' AS counts" +
      " FROM civic_data_promotions p LEFT JOIN civic_data_payload_parts part ON part.hash = p.payload->>'$civicPayloadPart'" +
      " WHERE p.record_class = 'CENSUS_REFERENCE' AND p.scope = 'acs-population'", params: [] }]);
    return Array.isArray(rows[0]?.counts) ? rows[0].counts as unknown as AcsLoadCounts[] : null;
  } catch { return null; }
}

export function populationSentence(row: PopulationFact): string {
  const number = row.population.toLocaleString("en-US");
  const margin = row.marginOfError === null ? "" : ` ± ${row.marginOfError.toLocaleString("en-US")} (90% margin of error)`;
  return `${row.name}: ${number}${margin}, ACS five-year population estimate for ${row.attribution.period}${row.geography === "zcta" ? ", Census ZIP Code Tabulation Area" : ""}.`;
}
