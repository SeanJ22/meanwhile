/** The single PRL acquisition service, invoked by both the standing runner and its owner command. */
import { requiredPrlDataset, type PrlDataset } from "../lib/sources/prl/inventory.ts";
import { openPrlSource } from "../lib/sources/prl/fetch-source.ts";
import { ingestDataset, PRL_INGEST_PARSER_VERSION } from "../lib/sources/prl/ingest.ts";
import { resolveS3ArchiveStore, type PrlArchiveStore } from "../lib/sources/prl/archive-store.ts";
import { readReceipt, writeReceipt } from "../lib/sources/prl/holding.ts";
import { prlReceiptViolations } from "../lib/sources/prl/receipt.ts";
import { prlCandidate } from "../lib/sources/prl/data-plane.ts";
import { PRL_RHETORIC_ATTRIBUTION, type PrlMemberProfile, type PrlSnapshot } from "../lib/sources/prl/types.ts";
import { prlArchiveCandidate, readPrlArchiveProjection, type PrlArchiveProjection } from "../lib/sources/prl/archive-publication.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { isDirectModuleExecution } from "../lib/ops/main-module.ts";

const ARCHIVES = ["profiles-state", "primary-rhetoric", "state-rhetoric", "statements-national", "newsletters", "press-releases", "floor-speeches"] as const;
export async function refreshPrl(input: { archives: boolean; store: RoutineDataStore; archive: PrlArchiveStore; fetchImpl?: typeof fetch }) {
  const contractId = input.archives ? "prl-archives" : "prl";
  const contract = requiredManualProductionContract(contractId);
  const datasets: PrlDataset[] = (input.archives ? ARCHIVES : ["profiles-national"]).map(requiredPrlDataset);
  const held = input.archives ? await readPrlArchiveProjection({ store: input.store, bypassCache: true }) : null;
  if (held && held.kind !== "PROMOTED" && held.kind !== "NOT_RECORDED") throw new Error("PRL_ARCHIVE_PRIOR_UNAVAILABLE");
  let projection: PrlArchiveProjection = held?.kind === "PROMOTED" ? held.value : { formatVersion: 1, datasets: {} };
  let last: Awaited<ReturnType<typeof processRegisteredManualCandidate>> | null = null;
  const failures: string[] = [];
  for (const dataset of datasets) {
    try {
      const prior = projection.datasets[dataset.id] ?? await readReceipt(input.archive, dataset.id);
      const receipt = await ingestDataset({ dataset, archive: input.archive, now: Date.now(), priorReceipt: prior,
        open: () => openPrlSource(dataset, input.fetchImpl, input.archive,
          prior?.parserVersion === PRL_INGEST_PARSER_VERSION ? prior.sourceSha256 : undefined,
          { replayHeld: prior?.parserVersion !== PRL_INGEST_PARSER_VERSION }) });
      const violations = prlReceiptViolations(receipt);
      if (violations.length) throw new Error(violations.join("; "));
      const checkedAt = new Date().toISOString();
      const profiles = receipt.profiles as readonly PrlMemberProfile[];
      const snapshot: PrlSnapshot | null = input.archives ? null : {
        formatVersion: 1, fetchedAt: receipt.fetchedAt, sourceFile: `${receipt.member} (sha256 ${receipt.sourceSha256})`,
        sourceUrl: dataset.url, rowsInFile: receipt.rowsSeen, rowsWithStatements: profiles.length,
        profiles: [...profiles], rosterMisses: [], attribution: PRL_RHETORIC_ATTRIBUTION,
      };
      const next: PrlArchiveProjection = { formatVersion: 1, datasets: { ...projection.datasets, [dataset.id]: receipt } };
      const candidate = snapshot ? prlCandidate({ snapshot, sourceEvidence: { sha256: receipt.sourceSha256, bytes: receipt.sourceBytes ?? 0 },
        finalUrl: receipt.sourceFinalUrl ?? receipt.sourceUrl, retrievedAt: receipt.fetchedAt }) : prlArchiveCandidate({ projection: next, receipt, checkedAt });
      last = await processRegisteredManualCandidate(input.store, contractId, candidate, checkedAt);
      if (!last.promoted) throw new Error(last.candidate.failureCode ?? "PRL_PUBLICATION_REFUSED");
      projection = next;
      await writeReceipt(input.archive, receipt);
      if (receipt.failedSourceCheck) failures.push(`${dataset.id}: ${receipt.failedSourceCheck.at}: ${receipt.failedSourceCheck.detail}`);
    } catch (error) {
      failures.push(`${dataset.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) {
    const attemptedAt = new Date().toISOString();
    const candidate = failedAcquisitionCandidate({ sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
      requestedUrl: datasets[0].url, attemptedAt, failureDetail: failures.join("; "), parserVersion: contract.parserNormalizerVersion });
    last = await processRegisteredManualCandidate(input.store, contractId, candidate, attemptedAt);
  }
  if (!last) throw new Error("PRL_NO_SOURCE_ATTEMPT");
  printSourceRunnerReceipt(contractId, last.candidate.candidate, last);
  return failures.length ? 2 : 0;
}

if (isDirectModuleExecution(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.includes("--promote") || !(args.includes("--archives") || args.includes("--dataset=profiles-national"))) {
    throw new Error("Use --promote with --archives or --dataset=profiles-national through the registered source task.");
  }
  prepareProductionCivicDataWrite();
  process.exitCode = await refreshPrl({ archives: args.includes("--archives"), store: new PostgresRoutineDataStore(), archive: resolveS3ArchiveStore() });
}
