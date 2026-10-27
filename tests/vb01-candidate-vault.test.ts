import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { candidateChangeSet, civicRecordsFor } from "../lib/civic-data/changes.ts";
import { holdCandidateFacts, hydrateCandidateFacts, readCivicCandidatePath, rebuildCandidateChanges } from "../lib/civic-data/candidate-vault.ts";
import { civicVersionRef, holdCivicVersion } from "../lib/civic-data/version-vault.ts";
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

test("selected civic-record evidence preserves supplied records instead of replacing them with derived records",async()=>{
  const vault=new MemoryEvidenceStore(),input=candidate();
  const supplied=[{key:"unresolved-source-row",record:{id:"held/one",sourceText:"Source evidence that did not normalize."}}];
  const stored=await holdCandidateFacts(vault,{...input,civicRecords:supplied},null,{retainReadModel:false});
  const query=async(text:string)=>{
    assert.equal(text,"SELECT candidate->'vault' AS vault FROM civic_data_candidates WHERE id=$1");
    return [{vault:stored.vault}];
  };
  assert.deepEqual(await readCivicCandidatePath(query,vault,input.id,["civicRecords"]),supplied);
  assert.equal(await readCivicCandidatePath(query,vault,input.id,["civicRecords","0","record","sourceText"]),supplied[0].record.sourceText);
  const absent=await holdCandidateFacts(vault,input,null,{retainReadModel:false});
  assert.equal(await readCivicCandidatePath(async()=>[{vault:absent.vault}],vault,input.id,["civicRecords"]),null);
  const derived=civicRecordsFor(input.recordClass,input.readModel);
  const compact=await holdCandidateFacts(vault,{...input,civicRecords:derived},null,{retainReadModel:false});
  assert.equal(compact.vault.civicRecords,"DERIVED");
  assert.deepEqual(await readCivicCandidatePath(async text=>text.includes("record_class")?[{record_class:input.recordClass}]:[{vault:compact.vault}],
    vault,input.id,["civicRecords"]),derived);
});

test("the first post-legacy delta archives an already owned predecessor without another record read",async()=>{
  const vault=new MemoryEvidenceStore(),input=candidate();
  const previous={kind:"open-data",records:[{id:"row/one",title:"Earlier fact"},{id:"row/removed",title:"Removed fact"}]};
  const fingerprint=hash(previous),changeSet=candidateChangeSet(input,previous);
  assert.equal(await civicVersionRef(vault,fingerprint),null);
  const stored=await holdCandidateFacts(vault,{...input,changeSet},fingerprint,{retainReadModel:false,previousReadModel:previous});
  assert.ok(await civicVersionRef(vault,fingerprint));
  assert.deepEqual(await rebuildCandidateChanges(vault,stored),changeSet);
  const partialVault=new MemoryEvidenceStore();
  const selected=await holdCandidateFacts(partialVault,input,fingerprint,{retainReadModel:false,previousReadModel:{records:previous.records.slice(0,1)}});
  assert.equal(await civicVersionRef(partialVault,fingerprint),null,"selected fields cannot stand in for a complete predecessor");
  await assert.rejects(()=>rebuildCandidateChanges(partialVault,selected),/CHANGE_BASE_NOT_IN_VAULT/);
});
