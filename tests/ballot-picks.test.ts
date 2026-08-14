import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 4a (2026-08-17): save-my-picks is DEVICE-LOCAL ONLY. These tests hold the
 * property in source: the module writes exactly one localStorage key, never
 * talks to the network, and every pick surface states the privacy fact.
 * The schema half lives in tests/db-schema.test.ts ("pick" is a banned
 * column name).
 */

const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8");

test("the picks module never transmits — no fetch, no navigator.sendBeacon, no import of client APIs", () => {
  const source = read("lib", "ballot", "picks.ts");
  assert.ok(!/\bfetch\s*\(/.test(source), "picks.ts must not call fetch");
  assert.ok(!/sendBeacon/.test(source), "picks.ts must not beacon");
  assert.ok(
    !/submitReaction|\/api\//.test(source),
    "picks.ts must not touch any API path",
  );
  assert.ok(
    source.includes('PICKS_STORAGE_KEY = "wtp.ballot_picks"'),
    "the approved storage key is wtp.ballot_picks",
  );
});

test("every pick surface states the device-only fact", () => {
  for (const file of [
    ["components", "ballot", "pick-control.tsx"],
    ["components", "ballot", "my-picks.tsx"],
  ] as const) {
    const source = read(...file);
    assert.ok(
      /Saved on this device only/.test(source),
      `${file.join("/")} must carry the device-only sentence`,
    );
  }
  // The control must also distinguish itself from the collected reactions.
  const control = read("components", "ballot", "pick-control.tsx");
  assert.ok(
    /join anonymous local totals/.test(control),
    "the pick control must name the difference from reactions",
  );
});

test("the transparency page discloses picks as device-local", () => {
  const page = read("app", "transparency", "page.tsx").toLowerCase();
  assert.ok(
    page.includes("picks"),
    "the transparency page must mention ballot picks",
  );
});
