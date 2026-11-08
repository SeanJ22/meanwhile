import assert from "node:assert/strict";
import test from "node:test";
import { fetchFile, loadStateIndex, MAX_VIEW_FILES, MIN_PIN_ZOOM, pinsOfPlaceFile, placeById, placesForView, type StateIndex } from "../lib/map/place-index-client.ts";

const BASE = "ocd-division/country:us/state:mt";
const row = (id: string, kind: 0 | 1, name: string, file: string, box: [number, number, number, number]) =>
  [id, kind, name, -1, file, (box[1] + box[3]) / 2, (box[0] + box[2]) / 2, ...box] as const;
const view = { west: -112.6, south: 45.9, east: -112.4, north: 46.1 };
const indexOf = (rows: ReturnType<typeof row>[]): StateIndex => ({ state: "MT", places: rows.map(r => ({ id: r[0].startsWith("/") ? BASE + r[0] : r[0], kind: r[1] ? "body" : "place", name: r[2], file: r[4], box: [r[7], r[8], r[9], r[10]] as never })) });

test("a view draws place files only at the pin zoom and only for places that are in it and no bigger than it", () => {
  const index = indexOf([row("/county:silver-bow", 0, "Silver Bow", "a".repeat(32), [-113, 45.5, -112, 46.5]), row("/place:butte", 0, "Butte", "b".repeat(32), [-112.58, 45.95, -112.45, 46.05]),
    row("/place:elsewhere", 0, "Elsewhere", "c".repeat(32), [-100, 40, -99.9, 40.1]), row("/state:mt", 0, "Montana", "d".repeat(32), [-116, 44, -104, 49])]);
  assert.deepEqual(placesForView([index], view, MIN_PIN_ZOOM - 0.1), { draw: false }, "a state-wide view fetches no place file");
  const choice = placesForView([index], view, MIN_PIN_ZOOM);
  assert.ok(choice.draw);
  assert.deepEqual(choice.places.map(place => place.name), ["Butte"], "a county or state around the view is left to its card; a place elsewhere is not in view");
});

test("a view with more than the cap of places draws none and asks the reader to zoom in", () => {
  const many = Array.from({ length: MAX_VIEW_FILES + 1 }, (_, n) => row(`/place:p${n}`, 0, `P${n}`, n.toString(16).padStart(32, "0"), [-112.55, 45.95, -112.5, 46]));
  assert.deepEqual(placesForView([indexOf(many)], view, 14), { draw: false });
  const capped = placesForView([indexOf(many.slice(0, MAX_VIEW_FILES))], view, 14);
  assert.ok(capped.draw && capped.places.length === MAX_VIEW_FILES);
});

test("a place is found by its id for a tap", () => {
  const index = indexOf([row("/place:butte", 0, "Butte", "b".repeat(32), [-112.58, 45.95, -112.45, 46.05])]);
  assert.equal(placeById([index], `${BASE}/place:butte`)!.name, "Butte");
  assert.equal(placeById([index], `${BASE}/place:none`), null);
});

test("a state's index is read through its pointer once, and a file by its name once", async t => {
  const urls: string[] = [];
  const file = { v: 1, state: "MT", base: BASE, places: [row("/place:butte", 0, "Butte", "b".repeat(32), [-112.58, 45.95, -112.45, 46.05]), [ "/place:nobox", 0, "No box", -1, "e".repeat(32), null, null, null, null, null, null ]] };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input); urls.push(url);
    return url === "/api/reader/index/MT.json" ? Response.json({ index: "i".repeat(32), national: "n".repeat(32) })
      : url === `/api/reader/files/${"i".repeat(32)}.json` ? Response.json(file) : new Response(null, { status: 404 });
  });
  const [a, b] = await Promise.all([loadStateIndex("MT"), loadStateIndex("MT")]);
  assert.equal(a, b);
  assert.deepEqual(a!.places.map(place => place.id), [`${BASE}/place:butte`], "a place with no box cannot be put on the map");
  assert.deepEqual(urls, ["/api/reader/index/MT.json", `/api/reader/files/${"i".repeat(32)}.json`]);
  assert.equal(await loadStateIndex("ZZ"), null);
  await fetchFile("x".repeat(32)); await fetchFile("x".repeat(32));
  assert.equal(urls.filter(url => url.includes("x".repeat(32))).length, 2, "a missing file is not remembered");
});

test("a place file's meetings come back with only the pin fields, or whole for an opened place", () => {
  const meeting = { id: "m1", ocdId: "x", bodyId: "b1", bodyName: "Council", title: "Regular", startsAt: "2026-11-10T18:00:00-07:00", timeZone: "America/Denver", status: "SCHEDULED",
    mapPin: { lat: 46, lng: -112.5 }, provenance: { sourceUrl: "u" }, fieldSources: { location: {} }, agendaUrl: "https://example.gov/a.pdf" };
  const inline = { variants: { current: { row: { meeting_rows: [{ payload: { meetings: [meeting, { nothing: true }] } }] } } } };
  const [light] = pinsOfPlaceFile(inline);
  assert.equal(light!.id, "m1"); assert.deepEqual(light!.mapPin, meeting.mapPin);
  assert.equal(light!.provenance, undefined); assert.equal(light!.fieldSources, undefined); assert.equal(light!.agendaUrl, undefined);
  assert.equal(pinsOfPlaceFile(inline, true)[0]!.agendaUrl, "https://example.gov/a.pdf");
  assert.equal(pinsOfPlaceFile({ pins: [meeting] })[0]!.id, "m1");
  assert.deepEqual(pinsOfPlaceFile({ variants: { current: { row: { meeting_rows: [{ payload: { meetings: { $civicPayloadPart: "h" } } }] } } } }), []);
  assert.deepEqual(pinsOfPlaceFile(null), []);
});
