import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { StateOutlineFeature } from "./state-focus.ts";
import {
  RAISED_STATE_PRESENTATIONS,
  type RaisedStateVariant,
} from "./raised-state-variants.ts";

export const RELIEF_SOURCE = "state-relief";
export const RELIEF_EDGES = "state-relief-edges";
export const RELIEF_EDGE_SEAL_LAYER = "state-relief-edge-seal";
export const RELIEF_LAYERS = [
  "state-relief-shadow",
  "state-relief-shadow-soft",
  "state-relief-surface",
  RELIEF_EDGE_SEAL_LAYER,
  "state-relief-light",
  "state-relief-dark",
] as const;
const RELIEF_LOW_LAYER_COUNT = 3;

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

function firstSymbolLayerId(map: MapLibreMap): string | undefined {
  return map.getStyle()?.layers?.find((layer) => layer.type === "symbol")?.id;
}

/** Keep the canonical edge above district paint but below place labels. */
export function raiseStateReliefEdges(map: MapLibreMap): void {
  /* District types arrive independently. A type that resolves after the
     relief was first installed must still sit below the unsegmented state
     seal; otherwise its rounded Colorado River vertices can protrude. */
  if (map.getLayer(RELIEF_EDGE_SEAL_LAYER)) {
    for (const layer of map.getStyle()?.layers ?? []) {
      if (
        layer.id.startsWith("district-") &&
        (layer.id.endsWith("-fill") || layer.id.endsWith("-line"))
      ) {
        map.moveLayer(layer.id, RELIEF_EDGE_SEAL_LAYER);
      }
    }
  }
  const before = firstSymbolLayerId(map);
  for (const id of RELIEF_LAYERS.slice(RELIEF_LOW_LAYER_COUNT)) {
    if (map.getLayer(id)) map.moveLayer(id, before);
  }
}

export function ensureStateRelief(
  map: MapLibreMap,
  outline: StateOutlineFeature | null,
  theme: "light" | "dark",
  variant: RaisedStateVariant,
): void {
  if (!outline) { removeStateRelief(map); return; }
  if (!map.getStyle()?.layers?.length) return;
  const tone = RELIEF_THEME[theme];
  const presentation = RAISED_STATE_PRESENTATIONS[variant];
  const source = map.getSource(RELIEF_SOURCE) as GeoJSONSource | undefined;
  if (source) source.setData(outline);
  else map.addSource(RELIEF_SOURCE, { type: "geojson", data: outline, tolerance: 0 });
  const edges = directionalStateEdges(outline);
  const edgeSource = map.getSource(RELIEF_EDGES) as GeoJSONSource | undefined;
  if (edgeSource) edgeSource.setData(edges);
  else map.addSource(RELIEF_EDGES, { type: "geojson", data: edges, tolerance: 0 });
  const lowBefore = map.getStyle().layers.find(layer => layer.id.startsWith("district-") || layer.type === "symbol")?.id;
  const edgeBefore = firstSymbolLayerId(map);
  const width: ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,
    1.1 * presentation.edgeWidthScale,
    7,
    2.3 * presentation.edgeWidthScale,
    12,
    3.2 * presentation.edgeWidthScale,
  ];
  const offset = presentation.shadowOffsetPx;
  const layers: Parameters<MapLibreMap["addLayer"]>[0][] = [
    /* The same canonical polygon casts both opposed shadows. These are lines,
       not translated fills: the map inside the state remains the map, which
       removes the grey slab seen in the rejected pass. */
    { id: RELIEF_LAYERS[0], type: "line", source: RELIEF_SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": tone.shade, "line-opacity": tone.shadow * presentation.darkShadowScale, "line-width": presentation.shadowWidthPx, "line-blur": presentation.shadowBlurPx, "line-translate": [offset, offset], "line-translate-anchor": "viewport" } },
    { id: RELIEF_LAYERS[1], type: "line", source: RELIEF_SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": tone.light, "line-opacity": tone.shadow * presentation.lightShadowScale, "line-width": presentation.shadowWidthPx, "line-blur": presentation.shadowBlurPx, "line-translate": [-offset, -offset], "line-translate-anchor": "viewport" } },
    { id: RELIEF_LAYERS[2], type: "fill", source: RELIEF_SOURCE, paint: { "fill-color": tone.surface, "fill-opacity": tone.surfaceOpacity * presentation.surfaceScale } },
    /* The unsegmented canonical seal covers district strokes that otherwise
       protrude into the Colorado River because their source vertices are
       rounded differently. It changes no district or state coordinate. */
    { id: RELIEF_LAYERS[3], type: "line", source: RELIEF_SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": tone.surface, "line-opacity": 1, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3.5, 7, 5, 12, 6.5], "line-blur": 0 } },
    /* Directional edge strokes are last, sharp, and use the exact state
       coordinates. Round caps cover the joins between classified segments. */
    { id: RELIEF_LAYERS[4], type: "line", source: RELIEF_EDGES, filter: ["==", ["get", "light"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": tone.light, "line-opacity": tone.lightOpacity, "line-width": [...width], "line-blur": 0 } },
    { id: RELIEF_LAYERS[5], type: "line", source: RELIEF_EDGES, filter: ["==", ["get", "light"], false], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": tone.shade, "line-opacity": tone.shadeOpacity, "line-width": [...width], "line-blur": 0 } },
  ];
  for (const [index, layer] of layers.entries()) {
    const before = index < RELIEF_LOW_LAYER_COUNT ? lowBefore : edgeBefore;
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
    else {
      if ("paint" in layer) for (const [property, value] of Object.entries(layer.paint ?? {})) map.setPaintProperty(layer.id, property as Parameters<MapLibreMap["setPaintProperty"]>[1], value);
      map.moveLayer(layer.id, before);
    }
  }
}
