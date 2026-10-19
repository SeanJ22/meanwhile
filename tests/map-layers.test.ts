import assert from "node:assert/strict";
import test from "node:test";

import {
  applySelection,
  applyVisibility,
  createMarkerPool,
  reconcileKeys,
  updateMarkerIcon,
  type MarkerPool,
  type MarkerPoolEntry,
} from "../lib/map/marker-pool.ts";
import { initialZoomForZip } from "../lib/map/initial-zoom.ts";
import { withDistricts, NATIONAL_BOUNDARIES_SOURCE, boundarySource, BOUNDARY_ARCHIVE_FALLBACK, onSettledDistrictChange } from "../lib/map/districts.ts";
import { holdMapPresentation, releaseMapPresentation } from "../lib/map/flight-presentation.ts";
import type { Map as MapLibreMap } from "maplibre-gl";
import { CONUS_BOUNDS, FALLBACK_STYLE, METRO_ZOOM, resolveBasemap } from "../lib/map/style.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { Venue } from "../lib/meetings/venues.ts";

test("initial style requests boundary tiles without basemap or glyph readiness", () => {
  const style = withDistricts(FALLBACK_STYLE, ["county", "state-house"], "AZ");
  assert.deepEqual(style.sources[NATIONAL_BOUNDARIES_SOURCE], boundarySource());
  assert.deepEqual(style.layers.filter(layer => layer.id.startsWith("district-")).map(layer => layer.id), [
    "district-county-fill", "district-county-line", "district-state-house-fill", "district-state-house-line",
  ]);
  assert.ok(boundarySource(BOUNDARY_ARCHIVE_FALLBACK).url?.includes("/api/boundaries/"));
  assert.equal(withDistricts(FALLBACK_STYLE, [], "AZ"), FALLBACK_STYLE);
});

test("boundary counts coalesce by rendered frame and ignore basemap work", () => {
  type Listener = (event?: { sourceId?: string; sourceDataType?: string }) => void;
  const listeners = new Map<string, Set<Listener>>();
  let moving = false, calls = 0;
  const stub = {
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off(event: string, listener: Listener) { listeners.get(event)?.delete(listener); },
    once(event: string, listener: Listener) {
      const once: Listener = value => { stub.off(event, once); listener(value); };
      stub.on(event, once);
    },
    isMoving: () => moving,
    triggerRepaint() {},
  };
  const map = stub as unknown as MapLibreMap;
  const emit = (event: string, sourceId?: string, sourceDataType?: string) => {
    for (const listener of [...listeners.get(event) ?? []]) listener({ sourceId, sourceDataType });
  };
  const dispose = onSettledDistrictChange(map, () => calls++);
  emit("render"); emit("idle");
  assert.equal(calls, 1, "idle does not query the same frame again");
  emit("sourcedata", "basemap"); emit("render"); emit("idle");
  assert.equal(calls, 1, "basemap tiles do not recount boundaries");
  // VectorTileSource reports content for its TileJSON, before tiles arrive.
  emit("sourcedata", NATIONAL_BOUNDARIES_SOURCE, "content");
  emit("render"); emit("idle");
  assert.equal(calls, 2);
  // TileManager._tileLoaded emits sourcedata without sourceDataType.
  emit("sourcedata", NATIONAL_BOUNDARIES_SOURCE); emit("sourcedata", NATIONAL_BOUNDARIES_SOURCE);
  emit("render"); emit("idle");
  assert.equal(calls, 3, "one query for a batch of completed boundary tiles");
  moving = true; holdMapPresentation(map);
  emit("sourcedata", NATIONAL_BOUNDARIES_SOURCE); emit("render");
  moving = false; emit("moveend"); emit("render");
  assert.equal(calls, 3, "held software frames must not clear the count");
  releaseMapPresentation(map); emit("idle");
  assert.equal(calls, 4, "the revealed cached frame is counted once");
  dispose(); emit("sourcedata", NATIONAL_BOUNDARIES_SOURCE); emit("render"); emit("idle");
  assert.equal(calls, 4);
});

test("reconcile creates the new, updates the present, and removes only the absent", () => {
  const { create, update, remove } = reconcileKeys(["a", "b", "c"], ["b", "c", "d"]);
  assert.deepEqual(create, ["d"]);
  assert.deepEqual(update, ["b", "c"]);
  assert.deepEqual(remove, ["a"]);
});

test("an unchanged result set creates and removes nothing", () => {
  const { create, update, remove } = reconcileKeys(["a", "b"], ["a", "b"]);
  assert.deepEqual(create, []);
  assert.deepEqual(update, ["a", "b"]);
  assert.deepEqual(remove, []);
});

test("an empty result removes the pool rather than leaving it stranded", () => {
  const { create, update, remove } = reconcileKeys(["a", "b"], []);
  assert.deepEqual(create, []);
  assert.deepEqual(update, []);
  assert.deepEqual(remove, ["a", "b"]);
});

interface StubElement {
  dataset: Record<string, string>;
}

/** A pool of `n` entries, keyed `v0..v{n-1}`, with only what visibility reads. */
function stubPool(n: number): MarkerPool {
  const pool = createMarkerPool();
  for (let i = 0; i < n; i += 1) {
    const element: StubElement = { dataset: {} };
    pool.entries.set(`v${i}`, { element } as unknown as MarkerPoolEntry);
  }
  return pool;
}

const keys = (n: number, from = 0) =>
  new Set(Array.from({ length: n }, (_, i) => `v${i + from}`));

test("a filter that narrows 500 pins to 480 writes 20 elements, not 980", () => {
  const pool = stubPool(500);
  assert.equal(applyVisibility(pool, keys(500)), 500, "the first apply touches everything");
  assert.equal(applyVisibility(pool, keys(480)), 20);
});

test("re-applying the same visible set touches nothing at all", () => {
  const pool = stubPool(50);
  applyVisibility(pool, keys(50));
  assert.equal(applyVisibility(pool, keys(50)), 0);
});

test("widening back writes only the pins that came back", () => {
  const pool = stubPool(100);
  applyVisibility(pool, keys(100));
  applyVisibility(pool, keys(40));
  assert.equal(applyVisibility(pool, keys(100)), 60);
});

test("hidden and shown are written as data attributes, so CSS owns the toggle", () => {
  const pool = stubPool(3);
  applyVisibility(pool, new Set(["v0", "v2"]));
  const at = (k: string) => (pool.entries.get(k)!.element as unknown as StubElement).dataset;
  assert.equal(at("v0").hidden, "false");
  assert.equal(at("v2").hidden, "false");
  // v1 was never visible, so it was never written: no attribute, not a stale "false".
  assert.equal(at("v1").hidden, undefined);

  applyVisibility(pool, new Set(["v1"]));
  assert.equal(at("v0").hidden, "true");
  assert.equal(at("v1").hidden, "false");
});

test("a visible key with no pool entry is skipped rather than counted", () => {
  const pool = stubPool(2);
  assert.equal(applyVisibility(pool, new Set(["v0", "v1", "ghost"])), 2);
});

/** Selection is diffed: an unselected pin is never written, so its data-selected is absent rather than "false". */
test("selection is exclusive, and clearing it clears every pin", () => {
  const pool = stubPool(3);
  const at = (k: string) => (pool.entries.get(k)!.element as unknown as StubElement).dataset;
  const trueKeys = () => ["v0", "v1", "v2"].filter((k) => at(k).selected === "true");

  applySelection(pool, "v1");
  assert.deepEqual(trueKeys(), ["v1"], "exactly one pin may read selected");

  applySelection(pool, "v2");
  assert.deepEqual(trueKeys(), ["v2"], "moving the selection leaves exactly one");
  assert.equal(at("v1").selected, "false", "and the one it left is explicitly cleared");

  applySelection(pool, null);
  assert.deepEqual(trueKeys(), [], "clearing leaves none");
});

/** The narrowest element that `updateMarkerIcon` actually uses. */
function shimElement() {
  const styleProps = new Map<string, string>();
  const dot = {
    className: "wtp-pin-dot",
    style: { background: "" },
  };
  const badge = {
    className: "wtp-pin-count",
    textContent: "",
    hidden: false,
  };
  const attributes = new Map<string, string>();
  return {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (k: string, v: string) => styleProps.set(k, v),
      removeProperty: (k: string) => styleProps.delete(k),
    },
    querySelector: (selector: string) =>
      selector === ".wtp-pin-dot" ? dot : selector === ".wtp-pin-count" ? badge : null,
    setAttribute: (k: string, v: string) => attributes.set(k, v),
    // Test-only handles.
    _dot: dot,
    _badge: badge,
    _attr: attributes,
    _style: styleProps,
  };
}

function meetingAt(ocdId: string | null, bodyName: string, status = "SCHEDULED"): Meeting {
  return {
    id: `m-${bodyName}-${status}`,
    title: "Sitting",
    bodyName,
    jurisdiction: "Somewhere",
    ocdId,
    startsAt: "2026-09-01T18:00:00.000Z",
    endsAt: null,
    timeZone: "America/Phoenix",
    status,
    location: { name: "Room 1", address: null, lat: 32.2, lng: -110.9 },
    agendaUrl: null,
    provenance: {
      sourceUrl: null,
      sourceOrg: "test",
      collectedAt: "2026-08-17",
      verifiedAt: null,
    },
  } as Meeting;
}

function venueOf(meetings: Meeting[]): Venue {
  return { key: "v", name: "City Hall", address: null, lat: 32.2, lng: -110.9, meetings };
}

const AZ_CITY = "ocd-division/country:us/state:az/place:tucson";
const AZ_SCHOOL = "ocd-division/country:us/state:az/school_district:tucson_unified_district";

test("one level of government paints one colour and no gradient", () => {
  const el = shimElement();
  updateMarkerIcon(el as never, venueOf([meetingAt(AZ_CITY, "City Council")]));
  assert.equal(el.dataset.levels, "local");
  assert.equal(el._dot.style.background, "", "a single level must not draw a ring");
  assert.equal(el._style.get("--pin-color"), "var(--accent-local)");
});

test("two levels in one building draw an equal-slice ring, never one standing in for both", () => {
  const el = shimElement();
  updateMarkerIcon(
    el as never,
    venueOf([meetingAt(AZ_SCHOOL, "Governing Board"), meetingAt(AZ_CITY, "City Council")]),
  );
  assert.equal(el.dataset.levels, "school local");
  const background = el._dot.style.background;
  assert.match(background, /^conic-gradient\(/);
  assert.match(background, /0deg 180deg/);
  assert.match(background, /180deg 360deg/);
});

test("levels render in the committed order regardless of the order meetings arrive", () => {
  const el = shimElement();
  updateMarkerIcon(
    el as never,
    venueOf([meetingAt(AZ_CITY, "City Council"), meetingAt(AZ_SCHOOL, "Governing Board")]),
  );
  assert.equal(el.dataset.levels, "school local", "LEVEL_ORDER decides, not arrival order");
});

test("a concluded venue goes hollow and lets the stylesheet own its look", () => {
  const el = shimElement();
  updateMarkerIcon(el as never, venueOf([meetingAt(AZ_CITY, "City Council", "CONCLUDED")]));
  assert.equal(el.dataset.concluded, "true");
  assert.equal(el._dot.style.background, "");
  assert.equal(el._style.has("--pin-color"), false, "the inline colour must be cleared, not fought");
});

test("one meeting still scheduled keeps the venue live", () => {
  const el = shimElement();
  updateMarkerIcon(
    el as never,
    venueOf([
      meetingAt(AZ_CITY, "City Council", "CONCLUDED"),
      meetingAt(AZ_CITY, "Planning Commission"),
    ]),
  );
  assert.equal(el.dataset.concluded, "false");
});

test("an empty venue is not painted as a level it does not have", () => {
  const el = shimElement();
  updateMarkerIcon(el as never, venueOf([]));
  assert.equal(el.dataset.levels, "");
  assert.equal(el._dot.style.background, "");
  assert.equal(el._style.has("--pin-color"), false);
});

test("the badge counts only when there is something to count, and the label says it in words", () => {
  const one = shimElement();
  updateMarkerIcon(one as never, venueOf([meetingAt(AZ_CITY, "City Council")]));
  assert.equal(one._badge.textContent, "");
  assert.equal(one._badge.hidden, true);
  assert.equal(one._attr.get("aria-label"), "City Hall, 1 meeting");

  const three = shimElement();
  updateMarkerIcon(
    three as never,
    venueOf([
      meetingAt(AZ_CITY, "City Council"),
      meetingAt(AZ_CITY, "Planning Commission"),
      meetingAt(AZ_SCHOOL, "Governing Board"),
    ]),
  );
  assert.equal(three._badge.textContent, "3");
  assert.equal(three._badge.hidden, false);
  assert.equal(three._attr.get("aria-label"), "City Hall, 3 meetings");
});

test("every zip with a deliberate altitude keeps it", () => {
  assert.equal(initialZoomForZip("85701"), METRO_ZOOM);
  assert.equal(initialZoomForZip("85641"), 10.3);
  assert.equal(initialZoomForZip("07866"), 10.5);
  assert.equal(initialZoomForZip("03255"), 10);
});

test("a zip with no deliberate altitude gets the metro default, not zero", () => {
  // The `||` in initialZoomForZip makes a zoom of 0 fall through to the default.
  for (const zip of ["99999", "", null, undefined]) {
    assert.equal(initialZoomForZip(zip), METRO_ZOOM, `${JSON.stringify(zip)} lost its default`);
  }
  assert.ok(
    !Object.values({ "85701": METRO_ZOOM, "85641": 10.3, "07866": 10.5, "03255": 10 }).includes(0),
    "a zoom of 0 in the table would be swallowed by the default",
  );
});

test("the first-load bounds are the continental US, the right way round", () => {
  const [[west, south], [east, north]] = CONUS_BOUNDS;
  assert.ok(west < east, "west must be west of east");
  assert.ok(south < north, "south must be south of north");
  assert.ok(west > -180 && east < 0, "the continental US is in the western hemisphere");
  assert.ok(south > 0 && north < 90, "and the northern one");
});

function withEnv<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return run();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("no key means no basemap — never a silent substitute provider", () => {
  const choice = withEnv({ NEXT_PUBLIC_MAPTILER_KEY: undefined }, () => resolveBasemap("dark"));
  assert.equal(choice, null);
});

test("the basemap follows the theme, and each theme has its own default", () => {
  const [dark, light] = withEnv({ NEXT_PUBLIC_MAPTILER_KEY: "k-test" }, () =>
    withEnv({ NEXT_PUBLIC_MAPTILER_STYLE: undefined, NEXT_PUBLIC_MAPTILER_STYLE_LIGHT: undefined }, () => [
      resolveBasemap("dark"),
      resolveBasemap("light"),
    ]),
  );
  assert.equal(dark?.provider, "maptiler");
  assert.match(dark!.styleUrl, /\/maps\/basic-v2-dark\/style\.json\?key=k-test$/);
  assert.match(light!.styleUrl, /\/maps\/basic-v2\/style\.json\?key=k-test$/);
  assert.notEqual(dark!.styleUrl, light!.styleUrl, "one style for both themes is the defect");
});

test("dark is the default theme, so a caller that forgets does not get a light map", () => {
  const choice = withEnv({ NEXT_PUBLIC_MAPTILER_KEY: "k-test", NEXT_PUBLIC_MAPTILER_STYLE: undefined }, () =>
    resolveBasemap(),
  );
  assert.match(choice!.styleUrl, /basic-v2-dark/);
});

test("a configured style overrides the default, per theme", () => {
  const [dark, light] = withEnv(
    {
      NEXT_PUBLIC_MAPTILER_KEY: "k-test",
      NEXT_PUBLIC_MAPTILER_STYLE: "custom-dark",
      NEXT_PUBLIC_MAPTILER_STYLE_LIGHT: "custom-light",
    },
    () => [resolveBasemap("dark"), resolveBasemap("light")],
  );
  assert.match(dark!.styleUrl, /\/maps\/custom-dark\//);
  assert.match(light!.styleUrl, /\/maps\/custom-light\//);
});

test("the fallback style draws ground and nothing else, so the map still initialises", () => {
  assert.equal(FALLBACK_STYLE.version, 8);
  assert.deepEqual(FALLBACK_STYLE.sources, {}, "the fallback must request no tiles");
  assert.equal(FALLBACK_STYLE.layers.length, 1);
  assert.equal(FALLBACK_STYLE.layers[0].type, "background");
});
