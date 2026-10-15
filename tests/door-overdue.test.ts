import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COLD_CHECK_MINUTES, HOT_CHECK_MINUTES, STANDING_CHECK_MINUTES, checkEveryFor, doorFactsKey, meetingFactsByDoor, overdueDoors } from "../lib/doors/overdue.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { withSetting } from "../lib/control-plane/settings.ts";
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
    meeting: { agendaSourceType: "LEGISTAR", jurisdiction: "x", publishingOrg: "x", timeZone: "America/Phoenix", verifiedAt: "2026-10-01" },
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

  it("a hot sibling gives every source of the body an hourly clock while keeping each source's fact count", () => {
    const siblings = meetingFactsByDoor({ meetings: [
      row("legistar:hot", "body-a", "2026-10-05T12:00:00.000Z"),
      row("legistar:old", "body-a", "2026-06-01T12:00:00.000Z"),
      row("ical:cold", "body-a", "2026-06-02T12:00:00.000Z"),
      row("ical:other", "body-b", "2026-06-02T12:00:00.000Z"),
    ] }, NOW);
    assert.deepEqual(siblings.get(doorFactsKey("legistar", "body-a")), { liveFacts: 2, hot: true });
    assert.deepEqual(siblings.get(doorFactsKey("ical", "body-a")), { liveFacts: 1, hot: true });
    assert.deepEqual(siblings.get(doorFactsKey("ical", "body-b")), { liveFacts: 1, hot: false });
    const listed = overdueDoors([
      door({ doorId: "cold-sibling", kind: "ical", lastSuccessAt: minutesAgo(90) }),
      door({ doorId: "empty-sibling", kind: "boarddocs", lastSuccessAt: minutesAgo(90) }),
    ], siblings, NOW);
    assert.deepEqual(listed.map(({ checkEveryMinutes, liveFacts }) => [checkEveryMinutes, liveFacts]), [[60, 1], [60, 0]]);
  });

  it("uses each body's stated conclusion and the runner's bounded unstated conclusion", () => {
    const held = meetingFactsByDoor({ meetings: [
      { ...row("legistar:long", "body-a", "2026-09-20T12:00:00.000Z"), endsAt: "2026-09-28T12:00:00.000Z" },
      row("ical:sibling", "body-a", "2026-06-01T12:00:00.000Z"),
      row("ical:other", "body-b", "2026-09-20T12:00:00.000Z"),
      row("ical:bounded", "body-c", "2026-09-26T18:00:00.000Z"),
    ] }, NOW);
    assert.equal(held.get(doorFactsKey("ical", "body-a"))?.hot, true);
    assert.equal(held.get(doorFactsKey("ical", "body-b"))?.hot, false);
    assert.equal(held.get(doorFactsKey("ical", "body-c"))?.hot, true);
  });

  it("Admin's saved meeting window and check intervals determine the overdue list", () => {
    let config = defaultAdminConfig(NOW);
    for (const [key, after] of [["meetings.hourlyWindowDays", 10], ["meetings.hotEveryMinutes", 15], ["meetings.baseEveryMinutes", 180]] as const)
      config = withSetting(config, { id: key, key, after, at: NOW, why: "" });
    const held = meetingFactsByDoor({ meetings: [row("legistar:later", "body-a", "2026-10-13T12:00:00.000Z")] }, NOW, config);
    const listed = overdueDoors([door({ doorId: "hot", lastSuccessAt: minutesAgo(40) }),
      door({ doorId: "cold", bodyIds: ["body-b"], lastSuccessAt: minutesAgo(200) })], held, NOW, config);
    assert.deepEqual(listed.map(({ doorId, checkEveryMinutes, overdueByMinutes }) => [doorId, checkEveryMinutes, overdueByMinutes]),
      [["hot", 15, 25], ["cold", 180, 20]]);
  });

  it("a hot meeting door owes an hourly check, a cold one twice daily, a setting of its own wins", () => {
    assert.equal(checkEveryFor(door({ doorId: "a" }), { liveFacts: 1, hot: true }).minutes, HOT_CHECK_MINUTES);
    assert.equal(checkEveryFor(door({ doorId: "a" }), { liveFacts: 1, hot: false }).minutes, COLD_CHECK_MINUTES);
    assert.deepEqual(checkEveryFor(door({ doorId: "a", checkEveryMinutes: 30 }), undefined), { minutes: 30, own: true });
    assert.equal(checkEveryFor(door({ doorId: "f", meeting: null }), undefined).minutes, STANDING_CHECK_MINUTES);
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
    assert.equal(listed.find(({ doorId }) => doorId === "late-hot")!.checkEveryMinutes, HOT_CHECK_MINUTES);
  });

  it("an unread sitting list remains on the hot clock with an uncounted fact total", () => {
    const listed = overdueDoors([door({ doorId: "unread", lastSuccessAt: minutesAgo(120) })], null, NOW);
    assert.equal(listed[0]?.checkEveryMinutes, 60);
    assert.equal(listed[0]?.liveFacts, null);
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
