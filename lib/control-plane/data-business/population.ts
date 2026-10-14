import { readPopulationFacts, statePopulationId, type PopulationFact } from "../../reference/population-facts.ts";
import type { ResultBody, Slice } from "./types.ts";
import type { ReadOnlyQuery } from "../admin-view/promoted-slices.ts";

export interface PopulationDenominator {
  readonly place: string;
  readonly fact: PopulationFact | null;
}
export function populationKeys(slice: Slice, body: ResultBody, recipe: string): string[] {
  if (recipe === "usage-by-district" && body.shape === "totals") return [...new Set(body.rows.flatMap(row => row.series ? [row.series] : []))];
  const place = slice.place;
  if (!place) return ["nation:1"];
  if (place.kind === "zip") return [`zcta:${place.id}`];
  if (place.kind === "state") return [statePopulationId(place.id) ?? `state:${place.id}`];
  return [place.id];
}
/** Source populations travel alongside every sold aggregate. Counts, sample
 * sizes and shares retain their original meanings; no reader is inferred to be a resident. */
export async function populationDenominators(keys: readonly string[], query?: ReadOnlyQuery | null): Promise<readonly PopulationDenominator[]> {
  const read = await readPopulationFacts(keys, query);
  return keys.map(place => {
    const matches = read.kind === "HELD" ? read.rows.filter(row => `${row.geography}:${row.code}` === place || row.divisionIds?.includes(place)) : [];
    return { place, fact: matches.length === 1 ? matches[0] : null };
  });
}
