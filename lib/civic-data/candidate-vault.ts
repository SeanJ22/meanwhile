import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { Query } from "../facts/publish.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { candidateChangeSet, civicRecordsFor } from "./changes.ts";
import { civicVersionRef, civicVersionVault, holdCivicVersion, readCivicVersionKind, readCivicVersionPath, readCivicVersionRows, readCivicVersionText,
  type CivicVersionVaultRef, type CivicVersionRowSelection, type CivicVersionTextRange } from "./version-vault.ts";
import type { RoutineCandidate, RoutineChangeSet } from "./types.ts";
import { sourceWorkClockMetadata, type SourceWorkClockMetadata } from "./source-work-clock.ts";

interface VaultPath { readonly version: CivicVersionVaultRef; readonly path: readonly string[] }
export interface CandidateVaultFormat {
  readonly formatVersion: 1;
  readonly readModel: CivicVersionVaultRef | null;
  readonly normalizedPayload: CivicVersionVaultRef | null;
  readonly excludedFacts: VaultPath | null;
  readonly previousFingerprint: string | null;
  /** Removed after the source-evidence readers switch to the vault accessor. */
  readonly inlineEvidence?: true;
  readonly civicRecords?: "DERIVED" | CivicVersionVaultRef;
  readonly excludedFactsPresent?: true;
  /** Small scheduling facts and input fingerprints, independent of the held source body. */
  readonly workClock?: SourceWorkClockMetadata;
  readonly portraitSchedule?: {readonly nextDueAt:unknown;readonly seen:unknown}|null;
}
export type VaultCandidate = Omit<RoutineCandidate,"readModel"|"normalizedPayload"|"excludedFacts"|"civicRecords"|"changeSet"> & {
  readonly vault: CandidateVaultFormat;
  readonly readModel?: unknown;
  /** Small source pointers and scheduling metadata remain available to SQL. The full parser output is in the vault. */
  readonly normalizedPayload: Readonly<Record<string,unknown>>;
};

const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
const hash=(value:unknown)=>canonicalCivicDataHash(value,{durable:true});

/** Keep source pointers and work boundaries in the database, rather than another roster/report/agenda copy. */
function sourceMetadata(value:unknown):Record<string,unknown>{
  const root=object(value);if(!root)return {};
  const fields=["captures","sourceProbe","continuationPending","sourceInputDigest","nextTermAt","nextDueAt","nextWorkAt"];
  return Object.fromEntries(fields.filter(key=>Object.hasOwn(root,key)).map(key=>[key,root[key]]));
}

/** A storage encoder only: callers keep their full, validated candidate for the write and its returned fingerprint. */
export async function holdCandidateFacts(vault:EvidenceStore,candidate:RoutineCandidate,previousFingerprint:string|null,
  options:{readonly retainReadModel:boolean;readonly retainEvidence?:boolean;readonly previousReadModel?:unknown}):Promise<VaultCandidate>{
  // Legacy predecessors have no archive yet. A writer may already own their
  // complete model; never fetch it again, or mistake a selected projection for it.
  if(previousFingerprint&&options.previousReadModel!==undefined&&hash(options.previousReadModel)===previousFingerprint)
    await holdCivicVersion(vault,options.previousReadModel,previousFingerprint);
  const modelHash=hash(candidate.readModel);
  const readModel=await holdCivicVersion(vault,candidate.readModel,modelHash);
  const normalizedHash=hash(candidate.normalizedPayload);
  const normalizedPayload=normalizedHash===modelHash?readModel:
    await holdCivicVersion(vault,candidate.normalizedPayload,normalizedHash);
  let excludedFacts:VaultPath|null=null;
  if(candidate.excludedFacts?.length){
    const root=object(candidate.normalizedPayload);
    if(normalizedPayload&&root?.excludedFacts&&hash(root.excludedFacts)===hash(candidate.excludedFacts))
      excludedFacts={version:normalizedPayload,path:["excludedFacts"]};
    else excludedFacts={version:await holdCivicVersion(vault,candidate.excludedFacts,hash(candidate.excludedFacts)),path:[]};
  }
  const civicRecords=candidate.civicRecords===undefined?undefined:
    hash(candidate.civicRecords)===hash(civicRecordsFor(candidate.recordClass,candidate.readModel))?"DERIVED" as const:
      await holdCivicVersion(vault,candidate.civicRecords,hash(candidate.civicRecords));
  const {readModel:_model,normalizedPayload:_normalized,excludedFacts:_facts,changeSet:_changes,civicRecords:_members,...metadata}=candidate;
  const portraitFact=candidate.excludedFacts?.find(fact=>fact.code==="PEOPLE_PORTRAIT_SCHEDULE");
  const portraitRecord=object(portraitFact?.record);
  const portraitSchedule=portraitFact?{nextDueAt:portraitRecord?.nextDueAt??null,seen:portraitRecord?.seen??null}:null;
  return {...metadata,normalizedPayload:options.retainEvidence?candidate.normalizedPayload as Record<string,unknown>:sourceMetadata(candidate.normalizedPayload),
    ...(options.retainEvidence&&candidate.excludedFacts?{excludedFacts:candidate.excludedFacts}:{}),
    ...(options.retainReadModel?{readModel:candidate.readModel}:{}),
    vault:{formatVersion:1,readModel,normalizedPayload,excludedFacts,previousFingerprint,
      workClock:sourceWorkClockMetadata(candidate),portraitSchedule,
      ...(civicRecords?{civicRecords}:{}),...(candidate.excludedFacts!==undefined?{excludedFactsPresent:true as const}:{}),
      ...(options.retainEvidence?{inlineEvidence:true as const}:{})}};
}

export function candidateVaultFormat(candidate:unknown):CandidateVaultFormat|null{
  const format=object(object(candidate)?.vault);
  if(!format)return null;
  if(format.formatVersion!==1)throw new Error("CIVIC_CANDIDATE_VAULT_FORMAT_INVALID");
  return format as unknown as CandidateVaultFormat;
}

/** Hydrate only when an operation actually needs parser evidence. Reader proofs use the scalar fingerprints. */
export async function hydrateCandidateFacts(vault:EvidenceStore,stored:unknown):Promise<unknown>{
  const format=candidateVaultFormat(stored);if(!format)return stored;
  const {vault:_vault,...candidate}=stored as VaultCandidate,reader=civicVersionVault(vault);
  const readModel=Object.hasOwn(candidate,"readModel")?candidate.readModel:format.readModel?await reader.read(format.readModel):null;
  const normalizedPayload=format.inlineEvidence?(stored as RoutineCandidate).normalizedPayload:format.normalizedPayload?format.normalizedPayload.fingerprint===format.readModel?.fingerprint?readModel:
    await reader.read(format.normalizedPayload):null;
  const excludedFacts=format.inlineEvidence?(stored as RoutineCandidate).excludedFacts??[]:format.excludedFacts?await reader.path(format.excludedFacts.version,format.excludedFacts.path):[];
  return {...candidate,readModel,normalizedPayload,...(format.excludedFacts||format.excludedFactsPresent?{excludedFacts}:{}),
    ...(format.civicRecords?{civicRecords:format.civicRecords==="DERIVED"?civicRecordsFor(candidate.recordClass,readModel):await reader.read(format.civicRecords)}:{})};
}

/** Rebuild a delta when requested, never as part of deciding whether a source changed. */
export async function rebuildCandidateChanges(vault:EvidenceStore,stored:unknown):Promise<RoutineChangeSet>{
  const candidate=await hydrateCandidateFacts(vault,stored) as RoutineCandidate;
  const format=candidateVaultFormat(stored);
  if(!format){if(candidate.changeSet)return candidate.changeSet;throw new Error("CIVIC_CANDIDATE_CHANGE_BASE_UNKNOWN");}
  let previous:unknown=null;
  if(format.previousFingerprint){
    const ref=await civicVersionRef(vault,format.previousFingerprint);
    if(!ref)throw new Error("CIVIC_CANDIDATE_CHANGE_BASE_NOT_IN_VAULT");
    previous=await civicVersionVault(vault).read(ref);
  }
  return candidateChangeSet(candidate,previous);
}

/** A selected source-evidence field can be rebuilt without selecting its candidate envelope. */
export async function readCivicCandidatePath(query:Query,vault:EvidenceStore|(()=>EvidenceStore),id:string,path:readonly string[]):Promise<unknown>{
  if(!path.length)throw new Error("CIVIC_CANDIDATE_PATH_REQUIRED");
  if(path[0]==="readModel")return readCivicVersionPath(query,vault,id,path.slice(1));
  const [header]=await query("SELECT candidate->'vault' AS vault FROM civic_data_candidates WHERE id=$1",[id]);
  if(!header)return null;
  const format=candidateVaultFormat(header);
  if(format){
    const reader=civicVersionVault(typeof vault === "function" ? vault() : vault);
    if(path[0]==="normalizedPayload")return format.normalizedPayload?reader.path(format.normalizedPayload,path.slice(1)):null;
    if(path[0]==="excludedFacts")return format.excludedFacts?reader.path(format.excludedFacts.version,[...format.excludedFacts.path,...path.slice(1)]):[];
    if(path[0]==="civicRecords"){
      if(format.civicRecords&&format.civicRecords!=="DERIVED")return reader.path(format.civicRecords,path.slice(1));
      if(!format.civicRecords)return null;
      const [row]=await query("SELECT record_class FROM civic_data_candidates WHERE id=$1",[id]);
      if(!row)return null;
      const value=format.readModel?await reader.read(format.readModel):null;
      const records=civicRecordsFor(row.record_class as RoutineCandidate["recordClass"],value);
      let result:unknown=records;for(const key of path.slice(1))result=object(result)?.[key]??(Array.isArray(result)?result[Number(key)]:null);
      return result;
    }
  }
  const [row]=await query(`WITH RECURSIVE selected(value,depth) AS (
    SELECT candidate,0 FROM civic_data_candidates WHERE id=$1
    UNION ALL SELECT CASE WHEN jsonb_typeof(reader_payload_node(value))='array' OR reader_payload_node(value)->>'kind'='array'
      THEN CASE WHEN ($2::text[])[depth+1]~'^[0-9]{1,9}$'
        THEN (SELECT item FROM reader_payload_members(value) WHERE ordinal_index=(($2::text[])[depth+1])::int+1) END
      ELSE reader_payload_node(value)->($2::text[])[depth+1] END,depth+1 FROM selected WHERE depth<cardinality($2::text[])
  ) SELECT reader_payload_value(value) AS value FROM selected ORDER BY depth DESC LIMIT 1`,[id,[...path]]);
  return row?.value??null;
}

/** Bounded historical model access for readers that need selected rows or text. */
export const readCivicCandidateRows = (query: Query, vault: EvidenceStore | (() => EvidenceStore), id: string,
  path: readonly string[], selection: CivicVersionRowSelection = {}) => readCivicVersionRows(query, vault, id, path, selection);
export const readCivicCandidateKind = (query: Query, vault: EvidenceStore | (() => EvidenceStore), id: string,
  path: readonly string[], preferLegacyCandidate=false) => readCivicVersionKind(query, vault, id, path, preferLegacyCandidate);

/** Legacy encoded history must still reach the ordinary proof reader, even when its selected rows do not match. */
export async function readCivicCandidateLegacyEncoding(query:Query,ids:readonly string[]):Promise<ReadonlyMap<string,{encoded:boolean;hasModel:boolean}>> {
  const rows=await query(`SELECT id,candidate IS NULL OR coalesce(jsonb_path_exists(candidate->'readModel',
    'strict $.**."$civicPayloadPart"','{}'::jsonb,true),false) AS encoded,
    coalesce(candidate ? 'readModel' OR candidate#>'{vault,readModel}' IS NOT NULL,false) AS has_model
    FROM civic_data_candidates WHERE id=ANY($1::text[])`,[[...ids]]);
  return new Map(rows.map(row=>[String(row.id),{encoded:row.encoded===true,hasModel:row.has_model===true}]));
}
export const readCivicCandidateText = (query: Query, vault: EvidenceStore | (() => EvidenceStore), id: string,
  path: readonly string[], range: CivicVersionTextRange = {}) => readCivicVersionText(query, vault, id, path, range);

/** Select source-evidence rows without returning the complete candidate envelope. */
async function readCandidateEvidenceRows(query:Query,vault:EvidenceStore|(()=>EvidenceStore),id:string,
  root:"normalizedPayload"|"excludedFacts",path:readonly string[],selection:CivicVersionRowSelection={}) {
  if ((root==="normalizedPayload"&&!path.length) || !Number.isSafeInteger(selection.afterOrdinal??0) || (selection.afterOrdinal??0)<0 ||
      selection.limit!==undefined && (!Number.isSafeInteger(selection.limit)||selection.limit<1)) throw new Error("CIVIC_CANDIDATE_ROW_RANGE_INVALID");
  const [header]=await query("SELECT candidate->'vault' AS vault FROM civic_data_candidates WHERE id=$1",[id]);
  if(!header)return [];
  const format=candidateVaultFormat(header);
  if(format){
    const target=root==="normalizedPayload"?(format.normalizedPayload?{version:format.normalizedPayload,path:[] as readonly string[]}:null):format.excludedFacts;
    if(!target)return [];
    return civicVersionVault(typeof vault==="function"?vault():vault).rows(target.version,[...target.path,...path],selection);
  }
  const rows=await query(`WITH RECURSIVE selected(value,depth) AS (
    SELECT reader_payload_node(candidate)->'${root}',0 FROM civic_data_candidates WHERE id=$1
    UNION ALL SELECT reader_payload_node(value)->($2::text[])[depth+1],depth+1 FROM selected WHERE depth<cardinality($2::text[])
  ), members AS (SELECT ordinal_index,reader_payload_node(item) AS value FROM selected,
    LATERAL reader_payload_members(selected.value) WHERE depth=cardinality($2::text[]))
  SELECT ordinal_index AS ordinal,reader_payload_value(CASE WHEN $5::text[] IS NULL THEN value-$6::text[]
    ELSE (SELECT coalesce(jsonb_object_agg(key,value->key),'{}'::jsonb) FROM unnest($5::text[]) key WHERE value?key) END) AS value
  FROM members WHERE ordinal_index>$7::int AND ($9::int=0 OR jsonb_typeof(value)='object')
    AND ($3::text[] IS NULL OR reader_payload_value(value)#>>$3::text[]=ANY($4::text[]))
    ORDER BY ordinal_index LIMIT $8::int`,[id,[...path],selection.match?[...selection.match.path]:null,
      selection.match?[...selection.match.values]:null,selection.fields?[...selection.fields]:null,[...selection.omit??[]],selection.afterOrdinal??0,selection.limit??null,selection.skipNonObjects?1:0]);
  return rows.map(row=>({ordinal:Number(row.ordinal),value:row.value as Record<string,unknown>}));
}

export const readCivicCandidateEvidenceRows=(query:Query,vault:EvidenceStore|(()=>EvidenceStore),id:string,
  path:readonly string[],selection:CivicVersionRowSelection={})=>readCandidateEvidenceRows(query,vault,id,"normalizedPayload",path,selection);
export const readCivicCandidateExcludedRows=(query:Query,vault:EvidenceStore|(()=>EvidenceStore),id:string,
  selection:CivicVersionRowSelection={})=>readCandidateEvidenceRows(query,vault,id,"excludedFacts",[],selection);
