import assert from "node:assert/strict";
import test from "node:test";
import { runMeetingPartition, runMeetingPartitionBatch } from "../scripts/ingest.ts";
import { RUNTIME_AUTHORITY_ENV } from "../lib/civic-data/runtime-authority.ts";
import { agendaDocumentStore, type AgendaDocument } from "../lib/meetings/agenda-documents.ts";

test("one failed body leaves sibling work running with its own authority and due clocks", async () => {
  const previous = { capability: process.env[RUNTIME_AUTHORITY_ENV.capability], contract: process.env[RUNTIME_AUTHORITY_ENV.contract] };
  const calls: string[] = [];
  const output: string[] = [];
  const tasks = ["one", "two", "three"].map((id, index) => ({ id, dueAt: `2026-10-15T0${index}:00:00.000Z`, nextDueAt: `2026-10-15T0${index + 1}:00:00.000Z` }));
  await runMeetingPartitionBatch(tasks, async (id, options) => {
    assert.equal(process.env[RUNTIME_AUTHORITY_ENV.capability], "ROUTINE_CONTRACT");
    assert.equal(process.env[RUNTIME_AUTHORITY_ENV.contract], id);
    assert.equal(options?.dueAt, tasks[calls.length]!.dueAt);
    calls.push(id);
    if (id === "two") throw new Error("source is unavailable");
  }, line => output.push(line));
  assert.deepEqual(calls, ["one", "two", "three"]);
  assert.equal(output.filter(line => line.startsWith("RCD_PROGRESS")).length, 3);
  assert.equal(output.filter(line => line.startsWith("RCD_MEETING_PARTITION_STARTED=")).length, 3);
  const failed = JSON.parse(output.find(line => line.startsWith("RCD_MEETING_PARTITION_ERROR="))!.split("=").slice(1).join("="));
  assert.deepEqual(failed, { id: "two", detail: "source is unavailable" });
  assert.equal(process.env[RUNTIME_AUTHORITY_ENV.capability], previous.capability);
  assert.equal(process.env[RUNTIME_AUTHORITY_ENV.contract], previous.contract);
});

test("a member refused before acquisition releases the preceding body's held agendas", async () => {
  agendaDocumentStore.append({ meetingId: "prior-body:meeting", documentUrl: "https://prior.example.gov/agenda",
    contentHash: "a".repeat(64), text: "Prior body's agenda" } as AgendaDocument);
  assert.equal(agendaDocumentStore.documentCount, 1);
  await assert.rejects(runMeetingPartition("invalid-partition"), /MEETING_DEPENDENCY_BODY_REQUIRED/);
  assert.equal(agendaDocumentStore.documentCount, 0);
});
