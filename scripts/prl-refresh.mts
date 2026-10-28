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
import { prlSourceContentHash,type PrlSourceProbe } from "../lib/sources/prl/source-hash.ts";
import { confirmSourceHashUnchanged,sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import type { PrlIngestReceipt } from "../lib/sources/prl/receipt.ts";

const ARCHIVES = ["profiles-state", "primary-rhetoric", "state-rhetoric", "statements-national", "newsletters", "press-releases", "floor-speeches"] as const;
async function failedPrlAttempt(store: RoutineDataStore, contractId: "prl" | "prl-archives", requestedUrl: string, detail: string) {
  const contract = requiredManualProductionContract(contractId);
  const attemptedAt = new Date().toISOString();
  return processRegisteredManualCandidate(store, contractId, failedAcquisitionCandidate({ sourceId: contract.sourceId,
    recordClass: contract.recordClass, scope: contract.scope, requestedUrl, attemptedAt, failureDetail: detail,
    parserVersion: contract.parserNormalizerVersion }), attemptedAt);
}

export async function refreshPrl(input: { archives: boolean; store: RoutineDataStore; archive?: PrlArchiveStore; fetchImpl?: typeof fetch;
  resolveArchive?: () => PrlArchiveStore }) {
  const contractId = input.archives ? "prl-archives" : "prl";
  const datasets: PrlDataset[] = (input.archives ? ARCHIVES : ["profiles-national"]).map(requiredPrlDataset);
  let archive: PrlArchiveStore;
  try { archive = input.archive ?? (input.resolveArchive ?? resolveS3ArchiveStore)(); }
  catch (error) {
    const failed = await failedPrlAttempt(input.store, contractId, datasets[0].url, error instanceof Error ? error.message : String(error));
    printSourceRunnerReceipt(contractId, failed.candidate.candidate, failed);
    return 2;
  }
  const contract=requiredManualProductionContract(contractId);
  const head=await input.store.readSourceHead(contract.recordClass,contract.scope);
  const plan=head?.parserVersion===contract.parserNormalizerVersion&&head.rawHashBasis==="SOURCE_CONTENT_V1"
    ?await input.store.readCandidatePath<PrlSourceProbe>(head.versionId,["normalizedPayload","sourceProbe"]):null;
  const sources:{dataset:PrlDataset;source:Awaited<ReturnType<typeof openPrlSource>>;prior:PrlIngestReceipt|null}[]=[];
  let last: Awaited<ReturnType<typeof processRegisteredManualCandidate>> | null = null;
  const failures: string[] = [];
  try {
  // Source hashes are available before any canonical profile or archive manifest is read.
  for(const dataset of datasets)try {
    const known=plan?.complete?plan.requests.find(request=>request.datasetId===dataset.id):null;
    const prior=known?null:await readReceipt(archive,dataset.id);
    const source=await openPrlSource(dataset,input.fetchImpl,archive,known?.rawHash??
      (prior?.parserVersion===PRL_INGEST_PARSER_VERSION?prior.sourceSha256:undefined));
    sources.push({dataset,source,prior});if(source.outage)failures.push(`${dataset.id}: ${source.outage}`);
  } catch(error){failures.push(`${dataset.id}: ${error instanceof Error?error.message:String(error)}`);}
  const current:PrlSourceProbe={formatVersion:1,parserVersion:contract.parserNormalizerVersion,complete:!failures.length&&sources.length===datasets.length,
    requests:sources.map(({dataset,source})=>({datasetId:dataset.id,requestedUrl:dataset.url,finalUrl:source.finalUrl,rawHash:source.sourceSha256,member:source.member}))};
  const check=sources.map(({dataset,source})=>({requestedUrl:dataset.url,finalUrl:source.finalUrl,httpStatus:source.lastCheckStatus as 200|304,
    rawHash:source.sourceSha256,checkedAt:source.checkedAt})).sort((a,b)=>a.checkedAt.localeCompare(b.checkedAt))[0];
  const selected=new Set(datasets.map(dataset=>dataset.id));
  const coversPointedSources=plan?.complete&&plan.requests.length===selected.size&&new Set(plan.requests.map(request=>request.datasetId)).size===selected.size&&
    plan.requests.every(request=>selected.has(request.datasetId));
  if(coversPointedSources&&current.complete&&check) {
    const rawHash=prlSourceContentHash(current),observedAt=new Date().toISOString();
    const confirmed=await confirmSourceHashUnchanged({store:input.store,sourceId:contract.sourceId,recordClass:contract.recordClass,scope:contract.scope,
      parserVersion:contract.parserNormalizerVersion,rawHash,complete:true,now:observedAt,retrieval:{requestedUrl:check.requestedUrl,
        finalUrl:check.finalUrl,httpStatus:200,rawHash,retrievedAt:sources.find(row=>row.dataset.url===check.requestedUrl)!.source.retrievedAt,sourceCheck:check}});
    if(confirmed){console.log("RCD_RECEIPT="+JSON.stringify({source:contractId,...sourceHashReceiptFields(confirmed),structuralReleaseContract:ZERO_RELEASE_EVENTS}));return 0;}
  }
  const held=input.archives?await readPrlArchiveProjection({store:input.store}):null;
  if(held&&held.kind!=="PROMOTED"&&held.kind!=="NOT_RECORDED")throw Error("PRL_ARCHIVE_PRIOR_UNAVAILABLE");
  let projection:PrlArchiveProjection=held?.kind==="PROMOTED"?held.value:{formatVersion:1,datasets:{}};
  let baseVersionId=held?.kind==="PROMOTED"?held.metadata.versionId:head?.versionId??null;
  for (const dataset of datasets) {
    try {
      const acquired=sources.find(row=>row.dataset.id===dataset.id);if(!acquired)continue;
      const prior = projection.datasets[dataset.id] ?? acquired.prior ?? await readReceipt(archive, dataset.id);
      if(acquired.source.unchanged&&(!prior||prior.parserVersion!==PRL_INGEST_PARSER_VERSION||prior.sourceSha256!==acquired.source.sourceSha256)) {
        await acquired.source.dispose();acquired.source=await openPrlSource(dataset,input.fetchImpl,archive);
      }
      const receipt = await ingestDataset({ dataset, archive, now: Date.now(), priorReceipt: prior,
        open: async () => acquired.source });
      const violations = prlReceiptViolations(receipt);
      if (violations.length) throw new Error(violations.join("; "));
      // Preserve completed native normalization before a deadline can cut off its canonical publication.
      await writeReceipt(archive,receipt);
      const checkedAt = new Date().toISOString();
      const profiles = receipt.profiles as readonly PrlMemberProfile[];
      const snapshot: PrlSnapshot | null = input.archives ? null : {
        formatVersion: 1, fetchedAt: receipt.fetchedAt, sourceFile: `${receipt.member} (sha256 ${receipt.sourceSha256})`,
        sourceUrl: dataset.url, rowsInFile: receipt.rowsSeen, rowsWithStatements: profiles.length,
        profiles: [...profiles], rosterMisses: [], attribution: PRL_RHETORIC_ATTRIBUTION,
      };
      const next: PrlArchiveProjection = { formatVersion: 1, datasets: { ...projection.datasets, [dataset.id]: receipt } };
      const receipts=input.archives?Object.values(next.datasets):[receipt];
      const sourceProbe:PrlSourceProbe={formatVersion:1,parserVersion:contract.parserNormalizerVersion,
        complete:current.complete&&receipts.length===selected.size&&datasets.every(item=>receipts.some(row=>row.datasetId===item.id&&row.parserVersion===PRL_INGEST_PARSER_VERSION&&
          row.sourceSha256===sources.find(acquisition=>acquisition.dataset.id===item.id)?.source.sourceSha256)),
        requests:receipts.map(row=>({datasetId:row.datasetId,requestedUrl:row.sourceUrl,finalUrl:row.sourceFinalUrl??row.sourceUrl,
          rawHash:row.sourceSha256,member:row.member}))};
      const sourceCheck=receipts.map(row=>{
        const acquired=sources.find(item=>item.dataset.id===row.datasetId)?.source;
        return {requestedUrl:row.sourceUrl,finalUrl:row.sourceFinalUrl??row.sourceUrl,
          httpStatus:(acquired?.sourceSha256===row.sourceSha256?acquired.lastCheckStatus:200) as 200|304,rawHash:row.sourceSha256,
          checkedAt:acquired?.sourceSha256===row.sourceSha256?acquired.checkedAt:row.fetchedAt};
      }).sort((a,b)=>a.checkedAt.localeCompare(b.checkedAt))[0];
      const candidate = snapshot ? prlCandidate({ snapshot, sourceEvidence: { sha256: receipt.sourceSha256, bytes: receipt.sourceBytes ?? 0 },
        finalUrl: receipt.sourceFinalUrl ?? receipt.sourceUrl, retrievedAt: receipt.fetchedAt,sourceProbe,sourceCheck })
        : prlArchiveCandidate({ projection: next, receipt, checkedAt,sourceProbe,sourceCheck });
      last = await processRegisteredManualCandidate(input.store, contractId, candidate, checkedAt,baseVersionId,
        {confirmUnchanged:plan?.formatVersion===1&&plan.complete===sourceProbe.complete});
      if (!last.promoted&&!last.confirmed) throw new Error(last.candidate.failureCode ?? "PRL_PUBLICATION_REFUSED");
      baseVersionId=last.promoted?.versionId??last.confirmed!.versionId;
      projection = next;
    } catch (error) {
      failures.push(`${dataset.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) {
    last = await failedPrlAttempt(input.store, contractId, datasets[0].url, failures.join("; "));
  }
  if (!last) throw new Error("PRL_NO_SOURCE_ATTEMPT");
  printSourceRunnerReceipt(contractId, last.candidate.candidate, last);
  return failures.length ? 2 : 0;
  } finally {for(const {source}of sources)await source.dispose();}
}

if (isDirectModuleExecution(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.includes("--promote") || !(args.includes("--archives") || args.includes("--dataset=profiles-national"))) {
    throw new Error("Use --promote with --archives or --dataset=profiles-national through the registered source task.");
  }
  prepareProductionCivicDataWrite();
  process.exitCode = await refreshPrl({ archives: args.includes("--archives"), store: new PostgresRoutineDataStore() });
}
