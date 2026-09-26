/**
 * **A DISTRICT TIGER PUBLISHES NO BOUNDARY FOR, PLACED BY WHAT ITS OWN LAW AND RECORDS SAY ITS TERRITORY IS.**
 * (2026-09-26, the 85635 expansion.)
 *
 * A Send places a government by the ZCTAs its Census unit covers (`data/derived/census-unit-zips.json`). A district
 * TIGER publishes no boundary for has none there, so no Send could place it: Cochise County's community college
 * district and its joint technical education district among them. Each rule here names, with its evidence, the
 * territory a district's own statute and records give it, built only from territories the committed data already
 * holds:
 *
 * - **COUNTY**: the district is its county. Arizona organizes a community college district "for a single county, two
 *   or more contiguous counties" (A.R.S. 15-1402(A)); Cochise County's was voted by the county's residents in 1961
 *   and its board is elected from precincts in Cochise County.
 * - **MEMBER_UNION**: the district is the school districts that make it up. A joint technical education district's
 *   territory is its member districts' (A.R.S. 15-393). Cochise Technology District lists eleven member high
 *   schools; one of them, Patagonia's, lies in Santa Cruz County, so the district is NOT Cochise County. A member
 *   whose own territory is unresolved is named and left out: the union is a floor, never a guess.
 *
 * A special district with no free, usable boundary source is named here too, as UNPLACEABLE, with the exact source
 * that would place it, so its unplaced reason says what is missing rather than only that TIGER has nothing.
 *
 * PURE: every territory is read from what it is handed.
 */

import type { CensusUnitTerritory } from "./membership.ts";

export interface DistrictTerritoryObservation {
  readonly at: string;
  readonly by: string;
}

export type DistrictTerritoryRule =
  | { readonly kind: "COUNTY"; readonly countyGeoid: string }
  | {
      readonly kind: "MEMBER_UNION";
      /** Member districts whose Census units carry a territory, by `pid6`, with the name that unit carries. */
      readonly members: readonly { readonly pid6: string; readonly name: string }[];
      /** Members the committed data holds no territory for: named, and left out of the union. */
      readonly unresolved: readonly { readonly pid6: string; readonly name: string; readonly why: string }[];
    }
  | { readonly kind: "UNPLACEABLE"; readonly missing: string };

export interface DistrictTerritory {
  readonly state: string;
  /** The district's Census of Governments unit. */
  readonly pid6: string;
  readonly name: string;
  readonly rule: DistrictTerritoryRule;
  readonly evidence: readonly string[];
  readonly observed: DistrictTerritoryObservation;
}

const RESEARCH: DistrictTerritoryObservation = {
  at: "2026-09-26T05:25:00Z",
  by: "85635 acquisition session: one honest request per page, robots.txt read first",
};

/** The committed rules. Each names what it rests on; a rule without evidence is not a rule. */
export const DISTRICT_TERRITORIES: readonly DistrictTerritory[] = [
  {
    state: "AZ",
    pid6: "177940",
    name: "COCHISE COUNTY COMMUNITY COLLEGE DISTRICT",
    rule: { kind: "COUNTY", countyGeoid: "04003" },
    evidence: [
      "A.R.S. 15-1402(A) (azleg.gov/ars/15/01402.htm): a community college district is organized for a single county, two or more contiguous counties, or an existing district and contiguous counties",
      "cochise.edu/administration/governance: \"The Cochise County Community College District is governed by a five-member Governing Board elected from precincts in Cochise County\"",
      "cochise.edu/about: on October 17, 1961 Cochise County's residents voted to approve the formation of the district",
    ],
    observed: RESEARCH,
  },
  {
    state: "AZ",
    pid6: "213773",
    name: "COCHISE TECHNOLOGY DISTRICT",
    rule: {
      kind: "MEMBER_UNION",
      members: [
        { pid6: "198356", name: "BENSON UNIFIED SCHOOL DISTRICT" },
        { pid6: "209960", name: "BISBEE UNIFIED SCHOOL DISTRICT 2" },
        { pid6: "100308", name: "BOWIE SCHOOL DISTRICT 14" },
        { pid6: "177936", name: "SIERRA VISTA UNIFIED SCHOOL DISTRICT 68" },
        { pid6: "115654", name: "DOUGLAS UNIFIED SCHOOL DISTRICT 27" },
        { pid6: "209962", name: "SAN SIMON SCHOOL DISTRICT 18" },
        { pid6: "202899", name: "ST DAVID SCHOOL DISTRICT 21" },
        { pid6: "100310", name: "TOMBSTONE SCHOOL DISTRICT 1" },
        { pid6: "177939", name: "VALLEY UNION HIGH SCHOOL DISTRICT 22" },
        { pid6: "188126", name: "WILLCOX SCHOOL DISTRICT 13" },
      ],
      unresolved: [
        { pid6: "177987", name: "PATAGONIA UNION HIGH SCHOOL DISTRICT 20", why: "its Census unit has no NCES match in the crosswalk, so the committed data holds no territory for it" },
      ],
    },
    evidence: [
      "A.R.S. 15-393: a joint technical education district is formed by, and its territory is, its member school districts",
      "cochisejted.org's own \"Member Schools\" list: Benson, Bisbee, Bowie, Buena (Sierra Vista Unified), Douglas, Patagonia, San Simon, St. David, Tombstone, Valley Union and Willcox High Schools",
      "Patagonia High School's district lies in Santa Cruz County, so the district is not coextensive with Cochise County",
    ],
    observed: RESEARCH,
  },
  {
    state: "AZ",
    pid6: "183867",
    name: "FRY FIRE DISTRICT",
    rule: {
      kind: "UNPLACEABLE",
      missing:
        "TIGER publishes no fire-district boundary. The one free public source is the Arizona Department of Forestry and Fire Management's " +
        "\"Arizona Fire Districts\" layer on AZGeo (services6.arcgis.com/clPWQMwZfdWn4MQZ, Arizona_Fire_Districts_Spatial_Join), whose own " +
        "disclaimer calls its boundaries approximate and its purpose wildfire dispatch; no step yet turns its polygons into ZCTA shares, and " +
        "no county-published boundary (Cochise County GIS) or legal description was found",
    },
    evidence: ["data/derived/census-unit-zips.json: \"TIGER publishes NO special-district boundaries at any vintage\"", "data/states/az/hunt/az-district-layers.json: az-fire-service-areas"],
    observed: RESEARCH,
  },
  {
    state: "AZ",
    pid6: "141324",
    name: "PALOMINAS FIRE DISTRICT",
    rule: {
      kind: "UNPLACEABLE",
      missing:
        "TIGER publishes no fire-district boundary. The one free public source is the Arizona Department of Forestry and Fire Management's " +
        "\"Arizona Fire Districts\" layer on AZGeo (services6.arcgis.com/clPWQMwZfdWn4MQZ, Arizona_Fire_Districts_Spatial_Join), whose own " +
        "disclaimer calls its boundaries approximate and its purpose wildfire dispatch; no step yet turns its polygons into ZCTA shares, and " +
        "no county-published boundary (Cochise County GIS) or legal description was found",
    },
    evidence: ["data/derived/census-unit-zips.json: \"TIGER publishes NO special-district boundaries at any vintage\"", "data/states/az/hunt/az-district-layers.json: az-fire-service-areas"],
    observed: RESEARCH,
  },
];

/** A territory a rule gives, with the method it records; or why the unit stays unplaced. */
export type RuledTerritory =
  | { readonly zctas: ReadonlySet<string>; readonly shares: ReadonlyMap<string, number>; readonly method: string }
  | { readonly unplaced: string };

/**
 * The territory a committed rule gives a Census unit with none of its own, or null when no rule names it. A COUNTY
 * rule takes its county's ZCTAs and sampled shares; a MEMBER_UNION rule takes every member's ZCTAs and, in each, the
 * largest member's share (members may overlap, as a union high school district overlaps its elementary districts,
 * so shares are never added). A rule whose territory cannot be built from what it is handed leaves the unit unplaced,
 * by name.
 */
export function ruledDistrictTerritory(
  unit: Pick<CensusUnitTerritory, "state" | "pid6">,
  units: ReadonlyMap<string, CensusUnitTerritory>,
  sharesFor: (key: string) => ReadonlyMap<string, number> | undefined,
  shareKeyOf: (unit: CensusUnitTerritory) => string | null,
  rules: readonly DistrictTerritory[] = DISTRICT_TERRITORIES,
): RuledTerritory | null {
  const rule = rules.find((r) => r.state === unit.state.toUpperCase() && r.pid6 === unit.pid6);
  if (rule === undefined) return null;
  const r = rule.rule;
  if (r.kind === "UNPLACEABLE") return { unplaced: `no boundary source places it: ${r.missing}` };
  if (r.kind === "COUNTY") {
    const county = [...units.values()].find((u) => u.type === "COUNTY" && u.state.toUpperCase() === rule.state && shareKeyOf(u) === `county:${r.countyGeoid}`);
    if (county === undefined || county.zips.length === 0) return { unplaced: `its rule takes county ${r.countyGeoid}'s territory, and the committed data holds none for it` };
    return {
      zctas: new Set(county.zips),
      shares: sharesFor(`county:${r.countyGeoid}`) ?? new Map<string, number>(),
      method: `county GEOID ${r.countyGeoid}: the district is its county (${rule.evidence[0]})`,
    };
  }
  const zctas = new Set<string>();
  const shares = new Map<string, number>();
  const placed: string[] = [];
  for (const m of r.members) {
    const member = units.get(`${rule.state}:${m.pid6}`);
    if (member === undefined || member.zips.length === 0) continue;
    placed.push(m.name);
    const key = shareKeyOf(member);
    const own = key === null ? undefined : sharesFor(key);
    for (const z of member.zips) {
      zctas.add(z);
      const share = own?.get(z);
      if (share !== undefined) shares.set(z, Math.max(shares.get(z) ?? 0, share));
    }
  }
  if (zctas.size === 0) return { unplaced: "its rule takes its member districts' territory, and the committed data holds none for any of them" };
  const missing = [...r.unresolved.map((u) => `${u.name} (${u.why})`), ...r.members.filter((m) => !placed.includes(m.name)).map((m) => `${m.name} (no territory in the committed data)`)];
  return {
    zctas,
    shares,
    method: `the union of ${placed.length} member district(s)' territories${missing.length === 0 ? "" : `; left out, so the union is a floor: ${missing.join("; ")}`}`,
  };
}
