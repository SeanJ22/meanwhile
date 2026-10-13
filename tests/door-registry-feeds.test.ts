import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { AUTOMATIC_REFRESH_CONTRACT_IDS } from "@/lib/civic-data/automatic-refresh.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "@/lib/civic-data/contracts.ts";
import { ensurePeopleFeedDoors, feedDoorDrafts, keyRefFor, seedFeedDoors } from "@/lib/doors/seed-feeds.ts";
import { listDoors, upsertDerivedDoor } from "@/lib/doors/registry.ts";

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
  const fec = feedDoorDrafts().find((d) => d.doorId === "feed:fec-funding")!;
  assert.equal(fec.config?.keyRef, "FEC_API_KEY");
  assert.deepEqual(fec.hosts, ["api.open.fec.gov"]);
  assert.equal(keyRefFor("dotgov", "cisa-dotgov-registry"), null);
  for (const draft of feedDoorDrafts()) {
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

test("first-use people coverage upgrades preserve saved settings, status and both read-now clocks", async () => {
  const repos = createMemoryRepositories();
  const drafts = feedDoorDrafts();
  const ids = ["feed:congress-bulk-roster", "feed:openstates-people-fl", "feed:official-legislature-fl"];
  const statuses = ["OPEN", "SUSPENDED", "SHUT"] as const;
  for (const [index, id] of ids.entries()) {
    const draft = drafts.find(draft => draft.doorId === id)!;
    await upsertDerivedDoor(repos.doors, { ...draft, ocdId: null, status: statuses[index], readNow: true,
      notes: "Sean's saved source note", checkEveryMinutes: 720, config: { ...draft.config, customSetting: "keep" } }, AT, AT);
    const row = await repos.doors.mustRead(id);
    await repos.doors.compareAndSet(id, row.revision, { ...row.value, editedAt: AT }, AT);
  }
  const unrelated = drafts.find(draft => draft.doorId === "feed:openstates-people-az")!;
  await upsertDerivedDoor(repos.doors, { ...unrelated, ocdId: null }, AT, AT);
  const before = await Promise.all([...ids, unrelated.doorId].map(id => repos.doors.mustRead(id)));
  const counts = await ensurePeopleFeedDoors({ repo: repos.doors, divisions: ["ocd-division/country:us/state:fl/cd:20"], at: "2026-10-13T05:00:00.000Z" });
  assert.equal(counts.updated, ids.length);
  assert.ok(counts.created > 0, "the previously absent official federal feeds are registered before a first check");
  for (const old of before.slice(0, ids.length)) {
    const after = await repos.doors.mustRead(old.id);
    const division = drafts.find(draft => draft.doorId === old.id)!.ocdId;
    assert.deepEqual(after.value, { ...old.value, ocdId: division }, "only the contract's intrinsic division is repaired");
    assert.equal(after.updatedAt, old.updatedAt, "the aggregate read-now clock also stays held");
    assert.equal(after.revision, old.revision + 1);
  }
  assert.deepEqual(await repos.doors.mustRead(unrelated.doorId), before.at(-1), "other states are not derived or repaired");
  assert.equal(await repos.doors.read("feed:fec-funding"), null, "the check does not register unrelated record classes");
  const again = await ensurePeopleFeedDoors({ repo: repos.doors, divisions: ["ocd-division/country:us/state:fl/cd:20"], at: "2026-10-13T05:01:00.000Z" });
  assert.equal(again.created + again.updated, 0);
});

test("a concurrent people-feed edit is reread before intrinsic coverage is repaired", async t => {
  const repos = createMemoryRepositories();
  const id = "feed:congress-bulk-roster";
  const draft = feedDoorDrafts().find(draft => draft.doorId === id)!;
  await upsertDerivedDoor(repos.doors, { ...draft, ocdId: null }, AT, AT);
  const compareAndSet = repos.doors.compareAndSet;
  const changedAt = "2026-10-13T04:59:00.000Z";
  let raced = false;
  t.mock.method(repos.doors, "compareAndSet", async (...args: Parameters<typeof compareAndSet>) => {
    const [key, revision, next, at] = args;
    if (key === id && !raced) {
      raced = true;
      const held = await repos.doors.mustRead(id);
      await compareAndSet(key, held.revision, { ...held.value, status: "SUSPENDED", notes: "Concurrent owner note",
        editedAt: changedAt, updatedAt: changedAt, readNow: true, config: { ...held.value.config, customSetting: "new" } }, changedAt);
    }
    return compareAndSet(key, revision, next, at);
  });
  await ensurePeopleFeedDoors({ repo: repos.doors, divisions: ["ocd-division/country:us/state:fl"], at: "2026-10-13T05:00:00.000Z" });
  const result = await repos.doors.mustRead(id);
  assert.equal(raced, true);
  assert.equal(result.value.ocdId, "ocd-division/country:us");
  assert.equal(result.value.status, "SUSPENDED");
  assert.equal(result.value.notes, "Concurrent owner note");
  assert.equal(result.value.config.customSetting, "new");
  assert.equal(result.value.readNow, true);
  assert.equal(result.value.editedAt, changedAt);
  assert.equal(result.value.updatedAt, changedAt);
  assert.equal(result.updatedAt, changedAt);
});
