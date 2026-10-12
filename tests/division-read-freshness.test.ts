import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DIVISION_READ_STALE_MS, lastReadByDivision, staleDivisionRead } from "../lib/meetings/freshness.ts";

/**
 * The footer's "Last checked" is the newest read of any partition, so each division's own newest read is dated on
 * the card when it is older than a day and a half.
 */

test("a division is dated by its upcoming listings' oldest read, or by its newest read when nothing is upcoming", () => {
  const PIMA = "ocd-division/country:us/state:az/county:pima";
  const TUCSON = "ocd-division/country:us/state:az/place:tucson";
  const now = Date.parse("2026-09-24T12:00:00Z");
  const reads = lastReadByDivision([
    // The API route's fresh read carries only past sittings; every upcoming sitting came from an older portal read.
    { ocdId: PIMA, startsAt: "2026-09-22T17:00:00-07:00", provenance: { collectedAt: "2026-09-24T11:14:30.415Z" } },
    { ocdId: PIMA, startsAt: "2026-10-13T17:00:00-07:00", provenance: { collectedAt: "2026-09-08T21:40:43.908Z" } },
    { ocdId: PIMA, startsAt: "2026-10-27T17:00:00-07:00", provenance: { collectedAt: "2026-09-08T21:40:32.432Z" } },
    { ocdId: TUCSON, startsAt: "2026-09-01T17:00:00-07:00", provenance: { collectedAt: "2026-09-24T05:30:01.191Z" } },
    { ocdId: null, startsAt: "2026-10-01T17:00:00-07:00", provenance: { collectedAt: "2026-09-24T05:30:01.191Z" } },
    { ocdId: TUCSON, startsAt: "2026-10-01T17:00:00-07:00", provenance: { collectedAt: "not a date" } },
    { ocdId: TUCSON, startsAt: "2026-10-02T17:00:00-07:00", provenance: null },
  ], now);
  assert.deepEqual(reads, {
    [PIMA]: { at: "2026-09-08T21:40:32.432Z", upcoming: true },
    [TUCSON]: { at: "2026-09-24T05:30:01.191Z", upcoming: false },
  });
});

test("a read is dated only once it is older than a day and a half", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const old = { at: "2026-09-08T21:40:43.908Z", upcoming: true };
  assert.deepEqual(staleDivisionRead(old, now), old);
  assert.equal(staleDivisionRead({ at: new Date(now - DIVISION_READ_STALE_MS + 60_000).toISOString(), upcoming: true }, now), null);
  assert.equal(staleDivisionRead(undefined, now), null);
});

test("the card dates an old read for divisions with listings on screen, never for one already named as failed", () => {
  const card = readFileSync("components/map/coverage-notice.tsx", "utf8");
  assert.match(card, /the \$\{read\.upcoming \? "upcoming " : ""\}listings shown for them were last read from their calendar on \$\{lastRead\}\./);
  assert.match(card, /!failedSourceOcdIds\.includes\(body\.ocdId\) &&\s*ocdIdsWithMeetings\.includes\(body\.ocdId\) &&\s*staleDivisionRead\(lastReadByOcdId\[body\.ocdId\]\) !== null/);
  const map = readFileSync("components/map/map-entry.tsx", "utf8");
  assert.match(map, /lastReadByOcdId=\{lastReadByDivision\(shown\.meetings \?\? \[\]\)\}/, "from the same rows the pins are drawn from");
});
