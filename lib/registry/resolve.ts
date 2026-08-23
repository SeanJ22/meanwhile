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

/** Every division whose boundary contains the point. */
export function divisionsAt(
  point: [number, number],
  features: GeoFeature[],
  divisions: Map<string, Division>,
): Division[] {
  sweeps += 1;
  const hits: Division[] = [];
  const seen = new Set<string>();

  for (const feature of features) {
    const ocdId = feature.properties.ocdId;
    if (seen.has(ocdId)) continue;
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
  return { divisions: hit, bodies: bodies.filter((b) => b.ocdId && ids.has(b.ocdId)) };
}
