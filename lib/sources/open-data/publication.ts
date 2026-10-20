import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../../civic-data/types.ts";
import { processRegisteredRoutineCandidate, processRegisteredFanOutCandidate } from "../../civic-data/promotion.ts";
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
export async function readOpenDataProjection(source:OpenDataSource, partition="release", options:PromotedCivicDataReadOptions={}) {
  if (partition === "national") throw new Error("OPEN_DATA_AREA_REQUIRED");
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
export function openDataCandidate(input:{source:OpenDataSource;partition?:string;rows:readonly OpenDataFact[];
  reports?:readonly OpenDataReport[];partitions?:readonly OpenDataPartitionRef[];stateScopes?:readonly string[];
  archive?:OpenDataProjection["archive"];captures:readonly OpenDataCapture[];now:string}):RoutineCandidate {
  const scope=openDataScope(input.source,input.partition), reports=input.reports ?? openDataReports(input.rows);
  const records=input.partitions||input.stateScopes?reports.reduce((n,r)=>n+r.loaded,0):input.rows.length;
  const readModel:OpenDataProjection={kind:"open-data",sourceId:input.source,records:input.rows,reports,...(input.partitions?{partitions:input.partitions}: {}),
    ...(input.stateScopes?{stateScopes:input.stateScopes}:{}),...(input.archive?{archive:input.archive}:{})};
  const normalizedPayload={captures:input.captures};
  const rawHash=hash(input.captures.map(c=>c.rawHash)), normalizedHash=hash(readModel);
  const last=input.captures.at(-1);
  const sourceRows=new Set(input.captures.flatMap(c=>c.sourceRows.map(hash)));
  const bound=input.rows.every(row=>{
    if(!sourceRows.has(hash(row.sourceRow)) || openDataFactIssue(row))return false;
    const parsed=row.kind==="EPA_FACILITY"?normalizeEcho(row.sourceRow,row.capturedAt,row.publishedAt):normalizeSocrata(row.sourceRow,row.capturedAt);
    return hash(parsed.fields)===hash(row.fields) && parsed.title===row.title && parsed.description===row.description && parsed.sourceUrl===row.sourceUrl &&
      parsed.publishedAt===row.publishedAt && parsed.updatedAt===row.updatedAt && parsed.sourceOrg===row.sourceOrg;
  });
  return {id:`cv-${hash([input.source,scope,normalizedHash,rawHash,input.now]).slice(0,32)}`,sourceId:input.source,recordClass:"CURATED_READER_RECORD",scope,
    retrieval:{succeeded:!!last,requestedUrl:last?.url ?? "",finalUrl:last?.url ?? null,httpStatus:last?200:null,retrievedAt:last?.retrievedAt ?? input.now,rawHash,...(last?.sourceCheck?{sourceCheck:last.sourceCheck}:{})},
    normalization:{succeeded:bound,parserVersion:OPEN_DATA_PARSER,schemaVersion:OPEN_DATA_PARSER,normalizedHash,normalizedPayloadHash:hash(normalizedPayload),
      inputRecords:records,outputRecords:records,droppedRecords:0,missingRequiredFields:bound?[]:["exact captured source row"]},
    identities:input.rows.length ? input.rows.map(row=>({subjectId:row.id,jurisdiction:row.state?`US-${row.state}`:"US",identifiers:{record_id:row.id,...row.nativeIds},matchBasis:"EXACT_SCOPED_ID" as const,ambiguous:false})) :
      [{subjectId:scope,jurisdiction:"US",identifiers:{record_id:scope},matchBasis:"EXACT_SCOPED_ID",ambiguous:false}],
    temporal:{version:normalizedHash,expectedVersion:normalizedHash,sourceThrough:last?.retrievedAt ?? input.now,staleAtRetrieval:false},
    semantics:{factKind:"Native catalog and regulated-facility facts with source dates and unresolved joins retained",violations:[]},
    horizon:{kind:"OPEN_FACT_SET",query:scope,returnedRecords:records,declaredTotal:null,paginationComplete:false,claimsComplete:false},
    absence:{claimsAbsence:false,basis:"NONE",exactSubject:null,exactHorizon:null},sourceProjectionEvidence:sourceProjectionEvidence(input.source,"CURATED_READER_RECORD",scope),
    dependentChecks:[{consumer:"Government and place cards and Ask",passed:bound && new Set(input.rows.map(r=>r.id)).size===input.rows.length,detail:"Every projected row binds an exact saved source row; unjoined rows remain held."}],
    normalizedPayload,readModel};
}
export async function publishOpenData(input:Parameters<typeof openDataCandidate>[0]&{store:RoutineDataStore}) {
  if(input.partition==="national")throw Error("OPEN_DATA_AREA_REQUIRED");
  if((input.partition===undefined||input.partition==="release")&&(input.rows.length||input.partitions?.length))throw Error("OPEN_DATA_RELEASE_COUNTS_ONLY");
  const state=/^state:([A-Z]{2})$/.exec(input.partition??"")?.[1];
  if(state&&(input.rows.some(row=>row.state!==state)||(input.reports??[]).some(row=>row.state!==state)||(input.partitions??[]).some(row=>{
    const named=/:state:([A-Z]{2})(?::|$)/.exec(row.id)?.[1]??/^division:ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(row.id)?.[1]?.toUpperCase();
    return named!==undefined&&named!==state;
  })))throw Error("OPEN_DATA_STATE_BOUNDARY_MISMATCH");
  const candidate=openDataCandidate(input);
  const prior=await input.store.readPromotionIdentity(candidate.recordClass,candidate.scope);
  const outcome=input.partition===undefined||input.partition==="release"
    ? await processRegisteredRoutineCandidate(input.store,input.source,candidate,input.now,prior?.versionId??null)
    : await processRegisteredFanOutCandidate(input.store,input.source,candidate,input.now,prior?.versionId??null,{confirmUnchanged:true});
  if(!outcome.promoted && !outcome.confirmed)throw Error(`Open-data publication held: ${outcome.candidate.failureDetail ?? outcome.candidate.state}`);
  return {candidate,outcome};
}
