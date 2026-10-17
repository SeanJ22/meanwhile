import { haversineKm } from "../geo/distance.ts";
import { DEFAULT_RADIUS_KM, MAX_RADIUS_KM } from "../meetings/constants.ts";

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

export function requestRadiusKm(viewportKm: number): number {
  const floor = DEFAULT_RADIUS_KM;
  const cap = MAX_RADIUS_KM;
  if (!Number.isFinite(viewportKm) || viewportKm <= 0) return floor;
  return Math.min(cap, Math.max(floor, Math.ceil(viewportKm)));
}

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
