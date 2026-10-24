import assert from "node:assert/strict";
import test from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { routineTaskDue } from "../lib/civic-data/runner.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { VALIDATION_CHECKS, type CandidateVersionRecord, type RoutineCandidate, type ValidationReceipt } from "../lib/civic-data/types.ts";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";

// Production, 2026-10-24: the state transfer moved US-AZ:voting-sites to cv-cd6d5a86... at 00:11:56Z with the response
// retrieved 2026-10-22T00:34:17.886Z. The clock read the transfer as a fresh read, so the daily task said "not due"
// at 03:35Z and every pass after; 56 voting-site states were held the same way (CA's inherited read was from Oct 7).
// A transfer retains published facts without a source read (RN-03), so it never makes the source look freshly read.
const SCOPE = "US-AZ:voting-sites", PARSER = "official-voting-sites/4";
const RETRIEVED = "2026-10-22T00:34:17.886Z", ORIGINAL_EVENT = "2026-10-22T00:34:19.699Z", TRANSFERRED = "2026-10-24T00:11:56.290Z";
const NOW = Date.parse("2026-10-24T03:35:19.563Z");
const task = AUTOMATIC_REFRESH_TASKS.find(row => row.id === "voting-sites:AZ")!;

function candidate(id: string, retirement: boolean): RoutineCandidate {
  return {
    id, sourceId: "voting-sites", recordClass: "VOTING_SITE", scope: SCOPE,
    retrieval: { succeeded: true, requestedUrl: "https://services2.arcgis.com/a", finalUrl: "https://services2.arcgis.com/a",
      httpStatus: 200, retrievedAt: RETRIEVED, rawHash: "6".repeat(64) },
    normalization: { succeeded: true, parserVersion: PARSER, schemaVersion: "1", normalizedHash: "a".repeat(64), normalizedPayloadHash: "b".repeat(64),
      inputRecords: 346, outputRecords: 346, droppedRecords: 0, missingRequiredFields: [] },
    identities: [], temporal: { sourceThrough: "2026-10-22" }, readModel: {},
    ...(retirement ? { stateRetirement: { kind: "STATE_AUTHORITY_RETIREMENT", contractId: "voting-sites:AZ", state: "AZ", unitSha256: "c".repeat(64),
      origin: { versionId: "cv-national", recordClass: "VOTING_SITE", scope: "US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions",
        readModelHash: "d".repeat(64), sourceAuthenticity: "AUTHORITY_AND_RAW_PROVENANCE_VALID" }, priorVersionId: "cv-original", readModelHash: "a".repeat(64) } } : {}),
  } as unknown as RoutineCandidate;
}
function receipt(value: RoutineCandidate, at: string): ValidationReceipt {
  return { contractVersion: 2, decision: "GOOD", candidateId: value.id, sourceId: value.sourceId, recordClass: value.recordClass, scope: value.scope,
    validatedAt: at, checks: VALIDATION_CHECKS.map(check => ({ check, verdict: "PASS", code: `${check}_PASS`, detail: "fixture" })), excludedFacts: [] };
}

async function insert(pg: PGlite, value: RoutineCandidate, at: string): Promise<void> {
  await pg.transaction(async tx => {
    await tx.query(`INSERT INTO civic_data_candidates (id,source_id,record_class,scope,state,acquisition_succeeded,retrieved_at,source_through,parser_version,
        identity,candidate,validation_receipt,promoted_version_id,last_known_good_version_id,raw_hash,normalized_hash)
      VALUES($1,'voting-sites','VOTING_SITE',$2,'PROMOTED',true,$3,'2026-10-22',$4,'[]',$5,$6,$1,$1,$7,$8)`,
    [value.id, SCOPE, value.retrieval.retrievedAt, PARSER, JSON.stringify(value), JSON.stringify(receipt(value, at)), value.retrieval.rawHash, value.normalization.normalizedHash]);
    for (const [index, state] of ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED"].entries()) {
      await tx.query("INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES($1,$2,$3,$4,'fixture')", [value.id, index + 1, state, at]);
    }
    await tx.query(`INSERT INTO civic_data_promotions (key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,payload,validation_receipt)
      VALUES($1,'voting-sites','VOTING_SITE',$2,$3,$3,$4,'{}',$5)
      ON CONFLICT(key) DO UPDATE SET current_version_id=excluded.current_version_id,last_known_good_version_id=excluded.last_known_good_version_id,
        promoted_at=excluded.promoted_at,validation_receipt=excluded.validation_receipt`,
    [`VOTING_SITE:${SCOPE}`, SCOPE, value.id, at, JSON.stringify(receipt(value, at))]);
  });
}

test("a state transfer is not a source read, so an overdue voting-site state is due on the next pass", async () => {
  await withMigratedRoutineStore("voting-sites:AZ", async (store, _vault, pg) => {
    await insert(pg, candidate("cv-original", false), ORIGINAL_EVENT);
    await insert(pg, candidate("cv-transfer", true), TRANSFERRED);
    const clock = await store.clock("voting-sites", "VOTING_SITE", SCOPE, PARSER);
    assert.notEqual(clock.lastSucceededObservedAt, TRANSFERRED, "the transfer is not a read");
    assert.equal(routineTaskDue(task, clock, NOW), true, "the Oct 22 read is overdue on Oct 24");
  });
});

test("a state first published by transfer is due at once; a real read after it sets the clock", async () => {
  await withMigratedRoutineStore("voting-sites:AZ", async (store, _vault, pg) => {
    await insert(pg, candidate("cv-transfer", true), TRANSFERRED);
    const inherited = await store.clock("voting-sites", "VOTING_SITE", SCOPE, PARSER);
    assert.notEqual(inherited.lastSucceededObservedAt, TRANSFERRED);
    assert.equal(routineTaskDue(task, inherited, NOW), true);
    const fresh = candidate("cv-fresh", false);
    await insert(pg, { ...fresh, retrieval: { ...fresh.retrieval, retrievedAt: "2026-10-24T03:00:00.000Z" } }, "2026-10-24T03:00:01.000Z");
    const clock = await store.clock("voting-sites", "VOTING_SITE", SCOPE, PARSER);
    assert.equal(clock.lastAttemptedAt, "2026-10-24T03:00:01.000Z");
    assert.equal(clock.lastSucceededObservedAt, "2026-10-24T03:00:01.000Z");
    assert.equal(routineTaskDue(task, clock, NOW), false, "a read made 35 minutes ago is not due again");
  });
});

test("the memory store treats a transfer the same way", async () => {
  const memory = new MemoryRoutineDataStore();
  const value = candidate("cv-transfer", true);
  await memory.create({ candidate: value, state: "FETCHED", acquisitionSucceeded: true, receipt: null, promotedVersion: null,
    lastKnownGoodVersion: null, failureCode: null, failureDetail: null } satisfies CandidateVersionRecord,
  { candidateId: value.id, sequence: 1, state: "FETCHED", at: TRANSFERRED, detail: "fixture" });
  await memory.transition(value.id, "NORMALIZED", TRANSFERRED, "fixture");
  await memory.transition(value.id, "VALIDATED", TRANSFERRED, "fixture", receipt(value, TRANSFERRED));
  await memory.promote(value.id, receipt(value, TRANSFERRED), TRANSFERRED);
  const clock = await memory.clock("voting-sites", "VOTING_SITE", SCOPE, PARSER);
  assert.notEqual(clock.lastSucceededObservedAt, TRANSFERRED);
  assert.equal(routineTaskDue(task, clock, NOW), true);
});
