import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import {
  meetingCheckInterval, readSetting, registerSetting, runnerSettingsEcho,
  settingUndo, withSetting,
} from "../lib/control-plane/settings.ts";
import {
  ensureReaderSettingsPublished, publishReaderSettings, readReaderSetting, READER_SETTINGS_TAG, type ReaderSettingsSnapshot, type SettingsEdgeStore,
} from "../lib/civic-data/reader-settings-publication.ts";
import { projectSettings } from "../lib/control-plane/admin-view/v6-settings-read.ts";
import type { RunnerHeartbeat } from "../lib/control-plane/owner-surface.ts";
import { actionInput } from "../app/(admin)/_mw/admin-v6/contract.ts";
import { actionDef, gatewayActionKind, settingValueFromInput } from "../app/(admin)/_mw/admin-v6/actions.ts";
import { inForceWords, settingActions } from "../app/(admin)/_mw/admin-v6/screen-settings.tsx";

const at = "2026-10-04T06:00:00Z";
const COPY_KEY = "copy.settingsTest";
registerSetting({ key: COPY_KEY, label: "Empty section", defaultValue: "We're working on getting this info",
  readerFacing: true, validate: (value): value is string => typeof value === "string" && value.length < 500 });
const RUNNER_KEY = "runner.settingsTest";
registerSetting({ key: RUNNER_KEY, label: "Failures before a test pause", defaultValue: 3, unit: "failures in a row",
  readerFacing: false, control: "number",
  validate: (value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 100 });

function depsAt(repos = createMemoryRepositories(), now = at) {
  return { repos, now: () => now, currentStateVersion: null, codeSha: null };
}
function memoryEdge(): SettingsEdgeStore & { held: { snapshot: ReaderSettingsSnapshot; etag: string } | null } {
  const edge = {
    held: null as { snapshot: ReaderSettingsSnapshot; etag: string } | null,
    async read() { return edge.held; },
    async write(snapshot: ReaderSettingsSnapshot, etag: string | null) {
      if ((edge.held?.etag ?? null) !== etag) return false;
      edge.held = { snapshot, etag: String(snapshot.revision) }; return true;
    },
  };
  return edge;
}
const beat = (settings: RunnerHeartbeat["settings"]): RunnerHeartbeat => ({ formatVersion: 1, beatAt: at, lastCycleStartedAt: at, lastCycleFinishedAt: at,
  nextCycleDueAt: null, lastCycleOk: true, testedSha: null, host: "runner", settings });

test("settings gateway survives a fresh read, replays once and undoes through the same action", async () => {
  const deps = depsAt();
  const request = { type: "config.setSetting", subject: RUNNER_KEY,
    input: { key: RUNNER_KEY, value: 5, why: "Try more routes before escalating" },
    stateVersion: null, idempotencyKey: "setting-first", caller: "OWNER_SESSION" as const, actorRef: "owner-session" };
  const first = await submit(request, deps);
  assert.equal(first.ok, true);
  assert.equal(first.receipt.says, "Failures before a test pause is now 5 failures in a row.");
  assert.equal((await submit(request, deps)).replayed, true);
  const config = (await deps.repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { settingHistory: true })).value;
  assert.equal(readSetting(config, RUNNER_KEY, 3), 5);
  assert.equal(config.settingHistory?.length, 1);
  assert.equal(config.settingHistory?.[0].before, 3);
  assert.equal(config.settingHistory?.[0].at, at);
  assert.equal(config.settingHistory?.[0].factory, undefined, "Sean's own change carries no name");
  const undo = settingUndo(config, config.settingHistory![0].id)!;
  assert.equal((await submit({ ...request, input: undo, idempotencyKey: "setting-undo" }, deps)).ok, true);
  const undone = (await deps.repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { settingHistory: true })).value;
  assert.equal(readSetting(undone, RUNNER_KEY, 3), 3);
  assert.equal(undone.settingHistory?.[1].before, 5);
  assert.equal(undone.settingHistory?.[1].undoOf, config.settingHistory![0].id);
  assert.equal(undone.apiFallback.enabled, false);
  assert.equal((await submit({ ...request, input: undo, idempotencyKey: "stale-undo" }, deps)).ok, false, "an undo never jumps over a later change");
});

test("a note is optional; unknown keys, invalid values and agents cannot change settings", async () => {
  const deps = depsAt();
  const noNote = await submit({ type: "config.setSetting", subject: RUNNER_KEY, input: { key: RUNNER_KEY, value: 4 },
    stateVersion: null, idempotencyKey: "no-note-key", caller: "OWNER_SESSION", actorRef: "test" }, deps);
  assert.equal(noNote.ok, true);
  const fresh = depsAt();
  for (const [key, value, caller] of [["spend.limit", 100, "OWNER_SESSION"], [RUNNER_KEY, 0, "OWNER_SESSION"],
    [RUNNER_KEY, 1.5, "OWNER_SESSION"], [RUNNER_KEY, 8, "AGENT"]] as const) {
    const result = await submit({ type: "config.setSetting", subject: key, input: { key, value, why: "test" },
      stateVersion: null, idempotencyKey: `invalid-${key}-${value}`, caller, actorRef: "test" }, fresh);
    assert.equal(result.ok, false);
  }
  assert.equal(await fresh.repos.adminConfig.read(ADMIN_CONFIG_ID), null);
  assert.equal(meetingCheckInterval(60)(61), false, "a meeting check may go faster than the rulings floor, never slower");
  assert.equal(meetingCheckInterval(720)(721), false);
  assert.equal(meetingCheckInterval(60)(15), true);
});

test("the runner re-reads each pass and its heartbeat echo shows the new value in force", async () => {
  const deps = depsAt();
  const before = runnerSettingsEcho(null, at);
  assert.equal(before.values[RUNNER_KEY], 3);
  assert.equal(before.values[COPY_KEY], undefined, "reader-facing keys are not the runner's");
  await submit({ type: "config.setSetting", subject: RUNNER_KEY, input: { key: RUNNER_KEY, value: 6, why: "" },
    stateVersion: null, idempotencyKey: "six-failures", caller: "OWNER_SESSION", actorRef: "test" }, deps);
  const config = (await deps.repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { settingHistory: true })).value;
  const row = (heartbeat: RunnerHeartbeat | null) => projectSettings({ config, heartbeat, published: null, observedAt: at }).rows
    .find((r) => r.key === RUNNER_KEY)!;
  assert.deepEqual(row(null).inForce, { where: "runner", yes: null, since: null });
  assert.equal(inForceWords(row(null)).words, "Runner hasn't reported it yet");
  assert.equal(row(beat(before)).inForce.yes, false, "the last pass still ran on the old value");
  assert.equal(inForceWords(row(beat(before))).words, "Waiting for the runner's next round");
  const nextPass = "2026-10-04T06:15:00Z";
  const after = row(beat(runnerSettingsEcho(config, nextPass)));
  assert.deepEqual(after.inForce, { where: "runner", yes: true, since: nextPass });
  assert.match(inForceWords(after).words, /^In force since Oct 4, 2:15 AM ET$/);
  assert.equal(after.valueWords, "6 failures in a row");
  assert.equal(after.log[0].beforeWords, "3 failures in a row");
  assert.equal(after.log[0].why, null);
});

test("reader settings publish only public values, purge on replay, cannot regress, and catch up when a publish was missed", async () => {
  const store = memoryEdge();
  let purges = 0;
  const purge = async (tags: readonly string[]) => { assert.deepEqual(tags, [READER_SETTINGS_TAG]); purges++; };
  const config = withSetting(defaultAdminConfig(at), { id: "copy-one", key: COPY_KEY, after: "Working on it", at, why: "Plain words" });
  assert.equal(await publishReaderSettings(config, 2, { store, purge }), true);
  assert.equal(await readReaderSetting(COPY_KEY, "fallback", store), "Working on it");
  assert.equal(await readReaderSetting(RUNNER_KEY, 3, store), 3, "runner keys never reach readers");
  assert.equal(await publishReaderSettings(config, 2, { store, purge }), true);
  assert.equal(purges, 2);
  assert.equal(await publishReaderSettings(defaultAdminConfig(at), 1, { store, purge }), false);
  assert.equal(await readReaderSetting(COPY_KEY, "fallback", store), "Working on it");
  assert.equal(await publishReaderSettings(config, 3, { store: { ...store, async write() { return false; } }, purge }), false);
  // A change whose publish failed is published by the next catch-up; an equal one publishes nothing.
  const changed = withSetting(config, { id: "copy-two", key: COPY_KEY, after: "Coming soon", at, why: "" });
  assert.equal(await ensureReaderSettingsPublished(changed, 5, { store, purge }), "published");
  assert.equal(await readReaderSetting(COPY_KEY, "fallback", store), "Coming soon");
  assert.equal(await ensureReaderSettingsPublished(changed, 6, { store, purge }), "current");
  assert.equal(await ensureReaderSettingsPublished(config, 4, { store, purge }), "behind", "an older config never overwrites a newer snapshot");
  const view = projectSettings({ config: changed, heartbeat: null, published: store.held!.snapshot.values, observedAt: at }).rows.find((r) => r.key === COPY_KEY)!;
  assert.deepEqual(view.inForce, { where: "readers", yes: true, since: null });
});

test("the log preserves every change, and only the newest can be undone", () => {
  let config: AdminConfig = defaultAdminConfig(at);
  for (let n = 0; n < 505; n++) config = withSetting(config, { id: `c${n}`, key: RUNNER_KEY, after: (n % 9) + 1, at, why: "" });
  assert.equal(config.settingHistory?.length, 505);
  assert.ok(settingUndo(config, "c504"));
  assert.equal(settingUndo(config, "c503"), null);
});

test("BR-06: changing the daily budget and pressing Undo restores the old value; the log shows both with times and values", async () => {
  const repos = createMemoryRepositories();
  const send = async (amount: string, key: string, now: string) => {
    const input = actionInput("global-ceiling", { target: "us", scopeKey: "us", option: null, words: "", amount, selected: [] });
    return submit({ type: actionDef("global-ceiling").gateway!.type, subject: "us", input, stateVersion: null, idempotencyKey: key,
      caller: "OWNER_SESSION", actorRef: "owner-session" }, depsAt(repos, now));
  };
  assert.equal(projectSettings({ config: null, heartbeat: null, published: null, observedAt: at }).rows[0].label, "Most the workers may spend in any rolling 24 hours");
  assert.equal((await send("25", "ceiling-first", "2026-10-04T05:00:00Z")).ok, true);
  const first = projectSettings({ config: (await repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { settingHistory: true })).value, heartbeat: null, published: null, observedAt: at }).rows[0];
  assert.equal(first.undo, null, "the $0 default cannot be set by the ceiling control, so there is nothing to undo to");
  assert.equal((await send("40", "ceiling-forty", "2026-10-04T06:00:00Z")).ok, true);
  const afterChange = projectSettings({ config: (await repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { settingHistory: true })).value, heartbeat: null, published: null, observedAt: at }).rows[0];
  assert.equal(afterChange.valueWords, "$40.00 a day");
  const undoSend = settingActions(afterChange).find((a) => a.label?.startsWith("Undo"))!;
  assert.equal(undoSend.kind, "global-ceiling");
  assert.equal(undoSend.label, "Undo (back to $25.00 a day)");
  assert.equal((await send(undoSend.payload!.amount, "ceiling-undo", "2026-10-04T06:05:00Z")).ok, true);
  const config = (await repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { settingHistory: true })).value;
  const row = projectSettings({ config, heartbeat: null, published: null, observedAt: at }).rows[0];
  assert.equal(row.valueWords, "$25.00 a day", "Undo restored the value before the change");
  assert.deepEqual(row.log.slice(0, 2).map((e) => [e.at, e.beforeWords, e.afterWords]), [
    ["2026-10-04T06:05:00Z", "$40.00 a day", "$25.00 a day"],
    ["2026-10-04T06:00:00Z", "$25.00 a day", "$40.00 a day"],
  ]);
});

test("the Settings view's sends carry the exact gateway input, with no machine key on screen", async () => {
  const deps = depsAt();
  const view = projectSettings({ config: null, heartbeat: null, published: null, observedAt: at });
  const row = view.rows.find((r) => r.key === RUNNER_KEY)!;
  for (const r of view.rows) assert.doesNotMatch(`${r.label} ${r.valueWords}`, /\w+\.\w+[A-Z]/, "labels are words, not keys");
  const [change] = settingActions(row);
  assert.equal(change.kind, "setting-set");
  assert.equal(actionDef("setting-set").gateway?.type, "config.setSetting");
  const input = actionInput("setting-set", { target: change.target, scopeKey: "us", option: null, words: " Fewer walks ", amount: "7", selected: [], payload: change.payload });
  assert.deepEqual(input, { key: RUNNER_KEY, value: 7, why: "Fewer walks" });
  assert.equal((await submit({ type: "config.setSetting", subject: change.target, input, stateVersion: null, idempotencyKey: "ui-change-seven", caller: "OWNER_SESSION", actorRef: "t" }, deps)).ok, true);
  const config = (await deps.repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { settingHistory: true })).value;
  const changed = projectSettings({ config, heartbeat: null, published: null, observedAt: at }).rows.find((r) => r.key === RUNNER_KEY)!;
  const undo = settingActions(changed)[1];
  assert.equal(undo.kind, "setting-undo");
  assert.equal(undo.label, "Undo (back to 3 failures in a row)");
  const undoInput = actionInput("setting-undo", { target: undo.target, scopeKey: "us", option: null, words: "", amount: "", selected: [], payload: undo.payload });
  assert.equal((await submit({ type: "config.setSetting", subject: undo.target, input: undoInput, stateVersion: null, idempotencyKey: "ui-undo-seven", caller: "OWNER_SESSION", actorRef: "t" }, deps)).ok, true);
  assert.equal(readSetting((await deps.repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { settingHistory: true })).value, RUNNER_KEY, 3), 3);
  assert.equal(gatewayActionKind("config.setSetting"), "setting-set", "history maps setting receipts to their own kind");
  assert.equal(settingValueFromInput("number", "x", null), undefined);
  assert.equal(settingValueFromInput("boolean", "", "on"), true);
  assert.deepEqual(settingValueFromInput("json", "[\"a\"]", null), ["a"]);
});
