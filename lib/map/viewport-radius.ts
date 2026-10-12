import { haversineKm } from "../geo/distance.ts";
import { RADIUS_LADDER_KM } from "../meetings/constants.ts";

/**
 * More viewport must never mean fewer pins. The requested radius follows the
 * viewport: at least far enough to cover what the reader can see, never below
 * the ladder's first rung and never above its last (the server's own clamp).
 * Zooming out then only returns a superset of what was on screen.
 */

/** Corner-to-corner half-span of the visible map, in kilometres. */
export function viewportRadiusKm(bounds: {
  north: number;
  south: number;
  east: number;
  west: number;
}): number {
  return (
    haversineKm(bounds.north, bounds.west, bounds.south, bounds.east) / 2
  );
}

/**
 * What to ask the meetings API for, given what the reader can see: never
 * below the first rung, never above the last.
 */
export function requestRadiusKm(viewportKm: number): number {
  const floor = RADIUS_LADDER_KM[0];
  const cap = RADIUS_LADDER_KM[RADIUS_LADDER_KM.length - 1];
  if (!Number.isFinite(viewportKm) || viewportKm <= 0) return floor;
  return Math.min(cap, Math.max(floor, Math.ceil(viewportKm)));
}

/**
 * Has the view changed enough to be worth re-asking? Moving the centre, or a
 * material growth in the requested radius (only growth: shrinking on zoom-in
 * would drop pins still visible).
 */
export function shouldRequery(
  previous: { lat: number; lng: number; radiusKm: number } | null,
  next: { lat: number; lng: number; radiusKm: number },
  moveThresholdKm = 5,
): boolean {
  if (!previous) return true;
  if (haversineKm(previous.lat, previous.lng, next.lat, next.lng) >= moveThresholdKm) {
    return true;
  }
  return next.radiusKm > previous.radiusKm * 1.25;
}
