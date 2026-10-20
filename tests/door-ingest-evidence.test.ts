import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { fixItems } from "../lib/control-plane/fix-list.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { applyManualEdit, checkDoorDraft, isDoorRecord } from "../lib/doors/registry.ts";
import { evidenceFromCandidate, evidenceFromFamilyRead, reopenDoorIfShut } from "../lib/doors/ingest-evidence.ts";
import { recordDoorEvidence } from "../lib/doors/shut.ts";

const T = (h: number) => `2026-10-06T${String(10 + h).padStart(2, "0")}:00:00.000Z`;
const ID = "synthetic:ingest-evidence";

async function setup() {
  const repos = createMemoryRepositories();
  const checked = checkDoorDraft({ doorId: ID, kind: "official-page-events", hosts: ["door.example.invalid"], holds: ["meetings"] });
  assert.ok(checked.ok);
  await repos.doors.put(ID, applyManualEdit(null, checked.value, T(0)), T(0));
  return repos;
}
const status = async (repos: Awaited<ReturnType<typeof setup>>) => {
  const row = await repos.doors.read(ID);
  assert.ok(row && isDoorRecord(row.value));
  return row.value.status;
};
const items = async (repos: Awaited<ReturnType<typeof setup>>) => {
  const held = await repos.adminConfig.read(ADMIN_CONFIG_ID, { fixList: true });
  return held && isAdminConfig(held.value) ? fixItems(held.value) : [];
};

describe("DB-32/34 connection: what a read tells its door", () => {
  it("judging a door from its read is always on: no switch keeps the old way", () => {
    for (const file of ["scripts/routine-civic-data-runner.mts", "scripts/ingest.ts", "lib/doors/ingest-evidence.ts"]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /WTP_DOOR_SHUT|doorShutEnabled/, file);
    }
  });

  it("a held partition: a refused address is the door's; bytes that arrived and failed validation are not", () => {
    assert.deepEqual(evidenceFromCandidate({ acquisitionSucceeded: false, failureCode: "SOURCE_RETRIEVAL_FAILED", failureDetail: "HTTP 404; no authoritative bytes acquired." }), { kind: "HTTP", httpStatus: 404 });
    assert.deepEqual(evidenceFromCandidate({ acquisitionSucceeded: false, failureCode: "SOURCE_RETRIEVAL_FAILED", failureDetail: "the request did not complete" }), { kind: "TRANSPORT_FAILURE" });
    assert.equal(evidenceFromCandidate({ acquisitionSucceeded: false, failureCode: "PUBLISHER_DOCUMENT_INVALID", failureDetail: null })?.kind, "PARSE_FAILURE");
    assert.equal(evidenceFromCandidate({ acquisitionSucceeded: true, failureCode: "ZERO_IS_NOT_ABSENCE", failureDetail: "no rows" }), null);
  });

  it("a family member: sittings read is good, a 404 is the door's, a clean empty read says nothing", () => {
    const read = (over: object) => ({ ok: true, error: null, acquisitions: [], freshMeetings: [{}, {}], ...over });
    assert.deepEqual(evidenceFromFamilyRead(read({})), { kind: "GOOD", rows: 2 });
    assert.equal(evidenceFromFamilyRead(read({ freshMeetings: [] })), null);
    assert.deepEqual(evidenceFromFamilyRead(read({ ok: false, error: "x", acquisitions: [{ httpStatus: 200 }, { httpStatus: 404 }] })), { kind: "HTTP", httpStatus: 404 });
    assert.deepEqual(evidenceFromFamilyRead(read({ ok: false, error: "timed out" })), { kind: "TRANSPORT_FAILURE" });
  });

  it("a 404 shuts the door and opens one fix item; a promoted read reopens it and completes the item", async () => {
    const repos = await setup();
    const evidence = evidenceFromCandidate({ acquisitionSucceeded: false, failureCode: "SOURCE_RETRIEVAL_FAILED", failureDetail: "HTTP 404; no authoritative bytes acquired." })!;
    await recordDoorEvidence(repos.doors, ID, evidence, T(1), repos);
    assert.equal(await status(repos), "SHUT");
    assert.equal((await items(repos)).length, 1);
    assert.equal(await reopenDoorIfShut(repos.doors, ID, T(4), repos), true);
    assert.equal(await status(repos), "OPEN");
    assert.equal((await items(repos))[0]?.state, "FIXED");
  });

  it("an open door, or no such door, is left alone by a promoted read", async () => {
    const repos = await setup();
    assert.equal(await reopenDoorIfShut(repos.doors, ID, T(1), repos), false);
    assert.equal(await reopenDoorIfShut(repos.doors, "synthetic:absent", T(1), repos), false);
  });
});
