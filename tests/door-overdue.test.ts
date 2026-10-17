import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MEETING_CLOCK_DEFAULTS, installMeetingClock } from "../lib/civic-data/contracts.ts";
import { STANDING_CHECK_MINUTES, checkEveryFor, coldCheckMinutes, doorFactsAt, doorFactsKey, hotCheckMinutes, hotSittingMs, meetingFactsByDoor, meetingSittingsByDoor, overdueDoors } from "../lib/doors/overdue.ts";
import type { DoorRecord } from "../lib/doors/registry.ts";
import type { Meeting } from "../lib/sources/types.ts";

/** Doors whose last success is older than their check are listed, with the live facts behind each. */

const NOW = "2026-10-04T12:00:00.000Z";
const minutesAgo = (minutes: number) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

function door(partial: Partial<DoorRecord> & Pick<DoorRecord, "doorId">): DoorRecord {
  return {
    formatVersion: 1, kind: "legistar", ocdId: "ocd-division/country:us/state:az/county:pima", bodyIds: ["body-a"], hosts: ["x.example"],
    config: {}, holds: ["meetings"], checkEveryMinutes: null, notes: "", status: "OPEN", lastSuccessAt: minutesAgo(10), lastFailureAt: null,
    shutSince: null, readNow: false, origin: "DERIVED", editedAt: null, updatedAt: minutesAgo(5000), validators: null,
    meeting: { agendaSourceType: "LEGISTAR", jurisdiction: "x", publishingOrg: "x", timeZone: "America/Phoenix", verifiedAt: "2026-10-01", family: null },
    ...partial,
  };
}

const row = (id: string, bodyId: string, startsAt: string): Meeting => ({ id, bodyId, startsAt } as Meeting);

describe("DB-31: overdue doors", () => {
  const facts = meetingFactsByDoor({
    meetings: [
      row("legistar:1", "body-a", "2026-10-06T17:00:00.000Z"),
      row("legistar:2", "body-a", "2026-06-01T17:00:00.000Z"),
      row("legistar:3", "body-b", "2026-06-02T17:00:00.000Z"),
    ],
  }, NOW);

  it("counts the live facts behind each door and says which door has a sitting near", () => {
    assert.deepEqual(facts.get(doorFactsKey("legistar", "body-a")), { liveFacts: 2, hot: true });
    assert.deepEqual(facts.get(doorFactsKey("legistar", "body-b")), { liveFacts: 1, hot: false });
  });

  it("a hot meeting door owes an hourly check, a cold one twice daily, a setting of its own wins", () => {
    assert.equal(checkEveryFor(door({ doorId: "a" }), { liveFacts: 1, hot: true }).minutes, hotCheckMinutes());
    assert.equal(checkEveryFor(door({ doorId: "a" }), { liveFacts: 1, hot: false }).minutes, coldCheckMinutes());
    assert.deepEqual(checkEveryFor(door({ doorId: "a", checkEveryMinutes: 30 }), undefined), { minutes: 30, own: true });
    assert.equal(checkEveryFor(door({ doorId: "f", meeting: null }), undefined).minutes, STANDING_CHECK_MINUTES);
  });

  it("the hot window and both checks are the clock Admin's settings install, and the defaults are seven days, an hour and twelve hours", () => {
    assert.deepEqual([hotSittingMs(), hotCheckMinutes(), coldCheckMinutes()], [7 * 86_400_000, 60, 720]);
  });

  it("a faster installed clock changes which door is hot, what a hot door owes and who is listed late, and the defaults come back", () => {
    const sittings = meetingSittingsByDoor({ meetings: [row("legistar:1", "body-a", "2026-10-06T17:00:00.000Z")] });
    const held = sittings.get(doorFactsKey("legistar", "body-a"))!;
    const doors = [door({ doorId: "hot-30", bodyIds: ["body-a"], lastSuccessAt: minutesAgo(50) })];
    try {
      installMeetingClock({ windowMs: 86_400_000, hotEveryMs: 30 * 60_000, baseEveryMs: 6 * 3_600_000 });
      assert.deepEqual(doorFactsAt(held, NOW), { liveFacts: 1, hot: false }, "the sitting is two days out and the window is now one day");
      assert.equal(checkEveryFor(doors[0]!, { liveFacts: 1, hot: true }).minutes, 30);
      assert.equal(checkEveryFor(doors[0]!, { liveFacts: 1, hot: false }).minutes, 360);
      assert.deepEqual(overdueDoors(doors, new Map([[doorFactsKey("legistar", "body-a"), { liveFacts: 1, hot: true }]]), NOW).map((d) => [d.doorId, d.checkEveryMinutes, d.overdueByMinutes]), [["hot-30", 30, 20]]);
    } finally {
      installMeetingClock(MEETING_CLOCK_DEFAULTS);
    }
    assert.deepEqual(doorFactsAt(held, NOW), { liveFacts: 1, hot: true });
    assert.equal(overdueDoors(doors, facts, NOW).length, 0, "an hourly check is not yet late at fifty minutes");
  });

  it("lists open doors past their check, most late first, with their facts; leaves out the on-time, the shut, the suspended and doors no task reads on a clock", () => {
    const doors = [
      door({ doorId: "on-time-hot", bodyIds: ["body-a"], lastSuccessAt: minutesAgo(50) }),
      door({ doorId: "late-hot", bodyIds: ["body-a"], lastSuccessAt: minutesAgo(130) }),
      door({ doorId: "late-cold", bodyIds: ["body-b"], lastSuccessAt: minutesAgo(900) }),
      door({ doorId: "shut-late", bodyIds: ["body-b"], status: "SHUT", lastSuccessAt: minutesAgo(5000) }),
      door({ doorId: "suspended-late", bodyIds: ["body-b"], status: "SUSPENDED", lastSuccessAt: minutesAgo(5000) }),
      door({ doorId: "feed-late", meeting: null, kind: "source-feed", bodyIds: [], lastSuccessAt: minutesAgo(3000) }),
      door({ doorId: "found-page", meeting: null, kind: "page", bodyIds: [], lastSuccessAt: null, updatedAt: minutesAgo(30_000) }),
      door({ doorId: "route-hints", meeting: null, kind: "route-hints", bodyIds: [], lastSuccessAt: null, updatedAt: minutesAgo(30_000) }),
    ];
    const listed = overdueDoors(doors, facts, NOW);
    assert.deepEqual(listed.map(({ doorId }) => doorId), ["feed-late", "late-cold", "late-hot"]);
    assert.deepEqual(listed.map(({ overdueByMinutes }) => overdueByMinutes), [1560, 180, 70]);
    assert.deepEqual(listed.map(({ liveFacts }) => liveFacts), [null, 1, 2]);
    assert.equal(listed.find(({ doorId }) => doorId === "late-hot")!.checkEveryMinutes, hotCheckMinutes());
  });

  it("a door that never succeeded is measured from its last change, so a new door is not late", () => {
    const listed = overdueDoors([
      door({ doorId: "new", bodyIds: ["body-b"], lastSuccessAt: null, updatedAt: minutesAgo(30) }),
      door({ doorId: "old-never-read", bodyIds: ["body-b"], lastSuccessAt: null, updatedAt: minutesAgo(3000) }),
    ], facts, NOW);
    assert.deepEqual(listed.map(({ doorId }) => doorId), ["old-never-read"]);
    assert.equal(listed[0]!.lastSuccessAt, null);
  });
});
