import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { applyManualEdit, checkDoorDraft } from "../lib/doors/registry.ts";
import { visitDoorRecords } from "../lib/doors/streamed-read.ts";
import { runHourlyProbes } from "../lib/doors/hourly-check.ts";
import { markDoorsReadNow, settleReadNow } from "../lib/doors/mission-refresh.ts";
import { withObservedDoorRates } from "../lib/doors/observed-rate.ts";

const now = "2026-10-20T12:00:00.000Z";
test("door upkeep reads configurations one at a time and shares one URL probe across states", async () => {
  const repo = createMemoryRepositories().doors;
  for (const state of ["NH", "AZ"]) {
    const draft = checkDoorDraft({ doorId: `door:${state}`, kind: "official-page-events",
      ocdId: `ocd-division/country:us/state:${state.toLowerCase()}`, config: { url: "https://example.invalid/feed", evidence: "foreign-body".repeat(100_000) },
      hosts: ["example.invalid"], holds: ["meetings"], meeting: { agendaSourceType: "ICAL", jurisdiction: state,
        publishingOrg: "Fixture body", timeZone: "America/New_York", verifiedAt: now, family: `partition:${state}` } });
    assert.ok(draft.ok);
    const door = applyManualEdit(null, draft.value, now);
    await repo.put(door.doorId, { ...door, validators: { etag: null, lastModified: null, contentHash: null,
      changedAt: null, checkedAt: state === "NH" ? "2026-10-19T11:00:00.000Z" : "2026-10-19T10:00:00.000Z" } }, now);
  }
  let reads = 0, visits = 0, requests = 0;
  const fail = async (): Promise<never> => { throw Error("country door export"); };
  const scoped = { ...repo, list: fail, listNarrowed: fail,
    read: async (id: string) => { reads++; assert.equal(reads, visits + 1); return repo.read(id); },
    listChangedSince: async (...args: Parameters<NonNullable<typeof repo.listChangedSince>>) => {
      assert.ok(args[2]?.projection);
      assert.equal(Object.hasOwn(args[2].projection, "config"), false);
      return repo.listChangedSince!(...args);
    } };
  const order: string[] = [];
  const total = { looked: 0, changed: 0, requests: 0 };
  await visitDoorRecords(scoped, async (door, cache) => {
    visits++; order.push(door.doorId);
    const result = await runHourlyProbes(repo, [door], new Set(["partition:AZ", "partition:NH"]), async () => {
      requests++; return { status: 200, headers: new Headers(), bytes: async () => new TextEncoder().encode("same feed") };
    }, now, cache);
    total.looked += result.looked; total.changed += result.changed; total.requests += result.requests;
  }, "CHECKED");
  assert.deepEqual(order, ["door:AZ", "door:NH"]);
  assert.deepEqual(total, { looked: 2, changed: 1, requests: 1 });
  assert.equal(requests, 1);
  const bounded = { ...repo, list: fail, listNarrowed: fail };
  const marked = await markDoorsReadNow(bounded, ["ocd-division/country:us/state:az"], now);
  assert.equal(marked.marked, 1);
  assert.equal((await repo.mustRead("door:NH")).value.readNow, false);
  assert.equal(await settleReadNow(bounded, "2026-10-20T15:00:00.000Z"), 1);
  const az = await repo.mustRead("door:AZ");
  await repo.compareAndSet(az.id, az.revision, { ...az.value, observedChangeMinutes: 180 }, now);
  await withObservedDoorRates({ ...scoped, read: fail }, async rate => {
    assert.equal(rate("door:AZ"), 180); assert.equal(rate("door:NH"), undefined);
  }, error => { throw error; });
});
