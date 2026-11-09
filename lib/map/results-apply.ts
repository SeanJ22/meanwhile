import type { LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { NATIONAL_BOUNDARIES_SOURCE } from "./districts.ts";
import type { LaidOutStates } from "./albers-usa.ts";
import { addResultImages, groundLayer, isResultsLayer, RESULTS_BADGES_SOURCE, RESULTS_DISTRICTS_SOURCE, RESULTS_STATES_SOURCE } from "./results-style.ts";

/** Remove the results layers. The state shapes are a large source the browser parses once: they stay unless the results close (`all`). */
export function clearResultLayers(map: MapLibreMap, all = false): void {
  for (const layer of map.getStyle()?.layers ?? []) if (isResultsLayer(layer.id)) map.removeLayer(layer.id);
  for (const id of all ? [RESULTS_STATES_SOURCE, RESULTS_DISTRICTS_SOURCE, RESULTS_BADGES_SOURCE] : [RESULTS_BADGES_SOURCE]) if (map.getSource(id)) map.removeSource(id);
}

/** Whether the map can take these layers now: its style is up and the sources they draw on exist. */
export function canDrawResults(map: MapLibreMap, needsDistricts: boolean): boolean {
  return Boolean(map.getStyle()?.layers?.length) && (!needsDistricts || Boolean(map.getSource(NATIONAL_BOUNDARIES_SOURCE)));
}

/**
 * Replace the results layers, on a flat near-black ground that covers the basemap. They draw on the boundary source the map
 * already holds, and on the states laid out for the national views (the lower 48 with Alaska and Hawaii inset).
 */
export function drawResultLayers(
  map: MapLibreMap, layers: readonly LayerSpecification[],
  options: { states: LaidOutStates["shapes"] | null; districts?: GeoJSON.FeatureCollection | null; badges: GeoJSON.FeatureCollection | null },
): void {
  clearResultLayers(map);
  addResultImages(map);
  if (options.states && !map.getSource(RESULTS_STATES_SOURCE)) map.addSource(RESULTS_STATES_SOURCE, { type: "geojson", data: options.states, promoteId: "ocdId" });
  if (options.districts && !map.getSource(RESULTS_DISTRICTS_SOURCE)) map.addSource(RESULTS_DISTRICTS_SOURCE, { type: "geojson", data: options.districts, promoteId: "ocdId" });
  if (options.badges) map.addSource(RESULTS_BADGES_SOURCE, { type: "geojson", data: options.badges });
  for (const layer of [groundLayer(), ...layers]) map.addLayer(layer);
}
