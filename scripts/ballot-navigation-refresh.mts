import { join } from "node:path";
import { assignment } from "./cli-args.mts";
import { ballotNavigationScope, ballotNavigationTaskId } from "../lib/civic-data/ballot-navigation-scope.ts";
import { refreshBallotNavigation } from "../lib/civic-data/ballot-navigation-refresh.ts";
import type { BallotPublicationResult } from "../lib/civic-data/ballot-publication.ts";
import { ballotInputHash, ballotInputStamp } from "../lib/civic-data/ballot-input.ts";
import { BALLOT_NAVIGATION_INPUT_DIRECTORY } from "../lib/civic-data/ballot-navigation-input.ts";
import { requireBallotState } from "../lib/civic-data/state-scopes.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { cycleVault, VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { printWorkerPublicationReceipt } from "../lib/civic-data/worker-publication-tasks.ts";

const directory = assignment(process.argv, "directory");
const state = assignment(process.argv, "state") ?? "";
const scope = ballotNavigationScope(state);
const taskId = ballotNavigationTaskId(state);
prepareProductionCivicDataWrite();
const now = new Date().toISOString();
const connection = controlPlaneUrlFromEnv();
if (!connection) throw new Error("NAVIGATION_CONTROL_PLANE_UNAVAILABLE");
const repos = await createPgRepositories(connection, now, { skipBootstrap: true });
const store = new PostgresRoutineDataStore();
const inputDirectory = directory ?? BALLOT_NAVIGATION_INPUT_DIRECTORY;
const inputStamp = await ballotInputStamp(inputDirectory, requireBallotState(state));
const inputHash = inputStamp.startsWith("content:") ? inputStamp.slice(8) : await ballotInputHash(inputDirectory, requireBallotState(state));
let result: BallotPublicationResult;
try {
  const report = await refreshBallotNavigation({ store, repos,
    vault: cycleVault(join(process.cwd(), ...VAULT_DIR)), now, state, ...(directory ? { directory } : {}) });
  console.log("BALLOT_NAVIGATION_REFRESH=" + JSON.stringify({ ...report, fields: report.fields.length }));
  if (!report.promotedVersionId) throw new Error(`NAVIGATION_NO_VERIFIED_FIELDS:${report.gaps.map(gap => gap.detail).join(";")}`);
  const receipted = await printWorkerPublicationReceipt(store, taskId, [], { records: report.fields.length,
    versionId: report.promotedVersionId, candidateId: report.candidateId,
    gaps: report.gaps.map(gap => ({ key: `${gap.divisionId}:${gap.kind}`, detail: gap.detail })) }, now);
  if (!receipted) throw new Error("NAVIGATION_PUBLICATION_RECEIPT_MISSING");
  result = { kind: "BALLOT_PUBLICATION", family: "ballot-navigation", state: requireBallotState(state), inputHash, inputStamp, at: now,
    status: "PUBLISHED", versionId: report.promotedVersionId, merged: [], skipped: [], reason: null };
} catch (error) {
  const reason = sanitizedErrorDiagnostic(error);
  const contract = requiredManualProductionContract("ballot-navigation");
  const candidate = failedAcquisitionCandidate({ sourceId: contract.sourceId, recordClass: contract.recordClass,
    scope, requestedUrl: "", attemptedAt: now, failureDetail: reason,
    parserVersion: contract.parserNormalizerVersion });
  const outcome = await processRegisteredManualCandidate(store, "ballot-navigation", candidate, now);
  printSourceRunnerReceipt(taskId, candidate, outcome);
  result = { kind: "BALLOT_PUBLICATION", family: "ballot-navigation", state: requireBallotState(state), inputHash, inputStamp, at: now,
    status: "HELD", versionId: null, merged: [], skipped: [], reason };
  process.exitCode = 2;
}
console.log("BALLOT_PUBLICATION_RESULT=" + JSON.stringify(result));
