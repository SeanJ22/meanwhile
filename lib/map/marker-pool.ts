import { Marker, type Map as MapLibreMap } from "maplibre-gl";

import type { Venue } from "@/lib/meetings/venues";
import { readerMeetingCount } from "@/lib/meetings/reader-listing-count";
import {
  LEVEL_ORDER,
  levelForMeeting,
  type GovernmentLevel,
} from "@/lib/state/derive";

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
  /**
   * P-004 · what this pin's appearance was last rendered FROM.
   *
   * `rebuildMarkerPool` used to call `updateMarkerIcon` and `setLngLat` on
   * every surviving entry on every run, whether or not anything about the
   * venue had changed — several DOM writes and a MapLibre reposition per pin,
   * hundreds of times, to arrive back where the pin already was. Comparing a
   * signature first is the same diff the visibility pass has always done, one
   * layer over.
   */
  renderedSignature: string;
  renderedAt: { lng: number; lat: number };
}

/**
 * **P-001 / P-004 · WHAT THE POOL ACTUALLY DID, COUNTED.**
 * (Performance audit of `336a3eb`, remediated 2026-08-24.)
 *
 * The module's own doc says a filter narrowing 500 pins to 480 does 20 DOM
 * writes. Nothing measured that, and the wiring above it made it false: the
 * canvas passed FILTERED venues into the pool, so twenty filtered-out venues
 * read as vanished data and their markers were destroyed — then recreated when
 * the filter was reversed.
 *
 * A documented optimisation the wiring bypasses is the chromium-pin shape, and
 * the answer is the same one: **observe the step's product at the step**
 * (RULING 113). Visual equivalence cannot tell a reused marker from a
 * recreated one; a counter can, and the tests assert the counts rather than
 * the look.
 *
 * Cumulative for the life of the pool. `resetPoolOps` zeroes them, which is
 * what a test does between the two halves of a comparison.
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
  /**
   * P-004 · the key `applySelection` last wrote `true` for.
   *
   * Selection used to write `dataset.selected` on EVERY pool entry — 500
   * writes to select one pin, and again to deselect it. Holding the previous
   * key turns that into at most two.
   */
  selectedKey: string | null;
  /** P-001 / P-004 · see {@link PoolOps}. */
  ops: PoolOps;
  /**
   * The keys currently fanned out (M19), or empty. At most one group is fanned
   * at a time: a second fan while the first is open would put the new
   * positions on top of the old ones, which is the collision this fixes,
   * rebuilt by the fix.
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
 * Everything about a pin's appearance that `updateMarkerIcon` reads — P-004.
 *
 * Derived from the venue rather than measured off the DOM, so it can be
 * compared BEFORE any write happens. It has to cover every input the icon pass
 * uses, or a real change would be skipped: the meeting count, whether every
 * meeting has concluded, and which levels of government meet here.
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
 * Fan a group of colliding pins apart, or put them back (M19, 2026-08-17).
 *
 * The offset is MapLibre's own `Marker.setOffset`, in screen pixels, which is
 * the reason this works rather than a CSS transform: MapLibre owns the
 * element's `transform` and rewrites it on every frame, so anything written
 * there is gone by the next render. An offset is re-applied by the library
 * itself, which means a fanned group survives a pan and a zoom exactly as a
 * reader would expect.
 *
 * Returns the number of markers moved, because an operation that can move
 * nothing must say what it moved.
 */
export function applySpiderfy(
  pool: MarkerPool,
  offsets: { key: string; dx: number; dy: number }[],
): number {
  let moved = 0;

  // Put back anything fanned that is not in the new set, first — otherwise a
  // pin could carry an old offset and a new one at once.
  for (const key of pool.spiderfiedKeys) {
    if (offsets.some((o) => o.key === key)) continue;
    const entry = pool.entries.get(key);
    if (!entry) continue;
    entry.marker.setOffset([0, 0]);
    delete entry.element.dataset.spiderfied;
    // F01 9.3: the leg goes with the offset. A stale --spider-len on an
    // un-fanned pin would draw a line to a point it no longer came from.
    entry.element.style.removeProperty("--spider-len");
    entry.element.style.removeProperty("--spider-angle");
    moved++;
  }

  for (const { key, dx, dy } of offsets) {
    const entry = pool.entries.get(key);
    if (!entry) continue;
    entry.marker.setOffset([dx, dy]);
    // The reader is told the pin moved. Without it, a pin sitting somewhere
    // other than its building is a wrong location rather than a fanned one.
    entry.element.dataset.spiderfied = "true";

    /*
     * F01 9.3 (2026-08-19, the author): *"when those are spidered it looks
     * like it just simply is moving. It's not like a spider effect... the
     * spidering effect is not very clear at all."* His before/after pair is in
     * the Drive folder (2026-08-18_14-29-42 and _14-30-01) and he is right:
     * the two shots differ only in where two dots sit. A dashed halo says "this
     * pin moved"; it does not say WHERE FROM, and without that the fan reads as
     * pins drifting rather than as one place opening up.
     *
     * So each fanned pin draws a LEADER LINE back to the anchor it came from,
     * and the line's far end carries the anchor dot. That is what makes it a
     * spider: N legs meeting at one visible point, which is the shape a reader
     * already knows means "these all live here".
     *
     * The geometry is written as custom properties rather than as a transform,
     * because MapLibre owns this element's `transform` and rewrites it every
     * frame — the same reason the offset itself goes through `setOffset`. CSS
     * reads these and rotates a pseudo-element, which MapLibre never touches.
     * The angle points BACK toward the anchor: the leg is drawn from the pin.
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
  const listingCount = readerMeetingCount(venue.meetings, venue.listingIdentity);
  const concluded =
    count > 0 && venue.meetings.every((m) => m.status === "CONCLUDED");

  element.dataset.concluded = String(concluded);
  element.dataset.venueKind = venue.kind ?? "PHYSICAL";
  element.dataset.meetingIds = JSON.stringify(venue.meetings.map(meeting => meeting.id));
  element.dataset.joinUrls = JSON.stringify(venue.kind === "ONLINE_ONLY" ? venue.meetings.map(meeting => meeting.online?.joinUrl ?? null) : []);

  /*
   * Dot color says which level of government meets here (2g): school, local,
   * state or federal. A venue hosting several levels — a school board and a
   * congressional town hall in the same building — shows a split ring with
   * one equal slice per level, never one level's color silently standing in
   * for all of them. Concluded venues stay hollow: the CSS rule owns their
   * look, so the inline background must be cleared, not fought.
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
 * The reconciliation DECISION, with no map and no DOM in it.
 *
 * Split out from `rebuildMarkerPool` so the rule can be asserted directly
 * (R05). The rule is the whole point of this module and it is one line of
 * prose — create what is new, update what is already here, remove only what
 * the data no longer has AT ALL — but it is the kind of rule that decays into
 * "remove everything and rebuild" during an unrelated fix, and the symptom is
 * a stutter at a scale no fixture reaches.
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
 * Reconcile the pool against the venues the data now contains.
 *
 * Creates what is new, updates what changed, and removes only what the data no
 * longer has at all. **A venue filtered out of view is not removed** — that is
 * `applyVisibility`'s job, and conflating the two is what makes the naive
 * implementation slow.
 */
/**
 * How a pin is BUILT — injectable, and injectable for one stated reason.
 *
 * P-001 asks for the pool's behaviour to be proven with operation counters
 * rather than with visual equivalence, and every other decision this module
 * makes is already testable: `reconcileKeys` is pure, the signature comparison
 * is pure, and visibility and selection touch nothing but `element.dataset`.
 * The one thing that is not is CONSTRUCTION, which needs `document` and a real
 * MapLibre `Marker` — and the create/remove counts are precisely the numbers
 * the finding is about.
 *
 * So the two calls are named here and default to the real ones. Nothing in the
 * app passes this; a test does, and what it passes is a counter's worth of
 * object rather than a DOM.
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
    // A removed pin cannot stay in the fanned set: `applySpiderfy` would
    // otherwise keep trying to put back a marker that no longer exists, and
    // the set would grow without bound across data refreshes.
    pool.spiderfiedKeys.delete(key);
  }

  for (const venue of venues) {
    const existing = pool.entries.get(venue.key);

    if (existing) {
      // Same pin, possibly different contents. Mutate, never replace — and
      // P-004: only where something actually changed. This used to write the
      // icon and the position on every surviving entry on every run, to
      // arrive back where the pin already was.
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
     * **A NEW MARKER IS HIDDEN UNTIL `applyVisibility` SAYS OTHERWISE** —
     * found by `pnpm walk:all` on 2026-08-24, after P-001 shipped, and it is
     * the regression P-001 itself introduced.
     *
     * The pool used to hold only the FILTERED venues, so every marker in it
     * was by definition visible and an unset `data-hidden` was correct. P-001
     * made the pool hold every venue in the data — which is the whole point —
     * and `applyVisibility` writes only the keys whose visibility CHANGED. A
     * marker created for a venue the current filter excludes was therefore in
     * neither loop: never written, `data-hidden` unset, and **visible on the
     * map**.
     *
     * The walk named it two ways at once: g9's fan check saw four pins in a
     * stack where the filter should have left fewer, and the geometry
     * assertion failed on a stack that should not have existed.
     *
     * Defaulting to hidden is correct at both ends. A venue the filter
     * excludes stays hidden because nothing shows it; a venue it includes is
     * written `false` on the next pass, because a fresh key is not in
     * `previouslyVisibleKeys`. It is deliberately NOT counted as a visibility
     * write — it is part of constructing the marker, and counting it would
     * make the 500-to-480 assertion report creations as filter work.
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
 *
 * **P-004 · DIFFED, NOT SWEPT.** This used to write `dataset.selected` on every
 * entry in the pool — 500 writes to select one pin — and the canvas re-ran it
 * whenever `venues` changed, so a filter keystroke swept the whole pool for a
 * selection that had not moved.
 *
 * Two writes at most now: the key that was true goes false, the new one goes
 * true. It returns the number written, for the same reason `applyVisibility`
 * does — a diff that stops diffing is invisible unless something counts.
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
