import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { AUTOMATIC_REFRESH_CONTRACT_IDS } from "@/lib/civic-data/automatic-refresh.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "@/lib/civic-data/contracts.ts";
import { FEC_STATES, fecFundingContractId, fecFundingScope } from "@/lib/civic-data/fec-state-scope.ts";
import { feedDoorDrafts, keyRefFor, seedFeedDoors } from "@/lib/doors/seed-feeds.ts";
import { listDoors } from "@/lib/doors/registry.ts";

const AT = "2026-10-04T12:00:00.000Z";

test("every routine contract and every daily automatic refresh task has a door", async () => {
  const repos = createMemoryRepositories();
  const counts = await seedFeedDoors({ repo: repos.doors, deriveInputAt: AT, at: AT });
  assert.deepEqual(counts.refused, []);
  const { doors } = await listDoors(repos.doors);
  const ids = new Set(doors.map((d) => d.doorId));
  for (const contract of ROUTINE_SOURCE_CONTRACTS) assert.ok(ids.has(`feed:${contract.id}`), contract.id);
  for (const id of AUTOMATIC_REFRESH_CONTRACT_IDS) {
    assert.ok(ids.has(`feed:${id}`), id);
    const door = doors.find((d) => d.doorId === `feed:${id}`)!;
    assert.equal(door.checkEveryMinutes, 1440, "automatic refresh is daily");
    assert.equal(door.config.refresh, "automatic");
  }
  assert.equal(doors.length, feedDoorDrafts().length);
});

test("feed doors name their key and never hold one", () => {
  const drafts = feedDoorDrafts();
  const fecDoors = drafts.filter((draft) => draft.doorId.startsWith("feed:fec-funding"));
  assert.deepEqual(fecDoors.map((draft) => draft.doorId).sort(), FEC_STATES.map((state) => `feed:${fecFundingContractId(state)}`).sort());
  for (const state of FEC_STATES) {
    const fec = fecDoors.find((draft) => draft.doorId === `feed:${fecFundingContractId(state)}`)!;
    assert.equal(fec.config?.keyRef, "FEC_API_KEY");
    assert.equal(fec.config?.scope, fecFundingScope(state));
    assert.deepEqual(fec.hosts, ["api.open.fec.gov", "www.fec.gov"]);
  }
  assert.equal(keyRefFor("dotgov", "cisa-dotgov-registry"), null);
  for (const draft of drafts) {
    for (const [key, value] of Object.entries(draft.config ?? {})) {
      if (/key/i.test(key)) assert.match(String(value), /^[A-Z][A-Z0-9_]+$/, `${draft.doorId} ${key} is a name, not a secret`);
    }
  }
});

test("seeding feeds twice changes nothing", async () => {
  const repos = createMemoryRepositories();
  await seedFeedDoors({ repo: repos.doors, deriveInputAt: AT, at: AT });
  const again = await seedFeedDoors({ repo: repos.doors, deriveInputAt: AT, at: AT });
  assert.equal(again.created + again.updated, 0);
  assert.ok(again.unchanged > 20);
});
