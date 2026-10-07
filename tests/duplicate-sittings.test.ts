import assert from "node:assert/strict";
import test from "node:test";

import { collapseDuplicateSittings } from "../lib/sources/composite/index.ts";
import type { Meeting } from "../lib/sources/types.ts";

/**
 * One sitting, one row: the cross-source merge. A town's own calendar feed carries the dates and its existing routes
 * carry the agendas, so neither can be dropped and the merge must collapse the same sitting from both.
 */

function meeting(over: Partial<Meeting> & { id: string }): Meeting {
  return {
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    bodyName: "Selectboard",
    title: "Regular Meeting",
    startsAt: "2026-09-14T22:00:00.000Z",
    timeZone: "America/New_York",
    location: { name: "Newbury Town Office", address: null, lat: 43.32, lng: -72.04 },
    agendaUrl: null,
    jurisdiction: "Newbury, NH",
    status: "SCHEDULED",
    provenance: {
      sourceUrl: null,
      sourceOrg: "Town of Newbury",
      collectedAt: "2026-08-20T00:00:00.000Z",
      verifiedAt: null,
    },
    ...over,
  };
}

test("the same sitting from two sources becomes one row, and the agenda wins", () => {
  const withAgenda = meeting({
    id: "diligent:newbury:3370",
    agendaUrl: "https://newburynh.civicweb.net/Portal/MeetingInformation.aspx?Id=3370",
  });
  const dateOnly = meeting({ id: "ical:newbury-ical-governing:calendar.42961" });

  const { rows, collapsed } = collapseDuplicateSittings([dateOnly, withAgenda]);
  assert.equal(collapsed, 1);
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].id,
    withAgenda.id,
    "the row without the agenda won — a reader lost the agenda to a merge",
  );
});

test("the key is the INSTANT, not the string that spells it", () => {
  /*
   * The same moment written as `2026-06-16T19:00:00-04:00` and `2026-06-16T23:00:00.000Z` must collapse; a merge
   * keyed on the text would not.
   */
  const offset = meeting({
    id: "schedulepage:newbury-conservation:1",
    bodyName: "Conservation Commission",
    startsAt: "2026-06-16T19:00:00-04:00",
    agendaUrl: "https://www.newbury.nh.gov/conservation-commission/agenda/a-1",
  });
  const zulu = meeting({
    id: "ical:newbury-ical-conservation-commission:2",
    bodyName: "Conservation Commission",
    startsAt: "2026-06-16T23:00:00.000Z",
  });
  const { rows, collapsed } = collapseDuplicateSittings([offset, zulu]);
  assert.equal(collapsed, 1, "a timezone offset defeated the comparison again");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agendaUrl, offset.agendaUrl);
});

test("two sittings of one body from ONE source are left alone", () => {
  /*
   * A board publishing a Regular Session and an Executive Session at the same hour is publishing two meetings; the
   * merge is cross-source only.
   */
  const regular = meeting({ id: "legistar:newbury:1", title: "Regular Session" });
  const executive = meeting({ id: "legistar:newbury:2", title: "Executive Session" });
  const { rows, collapsed } = collapseDuplicateSittings([regular, executive]);
  assert.equal(collapsed, 0);
  assert.equal(rows.length, 2);
});

test("different bodies, different times and different places never collapse", () => {
  const rows = [
    meeting({ id: "ical:a:1", bodyName: "Selectboard" }),
    meeting({ id: "schedulepage:b:1", bodyName: "Planning Board" }),
    meeting({ id: "schedulepage:c:1", startsAt: "2026-09-15T22:00:00.000Z" }),
    meeting({
      id: "schedulepage:d:1",
      ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town",
      jurisdiction: "Wilmot, NH",
    }),
  ];
  const out = collapseDuplicateSittings(rows);
  assert.equal(out.collapsed, 0);
  assert.equal(out.rows.length, 4);
});

test("a division-less body keys on its jurisdiction, so two places cannot collide", () => {
  const here = meeting({ id: "ical:x:1", ocdId: null, jurisdiction: "Newbury, NH" });
  const there = meeting({ id: "schedulepage:y:1", ocdId: null, jurisdiction: "Wilmot, NH" });
  const same = meeting({ id: "schedulepage:z:1", ocdId: null, jurisdiction: "Newbury, NH" });
  const out = collapseDuplicateSittings([here, there, same]);
  assert.equal(out.collapsed, 1);
  assert.equal(out.rows.length, 2);
});

test("a fresh row beats a carried-forward one at the same instant", () => {
  const carried = meeting({
    id: "schedulepage:old:1",
    carried: { source: "schedulepage", lastFreshAt: "2026-08-01T00:00:00.000Z" },
  });
  const fresh = meeting({ id: "ical:new:1" });
  const out = collapseDuplicateSittings([carried, fresh]);
  assert.equal(out.collapsed, 1);
  assert.equal(out.rows[0].id, fresh.id);
});

test("the merge preserves order and never invents a row", () => {
  const rows = [
    meeting({ id: "ical:a:1", startsAt: "2026-09-01T22:00:00.000Z" }),
    meeting({ id: "ical:a:2", startsAt: "2026-09-02T22:00:00.000Z" }),
    meeting({ id: "diligent:b:1", startsAt: "2026-09-01T22:00:00.000Z", agendaUrl: "https://x/1" }),
    meeting({ id: "ical:a:3", startsAt: "2026-09-03T22:00:00.000Z" }),
  ];
  const out = collapseDuplicateSittings(rows);
  assert.equal(out.collapsed, 1);
  assert.deepEqual(
    out.rows.map((r) => r.startsAt),
    [
      "2026-09-01T22:00:00.000Z",
      "2026-09-02T22:00:00.000Z",
      "2026-09-03T22:00:00.000Z",
    ],
    "the surviving row took the loser's position rather than moving to the end",
  );
  assert.equal(out.rows[0].id, "diligent:b:1");
});
