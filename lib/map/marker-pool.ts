import { Marker, type Map as MapLibreMap } from "maplibre-gl";

import type { Venue } from "@/lib/meetings/venues";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import {
  LEVEL_ORDER,
  levelForMeeting,
  type GovernmentLevel,
} from "@/lib/state/derive";

/**
 * A pool of markers, created once and reused. The pool holds a marker for
 * every venue the data contains; filtering changes which are visible (a CSS
 * toggle), never which exist, and only venues whose visibility changed are
 * touched: narrowing 500 pins to 480 does 20 DOM writes, not 980.
 */

export interface MarkerPoolEntry {
  marker: Marker;
  element: HTMLButtonElement;
  venue: Venue;
  /**
   * What this pin's appearance was last rendered from, so unchanged pins skip
   * the icon and position writes.
   */
  renderedSignature: string;
  renderedAt: { lng: number; lat: number };
}

/**
 * What the pool actually did, counted, so tests can assert reuse rather than
 * visual equivalence. Cumulative for the life of the pool; `resetPoolOps`
 * zeroes them.
 */
export interface PoolOps {
  /** Markers constructed and added to the map. */
  created: number;
  /** Markers removed from the map and dropped from the pool. */
  removed: number;
  /** `updateMarkerIcon` calls — several DOM writes each. */
  iconWrites: number;
  /** `setLngLat` calls. */
  positionWrites: number;
  /** Elements whose `data-hidden` changed. */
  visibilityWrites: number;
  /** Elements whose `data-selected` changed. */
  selectionWrites: number;
}

export interface MarkerPool {
  entries: Map<string, MarkerPoolEntry>;
  /** Keys visible after the last apply. The diff basis. */
  previouslyVisibleKeys: Set<string>;
  /** The key `applySelection` last wrote `true` for, so selection writes at most two elements. */
  selectedKey: string | null;
  /** See {@link PoolOps}. */
  ops: PoolOps;
  /**
   * The keys currently fanned out, or empty. At most one group is fanned at a
   * time, so a second fan never lands on top of the first.
   */
  spiderfiedKeys: Set<string>;
}

export function zeroPoolOps(): PoolOps {
  return {
    created: 0,
    removed: 0,
    iconWrites: 0,
    positionWrites: 0,
    visibilityWrites: 0,
    selectionWrites: 0,
  };
}

/** Zero the counters. A test's "before" line; nothing in the app calls it. */
export function resetPoolOps(pool: MarkerPool): void {
  pool.ops = zeroPoolOps();
}

/**
 * Everything about a pin's appearance that `updateMarkerIcon` reads (the
 * meeting count, whether all have concluded, which levels meet here), derived
 * from the venue so it can be compared before any write.
 */
export function renderedSignature(venue: Venue): string {
  const levels = LEVEL_ORDER.filter((level) =>
    venue.meetings.some((m) => levelForMeeting(m) === level),
  );
  const concluded =
    venue.meetings.length > 0 && venue.meetings.every((m) => m.status === "CONCLUDED");
  return [venue.kind ?? "PHYSICAL", venue.name, venue.meetings.length, concluded ? "c" : "o", levels.join(","), readerMeetingCount(venue.meetings, venue.listingIdentity).groups.map(group => group.sourceIds.join(",")).join(";")].join("|");
}

export function createMarkerPool(): MarkerPool {
  return {
    entries: new Map(),
    previouslyVisibleKeys: new Set(),
    spiderfiedKeys: new Set(),
    selectedKey: null,
    ops: zeroPoolOps(),
  };
}

/**
 * Fan a group of colliding pins apart, or put them back, through MapLibre's
 * `Marker.setOffset` (MapLibre owns the element's `transform` and rewrites it
 * every frame), so a fanned group survives pan and zoom. Returns the number
 * of markers moved.
 */
export function applySpiderfy(
  pool: MarkerPool,
  offsets: { key: string; dx: number; dy: number }[],
): number {
  let moved = 0;

  // Put back anything fanned that is not in the new set first, so no pin carries two offsets.
  for (const key of pool.spiderfiedKeys) {
    if (offsets.some((o) => o.key === key)) continue;
    const entry = pool.entries.get(key);
    if (!entry) continue;
    entry.marker.setOffset([0, 0]);
    delete entry.element.dataset.spiderfied;
    // The leg goes with the offset: a stale --spider-len would draw a line to a point it no longer came from.
    entry.element.style.removeProperty("--spider-len");
    entry.element.style.removeProperty("--spider-angle");
    moved++;
  }

  for (const { key, dx, dy } of offsets) {
    const entry = pool.entries.get(key);
    if (!entry) continue;
    entry.marker.setOffset([dx, dy]);
    // The reader is told the pin moved, or it reads as a wrong location.
    entry.element.dataset.spiderfied = "true";

    /*
     * Each fanned pin draws a leader line back to its anchor, whose far end
     * carries the anchor dot: N legs meeting at one point. The geometry is
     * written as custom properties that CSS uses to rotate a pseudo-element,
     * because MapLibre owns `transform`. The angle points back toward the anchor.
     */
    const length = Math.round(Math.hypot(dx, dy) * 100) / 100;
    const angle = (Math.atan2(-dy, -dx) * 180) / Math.PI;
    entry.element.style.setProperty("--spider-len", `${length}px`);
    entry.element.style.setProperty("--spider-angle", `${Math.round(angle * 100) / 100}deg`);
    moved++;
  }

  pool.spiderfiedKeys = new Set(offsets.map((o) => o.key));
  return moved;
}

/** Put every fanned pin back. Returns how many moved. */
export function clearSpiderfy(pool: MarkerPool): number {
  return applySpiderfy(pool, []);
}

function levelColor(level: GovernmentLevel): string {
  return level === "federal"
    ? "var(--accent-national)"
    : `var(--accent-${level})`;
}

function levelGlow(level: GovernmentLevel): string {
  return level === "federal"
    ? "var(--accent-national-glow)"
    : `var(--accent-${level}-glow)`;
}

/**
 * The marker element: a real `<button>` with an `aria-label`, never a `div`,
 * so the map is usable without a mouse.
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
 * Bring one marker's appearance up to date in place. Mutated, not replaced,
 * so a focused button keeps focus.
 */
export function updateMarkerIcon(
  element: HTMLButtonElement,
  venue: Venue,
): void {
  const count = venue.meetings.length;
  const listingCount = readerMeetingCount(venue.meetings, venue.listingIdentity);
  const concluded =
    count > 0 && venue.meetings.every((m) => m.status === "CONCLUDED");

  element.dataset.concluded = String(concluded);
  element.dataset.venueKind = venue.kind ?? "PHYSICAL";
  element.dataset.pinBasis = venue.pinBasis ?? "MEETING";
  element.dataset.meetingIds = JSON.stringify(venue.meetings.map(meeting => meeting.id));
  element.dataset.joinUrls = JSON.stringify(venue.kind === "ONLINE_ONLY" ? venue.meetings.map(meeting => meeting.online?.joinUrl ?? null) : []);

  /*
   * Dot colour says which level of government meets here: school, local,
   * state or federal. A venue hosting several levels shows a split ring with
   * one equal slice per level. Concluded venues stay hollow; the CSS rule owns
   * their look, so the inline background is cleared.
   */
  const dot = element.querySelector<HTMLSpanElement>(".wtp-pin-dot");
  if (dot) {
    const levels = LEVEL_ORDER.filter((level) =>
      venue.meetings.some((m) => levelForMeeting(m) === level),
    );
    element.dataset.levels = levels.join(" ");

    if (venue.kind === "ONLINE_ONLY") {
      dot.style.background = "";
      element.style.setProperty("--pin-color", "var(--online)");
      element.style.setProperty("--pin-glow", "var(--online)");
    } else if (concluded || levels.length === 0) {
      dot.style.background = "";
      element.style.removeProperty("--pin-color");
      element.style.removeProperty("--pin-glow");
    } else if (levels.length === 1) {
      dot.style.background = "";
      element.style.setProperty("--pin-color", levelColor(levels[0]));
      element.style.setProperty("--pin-glow", levelGlow(levels[0]));
    } else {
      const slice = 360 / levels.length;
      const stops = levels
        .map(
          (level, i) =>
            `${levelColor(level)} ${i * slice}deg ${(i + 1) * slice}deg`,
        )
        .join(", ");
      dot.style.background = `conic-gradient(${stops})`;
      element.style.setProperty("--pin-color", levelColor(levels[0]));
      element.style.setProperty("--pin-glow", levelGlow(levels[0]));
    }
  }

  element.setAttribute(
    "aria-label",
    `${venue.kind === "ONLINE_ONLY" ? "Online only: " : ""}${venue.name}, ${count} ${listingCount.unit}${listingCount.countNote ? `. ${listingCount.countNote}` : ""}`,
  );

  const badge = element.querySelector<HTMLSpanElement>(".wtp-pin-count");
  if (badge) {
    badge.textContent = venue.kind === "ONLINE_ONLY" ? "Online only" : count > 1 ? String(count) : "";
    badge.hidden = venue.kind !== "ONLINE_ONLY" && count <= 1;
  }
}

/**
 * The reconciliation decision, with no map and no DOM: create what is new,
 * update what is here, remove only what the data no longer has at all.
 */
export function reconcileKeys(
  existingKeys: Iterable<string>,
  wantedKeys: Iterable<string>,
): { create: string[]; update: string[]; remove: string[] } {
  const wanted = new Set(wantedKeys);
  const existing = new Set(existingKeys);
  return {
    create: [...wanted].filter((k) => !existing.has(k)),
    update: [...wanted].filter((k) => existing.has(k)),
    remove: [...existing].filter((k) => !wanted.has(k)),
  };
}

/**
 * Reconcile the pool against the venues the data now contains. A venue
 * filtered out of view is not removed; that is `applyVisibility`'s job.
 */
/**
 * How a pin is built. Defaults to the real `document` and MapLibre `Marker`;
 * a test injects a counting stand-in to check create/remove counts.
 */
export interface MarkerFactory {
  createElement: (venue: Venue) => HTMLButtonElement;
  createMarker: (element: HTMLButtonElement, venue: Venue, map: MapLibreMap) => Marker;
}

const REAL_MARKERS: MarkerFactory = {
  createElement: createMarkerElement,
  createMarker: (element, venue, map) =>
    new Marker({ element, anchor: "center" }).setLngLat([venue.lng, venue.lat]).addTo(map),
};

export function rebuildMarkerPool(
  pool: MarkerPool,
  map: MapLibreMap,
  venues: Venue[],
  onSelect: (venue: Venue) => void,
  factory: MarkerFactory = REAL_MARKERS,
): void {
  const { remove } = reconcileKeys(pool.entries.keys(), venues.map((v) => v.key));

  for (const key of remove) {
    const entry = pool.entries.get(key);
    if (!entry) continue;
    entry.marker.remove();
    pool.ops.removed += 1;
    pool.entries.delete(key);
    pool.previouslyVisibleKeys.delete(key);
    // A removed pin leaves the fanned set too, or the set grows across refreshes.
    pool.spiderfiedKeys.delete(key);
  }

  for (const venue of venues) {
    const existing = pool.entries.get(venue.key);

    if (existing) {
      // Same pin, possibly different contents: mutate, never replace, and only where something changed.
      existing.venue = venue;
      const signature = renderedSignature(venue);
      if (signature !== existing.renderedSignature) {
        updateMarkerIcon(existing.element, venue);
        existing.renderedSignature = signature;
        pool.ops.iconWrites += 1;
      }
      if (existing.renderedAt.lng !== venue.lng || existing.renderedAt.lat !== venue.lat) {
        existing.marker.setLngLat([venue.lng, venue.lat]);
        existing.renderedAt = { lng: venue.lng, lat: venue.lat };
        pool.ops.positionWrites += 1;
      }
      continue;
    }

    const element = factory.createElement(venue);
    /*
     * A new marker is hidden until `applyVisibility` says otherwise: the pool
     * holds every venue, and `applyVisibility` writes only keys whose
     * visibility changed. A venue the filter includes is written `false` on
     * the next pass, since a fresh key is not in `previouslyVisibleKeys`. Not
     * counted as a visibility write; it is part of construction.
     */
    element.dataset.hidden = "true";
    const entry: MarkerPoolEntry = {
      element,
      venue,
      renderedSignature: renderedSignature(venue),
      renderedAt: { lng: venue.lng, lat: venue.lat },
      marker: factory.createMarker(element, venue, map),
    };
    pool.ops.created += 1;

    // Reads `entry.venue` at click time, so an in-place update never hands back a stale venue.
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      onSelect(entry.venue);
    });

    pool.entries.set(venue.key, entry);
  }
}

/**
 * Show exactly these keys, touching only what changed. Returns how many
 * elements were written; near the pool size on an ordinary filter change
 * means the diffing has stopped working.
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
      pool.ops.visibilityWrites += 1;
      touched++;
    }
  }

  for (const key of visibleKeys) {
    if (pool.previouslyVisibleKeys.has(key)) continue;
    const entry = pool.entries.get(key);
    if (entry) {
      entry.element.dataset.hidden = "false";
      pool.ops.visibilityWrites += 1;
      touched++;
    }
  }

  pool.previouslyVisibleKeys = new Set(visibleKeys);
  return touched;
}

/**
 * Selection is a data attribute, so it survives re-renders and filter passes.
 * Diffed: at most two writes (the old key false, the new one true). Returns
 * the number written.
 */
export function applySelection(
  pool: MarkerPool,
  selectedKey: string | null,
): number {
  if (pool.selectedKey === selectedKey) return 0;

  let written = 0;
  if (pool.selectedKey !== null) {
    const previous = pool.entries.get(pool.selectedKey);
    if (previous) {
      previous.element.dataset.selected = "false";
      pool.ops.selectionWrites += 1;
      written += 1;
    }
  }
  if (selectedKey !== null) {
    const next = pool.entries.get(selectedKey);
    if (next) {
      next.element.dataset.selected = "true";
      pool.ops.selectionWrites += 1;
      written += 1;
    }
  }
  pool.selectedKey = selectedKey;
  return written;
}

export function destroyMarkerPool(pool: MarkerPool): void {
  for (const entry of pool.entries.values()) entry.marker.remove();
  pool.entries.clear();
  pool.previouslyVisibleKeys.clear();
  pool.spiderfiedKeys.clear();
  pool.selectedKey = null;
}
