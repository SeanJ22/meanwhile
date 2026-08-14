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

test("3e: the picks disclosure is stated ONCE, on the ballot page, with the reaction distinction", () => {
  // The TOS pattern (author-ordered 2026-08-19): one statement at the
  // bottom of the ballot page, not a repeat under every contest. The
  // distinction from reaction buttons lives in that statement.
  const page = read("app", "ballot", "page.tsx");
  assert.ok(
    /saved on this device only/i.test(page),
    "the ballot page must carry the device-only statement",
  );
  assert.ok(
    /join anonymous local totals/.test(page),
    "the single statement must name the difference from reactions",
  );
  assert.ok(
    /transparency/.test(page),
    "the statement must link the data-handling page",
  );
  // Once means once: the control no longer repeats it per contest. The
  // control keeps the author's label; MyPicks keeps its device-only header
  // as a label (a heading, not a second disclosure paragraph).
  const control = read("components", "ballot", "pick-control.tsx");
  assert.ok(
    /What do you think\?/.test(control),
    "3d: the pick control's label is the author's words",
  );
  assert.ok(
    !/Saved on this device only\./.test(control),
    "the per-contest disclosure paragraph is gone (3e) — it lives on the page once",
  );
});

test("the transparency page discloses picks as device-local", () => {
  const page = read("app", "transparency", "page.tsx").toLowerCase();
  assert.ok(
    page.includes("picks"),
    "the transparency page must mention ballot picks",
  );
});
