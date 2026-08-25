import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatDateMDY,
  locationLine,
  meetingHeadline,
} from "../lib/map/format.ts";
import type { Meeting } from "../lib/sources/types.ts";

/**
 * 3a (2026-08-16): the what-first headline and the address-once rule. The
 * author's Vail card is the pinned case — a source that titles the sitting
 * "Governing Board Meeting" with no body name and publishes the address AS
 * the venue name must render "Vail Unified School District — Governing Board
 * Meeting" over one address line, never the venue twice.
 */

function meetingWith(fields: Partial<Meeting>): Meeting {
  return {
    id: "test:1",
    ocdId: null,
    bodyName: "Governing Board Meeting",
    title: "Governing Board Meeting",
    startsAt: "2026-08-20T00:00:00.000Z",
    timeZone: "America/Phoenix",
    location: { name: "x", address: "x", lat: 0, lng: 0 },
    agendaUrl: null,
    jurisdiction: "Vail Unified School District",
    status: "SCHEDULED",
    provenance: {
      sourceUrl: null,
      sourceOrg: "test",
      collectedAt: "2026-08-16",
      verifiedAt: null,
    },
    ...fields,
  } as Meeting;
}

test("a sitting title with no body name gets the jurisdiction in front", () => {
  assert.equal(
    meetingHeadline(meetingWith({})),
    "Vail Unified School District — Governing Board Meeting",
  );
});

test("a body name already carrying the jurisdiction stands alone", () => {
  assert.equal(
    meetingHeadline(
      meetingWith({
        bodyName: "Pima County Board of Supervisors",
        jurisdiction: "Pima County",
      }),
    ),
    "Pima County Board of Supervisors",
  );
});

test("the address renders once when the source publishes it as the venue name", () => {
  const addr = "Calvin Baker Leadership Center 13801 E Benson Hwy, Vail, AZ 85641";
  assert.equal(locationLine(addr, addr), addr);
  assert.equal(locationLine("City Hall", "City Hall, 255 W Alameda"), "City Hall, 255 W Alameda");
  assert.equal(locationLine("Hearing Room A", "33 N Stone Ave"), "Hearing Room A · 33 N Stone Ave");
});

/*
 * **BC-12 (2026-08-24) — the convention moved, and the guard moves with it.**
 *
 * The author: dates spell out everywhere, "in seat until January 3rd, 2029,"
 * never "01-03-2029." This asserted the mm/dd/yyyy form that 3h established on
 * 2026-08-16. Kept in place rather than deleted, because the RANGE half is the
 * part worth guarding either way: several callers hand in annotated strings,
 * and a formatter that only accepted a bare date would return them unconverted
 * without erroring.
 */
test("BC-12: dates spell out, including inside ranges", () => {
  assert.equal(formatDateMDY("2026-11-03"), "November 3rd, 2026");
  assert.equal(
    formatDateMDY("2026-10-24 – 2026-11-01"),
    "October 24th, 2026 – November 1st, 2026",
  );
});
