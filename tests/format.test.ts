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

test("dates render mm/dd/yyyy, including inside ranges", () => {
  assert.equal(formatDateMDY("2026-11-03"), "11/03/2026");
  assert.equal(
    formatDateMDY("2026-10-24 – 2026-11-01"),
    "10/24/2026 – 11/01/2026",
  );
});
