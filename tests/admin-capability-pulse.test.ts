import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_CAPABILITIES, ADMIN_CAPABILITY_NAMES } from "../lib/control-plane/admin-view/capabilities.ts";
import { adminV6ReadCapabilities, ADMIN_V6_CAPABILITIES, ADMIN_V6_CAPABILITY_REVISION } from "../lib/control-plane/admin-view/v6-capabilities.ts";
import { pulseRevision } from "../lib/control-plane/live-pulse.ts";

test("the Admin pulse advertises only implemented compatible reads", () => {
  assert.equal(ADMIN_CAPABILITIES.schemaVersion, 1);
  assert.deepEqual(Object.keys(ADMIN_CAPABILITIES.features).sort(), [...ADMIN_CAPABILITY_NAMES].sort());
  assert.deepEqual(ADMIN_CAPABILITIES.features.checklistDefinitions,
    { state: "SUPPORTED", contractVersion: 1 });
  assert.deepEqual(ADMIN_CAPABILITIES.features.checklistInstances,
    { state: "SUPPORTED", contractVersion: 1 });
  assert.deepEqual(ADMIN_CAPABILITIES.features.fixHistory,
    { state: "SUPPORTED", contractVersion: 1 });
  assert.deepEqual(ADMIN_CAPABILITIES.features.runnerProgress,
    { state: "SUPPORTED", contractVersion: 1 });
  assert.deepEqual(ADMIN_CAPABILITIES.features.publicReaderObservation,
    { state: "SUPPORTED", contractVersion: 1 });
  assert.deepEqual(ADMIN_CAPABILITIES.features.workerEvents,
    { state: "SUPPORTED", contractVersion: 1 });
  for (const name of ADMIN_CAPABILITY_NAMES.filter(name =>
    name !== "checklistDefinitions" && name !== "checklistInstances" &&
    name !== "fixHistory" && name !== "runnerProgress" &&
    name !== "publicReaderObservation" && name !== "workerEvents")) {
    assert.deepEqual(ADMIN_CAPABILITIES.features[name],
      { state: "UNAVAILABLE", contractVersion: null });
  }
});

test("a compatible backend becoming available changes the shared pulse revision", () => {
  const base = {
    beatAt: "2026-09-28T19:00:00.000Z", heartbeatRevision: 1,
    snapshotRevision: 2, decisionCount: 3, researchRevision: 4,
    receiptCount: 5, researchIntentCount: 6, sourceProgressId: "source-7",
  };
  const before = pulseRevision(base);
  const after = pulseRevision({ ...base, capabilityRevision: ADMIN_CAPABILITIES.revision });
  assert.notEqual(before, after);
  assert.equal(after, pulseRevision({ ...base, capabilityRevision: ADMIN_CAPABILITIES.revision }));
});

test("v6 keeps the guarded exact receipt read when section sources are unproved", () => {
  assert.equal(ADMIN_V6_CAPABILITIES.version, 1);
  assert.deepEqual(ADMIN_V6_CAPABILITIES.sections, {});
  assert.deepEqual(ADMIN_V6_CAPABILITIES.actions, {});
  assert.deepEqual(ADMIN_V6_CAPABILITIES.receiptLookup,
    { contract: "admin-v6/receipt@1", href: "/api/admin/v6/receipt" });
  assert.match(ADMIN_V6_CAPABILITY_REVISION, /receipt\/1/);
});

test("v6 Money and Hunts announcements follow saved policy, snapshot and fleet revisions", () => {
  const absent = adminV6ReadCapabilities({ configRevision: null, snapshotRevision: 7, researchRevision: 9 });
  assert.deepEqual(Object.keys(absent.sections).sort(), ["agents", "checklist", "publication", "reliability", "results", "sameCause", "scoreboard", "sends", "spend", "stuck"], "the weekly learning series, the place score, blockers, results, agents and spend need only the published snapshot, not the saved policy");
  assert.equal(absent.sections.hunts, undefined);
  assert.equal(absent.sections.national, undefined, "The country joins the saved hunts to the published work index, so it needs both");
  assert.deepEqual(adminV6ReadCapabilities({ configRevision: 3, snapshotRevision: null, researchRevision: 9 }).sections.checklist, undefined);
  assert.deepEqual(adminV6ReadCapabilities({ configRevision: 3, snapshotRevision: 7, researchRevision: 9, workerAgeBucket: 5 }).sections.national,
    { contract: "admin-v6/national@1", href: "/api/admin/v6/national", revision: "national:3:7:9:5" });
  assert.notEqual(adminV6ReadCapabilities({ configRevision: 3, snapshotRevision: 7, researchRevision: 9, workerAgeBucket: 6 }).sections.national.revision,
    adminV6ReadCapabilities({ configRevision: 3, snapshotRevision: 7, researchRevision: 9, workerAgeBucket: 5 }).sections.national.revision,
    "the read repeats every five minutes so place scores that were not ready fill in");
  const ready = adminV6ReadCapabilities({ configRevision: 3, snapshotRevision: 7, researchRevision: 9 });
  assert.deepEqual(ready.sections.checklist, { contract: "admin-v6/checklist@1", href: "/api/admin/v6/place", revision: "checklist:7:9" });
  assert.deepEqual(ready.sections.stuck, { contract: "admin-v6/stuck@1", href: "/api/admin/v6/stuck", revision: "stuck:7" });
  assert.deepEqual(ready.sections.hunts,
    { contract: "admin-v6/hunts@1", href: "/api/admin/v6/hunts", revision: "hunts:3:7" });
  assert.deepEqual(ready.sections.money,
    { contract: "admin-v6/money@1", href: "/api/admin/v6/money", revision: "money:3:7:9" });
  const moved = adminV6ReadCapabilities({ configRevision: 3, snapshotRevision: 8, researchRevision: 9 });
  assert.notEqual(moved.sections.hunts.revision, ready.sections.hunts.revision);
  const fleetMoved = adminV6ReadCapabilities({ configRevision: 3, snapshotRevision: 7, researchRevision: 10 });
  assert.equal(fleetMoved.sections.hunts.revision, ready.sections.hunts.revision);
  assert.notEqual(fleetMoved.sections.money.revision, ready.sections.money.revision);
});

test("v6 Workers announces the bounded read when policy and research are readable", () => {
  const base = { configRevision: 3, snapshotRevision: null, researchRevision: 9,
    heartbeatRevision: 4, sourceProgressId: "source-7", workerAgeBucket: 1 };
  const ready = adminV6ReadCapabilities(base);
  assert.deepEqual(ready.sections.workers, { contract: "admin-v6/workers@1",
    href: "/api/admin/v6/workers", revision: "workers:3:9:4:source-7:1" });
  assert.equal(ready.sections.hunts, undefined);
  assert.notEqual(adminV6ReadCapabilities({ ...base, sourceProgressId: "source-8" }).sections.workers.revision,
    ready.sections.workers.revision);
  assert.notEqual(adminV6ReadCapabilities({ ...base, heartbeatRevision: 5 }).sections.workers.revision,
    ready.sections.workers.revision);
  assert.notEqual(adminV6ReadCapabilities({ ...base, workerAgeBucket: 2 }).sections.workers.revision,
    ready.sections.workers.revision);
  assert.equal(adminV6ReadCapabilities({ ...base, researchRevision: null }).sections.workers, undefined);
});
