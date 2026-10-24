import assert from "node:assert/strict";
import test from "node:test";
import { syncNativeSourceClock } from "../lib/civic-data/source-clock-outcome.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { applyManualEdit, checkDoorDraft, isDoorRecord } from "../lib/doors/registry.ts";

const T = (hour: number) => `2026-10-20T${String(hour).padStart(2, "0")}:00:00.000Z`;
async function setup() {
  const repo = createMemoryRepositories().doors;
  const checked = checkDoorDraft({ doorId: "feed:meeting-doors", kind: "derived-feed", hosts: [], holds: ["meetings"] });
  assert.ok(checked.ok);
  await repo.put("feed:meeting-doors", applyManualEdit(null, checked.value, T(0)), T(0));
  return repo;
}
test("native source reconciliation keeps the actual observation, never the reconciliation time", async () => {
  const repo = await setup();
  assert.equal(await syncNativeSourceClock(repo, "meeting-doors", { lastSucceededObservedAt: T(6) }, T(8)), "RECORDED");
  const row = await repo.mustRead("feed:meeting-doors");
  assert.ok(isDoorRecord(row.value));
  assert.equal(row.value.lastSuccessAt, T(6));
  assert.equal(row.value.updatedAt, T(0));
  assert.equal(await syncNativeSourceClock(repo, "meeting-doors", { lastSucceededObservedAt: T(5) }, T(8)), "CURRENT");
  assert.equal(await syncNativeSourceClock(repo, "meeting-doors", { lastSucceededObservedAt: T(9) }, T(8)), "UNVERIFIED");
  assert.equal(await syncNativeSourceClock(repo, "meeting-doors", { lastSucceededAt: T(8) }, T(8)), "UNVERIFIED");
});
test("an old native confirmation preserves a subsequent source failure", async () => {
  const repo = await setup(), row = await repo.mustRead("feed:meeting-doors");
  assert.ok(isDoorRecord(row.value));
  await repo.compareAndSet(row.id, row.revision, { ...row.value, lastFailureAt: T(7), lastFailureReason: "Source unavailable" }, T(7));
  await syncNativeSourceClock(repo, "meeting-doors", { lastSucceededObservedAt: T(6) }, T(8));
  const held = await repo.mustRead("feed:meeting-doors");
  assert.ok(isDoorRecord(held.value));
  assert.equal(held.value.lastFailureReason, "Source unavailable");
  assert.equal(held.value.lastFailureAt, T(7));
});
test("a concurrent newer success wins the reconciliation retry", async () => {
  const repo = await setup();
  let race = true;
  const concurrent = { ...repo, compareAndSet: async (...args: Parameters<typeof repo.compareAndSet>) => {
    if (race) {
      race = false;
      const row = await repo.mustRead(args[0]);
      assert.ok(isDoorRecord(row.value));
      await repo.compareAndSet(row.id, row.revision, { ...row.value, lastSuccessAt: T(7) }, T(7));
    }
    return repo.compareAndSet(...args);
  } };
  assert.equal(await syncNativeSourceClock(concurrent, "meeting-doors", { lastSucceededObservedAt: T(6) }, T(8)), "CURRENT");
  const held = await repo.mustRead("feed:meeting-doors");
  assert.ok(isDoorRecord(held.value));
  assert.equal(held.value.lastSuccessAt, T(7));
});
