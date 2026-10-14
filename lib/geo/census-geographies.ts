import { districtIdentity, FIPS_TO_STATE } from "../ocd/fips.ts";
import { countyIdentity, legislativeIdentity, placeIdentity, schoolIdentity, subdivisionIdentity } from "../ocd/divisions.ts";
import { selectGeographyVersion, type GeographySelection } from "../census-geography/selection.ts";
import type { GeographyType } from "../census-geography/contract.ts";
import type { Division } from "../registry/types.ts";

export type CensusGeographies = Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
const PLANS = [
  { key: "cd:119", type: "congressional_district" }, { key: "cd:120", type: "congressional_district" },
  { key: "sldu:2024", type: "state_leg_upper" }, { key: "sldu:2026", type: "state_leg_upper" },
  { key: "sldl:2024", type: "state_leg_lower" }, { key: "sldl:2026", type: "state_leg_lower" },
] as const;

export function censusVintageFor(selection: GeographySelection): string {
  const plan = selectGeographyVersion(PLANS, "congressional_district", selection);
  return plan?.key === "cd:119" ? "ACS2025_Current" : "Current_Current";
}

export function divisionsFromCensusGeographies(geographies: CensusGeographies, selection: GeographySelection,
  sourceUrl: string, observedAt: string, geographyVintages: Readonly<Record<string, string>> = {}): Division[] {
  const counties = new Map((geographies.Counties ?? []).map(row => [text(row.GEOID), text(row.BASENAME) || text(row.NAME)]));
  const layers = Object.keys(geographies).map(name => {
    const cd = /^(\d+)(?:st|nd|rd|th) Congressional Districts$/.exec(name);
    const sld = /^(\d{4}) State Legislative Districts - (Upper|Lower)$/.exec(name);
    const type: GeographyType | null = cd ? "congressional_district" : sld ? sld[2] === "Upper" ? "state_leg_upper" : "state_leg_lower" : null;
    return { name, type, key: cd ? `cd:${cd[1]}` : sld ? `${sld[2] === "Upper" ? "sldu" : "sldl"}:${sld[1]}` : "" };
  });
  const out = new Map<string, Division>();
  for (const layer of layers) for (const row of geographies[layer.name]) {
    const geoid = text(row.GEOID), statefp = text(row.STATE) || geoid.slice(0, 2), state = FIPS_TO_STATE[statefp];
    if (!state || !geoid) continue;
    if (layer.type && selectGeographyVersion(layers.filter(row => row.type !== null) as {key: string; type: GeographyType}[], layer.type, selection, state.postal)?.key !== layer.key) continue;
    let identity = null, divisionType = "";
    const name = text(row.BASENAME) || text(row.NAME);
    if (layer.type === "congressional_district") { identity = districtIdentity(statefp, geoid.slice(2)); divisionType = "cd"; }
    else if (layer.type === "state_leg_upper" || layer.type === "state_leg_lower") {
      divisionType = layer.type === "state_leg_upper" ? "sldu" : "sldl";
      identity = legislativeIdentity(statefp, layer.type === "state_leg_upper" ? "sldu" : "sldl", text(row[divisionType.toUpperCase()]) || geoid.slice(2), text(row.NAME));
    } else if (layer.name === "Counties") { identity = countyIdentity(statefp, name); divisionType = "county"; }
    else if (layer.name === "Incorporated Places") { identity = placeIdentity(statefp, name); divisionType = "place"; }
    else if (/^(Unified|Elementary|Secondary) School Districts$/.test(layer.name)) { identity = schoolIdentity(statefp, text(row.NAME)); divisionType = "school_district"; }
    else if (layer.name === "County Subdivisions" && ["A", "B", "C", "G"].includes(text(row.FUNCSTAT))) {
      const county = counties.get(geoid.slice(0, 5));
      if (county) identity = subdivisionIdentity(statefp, county, text(row.NAME), text(row.LSADC));
      divisionType = "place";
    }
    if (!identity) continue;
    const source = new URL(sourceUrl);
    if (geographyVintages[layer.name]) source.searchParams.set("vintage", geographyVintages[layer.name]);
    out.set(identity.ocdId, { ocdId: identity.ocdId, divisionType, state: state.postal,
      label: text(row.NAME) || identity.label, tier: divisionType === "cd" ? "national" : layer.type ? "state" : "local",
      parentOcdId: identity.ocdId.slice(0, identity.ocdId.lastIndexOf("/")), geoid,
      lsad: text(row.LSADC) || null, funcstat: text(row.FUNCSTAT) || null, classfp: text(row.CLASSFP) || null,
      canonicalOcdId: null, canonicalMatch: "none", canonicalGap: "UNDETERMINED", sourceDataset: "CENSUS_RELATIONSHIPS",
      provenance: { sourceUrl: source.href, sourceOrg: "U.S. Census Bureau", collectedAt: observedAt, verifiedAt: observedAt } });
  }
  return [...out.values()];
}
