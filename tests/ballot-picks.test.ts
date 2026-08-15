import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  PICK_JURISDICTION_LABELS,
  isForeignPick,
  jurisdictionKeyForContestId,
  pickJurisdictionLabel,
} from "../lib/ballot/pick-jurisdiction.ts";

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

/**
 * Item 5 (2026-08-14 second session): the picks card's hard constraints,
 * held in source. The card renders the reader's device-local picks ONLY
 * — no aggregates, no reactions, no totals, no commentary, no photos —
 * and transmits nothing.
 */
test("the picks card renders picks only and transmits nothing", () => {
  // Comments stripped: the docstring may NAME the constraints; the code
  // may not reference the banned surfaces.
  const source = read("components", "ballot", "picks-card.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/\bfetch\s*\(/.test(source), "the card must not call fetch");
  assert.ok(!/sendBeacon/.test(source), "the card must not beacon");
  assert.ok(!/\/api\//.test(source), "the card must not touch any API path");
  for (const banned of [
    "reaction",
    "aggregate",
    "funding",
    "photoUrl",
    "score",
    "recommend",
  ]) {
    assert.ok(
      !source.toLowerCase().includes(banned),
      `picks-card.tsx must not reference "${banned}" — the card is the reader's artifact, not the app's opinion`,
    );
  }
  assert.ok(
    source.includes("My picks — made with We the People"),
    "the card carries the app name and nothing evaluative",
  );
  assert.ok(
    /clearAllPicks/.test(source) && /Really clear/.test(source),
    "clear-my-picks confirms before clearing",
  );
});

test("the transparency page says the card is drawn on-device", () => {
  const page = read("app", "transparency", "page.tsx");
  assert.ok(
    /picks card/.test(page) && /drawn on your device/.test(page),
    "the card's device-side render is disclosed in the same commit that ships it",
  );
});

/* ------------------------------------------------------- 4c (2026-08-15) --- */

/**
 * A pick made on another ballot says which one.
 *
 * The author's report: view New Hampshire's ballot with Arizona picks stored
 * and the Arizona picks list unlabelled. Keeping them is right — a pick is
 * the reader's private note and deleting it for looking at another state
 * would lose deliberate work — so the missing thing was the sign, not the
 * behaviour. The jurisdiction comes off the contest id, which every pick
 * already carries, so picks saved before this shipped are labelled too.
 */

test("4c: a pick from another ballot is labelled, and only then", () => {
  const az = "ballot-az-pima:governor";
  const nh = "ballot-nh-merrimack:governor";

  assert.equal(jurisdictionKeyForContestId(az), "az-pima");
  assert.equal(jurisdictionKeyForContestId(nh), "nh-merrimack");
  assert.equal(jurisdictionKeyForContestId("not-a-ballot-id"), null);

  // Viewing New Hampshire: the Arizona pick is foreign, the local one is not.
  assert.equal(isForeignPick(az, "nh-merrimack"), true);
  assert.equal(isForeignPick(nh, "nh-merrimack"), false);

  // No ballot resolved: nothing to differ from, so nothing is labelled.
  // Labelling every row there would be noise rather than a sign.
  assert.equal(isForeignPick(az, null), false);

  assert.equal(pickJurisdictionLabel(az), "Pima County, Arizona");
  assert.equal(pickJurisdictionLabel(nh), "Merrimack County, New Hampshire");
});

test("4c: every shipped ballot's contests have a reader-facing label", () => {
  // The plain-language rule at full strength: `az-pima` is an internal key
  // and may never render. A key with no label renders NOTHING, which is safe
  // and also silent — so the denominator is checked here instead, against
  // the ballot data that actually ships.
  const dir = join(process.cwd(), "data", "ballot");
  const keys = new Set<string>();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const file = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
      contests?: { id?: string }[];
    };
    for (const contest of file.contests ?? []) {
      const key = contest.id ? jurisdictionKeyForContestId(contest.id) : null;
      if (key) keys.add(key);
    }
  }

  assert.ok(keys.size >= 3, `only ${keys.size} ballot jurisdictions found in data/ballot`);
  for (const key of keys) {
    assert.ok(
      PICK_JURISDICTION_LABELS[key],
      `${key} ships contests but has no reader-facing label — its picks would render bare`,
    );
  }
});

test("4c: the label never leaks an internal key to a reader", () => {
  for (const label of Object.values(PICK_JURISDICTION_LABELS)) {
    assert.ok(!/ocd-division|[a-z]{2}-[a-z]+:/.test(label), `"${label}" carries an identifier`);
    assert.match(label, /^[A-Z]/, `"${label}" does not read like a place name`);
  }

  // And the component only renders a label it has, never the key.
  const source = read("components", "ballot", "my-picks.tsx");
  assert.ok(
    !/jurisdictionKeyForContestId/.test(source),
    "my-picks reaches for the raw key; it must render only the label map's output",
  );
});
