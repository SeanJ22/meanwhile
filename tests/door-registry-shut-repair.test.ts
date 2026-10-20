import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { fixItems } from "../lib/control-plane/fix-list.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { applyManualEdit, checkDoorDraft } from "../lib/doors/registry.ts";
import { recordDoorEvidence } from "../lib/doors/shut.ts";
import { shutDoorItems } from "../lib/control-plane/admin-view/v6-stuck-doors.ts";
import { stuckViews } from "../lib/control-plane/admin-view/v6-stuck-read.ts";

const T = (h: number) => `2026-10-04T${String(10 + h).padStart(2, "0")}:00:00.000Z`;
const ID = "synthetic:never-served";

async function setup() {
  const repos = createMemoryRepositories();
  const checked = checkDoorDraft({ doorId: ID, kind: "official-page-events", hosts: ["door.example.invalid"], holds: ["meetings"] });
  assert.ok(checked.ok);
  await repos.doors.put(ID, applyManualEdit(null, checked.value, T(0)), T(0));
  return repos;
}
async function items(repos: Awaited<ReturnType<typeof setup>>) {
  const held = await repos.adminConfig.read(ADMIN_CONFIG_ID, { fixList: true });
  return held && isAdminConfig(held.value) ? fixItems(held.value) : [];
}

describe("DB-34: shut doors go to the top, and repairs are recorded", () => {
  it("a door that shuts opens one fix item; reading again while shut adds none", async () => {
    const repos = await setup();
    await recordDoorEvidence(repos.doors, ID, { kind: "HTTP", httpStatus: 404 }, T(1), repos);
    await recordDoorEvidence(repos.doors, ID, { kind: "HTTP", httpStatus: 404 }, T(2), repos);
    const list = await items(repos);
    assert.equal(list.length, 1);
    assert.equal(list[0].state, "OPEN");
    assert.match(list[0].says, /404/);
  });

  it("a reopening completes the item with what broke, the time shut and what changed", async () => {
    const repos = await setup();
    await recordDoorEvidence(repos.doors, ID, { kind: "HTTP", httpStatus: 404 }, T(1), repos);
    await recordDoorEvidence(repos.doors, ID, { kind: "GOOD", rows: 3 }, T(5), repos);
    const [item] = await items(repos);
    assert.equal(item.state, "FIXED");
    assert.equal(item.fixedAt, T(5));
    assert.match(item.whatChanged ?? "", /Shut for 4 hours/);
    assert.match(item.before ?? "", /404/);
    assert.match(item.changedBy ?? "", /source itself/);
  });

  it("a repair by editing the record is named as such", async () => {
    const repos = await setup();
    await recordDoorEvidence(repos.doors, ID, { kind: "HTTP", httpStatus: 404 }, T(1), repos);
    const row = (await repos.doors.read(ID))!;
    const checked = checkDoorDraft({ doorId: ID, kind: "official-page-events", hosts: ["moved.example.invalid"], holds: ["meetings"], status: "SHUT", readNow: true });
    assert.ok(checked.ok);
    await repos.doors.compareAndSet(ID, row.revision, applyManualEdit(row.value, checked.value, T(2)), T(2));
    await recordDoorEvidence(repos.doors, ID, { kind: "GOOD", rows: 3 }, T(3), repos);
    const [item] = await items(repos);
    assert.match(item.changedBy ?? "", /record/);
    assert.match(item.after ?? "", /moved\.example\.invalid/);
  });

  it("without a fix list the door still shuts (the list is never the door's gate)", async () => {
    const repos = await setup();
    const r = await recordDoorEvidence(repos.doors, ID, { kind: "HTTP", httpStatus: 410 }, T(1));
    assert.equal(r.change, "SHUT");
  });

  it("shut doors lead the stuck list in every scope, longest shut first, with how long", async () => {
    const repos = await setup();
    await recordDoorEvidence(repos.doors, ID, { kind: "HTTP", httpStatus: 404 }, T(1));
    const doors = [(await repos.doors.read(ID))!.value];
    const shut = shutDoorItems(doors, T(1).replace("T11", "T13"));
    assert.equal(shut.length, 1);
    assert.match(shut[0].age, /2 hours/);
    const views = stuckViews([], "us", T(5), shut);
    assert.equal(views.items[0].id, `door:${ID}`);
    assert.equal(views.total, 1);
    assert.doesNotMatch(shut[0].title, /synthetic:/);
  });
});
