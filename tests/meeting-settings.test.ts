import test from "node:test";
import assert from "node:assert/strict";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { readerSettings, settingUndo, withSetting } from "../lib/control-plane/settings.ts";
import { MEETING_CLOCK_DEFAULTS, MEETING_SITTING_WINDOW, installMeetingClock, currentMeetingClock, sittingWindowHot, sittingWindowRereadMs } from "../lib/civic-data/contracts.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDeadlineMs, sittingWindowSignals } from "../lib/civic-data/runner.ts";
import { coldCheckMinutes, hotCheckMinutes, hotSittingMs } from "../lib/doors/overdue.ts";
import { installMeetingClockFrom, meetingHeldWindowFromSettings, meetingSettingsFromValues, readMeetingSettings, validMeetingSetting } from "../lib/meetings/settings.ts";
import { readReaderMeetingSettings } from "../lib/meetings/reader-settings.ts";
import type { SettingsEdgeStore } from "../lib/civic-data/reader-settings-publication.ts";
const at = "2026-10-05T12:00:00Z";
function store(values: Record<string, number>): SettingsEdgeStore {
  return { read: async () => ({ etag: "v1", snapshot: { formatVersion: 1, revision: 1, updatedAt: at, values } }), write: async () => true };
}
test("meeting timings can go faster and the frequent-check window can grow, with the adopted requirements preserved", () => {
  for (const [key, slow] of [["meetings.hotEveryMinutes", 61], ["meetings.baseEveryMinutes", 721], ["meetings.postedToLiveTargetMinutes", 61],
    ["meetings.hourlyWindowDays", 6], ["meetings.heldAheadDays", 119], ["meetings.heldBackDays", 119]] as const) assert.equal(validMeetingSetting(key, slow), false);
  const config = withSetting(defaultAdminConfig(at), { id: "faster", key: "meetings.hotEveryMinutes", after: 15, at, why: "" });
  try {
    installMeetingClockFrom(config);
    assert.equal(MEETING_SITTING_WINDOW.hotEveryMs, 15 * 60_000);
  } finally {
    installMeetingClock(MEETING_CLOCK_DEFAULTS);
  }
  assert.equal(readMeetingSettings(config).hourlyWindowDays, 7);
  assert.equal(meetingSettingsFromValues({ "meetings.baseEveryMinutes": 1000 }).baseEveryMinutes, 720);
});

test("reader windows use the published setting and undo, without a control-plane read", async () => {
  const key = "meetings.shownAheadDays";
  const config = withSetting(defaultAdminConfig(at), { id: "wider", key, after: 110, at, why: "" });
  assert.equal((await readReaderMeetingSettings(store(readerSettings(config) as Record<string, number>))).shownAheadDays, 110);
  const undo = settingUndo(config, "wider")!;
  const restored = withSetting(config, { id: "undo", key, after: undo.value, at, why: "Undo", undoOf: undo.undoOf });
  assert.equal((await readReaderMeetingSettings(store(readerSettings(restored) as Record<string, number>))).shownAheadDays, 90);
});

test("held window expands from saved settings and defaults preserve permanent history", () => {
  const config = withSetting(defaultAdminConfig(at), { id: "hold", key: "meetings.heldAheadDays", after: 150, at, why: "" });
  const window = meetingHeldWindowFromSettings(at, config)!;
  assert.equal(Date.parse(window.upperBound) - Date.parse(at), 150 * 86_400_000);
  assert.equal(Date.parse(at) - Date.parse(window.lowerBound), 120 * 86_400_000);
});

test("installing the clock from Admin's settings changes what every meeting schedule and overdue function reads, and the defaults come back", () => {
  const own = MEETING_PARTITION_CONTRACTS.find((p) => p.derivedFamily === null && p.schedule?.kind === "SITTING_WINDOW")!;
  const sittingTask = ROUTINE_SOURCE_TASKS.find((t) => t.id === own.id)!;
  const partition = own.schedule!;
  assert.ok(sittingTask && partition.kind === "SITTING_WINDOW");
  const nowMs = Date.parse(at);
  const nineDaysOut = [new Date(nowMs + 9 * 86_400_000).toISOString()];
  const chosen = withSetting(withSetting(withSetting(defaultAdminConfig(at),
    { id: "window", key: "meetings.hourlyWindowDays", after: 10, at, why: "" }),
    { id: "hot", key: "meetings.hotEveryMinutes", after: 15, at, why: "" }),
    { id: "base", key: "meetings.baseEveryMinutes", after: 360, at, why: "" });
  const clockOf = () => ({ lastAttemptedAt: at, lastSucceededAt: at, lastSucceededObservedAt: at, sittingStarts: nineDaysOut });
  const read = () => ({
    clock: currentMeetingClock(),
    shared: [MEETING_SITTING_WINDOW.windowMs, MEETING_SITTING_WINDOW.hotEveryMs, MEETING_SITTING_WINDOW.baseEveryMs],
    partition: [partition.windowMs, partition.hotEveryMs, partition.baseEveryMs],
    hotNineDaysOut: sittingWindowHot(partition, [nineDaysOut], nowMs),
    reread: [sittingWindowRereadMs(partition, true), sittingWindowRereadMs(partition, false)],
    doors: [hotSittingMs(), hotCheckMinutes(), coldCheckMinutes()],
    signal: sittingWindowSignals([{ task: sittingTask, ok: true, clock: clockOf() }], nowMs).get(sittingTask.id),
    deadline: routineTaskDeadlineMs(sittingTask, clockOf(), true),
  });

  const before = read();
  assert.deepEqual(before.shared, [7 * 86_400_000, 3_600_000, 12 * 3_600_000]);
  assert.deepEqual(before.partition, before.shared, "a partition's schedule is the same clock, not a copy of it");
  assert.equal(before.hotNineDaysOut, false);
  assert.deepEqual(before.doors, [7 * 86_400_000, 60, 720]);

  try {
    installMeetingClockFrom(chosen);
    const after = read();
    assert.deepEqual(after.clock, { windowMs: 10 * 86_400_000, hotEveryMs: 15 * 60_000, baseEveryMs: 6 * 3_600_000 });
    assert.deepEqual(after.shared, [10 * 86_400_000, 15 * 60_000, 6 * 3_600_000], "the schedule object built before the install reads the new clock");
    assert.deepEqual(after.partition, after.shared);
    assert.equal(after.hotNineDaysOut, true, "a sitting nine days out is inside the wider window");
    assert.deepEqual(after.reread, [15 * 60_000, 6 * 3_600_000]);
    assert.deepEqual(after.doors, [10 * 86_400_000, 15, 360]);
    assert.equal(after.signal, true);
    assert.equal(after.deadline! - before.deadline!, -(3_600_000 - 15 * 60_000), "the next read is owed by the faster hot interval");

    // Settings that are slower than required are still refused, and a refused change leaves the installed clock alone.
    assert.throws(() => withSetting(chosen, { id: "slow", key: "meetings.hotEveryMinutes", after: 61, at, why: "" }), /Invalid setting value/);
    assert.throws(() => withSetting(chosen, { id: "slow", key: "meetings.baseEveryMinutes", after: 721, at, why: "" }), /Invalid setting value/);
    assert.throws(() => withSetting(chosen, { id: "narrow", key: "meetings.hourlyWindowDays", after: 6, at, why: "" }), /Invalid setting value/);
    assert.deepEqual(read(), after);

    // A value that bypassed validation cannot slow the clock: it reads as the default.
    installMeetingClockFrom({ ...chosen, settings: { ...chosen.settings, "meetings.hotEveryMinutes": 240 } });
    assert.equal(currentMeetingClock().hotEveryMs, MEETING_CLOCK_DEFAULTS.hotEveryMs);
    assert.equal(currentMeetingClock().windowMs, 10 * 86_400_000, "the valid settings beside it still apply");
  } finally {
    installMeetingClock(MEETING_CLOCK_DEFAULTS);
  }

  assert.deepEqual(read(), before, "restoring the defaults restores every reader of the clock");
  installMeetingClockFrom(null);
  assert.deepEqual(currentMeetingClock(), MEETING_CLOCK_DEFAULTS, "no saved config is the defaults");
});
