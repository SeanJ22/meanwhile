import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_KINDS, KINDS_SETTING, kindFromSource, kindTableValid, registeredKind } from "../lib/registry/kinds.ts";
import { runtimeKinds, readerKinds } from "../lib/registry/kinds-settings.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { settingUndo } from "../lib/control-plane/settings.ts";
import { publishReaderSettings, type ReaderSettingsSnapshot, type SettingsEdgeStore } from "../lib/civic-data/reader-settings-publication.ts";
import { bodyClassShort, governVerbMayAttach } from "../lib/registry/body-class-labels.ts";
import { sourceKindLabel } from "../lib/corpus/source-kinds.ts";

const at = "2026-10-05T22:00:00Z";
test("Admin kind edits reach a fresh builder pass and the reader edge, with existing undo and spending controls", async () => {
  const repos = createMemoryRepositories();
  const table = { ...DEFAULT_KINDS,
    body: [...DEFAULT_KINDS.body, { key: "LIBRARY_DISTRICT", label: "Library district body" }],
    office: [...DEFAULT_KINDS.office, { key: "library-trustee", label: "Library trustee" }],
    statement: [...DEFAULT_KINDS.statement, { key: "PUBLIC_TESTIMONY", label: "public testimony" }],
  };
  const before = runtimeKinds(null);
  assert.equal(registeredKind(before, "body", "LIBRARY_DISTRICT"), null);
  const request = { type: "config.setSetting", subject: KINDS_SETTING,
    input: { key: KINDS_SETTING, value: table, why: "Add source-backed kinds" }, stateVersion: null,
    idempotencyKey: "library-kinds", caller: "OWNER_SESSION" as const, actorRef: "test" };
  const result = await submit(request, { repos, now: () => at, currentStateVersion: null, codeSha: null });
  assert.equal(result.ok, true);
  const config = (await repos.adminConfig.mustRead("current", { settingHistory: true })).value;
  const next = runtimeKinds(config);
  assert.equal(kindFromSource(next, "body", "Library district body"), "LIBRARY_DISTRICT");
  assert.equal(registeredKind(next, "office", "library-trustee"), "library-trustee");
  assert.equal(kindFromSource(next, "body", "Unknown district"), null);
  assert.equal(bodyClassShort("LIBRARY_DISTRICT", next), "Library district body");
  assert.equal(governVerbMayAttach("LIBRARY_DISTRICT"), false, "a kind label grants no governing relationship");
  assert.equal(sourceKindLabel("PUBLIC_TESTIMONY", next), "public testimony");
  assert.deepEqual(config.fleetSpendCeiling, defaultAdminConfig(at).fleetSpendCeiling);
  assert.deepEqual(config.expansionScopes, defaultAdminConfig(at).expansionScopes);
  assert.equal(config.apiFallback.enabled, false);
  let saved: ReaderSettingsSnapshot | null = null;
  const edge: SettingsEdgeStore = { read: async () => saved ? { snapshot: saved, etag: "1" } : null,
    write: async snapshot => { saved = snapshot; return true; } };
  assert.equal(await publishReaderSettings(config, 1, { store: edge, purge: async () => undefined }), true);
  assert.equal(registeredKind(await readerKinds(edge), "body", "LIBRARY_DISTRICT"), "LIBRARY_DISTRICT");
  const undo = settingUndo(config, config.settingHistory![0].id)!;
  assert.equal((await submit({ ...request, input: undo, idempotencyKey: "undo-library-kinds" },
    { repos, now: () => at, currentStateVersion: null, codeSha: null })).ok, true);
  assert.equal(registeredKind(runtimeKinds((await repos.adminConfig.mustRead("current", { settingHistory: true })).value), "body", "LIBRARY_DISTRICT"), null);
});

test("initial district kinds are data; invalid and ambiguous source kinds never become a guessed classification", () => {
  for (const key of ["fire_district", "water_district", "sanitation_district"]) assert.equal(registeredKind(DEFAULT_KINDS, "division", key), key);
  assert.equal(kindTableValid(DEFAULT_KINDS), true);
  assert.equal(kindTableValid({ ...DEFAULT_KINDS, body: [...DEFAULT_KINDS.body, { key: "governing", label: "duplicate" }] }), false);
  assert.equal(kindTableValid({ ...DEFAULT_KINDS, office: [{ key: "", label: "missing key" }] }), false);
  const ambiguous = { ...DEFAULT_KINDS, body: [...DEFAULT_KINDS.body, { key: "OTHER", label: "Governing" }] };
  assert.equal(kindFromSource(ambiguous, "body", "Governing"), null);
  assert.equal(governVerbMayAttach("EXECUTIVE_AGENCY"), false);
  assert.equal(governVerbMayAttach("SOVEREIGN_TRIBAL"), false);
});
