import test from "node:test";
import assert from "node:assert/strict";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { readerSettings, settingUndo, withSetting } from "../lib/control-plane/settings.ts";
import { meetingHeldWindowFromSettings, meetingScheduleFromSettings, meetingSettingsFromValues, readMeetingSettings, validMeetingSetting } from "../lib/meetings/settings.ts";
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
  assert.equal(meetingScheduleFromSettings(config).hotEveryMs, 15 * 60_000);
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
