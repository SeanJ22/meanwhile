import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COLD_CHECK_MINUTES, HOT_CHECK_MINUTES, STANDING_CHECK_MINUTES, checkEveryFor, doorFactsKey, meetingFactsByDoor, overdueDoors } from "../lib/doors/overdue.ts";
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
    assert.equal(checkEveryFor(door({ doorId: "a" }), { liveFacts: 1, hot: true }).minutes, HOT_CHECK_MINUTES);
    assert.equal(checkEveryFor(door({ doorId: "a" }), { liveFacts: 1, hot: false }).minutes, COLD_CHECK_MINUTES);
    assert.deepEqual(checkEveryFor(door({ doorId: "a", checkEveryMinutes: 30 }), undefined), { minutes: 30, own: true });
    assert.equal(checkEveryFor(door({ doorId: "f", meeting: null }), undefined).minutes, STANDING_CHECK_MINUTES);
  });

  it("lists open doors past their check, most late first, with their facts; leaves out the on-time, the shut and the suspended", () => {
    const doors = [
      door({ doorId: "on-time-hot", bodyIds: ["body-a"], lastSuccessAt: minutesAgo(50) }),
      door({ doorId: "late-hot", bodyIds: ["body-a"], lastSuccessAt: minutesAgo(130) }),
      door({ doorId: "late-cold", bodyIds: ["body-b"], lastSuccessAt: minutesAgo(900) }),
      door({ doorId: "shut-late", bodyIds: ["body-b"], status: "SHUT", lastSuccessAt: minutesAgo(5000) }),
      door({ doorId: "suspended-late", bodyIds: ["body-b"], status: "SUSPENDED", lastSuccessAt: minutesAgo(5000) }),
      door({ doorId: "feed-late", meeting: null, kind: "feed", bodyIds: [], lastSuccessAt: minutesAgo(3000) }),
    ];
    const listed = overdueDoors(doors, facts, NOW);
    assert.deepEqual(listed.map(({ doorId }) => doorId), ["feed-late", "late-cold", "late-hot"]);
    assert.deepEqual(listed.map(({ overdueByMinutes }) => overdueByMinutes), [1560, 180, 70]);
    assert.deepEqual(listed.map(({ liveFacts }) => liveFacts), [null, 1, 2]);
    assert.equal(listed.find(({ doorId }) => doorId === "late-hot")!.checkEveryMinutes, HOT_CHECK_MINUTES);
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
