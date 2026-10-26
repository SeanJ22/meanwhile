import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../../civic-data/types.ts";
import { processRegisteredRoutineCandidate } from "../../civic-data/promotion.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { OPEN_DATA_PARSER, openDataScope, openDataFactIssue, type OpenDataFact, type OpenDataSource, type OpenDataProjection, type OpenDataReport,type OpenDataPartitionRef } from "./model.ts";
import { openDataReports,normalizeEcho,normalizeSocrata } from "./normalize.ts";

const hash = (value:unknown) => createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex");
export function assertOpenDataProjection(value:OpenDataProjection, source:OpenDataSource) {
  if(value?.kind !== "open-data" || value.sourceId !== source || !Array.isArray(value.records) ||
      value.records.some(row=>row.sourceId!==source || openDataFactIssue(row)) ||
      !Array.isArray(value.reports) || value.reports.some(row=>!Number.isSafeInteger(row.loaded) || row.loaded<0 || row.loaded!==row.joined+row.unjoined))throw Error("Open-data projection has invalid facts or unreconciled source counts.");
  if(value.partitions && (new Set(value.partitions.map(p=>p.id)).size!==value.partitions.length || value.partitions.some(p=>!p.id ||
    p.key!==`project/freshness/source/${source}/reader/${p.sha256}.json` || !/^[a-f0-9]{64}$/.test(p.sha256) || !Number.isSafeInteger(p.count) || p.count<0)))throw Error("Open-data manifest has invalid immutable reader references.");
}
export async function readOpenDataProjection(source:OpenDataSource, partition="national", options:PromotedCivicDataReadOptions={}) {
  const read = await readPromotedCivicData<OpenDataProjection>("CURATED_READER_RECORD",openDataScope(source,partition),options);
  if(read.kind==="PROMOTED")assertOpenDataProjection(read.value,source);
  return read;
}
export interface OpenDataCapture {
  readonly url:string; readonly retrievedAt:string; readonly rawHash:string;
  readonly sourceRows:readonly Record<string,unknown>[];
  readonly sourceCheck?: import("../../civic-data/types.ts").SourceCheckEvidence;
  /** Full bytes are in the shared immutable vault. This row list is an exact excerpt. */
  readonly archive?: {readonly sha256:string;readonly member:string;readonly publishedAt:string|null};
}
/** One source-byte capture, regardless of how often the same bytes were checked. Referenced excerpts are retained. */
export function openDataCaptures(captures:readonly OpenDataCapture[]):readonly OpenDataCapture[] {
  const bySource=new Map<string,OpenDataCapture>();
  for(const capture of captures){
    const key=hash([capture.url,capture.rawHash,capture.archive??null]),prior=bySource.get(key);
    if(!prior){bySource.set(key,capture);continue;}
    const rows=[...new Map([...prior.sourceRows,...capture.sourceRows].map(row=>[hash(row),row])).entries()]
      .sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row);
    const time=(row:OpenDataCapture)=>Date.parse(row.sourceCheck?.checkedAt??row.retrievedAt);
    const current=time(capture)>=time(prior)?capture:prior;
    bySource.set(key,{...current,sourceRows:rows});
  }
  return [...bySource].sort(([a],[b])=>a.localeCompare(b)).map(([,capture])=>capture);
}

export function openDataSourceContentHash(captures:readonly OpenDataCapture[]):string {
  return hash([...new Set(captures.map(capture=>canonicalCivicDataJson([capture.url,capture.rawHash,capture.archive??null])))].sort());
}
/** Shared by the registered candidate and immutable slices, without building unused candidate digests. */
export function openDataRowsBound(rows:readonly OpenDataFact[],captures:readonly OpenDataCapture[]):boolean {
  const sourceObjects=new Set(captures.flatMap(capture=>capture.sourceRows));
  const digests=new WeakMap<object,string>();
  const sourceHash=(row:object)=>{let value=digests.get(row);if(!value){value=hash(row);digests.set(row,value);}return value;};
  let sourceRows:Set<string>|undefined;
  return rows.every(row=>{
    if(!sourceObjects.has(row.sourceRow)) {
      sourceRows??=new Set([...sourceObjects].map(sourceHash));
      if(!sourceRows.has(sourceHash(row.sourceRow)))return false;
    }
    if(openDataFactIssue(row))return false;
    const parsed=row.kind==="EPA_FACILITY"?normalizeEcho(row.sourceRow,row.capturedAt,row.publishedAt):normalizeSocrata(row.sourceRow,row.capturedAt);
    const fieldsEqual=JSON.stringify(parsed.fields)===JSON.stringify(row.fields)||hash(parsed.fields)===hash(row.fields);
    return fieldsEqual && parsed.title===row.title && parsed.description===row.description && parsed.sourceUrl===row.sourceUrl &&
      parsed.publishedAt===row.publishedAt && parsed.updatedAt===row.updatedAt && parsed.sourceOrg===row.sourceOrg;
  })&&new Set(rows.map(row=>row.id)).size===rows.length;
}
export function openDataCandidate(input:{source:OpenDataSource;partition?:string;rows:readonly OpenDataFact[];
  reports?:readonly OpenDataReport[];partitions?:readonly OpenDataPartitionRef[];captures:readonly OpenDataCapture[];excludedFacts?:RoutineCandidate["excludedFacts"];now:string}):RoutineCandidate {
  const scope=openDataScope(input.source,input.partition), reports=input.reports ?? openDataReports(input.rows);
  const records=input.partitions?reports.reduce((n,r)=>n+r.loaded,0):input.rows.length;
  const readModel:OpenDataProjection={kind:"open-data",sourceId:input.source,records:input.rows,reports,...(input.partitions?{partitions:input.partitions}: {})};
  const captures=openDataCaptures(input.captures),normalizedPayload={captures};
  const rawHash=openDataSourceContentHash(captures), normalizedHash=hash(readModel);
  const last=[...captures].sort((a,b)=>Date.parse(a.retrievedAt)-Date.parse(b.retrievedAt)||
    Date.parse(a.sourceCheck?.checkedAt??a.retrievedAt)-Date.parse(b.sourceCheck?.checkedAt??b.retrievedAt)).at(-1);
  const bound=openDataRowsBound(input.rows,captures);
  return {id:`cv-${hash([input.source,scope,normalizedHash,rawHash,input.now]).slice(0,32)}`,sourceId:input.source,recordClass:"CURATED_READER_RECORD",scope,
    retrieval:{succeeded:!!last,requestedUrl:last?.url ?? "",finalUrl:last?.url ?? null,httpStatus:last?200:null,retrievedAt:last?.retrievedAt ?? input.now,rawHash,rawHashBasis:"SOURCE_CONTENT_V1",...(last?.sourceCheck?{sourceCheck:last.sourceCheck}:{})},
    normalization:{succeeded:bound,parserVersion:OPEN_DATA_PARSER,schemaVersion:OPEN_DATA_PARSER,normalizedHash,normalizedPayloadHash:hash(normalizedPayload),
      inputRecords:records,outputRecords:records,droppedRecords:0,missingRequiredFields:bound?[]:["exact captured source row"]},
    identities:input.rows.length ? input.rows.map(row=>({subjectId:row.id,jurisdiction:row.state?`US-${row.state}`:"US",identifiers:{record_id:row.id,...row.nativeIds},matchBasis:"EXACT_SCOPED_ID" as const,ambiguous:false})) :
      [{subjectId:scope,jurisdiction:"US",identifiers:{record_id:scope},matchBasis:"EXACT_SCOPED_ID",ambiguous:false}],
    temporal:{version:last?.retrievedAt ?? input.now,expectedVersion:last?.retrievedAt ?? input.now,sourceThrough:last?.retrievedAt ?? input.now,staleAtRetrieval:false},
    semantics:{factKind:"Native catalog and regulated-facility facts with source dates and unresolved joins retained",violations:[]},
    horizon:{kind:"OPEN_FACT_SET",query:scope,returnedRecords:records,declaredTotal:null,paginationComplete:false,claimsComplete:false},
    absence:{claimsAbsence:false,basis:"NONE",exactSubject:null,exactHorizon:null},sourceProjectionEvidence:sourceProjectionEvidence(input.source,"CURATED_READER_RECORD",scope),
    dependentChecks:[{consumer:"Government and place cards and Ask",passed:bound && new Set(input.rows.map(r=>r.id)).size===input.rows.length,detail:"Every projected row binds an exact saved source row; unjoined rows remain held."}],
    excludedFacts:input.excludedFacts,normalizedPayload,readModel};
}
export async function publishOpenData(input:Parameters<typeof openDataCandidate>[0]&{store:RoutineDataStore;replace?:boolean}) {
  if(input.partition && input.partition!=="national")throw Error("SRC-SO publishes one canonical national manifest per source.");
  const prior=await readOpenDataProjection(input.source,input.partition,{store:input.store,now:input.now});
  if(prior.kind==="STORE_UNREACHABLE")throw Error("Open-data prior could not be read; prior facts remain live.");
  const priorCaptures=prior.kind==="PROMOTED"?
    await input.store.readCandidatePath<readonly OpenDataCapture[]>(prior.metadata.versionId!,["normalizedPayload","captures"])??[]:[];
  const rows=[...new Map([...(input.replace?[]:prior.kind==="PROMOTED"?prior.value.records:[]),...input.rows].map(r=>[r.id,r])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  const referenced=new Set(rows.map(r=>hash(r.sourceRow)));
  const captures=openDataCaptures([...priorCaptures,...input.captures].map(c=>{
    const filtered={...c,sourceRows:c.sourceRows.filter(row=>referenced.has(hash(row)))};
    return filtered;
  }).filter(c=>c.sourceRows.length || !rows.length));
  const candidate=openDataCandidate({...input,rows,captures});
  const outcome=await processRegisteredRoutineCandidate(input.store,input.source,candidate,input.now,prior.kind==="PROMOTED"?prior.metadata.versionId:null);
  if(!outcome.promoted && !outcome.confirmed)throw Error(`Open-data publication held: ${outcome.candidate.failureDetail ?? outcome.candidate.state}`);
  return {candidate,outcome};
}
