/**
 * Territory for a district TIGER publishes no boundary for, from what its own
 * law and records say, built only from territories the data already holds:
 *
 * - COUNTY: the district is its county.
 * - MEMBER_UNION: the district is the union of its member school districts. A
 *   member whose territory is unresolved is named and left out: the union is a
 *   floor, never a guess.
 *
 * Pure: every territory is read from what it is handed.
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
    };

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

/** Each rule names what it rests on. */
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
        { pid6: "177987", name: "PATAGONIA UNION HIGH SCHOOL DISTRICT 20" },
        { pid6: "209962", name: "SAN SIMON SCHOOL DISTRICT 18" },
        { pid6: "202899", name: "ST DAVID SCHOOL DISTRICT 21" },
        { pid6: "100310", name: "TOMBSTONE SCHOOL DISTRICT 1" },
        { pid6: "177939", name: "VALLEY UNION HIGH SCHOOL DISTRICT 22" },
        { pid6: "188126", name: "WILLCOX SCHOOL DISTRICT 13" },
      ],
      unresolved: [],
    },
    evidence: [
      "A.R.S. 15-393: a joint technical education district is formed by, and its territory is, its member school districts",
      "cochisejted.org's own \"Member Schools\" list: Benson, Bisbee, Bowie, Buena (Sierra Vista Unified), Douglas, Patagonia, San Simon, St. David, Tombstone, Valley Union and Willcox High Schools",
      "Patagonia High School's district lies in Santa Cruz County, so the district is not coextensive with Cochise County",
      "Held Census 2022 independent school-system row 177987 is secondary-only; held NCES CCD 2025-26 row 0406030 uniquely names Patagonia Union High School District, grades 09–12, PO Box 254, Patagonia AZ. Its elementary district is a separate row (209974/0406000), never a substitute boundary.",
    ],
    observed: RESEARCH,
  },
];

/** A territory a rule gives, with the method it records; or why the unit stays unplaced. */
export type RuledTerritory =
  | { readonly zctas: ReadonlySet<string>; readonly shares: ReadonlyMap<string, number>; readonly method: string }
  | { readonly unplaced: string };

/**
 * The territory a rule gives a Census unit with none of its own; null when no
 * rule names it. COUNTY takes its county's ZCTAs and shares; MEMBER_UNION takes
 * every member's ZCTAs and, in each, the largest member's share (members may
 * overlap, so shares are never added). A rule whose territory cannot be built
 * leaves the unit unplaced, by name.
 */
export function ruledDistrictTerritory(
  unit: Pick<CensusUnitTerritory, "state" | "pid6">,
  units: ReadonlyMap<string, CensusUnitTerritory>,
  sharesFor: (key: string) => ReadonlyMap<string, number> | undefined,
  shareKeyOf: (unit: CensusUnitTerritory) => string | null,
  rules: readonly DistrictTerritory[] = DISTRICT_TERRITORIES,
): RuledTerritory | null {
  const state = unit.state.toUpperCase();
  const rule = rules.find((r) => r.state === state && r.pid6 === unit.pid6);
  if (rule === undefined) return null;
  const r = rule.rule;
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
