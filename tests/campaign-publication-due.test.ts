import test from "node:test";
import assert from "node:assert/strict";
import { campaignPublicationInputsDue, readCampaignPublicationInputs, campaignPublicationTask, readCandidateProfilePublicationTasks, readCandidateProfileFindingBatch } from "../lib/civic-data/campaign-publication-due.ts";
import { PGlite } from "@electric-sql/pglite";
import { CANDIDATE_PROFILE_LEAD } from "../lib/facts/finding-slots.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue, routineFailureDomainFrontier } from "../lib/civic-data/runner.ts";
import { routineCivicDataSupervisorOutcome } from "../lib/control-plane/freshness-cycle-outcome.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { BOOTSTRAP_DDL } from "../lib/control-plane/repository/pg-schema.ts";

test("committed approvals wake normal publication despite old acquisition clocks and survive restart", () => {
  const task = ROUTINE_SOURCE_TASKS.find(task => task.id === campaignPublicationTask("AZ"))!;
  const clock = { lastAttemptedAt: "2026-09-26T10:00:00Z", lastSucceededAt: "2026-09-26T10:00:00Z" };
  assert.equal(routineTaskDue(task, clock, Date.parse("2026-09-26T10:05:00Z")), false);
  const snapshot = { state: "AZ", approvals: 3, attemptedApprovals: 2 };
  assert.equal(campaignPublicationInputsDue(task.id, snapshot), true);
  assert.equal(routineFailureDomainFrontier([{ task, lastConsideredAt: clock.lastAttemptedAt }]).length, 1);
  for (const other of ROUTINE_SOURCE_TASKS.filter(row => row.id !== task.id)) assert.equal(campaignPublicationInputsDue(other.id, snapshot), false);
  assert.equal(campaignPublicationInputsDue(task.id, { state: "AZ", approvals: 3, attemptedApprovals: 3 }), false, "durable acknowledgement prevents repeating unchanged failures");
  assert.equal(campaignPublicationInputsDue(task.id, { state: "AZ", approvals: 4, attemptedApprovals: 3 }), true, "a concurrent late commit stays due even if its evidence timestamp predates the attempt");
  assert.equal(campaignPublicationInputsDue(task.id, null), false);
});

test("publication admission reads one committed snapshot and refuses malformed accounting", async () => {
  let sql = "";
  assert.deepEqual(await readCampaignPublicationInputs("AZ", async query => { sql = query; return [{ approvals: "4", attempted: "3" }]; }), { state: "AZ", approvals: 4, attemptedApprovals: 3 });
  assert.match(sql, /APPROVED_FOR_PROMOTION/);
  assert.match(sql, /cp_log_owner_digests/);
  assert.match(sql, /testedSha/);
  assert.doesNotMatch(sql, /recorded_at|record->>'at'/);
  for (const rows of [[], [{ approvals: "invalid", attempted: "0" }], [{ approvals: "1", attempted: "2" }]]) {
    await assert.rejects(readCampaignPublicationInputs("AZ", async () => rows), /INPUTS_INVALID/);
  }
  await assert.rejects(readCampaignPublicationInputs("AZ", async () => { throw new Error("read unavailable"); }), /read unavailable/);
  const code = "a".repeat(40);
  let captured: unknown[] = [];
  const changedCode = await readCampaignPublicationInputs("AZ", async (_sql, params) => {
    captured = params;
    return [{ approvals: "4", attempted: params[0] === code ? "0" : "4" }];
  }, code);
  assert.deepEqual(captured, [code, "AZ"], "the existing durable attempt acknowledgement belongs to the exact code that attempted it");
  assert.equal(campaignPublicationInputsDue(campaignPublicationTask("AZ"), changedCode), true,
    "changed publication code may reconsider previously held approvals without resetting clocks or creating new approvals");
  const sameCode = await readCampaignPublicationInputs("AZ", async () => [{ approvals: "4", attempted: "4" }], code);
  assert.equal(campaignPublicationInputsDue(campaignPublicationTask("AZ"), sameCode), false,
    "an exact child receipt on the same code still suppresses the unchanged failure");
  await assert.rejects(readCampaignPublicationInputs("AZ", async () => [], "invalid"), /CODE_INVALID/);
});

test("only an exact publication child receipt acknowledges the captured input count", () => {
  const base = { cycleId: "test:publication", startedAt: "2026-09-26T10:00:00.000Z", finishedAt: "2026-09-26T10:05:00.000Z", testedSha: null, host: "test", provider: "memory", durable: true,
    attemptedTasks: 1, verifiedSourceSuccesses: 0, verifiedSourceFailures: 1, failures: [], campaignPublicationApprovalsByState: { AZ: 3 } };
  assert.throws(() => routineCivicDataSupervisorOutcome(base), /ACK_WITHOUT_RECEIPT/);
  const receipt = { taskId: campaignPublicationTask("AZ"), sourceId: "candidate-campaign-site-chain", recordClass: "CURATED_READER_RECORD" as const, scope: "US-AZ:candidate-campaign-sites-derived", classification: "VERIFIED_SOURCE_FAILURE" as const,
    receipt: { source: campaignPublicationTask("AZ"), candidateId: "held-candidate", acquisitionSucceeded: false, state: "SOURCE_BLOCKED" as const, decision: "FAIL" as const,
      promotedVersion: null, lastKnownGoodVersion: "last-good", structuralReleaseContract: ZERO_RELEASE_EVENTS } };
  const outcome = routineCivicDataSupervisorOutcome({ ...base, taskReceipts: [receipt] });
  assert.equal(outcome.campaignPublicationApprovalsByState?.AZ, 3);
  assert.equal(outcome.verifiedSourceSuccesses, 0, "acknowledgement is not publication or verification");
  assert.throws(() => routineCivicDataSupervisorOutcome({ ...base, taskReceipts: [receipt], campaignPublicationApprovalsByState: { AZ: -1 } }), /ACK_WITHOUT_RECEIPT/);
});

test("waiting profile findings schedule exact manual state children from recorded work geography", async () => {
  const db = new PGlite();
  try {
    for (const table of ["cp_box_findings", "cp_work_items", "cp_occurrences", "cp_obligations"]) {
      await db.exec(BOOTSTRAP_DDL.find(sql => sql.includes(`CREATE TABLE IF NOT EXISTS ${table} (`))!);
    }
    const put = async (table: string, id: string, value: unknown) => db.query(`INSERT INTO ${table}(id,revision,updated_at,value) VALUES($1,1,now(),$2)`, [id, JSON.stringify(value)]);
    await put("cp_work_items", "work-oh", { autonomousPlan: { contract: { jurisdiction: { state: "OH" } } } });
    await put("cp_work_items", "work-nh", { autonomousPlan: { jurisdiction: "US-NH" } });
    await put("cp_occurrences", "occurrence", { workItemId: "work-il", obligationId: "obligation" });
    await put("cp_obligations", "obligation", { scopeDivisions: ["ocd-division/country:us/state:il/place:chicago"] });
    const waiting = (subject: string, work: string) => ({ state: "waiting", subjectId: subject, lastRecordedAt: "2026-10-01T00:00:00Z",
      waitingFor: { reason: CANDIDATE_PROFILE_LEAD }, origins: [{ workItemId: work }] });
    await put("cp_box_findings", "oh", waiting("ballot-nh:unreliable-prefix", "work-oh"));
    await put("cp_box_findings", "nh", waiting("ballot-candidacy:opaque-nh", "work-nh"));
    await put("cp_box_findings", "unknown", waiting("ballot-az:prefix-alone-is-not-work-geography", "missing"));
    await db.query("INSERT INTO cp_box_findings(id,revision,updated_at,value) SELECT 'il-'||n,1,now(),$1::jsonb||jsonb_build_object('subjectId','ballot-candidacy:'||n) FROM generate_series(1,501) n",
      [JSON.stringify(waiting("opaque", "work-il"))]);
    const query = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows;
    const read = await readCandidateProfilePublicationTasks(query, "2026-10-02T00:00:00Z");
    assert.equal(read.unscoped, 1);
    assert.deepEqual(read.tasks.map(task => [task.registeredContractId, task.command, task.ownerInvocation?.publicationPending]), [
      ["candidate-profiles:IL", ["scripts/promote-manual-civic-projection.mts", "--contract=candidate-profiles:IL", "--candidate-findings"], true],
      ["candidate-profiles:NH", ["scripts/promote-manual-civic-projection.mts", "--contract=candidate-profiles:NH", "--candidate-findings"], true],
      ["candidate-profiles:OH", ["scripts/promote-manual-civic-projection.mts", "--contract=candidate-profiles:OH", "--candidate-findings"], true],
    ]);
    assert.equal((await readCandidateProfileFindingBatch("IL", query)).length, 500);
    assert.deepEqual(await readCandidateProfileFindingBatch("OH", query), [{ id: "oh", subject: "ballot-nh:unreliable-prefix" }]);
    assert.deepEqual(await readCandidateProfileFindingBatch("NH", query), [{ id: "nh", subject: "ballot-candidacy:opaque-nh" }]);
    assert.deepEqual(await readCandidateProfileFindingBatch("AZ", query), []);
    await db.exec("UPDATE cp_box_findings SET value=jsonb_set(value,'{state}','\"built\"')");
    assert.deepEqual(await readCandidateProfilePublicationTasks(query, "2026-10-02T00:00:00Z"), { tasks: [], unscoped: 0 });
  } finally { await db.close(); }
});
