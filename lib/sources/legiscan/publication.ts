import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import { sourceProjectionEvidence,type RoutineCandidate } from "../../civic-data/types.ts";
import { processRegisteredFanOutCandidate,processRegisteredRoutineCandidate } from "../../civic-data/promotion.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { LEGISCAN_BULK_CONTRACT,LEGISCAN_BULK_PARSER,LEGISCAN_SPONSOR_MATCH,LEGISCAN_BULK_SCOPE,billScope,billPartScope,stateOfDataset,publicDatasetIndex,normalizeSession,sessionSponsorEvidence,type Dataset,type BillIndex,type BillPart,type BillPartPointer,type BillSession,type HeldPerson } from "./bills.ts";
import type { BulkCapture } from "./acquisition.ts";
import { runBoundedWorkPool } from "../../ops/bounded-work-pool.ts";
import { confirmSourceHashUnchanged } from "../../civic-data/source-hash.ts";
const hash=(value:unknown)=>createHash("sha256").update(typeof value==="string"?value:canonicalCivicDataJson(value)).digest("hex");
export const LEGISCAN_PART_ROWS=250;
/** Raw-member byte target; an indivisible larger bill stays in its own part. Escaping adds metadata. */
export const LEGISCAN_PART_BYTES=4*1024*1024;
interface PartSourceMembers {
  readonly formatVersion:1;readonly parentRawHash:string;readonly archiveHash:string;readonly partIndex:number;readonly memberOffset:number;
  readonly dataset:Dataset;readonly rawHash:string;readonly memberHashes:readonly string[];readonly billIds:readonly string[];
  readonly counts:BillPart["counts"];readonly sessionSponsorHash:string;readonly sourceSponsors:readonly Record<string,unknown>[];
}
interface BulkInput {capture:BulkCapture;dataset?:Dataset;bodies?:readonly string[];people?:readonly HeldPerson[];datasets?:readonly Dataset[];partIndex?:number;parts?:BillPartPointer[];counts?:BillPart["counts"];archiveHash?:string;sessionSponsors?:readonly Record<string,unknown>[];partSourceMembers?:PartSourceMembers;}
function partSourceMembers(input:BulkInput,value:BillPart):PartSourceMembers{
  const source=JSON.parse(input.capture.body);
  return{formatVersion:1,parentRawHash:source.parentRawHash,archiveHash:source.archiveHash,partIndex:source.partIndex,memberOffset:source.memberOffset,
    dataset:source.dataset,rawHash:input.capture.rawHash,memberHashes:source.bodies.map(hash),billIds:value.bills.map(bill=>bill.id),
    counts:value.counts,sessionSponsorHash:hash(source.sessionSponsors),sourceSponsors:sessionSponsorEvidence(source.bodies)};
}
export function bulkCandidate(input:BulkInput):RoutineCandidate {
  const {capture}=input;
  const datasets=input.datasets?.map(({access_key:_access,...row})=>row) ?? [];
  const {access_key:_access,...dataset}=input.dataset??{};
  const {bodies:_duplicateBodies,sessionSponsors:_duplicateSponsors,...evidence}=input;
  const sourceId="legiscan-bills", recordClass="STATE_BILL";
  const readModel:BillPart|BillSession|BillIndex=!input.dataset?publicDatasetIndex({kind:"INDEX",parserVersion:LEGISCAN_BULK_PARSER,capturedAt:capture.retrievedAt,datasets}):
    input.parts?{kind:"SESSION",parserVersion:LEGISCAN_BULK_PARSER,sponsorMatchVersion:LEGISCAN_SPONSOR_MATCH,dataset:dataset as Dataset,state:stateOfDataset(input.dataset),capturedAt:capture.retrievedAt,parts:input.parts,counts:input.counts!}:
    {...normalizeSession(input.dataset,input.bodies??[],capture.retrievedAt,input.people,input.sessionSponsors),sourceRawHash:capture.rawHash};
  const payload=JSON.parse(JSON.stringify({...evidence,...(input.dataset?{dataset}:{}),...(input.datasets?{datasets}:{}),
    ...(readModel.kind==="PART"?{partSourceMembers:partSourceMembers(input,readModel)}:{})}));
  // Exact bytes and recomputed sponsor joins identify a part across interrupted observations.
  const fingerprint=hash(readModel.kind==="PART"?{parser:LEGISCAN_BULK_PARSER,rawHash:capture.rawHash,model:{...readModel,capturedAt:null}}:
    `${LEGISCAN_BULK_PARSER}|${hash(payload)}`);
  const scope=!input.dataset?LEGISCAN_BULK_SCOPE:input.parts?billScope(input.dataset.session_id):billPartScope(input.dataset,input.partIndex??0,fingerprint);
  const rows=readModel.kind==="PART"?readModel.bills:readModel.kind==="SESSION"?readModel.parts:datasets;
  const identities=readModel.kind==="PART"?readModel.bills.map(row=>({subjectId:row.id,jurisdiction:row.state==="US"?"US":`US-${row.state}`,identifiers:{bill_id:String(row.billId),session_id:String(row.sessionId)},matchBasis:"OFFICIAL_ID" as const,ambiguous:false})):
    readModel.kind==="SESSION"?readModel.parts.map(row=>({subjectId:row.scope,jurisdiction:readModel.state==="US"?"US":`US-${readModel.state}`,identifiers:{session_id:String(readModel.dataset.session_id)},matchBasis:"OFFICIAL_ID" as const,ambiguous:false})):
    datasets.map(row=>({subjectId:`legiscan-bills:session:${row.session_id}`,jurisdiction:"US",identifiers:{session_id:String(row.session_id)},matchBasis:"OFFICIAL_ID" as const,ambiguous:false}));
  return {id:`cv-${hash(`${scope}|${fingerprint}`).slice(0,32)}`,sourceId,recordClass,scope,
    retrieval:{succeeded:true,requestedUrl:capture.requestedUrl,finalUrl:capture.finalUrl,httpStatus:capture.httpStatus,retrievedAt:capture.retrievedAt,rawHash:capture.rawHash},
    normalization:{succeeded:true,parserVersion:LEGISCAN_BULK_PARSER,schemaVersion:"legiscan-bills/4",normalizedHash:hash(readModel),normalizedPayloadHash:hash(payload),inputRecords:rows.length,outputRecords:rows.length,droppedRecords:0,missingRequiredFields:[]},
    identities,temporal:{version:input.dataset?.dataset_date??capture.retrievedAt,expectedVersion:input.dataset?.dataset_date??capture.retrievedAt,sourceThrough:capture.retrievedAt,staleAtRetrieval:false},
    semantics:{factKind:"LegiScan attributed bills, statuses, sponsors and text links",violations:[]},
    horizon:{kind:"BOUNDED",query:scope,returnedRecords:rows.length,declaredTotal:rows.length,paginationComplete:true,claimsComplete:true},
    absence:{claimsAbsence:false,basis:"NONE",exactSubject:null,exactHorizon:null},
    sourceProjectionEvidence:sourceProjectionEvidence(sourceId,recordClass,scope),
    dependentChecks:[{consumer:"LegiScan bills reader",passed:rows.length>0,detail:`${rows.length} source records retained including unresolved sponsor joins.`}],normalizedPayload:payload,readModel};
}
export async function publishBulkCandidate(store:RoutineDataStore,input:Parameters<typeof bulkCandidate>[0],now:string) {
  if(!input.dataset){const candidate=bulkCandidate(input);return {candidate,outcome:await processRegisteredRoutineCandidate(store,LEGISCAN_BULK_CONTRACT,candidate,now)};}
  const archiveHash=input.archiveHash??/"archiveHash":"([a-f0-9]{64})"/.exec(input.capture.body.slice(0,4096))?.[1];
  if(!archiveHash||!input.bodies?.length)throw Error("LEGISCAN_ARCHIVE_EVIDENCE_REQUIRED");
  const {access_key:_access,...dataset}=input.dataset;
  const parts:BillPartPointer[]=[];
  const counts:BillPart["counts"]={rows:0,joined:0,unjoined:0,sponsorsJoined:0,sponsorsUnjoined:0};
  const seen=new Set<string>();
  const sessionSponsors=sessionSponsorEvidence(input.bodies);
  const sessionSponsorHash=hash(sessionSponsors);
  const chunks:{bodies:string[];memberOffset:number}[]=[];
  let memberOffset=0;
  let bodies:string[]=[],bytes=0;
  const addChunk=()=>{if(bodies.length){chunks.push({bodies,memberOffset});memberOffset+=bodies.length;bodies=[];bytes=0;}};
  for(const source of input.bodies){
    const size=Buffer.byteLength(source);
    if(bodies.length&&(bodies.length>=LEGISCAN_PART_ROWS||bytes+size>LEGISCAN_PART_BYTES))addChunk();
    bodies.push(source);bytes+=size;
  }
  addChunk();
  const published=await runBoundedWorkPool(chunks,2,async({bodies,memberOffset},partIndex)=>{
    const body=JSON.stringify({dataset,archiveHash,parentRawHash:input.capture.rawHash,partIndex,memberOffset,bodies,sessionSponsors});
    const capture={...input.capture,body,rawHash:hash(body)};
    const candidate=bulkCandidate({capture,dataset,bodies,people:input.people,partIndex,archiveHash,sessionSponsors});
    const value=candidate.readModel as BillPart;
    for(const bill of value.bills){if(seen.has(bill.id))throw Error("LEGISCAN_DUPLICATE_BILL");seen.add(bill.id);}
    // Completed source parts survive a pass interruption. Reuse only the same exact
    // bytes and recomputed joins; a changed roster, source or matcher publishes anew.
    const confirmed=await confirmSourceHashUnchanged({store,sourceId:"legiscan-bills",recordClass:"STATE_BILL",scope:candidate.scope,
      parserVersion:LEGISCAN_BULK_PARSER,rawHash:capture.rawHash,retrieval:capture,now,complete:true});
    if(confirmed){
      console.log(`RCD_PROGRESS=${JSON.stringify({key:candidate.scope,records:value.bills.length})}`);
      return {scope:candidate.scope,versionId:confirmed.head.versionId,rawHash:capture.rawHash,rows:value.bills.length,counts:value.counts};
    }
    if(!store.readPublicationBase)throw Error("LEGISCAN_PUBLICATION_BASE_READER_REQUIRED");
    const publicationBase=await store.readPublicationBase("STATE_BILL",candidate.scope);
    const outcome=await processRegisteredFanOutCandidate(store,LEGISCAN_BULK_CONTRACT,candidate,now,undefined,{publicationBase});
    if(!outcome.promoted)throw Error(`LEGISCAN_PART_PUBLICATION_FAILED:${JSON.stringify(outcome.candidate.receipt?.checks.filter(row=>row.verdict!=="PASS"))}`);
    console.log(`RCD_PROGRESS=${JSON.stringify({key:candidate.scope,records:value.bills.length})}`);
    return {scope:candidate.scope,versionId:outcome.promoted.versionId,rawHash:capture.rawHash,rows:value.bills.length,counts:value.counts};
  });
  for(const result of published){
    if(!result.ok)throw Error(result.error);
    const {counts:partCounts,...pointer}=result.value;parts.push(pointer);
    for(const key of Object.keys(counts) as (keyof typeof counts)[])counts[key]+=partCounts[key];
  }
  const body=JSON.stringify({dataset,archiveHash,parentCapture:input.capture,parts,counts,sessionSponsorHash});
  const candidate=bulkCandidate({capture:{...input.capture,body,rawHash:hash(body)},dataset,parts,counts,archiveHash});
  if(!store.readPublicationBase)throw Error("LEGISCAN_PUBLICATION_BASE_READER_REQUIRED");
  const publicationBase=await store.readPublicationBase("STATE_BILL",candidate.scope);
  const outcome=await processRegisteredFanOutCandidate(store,LEGISCAN_BULK_CONTRACT,candidate,now,undefined,{publicationBase});
  return {candidate,outcome};
}
/** Publisher stamps confirm every pointed part; a session marker cannot refresh missing bill bytes. */
export async function confirmBulkSession(store:RoutineDataStore,session:BillSession,versionId:string,retrieval:BulkCapture,now:string) {
  if(!store.confirmUnchanged)throw Error("LegiScan unchanged confirmation store unavailable");
  const stamps={session_id:String(session.dataset.session_id),dataset_hash:session.dataset.dataset_hash,dataset_date:session.dataset.dataset_date};
  for(const pointer of [...session.parts,{scope:billScope(session.dataset.session_id),versionId,rawHash:"",rows:session.counts.rows}]){
    const held=await store.readPromotionIdentity("STATE_BILL",pointer.scope);
    const candidate=await store.readPublishedCandidateMetadata(pointer.versionId);
    if(!held||held.versionId!==pointer.versionId||!candidate)throw Error("LEGISCAN_CONFIRMED_PART_MISSING");
    const result=await store.confirmUnchanged({sourceId:"legiscan-bills",recordClass:"STATE_BILL",scope:pointer.scope,parserVersion:LEGISCAN_BULK_PARSER,
      pointerVersionId:pointer.versionId,readModelHash:candidate.candidate.normalization.normalizedHash!,basis:"PUBLISHER_STAMPS_UNCHANGED",retrieval,
      stamps:[{key:String(session.dataset.session_id),held:stamps,fetched:stamps}]},now);
    if(result.kind!=="CONFIRMED")throw Error(`LegiScan unchanged check failed: ${result.kind}`);
  }
  return {kind:"CONFIRMED" as const,parts:session.parts.length};
}
/** A session's saved archive inventory must equal the exact, independently promoted member parts. */
export async function bulkManifestIssue(candidate:RoutineCandidate,store?:RoutineDataStore):Promise<string|null> {
  const value=candidate.readModel as BillSession|BillPart|BillIndex;
  if(value.kind!=="SESSION")return null;
  if(!store)return "Session source verification has no saved part store";
  try {
    const input=candidate.normalizedPayload as BulkInput;
    const evidence=JSON.parse(input.capture.body);
    const parent=evidence.parentCapture as BulkCapture;
    if(!parent||hash(parent.body)!==parent.rawHash)return "Session parent source hash differs";
    const inventory=JSON.parse(parent.body);
    if(canonicalCivicDataJson(inventory.dataset)!==canonicalCivicDataJson(value.dataset)||inventory.archiveHash!==evidence.archiveHash||!Array.isArray(inventory.memberHashes))return "Session parent archive inventory differs";
    const ids=new Set<string>(),sourceSponsors=new Map<string,Record<string,unknown>>();
    const counts:BillPart["counts"]={rows:0,joined:0,unjoined:0,sponsorsJoined:0,sponsorsUnjoined:0};
    let offset=0;
    for(const [index,pointer] of value.parts.entries()){
      const [held,record,part]=await Promise.all([store.readPromotionIdentity("STATE_BILL",pointer.scope),
        store.readPublishedCandidateMetadata(pointer.versionId),
        store.readCandidatePath<PartSourceMembers>(pointer.versionId,["normalizedPayload","partSourceMembers"])]);
      if(!held||held.versionId!==pointer.versionId||held.lastKnownGoodVersionId!==pointer.versionId||held.sourceId!=="legiscan-bills"||
        !record||record.state!=="PROMOTED"||!record.acquisitionSucceeded||record.receipt?.decision!=="GOOD"||
        record.promotedVersion!==pointer.versionId||record.lastKnownGoodVersion!==pointer.versionId||
        canonicalCivicDataJson(held.receipt)!==canonicalCivicDataJson(record.receipt)||!part||part.formatVersion!==1)return "Session references an unavailable promoted part";
      if(record.candidate.scope!==pointer.scope||record.candidate.retrieval.rawHash!==pointer.rawHash||part.rawHash!==pointer.rawHash)return "Session part version or raw source hash differs";
      if(part.parentRawHash!==parent.rawHash||part.archiveHash!==inventory.archiveHash||part.partIndex!==index||part.memberOffset!==offset||
        !pointer.scope.startsWith(`${billScope(value.dataset.session_id)}:${value.dataset.dataset_hash}:part:${index}:`)||
        canonicalCivicDataJson(part.dataset)!==canonicalCivicDataJson(value.dataset)||!Array.isArray(part.memberHashes)||!Array.isArray(part.billIds))return "Session part archive position differs";
      const hashes=part.memberHashes;
      if(canonicalCivicDataJson(hashes)!==canonicalCivicDataJson(inventory.memberHashes.slice(offset,offset+hashes.length))||pointer.rows!==hashes.length||part.billIds.length!==hashes.length||part.counts.rows!==hashes.length)return "Session part source members differ from the archive inventory";
      if(part.sessionSponsorHash!==evidence.sessionSponsorHash)return "Session part sponsor authority differs";
      for(const sponsor of part.sourceSponsors)sourceSponsors.set(JSON.stringify(sponsor),sponsor);
      for(const id of part.billIds){if(ids.has(id))return "Session repeats a source bill";ids.add(id);}
      for(const key of Object.keys(counts) as (keyof typeof counts)[])counts[key]+=part.counts[key];
      offset+=hashes.length;
    }
    if(offset!==inventory.memberHashes.length||canonicalCivicDataJson(counts)!==canonicalCivicDataJson(value.counts))return "Session parts do not cover the complete source archive";
    if(hash([...sourceSponsors.values()])!==evidence.sessionSponsorHash)return "Session sponsor authority differs from exact archive members";
    return null;
  }catch{return "Saved session archive parts cannot be verified";}
}
/** Rebuild from the saved source bytes before a reader can use the pointed facts. */
export function bulkProjectionIssue(candidate:RoutineCandidate,value:unknown):string|null {
  try {
    const input=candidate.normalizedPayload as Parameters<typeof bulkCandidate>[0];
    if(hash(input.capture.body)!==input.capture.rawHash||input.capture.rawHash!==candidate.retrieval.rawHash) return "Saved source hash differs";
    const capture=JSON.parse(input.capture.body);
    if(input.dataset && canonicalCivicDataJson(capture.dataset)!==canonicalCivicDataJson(input.dataset))return "Archive dataset evidence differs";
    if(input.dataset&&input.parts&&(canonicalCivicDataJson(capture.parts)!==canonicalCivicDataJson(input.parts)||canonicalCivicDataJson(capture.counts)!==canonicalCivicDataJson(input.counts)))return "Archive part manifest differs";
    if(input.dataset&&!input.parts&&(!Array.isArray(capture.bodies)||capture.partIndex!==(input.partIndex??0)))return "Archive part evidence differs";
    if(!input.dataset && canonicalCivicDataJson(capture.datasetlist)!==canonicalCivicDataJson(input.datasets)) return "Dataset list evidence differs";
    if(!input.dataset){
      const {parserVersion:_heldParser,...held}=publicDatasetIndex(value);
      const {parserVersion:_currentParser,...current}=publicDatasetIndex(bulkCandidate(input).readModel);
      return canonicalCivicDataJson(held)===canonicalCivicDataJson(current)?null:"Dataset facts differ from saved source";
    }
    const rebuilt=bulkCandidate({...input,...(input.dataset&&!input.parts?{bodies:capture.bodies,sessionSponsors:capture.sessionSponsors}:{})});
    if(input.partSourceMembers&&canonicalCivicDataJson(input.partSourceMembers)!==canonicalCivicDataJson((rebuilt.normalizedPayload as BulkInput).partSourceMembers))return "Bill source-member summary differs from exact saved members";
    return canonicalCivicDataJson(rebuilt.readModel)===canonicalCivicDataJson(value)?null:"Bill facts differ from saved source";
  } catch {return "Saved LegiScan source cannot be parsed";}
}
