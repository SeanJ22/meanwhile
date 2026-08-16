import type {
  FilterSpecification,
  GeoJSONSourceSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";

/**
 * **The state rises out of the map** — g3 item 10 (M91), the author's design,
 * against his reference: breakfreegraphics.com's piece on neumorphism.
 *
 * ## The distinction that IS the spec
 *
 * A Material card **floats above** its background and drops a shadow onto it.
 * A neumorphic element **extrudes from** the background — same material,
 * pushed up out of it. The active state is the second kind, and everything
 * about this file follows from that one sentence:
 *
 * - **Inside the border, the map is UNCHANGED.** No fill tint, no colour
 *   shift, no wash. Arizona is made of the same terrain as the map around it.
 *   A fill would make it a card floating over the map, which is the thing the
 *   reference exists to distinguish this from.
 * - **The rise is the dual shadow**, translated from CSS to map layers: one
 *   light source at top-left, so a soft LIGHT edge runs along the NW border
 *   and a soft DARK edge along the SE. Two opposed blurred line layers, each
 *   offset the other way.
 * - **Everything outside is muted and slightly blurred.** Desaturation alone
 *   is not the spec; the blur is half of it, and it lives in the DOM overlay
 *   (`components/map/state-focus-overlay.tsx`) because WebGL paint properties
 *   cannot blur what is underneath them. This module owns the colour half and
 *   the raised edge.
 *
 * ## The reference's accessibility warning, carried into the spec
 *
 * The article's own caution is that a low-contrast extrusion cannot be asked
 * to CARRY INFORMATION. So this one does not. The extrusion is ambient: it
 * marks where you are and says nothing about the state, the coverage, or
 * anything else. Labels in the muted area stay legible (the mute is a light
 * scrim, not a curtain), pins inside the active state keep full contrast, and
 * the border-crossing prompt does all the actual communicating.
 *
 * ## Zoom invariance
 *
 * The author's test is looking at 85701 and zooming ALL THE WAY OUT: Arizona
 * must still read raised, everything else still muted and slightly blurred.
 * The effect never disappears. Shadow spread SCALES with zoom so the edge
 * stays subtle instead of becoming a cartoon outline at continental scale —
 * the interpolation below is that, and it bottoms out at a visible width
 * rather than at zero.
 */

export const STATE_FOCUS_SOURCE = "state-outlines";
export const STATE_FOCUS_LIGHT_LAYER = "state-focus-light";
export const STATE_FOCUS_DARK_LAYER = "state-focus-dark";

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

/** The state OCD-ID a point falls in, or null. Ray casting, no dependency. */
export function stateOcdIdAt(
  outlines: StateOutlines | null,
  lat: number,
  lng: number,
): string | null {
  if (!outlines) return null;
  for (const feature of outlines.features) {
    if (pointInPolygon(lng, lat, feature.geometry.coordinates)) {
      return feature.properties.ocdId;
    }
  }
  return null;
}

export function outlineFor(
  outlines: StateOutlines | null,
  ocdId: string | null,
): StateOutlineFeature | null {
  if (!outlines || !ocdId) return null;
  return outlines.features.find((f) => f.properties.ocdId === ocdId) ?? null;
}

/**
 * Even-odd ray casting over a polygon's rings.
 *
 * The first ring is the outer boundary and the rest are holes, and even-odd
 * handles both without the caller having to know which is which — New Jersey
 * ships three rings.
 */
function pointInPolygon(x: number, y: number, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * The two opposed edges, added once and re-filtered as the focus moves.
 *
 * `line-translate` is in SCREEN pixels, which is exactly right for a light
 * source: the sun does not rotate with the map. NW is negative on both axes
 * in screen space (x right, y down), so the light offset is `[-d, -d]` and
 * the dark is `[+d, +d]` — the reference's "one shadow negative, one
 * positive", with the light at top-left.
 *
 * Both layers sit under the first symbol layer so place labels stay on top:
 * an ambient effect that paints over a town's name has started carrying
 * information, which is the one thing it may not do.
 */
export function addStateFocusLayers(
  map: MapLibreMap,
  data: StateOutlines,
  before?: string,
): void {
  if (!map.getSource(STATE_FOCUS_SOURCE)) {
    map.addSource(STATE_FOCUS_SOURCE, {
      type: "geojson",
      data,
      promoteId: "ocdId",
    } as GeoJSONSourceSpecification);
  }

  /**
   * Offset, width and blur, by zoom.
   *
   * At neighbourhood zoom the state's border is usually off-screen and the
   * edge is a detail; zoomed all the way out the whole outline is on screen
   * at once and an unscaled edge reads as a drawn border rather than as a
   * rise. Scaling keeps the RATIO of blur to width roughly constant, which is
   * what makes it read as a soft edge at every scale — and the floor is
   * non-zero, because the author's test is that the effect never disappears.
   */
  const byZoom = (near: number, far: number) =>
    [
      "interpolate",
      ["linear"],
      ["zoom"],
      3,
      far,
      7,
      (near + far) / 2,
      12,
      near,
    ] as unknown as number;

  const addIfAbsent = (
    id: string,
    build: () => Parameters<MapLibreMap["addLayer"]>[0],
  ) => {
    if (map.getLayer(id)) return;
    map.addLayer(build(), before);
  };

  // The lit edge, NW. White at low opacity — the same material catching the
  // light, never a colour of its own.
  addIfAbsent(STATE_FOCUS_LIGHT_LAYER, () => ({
    id: STATE_FOCUS_LIGHT_LAYER,
    type: "line",
    source: STATE_FOCUS_SOURCE,
    // Nothing until a state is focused. `filter` is how the focus moves —
    // re-filtering never re-tiles, so activation costs nothing.
    filter: ["==", ["get", "ocdId"], "__none__"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-opacity": 0.5,
      "line-width": byZoom(7, 3),
      "line-blur": byZoom(6, 2.5),
      "line-translate": [-2, -2],
      "line-translate-anchor": "viewport",
    },
  }));

  // The shaded edge, SE. Black at low opacity, the same way.
  addIfAbsent(STATE_FOCUS_DARK_LAYER, () => ({
    id: STATE_FOCUS_DARK_LAYER,
    type: "line",
    source: STATE_FOCUS_SOURCE,
    filter: ["==", ["get", "ocdId"], "__none__"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": "#000000",
      "line-opacity": 0.42,
      "line-width": byZoom(7, 3),
      "line-blur": byZoom(6, 2.5),
      "line-translate": [2, 2],
      "line-translate-anchor": "viewport",
    },
  }));
}

/** Point the two edges at one state, or at none. */
export function setStateFocus(map: MapLibreMap, ocdId: string | null): void {
  const filter: FilterSpecification = [
    "==",
    ["get", "ocdId"],
    ocdId ?? "__none__",
  ];
  for (const id of [STATE_FOCUS_LIGHT_LAYER, STATE_FOCUS_DARK_LAYER]) {
    if (map.getLayer(id)) map.setFilter(id, filter);
  }
}
