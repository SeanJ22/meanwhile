import type { ExpressionSpecification, FilterSpecification, LayerSpecification, Map as MapLibreMap, StyleImageInterface } from "maplibre-gl";
import { NATIONAL_BOUNDARIES_SOURCE } from "./districts.ts";
import { stateFilter } from "./state-focus.ts";
import { fillClass, flipParty, type DistrictResult, type FillClass, type ResultParty } from "./results.ts";

/** The design's map is one dark palette in either app theme: party colors on a near-black ground. */
export const PARTY_FILL: Record<ResultParty, string> = { D: "#2457b8", R: "#b3362a", O: "#6b7280" };
export const BADGE_INK = "#fdfaf4";
export const INK = { ground: "#0f1117", line: "#0f1117", none: "#262a33", base: "#1e2028", stripeA: "#2a2d37", stripeB: "#4a4f5c", halo: "#4fc9e8", you: "#ffffff" } as const;

export const RESULTS_STATES_SOURCE = "results-states";
export const RESULTS_DISTRICTS_SOURCE = "results-districts";
export const RESULTS_BADGES_SOURCE = "results-state-badges";
export const resultsLayerId = (name: string) => `results-${name}`;
export const isResultsLayer = (id: string) => id.startsWith("results-");

/** What the results draw on: a district kind within one state, or the state shapes themselves. */
export type ResultsSurface =
  | { kind: "districts"; boundary: "congressional" | "state-senate" | "state-house"; state: string }
  | { kind: "states" }
  /** The national House view: all 435 districts in the Albers-USA layout, with the state lines over them. */
  | { kind: "nation-districts" };

export const imageIds = () => ({
  stripes: "results-stripes",
  dots: "results-dots",
  flip: { D: "results-flip-d", R: "results-flip-r", O: "results-flip-o" } as Record<ResultParty, string>,
});

const idsIn = (ids: readonly string[]): FilterSpecification => ["in", ["get", "ocdId"], ["literal", [...ids]]] as FilterSpecification;
const withBase = (base: FilterSpecification | null, filter: FilterSpecification): FilterSpecification =>
  (base ? ["all", base, filter] : filter) as FilterSpecification;

/** Group district ids by how each one is drawn. */
export function groupByFill(results: Readonly<Record<string, DistrictResult>>): Record<FillClass, string[]> {
  const groups: Record<FillClass, string[]> = { D: [], R: [], O: [], split: [], counting: [] };
  for (const result of Object.values(results)) groups[fillClass(result)].push(result.ocdId);
  return groups;
}

/** The flat near-black the results sit on, covering the app's own basemap. */
export const groundLayer = (): LayerSpecification => ({ id: resultsLayerId("ground"), type: "background", paint: { "background-color": INK.ground } });

/** The layers that color a surface by result, drawn on the one boundary source the map already holds. */
export function resultLayers(
  surface: ResultsSurface,
  results: Readonly<Record<string, DistrictResult>>,
  options: { yours: readonly string[]; stateLines?: boolean },
): LayerSpecification[] {
  const ink = INK;
  const images = imageIds();
  const on = surface.kind === "districts"
    ? { source: NATIONAL_BOUNDARIES_SOURCE, "source-layer": "districts" as const,
        base: ["all", ["==", ["get", "boundaryType"], surface.boundary], stateFilter(surface.state)] as FilterSpecification }
    : { source: surface.kind === "nation-districts" ? RESULTS_DISTRICTS_SOURCE : RESULTS_STATES_SOURCE, base: null as FilterSpecification | null };
  const layer = (suffix: string): { id: string; source: string; "source-layer"?: string } =>
    ({ id: resultsLayerId(suffix), source: on.source, ...("source-layer" in on ? { "source-layer": on["source-layer"] } : {}) });
  const groups = groupByFill(results);

  const color: unknown[] = ["match", ["get", "ocdId"]];
  for (const party of ["D", "R", "O"] as const) if (groups[party].length) color.push(groups[party], PARTY_FILL[party]);
  // Partly or fully undecided, and split seats, sit on a neutral base under their pattern.
  const patterned = [...groups.split, ...groups.counting];
  if (patterned.length) color.push(patterned, ink.base);
  color.push(ink.none);

  const layers: LayerSpecification[] = [{
    ...layer("fill"), type: "fill", ...(on.base ? { filter: on.base } : {}),
    // A match needs at least one pair; with no results every district takes the neutral color.
    paint: { "fill-color": color.length > 3 ? color as unknown as ExpressionSpecification : ink.none, "fill-opacity": 1 },
  } as LayerSpecification];
  if (groups.counting.length) layers.push({ ...layer("counting"), type: "fill", filter: withBase(on.base, idsIn(groups.counting)), paint: { "fill-pattern": images.stripes } } as LayerSpecification);
  if (groups.split.length) layers.push({ ...layer("split"), type: "fill", filter: withBase(on.base, idsIn(groups.split)), paint: { "fill-pattern": images.dots } } as LayerSpecification);
  layers.push({
    ...layer("line"), type: "line", ...(on.base ? { filter: on.base } : {}),
    layout: { "line-join": "round" },
    paint: { "line-color": ink.line, "line-width": surface.kind === "states" ? 0.8 : 0.7 },
  } as LayerSpecification);
  if (surface.kind === "nation-districts" && options.stateLines) layers.push({
    id: resultsLayerId("state-line"), type: "line", source: RESULTS_STATES_SOURCE, layout: { "line-join": "round" },
    paint: { "line-color": INK.line, "line-width": 1.4 },
  } as LayerSpecification);
  if (options.yours.length) layers.push({
    ...layer("yours"), type: "line", filter: withBase(on.base, idsIn(options.yours)),
    layout: { "line-join": "round" }, paint: { "line-color": ink.you, "line-width": 2.5 },
  } as LayerSpecification);
  if (surface.kind !== "states") {
    for (const party of ["D", "R", "O"] as const) {
      const flipped = Object.values(results).filter(result => flipParty(result) === party).map(result => result.ocdId);
      if (!flipped.length) continue;
      layers.push({
        ...layer(`flip-${party}`), type: "symbol", filter: withBase(on.base, idsIn(flipped)),
        layout: { "icon-image": images.flip[party], "icon-allow-overlap": false, "icon-ignore-placement": true },
      } as LayerSpecification);
    }
  }
  return layers;
}

/** The outline of the county the reader picked: a dark halo with a bright line on top. */
export function countyOutlineLayers(countyOcdId: string): LayerSpecification[] {
  const filter = ["all", ["==", ["get", "boundaryType"], "county"], ["==", ["get", "ocdId"], countyOcdId]] as FilterSpecification;
  const base = { source: NATIONAL_BOUNDARIES_SOURCE, "source-layer": "districts", filter, type: "line" as const, layout: { "line-join": "round" as const } };
  return [
    { ...base, id: resultsLayerId("county-halo"), paint: { "line-color": INK.line, "line-width": 4, "line-opacity": 0.7 } },
    { ...base, id: resultsLayerId("county-line"), paint: { "line-color": INK.halo, "line-width": 1.5 } },
  ] as LayerSpecification[];
}

/* ----------------------------------------------------- state centroids --- */

interface StateShape { properties: { ocdId: string }; geometry: { coordinates: number[][][] } }

/** The center of a state's largest part: where its badge sits. */
export function stateCentroid(shape: StateShape): [number, number] {
  let best: { area: number; point: [number, number] } | null = null;
  for (const ring of shape.geometry.coordinates) {
    let area = 0, cx = 0, cy = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
      const [x0, y0] = ring[index], [x1, y1] = ring[index + 1];
      const cross = x0 * y1 - x1 * y0;
      area += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
    }
    if (!area) continue;
    if (!best || Math.abs(area) > best.area) best = { area: Math.abs(area), point: [cx / (3 * area), cy / (3 * area)] };
  }
  return best?.point ?? [0, 0];
}

/** One point per state that carries a badge: a flip arrow, or a count of flipped House seats. */
export function stateBadgePoints(
  shapes: readonly StateShape[],
  badges: Readonly<Record<string, { party: ResultParty; count?: number }>>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: shapes.flatMap(shape => {
      const badge = badges[shape.properties.ocdId];
      if (!badge) return [];
      return [{ type: "Feature" as const, properties: { party: badge.party, ...(badge.count ? { count: String(badge.count) } : {}) },
        geometry: { type: "Point" as const, coordinates: stateCentroid(shape) } }];
    }),
  };
}

/** Arrow badges and count badges for state shapes. */
export function stateBadgeLayers(counts: boolean): LayerSpecification[] {
  const base = { source: RESULTS_BADGES_SOURCE };
  if (counts) return [
    { ...base, id: resultsLayerId("state-count-dot"), type: "circle", paint: { "circle-radius": 9, "circle-color": "#0f1117", "circle-stroke-color": BADGE_INK, "circle-stroke-width": 1.2 } },
    { ...base, id: resultsLayerId("state-count"), type: "symbol",
      layout: { "text-field": ["get", "count"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-allow-overlap": true },
      paint: { "text-color": BADGE_INK } },
  ] as LayerSpecification[];
  return (["D", "R", "O"] as const).map(party => ({
    ...base, id: resultsLayerId(`state-flip-${party}`), type: "symbol", filter: ["==", ["get", "party"], party],
    layout: { "icon-image": imageIds().flip[party], "icon-allow-overlap": true, "icon-ignore-placement": true },
  })) as LayerSpecification[];
}

/* ---------------------------------------------------------------- images --- */

type Draw = (context: CanvasRenderingContext2D, size: number) => void;
function canvasImage(size: number, draw: Draw): StyleImageInterface & { width: number; height: number } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  draw(context, size);
  const { data } = context.getImageData(0, 0, size, size);
  return { width: size, height: size, data: new Uint8Array(data.buffer) } as StyleImageInterface & { width: number; height: number };
}

const ARROW = { D: "M3.5 0h-6M-0.5 -3l-3 3 3 3", R: "M-3.5 0h6M0.5 -3l3 3-3 3", O: "M-3.5 0h6M0.5 -3l3 3-3 3" } as const;

/** Stripes, split-seat dots and flip badges, added once per style. Pixel ratio 2 keeps them crisp. */
export function addResultImages(map: MapLibreMap): void {
  const ink = INK, ids = imageIds(), ratio = 2;
  const add = (id: string, size: number, draw: Draw) => { if (!map.hasImage(id)) map.addImage(id, canvasImage(size, draw), { pixelRatio: ratio }); };
  // 45° stripes, 6px period on screen.
  add(ids.stripes, 6 * ratio, (c, s) => {
    c.fillStyle = ink.stripeA; c.fillRect(0, 0, s, s);
    c.strokeStyle = ink.stripeB; c.lineWidth = s / 3;
    for (const offset of [-s, 0, s]) { c.beginPath(); c.moveTo(offset, s); c.lineTo(offset + s, 0); c.stroke(); }
  });
  // Two offset 5px dot grids: one seat each.
  add(ids.dots, 5 * ratio, (c, s) => {
    c.fillStyle = ink.base; c.fillRect(0, 0, s, s);
    c.fillStyle = PARTY_FILL.D; c.beginPath(); c.arc(s * 0.25, s * 0.25, s * 0.3, 0, Math.PI * 2); c.fill();
    c.fillStyle = PARTY_FILL.R; c.beginPath(); c.arc(s * 0.75, s * 0.75, s * 0.3, 0, Math.PI * 2); c.fill();
  });
  for (const party of ["D", "R", "O"] as const) add(ids.flip[party], 16 * ratio, (c, s) => {
    c.translate(s / 2, s / 2); c.scale(ratio, ratio);
    c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2);
    c.fillStyle = PARTY_FILL[party]; c.fill();
    c.lineWidth = 1; c.strokeStyle = INK.line; c.stroke();
    c.lineWidth = 1.6; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = BADGE_INK;
    c.stroke(new Path2D(ARROW[party]));
  });
}
