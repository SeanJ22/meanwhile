import type { RegistrationReference } from "../registration/reference.ts";
import type { CensusGovernmentFacts } from "../registration/jurisdictions.ts";
import type { BuiltScope } from "../census-geography/dataset.ts";
import { censusWorkDivision } from "../census-geography/division-id.ts";
import type { GeographyRef } from "../census-geography/contract.ts";
import type { ZipDivisionEntry } from "../geo/zip-division-index.ts";
import type { PlaceBoundary } from "./types.ts";
import type { MapEdge, MapPlace, StatePlaceMap } from "./load.ts";
import { ocdStateCode } from "../ocd/state-of.ts";
import { countyIdentity, placeIdentity, subdivisionIdentity } from "../ocd/divisions.ts";
import type { GeographicDistrict } from "./special-districts.ts";
import type { EntityPlace } from "../core/shapes.ts";
import type { PostalLink } from "./postal-links.ts";
import { isTownOrCountyDivision } from "../geo/postal-core.ts";

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
  readonly additionalPlaces?: readonly MapPlace[];
  readonly acquiredEdges?: readonly MapEdge[];
  readonly censusFacts?: ReadonlyMap<string, CensusGovernmentFacts>;
  readonly sourceCounties?: ReadonlyMap<string, string | null>;
  readonly geographicDistricts?: readonly GeographicDistrict[];
  readonly postalLinks?: readonly PostalLink[];
  readonly crossStateZctas?: ReadonlySet<string>;
  readonly checkedAt: string;
}): StatePlaceMap {
  const { registration: reg } = input;
  const places = new Map<string, MapPlace>((input.additionalPlaces ?? []).map(place => [place.id, place]));
  const boundaries = new Map(input.boundaries.map(row => [key(row.placeId, row.boundaryYear), row]));
  const zipEdges = new Map<string, MapEdge>(), zctaEdges = new Map<string, MapEdge>();
  const entityPlaces: EntityPlace[] = [];
  const byGeoid = new Map(reg.divisions.map(row => [`${row[1]}:${row[2]}`, row[0]]));
  for (const place of input.additionalPlaces ?? []) for (const alias of place.aliases) {
    if (alias.scheme.startsWith("census-geoid:")) byGeoid.set(`${alias.scheme.slice("census-geoid:".length)}:${alias.value}`, place.id);
  }
  const byId = new Map(reg.divisions.map(row => [row[0], row]));
  const countyByGeoid = new Map(reg.divisions.filter(row => row[1] === "county").map(row => [row[2], row[0]]));
  const state = reg.state.toUpperCase();
  const countyNames = new Map(input.scopes.filter(scope => scope.type === "county").flatMap(scope => scope.groupings)
    .map(group => [group.geoid, group.label.replace(new RegExp(`^${state}\\s+`), "")]));
  const put = (id: string, name: string, layer: string, geoid: string, year: number, version: string, sourceUrls: readonly string[] = []) => {
    const previous = places.get(id);
    const aliases = [...(previous?.aliases ?? []), ...(geoid ? [{ scheme: layer === "district" ? "boundary-feature" : `census-geoid:${layer}`, value: geoid }] : []),
      ...(geoid && ["unsd", "elsd", "scsd"].includes(layer) ? [{ scheme: "nces", value: geoid }] : [])];
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
  for (const edge of input.acquiredEdges ?? []) {
    addEdge(zctaEdges, edge);
    if (input.legacyZips.has(edge.code)) addEdge(zipEdges, edge);
  }
  for (const scope of input.scopes) {
    if (scope.type === "cbsa") continue;
    const layer = layers[scope.type] ?? scope.type, year = boundaryYear(scope.version);
    for (const group of scope.groupings) {
      if (group.stateAbbr !== state) continue;
      const ref: GeographyRef = { ...group, type: scope.type, version: scope.version };
      const label = group.label.replace(new RegExp(`^${state}\\s+`), "");
      const inferred = layer === "county" ? countyIdentity(group.stateFips, label.replace(/\s+(County|Parish|Borough|Census Area)$/i, ""))?.ocdId
        : layer === "place" ? placeIdentity(group.stateFips, label)?.ocdId
        : layer === "cousub" ? subdivisionIdentity(group.stateFips, countyNames.get(group.geoid.slice(0, 5)) ?? "", label)?.ocdId : null;
      const id = byGeoid.get(`${layer}:${group.geoid}`) ?? censusWorkDivision(ref) ?? inferred;
      if (!id) throw new Error(`No held place identity for ${state} ${layer} ${group.geoid}`);
      put(id, group.label, layer, group.geoid, year, scope.version, scope.versionMeta.provenance.sourceUrls);
      if (layer === "county") countyByGeoid.set(group.geoid, id);
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
      if (ocdStateCode(id)?.toUpperCase() !== state && id !== "ocd-division/country:us") continue;
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
  const countyIds = new Set(countyByGeoid.values());
  const countyEdges = [zipEdges, zctaEdges].map(target => {
    const index = new Map<string, MapEdge[]>();
    for (const edge of target.values()) if (countyIds.has(edge.placeId)) {
      const found = index.get(edge.placeId) ?? []; found.push(edge); index.set(edge.placeId, found);
    }
    return { target, index };
  });
  const shaped = new Set([...boundaries.values()].filter(row => row.geometry).map(row => row.placeId));
  const governments = new Map(reg.governments.map(row => [row[0], row]));
  const geographic = new Map((input.geographicDistricts ?? []).map(row => [row.pid, row]));
  const districts = input.geographicDistricts
    ? [...input.geographicDistricts.map(d => governments.get(d.pid) ?? [d.pid, d.governmentId ?? `census-government:${d.pid}`, d.name, "SPECIAL DISTRICT", -1, "", -1] as const),
      ...reg.governments.filter(g => g[3] === "SPECIAL DISTRICT" && !/^\d+$/.test(g[0]))]
    : reg.governments;
  for (const [pid, governmentId, name, type, division] of districts) {
    if (type !== "SPECIAL DISTRICT") continue;
    const registered = division >= 0 ? reg.divisions[division] : undefined;
    const id = registered?.[0] ?? `${governmentId}#place`;
    entityPlaces.push({ entityId: geographic.get(pid)?.governmentId ?? governmentId, placeId: id, boundaryYear: 2022 });
    if (shaped.has(id)) continue;
    const source = registered?.[2].split("#")[0];
    const countyFips = geographic.get(pid)?.countyFips ?? (source ? input.sourceCounties?.get(source) : null) ?? input.censusFacts?.get(pid)?.countyFips;
    const county = countyFips ? countyByGeoid.get(countyFips) : undefined;
    if (!county) continue;
    put(id, name, "district", "", 2022, "district:2022");
    const row = boundaries.get(key(id, 2022))!;
    boundaries.set(key(id, 2022), { ...row, countyAttachment: true, hostCountyId: county });
    for (const { target, index } of countyEdges) {
      for (const edge of index.get(county) ?? []) addEdge(target, { ...edge, placeId: id, boundaryYear: 2022, share: null, shareBasis: "county_attachment", partial: true });
    }
  }
  const byZcta = new Map<string, MapEdge[]>();
  for (const edge of zctaEdges.values()) { const found = byZcta.get(edge.code) ?? []; found.push(edge); byZcta.set(edge.code, found); }
  for (const link of input.postalLinks ?? []) {
    if (link.addressRequired) for (const [id, edge] of zipEdges) {
      if (edge.code === link.zip && !isTownOrCountyDivision(edge.placeId)) zipEdges.delete(id);
    }
    for (const edge of byZcta.get(link.zcta) ?? []) if (!link.addressRequired || isTownOrCountyDivision(edge.placeId)) {
      addEdge(zipEdges, { ...edge, code: link.zip });
    }
  }
  const crossStateZips = new Set(input.crossStateZctas);
  for (const link of input.postalLinks ?? []) if (crossStateZips.has(link.zcta)) crossStateZips.add(link.zip);
  for (const edges of [zipEdges, zctaEdges]) for (const [id, edge] of edges) {
    if (edge.boundaryYear === 2026 && (edges === zipEdges ? crossStateZips : input.crossStateZctas)?.has(edge.code)) {
      edges.set(id, { ...edge, share: null, shareBasis: "unknown", partial: true });
    }
  }
  return { places: [...places.values()], boundaries: [...boundaries.values()].filter(row => places.has(row.placeId)), zipEdges: [...zipEdges.values()], zctaEdges: [...zctaEdges.values()], entityPlaces };
}
