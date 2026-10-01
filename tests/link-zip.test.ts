import assert from "node:assert/strict";
import test from "node:test";
import { readZipChoice, resolveStoredZip } from "../hooks/use-stored-zip.ts";

test("a link's ZIP overrides a tab's previous ZIP before the map resolves", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const table: Record<string, [number, number]> = { "85635": [31.55, -110.30], "85701": [32.22, -110.97] };
  let search = "?zip=85635";
  let blocked = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { get search() { return search; } },
    sessionStorage: { getItem() {
      if (blocked) throw new Error("Storage disabled");
      return JSON.stringify({ zip: "85701", savedAt: "2026-09-29" });
    } },
  } });
  try {
    assert.equal(resolveStoredZip(table, readZipChoice())?.zip, "85635");
    blocked = true;
    assert.equal(resolveStoredZip(table, readZipChoice())?.zip, "85635");
    blocked = false;
    search = "";
    assert.equal(resolveStoredZip(table, readZipChoice())?.zip, "85701");
    for (const query of ["?zip=99999", "?zip=8563", "?zip="]) {
      search = query;
      assert.equal(resolveStoredZip(table, readZipChoice()), null, "an unusable link must not open a different place");
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
