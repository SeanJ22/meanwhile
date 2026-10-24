import type { RegistrationReference } from "../registration/reference.ts";
import type { CensusGovernmentFacts } from "../registration/jurisdictions.ts";
import type { BuiltScope } from "../census-geography/dataset.ts";
import { censusWorkDivision } from "../census-geography/division-id.ts";
import type { GeographyRef } from "../census-geography/contract.ts";
import type { ZipDivisionEntry } from "../geo/zip-division-index.ts";
import type { PlaceBoundary } from "./types.ts";
import type { MapEdge, MapPlace, StatePlaceMap } from "./load.ts";

const layers: Readonly<Record<string, string>> = { congressional_district: "cd", state_leg_upper: "sldu", state_leg_lower: "sldl", county_subdivision: "cousub" };
const key = (id: string, year: number) => `${id}|${year}`;
export function boundaryYear(version: string): number {
  const match = /^([a-z]+):(\d+)$/.exec(version);
  if (!match) throw new Error(`Boundary version has no source year: ${version}`);
  return match[1] === "cd" ? 1786 + Number(match[2]) * 2 : Number(match[2]);
}

/** Bounded to one state. Existing OCD ids are the identity source; Census
 * district codes use the same identity rules as the current reader. */
export function buildStatePlaceMap(input: {
  readonly registration: RegistrationReference;
  readonly scopes: readonly BuiltScope[];
  readonly legacyZips: ReadonlyMap<string, ZipDivisionEntry>;
  /** Codes confirmed by the source Census ZCTA file, independently of USPS. */
  readonly legacyZctas: ReadonlySet<string>;
  readonly boundaries: readonly PlaceBoundary[];
  readonly censusFacts?: ReadonlyMap<string, CensusGovernmentFacts>;
  readonly sourceCounties?: ReadonlyMap<string, string | null>;
  readonly checkedAt: string;
}): StatePlaceMap {
  const { registration: reg } = input;
  const places = new Map<string, MapPlace>();
  const boundaries = new Map(input.boundaries.map(row => [key(row.placeId, row.boundaryYear), row]));
  const zipEdges = new Map<string, MapEdge>(), zctaEdges = new Map<string, MapEdge>();
  const byGeoid = new Map(reg.divisions.map(row => [`${row[1]}:${row[2]}`, row[0]]));
  const byId = new Map(reg.divisions.map(row => [row[0], row]));
  const countyByGeoid = new Map(reg.divisions.filter(row => row[1] === "county").map(row => [row[2], row[0]]));
  const state = reg.state.toUpperCase();
  const put = (id: string, name: string, layer: string, geoid: string, year: number, version: string, sourceUrls: readonly string[] = []) => {
    const previous = places.get(id);
    const aliases = [...(previous?.aliases ?? []), ...(geoid ? [{ scheme: layer === "district" ? "boundary-feature" : `census-geoid:${layer}`, value: geoid }] : []),
      ...(["unsd", "elsd", "scsd"].includes(layer) ? [{ scheme: "nces", value: geoid }] : [])];
    places.set(id, { id, name: previous?.name ?? name, state: id === "ocd-division/country:us" ? null : state, aliases: [...new Map(aliases.map(a => [`${a.scheme}:${a.value}`, a])).values()] });
    if (!boundaries.has(key(id, year))) boundaries.set(key(id, year), { placeId: id, boundaryYear: year, layer, version,
      geometry: null, hostCountyId: null, countyAttachment: false, sourceUrls, checkedAt: input.checkedAt });
  };
  for (const [id, layer, geoid, name] of reg.divisions) {
    const year = layer === "district" ? 2022 : 2023;
    put(id, name, layer, geoid, year, `${layer}:${year}`);
  }
  const addEdge = (target: Map<string, MapEdge>, edge: MapEdge) => {
    const identity = `${edge.code}|${key(edge.placeId, edge.boundaryYear)}`, previous = target.get(identity);
    target.set(identity, previous ? { ...edge, share: edge.share ?? previous.share, shareBasis: edge.share === null ? previous.shareBasis : edge.shareBasis,
      partial: edge.partial && previous.partial, fringe: edge.fringe && previous.fringe } : edge);
  };
  for (const scope of input.scopes) {
    if (scope.type === "cbsa") continue;
    const layer = layers[scope.type] ?? scope.type, year = boundaryYear(scope.version);
    for (const group of scope.groupings) {
      if (group.stateAbbr !== state) continue;
      const ref: GeographyRef = { ...group, type: scope.type, version: scope.version };
      const id = byGeoid.get(`${layer}:${group.geoid}`) ?? censusWorkDivision(ref);
      if (!id) throw new Error(`No held place identity for ${state} ${layer} ${group.geoid}`);
      put(id, group.label, layer, group.geoid, year, scope.version, scope.versionMeta.provenance.sourceUrls);
      for (const overlap of group.overlaps) {
        const edge: MapEdge = { code: overlap.zcta5, placeId: id, boundaryYear: year, share: overlap.fraction,
          shareBasis: scope.fractionBasis, partial: !overlap.whole, fringe: false };
        addEdge(zctaEdges, edge);
        // Census supplies ZCTA membership. Only a separately held postal ZIP
        // establishes a ZIP row of the same code.
        if (input.legacyZips.has(overlap.zcta5)) addEdge(zipEdges, edge);
      }
    }
  }
  for (const [zip, entry] of input.legacyZips) {
    for (const id of [...entry.ids, ...entry.fringe ?? []]) {
      if (!id.includes(`:${state.toLowerCase()}`) && id !== "ocd-division/country:us") continue;
      const family = /\/(cd|sldu|sldl):/.exec(id)?.[1];
      const registered = byId.get(id);
      const layer = family ?? registered?.[1] ?? "place";
      const year = family ? 2024 : layer === "district" ? 2022 : 2023;
      const version = family === "cd" ? "cd:119" : `${layer}:${year}`;
      put(id, registered?.[3] ?? id.split("/").at(-1)!.split(":").slice(1).join(":").replaceAll("_", " "), layer, "", year, version);
      const edge = { code: zip, placeId: id, boundaryYear: year, share: null, shareBasis: "unknown",
        partial: entry.partial.includes(id), fringe: entry.fringe?.includes(id) ?? false };
      addEdge(zipEdges, edge);
      if (input.legacyZctas.has(zip)) addEdge(zctaEdges, edge);
    }
  }
  // A government without its own polygon is filed at its source's host county.
  // Its county reach is explicit metadata, not an invented district shape.
  for (const [pid, governmentId, name, type, division] of reg.governments) {
    if (type !== "SPECIAL DISTRICT") continue;
    const registered = division >= 0 ? reg.divisions[division] : undefined;
    const id = registered?.[0] ?? `${governmentId}#place`;
    if ([...boundaries.values()].some(row => row.placeId === id && row.geometry)) continue;
    const source = registered?.[2].split("#")[0];
    const countyFips = (source ? input.sourceCounties?.get(source) : null) ?? input.censusFacts?.get(pid)?.countyFips;
    const county = countyFips ? countyByGeoid.get(countyFips) : undefined;
    if (!county) continue;
    put(id, name, "district", "", 2022, "district:2022");
    const row = boundaries.get(key(id, 2022))!;
    boundaries.set(key(id, 2022), { ...row, countyAttachment: true, hostCountyId: county });
    for (const [target, current] of [[zipEdges, [...zipEdges.values()]], [zctaEdges, [...zctaEdges.values()]]] as const) {
      for (const edge of current) if (edge.placeId === county) addEdge(target, { ...edge, placeId: id, boundaryYear: 2022, share: null, shareBasis: "county_attachment", partial: true });
    }
  }
  return { places: [...places.values()], boundaries: [...boundaries.values()].filter(row => places.has(row.placeId)), zipEdges: [...zipEdges.values()], zctaEdges: [...zctaEdges.values()] };
}
