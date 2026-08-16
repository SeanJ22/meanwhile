import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";

// Relative, extension-bearing imports — the style the rest of lib/ uses —
// because node --test cannot resolve the `@/` alias and this module is now
// exercised by tests/municipal-layer.test.ts (the §4.2 lesson again).
import { TIER_ACCENT_VAR, type Tier } from "../ocd/tiers.ts";
import type { DistrictType } from "../state/types.ts";

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
 * The properties the map reads, out of what `pnpm districts:fetch` writes.
 *
 * Declared here rather than pulled from a GeoJSON typings package: this is the
 * exact contract between the build script and the map, and stating it makes a
 * mismatch a type error instead of an undefined at runtime. The build script
 * also writes `lsad`, `classfp` and `geoid` on the layers that carry them;
 * the map does not read those and they are deliberately not typed here.
 */
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
  /** Files under public/geo, merged into one source. */
  files: string[];
  /**
   * Draw only features whose FUNCSTAT says a government sits there — M14.
   *
   * The municipal type merges the place and county-subdivision layers, and
   * the same government can appear in both: Census marks the row it created
   * purely to fill its hierarchy `F` (fictitious), so filtering on FUNCSTAT
   * dedupes exactly the way the registry already does (`derive.ts`). It is
   * also what keeps Arizona's CCDs — statistical shapes with no government —
   * from ever drawing as municipal boundaries. Features without the property
   * (every other layer) always pass.
   */
  governingOnly?: boolean;
  tier: Tier;
  label: string;
  /**
   * Dash pattern, in multiples of the line width.
   *
   * Hue is the tier signal, but the Local tier holds three types that overlap
   * heavily around any city — county, municipal and school all trace the same
   * ground. Drawn in one colour with one dash they were indistinguishable, so
   * the pattern separates types *within* a tier: long dashes for the widest
   * containing shape, down to a fine dot for the most nested one.
   */
  dash: [number, number];
  /**
   * Stroke weight relative to the base ramp.
   *
   * Same ordering logic as the dash — the shape that contains the others is
   * drawn heaviest, so a reader can tell nesting depth at a glance without
   * reading a single label.
   */
  weight: number;
  /**
   * Zoom at which this type's labels appear.
   *
   * Nested types come in later than their containers. Six label layers all
   * switching on together at z7 produced a solid mat of text over any metro.
   */
  labelMinZoom: number;
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
    dash: [8, 3],
    weight: 1.3,
    labelMinZoom: 5,
  },
  "state-senate": {
    files: ["sldu-04.geojson", "sldu-34.geojson", "sldu-33.geojson"],
    tier: "state",
    label: "State Senate",
    dash: [5, 2],
    weight: 1.1,
    labelMinZoom: 7,
  },
  "state-house": {
    files: ["sldl-04.geojson", "sldl-34.geojson", "sldl-33.geojson"],
    tier: "state",
    label: "State House",
    dash: [2, 2],
    weight: 0.9,
    labelMinZoom: 8,
  },
  county: {
    files: ["county-us.geojson"],
    tier: "local",
    label: "County",
    // The widest thing the Local tier draws, so it gets the longest dash and
    // the heaviest stroke.
    dash: [7, 3],
    weight: 1.25,
    labelMinZoom: 6,
  },
  municipal: {
    // Both halves of the municipal picture (M14): places, and the county
    // subdivisions that ARE the municipalities in New Jersey and New
    // Hampshire — Rockaway Township and Newbury have no place polygon at
    // all. FUNCSTAT (governingOnly) is what stops the merge double-drawing
    // Concord and friends and keeps Arizona's statistical CCDs off the map.
    files: [
      "place-04.geojson",
      "place-34.geojson",
      "place-33.geojson",
      "cousub-04.geojson",
      "cousub-34.geojson",
      "cousub-33.geojson",
    ],
    tier: "local",
    label: "Municipal",
    dash: [3, 2],
    weight: 1.0,
    labelMinZoom: 8,
    governingOnly: true,
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
    // The most nested Local shape, and the one carrying the most features —
    // a fine dot at the lightest weight, held back to high zoom.
    dash: [1, 2],
    weight: 0.75,
    labelMinZoom: 10,
  },
};

export const DISTRICT_TYPES = Object.keys(DISTRICT_LAYERS) as DistrictType[];

const sourceId = (type: DistrictType) => `district-${type}`;
export const fillLayerId = (type: DistrictType) => `district-${type}-fill`;
export const lineLayerId = (type: DistrictType) => `district-${type}-line`;
export const labelLayerId = (type: DistrictType) => `district-${type}-label`;

/** Every fill layer, for hit-testing a click. */
export const allFillLayerIds = () => DISTRICT_TYPES.map(fillLayerId);

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

/**
 * Mirrors `GOVERNING_FUNCSTAT` in `lib/registry/derive.ts`: A/B/C/G govern,
 * F/N/S/I do not. Kept as a literal here because the map bundle must not
 * import registry code (§0d), and a test asserts the two stay in agreement.
 */
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
      features: groups.flat().filter((f) => keepFeature(spec, f)),
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
/**
 * The first symbol layer, so custom layers land UNDER the place labels.
 *
 * Exported since g3: the state-focus edges need the same insertion point,
 * and an ambient effect painting over a town name would be an effect that
 * carries information.
 */
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
          // The reader's narrowed divisions (item 7, design pass): the
          // street they typed shades the district(s) that contain it —
          // quieter than a selection, present without one.
          ["boolean", ["feature-state", "narrowed"], false],
          0.12,
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
            0.8 * spec.weight,
          ],
          12,
          [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            3.2 * spec.weight,
            1.5 * spec.weight,
          ],
        ],
      },
    }));

  addIfAbsent(labelLayerId(type), () => ({
      id: labelLayerId(type),
      type: "symbol",
      source,
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

let narrowedApplied: { type: DistrictType; ocdId: string }[] = [];

/**
 * Shade the reader's narrowed divisions (item 7, design pass 2026-08-15):
 * the street they typed shades the municipality and school district that
 * contain it. Feature-state like selection, quieter than it, and additive
 * — narrowing never clears a selection or vice versa.
 *
 * Entries whose layer is not loaded yet are simply not applied this call;
 * the caller re-applies on the map's own load signals, so the shading
 * appears the moment the boundary does.
 */
export function setNarrowedDistricts(
  map: MapLibreMap,
  entries: { type: DistrictType; ocdId: string }[],
): void {
  for (const prev of narrowedApplied) {
    const source = sourceId(prev.type);
    if (map.getSource(source)) {
      map.setFeatureState({ source, id: prev.ocdId }, { narrowed: false });
    }
  }
  narrowedApplied = [];

  for (const entry of entries) {
    const source = sourceId(entry.type);
    if (!map.getSource(source)) continue;
    map.setFeatureState({ source, id: entry.ocdId }, { narrowed: true });
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

/** One district currently drawn on screen — the stats card's unit (3g). */
export interface DrawnDistrict {
  type: DistrictType;
  tier: Tier;
  typeLabel: string;
  ocdId: string;
  label: string;
}

/**
 * Every district currently drawn, deduplicated by ocdId (3g, 2026-08-19).
 *
 * This is the ONE denominator behind both the Districts stat card and the
 * "Districts here" door it opens. The card used to count these features
 * while the door listed legislative seats — two different universes, and
 * the author caught the card saying 3 with two rows listed. The count is
 * now `drawnDistrictsOn(...).length` and the door renders exactly this
 * list, so the stated N and the rendered rows cannot diverge
 * (tests/representation.test.ts holds the coupling).
 */
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
      tier: DISTRICT_LAYERS[type].tier,
      typeLabel: DISTRICT_LAYERS[type].label,
      ocdId,
      label: String(feature.properties?.label ?? ocdId),
    });
  }
  return drawn;
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
