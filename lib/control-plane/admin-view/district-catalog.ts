/** GEOID: state FIPS plus two digits, `00` for a single-seat state and `98` for DC and territory delegates. 2020 apportionment. PURE; client-safe. */
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { districtLabelOf } from "./district-label.ts";

/** Voting seats per state after the 2020 apportionment. */
const SEATS: Readonly<Record<string, number>> = {
  AL: 7, AK: 1, AZ: 9, AR: 4, CA: 52, CO: 8, CT: 5, DE: 1, FL: 28, GA: 14, HI: 2, ID: 2, IL: 17, IN: 9, IA: 4, KS: 4, KY: 6, LA: 6,
  ME: 2, MD: 8, MA: 9, MI: 13, MN: 8, MS: 4, MO: 8, MT: 2, NE: 3, NV: 4, NH: 2, NJ: 12, NM: 3, NY: 26, NC: 14, ND: 1, OH: 15, OK: 5,
  OR: 6, PA: 17, RI: 2, SC: 7, SD: 1, TN: 9, TX: 38, UT: 4, VT: 1, VA: 11, WA: 10, WV: 2, WI: 8, WY: 1,
};
/** The District of Columbia and the five territories each send one delegate, Census code `98`. */
const DELEGATES: readonly string[] = ["DC", "PR", "GU", "VI", "AS", "MP"];

export interface CatalogDistrict {
  readonly state: string;
  /** The Census GEOID: state FIPS plus two digits. */
  readonly geoid: string;
  /** `AZ-06`, `WY-AL`. */
  readonly label: string;
  readonly placeKey: string;
}

let held: readonly CatalogDistrict[] | null = null;

export function allDistricts(): readonly CatalogDistrict[] {
  if (held !== null) return held;
  const fipsOf = new Map(Object.entries(FIPS_TO_STATE).map(([fips, e]) => [e.postal, fips] as const));
  const out: CatalogDistrict[] = [];
  const add = (postal: string, digits: string) => {
    const fips = fipsOf.get(postal);
    if (fips === undefined) return;
    const state = postal.toLowerCase();
    const geoid = `${fips}${digits}`;
    out.push({ state, geoid, label: districtLabelOf(state, geoid), placeKey: `geo:${state}.congressional_district.${geoid}` });
  };
  for (const [postal, seats] of Object.entries(SEATS)) {
    if (seats === 1) add(postal, "00");
    else for (let n = 1; n <= seats; n += 1) add(postal, String(n).padStart(2, "0"));
  }
  for (const postal of DELEGATES) add(postal, "98");
  held = out;
  return out;
}

export function districtLabelOfQuery(query: string): string | null {
  const m = /^([a-z]{2})[\s-]*(\d{1,2}|al)$/i.exec(query.trim());
  if (m === null) return null;
  const state = m[1].toUpperCase();
  const tail = m[2].toLowerCase();
  const found = allDistricts().find((d) => d.state === state.toLowerCase() && (tail === "al" ? d.label === `${state}-AL` : d.label === `${state}-${tail.padStart(2, "0")}`));
  return found?.label ?? null;
}
