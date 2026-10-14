import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  MANUAL_PROJECTION_CONTRACT_IDS,
  type ManualProjectionContractId,
  type ManualProjectionPackage,
} from "../lib/civic-data/manual-projections.ts";
import { prepareManualProjectionSuccessor } from "../lib/civic-data/manual-successor.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { assignment } from "./cli-args.mts";
import { isWorkerReaderContract } from "../lib/civic-data/worker-reader-contracts.ts";
import { runWorkerPublicationJob } from "../lib/civic-data/worker-publication-job.ts";
import { workerPublicationContext } from "../lib/civic-data/worker-publication-context.ts";
import { refreshBallotNavigation } from "../lib/civic-data/ballot-navigation-refresh.ts";
import { BALLOT_NAVIGATION_INPUT_PATH, ballotInputHash, type BallotPublicationResult } from "../lib/civic-data/ballot-publication.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { cycleVault, VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { printWorkerPublicationReceipt } from "../lib/civic-data/worker-publication-tasks.ts";

const contractId = assignment(process.argv, "contract") as ManualProjectionContractId | null;
const packageArgument = assignment(process.argv, "package");
const workerResults = assignment(process.argv, "worker-results");
const directory = assignment(process.argv, "directory");
if (directory && (packageArgument || workerResults || contractId !== "ballot-navigation")) throw new Error("NAVIGATION_DIRECTORY_ARGUMENT_INVALID");
if (contractId === "ballot-navigation" && !packageArgument && !workerResults) {
  prepareProductionCivicDataWrite();
  const now = new Date().toISOString();
  const context = await workerPublicationContext(now);
  const store = new PostgresRoutineDataStore();
  const inputHash = await ballotInputHash(directory ?? BALLOT_NAVIGATION_INPUT_PATH);
  let result: BallotPublicationResult;
  try {
    const report = await refreshBallotNavigation({ store, repos: context.repos,
      vault: cycleVault(join(process.cwd(), ...VAULT_DIR)), now, ...(directory ? { directory } : {}) });
    console.log("BALLOT_NAVIGATION_REFRESH=" + JSON.stringify(report));
    if (!report.promotedVersionId) throw new Error(`NAVIGATION_NO_VERIFIED_FIELDS:${report.gaps.map(gap => gap.detail).join(";")}`);
    const receipted = await printWorkerPublicationReceipt(store, "ballot-navigation", [], { records: report.fields.length,
      versionId: report.promotedVersionId, candidateId: report.candidateId,
      gaps: report.gaps.map(gap => ({ key: `${gap.divisionId}:${gap.kind}`, detail: gap.detail })) }, now);
    if (!receipted) throw new Error("NAVIGATION_PUBLICATION_RECEIPT_MISSING");
    result = { kind: "BALLOT_PUBLICATION", inputHash, at: now, status: "PUBLISHED", versionId: report.promotedVersionId,
      merged: [], skipped: [], reason: null };
  } catch (error) {
    const reason = sanitizedErrorDiagnostic(error);
    const contract = requiredManualProductionContract("ballot-navigation");
    const candidate = failedAcquisitionCandidate({ sourceId: contract.sourceId, recordClass: contract.recordClass,
      scope: contract.scope, requestedUrl: "", attemptedAt: now, failureDetail: reason,
      parserVersion: contract.parserNormalizerVersion });
    const outcome = await processRegisteredManualCandidate(store, "ballot-navigation", candidate, now);
    printSourceRunnerReceipt("ballot-navigation", candidate, outcome);
    result = { kind: "BALLOT_PUBLICATION", inputHash, at: now, status: "HELD", versionId: null,
      merged: [], skipped: [], reason };
    process.exitCode = 2;
  }
  console.log("BALLOT_PUBLICATION_RESULT=" + JSON.stringify(result));
} else if (workerResults) {
  if (!contractId || !isWorkerReaderContract(contractId) || packageArgument) throw new Error("WORKER_PUBLICATION_CONTRACT_ARGUMENT_INVALID");
  prepareProductionCivicDataWrite();
  const now = new Date().toISOString();
  const context = await workerPublicationContext(now);
  const store = new PostgresRoutineDataStore();
  const { report, receipt, exitCode } = await runWorkerPublicationJob({ repos: context.repos, context, store, contractId,
    workItemIds: workerResults.split(",").filter(Boolean), now });
  const published = report.filter(row => row.outcome.status === "PUBLISHED");
  console.log("MANUAL_CIVIC_DATA_RECEIPT=" + JSON.stringify({ contractId,
    candidateId: published.at(-1)?.outcome.candidateId ?? null, promotedVersion: published.at(-1)?.outcome.versionId ?? null,
    workerPublications: report, structuralReleaseContract: ZERO_RELEASE_EVENTS }));
  // Holds stay on their own work items as owed work; the pass fails only when nothing went live.
  if (receipt) console.log("RCD_RECEIPT=" + JSON.stringify(receipt));
  if (exitCode) process.exitCode = exitCode;
} else {
const packageContracts = MANUAL_PROJECTION_CONTRACT_IDS.filter(id => id !== "ballot-contests");
if (!contractId || !packageContracts.some(id => id === contractId) || !packageArgument) {
  throw new Error(
    `usage: tsx scripts/promote-manual-civic-projection.mts --contract=${packageContracts.join("|")} --package=<absolute path outside repository>`,
  );
}

const root = resolve(process.cwd());
const packagePath = resolve(packageArgument);
const fromRoot = relative(root, packagePath);
if (fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot))) {
  throw new Error("MANUAL_PROMOTION_PACKAGE_MUST_BE_OUTSIDE_REPOSITORY");
}

const input = JSON.parse(readFileSync(packagePath, "utf8")) as ManualProjectionPackage;
if (input.contractId !== contractId) {
  throw new Error(`MANUAL_PROMOTION_CONTRACT_MISMATCH:${contractId}:${input.contractId}`);
}

prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();
const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(input, store, input.sourceReceipt.reviewedAt);
const outcome = await processRegisteredManualCandidate(
  store,
  contractId,
  candidate,
  input.sourceReceipt.reviewedAt,
  expectedBaseVersionId,
);

console.log("MANUAL_CIVIC_DATA_RECEIPT=" + JSON.stringify({
  contractId,
  candidateId: candidate.id,
  state: outcome.candidate.state,
  decision: outcome.candidate.receipt?.decision ?? null,
  promotedVersion: outcome.promoted?.versionId ?? null,
  lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
  structuralReleaseContract: ZERO_RELEASE_EVENTS,
}));
if (!outcome.promoted) process.exitCode = 2;
}
