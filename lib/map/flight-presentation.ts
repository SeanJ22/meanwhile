import type { Map as MapLibreMap } from "maplibre-gl";

const held = new WeakSet<MapLibreMap>();
export function holdMapPresentation(map: MapLibreMap): void { held.add(map); }
export function releaseMapPresentation(map: MapLibreMap): void { held.delete(map); }
export function mapPresentationHeld(map: MapLibreMap): boolean { return held.has(map); }

/** Camera intent, not the frequency or device of MapLibre's events. */
export type MovementMode = "initial-flight" | "programmatic-flight" | "manual" | "camera-adjustment";

/** Only a deliberate flight may replace the last-good presentation with a hold.
 * Returns whether the presentation actually changed, so callers notify React
 * once per transition, never on the repeated events inside a gesture. */
export function startMapMovement(map: MapLibreMap, mode: MovementMode): boolean {
  if (mode === "manual" || mode === "camera-adjustment" || mapPresentationHeld(map)) return false;
  holdMapPresentation(map);
  setPresentationVisible(map, false);
  return true;
}

/** Moveend is not sufficient: only a settled idle may reveal a held flight. */
export function settleMapPresentation(map: MapLibreMap): boolean {
  if (map.isMoving() || !mapPresentationHeld(map)) return false;
  releaseMapPresentation(map);
  setPresentationVisible(map, true);
  return true;
}

/** A replacement query waits for tiles as well as the camera; an in-flight
 * empty tile response must never displace the reader's last-good result. */
export function mapPresentationCanRefresh(map: MapLibreMap): boolean {
  return !map.isMoving() && !mapPresentationHeld(map) && map.isStyleLoaded() === true && map.areTilesLoaded();
}

export function applicationLayer(id: string): boolean {
  return id.startsWith("district-") || id.startsWith("state-relief-") || id.startsWith("voting-");
}

/** Called only at flight hold/reveal, never by manual move/zoom/render. */
export function setPresentationVisible(map: MapLibreMap, visible: boolean): void {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (applicationLayer(layer.id)) map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
  }
}
