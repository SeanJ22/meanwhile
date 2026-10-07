import { polygonContains } from "../geo/polygon.ts";

/**
 * Governments whose territory is finer than any Census division (community facilities districts, special
 * taxing and improvement districts, districts crossing a county line). Attaching such a body to the
 * smallest containing division would show it to readers it does not govern, so its own polygons are
 * point-tested instead, with the same even-odd test that decides every other government. Every polygon
 * traces to a formation instrument and the publisher that holds the plat; never a name match, ZIP or
 * mailing address.
 */

interface TerritoryFeature {
  properties: {
    bodyId: string;
    bodyName: string;
    plat: string;
    sequence: string | null;
    zcta: string;
    formationInstrument: string;
    formationSource: string;
    platSource: string;
    platSourceOrg: string;
  };
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

export interface BodyTerritoryFile {
  note: string;
  generatedAt: string | null;
  type: "FeatureCollection";
  features: TerritoryFeature[];
}

/** Repo-relative, so the generator, the loader and the guard agree on one spelling. */
export const BODY_TERRITORY_FILE = "data/states/az/geo/body-territories.geojson";

/**
 * The body ids a point falls inside, from a loaded territory file.
 *
 * Returns a Set because a point can legitimately sit in more than one
 * territory — overlapping special districts are ordinary, and a resolver that
 * returned the first hit would silently un-govern the second.
 *
 * The file is passed in rather than read here: this module is imported by the
 * client bundle through `bodiesAt`, and a `readFile` in it would not survive
 * the trip. `lib/registry/server.ts` loads it beside the boundary files.
 */
export function bodyIdsAtPoint(
  point: [number, number],
  territory: BodyTerritoryFile | null,
): Set<string> {
  const hits = new Set<string>();
  if (!territory) return hits;
  for (const f of territory.features) {
    // `polygonContains` directly: `resolve.ts` imports this module, so `contains` would close a cycle.
    if (polygonContains(point, f.geometry.coordinates as [number, number][][])) {
      hits.add(f.properties.bodyId);
    }
  }
  return hits;
}

/** Every body id the territory file speaks for, for guards and reconciliation. */
export function bodyIdsWithTerritory(territory: BodyTerritoryFile | null): Set<string> {
  return new Set((territory?.features ?? []).map((f) => f.properties.bodyId));
}
