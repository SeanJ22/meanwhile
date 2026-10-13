import { readPromotedCivicData,type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { PostgresRoutineDataStore } from "../../civic-data/store.ts";
import { bulkProjectionIssue } from "./publication.ts";
import { LEGISCAN_BULK_SCOPE,billScope,stateOfDataset,joinSponsor,type BillSession,type BillIndex,type Bill,type HeldPerson } from "./bills.ts";
import { runBoundedWorkPool } from "../../ops/bounded-work-pool.ts";

export async function readBulkProjection(scope:string,options:PromotedCivicDataReadOptions={}) {
  const result=await readPromotedCivicData<BillSession|BillIndex>("STATE_BILL",scope,options);
  if(result.kind==="PROMOTED") {
    const store=options.store??new PostgresRoutineDataStore();
    const candidate=await store.readCandidate(result.metadata.versionId!);
    if(!candidate||candidate.candidate.sourceId!=="legiscan-bills"||bulkProjectionIssue(candidate.candidate,result.value)!==null) throw Error("LEGISCAN_BULK_PROJECTION_INVALID");
  }
  return result;
}
/** A request opens only sessions in its state. Missing sessions remain explicit coverage gaps. */
export async function readBillsForState(state:string,options:PromotedCivicDataReadOptions={}):Promise<{bills:Bill[];complete:boolean;checkedAt:string|null}> {
  const index=await readBulkProjection(LEGISCAN_BULK_SCOPE,options);
  if(index.kind!=="PROMOTED"||index.value.kind!=="INDEX") return {bills:[],complete:false,checkedAt:null};
  const datasets=index.value.datasets.filter(row=>stateOfDataset(row)===state.toUpperCase());
  const bills:Bill[]=[]; let complete=datasets.length>0;
  await runBoundedWorkPool(datasets,4,async dataset=>{
    const read=await readBulkProjection(billScope(dataset.session_id),options);
    if(read.kind!=="PROMOTED"||read.value.kind!=="SESSION") {complete=false;return;}
    if(read.value.state!==state.toUpperCase()) throw Error("LEGISCAN_READER_STATE_MISMATCH");
    if(read.value.dataset.dataset_hash!==dataset.dataset_hash) complete=false;
    bills.push(...read.value.bills);
  });
  return {bills,complete,checkedAt:index.metadata.retrievedAt};
}
export function billsForPerson(bills:readonly Bill[],person:HeldPerson):Bill[] {
  return bills.filter(bill=>bill.sponsors.some(sponsor=>joinSponsor(sponsor,[person]).officeholderId===person.id));
}
