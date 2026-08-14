import { METRO_ZOOM } from "./style.ts";

/**
 * Deliberate first-view altitudes per covered zip (6f).
 *
 * The rule: the first view frames the reader's town AND its surroundings —
 * never a wall of street names, never a whole-state overview. Each value
 * below was picked by looking at the framing, not derived:
 *
 * - 85701 — downtown Tucson; the metro default already reads right.
 * - 85641 — Vail sprawls across unincorporated desert; one step out shows
 *   the area between Vail and Tucson's edge that its government spans.
 * - 07866 — Rockaway Township is long and narrow with its neighbors tight
 *   around it; a step and a half out shows the township AND Denville /
 *   Dover / Boonton, which is where its meetings actually cluster.
 * - 03255 — rural Newbury on Lake Sunapee; two steps out shows the towns
 *   an NH reader actually drives between.
 */
const INITIAL_ZOOM_BY_ZIP: Record<string, number> = {
  "85701": METRO_ZOOM, // 11
  "85641": 10.3,
  "07866": 10.5,
  "03255": 10,
};

export function initialZoomForZip(zip: string | null | undefined): number {
  return (zip && INITIAL_ZOOM_BY_ZIP[zip]) || METRO_ZOOM;
}
