import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { carryPins } from "../lib/map/carry-pins.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * R47 — the map does not empty itself while its next answer is in flight.
 *
 * The defect, measured rather than argued: sampling `__wtpPinCount()` every
 * 100 ms through a zoom-out at 85701 against production, the pool sat at ZERO
 * for 200–500 ms on 4 of 4 runs, every time an `/api/meetings` request was in
 * flight. `pnpm walk:all` had reported it 1 of 2 runs because it samples once
 * per zoom — the instrument was intermittent, not the defect.
 *
 * These pin the RULE. The rendered proof is the walk check and `pnpm
 * probe:r47`; what belongs in a unit suite is the decision about which stale
 * answer may be carried, because that is where the honest version and the
 * stale-data bug are one character apart.
 */

const TUCSON = { id: "tucson-answer" };
const NEWBURY = { id: "newbury-answer" };

test("R47: the answer in hand is what renders", () => {
  assert.equal(
    carryPins({
      current: TUCSON,
      held: { result: NEWBURY, forZip: "03255" },
      locationZip: "85701",
    }),
    TUCSON,
    "a live answer must always win over a held one",
  );
});

test("R47: the last answer carries through the gap in the same area", () => {
  /*
    The whole defect: `current` is null between a settle and its reply, and
    reading it directly emptied the map for 200-500ms on every zoom-out.
  */
  assert.equal(
    carryPins({
      current: null,
      held: { result: TUCSON, forZip: "85701" },
      locationZip: "85701",
    }),
    TUCSON,
    "a re-query in the same area must not empty the map while it is in flight",
  );
});

test("R47: a held answer NEVER carries across a zip change", () => {
  /*
    The narrow half, and the reason this is a function rather than a `??`.
    The who-governs card holds its last answer across anything; the pins may
    not. Holding one area's entities while another area loads is the
    stale-data bug map-entry.tsx names at `search()` — Tucson's pins under a
    New Hampshire zip. A fix that emptied the map less by lying about where
    the reader is would be worse than the defect.
  */
  assert.equal(
    carryPins({
      current: null,
      held: { result: TUCSON, forZip: "85701" },
      locationZip: "03255",
    }),
    null,
    "pins from the previous zip must clear the moment a new zip is entered",
  );
});

test("R47: nothing is carried before a location resolves", () => {
  assert.equal(
    carryPins({ current: null, held: null, locationZip: null }),
    null,
    "there is nothing to hold on a first load",
  );
  assert.equal(
    carryPins({
      current: null,
      held: { result: TUCSON, forZip: "85701" },
      locationZip: null,
    }),
    null,
    "a held answer with no location to compare against cannot be shown to belong here",
  );
});

test("R47: a held answer with no zip of its own is not carried", () => {
  /*
    `forZip` is null when the answer arrived before any zip resolved. It
    cannot be proven to describe the reader's area, and an unprovable match is
    not a match — the same standard the rest of the product holds a claim to.
  */
  assert.equal(
    carryPins({
      current: null,
      held: { result: TUCSON, forZip: null },
      locationZip: "85701",
    }),
    null,
  );
});

test("R47: the map's pins are wired through the rule, not around it", () => {
  /*
    A source scan, because the rule above is only worth anything if the
    component actually calls it. The specific rot this catches is the one that
    caused the defect: `meetings` deriving straight off `current`, which reads
    perfectly and empties the map for a third of a second every time.
  */
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
