import assert from "node:assert/strict";
import { test } from "node:test";

import { hasConcluded, orderByUpcomingFirst } from "../lib/meetings/ordering.ts";

/** Upcoming first, then past: the two halves run in opposite orders on purpose, reading outward from now. */

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
  // A body sitting right now is still upcoming to a reader.
  const ordered = orderByUpcomingFirst(
    [at("2026-08-16T11:00:00Z"), at("2026-08-16T12:00:00Z")],
    NOW,
  );
  assert.equal(ordered[0].id, "2026-08-16T12:00:00Z");
  assert.equal(hasConcluded(at("2026-08-16T12:00:00Z"), NOW), false);
  assert.equal(hasConcluded(at("2026-08-16T11:00:00Z"), NOW), true);
});

test("an unparseable start time surfaces rather than sinking", () => {
  // An undatable row sorts with the upcoming block rather than being buried at the end of history.
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
  // The panel states a count above the list, so a reordering must not lose a row.
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
  // The caller holds the unsorted list for other views; sorting in place would leak.
  const input = [at("2026-08-20T12:00:00Z"), at("2026-01-01T00:00:00Z")];
  const before = input.map((m) => m.id);
  orderByUpcomingFirst(input, NOW);
  assert.deepEqual(input.map((m) => m.id), before);
});

import { groupMeetingsForReading, SOON_DAYS } from "../lib/meetings/ordering.ts";

const DAY = 24 * 60 * 60 * 1000;
const meetingAt = (offsetDays: number, status: "SCHEDULED" | "CONCLUDED" | "CANCELED" = "SCHEDULED") => ({
  id: `m${offsetDays}${status}`,
  startsAt: new Date(NOW + offsetDays * DAY).toISOString(),
  status,
});

test("F01 3.1: three groups, in the author's order, and nothing else", () => {
  const groups = groupMeetingsForReading(
    [meetingAt(70), meetingAt(-3, "CONCLUDED"), meetingAt(2), meetingAt(31), meetingAt(0), meetingAt(-40, "CONCLUDED")],
    NOW,
  );
  assert.deepEqual(
    groups.map((g) => g.id),
    ["soon", "later", "closed"],
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    [
      `Meetings in the next ${SOON_DAYS} days`,
      "Upcoming meetings after that",
      "Canceled or concluded",
    ],
  );
});

test("F01 3.1: every meeting lands in exactly one group — the partition holds", () => {
  // A grouping that silently drops a row is caught by asserting the count against the denominator.
  const input = [meetingAt(70), meetingAt(-3, "CONCLUDED"), meetingAt(2), meetingAt(31), meetingAt(0), meetingAt(-40, "CONCLUDED"), meetingAt(5, "CANCELED")];
  const groups = groupMeetingsForReading(input, NOW);
  const total = groups.reduce((n, g) => n + g.meetings.length, 0);
  assert.equal(total, input.length, "a meeting was dropped or duplicated");
  const ids = new Set(groups.flatMap((g) => g.meetings.map((m) => m.id)));
  assert.equal(ids.size, input.length);
});

test("F01 3.1: a canceled meeting is closed even when its date is still ahead", () => {
  // A meeting that will not happen is not something a reader can attend, whatever its date says.
  const groups = groupMeetingsForReading([meetingAt(5, "CANCELED"), meetingAt(5)], NOW);
  assert.deepEqual(groups.map((g) => g.id), ["soon", "closed"]);
  assert.equal(groups[1].meetings[0].status, "CANCELED");
});

test("F01 3.1: the 30-day boundary is inclusive and the day after is not", () => {
  const groups = groupMeetingsForReading([meetingAt(SOON_DAYS), meetingAt(SOON_DAYS + 1)], NOW);
  assert.deepEqual(groups.map((g) => g.id), ["soon", "later"]);
  assert.equal(groups[0].meetings.length, 1);
  assert.equal(groups[1].meetings.length, 1);
});

test("F01 3.1: an empty group never renders a header over nothing", () => {
  const groups = groupMeetingsForReading([meetingAt(2), meetingAt(3)], NOW);
  assert.deepEqual(groups.map((g) => g.id), ["soon"]);
  assert.equal(groupMeetingsForReading([], NOW).length, 0);
});

test("F01 3.1: soonest first inside the upcoming blocks, most recent first inside closed", () => {
  const groups = groupMeetingsForReading(
    [meetingAt(9), meetingAt(2), meetingAt(-2, "CONCLUDED"), meetingAt(-9, "CONCLUDED"), meetingAt(90), meetingAt(45)],
    NOW,
  );
  const days = (g: (typeof groups)[number]) =>
    g.meetings.map((m) => Math.round((Date.parse(m.startsAt) - NOW) / DAY));
  assert.deepEqual(days(groups[0]), [2, 9]);
  assert.deepEqual(days(groups[1]), [45, 90]);
  assert.deepEqual(days(groups[2]), [-2, -9]);
});
