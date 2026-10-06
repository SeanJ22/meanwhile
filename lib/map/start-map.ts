interface MapStartup {
  touchZoomRotate?: { disableRotation(): unknown };
  getCanvas(): HTMLCanvasElement;
  remove(): unknown;
}

/** MapLibre may throw, or return a partial map after WebGL initialization fails. */
export function startMap<T extends MapStartup>(create: () => T): T | null {
  let map: T | undefined;
  try {
    map = create();
    if (!map.touchZoomRotate || !map.getCanvas()) throw new Error("Map graphics unavailable");
    map.touchZoomRotate.disableRotation();
    return map;
  } catch {
    try { map?.remove(); } catch { /* A partial map may not support cleanup. */ }
    return null;
  }
}
