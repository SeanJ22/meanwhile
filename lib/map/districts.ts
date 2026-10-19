import { filterStateAbbr, stateFilter } from "./state-focus.ts";
import { mapPresentationHeld } from "./flight-presentation.ts";
import type { Map as MapLibreMap, MapGeoJSONFeature, FilterSpecification, StyleSpecification, LayerSpecification, VectorSourceSpecification } from "maplibre-gl";

// Relative, extension-bearing imports: node --test cannot resolve the `@/` alias.
import { DISTRICT_TYPE_TIER } from "../ocd/district-tiers.ts";
import { TIER_ACCENT_VAR, type Tier } from "../ocd/tiers.ts";
import type { DistrictType } from "../state/types.ts";

export interface DistrictFeature {
  type: "Feature";
  properties: {
    ocdId: string;
    state: string;
    district: string;
    label: string;
    /** Census functional status, on place and county-subdivision features. */
    funcstat?: string;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
}

export interface DistrictCollection {
  type: "FeatureCollection";
  features: DistrictFeature[];
}

/** Where each overlay's geometry lives, and which tier it belongs to. */
interface LayerSpec {
  /** Census layers represented by this boundary kind, independent of state coverage. */
  censusLayers: readonly string[];

  governingOnly?: boolean;
  label: string;

  dash: number[];
  /** Stroke weight relative to the base ramp: the containing shape is heaviest. */
  weight: number;
  /** Zoom at which this type's labels appear; nested types come in later than their containers. */
  labelMinZoom: number;

  empty?: boolean;
}

export const DISTRICT_LAYERS: Readonly<Record<DistrictType, LayerSpec>> = {
  congressional: {
    censusLayers: ["cd119"],
    label: "Congressional",
    dash: [8, 3],
    weight: 1.3,
    labelMinZoom: 5,
  },
  "state-senate": {
    censusLayers: ["sldu"],
    label: "State Senate",
    dash: [5, 2],
    weight: 1.1,
    labelMinZoom: 7,
  },
  "state-house": {
    censusLayers: ["sldl"],
    label: "State House",
    dash: [2, 2],
    weight: 0.9,
    labelMinZoom: 8,
  },
  county: {
    censusLayers: ["county"],
    label: "County",
    // The widest Local shape keeps a strong stroke. Its long dash + two dots
    // reads apart from Congress's long dashes even in the monochrome key.
    dash: [7, 2, 1, 2, 1, 2],
    weight: 1.25,
    labelMinZoom: 6,
  },
  municipal: {
    censusLayers: ["place","cousub"],
    // Both halves of the municipal picture: places, and the county
    // subdivisions that are the municipalities in some states. FUNCSTAT
    // (governingOnly) stops double-drawing and keeps statistical CCDs off.
    label: "Municipal",
    dash: [3, 2],
    weight: 1.0,
    labelMinZoom: 8,
    governingOnly: true,
  },

  "school-unified": {
    censusLayers: ["unsd"],
    label: "School (unified)",
    // Paired short dashes distinguish this from State House even without hue.
    dash: [2, 1, 2, 4],
    weight: 0.9,
    labelMinZoom: 10,
  },
  "school-elementary": {
    censusLayers: ["elsd"],
    label: "School (elementary)",
    dash: [1, 2],
    weight: 0.75,
    labelMinZoom: 10,
  },
  "school-secondary": {
    censusLayers: ["scsd"],
    label: "School (secondary)",
    dash: [6, 2, 1, 2],
    weight: 0.75,
    labelMinZoom: 10,
  },
};

/** The school types, derived from the registry so a new one is never missed. */
export const SCHOOL_DISTRICT_TYPES = (
  Object.keys(DISTRICT_LAYERS) as DistrictType[]
).filter((t) => t.startsWith("school-"));

export const DISTRICT_TYPES = Object.keys(DISTRICT_LAYERS) as DistrictType[];

// A modest contrast increase in both themes; keep the existing tier colors.
export const DISTRICT_LINE_OPACITY = 0.82;

export const NATIONAL_BOUNDARIES_SOURCE = "national-boundaries";
/** Keep already drawing boundaries while a remote basemap arrives or changes. */
export function preserveDistrictStyle(previous: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  const source = previous?.sources[NATIONAL_BOUNDARIES_SOURCE];
  if (!source) return next;
  // Rebuild, never copy: paint is baked from theme tokens, so a copied layer
  // keeps the previous theme's halo and accent.
  const types = new Set<DistrictType>();
  for (const layer of previous.layers) {
    const m = /^district-(.+)-(?:fill|line|label)$/.exec(layer.id);
    if (m && m[1] in DISTRICT_LAYERS) types.add(m[1] as DistrictType);
  }
  const boundaries = [...types]
    .flatMap(type => {
      const layer = previous.layers.find(value => value.id === lineLayerId(type));
      return districtStyleLayers(type, filterStateAbbr(layer && "filter" in layer ? layer.filter : undefined));
    })
    .filter(layer => layer.type !== "symbol" || next.glyphs);
  const layers = next.layers.filter(layer => !layer.id.startsWith("district-"));
  const labels = layers.findIndex(layer => layer.type === "symbol");
  layers.splice(labels < 0 ? layers.length : labels, 0, ...boundaries);
  return { ...next, sources: { ...next.sources, [NATIONAL_BOUNDARIES_SOURCE]: source }, layers };
}
const sourceId = (_type: DistrictType) => NATIONAL_BOUNDARIES_SOURCE;
export const BOUNDARY_ARCHIVE_FALLBACK = "/api/boundaries/census-2025-b24d0345381f69be.pmtiles";
export const BOUNDARY_ARCHIVE_URL = process.env.NEXT_PUBLIC_BOUNDARY_PMTILES_URL || BOUNDARY_ARCHIVE_FALLBACK;
export function boundarySource(archive = BOUNDARY_ARCHIVE_URL): VectorSourceSpecification {
  return { type: "vector", url: `pmtiles://${new URL(archive, typeof window === "undefined" ? "http://localhost" : window.location.href).href}`, promoteId: "ocdId" };
}

/** Start fetching visible boundaries as soon as MapLibre constructs its style. */
export function withDistricts(style: StyleSpecification, types: readonly DistrictType[], state: string | null): StyleSpecification {
  if (!types.length) return style;
  return {
    ...style,
    sources: { ...style.sources, [NATIONAL_BOUNDARIES_SOURCE]: boundarySource() },
    layers: [...style.layers, ...types.flatMap(type => districtStyleLayers(type, state)).filter(layer => layer.type !== "symbol" || style.glyphs)],
  };
}
export const fillLayerId = (type: DistrictType) => `district-${type}-fill`;
export const lineLayerId = (type: DistrictType) => `district-${type}-line`;
export const labelLayerId = (type: DistrictType) => `district-${type}-label`;

/** Every fill layer, for hit-testing a click. */
export const allFillLayerIds = () => DISTRICT_TYPES.map(fillLayerId);

const LABEL_FONT = ["Noto Sans Regular"];

function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/* ------------------------------------------------------------- loading --- */

export const GOVERNING_FUNCSTAT = new Set(["A", "B", "C", "G"]);

export function keepFeature(
  spec: { governingOnly?: boolean },
  feature: DistrictFeature,
): boolean {
  if (!spec.governingOnly) return true;
  const funcstat = feature.properties.funcstat;
  // A feature without the property predates the FUNCSTAT join or belongs to
  // a layer that never carries it; keeping it is the non-destructive default.
  if (!funcstat) return true;
  return GOVERNING_FUNCSTAT.has(funcstat);
}

/* ------------------------------------------------------------ rendering --- */

export function firstSymbolLayerId(map: MapLibreMap): string | undefined {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type === "symbol" && !layer.id.startsWith("district-")) {
      return layer.id;
    }
  }
  return undefined;
}

export function districtLayerPresent(map: MapLibreMap, type: DistrictType) {
  return Boolean(map.getLayer(lineLayerId(type)));
}

/** Whether any district layer is on the map. */
export function districtLayersPresent(map: MapLibreMap) {
  return DISTRICT_TYPES.some((type) => districtLayerPresent(map, type));
}

function districtStyleLayers(type: DistrictType, state: string | null): LayerSpecification[] {
  const spec = DISTRICT_LAYERS[type];
  const source = sourceId(type);
  const boundaryFilter: FilterSpecification = spec.governingOnly
    ? ["all", ["==", ["get", "boundaryType"], type], ["in", ["coalesce", ["get", "funcstat"], "A"], ["literal", [...GOVERNING_FUNCSTAT]]]]
    : ["==", ["get", "boundaryType"], type];

  const filter = ["all", boundaryFilter, stateFilter(state)] as FilterSpecification;

  // Hue says tier; dash pattern and weight distinguish jurisdiction types.
  const accent = token(TIER_ACCENT_VAR[DISTRICT_TYPE_TIER[type]], "#5f7a8a");
  const halo = token("--bg", "#0f1117");

  // A transparent fill under the line. A line has almost no hit area, so
  // without this a district is effectively unclickable.
  return [{
      id: fillLayerId(type),
      type: "fill",
      source,
      "source-layer": "districts",
      filter,
      paint: {
        "fill-color": accent,
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          0.18,
          // The reader's narrowed divisions: shaded, quieter than a selection.
          ["boolean", ["feature-state", "narrowed"], false],
          0.12,
          ["boolean", ["feature-state", "hover"], false],
          0.08,
          0,
        ],
      },
    }, {
      id: lineLayerId(type),
      type: "line",
      source,
      "source-layer": "districts",
      filter,
      layout: { "line-join": "round", "line-cap": "butt" },
      paint: {
        "line-color": accent,
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          1,
          DISTRICT_LINE_OPACITY,
        ],
        // Dash units are multiples of line width, so the pattern scales with
        // the stroke and stays dotted at both zoom extremes rather than turning
        // into a solid rule at one of them.
        "line-dasharray": spec.dash,
        // `zoom` is only legal as the direct input of a top-level `step` or
        // `interpolate`, so the selection test goes in the stop *outputs*
        // rather than wrapping the interpolate in a `case`. The wrapped form
        // parses as a style error, MapLibre rejects the whole layer, and the
        // boundary silently loses its width.
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            2.0 * spec.weight,
            0.9 * spec.weight,
          ],
          12,
          [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            3.2 * spec.weight,
            1.65 * spec.weight,
          ],
        ],
      },
    }, {
      id: labelLayerId(type),
      type: "symbol",
      source,
      "source-layer": "districts",
      filter,
      minzoom: spec.labelMinZoom,
      layout: {
        "text-field": ["get", "label"],
        "text-font": LABEL_FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 7, 10, 12, 13],
        "text-allow-overlap": false,
        "text-padding": 4,
      },
      paint: {
        "text-color": accent,
        "text-halo-color": halo,
        "text-halo-width": 1.5,
        "text-halo-blur": 0.5,
      },
    }];
}

export function addDistrictLayer(map: MapLibreMap, type: DistrictType, state: string | null): void {
  if (!map.getSource(NATIONAL_BOUNDARIES_SOURCE)) map.addSource(NATIONAL_BOUNDARIES_SOURCE, boundarySource());
  const before = firstSymbolLayerId(map);
  // Repair partially attached layers without duplicating the surviving ones.
  for (const layer of districtStyleLayers(type, state)) {
    if (layer.type === "symbol" && !map.getStyle()?.glyphs) continue;
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
  }
}

export function setDistrictState(map: MapLibreMap, state: string | null): void {
  for (const type of DISTRICT_TYPES) {
    for (const layer of districtStyleLayers(type, state)) {
      if (map.getLayer(layer.id) && "filter" in layer && JSON.stringify(map.getFilter(layer.id)) !== JSON.stringify(layer.filter)) {
        map.setFilter(layer.id, layer.filter);
      }
    }
  }
}

export function removeDistrictLayer(map: MapLibreMap, type: DistrictType): void {
  for (const id of [labelLayerId(type), lineLayerId(type), fillLayerId(type)]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (!districtLayersPresent(map) && map.getSource(NATIONAL_BOUNDARIES_SOURCE)) map.removeSource(NATIONAL_BOUNDARIES_SOURCE);
}

export function removeDistrictLayers(map: MapLibreMap): void {
  for (const type of DISTRICT_TYPES) removeDistrictLayer(map, type);
}

/* ------------------------------------------------------------ selection --- */

let selected: { type: DistrictType; ocdId: string } | null = null;

export function setSelectedDistrict(
  map: MapLibreMap,
  type: DistrictType | null,
  ocdId: string | null,
): void {
  if (selected) {
    const source = sourceId(selected.type);
    if (map.getSource(source)) {
      map.setFeatureState({ source, sourceLayer: "districts", id: selected.ocdId }, { selected: false });
    }
    selected = null;
  }

  if (!type || !ocdId) return;

  const source = sourceId(type);
  if (!map.getSource(source)) return;

  map.setFeatureState({ source, sourceLayer: "districts", id: ocdId }, { selected: true });
  selected = { type, ocdId };
}

let narrowedApplied: { type: DistrictType; ocdId: string }[] = [];

export function setNarrowedDistricts(
  map: MapLibreMap,
  entries: { type: DistrictType; ocdId: string }[],
): void {
  for (const prev of narrowedApplied) {
    const source = sourceId(prev.type);
    if (map.getSource(source)) {
      map.setFeatureState({ source, sourceLayer: "districts", id: prev.ocdId }, { narrowed: false });
    }
  }
  narrowedApplied = [];

  for (const entry of entries) {
    const source = sourceId(entry.type);
    if (!map.getSource(source)) continue;
    map.setFeatureState({ source, sourceLayer: "districts", id: entry.ocdId }, { narrowed: true });
    narrowedApplied.push(entry);
  }
}

export interface DistrictHit {
  type: DistrictType;
  tier: Tier;
  typeLabel: string;
  ocdId: string;
  label: string;
  state: string;
}

/** One district currently drawn on screen: the stats card's unit. */
export interface DrawnDistrict {
  type: DistrictType;
  tier: Tier;
  typeLabel: string;
  ocdId: string;
  label: string;
}

export function districtsAreVisible(
  drawnCount: number | null,
  switchOn: boolean,
): boolean {
  if (drawnCount !== null && drawnCount > 0) return true;
  return switchOn;
}

export function districtsSwitchedOffAndEmpty(
  drawnCount: number | null,
  switchOn: boolean,
): boolean {
  return !switchOn && (drawnCount === null || drawnCount === 0);
}

export function drawnDistrictsOn(
  map: MapLibreMap,
  activeTypes: readonly DistrictType[],
): DrawnDistrict[] {
  const layers = activeTypes
    .map(lineLayerId)
    .filter((id) => Boolean(map.getLayer(id)));
  if (layers.length === 0) return [];

  let features: MapGeoJSONFeature[];
  try {
    features = map.queryRenderedFeatures({ layers }) as MapGeoJSONFeature[];
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const drawn: DrawnDistrict[] = [];
  for (const feature of features) {
    const type = DISTRICT_TYPES.find(
      (t) => lineLayerId(t) === feature.layer.id,
    );
    if (!type) continue;
    const ocdId = String(feature.properties?.ocdId ?? "");
    if (!ocdId || seen.has(ocdId)) continue;
    seen.add(ocdId);
    drawn.push({
      type,
      tier: DISTRICT_TYPE_TIER[type],
      typeLabel: DISTRICT_LAYERS[type].label,
      ocdId,
      label: String(feature.properties?.label ?? ocdId),
    });
  }
  return drawn;
}

export function districtsAt(
  map: MapLibreMap,
  point: { x: number; y: number },
  activeTypes: readonly DistrictType[],
): DistrictHit[] {
  const layers = activeTypes
    .map(fillLayerId)
    .filter((id) => Boolean(map.getLayer(id)));

  if (layers.length === 0) return [];

  // A few pixels of slop, so a click near a boundary is not a miss.
  const box: [[number, number], [number, number]] = [
    [point.x - 3, point.y - 3],
    [point.x + 3, point.y + 3],
  ];

  const features = map.queryRenderedFeatures(box, { layers });
  const seen = new Set<string>();
  const hits: DistrictHit[] = [];

  for (const feature of features as MapGeoJSONFeature[]) {
    const type = DISTRICT_TYPES.find(
      (t) => fillLayerId(t) === feature.layer.id,
    );
    if (!type) continue;

    const ocdId = String(feature.properties?.ocdId ?? "");
    if (!ocdId || seen.has(ocdId)) continue;
    seen.add(ocdId);

    hits.push({
      type,
      tier: DISTRICT_TYPE_TIER[type],
      typeLabel: DISTRICT_LAYERS[type].label,
      ocdId,
      label: String(feature.properties?.label ?? ocdId),
      state: String(feature.properties?.state ?? ""),
    });
  }

  return hits;
}

export function boundsOfDistrict(
  map: MapLibreMap,
  type: DistrictType,
  ocdId: string,
): [[number, number], [number, number]] | null {
  const layers = [lineLayerId(type), fillLayerId(type)].filter((id) =>
    Boolean(map.getLayer(id)),
  );
  if (layers.length === 0) return null;

  let features: MapGeoJSONFeature[];
  try {
    features = map.queryRenderedFeatures({ layers }) as MapGeoJSONFeature[];
  } catch {
    return null;
  }

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let found = 0;

  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const [lng, lat] = coords as [number, number];
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      return;
    }
    for (const c of coords) walk(c);
  };

  for (const feature of features) {
    if (String(feature.id ?? "") !== ocdId) continue;
    const geometry = feature.geometry as { coordinates?: unknown } | undefined;
    if (!geometry?.coordinates) continue;
    found += 1;
    walk(geometry.coordinates);
  }

  // No matching feature is not an empty box: return null rather than Infinity or zero bounds.
  if (found === 0 || !Number.isFinite(west) || !Number.isFinite(north)) return null;

  return [
    [west, south],
    [east, north],
  ];
}

export async function fullBoundsOfDistrict(
  map: MapLibreMap,
  type: DistrictType,
  ocdId: string,
): Promise<[[number, number], [number, number]] | null> {
  const layers = [lineLayerId(type), fillLayerId(type)].filter(id => Boolean(map.getLayer(id)));
  if (!layers.length) return null;
  const feature = map.queryRenderedFeatures({layers}).find(f => String(f.properties?.ocdId) === ocdId);
  const p = feature?.properties;
  if (!p || ![p.west,p.south,p.east,p.north].every(Number.isFinite)) return null;
  return [[p.west,p.south],[p.east,p.north]];
}

/** Coalesce source-driven queries after the updated tiles have rendered.
 * No continuous move/zoom/render handler drives React or boundary queries. */
export function onSettledDistrictChange(map: MapLibreMap, run: () => void): () => void {
  let scheduled = false;
  let dirty = true;
  let disposed = false;

  const flush = () => {
    scheduled = false;
    if (disposed || !dirty) return;
    /* Still moving: drop this pass; `moveend` schedules another. */
    if (map.isMoving() || mapPresentationHeld(map)) return;
    dirty = false;
    run();
  };

  const schedule = () => {
    dirty = true;
    if (disposed || scheduled) return;
    scheduled = true;
    map.once("render", flush);
    map.triggerRepaint();
  };
  const onSourceData = (event: { sourceId?: string }) => {
    // Vector tile completions omit sourceDataType; "content" only describes
    // the source metadata/update. Count each rendered boundary batch, including
    // cached tiles becoming visible, while still ignoring all basemap traffic.
    if (event.sourceId === NATIONAL_BOUNDARIES_SOURCE) schedule();
  };

  schedule();
  map.on("sourcedata", onSourceData);
  // Idle can reveal held layers after software-rendered motion. A boundary
  // frame already reported above is clean and must not query/update twice.
  map.on("idle", flush);
  // A move that consumed no sourcedata still has to report: a camera arriving
  // somewhere new IS a change in which districts are drawn.
  map.on("moveend", schedule);

  return () => {
    disposed = true;
    map.off("render", flush);
    scheduled = false;
    map.off("sourcedata", onSourceData);
    map.off("idle", flush);
    map.off("moveend", schedule);
  };
}
