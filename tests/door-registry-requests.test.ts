import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { projectRoutineDataObservabilityRead } from "../lib/civic-data/observability.ts";
import { requestRoutineRefresh } from "../lib/civic-data/owner-refresh.ts";
import { requestRoutineDue } from "../lib/civic-data/routine-due-request.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { refreshDoorsForPass } from "../lib/doors/install.ts";
import { seedMeetingDoors } from "../lib/doors/seed-meetings.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { FIXTURE_DOOR_ROWS, installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";

const code = FIXTURE_DOOR_ROWS.slice();
const AT = "2026-10-04T12:00:00.000Z";

async function repoWithDoors(extra: readonly BodySourceWiring[]) {
  const repos = createMemoryRepositories();
  await seedMeetingDoors({ repo: repos.doors, wiring: [...code, ...extra], derived: [], deriveInputAt: AT, at: AT });
  return repos;
}

function addedDoor(): BodySourceWiring {
  const example = code[0]!;
  return { ...example, bodyId: `${example.bodyId}-added-by-a-door-row` };
}

describe("DB-14: refresh requests and observability read the registry", () => {
  afterEach(() => installFixtureDoors());

  it("an owner refresh may name a partition that exists only as a door row", async () => {
    const added = addedDoor();
    const repos = await repoWithDoors([added]);
    await refreshDoorsForPass(repos.doors);
    const id = MEETING_PARTITION_CONTRACTS.find((c) => c.bodyId === added.bodyId)!.id;
    installFixtureDoors();
    assert.equal(MEETING_PARTITION_CONTRACTS.some((c) => c.id === id), false);
    const request = await requestRoutineRefresh(repos, [`--contract=${id}`], AT);
    assert.equal(request.contractId, id);
  });

  it("a partition whose door is not in the registry is refused", async () => {
    const added = addedDoor();
    const withDoor = await repoWithDoors([added]);
    await refreshDoorsForPass(withDoor.doors);
    const id = MEETING_PARTITION_CONTRACTS.find((c) => c.bodyId === added.bodyId)!.id;
    const repos = await repoWithDoors([]);
    await assert.rejects(requestRoutineRefresh(repos, [`--contract=${id}`], AT), /REGISTERED_CONTRACT_REQUIRED/);
    await assert.rejects(requestRoutineDue(repos, [`--contract=${id}`], AT));
  });

  it("the observability read brings the doors in before it projects, so the added door is listed", async () => {
    const added = addedDoor();
    const repos = await repoWithDoors([added]);
    const rows = { candidates: [], events: [], promotions: [] };
    const without = await projectRoutineDataObservabilityRead({ now: AT, connected: true, readRows: async () => rows });
    const withDoors = await projectRoutineDataObservabilityRead({
      now: AT,
      connected: true,
      adoptDoors: () => refreshDoorsForPass(repos.doors),
      readRows: async () => rows,
    });
    assert.equal(without.kind, "HELD");
    assert.equal(withDoors.kind, "HELD");
    const id = MEETING_PARTITION_CONTRACTS.find((c) => c.bodyId === added.bodyId)!.id;
    assert.equal(JSON.stringify(without).includes(id), false);
    assert.equal(JSON.stringify(withDoors).includes(id), true);
  });
});
