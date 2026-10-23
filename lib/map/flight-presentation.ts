import type { Map as MapLibreMap } from "maplibre-gl";

const held = new WeakSet<MapLibreMap>();
export function holdMapPresentation(map: MapLibreMap): void { held.add(map); }
export function releaseMapPresentation(map: MapLibreMap): void { held.delete(map); }
export function mapPresentationHeld(map: MapLibreMap): boolean { return held.has(map); }

export function applicationLayer(id: string): boolean {
  return id.startsWith("district-") || id.startsWith("state-relief-") || id.startsWith("voting-");
}

/** Called once at motion start and once after idle, never by move/zoom/render. */
export function setPresentationVisible(map: MapLibreMap, visible: boolean): void {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (applicationLayer(layer.id) && (map.getLayoutProperty(layer.id, "visibility") ?? "visible") !== (visible ? "visible" : "none")) {
      map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
    }
  }
}
