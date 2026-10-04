import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import { lookupAction, type GatewayDeps } from "@/lib/control-plane/gateway/registry.ts";
import { readReceipts } from "@/lib/control-plane/gateway/receipts.ts";
import type { ActionRequest } from "@/lib/control-plane/gateway/contract.ts";
import { AGGREGATE_KINDS, DECLARED_TABLES } from "@/lib/control-plane/repository/pg-schema.ts";
import { checkDoorDraft, listDoors, upsertDerivedDoor, type DoorDraft } from "@/lib/doors/registry.ts";

const T0 = "2026-10-04T10:00:00.000Z";
const T1 = "2026-10-04T11:00:00.000Z";
const T2 = "2026-10-04T12:00:00.000Z";

function deps(repos: ReturnType<typeof createMemoryRepositories>, at = T1): GatewayDeps {
  return { repos, now: () => at, currentStateVersion: null, codeSha: null };
}

function save(input: Record<string, unknown>, key: string): ActionRequest {
  return { type: "door.save", subject: String(input.doorId), input, stateVersion: null, idempotencyKey: key, caller: "OWNER_SESSION", actorRef: "adm_test" };
}

const BASE: DoorDraft = {
  doorId: "meetings:example-portal:body-a",
  kind: "example-portal",
  bodyIds: ["body-a"],
  hosts: ["https://Portal.Example.gov/calendar"],
  holds: ["meetings"],
  config: { calendarId: "abc", apiKeyRef: "EXAMPLE_API_KEY" },
};

test("the registry is declared as a table and a repository", () => {
  assert.ok((AGGREGATE_KINDS as readonly string[]).includes("doors"));
  assert.ok(DECLARED_TABLES.includes("cp_doors"));
});

test("a door draft is checked for shape, hosts and secrets", () => {
  const ok = checkDoorDraft(BASE);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.value.hosts, ["portal.example.gov"]);
    assert.equal(ok.value.status, "OPEN");
    assert.equal(ok.value.readNow, false);
  }
  assert.equal(checkDoorDraft({ ...BASE, config: { apiKey: "sk-live-123" } }).ok, false, "a secret value is refused");
  assert.equal(checkDoorDraft({ ...BASE, hosts: ["not a host"] }).ok, false);
  assert.equal(checkDoorDraft({ ...BASE, checkEveryMinutes: 1 }).ok, false);
  assert.equal(checkDoorDraft({ ...BASE, status: "BROKEN" }).ok, false);
  assert.equal(checkDoorDraft({ ...BASE, doorId: "" }).ok, false);
});

test("door.save adds, edits and receipts, and listing puts shut doors first", async () => {
  const repos = createMemoryRepositories();
  assert.ok(lookupAction("door.save"));
  const first = await submit(save({ ...BASE }, "door-key-000001"), deps(repos, T1));
  assert.equal(first.receipt.outcome, "DONE", first.receipt.says);
  const shut = await submit(save({ ...BASE, doorId: "meetings:example-portal:body-b", bodyIds: ["body-b"], status: "SHUT" }, "door-key-000002"), deps(repos, T1));
  assert.equal(shut.receipt.outcome, "DONE", shut.receipt.says);
  const edit = await submit(save({ ...BASE, notes: "moved host", status: "SUSPENDED" }, "door-key-000003"), deps(repos, T2));
  assert.equal(edit.receipt.outcome, "DONE", edit.receipt.says);
  assert.match(edit.receipt.undo ?? "", /earlier fields/);

  const { doors, unreadable } = await listDoors(repos.doors);
  assert.equal(unreadable, 0);
  assert.deepEqual(doors.map((d) => [d.doorId, d.status]), [
    ["meetings:example-portal:body-b", "SHUT"],
    ["meetings:example-portal:body-a", "SUSPENDED"],
  ]);
  assert.equal(doors[0].shutSince, T1);
  assert.equal(doors[1].editedAt, T2);

  const refused = await submit(save({ ...BASE, config: { password: "x" } }, "door-key-000004"), deps(repos));
  assert.equal(refused.receipt.outcome, "REFUSED");
  const receipts = await readReceipts(repos);
  assert.equal(receipts.filter((r) => r.type === "door.save").length, 4, "every save and the refusal left a receipt");
});

test("derived rows upsert by door id and never overwrite a newer manual edit", async () => {
  const repos = createMemoryRepositories();
  assert.equal(await upsertDerivedDoor(repos.doors, BASE, T0, T0), "created");
  assert.equal(await upsertDerivedDoor(repos.doors, BASE, T0, T1), "unchanged");
  assert.equal(await upsertDerivedDoor(repos.doors, { ...BASE, holds: ["meetings", "agendas"] }, T1, T1), "updated");

  await submit(save({ ...BASE, notes: "hand edit", status: "SHUT" }, "door-key-000005"), deps(repos, T2));
  // The derive input is older than the hand edit: the edit stands.
  assert.equal(await upsertDerivedDoor(repos.doors, { ...BASE, holds: ["votes"] }, T1, T2), "kept-manual-edit");
  const kept = (await repos.doors.read(BASE.doorId!))!.value;
  assert.equal(kept.notes, "hand edit");
  assert.equal(kept.status, "SHUT");
  // A derive input newer than the edit applies, but never reopens a door someone shut.
  assert.equal(await upsertDerivedDoor(repos.doors, { ...BASE, holds: ["votes"] }, "2026-10-04T13:00:00.000Z", "2026-10-04T13:00:00.000Z"), "updated");
  const later = (await repos.doors.read(BASE.doorId!))!.value;
  assert.deepEqual(later.holds, ["votes"]);
  assert.equal(later.status, "SHUT");
  assert.equal(later.shutSince, T2);
});
