import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { StateOutlineFeature } from "./state-focus.ts";

export const RELIEF_SOURCE = "state-relief";
export const RELIEF_EDGES = "state-relief-edges";
export const RELIEF_LAYERS = ["state-relief-shadow", "state-relief-shadow-soft", "state-relief-surface", "state-relief-light", "state-relief-dark"] as const;

/** Every edge retains its two original coordinates; no second outline or simplification. */
type StateEdge = { type: "Feature"; properties: { light: boolean; ring: number }; geometry: { type: "LineString"; coordinates: number[][] } };
export function directionalStateEdges(outline: StateOutlineFeature): { type: "FeatureCollection"; features: StateEdge[] } {
  const features: StateEdge[] = [];
  for (const [ringIndex, ring] of outline.geometry.coordinates.entries()) {
    const projected = ring.map(([lng, lat]) => [lng * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360))]);
    let signedArea = 0;
    for (let i = 1; i < projected.length; i++) signedArea += projected[i - 1][0] * projected[i][1] - projected[i][0] * projected[i - 1][1];
    const outward = Math.sign(signedArea) * (ringIndex === 0 ? 1 : -1);
    const ringStart = features.length;
    for (let i = 1; i < ring.length; i++) {
      const dx = projected[i][0] - projected[i - 1][0];
      const dy = projected[i][1] - projected[i - 1][1];
      const light = outward * (-dy - dx) > 0;
      const segment = features.length > ringStart ? features[features.length - 1] : undefined;
      if (segment && segment.properties.light === light) segment.geometry.coordinates.push(ring[i]);
      else {
        features.push({ type: "Feature", properties: { light, ring: ringIndex }, geometry: { type: "LineString", coordinates: [ring[i - 1], ring[i]] } });
      }
    }
  }
  return { type: "FeatureCollection", features };
}

export const RELIEF_THEME = {
  dark: { surface: "#30333d", surfaceOpacity: 0.13, light: "#cad0dc", lightOpacity: 0.65, shade: "#060910", shadeOpacity: 0.8, shadow: 0.21 },
  light: { surface: "#e4e0e8", surfaceOpacity: 0.15, light: "#ffffff", lightOpacity: 0.95, shade: "#4d475c", shadeOpacity: 0.58, shadow: 0.13 },
} as const;

export function removeStateRelief(map: MapLibreMap): void {
  for (const id of [...RELIEF_LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [RELIEF_EDGES, RELIEF_SOURCE]) if (map.getSource(id)) map.removeSource(id);
}

export function ensureStateRelief(map: MapLibreMap, outline: StateOutlineFeature | null, theme: "light" | "dark"): void {
  if (!outline) { removeStateRelief(map); return; }
  if (!map.getStyle()?.layers?.length) return;
  const tone = RELIEF_THEME[theme];
  const source = map.getSource(RELIEF_SOURCE) as GeoJSONSource | undefined;
  if (source) source.setData(outline);
  else map.addSource(RELIEF_SOURCE, { type: "geojson", data: outline, tolerance: 0 });
  const edges = directionalStateEdges(outline);
  const edgeSource = map.getSource(RELIEF_EDGES) as GeoJSONSource | undefined;
  if (edgeSource) edgeSource.setData(edges);
  else map.addSource(RELIEF_EDGES, { type: "geojson", data: edges, tolerance: 0 });
  const before = map.getStyle().layers.find(layer => layer.id.startsWith("district-") || layer.type === "symbol")?.id;
  const width: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 3, 1.1, 7, 2.3, 12, 3.2];
  const layers: Parameters<MapLibreMap["addLayer"]>[0][] = [
    { id: RELIEF_LAYERS[0], type: "fill", source: RELIEF_SOURCE, paint: { "fill-color": tone.shade, "fill-opacity": tone.shadow, "fill-translate": [4, 6], "fill-translate-anchor": "viewport" } },
    { id: RELIEF_LAYERS[1], type: "line", source: RELIEF_SOURCE, paint: { "line-color": tone.shade, "line-opacity": tone.shadow, "line-width": 14, "line-blur": 12, "line-translate": [4, 6], "line-translate-anchor": "viewport" } },
    { id: RELIEF_LAYERS[2], type: "fill", source: RELIEF_SOURCE, paint: { "fill-color": tone.surface, "fill-opacity": tone.surfaceOpacity } },
    { id: RELIEF_LAYERS[3], type: "line", source: RELIEF_EDGES, filter: ["==", ["get", "light"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": tone.light, "line-opacity": tone.lightOpacity, "line-width": [...width], "line-blur": 0.7 } },
    { id: RELIEF_LAYERS[4], type: "line", source: RELIEF_EDGES, filter: ["==", ["get", "light"], false], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": tone.shade, "line-opacity": tone.shadeOpacity, "line-width": [...width], "line-blur": 0.8 } },
  ];
  for (const layer of layers) {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
    else if ("paint" in layer) for (const [property, value] of Object.entries(layer.paint ?? {})) map.setPaintProperty(layer.id, property as Parameters<MapLibreMap["setPaintProperty"]>[1], value);
  }
}
