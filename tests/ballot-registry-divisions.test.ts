import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoutineDataStore, PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";

const divisions = ["one", "ambiguous"].map(id => ({ state: "NH", label: "Alder County",
  ocdId: `ocd-division/country:us/state:nh/county:${id}`, sourceDataset: "TIGER", unrelated: "x".repeat(600) }));
const expected = divisions.map(({ ocdId, label, state, sourceDataset }) => ({ ocdId, label, state, sourceDataset }));

test("ballot workers read one named state's registry and match its division labels", async () => {
  const scope = stateRegistryRuntimeScope("NH");
  const pointer = { key: `REGISTRY_RUNTIME_BINDING:${scope}`, scope,
    payload: { registry: { divisions, bodies: [{ unrelated: "y".repeat(100_000) }] } }, receipt: { decision: "GOOD" } };
  const memory = new MemoryRoutineDataStore();
  Object.assign(memory, { promotions: new Map([[pointer.key, pointer]]) });
  assert.deepEqual(await memory.readRegistryDivisions("NH", ["ALDER, COUNTY"]), expected);
  assert.deepEqual(await memory.readRegistryDivisions("AZ", ["Alder County"]), []);
  const calls: string[] = [];
  const reader = { async readPromotion(recordClass: string, selectedScope: string) {
    calls.push(`${recordClass}:${selectedScope}`);
    assert.equal(selectedScope, scope);
    return pointer;
  } } as unknown as PostgresRoutineDataStore;
  assert.deepEqual(await PostgresRoutineDataStore.prototype.readRegistryDivisions.call(reader, "NH", ["ALDER, COUNTY"]), expected);
  assert.deepEqual(calls, [pointer.key]);
  assert.deepEqual(await PostgresRoutineDataStore.prototype.readRegistryDivisions.call(reader, "NH", []), []);
  assert.equal(calls.length, 1);
});

test("a legacy national pointer cannot stand in for an absent state registry", async () => {
  const memory = new MemoryRoutineDataStore();
  Object.assign(memory, { promotions: new Map([["REGISTRY_RUNTIME_BINDING:US:reader-registry-runtime-bindings", {
    payload: { registry: { divisions } }, receipt: { decision: "GOOD" },
  }]]) });
  assert.deepEqual(await memory.readRegistryDivisions("NH", ["Alder County"]), []);
});
