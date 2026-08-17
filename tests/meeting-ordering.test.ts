import assert from "node:assert/strict";
import { test } from "node:test";

import { hasConcluded, orderByUpcomingFirst } from "../lib/meetings/ordering.ts";

/**
 * Upcoming first, then past (g4 item 11).
 *
 * The rule reads outward from NOW in both directions, and the two halves run
 * in opposite orders on purpose — which is exactly the sort of thing that
 * gets "simplified" back into a plain ascending sort by someone who has not
 * seen the panel with ninety days of history in it.
 */

const NOW = Date.parse("2026-08-16T12:00:00Z");

const at = (iso: string) => ({ id: iso, startsAt: iso });

test("everything upcoming comes before everything past", () => {
  const ordered = orderByUpcomingFirst(
    [
      at("2026-08-10T12:00:00Z"),
      at("2026-08-20T12:00:00Z"),
      at("2026-06-01T12:00:00Z"),
      at("2026-08-17T12:00:00Z"),
    ],
    NOW,
  );
  assert.deepEqual(ordered.map((m) => m.id), [
    // soonest upcoming first…
    "2026-08-17T12:00:00Z",
    "2026-08-20T12:00:00Z",
    // …then the most recent past, working backwards.
    "2026-08-10T12:00:00Z",
    "2026-06-01T12:00:00Z",
  ]);
});

test("a meeting starting exactly now is UPCOMING", () => {
  // A body sitting right now is something a reader can still walk into, and
  // filing it under history would be telling them they had missed it.
  const ordered = orderByUpcomingFirst(
    [at("2026-08-16T11:00:00Z"), at("2026-08-16T12:00:00Z")],
    NOW,
  );
  assert.equal(ordered[0].id, "2026-08-16T12:00:00Z");
  assert.equal(hasConcluded(at("2026-08-16T12:00:00Z"), NOW), false);
  assert.equal(hasConcluded(at("2026-08-16T11:00:00Z"), NOW), true);
});

test("an unparseable start time surfaces rather than sinking", () => {
  /*
   * A row we cannot date is a row we should be shown, not one to bury at the
   * end of three months of history where nobody will ever find it. It sorts
   * with the upcoming block deliberately — the empty-success rule applied to
   * a single row.
   */
  const ordered = orderByUpcomingFirst(
    [at("2026-06-01T12:00:00Z"), at("not a date"), at("2026-08-20T12:00:00Z")],
    NOW,
  );
  assert.ok(
    ordered.findIndex((m) => m.id === "not a date") <
      ordered.findIndex((m) => m.id === "2026-06-01T12:00:00Z"),
    "an undated row sank below the past block",
  );
  assert.equal(hasConcluded(at("not a date"), NOW), false);
});

test("ordering never drops or duplicates a row", () => {
  // The panel states a count above the list, so a reordering that loses one
  // breaks "stated N equals rendered rows" without changing any number.
  const input = [
    at("2026-08-20T12:00:00Z"),
    at("2026-08-10T12:00:00Z"),
    at("2026-08-16T12:00:00Z"),
    at("2026-01-01T00:00:00Z"),
  ];
  const ordered = orderByUpcomingFirst(input, NOW);
  assert.equal(ordered.length, input.length);
  assert.deepEqual(
    new Set(ordered.map((m) => m.id)),
    new Set(input.map((m) => m.id)),
  );
});

test("the input array is not mutated", () => {
  // The caller holds the unsorted list for other views; sorting in place is
  // how one surface's ordering silently becomes another's.
  const input = [at("2026-08-20T12:00:00Z"), at("2026-01-01T00:00:00Z")];
  const before = input.map((m) => m.id);
  orderByUpcomingFirst(input, NOW);
  assert.deepEqual(input.map((m) => m.id), before);
});
