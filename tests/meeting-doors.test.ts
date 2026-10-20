import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { firewallRoutineContracts, meetingRouteKindContracts } from "../lib/civic-data/meeting-route-kinds.ts";
import { ROUTINE_SOURCE_TASKS } from "../lib/civic-data/runner.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  MEETING_DOORS_CONTRACT_ID,
  MEETING_DOORS_REFRESH_MS,
  ensureMeetingDoors,
  meetingDoorsCandidate,
  meetingDoorsProjection,
  meetingDoorsProjectionIssue,
  readMeetingDoors,
} from "../lib/doors/meeting-doors.ts";
import { applyManualEdit, editableFieldsOf, isDoorRecord, listDoors, type DoorRecord } from "../lib/doors/registry.ts";
import { seedMeetingDoors } from "../lib/doors/seed-meetings.ts";
import { activeWiring, meetingRouteKinds, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { CAPABILITIES } from "../lib/sources/composite/wiring.ts";
import { FIXTURE_DOOR_ROWS, installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";

const AT = "2026-10-07T13:00:00.000Z";

async function registryRows(extra: readonly BodySourceWiring[] = []) {
  const repos = createMemoryRepositories();
  await seedMeetingDoors({ repo: repos.doors, wiring: [...FIXTURE_DOOR_ROWS, ...extra], derived: [], deriveInputAt: AT, at: AT });
  const rows = (await repos.doors.list()).flatMap((row) => isDoorRecord(row.value) ? [{ revision: row.revision, updatedAt: row.updatedAt, value: row.value as DoorRecord }] : []);
  return { repos, rows };
}

const added = (): BodySourceWiring => ({ ...FIXTURE_DOOR_ROWS[0]!, bodyId: `${FIXTURE_DOOR_ROWS[0]!.bodyId}-published-door` });

describe("the published meeting doors", () => {
  afterEach(() => installFixtureDoors());

  it("hold every hand-wired door in use, each authentic as the registry row it was read from", async () => {
    const { repos, rows } = await registryRows();
    const suspended = rows[0]!.value;
    await repos.doors.compareAndSet(suspended.doorId, rows[0]!.revision, applyManualEdit(suspended, { ...editableFieldsOf(suspended), status: "SUSPENDED" }, AT), AT);
    const after = (await repos.doors.list()).map((row) => ({ revision: row.revision, updatedAt: row.updatedAt, value: row.value as DoorRecord }));
    const candidate = meetingDoorsCandidate(after, AT);
    const doors = (candidate.readModel as ReturnType<typeof meetingDoorsProjection>).doors;
    assert.equal(doors.length, after.length - 1, "a suspended door is not published");
    assert.ok(!doors.some((door) => door.doorId === suspended.doorId));
    assert.equal(candidate.retrieval.succeeded, true);
    assert.equal(candidate.semantics.violations.length, 0);
    const inputs = candidate.retrieval.derived!.inputs;
    assert.equal(inputs.length, doors.length);
    assert.ok(inputs.every((input) => input.kind === "DOOR_RECORD" && /^[0-9a-f]{64}$/.test(input.recordSha256)));
  });

  it("an empty registry publishes nothing, and a malformed version is never installed", () => {
    const empty = meetingDoorsCandidate([], AT);
    assert.equal(empty.retrieval.succeeded, false);
    assert.match(meetingDoorsProjectionIssue({ kind: "meeting-doors", formatVersion: 1, doors: [] }) ?? "", /holds no door/);
    assert.match(meetingDoorsProjectionIssue({ kind: "other" }) ?? "", /not a meeting-doors version/);
    const door = { doorId: "d", meeting: {}, status: "SUSPENDED", bodyIds: ["b"] };
    assert.match(meetingDoorsProjectionIssue({ kind: "meeting-doors", formatVersion: 1, doors: [door] }) ?? "", /not in use/);
    assert.match(meetingDoorsProjectionIssue({ kind: "meeting-doors", formatVersion: 1, doors: [{ ...door, status: "OPEN" }, { ...door, status: "OPEN" }] }) ?? "", /duplicate/);
  });

  it("promote through their own contract, and a process installs them: a new door becomes meeting work there", async () => {
    const store = new MemoryRoutineDataStore();
    const door = added();
    const { rows } = await registryRows([door]);
    const outcome = await processRegisteredRoutineCandidate(store, MEETING_DOORS_CONTRACT_ID, meetingDoorsCandidate(rows, AT), AT);
    assert.equal(outcome.candidate.state, "PROMOTED");
    assert.ok(outcome.promoted !== null);
    const read = await readMeetingDoors({ store, bypassCache: true, now: AT });
    assert.equal(read.kind, "PROMOTED");

    assert.ok(!activeWiring().some((row) => row.bodyId === door.bodyId));
    // This process installed doors just now; once they are older than the refresh window it reads the version again.
    const later = Date.now() + MEETING_DOORS_REFRESH_MS + 1;
    const answered = await ensureMeetingDoors({ store, clock: () => later });
    assert.equal(answered.ready, true, "a process that has doors answers at once while it reads again");
    for (let i = 0; i < 200 && !activeWiring().some((row) => row.bodyId === door.bodyId); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(activeWiring().some((row) => row.bodyId === door.bodyId));
    assert.ok(MEETING_PARTITION_CONTRACTS.some((partition) => partition.bodyId === door.bodyId));
    assert.ok(ROUTINE_SOURCE_TASKS.some((task) => task.id.includes(encodeURIComponent(door.bodyId))), "the standing task list follows the doors installed");
    const again = await ensureMeetingDoors({ store, clock: () => later });
    assert.equal(again.ready && again.versionId, read.metadata.versionId);
  });

  it("a version that cannot be read leaves the installed doors in place", async () => {
    const before = activeWiring().length;
    const later = Date.now() + 2 * (MEETING_DOORS_REFRESH_MS + 1);
    const answered = await ensureMeetingDoors({ store: new MemoryRoutineDataStore(), clock: () => later });
    assert.equal(answered.ready, true);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(activeWiring().length, before);
  });

  it("the registry's doors are what the publisher reads", async () => {
    const { repos } = await registryRows();
    const { doors } = await listDoors(repos.doors);
    assert.equal(meetingDoorsProjection(doors).doors.length, doors.filter((door) => door.meeting != null && door.status !== "SUSPENDED").length);
  });
});

describe("the release firewall's meeting contracts", () => {
  it("name one contract per adapter route kind, and every adapter the composite source can build", () => {
    assert.deepEqual([...meetingRouteKinds()].sort(), CAPABILITIES.map(({ name }) => name).sort());
    const kinds = meetingRouteKindContracts();
    assert.equal(kinds.length, meetingRouteKinds().length);
    assert.ok(kinds.every((contract) => contract.acquisitionAdapter.command[0] === "scripts/ingest.ts" && contract.wiring === null));
    const all = firewallRoutineContracts();
    assert.equal(new Set(all.map((contract) => contract.id)).size, all.length);
    assert.equal(new Set(all.map((contract) => contract.acquisitionAdapter.command.join(" "))).size, all.length);
    assert.ok(all.some((contract) => contract.id === MEETING_DOORS_CONTRACT_ID));
    assert.ok(!all.some((contract) => "wiring" in contract && (contract as { wiring: unknown }).wiring !== null), "no real door is a code contract");
  });
});
