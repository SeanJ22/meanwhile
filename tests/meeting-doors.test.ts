import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { processRegisteredFanOutCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
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
const stateOfDoor = (door: DoorRecord): string => {
  const [state] = registryJurisdictions(door.ocdId ?? door.bodyIds[0]);
  assert.ok(state, `${door.doorId} names its state through its division or body`);
  return state;
};
const bodyIds = () => [...new Set(activeWiring().map((row) => row.bodyId))].sort();

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
    const { rows: base } = await registryRows();
    const states = [...new Set(base.map((row) => stateOfDoor(row.value)))].sort();
    assert.deepEqual(states, ["AZ", "NH", "NJ"], "all previously covered fixture states remain in the publication test");
    const clock = Date.now();
    for (const state of states) {
      const selected = base.filter((row) => stateOfDoor(row.value) === state);
      const candidate = meetingDoorsCandidate(selected, AT, state);
      const outcome = await processRegisteredFanOutCandidate(store, MEETING_DOORS_CONTRACT_ID, candidate, AT);
      assert.equal(outcome.candidate.state, "PROMOTED");
      assert.ok(outcome.promoted !== null);
      const read = await readMeetingDoors({ state, store, bypassCache: true, now: AT });
      assert.equal(read.kind, "PROMOTED");
      assert.equal(read.metadata.scope, `meeting-doors:${state}`);
      assert.deepEqual(read.value, meetingDoorsProjection(selected.map((row) => row.value)), "each state's complete doors and body links round-trip");
      const installed = await ensureMeetingDoors({ state, store, clock: () => clock });
      assert.equal(installed.ready, true);
      assert.deepEqual(bodyIds(), [...new Set(selected.flatMap((row) => row.value.bodyIds))].sort(), "the process installs every body from the selected state");
    }
    const door = added();
    const [state] = registryJurisdictions(door.ocdId ?? door.bodyId);
    assert.ok(state);
    const initial = await ensureMeetingDoors({ state, store, clock: () => clock });
    assert.equal(initial.ready, true);
    assert.ok(!activeWiring().some((row) => row.bodyId === door.bodyId));
    const { rows } = await registryRows([door]);
    const selected = rows.filter((row) => stateOfDoor(row.value) === state);
    const outcome = await processRegisteredFanOutCandidate(store, MEETING_DOORS_CONTRACT_ID, meetingDoorsCandidate(selected, AT, state), AT);
    assert.equal(outcome.candidate.state, "PROMOTED");
    assert.ok(outcome.promoted !== null);
    assert.equal(outcome.confirmed, undefined, "an added door advances the state pointer");
    assert.notEqual(outcome.promoted.versionId, initial.ready && initial.versionId);
    assert.deepEqual(outcome.candidate.candidate.changeSet?.added.map((delta) => delta.key).sort(),
      selected.filter((row) => row.value.bodyIds.includes(door.bodyId)).map((row) => `meeting-door:${row.value.doorId}`).sort());
    const read = await readMeetingDoors({ state, store, bypassCache: true, now: AT });
    assert.equal(read.kind, "PROMOTED");
    assert.equal(read.metadata.versionId, outcome.promoted.versionId);
    assert.ok(read.value?.doors.some((published) => published.bodyIds.includes(door.bodyId)), "the new state version holds the added body's door");
    const unchanged = await processRegisteredFanOutCandidate(store, MEETING_DOORS_CONTRACT_ID, meetingDoorsCandidate(selected, AT, state), AT);
    assert.equal(unchanged.confirmed?.versionId, read.metadata.versionId, "the same state doors re-confirm their existing version");

    // This process installed doors just now; once they are older than the refresh window it reads the version again.
    const later = clock + MEETING_DOORS_REFRESH_MS + 1;
    const answered = await ensureMeetingDoors({ state, store, clock: () => later });
    assert.equal(answered.ready, true, "a process that has doors answers at once while it reads again");
    assert.equal(answered.ready && answered.versionId, initial.ready && initial.versionId, "the background refresh first answers with the installed state version");
    for (let i = 0; i < 200 && !activeWiring().some((row) => row.bodyId === door.bodyId); i++) await new Promise((r) => setTimeout(r, 5));
    const refreshed = await ensureMeetingDoors({ state, store, clock: () => later });
    assert.equal(refreshed.ready && refreshed.versionId, read.metadata.versionId, "the process reads the newly promoted state version");
    assert.ok(activeWiring().some((row) => row.bodyId === door.bodyId));
    assert.ok(MEETING_PARTITION_CONTRACTS.some((partition) => partition.bodyId === door.bodyId));
    assert.ok(ROUTINE_SOURCE_TASKS.some((task) => task.id.includes(encodeURIComponent(door.bodyId))), "the standing task list follows the doors installed");
    const again = await ensureMeetingDoors({ state, store, clock: () => later });
    assert.equal(again.ready && again.versionId, read.metadata.versionId);
  });

  it("a version that cannot be read leaves the installed doors in place", async () => {
    const store = new MemoryRoutineDataStore();
    const { rows } = await registryRows();
    const clock = Date.now();
    const states = [...new Set(rows.map((row) => stateOfDoor(row.value)))].sort();
    assert.deepEqual(states, ["AZ", "NH", "NJ"]);
    for (const state of states) {
      const selected = rows.filter((row) => stateOfDoor(row.value) === state);
      const outcome = await processRegisteredFanOutCandidate(store, MEETING_DOORS_CONTRACT_ID, meetingDoorsCandidate(selected, AT, state), AT);
      assert.equal(outcome.candidate.state, "PROMOTED");
      const installed = await ensureMeetingDoors({ state, store, clock: () => clock });
      assert.equal(installed.ready, true);
      const before = bodyIds();
      const later = clock + MEETING_DOORS_REFRESH_MS + 1;
      const answered = await ensureMeetingDoors({ state, store: new MemoryRoutineDataStore(), clock: () => later });
      assert.equal(answered.ready, true);
      await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(bodyIds(), before, `${state} keeps every installed body when its next version cannot be read`);
    }
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
