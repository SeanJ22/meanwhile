import type { LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { firstSymbolLayerId, NATIONAL_BOUNDARIES_SOURCE } from "./districts.ts";
import { STATE_OUTLINES_URL } from "./state-focus.ts";
import { addResultImages, isResultsLayer, RESULTS_BADGES_SOURCE, RESULTS_STATES_SOURCE, type ResultsTheme } from "./results-style.ts";

export function clearResultLayers(map: MapLibreMap): void {
  for (const layer of map.getStyle()?.layers ?? []) if (isResultsLayer(layer.id)) map.removeLayer(layer.id);
  for (const id of [RESULTS_STATES_SOURCE, RESULTS_BADGES_SOURCE]) if (map.getSource(id)) map.removeSource(id);
}

/** Whether the map can take these layers now: its style is up and the sources they draw on exist. */
export function canDrawResults(map: MapLibreMap, needsDistricts: boolean): boolean {
  return Boolean(map.getStyle()?.layers?.length) && (!needsDistricts || Boolean(map.getSource(NATIONAL_BOUNDARIES_SOURCE)));
}

/** Replace the results layers. They draw on the boundary source the map already holds, and on the state shapes it already loads. */
export function drawResultLayers(
  map: MapLibreMap, layers: readonly LayerSpecification[],
  options: { theme: ResultsTheme; states: boolean; badges: GeoJSON.FeatureCollection | null },
): void {
  clearResultLayers(map);
  addResultImages(map, options.theme);
  if (options.states) map.addSource(RESULTS_STATES_SOURCE, { type: "geojson", data: new URL(STATE_OUTLINES_URL, window.location.href).href, promoteId: "ocdId" });
  if (options.badges) map.addSource(RESULTS_BADGES_SOURCE, { type: "geojson", data: options.badges });
  const before = firstSymbolLayerId(map);
  for (const layer of layers) map.addLayer(layer, before);
}
