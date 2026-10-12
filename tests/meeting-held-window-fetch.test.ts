import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MEETING_HELD_LOOKBACK_DAYS } from "../lib/meetings/constants.ts";
import { HELD_WINDOW_FETCH_SOURCES, meetingFetchedWindowFor } from "../lib/meetings/fetch-window.ts";

/** Every adapter that fetches the held window derives it from the held constants, never the shown ones. */

const ANCHOR = "2026-09-23T16:00:00.000Z";
const DAY = 86_400_000;

// Adapters that decide their own window; `apptegy` takes the query's dates (the shared fetch bounds).
const OWN_WINDOW = [...HELD_WINDOW_FETCH_SOURCES].filter((name) => name !== "apptegy");

test("DB-03 to DB-05: an adapter in the held-window set takes its window from the held constants", () => {
  for (const name of OWN_WINDOW) {
    const code = readFileSync(new URL(`../lib/sources/${name}/index.ts`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /MEETING_HELD_LOOKBACK_DAYS/, `${name} reads its back edge from the held window`);
    assert.match(code, /MEETING_HELD_HORIZON_DAYS/, `${name} reads its forward edge from the held window`);
    assert.doesNotMatch(code, /CONCLUDED_LOOKBACK_DAYS|UPCOMING_HORIZON_DAYS/, `${name} no longer clips at the shown window`);
  }
});

test("DB-03 to DB-05: a read's fetched window is the held 120 days for a held-window adapter and 90 for the rest", () => {
  const held = meetingFetchedWindowFor("legistar", ANCHOR)!;
  assert.equal(Date.parse(ANCHOR) - Date.parse(held.lowerBound), MEETING_HELD_LOOKBACK_DAYS * DAY);
  assert.equal(Date.parse(held.upperBound) - Date.parse(ANCHOR), 120 * DAY);
  for (const name of ["onbase", "civicplus", "revize", "clerksboards"]) {
    const shown = meetingFetchedWindowFor(name, ANCHOR)!;
    assert.equal(Date.parse(ANCHOR) - Date.parse(shown.lowerBound), 90 * DAY, name);
    assert.equal(Date.parse(shown.upperBound) - Date.parse(ANCHOR), 90 * DAY, name);
  }
  assert.equal(meetingFetchedWindowFor("legistar", "not a date"), null);
});
