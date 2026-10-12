import type { GeographyRef } from "./contract.ts";
import { districtIdentity } from "../ocd/fips.ts";
import { legislativeIdentity } from "../ocd/divisions.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";

/** Census identifiers joined by the existing district identity rules. A place
 * name alone never establishes a government or a reader division. */
export function censusWorkDivision(g: GeographyRef): string | null {
  if (g.ocdId) return g.ocdId;
  if (g.type === "overlay_district" && g.chamber) return legislativeIdentity(g.stateFips, g.chamber === "upper" ? "sldu" : "sldl", g.geoid.slice(2), g.label)?.ocdId ?? null;
  if (g.type === "aiannh") {
    const state = FIPS_TO_STATE[g.stateFips];
    return state && /^[a-z0-9-]+$/i.test(g.geoid) ? `ocd-division/country:us/${state.prefix}:${state.postal.toLowerCase()}/aiannh:${g.geoid.toLowerCase()}` : null;
  }
  if (g.type === "congressional_district" && /^\d{4}$/.test(g.geoid)) return districtIdentity(g.geoid.slice(0, 2), g.geoid.slice(2))?.ocdId ?? null;
  if ((g.type === "state_leg_upper" || g.type === "state_leg_lower") && /^\d{2}[a-z0-9-]{1,8}$/i.test(g.geoid)) return legislativeIdentity(g.geoid.slice(0, 2), g.type === "state_leg_upper" ? "sldu" : "sldl", g.geoid.slice(2), g.label)?.ocdId ?? null;
  return null;
}
