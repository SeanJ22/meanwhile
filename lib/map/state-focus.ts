import type { FilterSpecification } from "maplibre-gl";
import { pointInRings } from "../geo/polygon.ts";

/** Where the outlines live. Generalized geometry — see the fetch script. */
export const STATE_OUTLINES_URL = "/geo/state-outlines.geojson";

export interface StateOutlineFeature {
  type: "Feature";
  properties: { statefp: string; name: string; ocdId: string };
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

export interface StateOutlines {
  type: "FeatureCollection";
  features: StateOutlineFeature[];
}

let outlinesLoad: Promise<StateOutlines> | null = null;

/** One shared fetch of the outlines; a failed fetch is forgotten so the next caller retries. */
export function loadStateOutlines(): Promise<StateOutlines> {
  outlinesLoad ??= fetch(STATE_OUTLINES_URL).then(response => {
    if (!response.ok) throw new Error(`State outlines: ${response.status}`);
    return response.json() as Promise<StateOutlines>;
  }).catch(error => { outlinesLoad = null; throw error; });
  return outlinesLoad;
}

/** The state OCD-ID a point falls in, or null. Ray casting, no dependency. */
export function stateOcdIdAt(
  outlines: StateOutlines | null,
  lat: number,
  lng: number,
): string | null {
  if (!outlines) return null;
  for (const feature of outlines.features) {
    if (stateContainsPoint(feature, lat, lng)) return feature.properties.ocdId;
  }
  return null;
}

const ringBounds = new WeakMap<number[][], { west: number; south: number; east: number; north: number }>();

export function stateContainsPoint(feature: StateOutlineFeature | null, lat: number, lng: number): boolean {
  if (!feature) return false;
  const longitude = ((lng + 180) % 360 + 360) % 360 - 180;
  for (const x of [longitude, longitude - 360, longitude + 360]) {
    const rings = feature.geometry.coordinates.filter(ring => {
      let bounds = ringBounds.get(ring);
      if (!bounds) {
        bounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
        for (const [rx, ry] of ring) {
          bounds.west = Math.min(bounds.west, rx);
          bounds.south = Math.min(bounds.south, ry);
          bounds.east = Math.max(bounds.east, rx);
          bounds.north = Math.max(bounds.north, ry);
        }
        ringBounds.set(ring, bounds);
      }
      return lat >= bounds.south && lat <= bounds.north && x >= bounds.west && x <= bounds.east;
    });
    if (pointInRings(x, lat, rings)) return true;
  }
  return false;
}

export function outlineFor(
  outlines: StateOutlines | null,
  ocdId: string | null,
): StateOutlineFeature | null {
  if (!outlines || !ocdId) return null;
  return outlines.features.find((f) => f.properties.ocdId === ocdId) ?? null;
}

export function stateAbbrFromOcdId(ocdId: string | null): string | null {
  if (!ocdId) return null;
  const match = /\/(?:state|district|territory):([a-z]{2})$/.exec(ocdId);
  return match ? match[1].toUpperCase() : null;
}

export function filterStateAbbr(
  // `map.getFilter()` may return nothing for an unfiltered layer.
  filter: FilterSpecification | void | undefined,
): string | null {
  if (!Array.isArray(filter)) return null;
  if (filter[0] === "all") {
    for (const part of filter.slice(1)) {
      const state = filterStateAbbr(part as FilterSpecification);
      if (state) return state;
    }
    return null;
  }
  if (filter[0] !== "==" || JSON.stringify(filter[1]) !== '["get","state"]') return null;
  const value = filter[2];
  return typeof value === "string" && value !== NO_STATE ? value : null;
}

export const NO_STATE = "__none__";

/** The filter that pins a district layer to one state, or to nothing. */
export function stateFilter(abbr: string | null): FilterSpecification {
  return ["==", ["get", "state"], abbr ?? NO_STATE] as FilterSpecification;
}
