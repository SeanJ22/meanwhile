import { projectSettings } from "../lib/control-plane/admin-view/v6-settings-read.ts";
import { settingActions } from "../app/(admin)/_mw/admin-v6/screen-settings.tsx";
import { actionDef } from "../app/(admin)/_mw/admin-v6/actions.ts";
import { actionInput } from "../app/(admin)/_mw/admin-v6/contract.ts";
import assert from "node:assert/strict";
import nodeTest from "node:test";
import { createMemoryRepositories, playbookRows } from "./helpers/playbooks.ts";
import { createMemoryRepositories as emptyRepositories } from "../lib/control-plane/repository/memory.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { readRolePlaybook, rolePlaybook } from "../lib/control-plane/playbooks.ts";
import { fieldManualEntryId } from "../lib/control-plane/field-manual.ts";
import { playbookEditView, EDITABLE_PLAYBOOK_ROLES, updateRolePlaybook } from "../lib/control-plane/playbook-edit.ts";
import { savePlaybook } from "../app/(admin)/_mw/admin-v6/playbook-send.ts";
import { hunterExecutor, type ModelRequest } from "../lib/control-plane/scheduler/scout-executor.ts";
import { publishAskPlaybooks, publishReaderSettings, type ReaderSettingsSnapshot, type SettingsEdgeStore } from "../lib/civic-data/reader-settings-publication.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { withPublishedAskSettings, askPlaybook } from "../lib/ask/runtime-settings.ts";
import { resolveAskRoleModel } from "../lib/ask/model.ts";
import { classifierCeiling } from "../lib/routing/classifier.ts";

const at = "2026-10-12T12:00:00Z";
const scheduled = { obligation: { id: "pb01", recordClass: "meetings", subjectId: "ocd-division/country:us/state:az/place:chandler", routeId: null,
  active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, nextDueAt: at, cadenceHours: 24, cadenceSource: "DEFAULT_NO_SIGNAL" as const, basis: "saved official source" };

nodeTest("PB-01 Settings save reaches the next real hunter request, its log, and undo", async () => {
  const repos = createMemoryRepositories();
  // The place-filtered manual deliberately has no instructions: the run must use the exact row read.
  repos.fieldManual.slice = async () => [];
  const deps = { repos, now: () => at, currentStateVersion: null, codeSha: null };
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    const { type, subject, idempotencyKey, returnTo: _returnTo, ...input } = JSON.parse(String(init?.body));
    return Response.json(await submit({ type, subject, input, idempotencyKey, stateVersion: null, caller: "OWNER_SESSION", actorRef: "owner" }, deps));
  }) as typeof fetch;
  const initial = await readRolePlaybook(repos, "HUNTER");
  const text = initial.text.replace("Copy values exactly", "Copy values verbatim");
  assert.notEqual(text, initial.text);
  await savePlaybook({ type: "playbook.update", role: "HUNTER", text, expectedVersion: initial.version, why: "One word" }, "word-edit", fetchImpl);
  let sent: ModelRequest | undefined;
  let loggedPrompt = "";
  const executor = hunterExecutor({ role: "HUNTER", onResult: async result => { loggedPrompt = result.instructions!.systemPrompt; }, now: () => at, playbookFor: role => readRolePlaybook(repos, role),
    transport: async request => { sent = request; throw new Error("Captured request without paid inference"); },
    toolkitFor: () => ({ specs: [], vaultedArtifactIds: new Set(), reported: [], requestCount: 0, bytesFetched: 0, toolCalls: 0,
      call: async () => { throw new Error("No new source needed to capture prompt"); } }),
    contextFor: async () => ({ brief: "Chandler, Arizona: when the council next meets", reason: "Missing council agenda", blanks: 1,
      handed: { artifactIds: ["chandler-saved"] },
      tools: { spaceOut: async () => {}, vault: async () => ({ stored: true, where: "fixture", why: "saved page" }) } }),
  });
  await executor.run({ obligation: scheduled, routeTaskId: "pb01-task", workItemId: "pb01-work", attemptId: "pb01-attempt", executor: "BOUNDED_MODEL_WORKER",
    bound: { maxAttempts: 1, maxWallMs: 1000, maxCostUnits: 1 }, holder: "fixture" });
  assert.match(sent!.system[0].text, /Copy values verbatim/);
  assert.equal(loggedPrompt, sent!.system[0].text);
  const row = await repos.fieldManual.mustRead(fieldManualEntryId("role-playbook", "HUNTER"));
  const view = playbookEditView([row.value], "HUNTER");
  assert.equal(view.history[0].before, initial.text);
  assert.equal(view.history[0].factory, undefined);
  await savePlaybook({ type: "playbook.update", role: "HUNTER", text: view.undo!.text, expectedVersion: view.version, why: "Undo", undoOf: view.undo!.id }, "word-undo", fetchImpl);
  assert.equal((await readRolePlaybook(repos, "HUNTER")).text, initial.text);
  await executor.run({ obligation: scheduled, routeTaskId: "pb01-task", workItemId: "pb01-work", attemptId: "pb01-undo-attempt", executor: "BOUNDED_MODEL_WORKER",
    bound: { maxAttempts: 1, maxWallMs: 1000, maxCostUnits: 1 }, holder: "fixture" });
  assert.match(sent!.system[0].text, /Copy values exactly/);
});

nodeTest("all ten model roles have one canonical row; missing instructions are stuck and have no fallback", async () => {
  assert.equal(EDITABLE_PLAYBOOK_ROLES.length, 10);
  for (const role of EDITABLE_PLAYBOOK_ROLES) {
    const book = rolePlaybook(playbookRows, role);
    assert.deepEqual(book.entryIds, [fieldManualEntryId("role-playbook", role)]);
    assert.equal(book.error, undefined);
  }
  const repos = emptyRepositories();
  await assert.rejects(readRolePlaybook(repos, "HUNTER"), /missing/);
  assert.match(playbookEditView([], "HUNTER").stuck!, /missing/);
});

nodeTest("Ask publication merges independent revisions with settings; one edge read supplies text, models, and classifier cap", async () => {
  const repos = createMemoryRepositories();
  let held: { snapshot: ReaderSettingsSnapshot; etag: string } | null = null, reads = 0, serial = 0;
  const store: SettingsEdgeStore = {
    async read() { reads++; return held; },
    async write(snapshot, etag) { if ((held?.etag ?? null) !== etag) return false; held = { snapshot, etag: String(++serial) }; return true; },
  };
  const options = { store, purge: async () => {} };
  await publishAskPlaybooks(repos, options);
  await publishReaderSettings({ ...defaultAdminConfig(at), settings: { "ask.classifierDailyCap": 7, "ask.readerModel": "claude-sonnet-5-5" } }, 4, options);
  const before = await readRolePlaybook(repos, "ASK_READER");
  await updateRolePlaybook(repos, { role: "ASK_READER", text: "Read carefully from the supplied inventory.", expectedVersion: before.version, id: "ask-edit", at, why: "" });
  await publishAskPlaybooks(repos, options);
  const startReads = reads;
  await withPublishedAskSettings(async () => {
    assert.match(askPlaybook("ASK_READER"), /Read carefully/);
    assert.equal(resolveAskRoleModel("READER"), "claude-sonnet-5-5");
    assert.equal(classifierCeiling(), 7);
    assert.match(askPlaybook("ASK_WRITER"), /supplied records/i);
  }, store);
  assert.equal(reads - startReads, 1);
});

nodeTest("Ask model choices use plain names and the existing Settings action, log, and undo", async () => {
  const view = projectSettings({ config: null, heartbeat: null, published: null, observedAt: at });
  const row = view.rows.find(row => row.key === "ask.readerModel")!;
  assert.equal(row.valueWords, "Claude Haiku 5.5");
  const action = settingActions(row)[0];
  const preview = actionDef(action.kind).preview({ target: action.target, targetName: row.label, scopeName: "United States", scopeIsCountry: true, outreachAuthorized: false, payload: action.payload });
  const choice = preview.options!.find(option => option.label === "Claude Sonnet 5.5")!;
  const input = actionInput(action.kind, { target: action.target, scopeKey: "us", option: choice.id, words: "Use this model", amount: "", selected: [], payload: action.payload });
  const repos = createMemoryRepositories();
  const deps = { repos, now: () => at, currentStateVersion: null, codeSha: null };
  const request = { type: "config.setSetting", subject: action.target, input, stateVersion: null, idempotencyKey: "ask-model", caller: "OWNER_SESSION" as const, actorRef: "owner" };
  assert.equal((await submit(request, deps)).ok, true);
  const config = (await repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { settingHistory: true })).value;
  assert.equal(config.settings?.["ask.readerModel"], choice.id);
  assert.equal(config.settingHistory?.at(-1)?.before, "claude-haiku-5-5");
  assert.equal(config.settingHistory?.at(-1)?.factory, undefined);
  const changedRow = projectSettings({ config, heartbeat: null, published: null, observedAt: at }).rows.find(row => row.key === action.target)!;
  const undo = settingActions(changedRow)[1];
  const undoInput = actionInput(undo.kind, { target: undo.target, scopeKey: "us", option: null, words: "Undo", amount: "", selected: [], payload: undo.payload });
  assert.equal((await submit({ ...request, input: undoInput, idempotencyKey: "ask-model-undo" }, deps)).ok, true);
  assert.equal((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { settingHistory: true })).value.settings?.["ask.readerModel"], "claude-haiku-5-5");
});

nodeTest("restoring missing instructions can be undone to stuck work, including the Ask snapshot", async () => {
  const repos = emptyRepositories();
  const missing = playbookEditView([], "ASK_READER");
  await updateRolePlaybook(repos, { role: "ASK_READER", text: "Read the supplied inventory.", expectedVersion: missing.version, id: "restore", at, why: "Restore missing instructions" });
  const row = await repos.fieldManual.mustRead(fieldManualEntryId("role-playbook", "ASK_READER"));
  const restored = playbookEditView([row.value], "ASK_READER");
  assert.equal(restored.undo!.text, "");
  await updateRolePlaybook(repos, { role: "ASK_READER", text: "", expectedVersion: restored.version, id: "restore-undo", at, why: "Undo", undoOf: restored.undo!.id });
  await assert.rejects(readRolePlaybook(repos, "ASK_READER"), /missing/);
  let snapshot: ReaderSettingsSnapshot | null = null;
  const store: SettingsEdgeStore = { async read() { return snapshot ? { snapshot, etag: "held" } : null; }, async write(value) { snapshot = value; return true; } };
  await publishAskPlaybooks(repos, { store, purge: async () => {} });
  await withPublishedAskSettings(async () => { assert.throws(() => askPlaybook("ASK_READER"), /missing/); }, store);
});
