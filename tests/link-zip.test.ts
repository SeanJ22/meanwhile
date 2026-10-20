import assert from "node:assert/strict";
import test from "node:test";
import { readZipChoice, resolveStoredZip } from "../hooks/use-stored-zip.ts";
import { recallCamera } from "../lib/map/camera-memory.ts";
import { GET } from "../app/api/location/zip/route.ts";
import { lookupZcta, resolveZip } from "../lib/geo/zcta.ts";

test("a link's ZIP overrides a tab's previous ZIP before the map resolves", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const prefix=/\/(\d{2})\.json$/.exec(new URL(input instanceof Request?input.url:input,"http://localhost").pathname)?.[1];
    assert.ok(prefix);
    return Response.json({locations:Object.fromEntries(["85635","85701"].filter(zip=>zip.startsWith(prefix)).map(zip=>[zip,lookupZcta(zip)]))});
  });
  let search = "?zip=85635";
  let blocked = false;
  // The remembered ZIP is kept between visits (localStorage); the map camera stays per-tab.
  const storage = { getItem(key: string) {
    if (blocked) throw new Error("Storage disabled");
    if (key === "wtp:map-camera") return JSON.stringify({ lat: 43.32, lng: -72.03, zoom: 10 });
    return JSON.stringify({ zip: "85701", savedAt: "2026-09-29" });
  } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { get search() { return search; } },
    sessionStorage: storage,
    localStorage: storage,
  } });
  try {
    assert.equal((await resolveStoredZip(readZipChoice()))?.zip, "85635");
    assert.equal(recallCamera(), null, "the linked place takes priority over the remembered map");
    blocked = true;
    assert.equal((await resolveStoredZip(readZipChoice()))?.zip, "85635");
    blocked = false;
    search = "";
    assert.equal((await resolveStoredZip(readZipChoice()))?.zip, "85701");
    assert.deepEqual(recallCamera(), { lat: 43.32, lng: -72.03, zoom: 10 }, "ordinary returns retain camera memory");
    for (const query of ["?zip=99999", "?zip=8563", "?zip="]) {
      search = query;
      assert.equal(await resolveStoredZip(readZipChoice()), null, "an unusable link must not open a different place");
      assert.equal(recallCamera(), null);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("ZIP startup returns one source-resolved place, including postal ZIPs, without returning the national table", async () => {
  for (const zip of ["85643", "85122", "85701", "85670", "99999"]) {
    const response = await GET(new Request(`http://localhost/api/location/zip?zip=${zip}`));
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { location: lookupZcta(zip), resolution: resolveZip(zip) });
    assert.ok(Buffer.byteLength(body) < 2000);
  }
  for (const query of ["", "?zip=8564", "?zip=85643&zip=85122", "?zip=85643&radius=150"]) {
    assert.equal((await GET(new Request(`http://localhost/api/location/zip${query}`))).status, 400);
  }
});
