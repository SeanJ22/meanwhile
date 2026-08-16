import { haversineKm } from "../geo/distance.ts";
import { RADIUS_LADDER_KM } from "../meetings/constants.ts";

/**
 * **More viewport must never mean fewer pins.** (g3 item 6, the author's
 * find, 2026-08-16.)
 *
 * ## What the reader was doing, and what happened
 *
 * Casually zooming out DROPPED pins. The mechanism is not a cluster threshold
 * and not a culling bound — nothing in the render layer looks at zoom at all.
 * It is the FETCH:
 *
 * - the map re-queries `/api/meetings` whenever a user gesture comes to rest;
 * - that query carried no `radiusKm`, so the server used the ladder's first
 *   rung, **25 km**, no matter how far out the reader had zoomed;
 * - a wheel zoom pulls the centre toward the cursor, so zooming out also
 *   moves the centre — and once it has moved far enough to pass the
 *   re-query threshold, a fresh 25 km circle is drawn around a NEW centre.
 *
 * Pins that were inside the old circle and outside the new one vanish. The
 * reader has just asked to see MORE and been given LESS, which reads as the
 * map losing data — and on a product whose whole claim is "here is what is
 * happening near you", a pin that disappears when you look wider is
 * indistinguishable from a meeting that stopped existing.
 *
 * ## The rule
 *
 * The requested radius follows the viewport: at least far enough to cover
 * what the reader can see, and never below the default rung. Zooming out can
 * then only ever return a SUPERSET of what was on screen, because the circle
 * only grows. Zooming in holds at the default rung rather than shrinking, so
 * pins do not vanish in that direction either.
 *
 * The ladder's top rung is the cap. It is not arbitrary politeness: the
 * server clamps to it anyway, and a radius that outran the clamp would make
 * the client's own request a lie about what it expects back.
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
 * What to ask the meetings API for, given what the reader can see.
 *
 * Never below the first rung — a reader zoomed into one street still expects
 * the neighbourhood's meetings — and never above the last, which is the
 * server's own clamp.
 */
export function requestRadiusKm(viewportKm: number): number {
  const floor = RADIUS_LADDER_KM[0];
  const cap = RADIUS_LADDER_KM[RADIUS_LADDER_KM.length - 1];
  if (!Number.isFinite(viewportKm) || viewportKm <= 0) return floor;
  return Math.min(cap, Math.max(floor, Math.ceil(viewportKm)));
}

/**
 * Has the view changed enough to be worth re-asking?
 *
 * The centre-distance threshold on its own was the second half of the defect:
 * a reader who zooms out WITHOUT moving the centre passes no distance test,
 * so the radius never widened and the extra viewport stayed empty of pins
 * that exist. A material growth in the requested radius is its own reason to
 * re-ask — and only GROWTH is, because shrinking back on a zoom-in would
 * throw away pins the reader can still see.
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
