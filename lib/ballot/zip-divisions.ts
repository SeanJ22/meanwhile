import { zipDivisionEntry } from "../geo/zip-division-index.ts";
import { zipNeedsAddress } from "../geo/postal.ts";
import { isTownOrCountyDivision } from "../geo/postal-core.ts";
import { districtFamilyKey } from "../census-geography/division-id.ts";
import { currentRepresentationSelection, selectGeographyVersion, type GeographySelection } from "../census-geography/selection.ts";
import type { GeographyType } from "../census-geography/contract.ts";
import type { BallotSet } from "./types.ts";

/** Plans used to build the held point geometry and sampled ZIP index. */
export const POINT_GEOMETRY_PLANS = { cd: "cd:119", sldu: "sldu:2024", sldl: "sldl:2024" } as const;
type DistrictFamily = keyof typeof POINT_GEOMETRY_PLANS;
type PointPlans = Partial<Readonly<Record<DistrictFamily, string>>>;
const TYPES: Record<DistrictFamily, GeographyType> = { cd: "congressional_district", sldu: "state_leg_upper", sldl: "state_leg_lower" };
const OFFICES: Record<DistrictFamily, string> = { cd: "U.S. House", sldu: "State Senate", sldl: "State House" };

/** Every qualified district touching the ZIP, plus point and sampled local
 * divisions. A point district needs its own applicable plan when no ZIP rows
 * qualified that state's family. */
export async function divisionIdsForZipArea(
  zip: string | null,
  pointDivisionIds: readonly string[],
  selection: GeographySelection = currentRepresentationSelection(),
  pointPlans?: PointPlans,
): Promise<string[]> {
  const entry = zip && /^\d{5}$/.test(zip) ? await zipDivisionEntry(zip, selection) : null;
  if (zip && zipNeedsAddress(zip)) {
    return [...new Set([...pointDivisionIds, ...(entry?.ids ?? [])].filter(isTownOrCountyDivision))];
  }
  const areaIds = new Set(entry?.ids ?? []);
  const qualified = new Set(entry?.qualifiedDistricts ?? []);
  const out = new Set([...pointDivisionIds, ...areaIds]);
  for (const id of out) {
    const key = districtFamilyKey(id);
    if (!key) continue;
    if (qualified.has(key)) {
      if (!areaIds.has(id)) out.delete(id);
      continue;
    }
    const [state, family] = key.split("/") as [string, DistrictFamily];
    const plan = pointPlans?.[family];
    if (!plan || !selectGeographyVersion([{ key: plan, type: TYPES[family] }], TYPES[family], selection, state)) out.delete(id);
  }
  return [...out];
}

export function unestablishedDistrictOffices(set: Pick<BallotSet, "contests" | "heldContests">, electionIds: readonly string[]): string[] {
  const established = new Set(electionIds.map(districtFamilyKey).filter(key => key !== null));
  const offices = new Set<string>();
  for (const contest of [...set.contests, ...set.heldContests ?? []]) {
    const key = districtFamilyKey(contest.ocdId);
    if (key && !established.has(key)) offices.add(OFFICES[key.split("/")[1] as DistrictFamily]);
  }
  return [...offices];
}
