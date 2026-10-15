import assert from "node:assert/strict";
import test from "node:test";
import { runMeetingPartition } from "../scripts/ingest.ts";
import { meetingPartitionId } from "../lib/civic-data/meeting-partitions.ts";
import { RUNTIME_AUTHORITY_ENV, runtimeAuthorityEnvironment, withRoutineContract } from "../lib/civic-data/runtime-authority.ts";
import { agendaDocumentStore, type AgendaDocument } from "../lib/meetings/agenda-documents.ts";

async function asSupervisor(work: () => Promise<void>): Promise<void> {
  const keys = [RUNTIME_AUTHORITY_ENV.capability, RUNTIME_AUTHORITY_ENV.contract];
  const previous = keys.map(key => process.env[key]);
  process.env[RUNTIME_AUTHORITY_ENV.capability] = "ROUTINE_SUPERVISOR";
  delete process.env[RUNTIME_AUTHORITY_ENV.contract];
  try { await work(); }
  finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
}

test("concurrent bodies retain separate contract authority while the supervisor reads their results", async () => {
  await asSupervisor(async () => {
    let release!: () => void;
    const rendezvous = new Promise<void>(resolve => { release = resolve; });
    let started = 0;
    const contracts = ["governing", "planning"].map(body => meetingPartitionId("ical", `ocd-division/country:us/state:az/county:pima#${body}`));
    const runs = contracts.map((contract, index) => withRoutineContract(contract, async () => {
      assert.equal(runtimeAuthorityEnvironment()[RUNTIME_AUTHORITY_ENV.contract], contract);
      if (++started === contracts.length) release();
      await rendezvous;
      assert.equal(runtimeAuthorityEnvironment()[RUNTIME_AUTHORITY_ENV.capability], "ROUTINE_CONTRACT");
      assert.equal(runtimeAuthorityEnvironment()[RUNTIME_AUTHORITY_ENV.contract], contract);
      assert.equal(process.env[RUNTIME_AUTHORITY_ENV.capability], "ROUTINE_SUPERVISOR");
      assert.equal(process.env[RUNTIME_AUTHORITY_ENV.contract], undefined);
      if (index === 0) throw new Error("body read failed");
      return contract;
    }));
    assert.equal(runtimeAuthorityEnvironment()[RUNTIME_AUTHORITY_ENV.capability], "ROUTINE_SUPERVISOR");
    assert.equal(runtimeAuthorityEnvironment()[RUNTIME_AUTHORITY_ENV.contract], undefined);
    const results = await Promise.allSettled(runs);
    assert.equal(results[0]!.status, "rejected");
    assert.deepEqual(results[1], { status: "fulfilled", value: contracts[1] });
    assert.equal(runtimeAuthorityEnvironment()[RUNTIME_AUTHORITY_ENV.capability], "ROUTINE_SUPERVISOR");
    assert.equal(runtimeAuthorityEnvironment()[RUNTIME_AUTHORITY_ENV.contract], undefined);
  });
});

test("a member refused before acquisition releases the preceding body's held agendas", async () => {
  agendaDocumentStore.append({ meetingId: "prior-body:meeting", documentUrl: "https://prior.example.gov/agenda",
    contentHash: "a".repeat(64), text: "Prior body's agenda" } as AgendaDocument);
  assert.equal(agendaDocumentStore.documentCount, 1);
  await assert.rejects(runMeetingPartition("invalid-partition"), /MEETING_DEPENDENCY_BODY_REQUIRED/);
  assert.equal(agendaDocumentStore.documentCount, 0);
});
