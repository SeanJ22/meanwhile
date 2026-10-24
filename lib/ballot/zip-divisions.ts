import { readZipPlace, type PlaceEntry } from "../place-map/reader.ts";
import { districtFamilyKey } from "../census-geography/division-id.ts";
import { currentRepresentationSelection, type GeographySelection } from "../census-geography/selection.ts";
import { zipNeedsAddress } from "../geo/postal.ts";
import { isTownOrCountyDivision } from "../geo/postal-core.ts";

const OFFICES: Record<string, string> = { cd: "U.S. House", sldu: "State Senate", sldl: "State House" };

/** A ZIP keeps every selected membership, including its named fringe races.
 * Point callers supply the place map's selection for the election being read. */
export async function divisionIdsForZipArea(
  zip: string | null,
  pointDivisionIds: readonly string[],
  selection: GeographySelection = currentRepresentationSelection(),
  supplied?: PlaceEntry | null,
): Promise<string[]> {
  if (!zip) return [...new Set(pointDivisionIds)];
  const entry = supplied === undefined ? await readZipPlace(zip, selection) : supplied;
  const local = pointDivisionIds.filter(id => !districtFamilyKey(id) && (!zipNeedsAddress(zip) || isTownOrCountyDivision(id)));
  return [...new Set([...local, ...entry?.ids ?? [], ...entry?.fringe ?? []])];
}

export function unestablishedDistrictOfficesForFamilies(families: readonly string[], electionIds: readonly string[]): string[] {
  const established = new Set(electionIds.map(districtFamilyKey).filter(key => key !== null));
  return [...new Set(families.filter(key => !established.has(key)).map(key => OFFICES[key.split("/")[1]]))];
}
