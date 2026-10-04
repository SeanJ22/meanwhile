import assert from "node:assert/strict";
import test from "node:test";

import { crosswalkParity } from "../lib/civic-data/crosswalk-parity.ts";
import type { MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";

const row = (bodyId: string, route: string, extra: Partial<MeetingBodyCrosswalkRow> = {}): MeetingBodyCrosswalkRow => ({
  id: `${bodyId}|ICAL|${route}`, jurisdictionId: "j", ocdId: "ocd-division/country:us/state:nh", bodyId, bodyRole: "BOARD", bodyName: "Board",
  kind: "ICAL", route, officialHost: "town.gov", filter: {}, publishingOrg: "Town", timeZone: "America/New_York",
  evidence: { bodyPage: { url: "https://town.gov/b", sha256: "a".repeat(64), quote: "q" }, calendar: { url: route, sha256: "b".repeat(64), selected: 1, total: 2 }, readAt: "2026-10-01T00:00:00.000Z" },
  status: "ACTIVE", reviewedBy: "x", reviewedAt: "2026-10-01T00:00:00.000Z", authorization: "C16" as never, ...extra,
});

test("DB-24: parity names what the automatic crosswalk covers, what only the manual one holds, and what a withdrawal still stops", () => {
  const manual = [row("a", "https://town.gov/a.ics"), row("b", "https://town.gov/b.ics"), row("c", "https://town.gov/c.ics", { status: "WITHDRAWN" }), row("d", "https://town.gov/d.ics")];
  const derived = [row("a", "https://town.gov/a.ics"), row("d", "https://town.gov/d.ics", { filter: { category: "Boards" } }), row("e", "https://town.gov/e.ics")];
  const parity = crosswalkParity(manual, derived);
  assert.equal(parity.manualRows, 4);
  assert.equal(parity.derivedRows, 3);
  assert.equal(parity.covered.length, 2);
  assert.equal(parity.onlyManualActive.length, 1);
  assert.match(parity.onlyManualActive[0]!, /^b\|/);
  assert.equal(parity.manualWithdrawn.length, 1);
  assert.deepEqual(parity.differs.map(({ fields }) => fields), [["filter"]], "a covered connection whose settings differ would change the wiring");
});

test("DB-24: nothing manual means nothing is lost", () => {
  const parity = crosswalkParity([], [row("a", "https://town.gov/a.ics")]);
  assert.deepEqual([parity.covered, parity.onlyManualActive, parity.manualWithdrawn, parity.differs], [[], [], [], []]);
});
