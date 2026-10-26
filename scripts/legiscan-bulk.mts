/** One national clock, giving every jurisdiction its current session. */
import { pathToFileURL } from "node:url";
import { acquireDatasetList,acquireDataset } from "../lib/sources/legiscan/acquisition.ts";
import { LEGISCAN_BULK_CONTRACT,LEGISCAN_BULK_PARSER,LEGISCAN_SPONSOR_MATCH,billScope,stateOfDataset,type BillSession,type HeldPerson,type Dataset } from "../lib/sources/legiscan/bills.ts";
import { publishBulkCandidate,confirmBulkSession } from "../lib/sources/legiscan/publication.ts";
import { PostgresRoutineDataStore,type RoutineDataStore } from "../lib/civic-data/store.ts";
import { currentLegiscanDatasets } from "../lib/sources/legiscan/current-sessions.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { readStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { recordRegisteredSourceAcquisitionFailure,sourceAcquisitionFailure,withPublisherAcquisitionDeadline } from "../lib/civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { runBoundedWorkPool } from "../lib/ops/bounded-work-pool.ts";

/** Publisher years identify current sessions; numeric IDs also include older special sessions. */
export function bulkDatasetOrder(datasets:readonly Dataset[],checkedAt:ReadonlyMap<string,string>=new Map(),asOf=new Date().toISOString()):Dataset[] {
  const states=new Map<string,Dataset[]>();
  for(const dataset of currentLegiscanDatasets(datasets,asOf)){const state=stateOfDataset(dataset),rows=states.get(state)??[];rows.push(dataset);states.set(state,rows);}
  return [...states.entries()].sort(([a,ar],[b,br])=>(checkedAt.get(a)??"").localeCompare(checkedAt.get(b)??"")||ar[0].state_id-br[0].state_id).flatMap(([,rows])=>rows);
}

export async function refreshLegiscan(store:RoutineDataStore,signal:AbortSignal,options:Omit<import("../lib/sources/legiscan/acquisition.ts").BulkRequestOptions,"signal"> & {peopleForState?:(state:string)=>Promise<readonly HeldPerson[]>}={}) {
  const list=await withPublisherAcquisitionDeadline("LegiScan dataset index",ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,child=>acquireDatasetList({...options,signal:AbortSignal.any([signal,child])}));
  // Publish the source index first: prior sessions remain available during the bulk pass.
  const marker=await publishBulkCandidate(store,{capture:list.capture,datasets:list.datasets},options.now?.()??new Date().toISOString());
  if(!marker.outcome.promoted) throw Error("LegiScan dataset index publication failed");
  const counts:Record<string,{rows:number;joined:number;unjoined:number;sponsorsJoined:number;sponsorsUnjoined:number;datasets:number;unchanged:number;emptySessions:number[];failures:string[]}>= {};
  const current=bulkDatasetOrder(list.datasets,undefined,list.capture.retrievedAt),checkedAt=new Map<string,string>();
  await runBoundedWorkPool(current,4,async dataset=>{
    const prior=await store.readPromotion<BillSession>("STATE_BILL",billScope(dataset.session_id));
    const state=stateOfDataset(dataset),age=prior?.latestConfirmation?.retrieval.retrievedAt??prior?.promotedAt??"";
    if(!checkedAt.has(state)||age<checkedAt.get(state)!)checkedAt.set(state,age);
  });
  const groups=new Map<string,Dataset[]>();
  for(const dataset of bulkDatasetOrder(list.datasets,checkedAt,list.capture.retrievedAt)){const state=stateOfDataset(dataset),rows=groups.get(state)??[];rows.push(dataset);groups.set(state,rows);}
  const work=await runBoundedWorkPool([...groups],4,async([state,current])=>{
    signal.throwIfAborted();
    const row=counts[state]??={rows:0,joined:0,unjoined:0,sponsorsJoined:0,sponsorsUnjoined:0,datasets:0,unchanged:0,emptySessions:[],failures:[]};
    const dated=current.some(row=>row.year_start!==undefined);
    const candidates=dated?current:list.datasets.filter(dataset=>stateOfDataset(dataset)===state).sort((a,b)=>b.session_id-a.session_id);
    for(const scheduled of candidates) {
    // Scheduling fields stay in the source index; archive parts retain their existing evidence shape.
    const {year_start:_start,year_end:_end,special:_special,prefile:_prefile,...dataset}=scheduled;
    try {
      const prior=await store.readPromotion<BillSession>("STATE_BILL",billScope(dataset.session_id));
      if(prior?.payload.kind==="SESSION"&&prior.payload.parserVersion===LEGISCAN_BULK_PARSER&&prior.payload.sponsorMatchVersion===LEGISCAN_SPONSOR_MATCH&&Array.isArray(prior.payload.parts)&&prior.payload.dataset.dataset_hash===dataset.dataset_hash&&prior.payload.dataset.dataset_date===dataset.dataset_date) {
        await confirmBulkSession(store,prior.payload,prior.versionId,list.capture,list.capture.retrievedAt);
        for(const key of ["rows","joined","unjoined","sponsorsJoined","sponsorsUnjoined"] as const) row[key]+=prior.payload.counts[key];
        row.datasets++;row.unchanged++;if(!dated)return;continue;
      }
      const acquired=await withPublisherAcquisitionDeadline(`LegiScan ${state}`,ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,child=>acquireDataset(dataset,{...options,signal:AbortSignal.any([signal,child])}));
      const people=options.peopleForState?await options.peopleForState(state):state==="US"?[]:await readStatePeopleProjection(`US-${state}`,{store,now:acquired.capture.retrievedAt}).then(read=>read.kind==="PROMOTED"?read.value.roster.officeholders:[]);
      const published=await publishBulkCandidate(store,{capture:acquired.capture,dataset,bodies:acquired.bodies,people,archiveHash:acquired.archiveHash},options.now?.()??new Date().toISOString());
      if(!published.outcome.promoted) throw Error("LegiScan session publication failed");
      const session=published.candidate.readModel as BillSession;
      for(const key of ["rows","joined","unjoined","sponsorsJoined","sponsorsUnjoined"] as const) row[key]+=session.counts[key];
      row.datasets++;
      if(!dated)return;
    } catch(error) {
      if(error instanceof Error&&error.message==="LEGISCAN_ARCHIVE_BILLS_MISSING"){row.emptySessions.push(dataset.session_id);continue;}
      const detail=`Session ${dataset.session_id}: ${error instanceof Error?error.message:"unavailable"}`;
      row.failures.push(detail);console.error(`LEGISCAN_STATE_FAILURE=${JSON.stringify({state,detail})}`);if(!dated)return;
    }
    }
    if(!row.datasets&&!row.failures.length)row.failures.push("No nonempty publisher session is available");
  });
  for(const result of work)if(!result.ok)throw Error(result.error);
  return {marker,counts};
}
async function main() {
  if(process.argv.slice(2).join(" ")!=="--promote") throw Error("LEGISCAN_PROMOTE_REQUIRED");
  installNeonRequestDeadline();prepareProductionCivicDataWrite();const store=new PostgresRoutineDataStore();
  try {
    // Each acquisition has its own deadline. The standing parent's pass wall still applies.
    const {marker,counts}=await refreshLegiscan(store,new AbortController().signal);
    console.log(`LEGISCAN_ROWS_BY_STATE=${JSON.stringify(counts)}`);
    const failures=Object.values(counts).flatMap(row=>row.failures);
    if(failures.length) throw Error(failures.join("; "));
    printSourceRunnerReceipt(LEGISCAN_BULK_CONTRACT,marker.candidate,marker.outcome);
  } catch(error) {
    const failure=sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE",error instanceof Error?error.message:"LegiScan bulk unavailable");
    const failed=await recordRegisteredSourceAcquisitionFailure({store,contractId:LEGISCAN_BULK_CONTRACT,failure});
    console.log(failed.line);process.exitCode=2;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) await main();
