import assert from "node:assert/strict";
import test from "node:test";
import { easternMonth, isPeriod, periodDays, periodGroups, periodLabel } from "../lib/control-plane/admin-view/periods.ts";

const ids = (now: string, earliest: string | null) => periodGroups(new Date(now), earliest).map((g) => [g.label, g.options.map((o) => o.id)]);

test("the picker offers Today, Last 7 days, Last 30 days, then this month, from the clock", () => {
  const groups = periodGroups(new Date("2026-10-01T22:00:00Z"), null);
  assert.deepEqual(groups.map((g) => g.options.map((o) => o.label)), [["Today", "Last 7 days", "Last 30 days"], ["This month (October 2026)"]]);
});

test("earlier months follow newest first, back to the oldest month that holds anything", () => {
  const groups = periodGroups(new Date("2026-10-01T22:00:00Z"), "2026-08");
  assert.deepEqual(groups[1].options.map((o) => [o.id, o.label]), [["2026-10", "This month (October 2026)"], ["2026-09", "September 2026"], ["2026-08", "August 2026"]]);
});

test("a new month appears by itself the moment it starts in Eastern time, never before", () => {
  assert.equal(easternMonth(new Date("2026-11-01T03:59:00Z")), "2026-10", "11:59 PM on October 31");
  assert.equal(easternMonth(new Date("2026-11-01T04:00:00Z")), "2026-11", "midnight on November 1");
  const [, months] = periodGroups(new Date("2026-11-01T04:00:00Z"), "2026-09");
  assert.deepEqual(months.options.map((o) => [o.id, o.label]), [["2026-11", "This month (November 2026)"], ["2026-10", "October 2026"], ["2026-09", "September 2026"]]);
});

test("past one calendar year the months are grouped by year, newest year first, newest month first inside it", () => {
  assert.deepEqual(ids("2027-02-10T15:00:00Z", "2026-11"), [
    [null, ["today", "last-7d", "last-30d"]], ["2027", ["2027-02", "2027-01"]], ["2026", ["2026-12", "2026-11"]]]);
});

test("an id the picker cannot hold falls back; labels read plainly", () => {
  const now = new Date("2026-10-01T22:00:00Z");
  assert.equal(isPeriod("2026-10", now, null), true);
  assert.equal(isPeriod("2026-09", now, null), false, "no earlier month is offered when nothing earlier holds data");
  assert.equal(isPeriod("last-24h", now, null), false);
  assert.deepEqual(["today", "last-7d", "last-30d", "2026-10", "2026-09"].map((id) => periodLabel(id, now)), ["Today", "Last 7 days", "Last 30 days", "This month (October 2026)", "September 2026"]);
});

test("the days a period covers: today, a rolling week and month, the month so far, a whole past month", () => {
  const now = new Date("2026-10-01T22:00:00Z");
  assert.deepEqual(periodDays("today", now), { from: "2026-10-01", to: "2026-10-01" });
  assert.deepEqual(periodDays("last-7d", now), { from: "2026-09-25", to: "2026-10-01" });
  assert.deepEqual(periodDays("last-30d", now), { from: "2026-09-02", to: "2026-10-01" });
  assert.deepEqual(periodDays("2026-10", now), { from: "2026-10-01", to: "2026-10-01" });
  assert.deepEqual(periodDays("2026-09", now), { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(periodDays("whole-hunt", now), null);
});
