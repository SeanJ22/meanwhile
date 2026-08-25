import type { Body, Division } from "./types.ts";
import { polygonContains } from "../geo/polygon.ts";

/**
 * Point → divisions → bodies.
 *
 * Pure: geometry comes in as an argument, so this runs in a test, on a server,
 * or against tiles later without change. **A point is in a *set* of divisions,
 * never one** — Rockaway sits in a K-8 elementary district and a regional high
 * school district at once, and Arizona's legislative districts elect three
 * people between two chambers.
 *
 * A zip centroid is orientation only, never a claim about where anyone lives.
 * CLAUDE.md is explicit that a ZCTA cannot resolve a ballot, and nothing here
 * changes that: this answers "which bodies cover this point on the map".
 */

export type Ring = [number, number][];
export type Polygon = Ring[];

export interface GeoFeature {
  properties: { ocdId: string; label: string; lsad?: string };
  geometry:
    | { type: "Polygon"; coordinates: Ring[] }
    | { type: "MultiPolygon"; coordinates: Ring[][] };
}

// NH79: one even-odd implementation for the whole repo (lib/geo/polygon.ts).
// EXTERIOR-THEN-HOLES is preserved exactly — this path decides which
// government covers a reader's point, and its semantics were not changed.
const inPolygon = (point: [number, number], poly: Polygon): boolean =>
  polygonContains(point, poly);

export function contains(point: [number, number], feature: GeoFeature): boolean {
  const polys =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  return polys.some((poly) => inPolygon(point, poly as Polygon));
}

/**
 * How many point-in-polygon sweeps this process has run — AUD-04's instrument.
 *
 * The change that made `/api/meetings` resolve its geography once was verified
 * with a counter bolted onto the resolver for one afternoon and then removed,
 * which means the property it proved has been unguarded ever since. A second
 * sweep can return the identical answer, so an equivalence test cannot see one
 * come back: the only thing that can is a count.
 *
 * It is one integer increment on a function that walks every committed polygon,
 * so its cost is not measurable against the work it is counting.
 * `tests/resolve-once.test.ts` reads it across a real request and asserts
 * exactly one.
 */
let sweeps = 0;

/** Sweeps run since the process started. Monotonic; read deltas, never totals. */
export function sweepsRun(): number {
  return sweeps;
}

/**
 * **P-003 · HOW MANY FEATURES A SWEEP ACTUALLY TESTED EXACTLY.**
 * (Performance audit of `336a3eb`, remediated 2026-08-24.)
 *
 * `sweepsRun` proves the resolver runs ONCE per request, which AUD-04 needed
 * and which is still true. It says nothing about what one sweep costs, and one
 * sweep was walking every ring of every committed polygon: 118,533 coordinate
 * pairs, most of them congressional districts in states this product does not
 * cover.
 *
 * A bounding box is one comparison of four numbers and it cannot produce a
 * false negative — a point outside a feature's box is outside the feature.
 * `polygonContains` stays the final authority on everything the box lets
 * through, so the ANSWER cannot change; only the number of exact tests does.
 *
 * Counting them is what makes that claim checkable. A prefilter that silently
 * stopped filtering would be invisible in every equivalence test, which is the
 * chromium-pin shape and the reason AUD-04's counter exists at all.
 */
let candidatesTested = 0;

/** Features given an exact point-in-polygon test. Monotonic; read deltas. */
export function candidateFeaturesTested(): number {
  return candidatesTested;
}

/** A feature's bounding box: [west, south, east, north]. */
export type BoundingBox = [number, number, number, number];

export function boundingBoxOf(feature: GeoFeature): BoundingBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const polys =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly as Ring[]) {
      for (const [x, y] of ring) {
        if (x < west) west = x;
        if (x > east) east = x;
        if (y < south) south = y;
        if (y > north) north = y;
      }
    }
  }
  return [west, south, east, north];
}

const inBox = (point: [number, number], box: BoundingBox): boolean =>
  point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];

/**
 * The boxes, computed once per feature array.
 *
 * Keyed on the array identity rather than recomputed per call: the server
 * caches one `features` array for the life of the process, so this is built on
 * the first sweep and read on every one after. A `WeakMap` so a test that
 * builds its own array does not leak.
 */
const boxes = new WeakMap<GeoFeature[], BoundingBox[]>();

function boxesFor(features: GeoFeature[]): BoundingBox[] {
  let cached = boxes.get(features);
  if (!cached) {
    cached = features.map(boundingBoxOf);
    boxes.set(features, cached);
  }
  return cached;
}

/** Every division whose boundary contains the point. */
export function divisionsAt(
  point: [number, number],
  features: GeoFeature[],
  divisions: Map<string, Division>,
): Division[] {
  sweeps += 1;
  const hits: Division[] = [];
  const seen = new Set<string>();
  const featureBoxes = boxesFor(features);

  for (const [index, feature] of features.entries()) {
    const ocdId = feature.properties.ocdId;
    if (seen.has(ocdId)) continue;
    /*
     * P-003 · the cheap test first. A point outside the box is outside the
     * polygon — that direction has no false negatives, which is what lets the
     * exact test remain the only thing that ever says YES.
     */
    if (!inBox(point, featureBoxes[index])) continue;
    candidatesTested += 1;
    if (!contains(point, feature)) continue;

    const division = divisions.get(ocdId);
    if (!division) continue;

    seen.add(ocdId);
    hits.push(division);
  }

  return hits;
}

/**
 * Every body associated with the divisions covering a point.
 *
 * `resolved` (AUD-04, 2026-08-18) lets a caller that has ALREADY run
 * `divisionsAt` for this exact point hand the answer in rather than paying for
 * a second identical sweep. `/api/meetings` was the case: it resolved the point
 * for the online-meeting filter, then called this, which resolved the same
 * point against the same features all over again.
 *
 * It is an optional input and not a required one on purpose. Passing a
 * DIFFERENT point's divisions would silently answer about somewhere else, so
 * the only caller that may pass it is one holding this point's own result, and
 * every caller that does not simply gets the resolution it always got.
 */
export function bodiesAt(
  point: [number, number],
  features: GeoFeature[],
  divisions: Map<string, Division>,
  bodies: Body[],
  resolved?: Division[],
): { divisions: Division[]; bodies: Body[] } {
  const hit = resolved ?? divisionsAt(point, features, divisions);
  const ids = new Set(hit.map((d) => d.ocdId));
  /*
   * **A BODY THAT SPANS TWO TOWNS IS FOUND FROM EITHER.** (RULING 121, Sean's
   * decision of 2026-08-24, closing `NH33`.) One body, one id, rendered under
   * every division it governs — see `alsoServesOcdIds` on `Body`. Matching only
   * the primary id would hide Lake Todd from readers in Bradford, who are
   * governed by it exactly as much as readers in Newbury.
   */
  const serves = (b: Body): boolean =>
    (b.ocdId !== null && ids.has(b.ocdId)) ||
    (b.alsoServesOcdIds ?? []).some((id) => ids.has(id));
  return { divisions: hit, bodies: bodies.filter(serves) };
}
