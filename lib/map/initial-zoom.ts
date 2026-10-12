import { METRO_ZOOM } from "./style.ts";

/**
 * Hand-picked first-view altitudes for some zips: the first view frames the
 * reader's town and its surroundings, never a wall of street names or a whole
 * state. Every other zip uses the metro default.
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
