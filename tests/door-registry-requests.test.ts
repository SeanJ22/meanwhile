import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MEETING_PARTITION_CONTRACTS, refreshMeetingPartitions } from "../lib/civic-data/meeting-partitions.ts";
import { projectRoutineDataObservabilityRead } from "../lib/civic-data/observability.ts";
import { requestRoutineRefresh } from "../lib/civic-data/owner-refresh.ts";
import { requestRoutineDue } from "../lib/civic-data/routine-due-request.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { refreshDoorsForPass } from "../lib/doors/install.ts";
import { seedMeetingDoors } from "../lib/doors/seed-meetings.ts";
import { installRegistryWiring, SOURCE_WIRING, type BodySourceWiring } from "../lib/registry/source-wiring.ts";

const code = SOURCE_WIRING.slice();
const AT = "2026-10-04T12:00:00.000Z";

function restore(): void {
  delete process.env.WTP_DOORS_READ;
  installRegistryWiring(null);
  refreshMeetingPartitions(code);
}

async function repoWithAddedDoor() {
  const repos = createMemoryRepositories();
  const example = code[0]!;
  const added: BodySourceWiring = { ...example, bodyId: `${example.bodyId}-added-by-a-door-row` };
  await seedMeetingDoors({ repo: repos.doors, wiring: [...code, added], derived: [], deriveInputAt: AT, at: AT });
  return { repos, added };
}

describe("DB-14: refresh requests and observability read the registry", () => {
  afterEach(restore);

  it("an owner refresh may name a partition that exists only as a door row", async () => {
    const { repos, added } = await repoWithAddedDoor();
    process.env.WTP_DOORS_READ = "registry";
    await refreshDoorsForPass(repos.doors);
    const id = MEETING_PARTITION_CONTRACTS.find((c) => c.bodyId === added.bodyId)!.id;
    restore();
    process.env.WTP_DOORS_READ = "registry";
    assert.equal(MEETING_PARTITION_CONTRACTS.some((c) => c.id === id), false);
    const request = await requestRoutineRefresh(repos, [`--contract=${id}`], AT);
    assert.equal(request.contractId, id);
  });

  it("the same request is refused with the switch off", async () => {
    const { repos, added } = await repoWithAddedDoor();
    process.env.WTP_DOORS_READ = "registry";
    await refreshDoorsForPass(repos.doors);
    const id = MEETING_PARTITION_CONTRACTS.find((c) => c.bodyId === added.bodyId)!.id;
    restore();
    await assert.rejects(requestRoutineRefresh(repos, [`--contract=${id}`], AT), /REGISTERED_CONTRACT_REQUIRED/);
    await assert.rejects(requestRoutineDue(repos, [`--contract=${id}`], AT));
  });

  it("the observability read brings the doors in before it projects, so the added door is listed", async () => {
    const { repos, added } = await repoWithAddedDoor();
    process.env.WTP_DOORS_READ = "registry";
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
