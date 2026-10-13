/** One national bulk clock, publishing one bounded session at a time. */
import { pathToFileURL } from "node:url";
import { acquireDatasetList,acquireDataset } from "../lib/sources/legiscan/acquisition.ts";
import { LEGISCAN_BULK_CONTRACT,LEGISCAN_API,billScope,stateOfDataset,type BillSession,type HeldPerson } from "../lib/sources/legiscan/bills.ts";
import { publishBulkCandidate } from "../lib/sources/legiscan/publication.ts";
import { PostgresRoutineDataStore,type RoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { readStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { recordRegisteredSourceAcquisitionFailure,sourceAcquisitionFailure,withPublisherAcquisitionDeadline } from "../lib/civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";

export async function refreshLegiscan(store:RoutineDataStore,signal:AbortSignal,options:Omit<import("../lib/sources/legiscan/acquisition.ts").BulkRequestOptions,"signal"> & {peopleForState?:(state:string)=>Promise<readonly HeldPerson[]>}={}) {
  const list=await acquireDatasetList({...options,signal});
  // Publish the source index first: prior sessions remain available during the bulk pass.
  const marker=await publishBulkCandidate(store,{capture:list.capture,datasets:list.datasets},options.now?.()??new Date().toISOString());
  if(!marker.outcome.promoted) throw Error("LegiScan dataset index publication failed");
  const counts:Record<string,{rows:number;joined:number;unjoined:number;sponsorsJoined:number;sponsorsUnjoined:number;datasets:number;unchanged:number;failures:string[]}>= {};
  for(const dataset of list.datasets) {
    signal.throwIfAborted(); const state=stateOfDataset(dataset);
    const row=counts[state]??={rows:0,joined:0,unjoined:0,sponsorsJoined:0,sponsorsUnjoined:0,datasets:0,unchanged:0,failures:[]};
    try {
      const prior=await store.readPromotion<BillSession>("STATE_BILL",billScope(dataset.session_id));
      if(prior?.payload.kind==="SESSION"&&prior.payload.dataset.dataset_hash===dataset.dataset_hash&&prior.payload.dataset.dataset_date===dataset.dataset_date) {
        const stamps={session_id:String(dataset.session_id),dataset_hash:dataset.dataset_hash,dataset_date:dataset.dataset_date};
        const priorCandidate=await store.readCandidate(prior.versionId);
        if(!store.confirmUnchanged) throw Error("LegiScan unchanged confirmation store unavailable");
        const result=await store.confirmUnchanged({sourceId:"legiscan-bills",recordClass:"STATE_BILL",scope:billScope(dataset.session_id),parserVersion:"legiscan-bulk/2",pointerVersionId:prior.versionId,
          readModelHash:priorCandidate!.candidate.normalization.normalizedHash!,basis:"PUBLISHER_STAMPS_UNCHANGED",retrieval:list.capture,stamps:[{key:String(dataset.session_id),held:stamps,fetched:stamps}]},list.capture.retrievedAt);
        if(result.kind!=="CONFIRMED") throw Error(`LegiScan unchanged check failed: ${result.kind}`);
        for(const key of ["rows","joined","unjoined","sponsorsJoined","sponsorsUnjoined"] as const) row[key]+=prior.payload.counts[key];
        row.datasets++;row.unchanged++;continue;
      }
      const acquired=await acquireDataset(dataset,{...options,signal});
      const people=options.peopleForState?await options.peopleForState(state):state==="US"?[]:await readStatePeopleProjection(`US-${state}`,{store,now:acquired.capture.retrievedAt}).then(read=>read.kind==="PROMOTED"?read.value.roster.officeholders:[]);
      const published=await publishBulkCandidate(store,{capture:acquired.capture,dataset,bodies:acquired.bodies,people},options.now?.()??new Date().toISOString());
      if(!published.outcome.promoted) throw Error("LegiScan session publication failed");
      const session=published.candidate.readModel as BillSession;
      for(const key of ["rows","joined","unjoined","sponsorsJoined","sponsorsUnjoined"] as const) row[key]+=session.counts[key];
      row.datasets++;
    } catch(error) {row.failures.push(`Session ${dataset.session_id}: ${error instanceof Error?error.message:"unavailable"}`);}
  }
  return {marker,counts};
}
async function main() {
  if(process.argv.slice(2).join(" ")!=="--promote") throw Error("LEGISCAN_PROMOTE_REQUIRED");
  installNeonRequestDeadline();prepareProductionCivicDataWrite();const store=new PostgresRoutineDataStore();
  try {
    const {marker,counts}=await withPublisherAcquisitionDeadline("LegiScan bulk",ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,signal=>refreshLegiscan(store,signal));
    console.log(`LEGISCAN_ROWS_BY_STATE=${JSON.stringify(counts)}`);
    const failures=Object.values(counts).flatMap(row=>row.failures);
    if(failures.length) throw Error(failures.join("; "));
    printSourceRunnerReceipt(LEGISCAN_BULK_CONTRACT,marker.candidate,marker.outcome);
  } catch(error) {
    const failure=sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE",error instanceof Error?error.message:"LegiScan bulk unavailable");
    const failed=await recordRegisteredSourceAcquisitionFailure({store,contractId:LEGISCAN_BULK_CONTRACT,requestedUrl:LEGISCAN_API,failure});
    console.log(failed.line);process.exitCode=2;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) await main();
