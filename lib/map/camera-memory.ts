/**
 * **BAL-9 (2026-08-24, the author's walkthrough) — BACK RETURNS THE READER TO
 * WHERE THEY WERE, NOT TO THE CONTINENT.**
 *
 * His capture `12-19-41` is the whole finding: after pressing back from the
 * ballot page, the map is drawn at the continental United States — Arizona a
 * small highlighted rectangle near the bottom-left — while the rail still says
 * *Meetings near 85701* and the districts counter reads **281 in view** against
 * the **33** it read a moment earlier.
 *
 * ## What was actually happening, which is not what it looks like
 *
 * Nothing lost the reader's zip. The zip survives in `sessionStorage` and every
 * panel on the page reads it correctly, which is why the rail is still right.
 * What is not remembered is the CAMERA: `map-canvas` constructs its map with
 * `bounds: CONUS_BOUNDS`, so **every mount starts at the continent** and then
 * flies to the zip's first-view altitude when a camera prop change fires. Come
 * back from another route and the map is a fresh mount: it opens at CONUS, and
 * a reader who had zoomed into their own neighbourhood does not get their
 * neighbourhood back — they get the country, and the pin-level view they built
 * is gone.
 *
 * ## Why this is its own store rather than a field on the zip
 *
 * `hooks/use-stored-zip.ts` deliberately stores ONLY the zip and re-resolves
 * its centroid, so a Census vintage update cannot leave a stale coordinate
 * behind. That decision is correct and untouched. This is a different fact:
 * not where a zip is, but **where the reader last put the camera** — which no
 * vintage update can invalidate, because it is a fact about the reader rather
 * than about a government. Two different facts, two different stores.
 *
 * ## Why `sessionStorage` and not history state
 *
 * The brief says the map position rides on history state. In this app it
 * cannot: the Next router owns the history entry, and writing to it from a map
 * island remounts the island — the failure that made overlays die on open
 * (`M52`). `sessionStorage` gives the reader the same thing they asked for, on
 * back, on forward, on a hardware back button and on a reopened tab within the
 * session, without contending with the router for the one object it owns.
 *
 * ## It is orientation, and it is discarded exactly like every other point
 *
 * Per-tab, cleared with the tab, never sent anywhere, never joined to
 * anything, and it holds a viewport centre — where the reader was LOOKING —
 * which is not a claim about where they are. The zip is still the only
 * location this product records, and the search log still records the zip the
 * server resolved and never a coordinate.
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
    // A zoom at or below the continental view is not worth restoring: it is
    // where the map opens anyway, and remembering it would make "back" feel
    // like it did nothing.
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
    // Not being able to remember where the reader was looking is survivable.
    // Failing the map is not.
  }
}

export function recallCamera(): RememberedCamera | null {
  if (typeof window === "undefined") return null;
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
