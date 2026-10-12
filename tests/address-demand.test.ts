import assert from "node:assert/strict";
import test from "node:test";
import { logAddressEntered } from "../lib/log/address-events.ts";
import { logEvent } from "../lib/log/client.ts";
import { prepareSearchLogEvent } from "../lib/db/search-log.ts";
import { askKeyHash } from "../lib/db/ask-signal.ts";

test("an address entry sends only its ZIP, full district set, page and Ask continuity key", async () => {
  const descriptors = new Map(["window", "navigator"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const key = "1234567890abcdef1234567890abcdef";
  let sent: Blob | undefined;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => key } } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    sendBeacon: (url: string, payload: Blob) => { assert.equal(url, "/api/log"); sent = payload; return true; },
  } });
  try {
    const address = { zip: "85701", divisionIds: ["ocd-division/country:us/state:az/cd:7", "ocd-division/country:us/state:az/county:pima"],
      streetLabel: "412 elm st phoenix", lat: 32.2217, lng: -110.9265 };
    logAddressEntered(address, "ASK");
    assert.ok(sent);
    const wire = JSON.parse(await sent.text());
    assert.deepEqual(wire, { eventType: "ADDRESS_ENTERED" as const, ocdIds: address.divisionIds,
      detail: { page: "ASK" }, approximateLocation: "85701", continuityKey: key });
    const row = prepareSearchLogEvent(wire);
    assert.equal(row.continuityHash, askKeyHash(key));
    assert.equal(JSON.stringify(row).includes(address.streetLabel), false);
    assert.equal(JSON.stringify(row).includes(String(address.lat)), false);
    assert.equal(JSON.stringify(row).includes(String(address.lng)), false);
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("a browser that refuses to queue a beacon still sends the event by fetch", () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalFetch = globalThis.fetch;
  let body = "";
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: () => false } });
  globalThis.fetch = async (_input, init) => {
    body = String(init?.body);
    return new Response(null, { status: 204 });
  };
  try {
    logEvent("ADDRESS_ENTERED", [], { page: "MAP" }, "85701", "1234567890abcdef");
    assert.equal(JSON.parse(body).eventType, "ADDRESS_ENTERED");
    assert.equal(JSON.parse(body).approximateLocation, "85701");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
