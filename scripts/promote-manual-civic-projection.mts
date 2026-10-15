import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

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

const contractId = assignment(process.argv, "contract") as ManualProjectionContractId | null;
const packageArgument = assignment(process.argv, "package");
const workerResults = assignment(process.argv, "worker-results");
if (workerResults) {
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
