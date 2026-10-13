import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import { sourceProjectionEvidence,type RoutineCandidate } from "../../civic-data/types.ts";
import { processRegisteredFanOutCandidate,processRegisteredRoutineCandidate } from "../../civic-data/promotion.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { LEGISCAN_BULK_CONTRACT,LEGISCAN_BULK_PARSER,LEGISCAN_BULK_SCOPE,billScope,normalizeSession,type Dataset,type BillIndex,type HeldPerson } from "./bills.ts";
import type { BulkCapture } from "./acquisition.ts";
const hash=(value:unknown)=>createHash("sha256").update(typeof value==="string"?value:canonicalCivicDataJson(value)).digest("hex");
export function bulkCandidate(input:{capture:BulkCapture;dataset?:Dataset;bodies?:readonly string[];people?:readonly HeldPerson[];datasets?:readonly Dataset[]}):RoutineCandidate {
  const {capture}=input;
  const datasets=input.datasets?.map(({access_key:_access,...row})=>row) ?? [];
  const {access_key:_access,...dataset}=input.dataset??{};
  const payload=JSON.parse(JSON.stringify({...input,...(input.dataset?{dataset}:{}),...(input.datasets?{datasets}:{})})), sourceId="legiscan", recordClass="STATE_BILL";
  const readModel=input.dataset?normalizeSession(input.dataset,input.bodies??[],capture.retrievedAt,input.people):{kind:"INDEX",capturedAt:capture.retrievedAt,datasets} satisfies BillIndex;
  const scope=input.dataset?billScope(input.dataset.session_id):LEGISCAN_BULK_SCOPE;
  const rows=readModel.kind==="SESSION"?readModel.bills:datasets;
  const identities=readModel.kind==="SESSION"?readModel.bills.map(row=>({subjectId:row.id,jurisdiction:row.state==="US"?"US":`US-${row.state}`,identifiers:{bill_id:String(row.billId),session_id:String(row.sessionId)},matchBasis:"OFFICIAL_ID" as const,ambiguous:false})):
    datasets.map(row=>({subjectId:`legiscan:session:${row.session_id}`,jurisdiction:"US",identifiers:{session_id:String(row.session_id)},matchBasis:"OFFICIAL_ID" as const,ambiguous:false}));
  return {id:`cv-${hash(`${scope}|${hash(payload)}`).slice(0,32)}`,sourceId,recordClass,scope,
    retrieval:{succeeded:true,requestedUrl:capture.requestedUrl,finalUrl:capture.finalUrl,httpStatus:capture.httpStatus,retrievedAt:capture.retrievedAt,rawHash:capture.rawHash},
    normalization:{succeeded:true,parserVersion:LEGISCAN_BULK_PARSER,schemaVersion:"legiscan-bills/1",normalizedHash:hash(readModel),normalizedPayloadHash:hash(payload),inputRecords:rows.length,outputRecords:rows.length,droppedRecords:0,missingRequiredFields:[]},
    identities,temporal:{version:input.dataset?.dataset_hash??hash(datasets),expectedVersion:input.dataset?.dataset_hash??hash(datasets),sourceThrough:capture.retrievedAt,staleAtRetrieval:false},
    semantics:{factKind:"LegiScan attributed bills, statuses, sponsors and text links",violations:[]},
    horizon:{kind:"BOUNDED",query:scope,returnedRecords:rows.length,declaredTotal:rows.length,paginationComplete:true,claimsComplete:true},
    absence:{claimsAbsence:false,basis:"NONE",exactSubject:null,exactHorizon:null},
    sourceProjectionEvidence:sourceProjectionEvidence(sourceId,recordClass,scope),
    dependentChecks:[{consumer:"LegiScan bills reader",passed:rows.length>0,detail:`${rows.length} source records retained including unresolved sponsor joins.`}],normalizedPayload:payload,readModel};
}
export async function publishBulkCandidate(store:RoutineDataStore,input:Parameters<typeof bulkCandidate>[0],now:string) {
  const candidate=bulkCandidate(input);
  const outcome=input.dataset?await processRegisteredFanOutCandidate(store,LEGISCAN_BULK_CONTRACT,candidate,now):await processRegisteredRoutineCandidate(store,LEGISCAN_BULK_CONTRACT,candidate,now);
  return {candidate,outcome};
}
/** Rebuild from the saved source bytes before a reader can use the pointed facts. */
export function bulkProjectionIssue(candidate:RoutineCandidate,value:unknown):string|null {
  try {
    const input=candidate.normalizedPayload as Parameters<typeof bulkCandidate>[0];
    if(hash(input.capture.body)!==input.capture.rawHash||input.capture.rawHash!==candidate.retrieval.rawHash) return "Saved source hash differs";
    const capture=JSON.parse(input.capture.body);
    if(input.dataset && (canonicalCivicDataJson(capture.dataset)!==canonicalCivicDataJson(input.dataset)||canonicalCivicDataJson(capture.bodies)!==canonicalCivicDataJson(input.bodies))) return "Archive evidence differs";
    if(!input.dataset && canonicalCivicDataJson(capture.datasetlist)!==canonicalCivicDataJson(input.datasets)) return "Dataset list evidence differs";
    return canonicalCivicDataJson(bulkCandidate(input).readModel)===canonicalCivicDataJson(value)?null:"Bill facts differ from saved source";
  } catch {return "Saved LegiScan source cannot be parsed";}
}
