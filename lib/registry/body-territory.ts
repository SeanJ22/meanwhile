import { polygonContains } from "../geo/polygon.ts";

/**
 * **A GOVERNMENT WHOSE TERRITORY IS FINER THAN ANY CENSUS DIVISION.**
 * (NH233, 2026-08-27, the coverage-truth session.)
 *
 * ## The defect
 *
 * The **Rocking K South Community Facilities District** is a political taxing
 * subdivision of ZIP 85641 — its own district board, its own resolution series,
 * its own levy — and it **rendered to nobody**. Not because it was unverified:
 * `pnpm cfd:territory` had already resolved its territory from Pima County
 * Resolution 2017-2, which recites *"Blocks 1 through 14 of Rocking K South,
 * Book 64 of Maps and Plats, Page 85"*, and all 25 recorded plats of that name
 * point-test inside ZCTA 85641.
 *
 * It was stranded by a JOIN. `bodiesAt` matches a body to a reader on `ocdId`,
 * and the smallest division containing this district is `county:pima` — **9,200
 * square miles against the district's 2,047 acres**. Attaching it there would
 * have shown a district that taxes 2,047 acres to every reader in Pima County:
 * a false claim about their government, in the direction that looks like
 * coverage. So `ocdId` stayed null, which was the right call, and the body
 * reached no one.
 *
 * The rendered consequence was worse than absence. With `ocdId: null` the
 * jurisdiction badge said **"Boundary not published — no official boundary is
 * published for this body"**. That is a claim about THEM and it is false: the
 * boundary is published, as a recorded plat, by the county recorder. The true
 * sentence was about US.
 *
 * ## The repair, and why it is a shape rather than a fix
 *
 * The missing thing was never a division. It was the geometry, and
 * `scripts/cfd-territory.mts` had been fetching it all along with
 * `returnGeometry: "true"` and keeping only a centroid. It now emits the rings
 * to `data/states/az/geo/body-territories.geojson`, and this module point-tests them
 * with **the same even-odd implementation that decides every other government**
 * — `contains` from `lib/registry/resolve.ts`, not a second copy of it.
 *
 * So the answer is EXACT, not a hedge: a reader inside a Rocking K plat is
 * governed by it; a reader elsewhere in 85641 is not; and neither is told
 * anything the evidence does not support. No `COULD_GOVERN` fudge is needed,
 * because the polygon answers the question the same way a county boundary does.
 *
 * **Any government the Census division model cannot express binds this way** —
 * community facilities districts, special taxing districts, districts crossing
 * a county line, improvement districts, anything whose authoritative publisher
 * holds a polygon. Name the body, cite the document that recites the land, emit
 * the polygons. That is the whole abstraction.
 *
 * ## What it deliberately does not do
 *
 * It does not make a territory out of a name match, a ZIP, or a mailing
 * address. Every polygon here traces to a formation instrument quoted in the
 * generator and to the authoritative publisher that holds the plat.
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
    /*
     * `polygonContains` DIRECTLY, rather than `contains` from `resolve.ts`.
     *
     * `resolve.ts` imports this module, so reaching back into it would close a
     * cycle — and the thing worth sharing is the even-odd implementation
     * itself, which `lib/geo/polygon.ts` holds and which `contains` is a thin
     * wrapper over. NH79 put it there precisely so this repository has exactly
     * ONE answer to "is this point inside this ring", and both callers use it.
     */
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
