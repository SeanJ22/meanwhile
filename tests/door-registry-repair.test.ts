import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { fixItems } from "../lib/control-plane/fix-list.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { DOOR_ACTIONS } from "../lib/doors/actions.ts";
import { applyManualEdit, checkDoorDraft, editableFieldsOf } from "../lib/doors/registry.ts";
import { repairDoor } from "../lib/doors/repair.ts";
import { recordDoorEvidence } from "../lib/doors/shut.ts";

const T = (h: number) => `2026-10-04T${String(10 + h).padStart(2, "0")}:00:00.000Z`;
const ID = "synthetic:never-served";

async function shutDoor() {
  const repos = createMemoryRepositories();
  const checked = checkDoorDraft({ doorId: ID, kind: "official-page-events", hosts: ["old.example.invalid"], holds: ["meetings"] });
  assert.ok(checked.ok);
  await repos.doors.put(ID, applyManualEdit(null, checked.value, T(0)), T(0));
  await recordDoorEvidence(repos.doors, ID, { kind: "HTTP", httpStatus: 404 }, T(1), repos);
  return repos;
}
const fixes = async (repos: Awaited<ReturnType<typeof shutDoor>>) => {
  const held = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  return held && isAdminConfig(held.value) ? fixItems(held.value) : [];
};

describe("DB-35: a door is repaired by editing its record", () => {
  it("an address edit reads next pass, keeps the door shut until a read works, then reopens and records the repair", async () => {
    const repos = await shutDoor();
    const r = await repairDoor(repos, ID, { hosts: ["new.example.invalid"] }, T(2));
    assert.ok(r.ok);
    assert.deepEqual(r.changed, ["hosts"]);
    const edited = (await repos.doors.read(ID))!.value;
    assert.equal(edited.status, "SHUT");
    assert.equal(edited.readNow, true);
    assert.deepEqual(edited.hosts, ["new.example.invalid"]);
    assert.equal((await fixes(repos))[0].state, "FIXING");
    await recordDoorEvidence(repos.doors, ID, { kind: "GOOD", rows: 4 }, T(3), repos);
    assert.equal((await repos.doors.read(ID))!.value.status, "OPEN");
    const [item] = await fixes(repos);
    assert.equal(item.state, "FIXED");
    assert.match(item.after ?? "", /new\.example\.invalid/);
  });

  it("refuses an unknown door or a bad field and changes nothing", async () => {
    const repos = await shutDoor();
    assert.equal((await repairDoor(repos, "nope", { hosts: ["a.example.invalid"] }, T(2))).ok, false);
    assert.equal((await repairDoor(repos, ID, { hosts: ["not a host"] }, T(2))).ok, false);
    assert.deepEqual((await repos.doors.read(ID))!.value.hosts, ["old.example.invalid"]);
  });

  it("the gateway action needs a why, and Undo restores the old record", async () => {
    const repos = await shutDoor();
    const action = DOOR_ACTIONS.find((a) => a.definition.type === "door.update")!;
    assert.equal(action.validate({ doorId: ID, hosts: ["new.example.invalid"] }).ok, false);
    const v = action.validate({ doorId: ID, why: "the site moved", hosts: ["new.example.invalid"] });
    assert.ok(v.ok);
    const before = editableFieldsOf((await repos.doors.read(ID))!.value);
    const result = await action.execute({ repos } as never, { request: {} as never, receiptId: "r1", at: T(2) }, v.value);
    assert.ok(result.ok);
    assert.match(result.says, /new\.example\.invalid|hosts/);
    const back = await repairDoor(repos, ID, before, T(3));
    assert.ok(back.ok);
    assert.deepEqual((await repos.doors.read(ID))!.value.hosts, ["old.example.invalid"]);
  });
});
