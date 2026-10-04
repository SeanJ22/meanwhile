import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { applyManualEdit, checkDoorDraft, isDoorRecord, type DoorDraft, type DoorRepository } from "../lib/doors/registry.ts";
import { evidenceFromFailureCode, recordDoorEvidence, SHUT_AFTER_TRANSPORT_FAILURES } from "../lib/doors/shut.ts";

const T = (n: number) => `2026-10-04T12:0${n}:00.000Z`;

/** A hand save, as the gateway does it: check the draft, carry over what the system kept, write. */
async function saveDoor(repo: DoorRepository, draft: DoorDraft, at: string): Promise<{ ok: boolean }> {
  const checked = checkDoorDraft(draft);
  if (!checked.ok) return { ok: false };
  const row = await repo.read(draft.doorId);
  const previous = row !== null && isDoorRecord(row.value) ? row.value : null;
  const next = applyManualEdit(previous, checked.value, at);
  if (row === null) await repo.put(draft.doorId, next, at);
  else await repo.compareAndSet(draft.doorId, row.revision, next, at);
  return { ok: true };
}

async function oneDoor() {
  const repos = createMemoryRepositories();
  const saved = await saveDoor(repos.doors, { doorId: "synthetic:never-served", kind: "official-page-events", hosts: ["door.example.invalid"], holds: ["meetings"] }, T(0));
  assert.equal(saved.ok, true);
  return repos.doors;
}

async function read(repo: Awaited<ReturnType<typeof oneDoor>>) {
  return (await repo.read("synthetic:never-served"))!.value;
}

describe("DB-32: a door that stops working is marked shut at once", () => {
  it("a moved address (404 or 410) shuts the door within one read, with the time and the reason", async () => {
    for (const httpStatus of [404, 410]) {
      const repo = await oneDoor();
      const result = await recordDoorEvidence(repo, "synthetic:never-served", { kind: "HTTP", httpStatus }, T(1));
      assert.equal(result.change, "SHUT");
      const door = await read(repo);
      assert.equal(door.status, "SHUT");
      assert.equal(door.shutSince, T(1));
      assert.match(door.shutReason ?? "", new RegExp(String(httpStatus)));
      assert.equal(door.lastFailureAt, T(1));
    }
  });

  it("a successful read that yields nothing shuts it only when the last good version had rows", async () => {
    const repo = await oneDoor();
    assert.equal((await recordDoorEvidence(repo, "synthetic:never-served", { kind: "EMPTY", lastGoodRows: 0 }, T(1))).change, "NONE");
    assert.equal((await read(repo)).status, "OPEN");
    assert.equal((await recordDoorEvidence(repo, "synthetic:never-served", { kind: "EMPTY", lastGoodRows: 12 }, T(2))).change, "SHUT");
    assert.match((await read(repo)).shutReason ?? "", /12/);
  });

  it("a parse failure shuts it", async () => {
    const repo = await oneDoor();
    const result = await recordDoorEvidence(repo, "synthetic:never-served", evidenceFromFailureCode("PUBLISHER_DOCUMENT_INVALID"), T(1));
    assert.equal(result.change, "SHUT");
  });

  it("transport failures shut it only at the threshold, and a good read resets the count", async () => {
    const repo = await oneDoor();
    for (let i = 1; i < SHUT_AFTER_TRANSPORT_FAILURES; i += 1) {
      assert.equal((await recordDoorEvidence(repo, "synthetic:never-served", { kind: "TRANSPORT_FAILURE" }, T(i))).change, "NONE");
    }
    assert.equal((await read(repo)).status, "OPEN");
    await recordDoorEvidence(repo, "synthetic:never-served", { kind: "GOOD", rows: 3 }, T(5));
    assert.equal((await read(repo)).transportFailures, 0);
    for (let i = 1; i < SHUT_AFTER_TRANSPORT_FAILURES; i += 1) await recordDoorEvidence(repo, "synthetic:never-served", { kind: "TRANSPORT_FAILURE" }, T(6));
    assert.equal((await read(repo)).status, "OPEN");
    assert.equal((await recordDoorEvidence(repo, "synthetic:never-served", { kind: "TRANSPORT_FAILURE" }, T(7))).change, "SHUT");
  });

  it("the next good read reopens it and records when", async () => {
    const repo = await oneDoor();
    await recordDoorEvidence(repo, "synthetic:never-served", { kind: "HTTP", httpStatus: 404 }, T(1));
    const result = await recordDoorEvidence(repo, "synthetic:never-served", { kind: "GOOD", rows: 4 }, T(4));
    assert.equal(result.change, "REOPENED");
    const door = await read(repo);
    assert.equal(door.status, "OPEN");
    assert.equal(door.shutSince, null);
    assert.equal(door.shutReason, null);
    assert.equal(door.reopenedAt, T(4));
    assert.equal(door.lastSuccessAt, T(4));
  });

  it("a door set aside is never shut or reopened by a read, and a door that is already shut keeps its first time", async () => {
    const repos = createMemoryRepositories();
    await saveDoor(repos.doors, { doorId: "synthetic:aside", kind: "official-page-events", hosts: ["a.example.invalid"], status: "SUSPENDED" }, T(0));
    assert.equal((await recordDoorEvidence(repos.doors, "synthetic:aside", { kind: "HTTP", httpStatus: 404 }, T(1))).change, "NONE");
    const repo = await oneDoor();
    await recordDoorEvidence(repo, "synthetic:never-served", { kind: "HTTP", httpStatus: 404 }, T(1));
    await recordDoorEvidence(repo, "synthetic:never-served", { kind: "HTTP", httpStatus: 404 }, T(3));
    assert.equal((await read(repo)).shutSince, T(1));
  });

  it("a read of a door that is not in the registry invents nothing", async () => {
    const repos = createMemoryRepositories();
    assert.deepEqual(await recordDoorEvidence(repos.doors, "nope", { kind: "GOOD", rows: 1 }, T(1)), { written: false, change: "NONE" });
  });

  it("a hand edit keeps the system's shut reason while the door stays shut", async () => {
    const repo = await oneDoor();
    await recordDoorEvidence(repo, "synthetic:never-served", { kind: "HTTP", httpStatus: 404 }, T(1));
    const saved = await saveDoor(repo, { doorId: "synthetic:never-served", kind: "official-page-events", hosts: ["moved.example.invalid"], status: "SHUT", holds: ["meetings"] }, T(2));
    assert.equal(saved.ok, true);
    assert.match((await read(repo)).shutReason ?? "", /404/);
  });
});
