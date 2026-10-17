import assert from "node:assert/strict";
import test from "node:test";
import { readZipChoice, resolveStoredZip } from "../hooks/use-stored-zip.ts";
import { recallCamera } from "../lib/map/camera-memory.ts";
import { GET } from "../app/api/location/zip/route.ts";
import { lookupZcta } from "../lib/geo/zcta.ts";

test("a link's ZIP overrides a tab's previous ZIP before the map resolves", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    GET(input instanceof Request ? input : new Request(new URL(input, "http://localhost"))));
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

test("a remembered address restores its ZIP across surfaces and a later ZIP choice still allows browsing", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { search: "" },
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    },
    addEventListener() {}, removeEventListener() {},
  } });
  try {
    const { writeSessionAddress, clearSessionAddress } = await import("../lib/geo/session-address.ts");
    writeSessionAddress({ zip: "85701", streetLabel: "123 W Congress St, Tucson AZ 85701", contestIds: [],
      divisionIds: ["ocd-division/country:us/state:az/cd:7"], splitLevels: [] });
    assert.equal(JSON.parse(readZipChoice()!).zip, "85701");
    items.set("wtp.approximate_location", JSON.stringify({ zip: "07866", savedAt: "2020-01-01T00:00:00Z" }));
    assert.equal(JSON.parse(readZipChoice()!).zip, "85701", "an address entered on the ballot supersedes an older map ZIP");
    items.set("wtp.approximate_location", JSON.stringify({ zip: "07866", savedAt: "2099-01-01T00:00:00Z" }));
    assert.equal(JSON.parse(readZipChoice()!).zip, "07866", "a later browsing choice keeps working without forgetting home");
    items.delete("wtp.approximate_location");
    clearSessionAddress();
    assert.equal(readZipChoice(), null);
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
    assert.deepEqual(JSON.parse(body), { location: lookupZcta(zip) });
    assert.ok(Buffer.byteLength(body) < 2000);
  }
  for (const query of ["", "?zip=8564", "?zip=85643&zip=85122", "?zip=85643&radius=150"]) {
    assert.equal((await GET(new Request(`http://localhost/api/location/zip${query}`))).status, 400);
  }
});
