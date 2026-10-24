import { censusSourceRelease, censusTextLines, type CensusSourceOptions } from "../census-geography/source-release.ts";
import { parseGrfHeader } from "../census-geography/grf.ts";
import type { MapEdge, MapPlace } from "./load.ts";

/** The same 2026 GRF block parts that establish CD120 also carry every current
 * county, subdivision, place and school code. Sum their measured land once. */
export async function currentGrfPlaceEdges(fips: string, places: readonly MapPlace[], options: CensusSourceOptions): Promise<MapEdge[]> {
  const byGeoid = new Map(places.flatMap(place => place.aliases.filter(alias => alias.scheme.startsWith("census-geoid:"))
    .map(alias => [`${alias.scheme.slice("census-geoid:".length)}:${alias.value}`, place.id] as const)));
  const release = await censusSourceRelease(`https://www2.census.gov/geo/docs/maps-data/data/grf/2026/public_grfc_cur26_${fips}.txt`, options);
  const lines = censusTextLines(release.bytes), header = parseGrfHeader(lines.next().value ?? "");
  const at = (name: string) => { const i = header.indexOf(name); if (i < 0) throw new Error(`Census GRF is missing ${name}`); return i; };
  const columns = { state: at("CURSTATE"), county: at("CURCOUNTY"), cousub: at("COUSUBFP"), place: at("PLACEFP"),
    elsd: at("SDELMLEA"), scsd: at("SDSECLEA"), unsd: at("SDUNILEA"), aiannh: at("AIANNHCE"), zcta: at("ZCTA5CE"), land: at("AREALAND") };
  const totals = new Map<string, number>(), parts = new Map<string, { code: string; placeId: string; land: number }>();
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = line.split("|");
    if (row.length !== header.length || row[columns.state] !== fips) throw new Error("Census GRF record belongs to another state");
    const code = row[columns.zcta];
    if (!code) continue;
    const land = Number(row[columns.land]);
    if (!/^\d{5}$/.test(code) || !Number.isFinite(land) || land < 0) throw new Error("Census GRF land or ZCTA is invalid");
    totals.set(code, (totals.get(code) ?? 0) + land);
    for (const layer of ["state", "county", "cousub", "place", "elsd", "scsd", "unsd", "aiannh"] as const) {
      const raw = row[columns[layer]];
      if (!raw || /^9+$/.test(raw)) continue;
      const geoid = layer === "aiannh" ? raw : layer === "state" ? fips : layer === "county" ? fips + raw
        : layer === "cousub" ? fips + row[columns.county] + raw : fips + raw;
      const placeId = byGeoid.get(`${layer}:${geoid}`);
      if (!placeId) {
        if (/^0+$/.test(raw)) continue;
        throw new Error(`Census GRF has no source polygon identity for ${layer}:${geoid}`);
      }
      const id = `${code}|${placeId}`, previous = parts.get(id);
      if (previous) previous.land += land;
      else parts.set(id, { code, placeId, land });
    }
  }
  return [...parts.values()].map(part => {
    const total = totals.get(part.code) ?? 0;
    return { code: part.code, placeId: part.placeId, boundaryYear: 2026, share: total > 0 ? Math.min(1, part.land / total) : null,
      shareBasis: total > 0 ? "area" : "unknown", partial: total === 0 || part.land / total < 0.9999, fringe: false };
  });
}
