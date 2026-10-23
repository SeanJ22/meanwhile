import assert from "node:assert/strict";
import test from "node:test";

import { doorRows, type DoorNumberReadings } from "../lib/control-plane/admin-view/door-numbers.ts";
import type { PostingToLiveRow } from "../lib/civic-data/posting-to-live.ts";
import type { OverdueDoor } from "../lib/doors/overdue.ts";
import type { FixItem } from "../lib/control-plane/fix-list.ts";
import { SHUT_DOOR_FIX_BY } from "../lib/doors/shut-repair.ts";

const NOW = "2026-10-05T12:00:00Z";
const base = (over: Partial<DoorNumberReadings> = {}): DoorNumberReadings => ({ now: NOW, shutDoors: { shut: 2, open: 40, setAside: 1, unreadable: 0 }, overdue: [], scheduled: 30, posting: [], fixes: [], ...over });
const post = (firstSeenAt: string, minutes: number | null, basis: "POSTED" | "FIRST_SEEN" = "POSTED"): PostingToLiveRow => ({
  recordKey: "meeting:x", kind: "MEETING_NEW", versionId: "v", postedAt: null, firstSeenAt, lastUnchangedAt: null, liveAt: minutes === null ? null : firstSeenAt, basis, minutesToLive: minutes, startsAt: null, insideSevenDayWindow: null,
});
const fix = (addedAt: string, fixedAt: string | null, changedBy?: string): FixItem => ({
  id: addedAt, where: "Door a", says: "x", addedBy: SHUT_DOOR_FIX_BY, addedAt, state: fixedAt === null ? "OPEN" : "FIXED", ...(fixedAt === null ? {} : { fixedAt, changedBy: changedBy ?? "The source itself" }),
});

test("every door row says why it has no value when its reading failed", () => {
  const rows = doorRows(base({ shutDoors: null, overdue: null, scheduled: null, posting: null, fixes: null }));
  for (const id of ["Shut doors", "Posted to live", "Overdue doors", "Time to repair", "Repairs without code"]) {
    assert.equal(rows.get(id)!.value, null, id);
    assert.notEqual(rows.get(id)!.notMeasured, null, id);
  }
});

test("posted to live counts the hour target inside the 7 days, and never rounds up", () => {
  const rows = doorRows(base({ posting: [
    post("2026-10-04T00:00:00Z", 30), post("2026-10-04T00:00:00Z", 60, "FIRST_SEEN"), post("2026-10-04T00:00:00Z", 200), post("2026-10-04T00:00:00Z", null),
    post("2026-09-01T00:00:00Z", 5),
  ] }));
  const r = rows.get("Posted to live")!;
  assert.equal(r.value, "at least 50%");
  assert.match(r.counts!, /2 of 4 changes confirmed live within an hour · 1 without a delivery stamp · 2 timed from the body's own posting, 1 from when we first saw it/);
  assert.match(r.says, /slowest confirmed change took 3\.3 hours/);
  const seen=doorRows(base({posting:[{...post("2026-10-04T00:00:00Z",null),pageSeenAt:"2026-10-04T02:00:00Z"}]})).get("Posted to live")!;
  assert.match(seen.says,/hourly check saw 1 of the unstamped changes live/);
  assert.doesNotMatch(seen.says,/not live/);
});

test("overdue doors show the late count against open doors and the facts behind them", () => {
  const late: OverdueDoor = { doorId: "d1", kind: "legistar", bodyIds: ["b"], lastSuccessAt: null, checkEveryMinutes: 60, checkEverySetOnDoor: false, overdueByMinutes: 90, liveFacts: 12 };
  const r = doorRows(base({ overdue: [late, { ...late, doorId: "d2", liveFacts: null }] })).get("Overdue doors")!;
  assert.equal(r.value, "2");
  assert.match(r.counts!, /2 of 30 doors read on a schedule are past their check · 12 live facts behind 1 of them, 1 not counted yet/);
  assert.equal(doorRows(base()).get("Overdue doors")!.value, "0");
});

test("time to repair and repairs without code come from the repair log", () => {
  const rows = doorRows(base({ fixes: [
    fix("2026-10-01T00:00:00Z", "2026-10-01T02:00:00Z"),
    fix("2026-10-02T00:00:00Z", "2026-10-02T06:00:00Z", "A change to the door's record"),
    fix("2026-10-03T00:00:00Z", null),
  ] }));
  assert.equal(rows.get("Time to repair")!.value, "4 hours");
  assert.match(rows.get("Time to repair")!.counts!, /2 repaired doors · longest 6 hours · 1 still being repaired/);
  assert.equal(rows.get("Repairs without code")!.value, "100%");
  assert.match(rows.get("Repairs without code")!.counts!, /2 of 2 .* 1 by editing the door's record, 1 when the source answered again/);
  assert.match(rows.get("Shut doors")!.says, /Reopened 2 times, typically after 4 hours/);
});
