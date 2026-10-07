import type { Tier } from "./tiers.ts";
import type { DistrictType } from "../state/types.ts";

/**
 * Which level of government each civic map overlay belongs to, by the kind of division it draws, never by label. The
 * basemap is not on this table and is never touched by the level filter.
 */
export const DISTRICT_TYPE_TIER: Readonly<Record<DistrictType, Tier>> = {
  // Seats in the US House.
  congressional: "national",
  // The two chambers of the state legislature.
  "state-senate": "state",
  "state-house": "state",
  // County, municipality and the three school types are all local government.
  county: "local",
  municipal: "local",
  "school-unified": "local",
  "school-elementary": "local",
  "school-secondary": "local",
};

/** Whether an overlay type is drawn under the given level selection. */
export function districtTypeInTiers(
  type: DistrictType,
  tiers: readonly Tier[],
): boolean {
  return tiers.includes(DISTRICT_TYPE_TIER[type]);
}
