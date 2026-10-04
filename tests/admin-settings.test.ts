import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { DETECTIVE_SHUT_THRESHOLD, meetingCheckInterval, readSetting, registerSetting, settingUndo, withSetting } from "../lib/control-plane/settings.ts";
import { publishReaderSettings, readReaderSetting, READER_SETTINGS_TAG, type ReaderSettingsSnapshot, type SettingsEdgeStore } from "../lib/civic-data/reader-settings-publication.ts";

const at = "2026-10-04T06:00:00Z";
test("settings gateway survives a fresh read, replays once and undoes through the same action", async () => {
  const repos = createMemoryRepositories();
  const deps = { repos, now: () => at, currentStateVersion: null, codeSha: null };
  const request = { type: "config.setSetting", subject: DETECTIVE_SHUT_THRESHOLD,
    input: { key: DETECTIVE_SHUT_THRESHOLD, value: 5, why: "Try more routes before escalating" },
    stateVersion: null, idempotencyKey: "setting-first", caller: "OWNER_SESSION" as const, actorRef: "owner-session" };
  assert.equal((await submit(request, deps)).ok, true);
  assert.equal((await submit(request, deps)).replayed, true);
  const config = (await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).value;
  assert.equal(readSetting(config, DETECTIVE_SHUT_THRESHOLD, 3), 5);
  assert.equal(config.settingHistory?.length, 1);
  assert.equal(config.settingHistory?.[0].before, 3);
  assert.equal(config.settingHistory?.[0].factory, undefined);
  const undo = settingUndo(config, config.settingHistory![0].id)!;
  assert.equal((await submit({ ...request, input: undo, idempotencyKey: "setting-undo" }, deps)).ok, true);
  const undone = (await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).value;
  assert.equal(readSetting(undone, DETECTIVE_SHUT_THRESHOLD, 3), 3);
  assert.equal(undone.settingHistory?.[1].before, 5);
  assert.equal(undone.apiFallback.enabled, false);
  assert.equal((await submit({ ...request, input: undo, idempotencyKey: "stale-undo" }, deps)).ok, false);
});
test("unknown keys, invalid thresholds and unauthorized callers cannot change settings", async () => {
  const repos = createMemoryRepositories();
  const deps = { repos, now: () => at, currentStateVersion: null, codeSha: null };
  for (const [key, value, caller] of [["spend.limit", 100, "OWNER_SESSION"], [DETECTIVE_SHUT_THRESHOLD, 0, "OWNER_SESSION"],
    [DETECTIVE_SHUT_THRESHOLD, 1.5, "OWNER_SESSION"], [DETECTIVE_SHUT_THRESHOLD, 8, "AGENT"]] as const) {
    const result = await submit({ type: "config.setSetting", subject: key, input: { key, value, why: "test" },
      stateVersion: null, idempotencyKey: `invalid-${key}-${value}`, caller, actorRef: "test" }, deps);
    assert.equal(result.ok, false);
  }
  assert.equal(await repos.adminConfig.read(ADMIN_CONFIG_ID), null);
  assert.equal(meetingCheckInterval(60)(61), false);
  assert.equal(meetingCheckInterval(720)(721), false);
  assert.equal(meetingCheckInterval(60)(15), true);
});
test("reader settings publish only public values, purge on replay, and cannot regress after a CAS race", async () => {
  registerSetting({ key: "copy.settingsTest", label: "Empty section", defaultValue: "We're working on getting this info",
    readerFacing: true, validate: (value): value is string => typeof value === "string" && value.length < 500 });
  let held: { snapshot: ReaderSettingsSnapshot; etag: string } | null = null;
  const store: SettingsEdgeStore = {
    async read() { return held; },
    async write(snapshot, etag) {
      if ((held?.etag ?? null) !== etag) return false;
      held = { snapshot, etag: String(snapshot.revision) }; return true;
    },
  };
  let purges = 0;
  const purge = async (tags: readonly string[]) => { assert.deepEqual(tags, [READER_SETTINGS_TAG]); purges++; };
  const config = withSetting(defaultAdminConfig(at), { id: "copy-one", key: "copy.settingsTest", after: "Working on it", at, why: "Plain words" });
  assert.equal(await publishReaderSettings(config, 2, { store, purge }), true);
  assert.equal(await readReaderSetting("copy.settingsTest", "fallback", store), "Working on it");
  assert.equal(await readReaderSetting(DETECTIVE_SHUT_THRESHOLD, 3, store), 3);
  assert.equal(await publishReaderSettings(config, 2, { store, purge }), true);
  assert.equal(purges, 2);
  assert.equal(await publishReaderSettings(defaultAdminConfig(at), 1, { store, purge }), false);
  assert.equal(await readReaderSetting("copy.settingsTest", "fallback", store), "Working on it");
  assert.equal(await publishReaderSettings(config, 3, { store: { ...store, async write() { return false; } }, purge }), false);
});
