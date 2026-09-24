import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DIVISION_READ_STALE_MS, lastReadByDivision, staleDivisionRead } from "../lib/meetings/freshness.ts";

/**
 * "Last checked" in the map footer is the newest read of ANY partition, so it
 * read "minutes ago" at 85701 while the Pima County Board's calendar had not
 * been read since September 8 (2026-09-24). Each division's own newest read is
 * now dated on the card when it is older than a day and a half.
 */

test("each division's newest calendar read comes from the rows on screen", () => {
  const PIMA = "ocd-division/country:us/state:az/county:pima";
  const TUCSON = "ocd-division/country:us/state:az/place:tucson";
  const reads = lastReadByDivision([
    { ocdId: PIMA, provenance: { collectedAt: "2026-09-08T21:40:43.908Z" } },
    { ocdId: PIMA, provenance: { collectedAt: "2026-09-08T21:40:32.432Z" } },
    { ocdId: TUCSON, provenance: { collectedAt: "2026-09-24T05:30:01.191Z" } },
    { ocdId: null, provenance: { collectedAt: "2026-09-24T05:30:01.191Z" } },
    { ocdId: TUCSON, provenance: { collectedAt: "not a date" } },
    { ocdId: TUCSON, provenance: null },
  ]);
  assert.deepEqual(reads, { [PIMA]: "2026-09-08T21:40:43.908Z", [TUCSON]: "2026-09-24T05:30:01.191Z" });
});

test("a read is dated only once it is older than a day and a half", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  assert.equal(staleDivisionRead("2026-09-08T21:40:43.908Z", now), "2026-09-08T21:40:43.908Z");
  assert.equal(staleDivisionRead(new Date(now - DIVISION_READ_STALE_MS + 60_000).toISOString(), now), null);
  assert.equal(staleDivisionRead(undefined, now), null);
});

test("the card dates an old read for divisions with listings on screen, never for one already named as failed", () => {
  const card = readFileSync("components/map/coverage-notice.tsx", "utf8");
  assert.match(card, /the listings shown for them were last read from their calendar on \$\{lastRead\}\./);
  assert.match(card, /!failedSourceOcdIds\.includes\(body\.ocdId\) &&\s*ocdIdsWithMeetings\.includes\(body\.ocdId\) &&\s*staleDivisionRead\(lastReadByOcdId\[body\.ocdId\]\) !== null/);
  const map = readFileSync("components/map/map-entry.tsx", "utf8");
  assert.match(map, /lastReadByOcdId=\{lastReadByDivision\(shown\.meetings \?\? \[\]\)\}/, "from the same rows the pins are drawn from");
});
