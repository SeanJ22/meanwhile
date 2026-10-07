/**
 * Back returns the reader to where they were, not to the continent. The map
 * mounts at the continental bounds, so the last camera (where the reader was
 * looking) is kept in `sessionStorage`, apart from the stored zip: it is a
 * fact about the reader, not a government. History state is not used because
 * the Next router owns it and writing to it remounts the map.
 *
 * Orientation only: per-tab, cleared with the tab, never sent anywhere.
 */

const KEY = "wtp:map-camera";

export interface RememberedCamera {
  lat: number;
  lng: number;
  zoom: number;
}

/** A camera we would actually restore to. Anything else is not remembered. */
function isUsable(value: unknown): value is RememberedCamera {
  if (typeof value !== "object" || value === null) return false;
  const camera = value as Partial<RememberedCamera>;
  return (
    typeof camera.lat === "number" &&
    Number.isFinite(camera.lat) &&
    camera.lat >= -90 &&
    camera.lat <= 90 &&
    typeof camera.lng === "number" &&
    Number.isFinite(camera.lng) &&
    camera.lng >= -180 &&
    camera.lng <= 180 &&
    typeof camera.zoom === "number" &&
    Number.isFinite(camera.zoom) &&
    // A zoom at or below the continental view is where the map opens anyway; not remembered.
    camera.zoom > 4 &&
    camera.zoom <= 22
  );
}

export function rememberCamera(camera: RememberedCamera): void {
  if (typeof window === "undefined") return;
  if (!isUsable(camera)) return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(camera));
  } catch {
    // Failing to remember is survivable; failing the map is not.
  }
}

export function recallCamera(): RememberedCamera | null {
  if (typeof window === "undefined") return null;
  // A URL names the place to open. Never restore another place while its
  // centroid loads (or if the link's ZIP is invalid).
  if (new URLSearchParams(window.location.search).has("zip")) return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isUsable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function forgetCamera(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // See rememberCamera.
  }
}
