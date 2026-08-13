import { Marker, type Map as MapLibreMap } from "maplibre-gl";

import type { Venue } from "@/lib/meetings/venues";

/**
 * A pool of markers, created once and reused.
 *
 * The port of EdiaStratMap's `buildMarkerPool()` / `rebuildMarkerPool()` /
 * `updateMarkerIcon()` and its `_previouslyVisiblePoolKeys` diffing.
 *
 * **Why this rather than the obvious thing.** The straightforward
 * implementation — remove every marker not in the current result, create one
 * for every marker that is — does DOM work proportional to the *result set* on
 * every filter keystroke. At 34 fixtures that is invisible. At real ingestion
 * scale it is the difference between a map that filters instantly and one that
 * stutters, and by then the fixtures are gone and there is nothing small enough
 * to verify a rewrite against. Building it now is the cheap moment.
 *
 * The pool holds a marker for every venue the *data* contains. Filtering
 * changes which are **visible**, never which exist, and visibility is a CSS
 * toggle on an element MapLibre is already positioning. Only the venues whose
 * visibility actually changed are touched, which is what the previous-visible
 * set is for: a filter that narrows 500 pins to 480 does 20 DOM writes, not
 * 980.
 */

export interface MarkerPoolEntry {
  marker: Marker;
  element: HTMLButtonElement;
  venue: Venue;
}

export interface MarkerPool {
  entries: Map<string, MarkerPoolEntry>;
  /** Keys visible after the last apply. The diff basis. */
  previouslyVisibleKeys: Set<string>;
}

export function createMarkerPool(): MarkerPool {
  return { entries: new Map(), previouslyVisibleKeys: new Set() };
}

/**
 * The marker element.
 *
 * A real `<button>` with an `aria-label`, never a `div`. MapLibre will happily
 * mount an unfocusable element and leave the map unusable without a mouse, and
 * nothing in the library warns about it.
 */
export function createMarkerElement(venue: Venue): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "wtp-pin";

  const dot = document.createElement("span");
  dot.className = "wtp-pin-dot";
  button.appendChild(dot);

  const badge = document.createElement("span");
  badge.className = "wtp-pin-count";
  button.appendChild(badge);

  updateMarkerIcon(button, venue);
  return button;
}

/**
 * Bring one marker's appearance up to date **in place**.
 *
 * Called when a venue's meetings change — a meeting concludes, a filter alters
 * the count behind a pin — so the element is mutated rather than replaced.
 * Replacing it would drop focus, which matters because these are buttons and
 * somebody may be tabbing through them.
 */
export function updateMarkerIcon(
  element: HTMLButtonElement,
  venue: Venue,
): void {
  const count = venue.meetings.length;
  const concluded =
    count > 0 && venue.meetings.every((m) => m.status === "CONCLUDED");

  element.dataset.concluded = String(concluded);
  element.setAttribute(
    "aria-label",
    `${venue.name}, ${count} ${count === 1 ? "meeting" : "meetings"}`,
  );

  const badge = element.querySelector<HTMLSpanElement>(".wtp-pin-count");
  if (badge) {
    badge.textContent = count > 1 ? String(count) : "";
    badge.hidden = count <= 1;
  }
}

/**
 * Reconcile the pool against the venues the data now contains.
 *
 * Creates what is new, updates what changed, and removes only what the data no
 * longer has at all. **A venue filtered out of view is not removed** — that is
 * `applyVisibility`'s job, and conflating the two is what makes the naive
 * implementation slow.
 */
export function rebuildMarkerPool(
  pool: MarkerPool,
  map: MapLibreMap,
  venues: Venue[],
  onSelect: (venue: Venue) => void,
): void {
  const wanted = new Set(venues.map((v) => v.key));

  for (const [key, entry] of pool.entries) {
    if (!wanted.has(key)) {
      entry.marker.remove();
      pool.entries.delete(key);
      pool.previouslyVisibleKeys.delete(key);
    }
  }

  for (const venue of venues) {
    const existing = pool.entries.get(venue.key);

    if (existing) {
      // Same pin, possibly different contents. Mutate, never replace.
      existing.venue = venue;
      updateMarkerIcon(existing.element, venue);
      existing.marker.setLngLat([venue.lng, venue.lat]);
      continue;
    }

    const element = createMarkerElement(venue);
    const entry: MarkerPoolEntry = {
      element,
      venue,
      marker: new Marker({ element, anchor: "center" })
        .setLngLat([venue.lng, venue.lat])
        .addTo(map),
    };

    // Reads `entry.venue` at click time rather than closing over `venue`, so a
    // pin whose contents were updated in place does not hand back a stale one.
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      onSelect(entry.venue);
    });

    pool.entries.set(venue.key, entry);
  }
}

/**
 * Show exactly these keys, touching only what changed.
 *
 * Returns how many elements were actually written to, which is the number worth
 * watching — if it ever approaches the pool size on an ordinary filter change,
 * the diffing has stopped working.
 */
export function applyVisibility(
  pool: MarkerPool,
  visibleKeys: Set<string>,
): number {
  let touched = 0;

  for (const key of pool.previouslyVisibleKeys) {
    if (visibleKeys.has(key)) continue;
    const entry = pool.entries.get(key);
    if (entry) {
      entry.element.dataset.hidden = "true";
      touched++;
    }
  }

  for (const key of visibleKeys) {
    if (pool.previouslyVisibleKeys.has(key)) continue;
    const entry = pool.entries.get(key);
    if (entry) {
      entry.element.dataset.hidden = "false";
      touched++;
    }
  }

  pool.previouslyVisibleKeys = new Set(visibleKeys);
  return touched;
}

/** Selection is a data attribute, so it survives re-renders and filter passes. */
export function applySelection(
  pool: MarkerPool,
  selectedKey: string | null,
): void {
  for (const [key, entry] of pool.entries) {
    entry.element.dataset.selected = String(key === selectedKey);
  }
}

export function destroyMarkerPool(pool: MarkerPool): void {
  for (const entry of pool.entries.values()) entry.marker.remove();
  pool.entries.clear();
  pool.previouslyVisibleKeys.clear();
}
