import assert from "node:assert/strict";
import { test } from "node:test";

import { cachedZoneFormatter, isoDaysFromNow, toZonedIso } from "../lib/time/zoned.ts";

test("Arizona stays on -07:00 through what would be DST elsewhere", () => {
  const january = toZonedIso(2026, 1, 14, 17, 30, "America/Phoenix");
  const july = toZonedIso(2026, 7, 14, 17, 30, "America/Phoenix");

  assert.equal(january, "2026-01-14T17:30:00-07:00");
  assert.equal(july, "2026-07-14T17:30:00-07:00");
});

test("Eastern time switches offset across the DST boundary", () => {
  const winter = toZonedIso(2026, 1, 14, 10, 0, "America/New_York");
  const summer = toZonedIso(2026, 7, 14, 10, 0, "America/New_York");

  assert.equal(winter, "2026-01-14T10:00:00-05:00");
  assert.equal(summer, "2026-07-14T10:00:00-04:00");
});

test("the same wall clock in two zones is two different instants", () => {
  const phoenix = Date.parse(toZonedIso(2026, 7, 14, 10, 0, "America/Phoenix"));
  const newYork = Date.parse(toZonedIso(2026, 7, 14, 10, 0, "America/New_York"));

  // Phoenix is three hours behind New York in July, so its 10am comes later.
  assert.equal(phoenix - newYork, 3 * 3_600_000);
});

test("UTC renders as Z rather than +00:00", () => {
  assert.equal(toZonedIso(2026, 3, 2, 9, 0, "UTC"), "2026-03-02T09:00:00Z");
});

test("a day offset lands on the right local calendar date", () => {
  const now = new Date("2026-08-11T04:00:00Z"); // 9pm Aug 10 in Phoenix
  const result = isoDaysFromNow(2, 17, 30, "America/Phoenix", now);

  assert.equal(result, "2026-08-12T17:30:00-07:00");
});

test("day offsets cross a DST boundary without drifting an hour", () => {
  // US DST ends Nov 1, 2026. Step from before it to after.
  const now = new Date("2026-10-30T16:00:00Z");
  const result = isoDaysFromNow(5, 19, 0, "America/New_York", now);

  assert.equal(result, "2026-11-04T19:00:00-05:00");
});

test("zone formatters reuse bounded native instances and reject invalid zones without evicting a valid one", () => {
  const formatter = cachedZoneFormatter("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
  const zones = Intl.supportedValuesOf("timeZone").slice(0, 33);
  const first = formatter(zones[0]!);
  for (const zone of zones.slice(1, 32)) formatter(zone);
  assert.equal(formatter(zones[0]!), first);
  assert.throws(() => formatter("Not/A_Zone"), RangeError);
  assert.equal(formatter(zones[0]!), first);
  formatter(zones[32]!);
  assert.notEqual(formatter(zones[0]!), first, "the oldest native formatter is released after 32 zones");
  assert.equal(formatter(zones[0]!).format(new Date("2026-11-01T06:30:00Z")), first.format(new Date("2026-11-01T06:30:00Z")));
});
