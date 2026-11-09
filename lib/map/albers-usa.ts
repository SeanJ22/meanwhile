import type { StateOutlines } from "./state-focus.ts";

/**
 * The national views' layout: the lower 48 in one conic equal-area projection, with Alaska scaled down into the lower left
 * and Hawaii beside it, as the design draws it. The parts and constants are the standard Albers-USA composite.
 * The result is laid on a tiny patch of the map's own plane near (0°, 0°), so the map shows it exactly as projected.
 */
const RAD = Math.PI / 180, SCALE = 1070;

/** A conic equal-area projection: its two standard parallels, the longitude turned to the middle, and the point put at the origin. */
function conic(parallels: [number, number], turn: number, center: [number, number], scale: number, shift: [number, number]) {
  const sin0 = Math.sin(parallels[0] * RAD), n = (sin0 + Math.sin(parallels[1] * RAD)) / 2;
  const c = 1 + sin0 * (2 * n - sin0), r0 = Math.sqrt(c) / n;
  // `turned` is a longitude already turned to put the projection's middle at 0.
  const raw = (turned: number, lat: number): [number, number] => {
    const r = Math.sqrt(c - 2 * n * Math.sin(lat * RAD)) / n, angle = turned * RAD * n;
    return [r * Math.sin(angle), r0 - r * Math.cos(angle)];
  };
  const [cx, cy] = raw(center[0], center[1]);
  return (lng: number, lat: number): [number, number] => {
    const [x, y] = raw(((lng + turn + 540) % 360 + 360) % 360 - 180, lat);
    return [(x - cx) * scale + shift[0], (cy - y) * scale + shift[1]];
  };
}

const lower48 = conic([29.5, 45.5], 96, [-0.6, 38.7], SCALE, [0, 0]);
const alaska = conic([55, 65], 154, [-2, 58.5], SCALE * 0.35, [-0.307 * SCALE, 0.201 * SCALE]);
const hawaii = conic([8, 18], 157, [-3, 19.9], SCALE, [-0.205 * SCALE, 0.212 * SCALE]);

/** Where the plane's point sits on the map: the plane is drawn 40,000 pixels wide, so a patch near (0°, 0°) is not distorted. */
const WORLD = 40_000;
export function planePoint([x, y]: [number, number]): [number, number] {
  const lng = x / WORLD * 360, mercatorY = Math.PI * (1 - 2 * (0.5 + y / WORLD));
  return [lng, Math.atan(Math.sinh(mercatorY)) / RAD];
}

type Plane = (lng: number, lat: number) => [number, number];
const planeOf = (ocdId: string): Plane => ocdId.endsWith("state:ak") ? alaska : ocdId.endsWith("state:hi") ? hawaii : lower48;
/** The far northwest islands of Hawaii are left out of its inset, as the design leaves them out. */
const keepRing = (ocdId: string, ring: readonly number[][]) => !(ocdId.endsWith("state:hi") && ring.every(([lng]) => lng < -161));

const AREAS = /state:[a-z]{2}$|district:dc$/;
const TERRITORIES = /state:(?:as|gu|mp|pr|vi)$/;

export interface LaidOutStates { shapes: GeoJSON.FeatureCollection<GeoJSON.Polygon, { ocdId: string; name: string }>; bounds: [[number, number], [number, number]] }

/** The 50 states and DC in the design's national layout, and the box around them. Territories are not part of it. */
export function layOutStates(outlines: StateOutlines): LaidOutStates {
  const bounds: [[number, number], [number, number]] = [[Infinity, Infinity], [-Infinity, -Infinity]];
  const features = outlines.features.filter(({ properties: { ocdId } }) => AREAS.test(ocdId) && !TERRITORIES.test(ocdId)).map(feature => {
    const { ocdId, name } = feature.properties, project = planeOf(ocdId);
    const coordinates = feature.geometry.coordinates.filter(ring => keepRing(ocdId, ring)).map(ring => ring.map(([lng, lat]) => {
      const point = planePoint(project(lng, lat));
      bounds[0] = [Math.min(bounds[0][0], point[0]), Math.min(bounds[0][1], point[1])];
      bounds[1] = [Math.max(bounds[1][0], point[0]), Math.max(bounds[1][1], point[1])];
      return point;
    }));
    return { type: "Feature" as const, properties: { ocdId, name }, geometry: { type: "Polygon" as const, coordinates } };
  });
  return { shapes: { type: "FeatureCollection", features }, bounds };
}
