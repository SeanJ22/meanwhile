import { readPromotedCivicData,type PromotedCivicDataReadOptions,type PromotedEdgeEntry } from "../../civic-data/read-model.ts";
import { PostgresRoutineDataStore } from "../../civic-data/store.ts";
import { bulkProjectionIssue } from "./publication.ts";
import { LEGISCAN_BULK_SCOPE,LEGISCAN_BULK_PARSER,billScope,stateOfDataset,joinSponsors,hydrateBillPart,type BillSession,type BillPart,type BillIndex,type Bill,type HeldPerson } from "./bills.ts";
import { runBoundedWorkPool } from "../../ops/bounded-work-pool.ts";
import { readCanonicalShelf } from "../../reader/canonical.ts";
import { readerCanonicalEntry } from "../../reader/canonical-context.ts";
import { currentReaderAuthorityEdge,ensurePromotedEdge,refuseDatabaseInEdgeOnlyContext } from "../../registry/runtime-edge.ts";

type BulkReadOptions=PromotedCivicDataReadOptions & {verifySavedSource?:true};
const READER_SCOPE_BATCH=16;
/** Manifest hashes and row counts identify whole bounded parts; member filtering follows their proof. */
async function exactBulkOptions(scopes:readonly string[],options:BulkReadOptions):Promise<BulkReadOptions> {
  if(options.store||options.edge||options.verifySavedSource)return options;
  const held=new Map<string,PromotedEdgeEntry>();
  await Promise.all(scopes.map(async scope=>{
    const canonical=readerCanonicalEntry("STATE_BILL",scope);
    if(canonical){held.set(scope,await canonical);return;}
    if(currentReaderAuthorityEdge()){
      const edge=await ensurePromotedEdge("STATE_BILL",scope);
      if(edge)held.set(scope,edge.value);
    }
  }));
  const missing=scopes.filter(scope=>!held.has(scope));
  if(missing.length)refuseDatabaseInEdgeOnlyContext(`LegiScan bill parts: ${missing.join(",")}`);
  const shelf=missing.length?await readCanonicalShelf(missing.map(scope=>({recordClass:"STATE_BILL" as const,scope}))):null;
  return {...options,store:{
    async readCandidate(){throw Error("LEGISCAN_READER_USES_CANONICAL_ENTRY");},
    async readPromotion(){throw Error("LEGISCAN_READER_USES_CANONICAL_ENTRY");},
    async readPromotedEntry(recordClass,scope){
      if(recordClass!=="STATE_BILL"||!scopes.includes(scope))throw Error("LEGISCAN_READER_SCOPE_NOT_SELECTED");
      const entry=held.get(scope);if(entry)return entry;
      return shelf!.readPromotedEntry!(recordClass,scope);
    },
  }};
}
export async function readBulkProjection(scope:string,options:BulkReadOptions={}) {
  options=await exactBulkOptions([scope],options);
  const result=await readPromotedCivicData<BillSession|BillPart|BillIndex>("STATE_BILL",scope,options);
  if(result.kind==="PROMOTED") {
    if(result.metadata.sourceId!=="legiscan-bills"||result.value.parserVersion!==LEGISCAN_BULK_PARSER)throw Error("LEGISCAN_BULK_SOURCE_INVALID");
    if(options.verifySavedSource){
      const store=options.store??new PostgresRoutineDataStore();
      const candidate=await store.readCandidate(result.metadata.versionId!);
      if(!candidate||candidate.candidate.normalization.parserVersion!==LEGISCAN_BULK_PARSER||bulkProjectionIssue(candidate.candidate,result.value)!==null)throw Error("LEGISCAN_BULK_PROJECTION_INVALID");
    }
  }
  return result;
}
/** A request opens only sessions in its state. Missing sessions remain explicit coverage gaps. */
export async function readBillsForState(state:string,options:PromotedCivicDataReadOptions & {person?:HeldPerson}={}):Promise<{bills:Bill[];complete:boolean;checkedAt:string|null}> {
  const index=await readBulkProjection(LEGISCAN_BULK_SCOPE,options);
  if(index.kind!=="PROMOTED"||index.value.kind!=="INDEX") return {bills:[],complete:false,checkedAt:null};
  const datasets=index.value.datasets.filter(row=>stateOfDataset(row)===state.toUpperCase());
  const bills:Bill[]=[]; let complete=datasets.length>0;
  for(let offset=0;offset<datasets.length;offset+=READER_SCOPE_BATCH){
    const batch=datasets.slice(offset,offset+READER_SCOPE_BATCH);
    const batchOptions=await exactBulkOptions(batch.map(dataset=>billScope(dataset.session_id)),options);
    const sessions=await runBoundedWorkPool(batch,4,async dataset=>{
    const read=await readBulkProjection(billScope(dataset.session_id),batchOptions);
    if(read.kind!=="PROMOTED"||read.value.kind!=="SESSION") {complete=false;return;}
    if(read.value.state!==state.toUpperCase()) throw Error("LEGISCAN_READER_STATE_MISMATCH");
    if(read.value.dataset.dataset_hash!==dataset.dataset_hash) complete=false;
    const session=read.value;
    const batches=Array.from({length:Math.ceil(session.parts.length/READER_SCOPE_BATCH)},(_,index)=>session.parts.slice(index*READER_SCOPE_BATCH,(index+1)*READER_SCOPE_BATCH));
    const fetched=await runBoundedWorkPool(batches,2,async parts=>{
      const partOptions=await exactBulkOptions(parts.map(part=>part.scope),options);
      const members=await runBoundedWorkPool(parts,4,part=>readBulkProjection(part.scope,partOptions));
      const values:Bill[]=[];let rows=0,completeBatch=true;
      for(const result of members){
      if(!result.ok)throw Error(`LEGISCAN_READER_PART_UNAVAILABLE:${result.error}`);
      const part=parts[result.index],member=result.value;
      if(member.kind!=="PROMOTED"||member.value.kind!=="PART"||member.metadata.versionId!==part.versionId){completeBatch=false;continue;}
      if(member.value.dataset.dataset_hash!==session.dataset.dataset_hash||member.value.dataset.session_id!==dataset.session_id||member.value.bills.length!==part.rows||member.value.sourceRawHash!==part.rawHash)throw Error("LEGISCAN_READER_PART_MISMATCH");
      values.push(...hydrateBillPart(member.value,options.person));rows+=member.value.bills.length;
      }
      return {bills:values,rows,complete:completeBatch};
    });
    let rows=0;
    for(const batch of [...fetched].sort((left,right)=>left.index-right.index)){
      if(!batch.ok)throw Error(`LEGISCAN_READER_PART_BATCH_UNAVAILABLE:${batch.error}`);
      bills.push(...batch.value.bills);rows+=batch.value.rows;if(!batch.value.complete)complete=false;
    }
    if(rows!==session.counts.rows)complete=false;
    });
    for(const result of sessions)if(!result.ok)throw Error(`LEGISCAN_READER_SESSION_UNAVAILABLE:${result.error}`);
  }
  if(new Set(bills.map(row=>row.id)).size!==bills.length)throw Error("LEGISCAN_READER_DUPLICATE_BILL");
  return {bills,complete,checkedAt:index.metadata.retrievedAt};
}
export function billsForPerson(bills:readonly Bill[],person:HeldPerson):Bill[] {
  const join=joinSponsors([person]);return bills.filter(bill=>bill.sponsors.some(sponsor=>join(sponsor).officeholderId===person.id));
}
