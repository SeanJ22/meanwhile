/**
 * Read-only live proof that one source acquisition failure remained contained
 * while an unaffected task completed in the same canonical supervisor cycle.
 * Aggregate counts are never sufficient: every claim is bound to an exact
 * task/candidate receipt and rechecked against the production civic-data store.
 */
import {
  routineSupervisorCycleIsolationIssue,
} from "../lib/control-plane/freshness-cycle-outcome.ts";
import { DIGEST_LOG_KEY } from "../lib/control-plane/admin-data.ts";
import {
  CONTROL_PLANE_URL_VAR,
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import { assertDurableRepositories } from "../lib/control-plane/repository/types.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { ROUTINE_SOURCE_TASKS } from "../lib/civic-data/runner.ts";
import { durableRoutineRunnerReceiptIssue } from "../lib/civic-data/runner-receipt.ts";
import { REFUSED_VARIABLE } from "../lib/db/write-handle.ts";
import { requiredAssignment } from "./cli-args.mts";

const cycleId = requiredAssignment(process.argv, "cycle-id", "PDC12_LIVE_SUPERVISOR_FLAG_REQUIRED");
const controlPlaneConnection = controlPlaneUrlFromEnv();
if (controlPlaneConnection === null) {
  throw new Error(`PDC12_LIVE_SUPERVISOR_CONTROL_PLANE_REQUIRED:${CONTROL_PLANE_URL_VAR}`);
}
const civicDataConnection = process.env[REFUSED_VARIABLE]?.trim() ?? "";
if (civicDataConnection === "") {
  throw new Error(`PDC12_LIVE_SUPERVISOR_CIVIC_DATA_READ_HANDLE_REQUIRED:${REFUSED_VARIABLE}`);
}

const repos = await createPgRepositories(controlPlaneConnection, new Date().toISOString(), { skipBootstrap: true });
assertDurableRepositories(repos, "PDC-12 live supervisor-cycle isolation proof");
const matches = (await repos.ownerDigests.read(DIGEST_LOG_KEY)).filter(
  (row) => row.digestId === cycleId && row.runtimeOutcome?.kind === "ROUTINE_CIVIC_DATA_SUPERVISOR",
);
if (matches.length !== 1) {
  throw new Error(`PDC12_LIVE_SUPERVISOR_CYCLE_NOT_EXACT:${cycleId}:${matches.length}`);
}
const outcome = matches[0]!.runtimeOutcome;
if (outcome?.kind !== "ROUTINE_CIVIC_DATA_SUPERVISOR") {
  throw new Error(`PDC12_LIVE_SUPERVISOR_OUTCOME_MISSING:${cycleId}`);
}
const structuralIssue = routineSupervisorCycleIsolationIssue(outcome);
if (structuralIssue !== null) throw new Error(`PDC12_LIVE_SUPERVISOR_ISOLATION_REFUSED:${structuralIssue}`);

process.env.DATABASE_URL = civicDataConnection;
const store = new PostgresRoutineDataStore();
for (const reference of outcome.taskReceipts) {
  const task = ROUTINE_SOURCE_TASKS.find(({ id }) => id === reference.taskId);
  if (
    !task ||
    task.sourceId !== reference.sourceId ||
    task.recordClass !== reference.recordClass ||
    task.scope !== reference.scope
  ) throw new Error(`PDC12_LIVE_SUPERVISOR_TASK_CONTRACT_MISMATCH:${reference.taskId}`);
  const durableIssue = await durableRoutineRunnerReceiptIssue(
    reference.receipt,
    task,
    store,
    reference.classification === "VERIFIED_SOURCE_SUCCESS" ? "SUCCESS" : "HELD",
  );
  if (durableIssue !== null) {
    throw new Error(`PDC12_LIVE_SUPERVISOR_DURABLE_RECEIPT_REFUSED:${reference.taskId}:${durableIssue}`);
  }
}

const failed = outcome.taskReceipts.find(
  ({ classification, receipt }) => classification === "VERIFIED_SOURCE_FAILURE" && !receipt.acquisitionSucceeded,
)!;
const unaffected = outcome.taskReceipts.filter(
  ({ sourceId, classification }) => sourceId !== failed.sourceId && classification === "VERIFIED_SOURCE_SUCCESS",
);
console.log("PDC12_LIVE_SUPERVISOR_ISOLATION=" + JSON.stringify({
  cycleId,
  state: outcome.state,
  exactTaskReceiptEvidence: outcome.taskReceiptEvidence,
  attemptedTasks: outcome.attemptedTasks,
  failedAcquisition: {
    taskId: failed.taskId,
    sourceId: failed.sourceId,
    candidateId: failed.receipt.candidateId,
    state: failed.receipt.state,
    lastKnownGoodVersion: failed.receipt.lastKnownGoodVersion,
  },
  unaffectedSuccessfulSources: unaffected.map(({ taskId, sourceId, receipt }) => ({
    taskId,
    sourceId,
    candidateId: receipt.candidateId,
    state: receipt.state,
  })),
  sameCanonicalSupervisorCycle: true,
  durableCandidateAndPointerReadback: "PASS",
  sourceFailureDidNotSuppressDifferentSources: true,
  proof: "PASS",
}));
