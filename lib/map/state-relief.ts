import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { StateOutlineFeature } from "./state-focus.ts";
import type { RaisedStateCandidate } from "../review/contract.ts";

export const RELIEF_SOURCE = "state-relief";
export const RELIEF_EDGES = "state-relief-edges";
export const RELIEF_LAYERS = ["state-relief-shadow", "state-relief-shadow-soft", "state-relief-surface", "state-relief-light", "state-relief-dark"] as const;

/** Review framing is computed from the same canonical vertices as the paint. */
export function canonicalStateBounds(outline: StateOutlineFeature): [[number, number], [number, number]] {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const ring of outline.geometry.coordinates) for (const [lng, lat] of ring) {
    west = Math.min(west, lng); south = Math.min(south, lat);
    east = Math.max(east, lng); north = Math.max(north, lat);
  }
  return [[west, south], [east, north]];
}

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

/** Staging comparison only. All three use the same exact canonical sources;
 * only screen-space light, soft shadow and separation change. */
export const RELIEF_CANDIDATES = {
  A_SOFT_LIFT: { offset: [1, 2], shadowWidth: 9, shadowBlur: 8, edgeScale: 0.55, edgeBlur: 1.1,
    dark: { surface: 0.035, light: 0.22, shade: 0.24, shadow: 0.055 }, light: { surface: 0.025, light: 0.48, shade: 0.18, shadow: 0.045 } },
  B_MATERIAL_LIFT: { offset: [2, 3.5], shadowWidth: 14, shadowBlur: 13, edgeScale: 0.75, edgeBlur: 1.25,
    dark: { surface: 0.055, light: 0.3, shade: 0.32, shadow: 0.095 }, light: { surface: 0.045, light: 0.65, shade: 0.25, shadow: 0.075 } },
  C_DEEP_LIFT: { offset: [3, 5], shadowWidth: 19, shadowBlur: 18, edgeScale: 0.95, edgeBlur: 1.4,
    dark: { surface: 0.075, light: 0.38, shade: 0.4, shadow: 0.145 }, light: { surface: 0.065, light: 0.8, shade: 0.32, shadow: 0.105 } },
} as const satisfies Record<RaisedStateCandidate, unknown>;

type ReliefSnapshot = {
  outline: StateOutlineFeature;
  source: GeoJSONSource;
  edgeSource: GeoJSONSource;
  theme: "light" | "dark";
  candidate: RaisedStateCandidate | undefined;
};
const appliedRelief = new WeakMap<MapLibreMap, ReliefSnapshot>();

export function removeStateRelief(map: MapLibreMap): void {
  for (const id of [...RELIEF_LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [RELIEF_EDGES, RELIEF_SOURCE]) if (map.getSource(id)) map.removeSource(id);
  appliedRelief.delete(map);
}

/** Flat MapLibre paints. No extrusion or independently maintained geometry. */
export function stateReliefLayers(theme: "light" | "dark", candidate?: RaisedStateCandidate): Parameters<MapLibreMap["addLayer"]>[0][] {
  const tone = RELIEF_THEME[theme];
  const lift = candidate ? RELIEF_CANDIDATES[candidate] : undefined;
  const opacity = lift?.[theme];
  const edgeScale = lift?.edgeScale ?? 1;
  const width: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 3, 1.1 * edgeScale, 7, 2.3 * edgeScale, 12, 3.2 * edgeScale];
  const offset: [number, number] = lift ? [...lift.offset] : [4, 6];
  return [
    { id: RELIEF_LAYERS[0], type: "fill", source: RELIEF_SOURCE, paint: { "fill-color": tone.shade, "fill-opacity": opacity?.shadow ?? tone.shadow, "fill-translate": offset, "fill-translate-anchor": "viewport" } },
    { id: RELIEF_LAYERS[1], type: "line", source: RELIEF_SOURCE, paint: { "line-color": tone.shade, "line-opacity": opacity?.shadow ?? tone.shadow, "line-width": lift?.shadowWidth ?? 14, "line-blur": lift?.shadowBlur ?? 12, "line-translate": offset, "line-translate-anchor": "viewport" } },
    { id: RELIEF_LAYERS[2], type: "fill", source: RELIEF_SOURCE, paint: { "fill-color": tone.surface, "fill-opacity": opacity?.surface ?? tone.surfaceOpacity } },
    { id: RELIEF_LAYERS[3], type: "line", source: RELIEF_EDGES, filter: ["==", ["get", "light"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": tone.light, "line-opacity": opacity?.light ?? tone.lightOpacity, "line-width": [...width], "line-blur": lift?.edgeBlur ?? 0.7 } },
    { id: RELIEF_LAYERS[4], type: "line", source: RELIEF_EDGES, filter: ["==", ["get", "light"], false], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": tone.shade, "line-opacity": opacity?.shade ?? tone.shadeOpacity, "line-width": [...width], "line-blur": lift?.edgeBlur ?? 0.8 } },
  ];
}

export function ensureStateRelief(map: MapLibreMap, outline: StateOutlineFeature | null, theme: "light" | "dark", candidate?: RaisedStateCandidate): void {
  if (!outline) { removeStateRelief(map); return; }
  if (!map.getStyle()?.layers?.length) return;
  const previous = appliedRelief.get(map);
  const source = map.getSource(RELIEF_SOURCE) as GeoJSONSource | undefined;
  const edgeSource = map.getSource(RELIEF_EDGES) as GeoJSONSource | undefined;
  const sameGeometry = previous?.outline === outline;
  // Reapplying a theme/candidate or settling a gesture must not resend identical
  // GeoJSON to a worker, leaving the retained presentation pending on setData.
  if (source) {
    if (!sameGeometry || previous?.source !== source) source.setData(outline);
  } else map.addSource(RELIEF_SOURCE, { type: "geojson", data: outline, tolerance: 0 });
  if (edgeSource) {
    if (!sameGeometry || previous?.edgeSource !== edgeSource) edgeSource.setData(directionalStateEdges(outline));
  } else map.addSource(RELIEF_EDGES, { type: "geojson", data: directionalStateEdges(outline), tolerance: 0 });
  if (sameGeometry && source === previous?.source && edgeSource === previous?.edgeSource &&
    previous?.theme === theme && previous?.candidate === candidate && RELIEF_LAYERS.every(id => map.getLayer(id))) return;
  const before = map.getStyle().layers.find(layer => layer.id.startsWith("district-") || layer.type === "symbol")?.id;
  for (const layer of stateReliefLayers(theme, candidate)) {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
    else if ("paint" in layer) for (const [property, value] of Object.entries(layer.paint ?? {})) map.setPaintProperty(layer.id, property as Parameters<MapLibreMap["setPaintProperty"]>[1], value);
  }
  appliedRelief.set(map, { outline, theme, candidate, source: map.getSource(RELIEF_SOURCE) as GeoJSONSource, edgeSource: map.getSource(RELIEF_EDGES) as GeoJSONSource });
}
