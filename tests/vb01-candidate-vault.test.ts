import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import { holdCandidateFacts, hydrateCandidateFacts, readCivicCandidatePath, rebuildCandidateChanges } from "../lib/civic-data/candidate-vault.ts";
import { holdCivicVersion } from "../lib/civic-data/version-vault.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";

const hash=(value:unknown)=>canonicalCivicDataHash(value,{durable:true});
function candidate():RoutineCandidate{
  const readModel={kind:"open-data",records:[{id:"row/one",title:"Resident fact",text:"A public source fact. ".repeat(6000)}]};
  const excludedFacts=[{key:"row/held",code:"SOURCE_UNAVAILABLE",detail:"Keep this gap open",record:{id:"row/held",nextDueAt:"2026-10-28T00:00:00Z"}}];
  const normalizedPayload={...readModel,excludedFacts,sourceProbe:{complete:true,nextTermAt:"2027-01-01T00:00:00Z"},captures:[{capture:{vaultKey:"raw/one"}}]};
  return {id:"version/one",sourceId:"curated-reader-primary-sources",recordClass:"CURATED_READER_RECORD",scope:"source:fixture",
    readModel,normalizedPayload,excludedFacts,identities:[],retrieval:{succeeded:true},normalization:{succeeded:true,normalizedHash:hash(readModel),normalizedPayloadHash:hash(normalizedPayload)},
    temporal:{},semantics:{},horizon:{},absence:{},dependentChecks:[],sourceProjectionEvidence:{},
  } as unknown as RoutineCandidate;
}

test("candidate format stores small pointers, restores exact evidence, and derives deltas from vault facts",async()=>{
  const vault=new MemoryEvidenceStore(),input=candidate();
  const previous={...(input.readModel as object),records:[{id:"row/one",title:"Earlier fact",text:"Earlier source words. ".repeat(4000)}]};
  const priorHash=hash(previous);await holdCivicVersion(vault,previous,priorHash);
  const withChanges={...input,changeSet:candidateChangeSet(input,previous)};
  const stored=await holdCandidateFacts(vault,withChanges,priorHash,{retainReadModel:false});
  for(const field of ["readModel","changeSet","excludedFacts","civicRecords"])assert.equal(Object.hasOwn(stored,field),false,field);
  assert.deepEqual(stored.normalizedPayload,{sourceProbe:(input.normalizedPayload as Record<string,unknown>).sourceProbe,captures:(input.normalizedPayload as Record<string,unknown>).captures});
  assert.ok(Buffer.byteLength(JSON.stringify(stored))<Buffer.byteLength(JSON.stringify(withChanges))*.4,"new candidate versions shrink at least 60%");
  const loaded=await hydrateCandidateFacts(vault,stored) as RoutineCandidate;
  assert.deepEqual(loaded.readModel,input.readModel);assert.deepEqual(loaded.normalizedPayload,input.normalizedPayload);
  assert.deepEqual(loaded.excludedFacts,input.excludedFacts);
  assert.deepEqual(await rebuildCandidateChanges(vault,stored),withChanges.changeSet);
  assert.deepEqual(stored.vault.excludedFacts?.path,["excludedFacts"],"held facts reuse their one normalized evidence copy");
  const seen:string[]=[];
  const query=async(text:string)=>{seen.push(text);return [{vault:stored.vault}];};
  assert.deepEqual(await readCivicCandidatePath(query,vault,input.id,["normalizedPayload","sourceProbe"]),(input.normalizedPayload as Record<string,unknown>).sourceProbe);
  assert.deepEqual(await readCivicCandidatePath(query,vault,input.id,["excludedFacts"]),input.excludedFacts);
  assert.ok(seen.every(text=>text==="SELECT candidate->'vault' AS vault FROM civic_data_candidates WHERE id=$1"));
});

test("transition format retains readModel until historical readers switch; failed evidence keeps its actual vault identity",async()=>{
  const vault=new MemoryEvidenceStore(),input=candidate();
  const transition=await holdCandidateFacts(vault,input,null,{retainReadModel:true});
  assert.deepEqual(transition.readModel,input.readModel);
  const failed={...input,normalization:{...input.normalization,normalizedHash:"0".repeat(64)}};
  const stored=await holdCandidateFacts(vault,failed,null,{retainReadModel:false});
  assert.equal(stored.normalization.normalizedHash,"0".repeat(64),"the refused declaration stays visible");
  assert.equal(stored.vault.readModel?.fingerprint,hash(input.readModel),"vault identity always describes actual facts");
  assert.deepEqual((await hydrateCandidateFacts(vault,stored) as RoutineCandidate).readModel,input.readModel);
  assert.deepEqual(await hydrateCandidateFacts(vault,input),input,"legacy rows need no changes or backfill");
});
