import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * The congressional district overlay.
 *
 * Boundaries only. There is no officeholder, candidate, or party data in this
 * repository, and CLAUDE.md forbids rendering a position or a person without a
 * source record behind it — so a district here is a shape and an identifier and
 * nothing else. Putting a representative's name on these lines would be
 * inference from no source, which is exactly the failure that rule exists to
 * catch.
 *
 * Geometry comes from public/geo/cd119.geojson, built by `pnpm districts:fetch`.
 */

export const DISTRICT_SOURCE_ID = "cd119";
export const DISTRICT_LINE_LAYER_ID = "cd119-line";
export const DISTRICT_LABEL_LAYER_ID = "cd119-label";

const DISTRICTS_URL = "/geo/cd119.geojson";

/**
 * Line and label colour.
 *
 * Chosen against docs/state.md §4.1: the basemap draws its roads as one flat
 * #454545 (luminance 0.059) and the meeting pins are #ffb000 (0.523). These sit
 * between the two — clearly above the roads so the boundary reads as a real
 * edge, clearly below the pins so nothing competes with a meeting, and in a
 * different hue so it reads as a different kind of thing rather than a brighter
 * road.
 */
const LINE_COLOR = "#5f7a8a";
/** The same hue, one step down, so a label never out-shouts its own boundary. */
const LABEL_COLOR = "#52697a";

/** Below this the continental view stays quiet; identifiers would be noise. */
const LABEL_MIN_ZOOM = 7;

/** Text needs glyphs. The raster basemap style does not define any of its own. */
const LABEL_FONT = ["Noto Sans Regular"];

let cached: Promise<unknown> | null = null;

/**
 * Fetch the boundary file once per page load.
 *
 * Fetched here rather than handed to MapLibre as a URL so that a failure is a
 * rejected promise the caller can act on — showing a notice and disabling the
 * toggle — instead of a silent empty layer. state.md §4 has the story about why
 * a basemap that quietly renders nothing is expensive.
 */
export function loadDistricts(): Promise<unknown> {
  if (!cached) {
    cached = fetch(DISTRICTS_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`${DISTRICTS_URL} returned ${response.status}`);
        }
        return response.json();
      })
      .catch((error) => {
        // Let the next attempt retry rather than caching the failure forever.
        cached = null;
        throw error;
      });
  }
  return cached;
}

/**
 * The first symbol layer in the current style.
 *
 * Both district layers are inserted before it so basemap place names keep
 * drawing on top of the boundaries. Returns undefined for a style with no
 * symbol layers of its own — the raster basemap is a single image layer — in
 * which case the district layers simply go on top, which is where they belong
 * anyway. Meeting markers are DOM elements above the canvas and are unaffected.
 */
function firstSymbolLayerId(map: MapLibreMap): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (layer.type === "symbol" && layer.id !== DISTRICT_LABEL_LAYER_ID) {
      return layer.id;
    }
  }
  return undefined;
}

export function districtLayersPresent(map: MapLibreMap): boolean {
  return Boolean(map.getLayer(DISTRICT_LINE_LAYER_ID));
}

export function addDistrictLayers(map: MapLibreMap, data: unknown): void {
  if (districtLayersPresent(map)) return;

  if (!map.getSource(DISTRICT_SOURCE_ID)) {
    map.addSource(DISTRICT_SOURCE_ID, {
      type: "geojson",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: data as any,
    });
  }

  const before = firstSymbolLayerId(map);

  map.addLayer(
    {
      id: DISTRICT_LINE_LAYER_ID,
      type: "line",
      source: DISTRICT_SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "butt" },
      paint: {
        "line-color": LINE_COLOR,
        "line-opacity": 0.7,
        // Dash units are multiples of line width, so the pattern scales with
        // the stroke and stays a dotted line at both zoom extremes rather than
        // turning into a solid rule at one of them.
        "line-dasharray": [2, 2],
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 12, 1.5],
      },
    },
    before,
  );

  map.addLayer(
    {
      id: DISTRICT_LABEL_LAYER_ID,
      type: "symbol",
      source: DISTRICT_SOURCE_ID,
      minzoom: LABEL_MIN_ZOOM,
      layout: {
        "text-field": ["get", "label"],
        "text-font": LABEL_FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 7, 10, 12, 13],
        "text-allow-overlap": false,
        "text-padding": 4,
      },
      paint: {
        "text-color": LABEL_COLOR,
        // A halo in the page ink keeps the identifier readable over land and
        // over water, where the basemap goes darker still.
        "text-halo-color": "#070f11",
        "text-halo-width": 1.2,
      },
    },
    before,
  );
}

export function removeDistrictLayers(map: MapLibreMap): void {
  for (const id of [DISTRICT_LABEL_LAYER_ID, DISTRICT_LINE_LAYER_ID]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(DISTRICT_SOURCE_ID)) map.removeSource(DISTRICT_SOURCE_ID);
}
