import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { Query } from "../facts/publish.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { candidateChangeSet, civicRecordsFor } from "./changes.ts";
import { civicVersionRef, civicVersionVault, holdCivicVersion, readCivicVersionPath, type CivicVersionVaultRef } from "./version-vault.ts";
import type { RoutineCandidate, RoutineChangeSet } from "./types.ts";
import { sourceWorkClockFacts } from "./source-work-clock.ts";

interface VaultPath { readonly version: CivicVersionVaultRef; readonly path: readonly string[] }
export interface CandidateVaultFormat {
  readonly formatVersion: 1;
  readonly readModel: CivicVersionVaultRef | null;
  readonly normalizedPayload: CivicVersionVaultRef | null;
  readonly retainedSourceResponses?: CivicVersionVaultRef;
  readonly excludedFacts: VaultPath | null;
  readonly previousFingerprint: string | null;
  /** Legacy rows may also carry inline evidence. */
  readonly inlineEvidence?: true;
  readonly civicRecords?: "DERIVED" | CivicVersionVaultRef;
  readonly excludedFactsPresent?: true;
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
  const fields=["sourceProbe","continuationPending","sourceInputDigest","nextTermAt","nextDueAt","nextWorkAt"];
  return Object.fromEntries(fields.filter(key=>Object.hasOwn(root,key)).map(key=>[key,root[key]]));
}

/** A storage encoder only: callers keep their full, validated candidate for the write and its returned fingerprint. */
export async function holdCandidateFacts(vault:EvidenceStore,candidate:RoutineCandidate,previousFingerprint:string|null,
  options:{readonly retainReadModel:boolean;readonly retainEvidence?:boolean}):Promise<VaultCandidate>{
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
  const {readModel:_model,normalizedPayload:_normalized,excludedFacts:_facts,changeSet:_changes,civicRecords:_members,
    retainedSourceResponses,...metadata}=candidate as RoutineCandidate & {readonly retainedSourceResponses?:unknown};
  const retained=retainedSourceResponses===undefined?undefined:
    await holdCivicVersion(vault,retainedSourceResponses,hash(retainedSourceResponses));
  const workFacts=sourceWorkClockFacts(candidate);
  return {...metadata,normalizedPayload:options.retainEvidence?candidate.normalizedPayload as Record<string,unknown>:sourceMetadata(candidate.normalizedPayload),
    ...(options.retainEvidence&&candidate.excludedFacts?{excludedFacts:candidate.excludedFacts}:workFacts.length?{excludedFacts:workFacts}:{}),
    ...(options.retainReadModel?{readModel:candidate.readModel}:{}),
    vault:{formatVersion:1,readModel,normalizedPayload,excludedFacts,previousFingerprint,
      ...(retained?{retainedSourceResponses:retained}:{}),
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
    ...(format.retainedSourceResponses?{retainedSourceResponses:await reader.read(format.retainedSourceResponses)}:{}),
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
export async function readCivicCandidatePath(query:Query,vault:EvidenceStore|(()=>EvidenceStore),id:string,path:readonly string[],
  readLegacy?:()=>Promise<unknown>):Promise<unknown>{
  if(!path.length)throw new Error("CIVIC_CANDIDATE_PATH_REQUIRED");
  if(path[0]==="readModel")return readCivicVersionPath(query,vault,id,path.slice(1));
  const [header]=await query("SELECT candidate->'vault' AS vault FROM civic_data_candidates WHERE id=$1",[id]);
  if(!header)return null;
  const format=candidateVaultFormat(header);
  if(format){
    const reader=civicVersionVault(typeof vault==="function"?vault():vault);
    if(path[0]==="normalizedPayload")return format.normalizedPayload?reader.path(format.normalizedPayload,path.slice(1)):null;
    if(path[0]==="retainedSourceResponses"&&format.retainedSourceResponses)return reader.path(format.retainedSourceResponses,path.slice(1));
    if(path[0]==="excludedFacts")return format.excludedFacts?reader.path(format.excludedFacts.version,[...format.excludedFacts.path,...path.slice(1)]):[];
    if(path[0]==="civicRecords"&&format.civicRecords){
      if(format.civicRecords&&format.civicRecords!=="DERIVED")return reader.path(format.civicRecords,path.slice(1));
      const [row]=await query("SELECT record_class FROM civic_data_candidates WHERE id=$1",[id]);
      const value=format.readModel?await reader.read(format.readModel):null;
      const records=civicRecordsFor(row.record_class as RoutineCandidate["recordClass"],value);
      let result:unknown=records;for(const key of path.slice(1))result=object(result)?.[key]??(Array.isArray(result)?result[Number(key)]:null);
      return result;
    }
  }
  if(readLegacy)return readLegacy();
  const [row]=await query(`WITH RECURSIVE selected(value,depth) AS (
    SELECT candidate,0 FROM civic_data_candidates WHERE id=$1
    UNION ALL SELECT reader_payload_node(value)->($2::text[])[depth+1],depth+1 FROM selected WHERE depth<cardinality($2::text[])
  ) SELECT reader_payload_value(value) AS value FROM selected ORDER BY depth DESC LIMIT 1`,[id,[...path]]);
  return row?.value??null;
}
