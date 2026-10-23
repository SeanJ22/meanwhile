import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendRoutineCivicDataSupervisorDigest, routineCivicDataSupervisorOutcome } from "../lib/control-plane/freshness-cycle-outcome.ts";
import { routineReaderReadbackEvidenceIssue, type RoutineCivicDataReaderReadbackReference } from "../lib/control-plane/owner-surface.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { boundedRoutineSupervisorDigest, parseRoutineSupervisorFailureSummary, routineSupervisorFailureSummary, ROUTINE_FAILURE_EXAMPLES, ROUTINE_OUTCOME_MAX_BYTES } from "../lib/control-plane/routine-outcome-summary.ts";
import { saveRoutineOutcomeLocal } from "../lib/control-plane/routine-outcome-local.ts";

const NOW = "2026-10-22T23:00:00.000Z";
const base = { lane: "publish-now" as const, cycleId: `publish-now-supervisor:test:${NOW}`, startedAt: NOW, finishedAt: NOW,
  testedSha: "a".repeat(40), host: "test", provider: "memory", durable: false,
  attemptedTasks: 0, verifiedSourceSuccesses: 0, verifiedSourceFailures: 0, taskReceipts: [] };

test("an empty failed publication pass saves its own cause with a valid zero Reader denominator", async () => {
  const outcome = routineCivicDataSupervisorOutcome({ ...base,
    failures: [{ taskId: "box-facts", code: "BOX_FACT_PUBLICATION_FAILED", detail: "database unavailable" }],
    readerReadback: { denominator: 0, recordedPass: 0, recordedFail: 0, currentFail: 0, noops: 0, repairFailures: 0, references: [] },
  });
  assert.equal(routineReaderReadbackEvidenceIssue(outcome), null);
  const repos = createMemoryRepositories();
  const saved = await appendRoutineCivicDataSupervisorDigest(repos, { outcome, lines: ["Publication failed"] });
  assert.equal(saved.runtimeOutcome?.kind, "ROUTINE_CIVIC_DATA_SUPERVISOR");
  assert.equal((await repos.ownerDigests.read("owner-digest"))[0].digestId, base.cycleId);
  assert.equal(saved.cycleOk, false);
});

test("the standing parent recovers only a complete summary for the same child pass", () => {
  const input = { outcome: routineCivicDataSupervisorOutcome({ ...base,
    failures: [{ taskId: "meeting-reader", code: "CONTRACT_FILE_UNREADABLE", detail: "The contract file is missing" }],
  }), lines: ["The publication child failed"] };
  const line = routineSupervisorFailureSummary(input);
  assert.equal(parseRoutineSupervisorFailureSummary(line, base.cycleId)?.counts.CONTRACT_FILE_UNREADABLE, 1);
  assert.equal(parseRoutineSupervisorFailureSummary(line, "another-pass"), null);
  assert.equal(parseRoutineSupervisorFailureSummary(line.replace('"total":1', '"total":2'), base.cycleId), null);
  assert.equal(parseRoutineSupervisorFailureSummary("RCD_SUPERVISOR_FAILURE_SUMMARY={broken", base.cycleId), null);
});

test("10,000 long failing board IDs retain every count in a bounded saved diagnostic with the first examples", async () => {
  const references: RoutineCivicDataReaderReadbackReference[] = Array.from({ length: 10_000 }, (_, index) => ({
    contractId: `meetings:board:${String(index).padStart(5, "0")}:${"long-board-name-".repeat(30)}`,
    sourceId: "meetings-public-bodies", recordClass: "MEETING", scope: `body:${index}`, projectionId: "meetings",
    disposition: "REPAIR_FAILED", receipt: null,
  }));
  const failures = references.map((row, index) => ({ taskId: `reader-readback:${row.contractId}`,
    code: index % 2 ? "READER_READBACK_REPAIR_FAILED" : "READER_REPAIR_SELECTION_FAILED",
    detail: "no result ".repeat(300) }));
  // Every failed readback has its own mechanism failure; selection failures are additional, independently counted causes.
  const allFailures = [...references.map(row => ({ taskId: `reader-readback:${row.contractId}`, code: "READER_READBACK_REPAIR_FAILED", detail: "no result" })),
    ...failures.filter(row => row.code === "READER_REPAIR_SELECTION_FAILED")];
  const outcome = routineCivicDataSupervisorOutcome({ ...base, failures: allFailures,
    readerReadback: { denominator: references.length, recordedPass: 0, recordedFail: 0, currentFail: 0, noops: 0,
      repairFailures: references.length, references },
  });
  const input = boundedRoutineSupervisorDigest({ outcome, lines: allFailures.map(row => `${row.taskId}: ${row.detail}`) });
  assert.ok(Buffer.byteLength(JSON.stringify(input)) < ROUTINE_OUTCOME_MAX_BYTES);
  assert.equal(input.outcome.summary?.failureCount, 15_000);
  assert.deepEqual({ ...input.outcome.summary?.failuresByCode }, { READER_READBACK_REPAIR_FAILED: 10_000, READER_REPAIR_SELECTION_FAILED: 5_000 });
  assert.equal(input.outcome.failures.length, ROUTINE_FAILURE_EXAMPLES);
  assert.equal(input.outcome.summary?.failuresOmitted, 15_000 - ROUTINE_FAILURE_EXAMPLES);
  assert.equal(input.outcome.readerReadbackEvidence, "SUMMARY");
  assert.equal(input.outcome.summary?.readerReadbacksOmitted, 10_000);
  assert.equal(routineReaderReadbackEvidenceIssue(input.outcome), null);
  const dir = mkdtempSync(join(tmpdir(), "cal01-outcome-"));
  try {
    const path = saveRoutineOutcomeLocal(input, dir);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(saved.outcome.summary.failureCount, 15_000);
    assert.equal(saved.outcome.failures[0].taskId, allFailures[0].taskId);
    const repos = createMemoryRepositories();
    const record = await appendRoutineCivicDataSupervisorDigest(repos, input);
    assert.ok(Buffer.byteLength(JSON.stringify(record)) < ROUTINE_OUTCOME_MAX_BYTES);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("publish-now started with the server's Node loader saves an admission failure before exiting nonzero", () => {
  const dir = mkdtempSync(join(tmpdir(), "cal01-entry-outcome-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, WTP_MIRROR: dir };
    delete env.NODE_TEST_CONTEXT;
    for (const key of Object.keys(env)) if (/DATABASE_URL|^WTP_RUNTIME_AUTHORITY_|^WTP_PRODUCTION_DATABASE_/.test(key)) delete env[key];
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs",
      "scripts/publish-now-runner.mts", "--force"], { cwd: process.cwd(), env, encoding: "utf8", timeout: 60_000 });
    assert.equal(run.status, 2, run.stderr);
    const files = readdirSync(join(dir, "runner-outcomes"));
    assert.equal(files.length, 1);
    const saved = JSON.parse(readFileSync(join(dir, "runner-outcomes", files[0]), "utf8"));
    assert.equal(saved.outcome.lane, "publish-now");
    assert.equal(saved.outcome.summary.failuresByCode.PUBLISH_NOW_FATAL, 1);
    assert.match(saved.outcome.failures[0].detail, /Publish-now cannot force unrelated source work/);
    assert.ok(Buffer.byteLength(JSON.stringify(saved)) < ROUTINE_OUTCOME_MAX_BYTES);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
