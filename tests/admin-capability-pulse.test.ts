import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_CAPABILITIES, ADMIN_CAPABILITY_NAMES } from "../lib/control-plane/admin-view/capabilities.ts";
import { ADMIN_V6_CAPABILITIES, ADMIN_V6_CAPABILITY_REVISION } from "../lib/control-plane/admin-view/v6-capabilities.ts";
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

test("v6 advertises only the implemented guarded exact receipt read", () => {
  assert.equal(ADMIN_V6_CAPABILITIES.version, 1);
  assert.deepEqual(ADMIN_V6_CAPABILITIES.sections, {});
  assert.deepEqual(ADMIN_V6_CAPABILITIES.actions, {});
  assert.deepEqual(ADMIN_V6_CAPABILITIES.receiptLookup,
    { contract: "admin-v6/receipt@1", href: "/api/admin/v6/receipt" });
  assert.match(ADMIN_V6_CAPABILITY_REVISION, /receipt\/1/);
});
