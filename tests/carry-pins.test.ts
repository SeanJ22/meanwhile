import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { carryPins } from "../lib/map/carry-pins.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const TUCSON = { id: "tucson-answer" };
const NEWBURY = { id: "newbury-answer" };

test("the answer in hand is what renders", () => {
  assert.equal(
    carryPins({
      current: TUCSON,
      held: { result: NEWBURY, forZip: "03255", stateOcdId: "AZ" },
      stateOcdId: "AZ",
      locationZip: "85701",
    }),
    TUCSON,
    "a live answer must always win over a held one",
  );
});

test("the last answer carries through the gap in the same area", () => {
  assert.equal(
    carryPins({
      current: null,
      held: { result: TUCSON, forZip: "85701", stateOcdId: "AZ" },
      stateOcdId: "AZ",
      locationZip: "85701",
    }),
    TUCSON,
    "a re-query in the same area must not empty the map while it is in flight",
  );
});

test("a held answer NEVER carries across a zip change", () => {
  assert.equal(
    carryPins({
      current: null,
      held: { result: TUCSON, forZip: "85701", stateOcdId: "AZ" },
      stateOcdId: "AZ",
      locationZip: "03255",
    }),
    null,
    "pins from the previous zip must clear the moment a new zip is entered",
  );
});

test("nothing is carried before a location resolves", () => {
  assert.equal(
    carryPins({ current: null, held: null, stateOcdId: null, locationZip: null }),
    null,
    "there is nothing to hold on a first load",
  );
  assert.equal(
    carryPins({
      current: null,
      held: { result: TUCSON, forZip: "85701", stateOcdId: "AZ" },
      stateOcdId: "AZ",
      locationZip: null,
    }),
    null,
    "a held answer with no location to compare against cannot be shown to belong here",
  );
});

test("a held answer with no zip of its own is not carried", () => {
  assert.equal(
    carryPins({
      current: null,
      held: { result: TUCSON, forZip: null, stateOcdId: "AZ" },
      stateOcdId: "AZ",
      locationZip: "85701",
    }),
    null,
  );
});

test("the map's pins are wired through the rule, not around it", () => {
  const entry = readFileSync(join(ROOT, "components", "map", "map-entry.tsx"), "utf8");

  assert.match(
    entry,
    /const pinned = carryPins\(/,
    "map-entry.tsx no longer derives its pins through carryPins",
  );
  assert.match(
    entry,
    /pinned\s*\?\s*applyFilters\(/,
    "the filtered meeting list no longer reads the carried answer — if it reads " +
      "`current` again, the map empties for the whole gap between a settle and its reply",
  );
});


test("a pan across a state line drops old pins even when the typed ZIP has not changed", () => {
  assert.equal(carryPins({ current: null, held: { result: TUCSON, forZip: "85701", stateOcdId: "AZ" },
    locationZip: "85701", stateOcdId: "NM" }), null);
  assert.equal(carryPins({ current: null, held: { result: TUCSON, forZip: "85701", stateOcdId: "AZ" },
    locationZip: "85701", stateOcdId: null }), null);
});
