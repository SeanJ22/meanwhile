/**
 * The marker pool's create, remove and write counts. `MarkerFactory` is the one seam, defaulted to the real
 * `document` and MapLibre `Marker` calls and passed by nothing in the app.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applySelection,
  applyVisibility,
  createMarkerPool,
  rebuildMarkerPool,
  renderedSignature,
  resetPoolOps,
  type MarkerFactory,
} from "../lib/map/marker-pool.ts";
import type { Venue } from "../lib/meetings/venues.ts";
import type { Meeting } from "../lib/sources/types.ts";

/** Everything the pool touches on a marker, and nothing else. */
const FACTORY: MarkerFactory = {
  createElement: () =>
    ({
      dataset: {} as Record<string, string | undefined>,
      addEventListener: () => {},
      // updateMarkerIcon handles a missing child; this counts the call, not the paint.
      querySelector: () => null,
      setAttribute: () => {},
      style: { setProperty: () => {}, removeProperty: () => {} },
    }) as unknown as HTMLButtonElement,
  createMarker: () =>
    ({
      remove: () => {},
      setLngLat: () => {},
      setOffset: () => {},
    }) as unknown as ReturnType<MarkerFactory["createMarker"]>,
};

const MAP = {} as Parameters<typeof rebuildMarkerPool>[1];

function meeting(i: number, status: "SCHEDULED" | "CONCLUDED" = "SCHEDULED"): Meeting {
  return {
    id: `m:${i}`,
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    bodyName: "Selectboard",
    title: "Regular Session",
    startsAt: "2026-09-08T23:00:00.000Z",
    timeZone: "America/New_York",
    status,
  } as unknown as Meeting;
}

function venue(i: number): Venue {
  return {
    key: `venue-${i}`,
    name: `Venue ${i}`,
    address: null,
    lat: 43 + i * 0.001,
    lng: -72 + i * 0.001,
    meetings: [meeting(i)],
  } as unknown as Venue;
}

const ALL = Array.from({ length: 500 }, (_, i) => venue(i));
const KEPT = ALL.slice(0, 480);

/** A pool holding all 500, all visible, counters zeroed. The "before" line. */
function pooledWithAll() {
  const pool = createMarkerPool();
  rebuildMarkerPool(pool, MAP, ALL, () => {}, FACTORY);
  applyVisibility(pool, new Set(ALL.map((v) => v.key)));
  resetPoolOps(pool);
  return pool;
}

test("P-001 · the before line: building the pool creates 500 and shows 500", () => {
  const pool = createMarkerPool();
  rebuildMarkerPool(pool, MAP, ALL, () => {}, FACTORY);
  assert.equal(pool.ops.created, 500);
  assert.equal(pool.ops.removed, 0);
  assert.equal(applyVisibility(pool, new Set(ALL.map((v) => v.key))), 500);
});

test("P-001 · a 500-to-480 filter creates and removes NOTHING", () => {
  const pool = pooledWithAll();

  // The pool sees every venue in the data; only the visible key set narrows.
  rebuildMarkerPool(pool, MAP, ALL, () => {}, FACTORY);
  applyVisibility(pool, new Set(KEPT.map((v) => v.key)));

  assert.equal(pool.ops.created, 0, "a filter change constructed markers");
  assert.equal(pool.ops.removed, 0, "a filter change destroyed markers — this is P-001");
  assert.equal(pool.entries.size, 500, "the pool must still hold every venue in the data");
});

test("P-001 · a 500-to-480 filter touches ~20 elements, the number the pool documents", () => {
  const pool = pooledWithAll();
  const touched = applyVisibility(pool, new Set(KEPT.map((v) => v.key)));

  assert.equal(touched, 20, `expected 20 visibility writes, got ${touched}`);
  assert.equal(pool.ops.visibilityWrites, 20);
  assert.equal(pool.ops.iconWrites, 0, "visibility must not rewrite any icon");
  assert.equal(pool.ops.positionWrites, 0, "visibility must not reposition anything");
});

test("P-001 · REVERSING the filter is another 20 writes, not 20 constructions", () => {
  const pool = pooledWithAll();
  applyVisibility(pool, new Set(KEPT.map((v) => v.key)));
  resetPoolOps(pool);

  assert.equal(applyVisibility(pool, new Set(ALL.map((v) => v.key))), 20);
  assert.equal(pool.ops.created, 0, "the twenty pins came back as NEW markers — P-001 exactly");
});

test("P-001 · THE OLD WIRING, kept as a measurement rather than an argument", () => {
  // Handing the pool the filtered venue list destroys and recreates markers instead.
  const pool = pooledWithAll();
  rebuildMarkerPool(pool, MAP, KEPT, () => {}, FACTORY);
  assert.equal(pool.ops.removed, 20, "the old wiring removed twenty markers");
  assert.equal(pool.entries.size, 480);

  resetPoolOps(pool);
  rebuildMarkerPool(pool, MAP, ALL, () => {}, FACTORY);
  assert.equal(pool.ops.created, 20, "and reversing the filter constructed twenty more");
});

test("P-001 · a REAL data change still creates and removes, which is the whole point", () => {
  const pool = pooledWithAll();
  rebuildMarkerPool(pool, MAP, [...ALL, venue(500), venue(501)], () => {}, FACTORY);
  assert.equal(pool.ops.created, 2);
  assert.equal(pool.ops.removed, 0);

  resetPoolOps(pool);
  rebuildMarkerPool(pool, MAP, ALL.slice(0, 499), () => {}, FACTORY);
  assert.equal(pool.ops.removed, 3, "the two new venues plus one genuinely gone");
});

test("P-004 · selecting one pin writes TWO elements, not five hundred", () => {
  const pool = pooledWithAll();

  assert.equal(applySelection(pool, "venue-7"), 1, "selecting from nothing is one write");
  assert.equal(applySelection(pool, "venue-9"), 2, "moving the selection is two");
  assert.equal(applySelection(pool, null), 1, "clearing it is one");
  assert.equal(pool.ops.selectionWrites, 4, "four writes across three selections");
});

test("P-004 · re-asserting the SAME selection writes nothing at all", () => {
  const pool = pooledWithAll();
  applySelection(pool, "venue-7");
  resetPoolOps(pool);

  assert.equal(applySelection(pool, "venue-7"), 0);
  assert.equal(pool.ops.selectionWrites, 0, "the canvas used to do this on every data change");
});

test("P-004 · the selected attribute lands on the right two elements", () => {
  const pool = pooledWithAll();
  applySelection(pool, "venue-7");
  assert.equal(pool.entries.get("venue-7")?.element.dataset.selected, "true");
  applySelection(pool, "venue-9");
  assert.equal(pool.entries.get("venue-7")?.element.dataset.selected, "false");
  assert.equal(pool.entries.get("venue-9")?.element.dataset.selected, "true");
});

test("P-004 · an unchanged venue is not rewritten, and a changed one is", () => {
  const pool = pooledWithAll();

  rebuildMarkerPool(pool, MAP, ALL, () => {}, FACTORY);
  assert.equal(pool.ops.iconWrites, 0, "nothing changed, so nothing may be written");
  assert.equal(pool.ops.positionWrites, 0);

  // One venue gains a meeting: its count, and therefore its badge, changes.
  const changed = ALL.map((v, i) =>
    i === 3 ? ({ ...v, meetings: [...v.meetings, meeting(9001)] } as Venue) : v,
  );
  resetPoolOps(pool);
  rebuildMarkerPool(pool, MAP, changed, () => {}, FACTORY);
  assert.equal(pool.ops.iconWrites, 1, "the one venue whose contents changed");
  assert.equal(pool.ops.positionWrites, 0, "and it did not move");
});

test("P-004 · a venue that MOVES is repositioned, and only that one", () => {
  const pool = pooledWithAll();
  const moved = ALL.map((v, i) => (i === 5 ? ({ ...v, lat: v.lat + 1 } as Venue) : v));
  rebuildMarkerPool(pool, MAP, moved, () => {}, FACTORY);
  assert.equal(pool.ops.positionWrites, 1);
  assert.equal(pool.ops.iconWrites, 0, "moving a pin does not change how it looks");
});

test("P-004 · the signature covers every input the icon pass reads", () => {
  // A signature that missed a field would skip a real change.
  const base = venue(1);
  const signatures = new Set([
    renderedSignature(base),
    renderedSignature({ ...base, meetings: [meeting(1, "CONCLUDED")] } as Venue),
    renderedSignature({ ...base, meetings: [meeting(1), meeting(2)] } as Venue),
    renderedSignature({ ...base, name: "Somewhere Else" } as Venue),
  ]);
  assert.equal(signatures.size, 4, "two distinguishable venues share a signature");
});

/**
 * The map must receive the unfiltered venue grouping and a separate key set, and the visibility effect must not
 * depend on the venue objects. Read from the components' source by shape.
 */
test("P-001 · map-entry hands the map ALL venues and the visible keys separately", () => {
  const entry = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "components", "map", "map-entry.tsx"),
    "utf8",
  );

  assert.match(
    entry,
    /const allVenues = useMemo<Venue\[\]>\(\s*\(\) => \(pinned \? groupByVenue\(pinned\.meetings, pinned\.listingIdentity, officeLocations\)/,
    "allVenues is no longer grouped from the UNFILTERED result",
  );
  assert.match(entry, /venues=\{allVenues\}/, "the map is being handed the filtered list again");
  assert.match(entry, /visibleVenueKeys=\{visibleVenueKeys\}/);
  assert.doesNotMatch(
    entry,
    /venues=\{venues\}/,
    "the filtered list is being passed as `venues` — that is P-001 returning",
  );
});

test("P-001 · the canvas rebuilds on DATA and applies visibility on KEYS, in separate effects", () => {
  const canvas = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "components", "map", "map-canvas.tsx"),
    "utf8",
  );

  const rebuildAt = canvas.indexOf("rebuildMarkerPool(poolRef.current");
  const visibilityAt = canvas.indexOf("applyVisibility(");
  assert.ok(rebuildAt > 0 && visibilityAt > 0, "one of the two calls is gone — this guard is stale");

  // They are in different effects: an effect boundary lies between them.
  const between = canvas.slice(rebuildAt, visibilityAt);
  assert.match(
    between,
    /\}, \[venues, presentationReady\]\);/,
    "rebuild and applyVisibility are in the SAME effect, so a filter change reaches the pool",
  );

  // And the visibility effect depends on the keys.
  assert.match(canvas, /\}, \[venues, visibleVenueKeys, presentationReady\]\);/);
  assert.match(canvas.slice(canvas.lastIndexOf("useEffect(() =>", rebuildAt), rebuildAt), /mapPresentationHeld\(map\)/, "pool creation must remain deferred during camera motion");

  // Selection does not re-run on every data change.
  assert.match(canvas, /\}, \[selectedVenueKey\]\);/);
  assert.doesNotMatch(
    canvas,
    /\}, \[selectedVenueKey, venues\]\);/,
    "selection re-runs on venues again — 500 writes per data change",
  );
});

/** `applyVisibility` writes only changed keys, so a marker created for an excluded venue must start hidden. */
test("P-001 · a marker created for a FILTERED-OUT venue is hidden, not visible", () => {
  const pool = createMarkerPool();
  rebuildMarkerPool(pool, MAP, ALL, () => {}, FACTORY);
  applyVisibility(pool, new Set(KEPT.map((v) => v.key)));

  const hidden = [...pool.entries.values()].filter(
    (e) => e.element.dataset.hidden === "true",
  ).length;
  const shown = [...pool.entries.values()].filter(
    (e) => e.element.dataset.hidden === "false",
  ).length;

  assert.equal(shown, 480, "the visible venues must read hidden=false");
  assert.equal(hidden, 20, "the filtered-out venues must read hidden=true, not unset");
  assert.equal(
    [...pool.entries.values()].filter((e) => e.element.dataset.hidden === undefined).length,
    0,
    "a marker with no data-hidden renders — that is the regression",
  );
});

test("P-001 · a venue that arrives ALREADY filtered out never flashes visible", () => {
  // The venue is created on a run where it is not visible; nothing later hides it.
  const pool = createMarkerPool();
  rebuildMarkerPool(pool, MAP, ALL, () => {}, FACTORY);
  assert.equal(
    pool.entries.get("venue-499")?.element.dataset.hidden,
    "true",
    "a freshly constructed marker must not be visible before visibility is applied",
  );
});
