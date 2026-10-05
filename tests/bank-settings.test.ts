import test from "node:test";
import assert from "node:assert/strict";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { readerSettings, settingUndo, withSetting } from "../lib/control-plane/settings.ts";
import { readFeature, withFeatures } from "../lib/control-plane/features.ts";
import { withReaderFeatures } from "../lib/civic-data/reader-feature-context.ts";
import { RIPCORDS, RIPCORD_NAMES, ripcordPulled } from "../lib/ripcords.ts";
import { meetingScheduleFromSettings, meetingSettingsFromValues, readMeetingSettings, validMeetingSetting } from "../lib/meetings/settings.ts";
import { readReaderMeetingSettings } from "../lib/meetings/reader-settings.ts";
import type { SettingsEdgeStore } from "../lib/civic-data/reader-settings-publication.ts";

const at = "2026-10-05T12:00:00Z";
function store(values: Record<string, boolean | number>): SettingsEdgeStore {
  return { read: async () => ({ etag: "v1", snapshot: { formatVersion: 1, revision: 1, updatedAt: at, values } }), write: async () => true };
}

test("switch changes and undo publish through the ordinary settings map and synchronous readers use that request's values", async () => {
  const key = "features.rateLimits";
  const changed = withSetting(defaultAdminConfig(at), { id: "off", key, after: false, at, why: "test" });
  assert.equal(readFeature("rateLimits", true, changed), false);
  assert.equal(readerSettings(changed)[key], false);
  await withReaderFeatures(async () => assert.equal(ripcordPulled("ripcord.rateLimits"), true), store(readerSettings(changed) as Record<string, boolean>));
  const undo = settingUndo(changed, "off")!;
  const restored = withSetting(changed, { id: "undo", key: undo.key, after: undo.value, at, why: "Undo", undoOf: undo.undoOf });
  await withReaderFeatures(async () => assert.equal(ripcordPulled("ripcord.rateLimits"), false), store(readerSettings(restored) as Record<string, boolean>));
});

test("concurrent requests keep separate switch values, and emergency overrides still win", async () => {
  await Promise.all([true, false].map(enabled => withReaderFeatures(async () => {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(ripcordPulled("ripcord.rateLimits"), !enabled);
  }, store({ "features.rateLimits": enabled }))));
  for (const name of RIPCORD_NAMES) {
    const env = RIPCORDS[name].envVar;
    const prior = process.env[env];
    try {
      process.env[env] = "pulled";
      withFeatures({ [`features.${name.slice(8)}`]: true }, () => assert.equal(ripcordPulled(name), true));
      process.env[env] = "live";
      withFeatures({ [`features.${name.slice(8)}`]: false }, () => assert.equal(ripcordPulled(name), false));
    } finally { if (prior === undefined) delete process.env[env]; else process.env[env] = prior; }
  }
});

test("a failed request is never executed again by the settings fallback", async () => {
  let actions = 0;
  await assert.rejects(withReaderFeatures(async () => { actions++; throw new Error("request failure"); }, store({})), /request failure/);
  assert.equal(actions, 1);
  let reads = 0;
  await withReaderFeatures(async () => { ripcordPulled("ripcord.rateLimits"); ripcordPulled("ripcord.reactionIntake"); },
    { read: async () => { reads++; throw new Error("store unavailable"); }, write: async () => false });
  assert.equal(reads, 1);
});

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
