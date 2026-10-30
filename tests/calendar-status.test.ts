import assert from "node:assert/strict";
import test from "node:test";
import { calendarStatus, doorIsDark, type CalendarDoor } from "../lib/meetings/calendar-status.ts";

const CITY = "ocd-division/country:us/state:tx/place:dallas";
const door = (over: Partial<CalendarDoor> & { doorId: string }): CalendarDoor => ({ kind: "legistar", ocdId: CITY, bodyIds: [`${CITY}#body:council`], status: "OPEN",
  lastSuccessAt: "2026-10-28T10:00:00.000Z", lastFailureAt: null, ...over });

test("a place was last checked when its latest calendar read worked, and a door whose latest read failed is dark", () => {
  const doors = [door({ doorId: "a", lastSuccessAt: "2026-10-27T10:00:00.000Z" }),
    door({ doorId: "b", kind: "legistar-insite", bodyIds: [`${CITY}#body:parks`], lastSuccessAt: "2026-10-26T10:00:00.000Z", lastFailureAt: "2026-10-29T10:00:00.000Z" })];
  const status = calendarStatus(doors, { bodyIds: [`${CITY}#body:council`, `${CITY}#body:parks`], divisionIds: [CITY] }, []);
  assert.equal(status.lastCheckedAt, "2026-10-27T10:00:00.000Z");
  assert.deepEqual(status.failed, [{ source: "legistar-insite", ocdIds: [CITY] }]);
  assert.equal(doorIsDark(doors[0]!), false);
  assert.equal(doorIsDark(doors[1]!), true);
  assert.equal(doorIsDark({ lastSuccessAt: null, lastFailureAt: "2026-10-29T10:00:00.000Z" }), true);
  assert.equal(doorIsDark({ lastSuccessAt: "2026-10-30T10:00:00.000Z", lastFailureAt: "2026-10-29T10:00:00.000Z" }), false);
});

test("a sitting is carried when every door that reads its body is dark, dated by the last read that worked", () => {
  const dark = door({ doorId: "dark", lastSuccessAt: "2026-10-20T10:00:00.000Z", lastFailureAt: "2026-10-29T10:00:00.000Z" });
  const sittings = [{ id: "legistar:dallas:1", bodyId: `${CITY}#body:council` }, { id: "ical:other:2", bodyId: `${CITY}#body:other` }];
  const status = calendarStatus([dark], { bodyIds: [`${CITY}#body:council`, `${CITY}#body:other`], divisionIds: [] }, sittings);
  assert.deepEqual([...status.carried], [["legistar:dallas:1", { source: "legistar", lastFreshAt: "2026-10-20T10:00:00.000Z", reason: "SOURCE_UNAVAILABLE" }]]);
  const second = door({ doorId: "ok", kind: "ical" });
  assert.equal(calendarStatus([dark, second], { bodyIds: [`${CITY}#body:council`], divisionIds: [] }, sittings.slice(0, 1)).carried.size, 0,
    "a second door that reads the body still works, so nothing is carried");
});

test("a place no calendar door serves has no last-checked time", () => {
  const status = calendarStatus([door({ doorId: "a" })], { bodyIds: ["elsewhere#body:x"], divisionIds: [] }, []);
  assert.deepEqual([status.lastCheckedAt, status.failed, status.carried.size], [null, [], 0]);
});
