import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";

import { TIER_ACCENT_VAR, type Tier } from "@/lib/ocd/tiers";
import type { DistrictType } from "@/lib/state/types";

/**
 * District overlays.
 *
 * Boundaries and identifiers only. There is no officeholder or candidate data
 * in this repository, and CLAUDE.md forbids rendering a person or a position
 * without a source record — so a district here is a shape, an OCD-ID, and a
 * label, and nothing else.
 *
 * Geometry is built by `pnpm districts:fetch`. Everything below Congress is
 * clipped to Pima AZ, Morris NJ and Merrimack NH; congressional stays national.
 */

/**
 * The four properties `pnpm districts:fetch` writes, and nothing else.
 *
 * Declared here rather than pulled from a GeoJSON typings package: this is the
 * exact contract between the build script and the map, and stating it makes a
 * mismatch a type error instead of an undefined at runtime.
 */
export interface DistrictFeature {
  type: "Feature";
  properties: { ocdId: string; state: string; district: string; label: string };
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
  /** Files under public/geo, merged into one source. */
  files: string[];
  tier: Tier;
  label: string;
  /**
   * Layers with no data yet. The control still renders and the layer is still
   * defined — an empty slot you can see beats a missing one you cannot.
   */
  empty?: boolean;
}

export const DISTRICT_LAYERS: Readonly<Record<DistrictType, LayerSpec>> = {
  congressional: {
    files: ["cd119.geojson"],
    tier: "national",
    label: "Congressional",
  },
  "state-senate": {
    files: ["sldu-04.geojson", "sldu-34.geojson", "sldu-33.geojson"],
    tier: "state",
    label: "State Senate",
  },
  "state-house": {
    files: ["sldl-04.geojson", "sldl-34.geojson", "sldl-33.geojson"],
    tier: "state",
    label: "State House",
  },
  county: {
    files: ["county-us.geojson"],
    tier: "local",
    label: "County",
  },
  school: {
    files: [
      "unsd-04.geojson",
      "unsd-34.geojson",
      "unsd-33.geojson",
      "elsd-04.geojson",
      "elsd-34.geojson",
      "elsd-33.geojson",
      "scsd-04.geojson",
      "scsd-34.geojson",
      "scsd-33.geojson",
    ],
    tier: "local",
    label: "School",
  },
  municipal: {
    files: ["place-04.geojson", "place-34.geojson", "place-33.geojson"],
    tier: "local",
    label: "Municipal",
  },
};

export const DISTRICT_TYPES = Object.keys(DISTRICT_LAYERS) as DistrictType[];

const sourceId = (type: DistrictType) => `district-${type}`;
export const fillLayerId = (type: DistrictType) => `district-${type}-fill`;
export const lineLayerId = (type: DistrictType) => `district-${type}-line`;
export const labelLayerId = (type: DistrictType) => `district-${type}-label`;

/** Every fill layer, for hit-testing a click. */
export const allFillLayerIds = () => DISTRICT_TYPES.map(fillLayerId);

/** Below this the view is too wide for identifiers to be anything but noise. */
const LABEL_MIN_ZOOM = 7;
const LABEL_FONT = ["Noto Sans Regular"];

/**
 * Read a design token off the document.
 *
 * MapLibre paint properties are evaluated outside CSS and cannot take a
 * `var()`. Resolving at layer-build time is enough: a theme change swaps the
 * basemap style, which discards these layers, and re-adding them re-reads the
 * tokens.
 */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/* ------------------------------------------------------------- loading --- */

const cache = new Map<DistrictType, Promise<DistrictCollection>>();

/**
 * Fetch and merge a type's files.
 *
 * Fetched here rather than handed to MapLibre as a URL so a failure is a
 * rejected promise the caller can act on — showing a notice and disabling the
 * control — instead of a silently empty layer. docs/state.md §4 has the story
 * about why a map that quietly renders nothing is expensive.
 *
 * A single missing file does not fail the type: school coverage differs by
 * state (New Hampshire runs unified districts only), so an absent file is
 * usually the correct answer rather than an error.
 */
export function loadDistricts(
  type: DistrictType,
): Promise<DistrictCollection> {
  const existing = cache.get(type);
  if (existing) return existing;

  const spec = DISTRICT_LAYERS[type];

  const promise = Promise.all(
    spec.files.map(async (file) => {
      const response = await fetch(`/geo/${file}`);
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`/geo/${file} returned ${response.status}`);
      const collection = (await response.json()) as DistrictCollection;
      return collection.features ?? [];
    }),
  )
    .then((groups) => ({
      type: "FeatureCollection" as const,
      features: groups.flat(),
    }))
    .catch((error) => {
      // Let the next attempt retry rather than caching the failure forever.
      cache.delete(type);
      throw error;
    });

  cache.set(type, promise);
  return promise;
}

/* ------------------------------------------------------------ rendering --- */

/**
 * The first symbol layer in the current style.
 *
 * District layers are inserted before it so basemap place names keep drawing on
 * top of the boundaries.
 */
function firstSymbolLayerId(map: MapLibreMap): string | undefined {
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

export function addDistrictLayer(
  map: MapLibreMap,
  type: DistrictType,
  data: DistrictCollection,
): void {
  const spec = DISTRICT_LAYERS[type];
  const source = sourceId(type);

  // Colour by tier, not by type. The dash pattern is the shared signature of
  // "this is a district"; hue says which tier it belongs to.
  const accent = token(TIER_ACCENT_VAR[spec.tier], "#5f7a8a");
  const halo = token("--bg", "#0f1117");

  if (!map.getSource(source)) {
    // `promoteId` is what makes feature-state work: selection is expressed as
    // state on a feature rather than by mutating the source, so selecting a
    // district never re-tiles the geometry.
    map.addSource(source, { type: "geojson", data, promoteId: "ocdId" });
  }

  const before = firstSymbolLayerId(map);

  /*
   * Each layer is added only if absent, rather than gating all three on one of
   * them. A single "is it already there" check on the line layer left a real
   * half-built state reachable: an invalid paint expression made addLayer throw
   * for the line, the fill stayed, and every later pass tried to add the fill
   * again and logged "already exists" forever. Per-layer guards make this
   * idempotent whatever else fails.
   */
  const addIfAbsent = (
    id: string,
    build: () => Parameters<MapLibreMap["addLayer"]>[0],
  ) => {
    if (map.getLayer(id)) return;
    map.addLayer(build(), before);
  };

  // A transparent fill under the line. A line has almost no hit area, so
  // without this a district is effectively unclickable.
  addIfAbsent(fillLayerId(type), () => ({
      id: fillLayerId(type),
      type: "fill",
      source,
      paint: {
        "fill-color": accent,
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          0.18,
          ["boolean", ["feature-state", "hover"], false],
          0.08,
          0,
        ],
      },
    }));

  addIfAbsent(lineLayerId(type), () => ({
      id: lineLayerId(type),
      type: "line",
      source,
      layout: { "line-join": "round", "line-cap": "butt" },
      paint: {
        "line-color": accent,
        "line-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          1,
          0.7,
        ],
        // Dash units are multiples of line width, so the pattern scales with
        // the stroke and stays dotted at both zoom extremes rather than turning
        // into a solid rule at one of them.
        "line-dasharray": [2, 2],
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
          ["case", ["boolean", ["feature-state", "selected"], false], 2.0, 0.8],
          12,
          ["case", ["boolean", ["feature-state", "selected"], false], 3.2, 1.5],
        ],
      },
    }));

  addIfAbsent(labelLayerId(type), () => ({
      id: labelLayerId(type),
      type: "symbol",
      source,
      minzoom: LABEL_MIN_ZOOM,
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
        "text-halo-width": 1.2,
      },
    }));
}

export function removeDistrictLayer(map: MapLibreMap, type: DistrictType): void {
  for (const id of [labelLayerId(type), lineLayerId(type), fillLayerId(type)]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(sourceId(type))) map.removeSource(sourceId(type));
}

export function removeDistrictLayers(map: MapLibreMap): void {
  for (const type of DISTRICT_TYPES) removeDistrictLayer(map, type);
}

/* ------------------------------------------------------------ selection --- */

let selected: { type: DistrictType; ocdId: string } | null = null;

/**
 * Mark one district selected.
 *
 * Via feature-state, never by mutating the source — the whole point of
 * `promoteId` above.
 */
export function setSelectedDistrict(
  map: MapLibreMap,
  type: DistrictType | null,
  ocdId: string | null,
): void {
  if (selected) {
    const source = sourceId(selected.type);
    if (map.getSource(source)) {
      map.setFeatureState({ source, id: selected.ocdId }, { selected: false });
    }
    selected = null;
  }

  if (!type || !ocdId) return;

  const source = sourceId(type);
  if (!map.getSource(source)) return;

  map.setFeatureState({ source, id: ocdId }, { selected: true });
  selected = { type, ocdId };
}

export interface DistrictHit {
  type: DistrictType;
  tier: Tier;
  typeLabel: string;
  ocdId: string;
  label: string;
  state: string;
}

/**
 * Every district containing a click.
 *
 * **A point returns a set, not one district**, and callers must handle that.
 * Tucson is in a congressional district, a state senate district, a state house
 * district, a county, a place and a school district at once. Rockaway 07866 is
 * in a K-8 elementary district *and* a regional high school district
 * simultaneously — two features from the same layer.
 */
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
      tier: DISTRICT_LAYERS[type].tier,
      typeLabel: DISTRICT_LAYERS[type].label,
      ocdId,
      label: String(feature.properties?.label ?? ocdId),
      state: String(feature.properties?.state ?? ""),
    });
  }

  return hits;
}
