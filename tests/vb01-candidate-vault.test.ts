import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import { holdCandidateFacts, hydrateCandidateFacts, readCivicCandidatePath, rebuildCandidateChanges } from "../lib/civic-data/candidate-vault.ts";
import { holdCivicVersion } from "../lib/civic-data/version-vault.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { CivicPayloadParts } from "../lib/civic-data/payload-parts.ts";
import { sourceWorkClock } from "../lib/civic-data/source-work-clock.ts";
import { holdRawCapture } from "../lib/civic-data/raw-capture-vault.ts";

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
  assert.deepEqual(stored.normalizedPayload,{sourceProbe:(input.normalizedPayload as Record<string,unknown>).sourceProbe});
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

test("repeated source captures add no database parts while exact fetched bytes remain readable",async()=>{
  const vault=new MemoryEvidenceStore(),input=candidate(),saved=new Map<string,unknown>();
  const put=vault.put.bind(vault),rawWrites:string[]=[];
  vault.put=async(key,bytes,meta)=>{if(key.startsWith("project/freshness/raw/sha256/"))rawWrites.push(key);await put(key,bytes,meta);};
  const parts=new CivicPayloadParts({existing:async hashes=>hashes.filter(hash=>saved.has(hash)),
    write:async rows=>{for(const row of rows)saved.set(row.hash,row.payload);},
    read:async hashes=>hashes.map(hash=>({hash,payload:saved.get(hash)}))});
  let count=0;
  for(let pass=0;pass<3;pass++){
    // A publisher's changing session state is evidence, not a changed resident fact.
    const body=`<input name="session" value="${pass}">${"Same meeting listing. ".repeat(8000)}`;
    const fetched=[{requestedUrl:"https://example.gov/calendar",finalUrl:"https://example.gov/calendar",
      retrievedAt:`2026-11-08T06:0${pass}:00Z`,base64:Buffer.from(body).toString("base64")}];
    const capture=await holdRawCapture(vault,"calendar",body,"text/html"),{base64:_bytes,...metadata}=fetched[0];
    const next={...input,id:`version/${pass}`,retainedSourceResponses:fetched,
      normalizedPayload:{...input.normalizedPayload as object,captures:[{...metadata,capture}]}};
    const held=await holdCandidateFacts(vault,next,null,{retainReadModel:true});
    assert.equal(rawWrites.length,pass+1,"the existing captured bytes are reused, rather than stored again as base64 parts");
    assert.equal(Object.hasOwn(held,"retainedSourceResponses"),false);
    const stored=await parts.store(held,["id","retrieval","normalization"],["readModel","normalizedPayload"]);
    if(pass)assert.equal(saved.size,count,"a recheck must not add source bodies or duplicate unchanged reader facts to Postgres");
    count=saved.size;
    const loaded=await hydrateCandidateFacts(vault,await parts.load(stored)) as typeof next;
    assert.deepEqual(loaded.retainedSourceResponses,fetched);
    assert.deepEqual(loaded.normalizedPayload,next.normalizedPayload);
    assert.deepEqual(loaded.readModel,input.readModel);
    const query=async()=>[{vault:held.vault}];
    assert.equal(await readCivicCandidatePath(query,vault,next.id,["retainedSourceResponses","0","base64"]),fetched[0].base64);
  }
  assert.ok(count>0,"the test exercises real database part encoding");
  assert.ok([...saved.values()].every(value=>!JSON.stringify(value).includes("base64")),"no fetched source body is retained in database parts");
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

test("moving evidence keeps portrait work and its exact due clock available without reading the vault",async()=>{
  const vault=new MemoryEvidenceStore(),input=candidate();
  const schedule={key:"portraits",code:"PEOPLE_PORTRAIT_SCHEDULE",detail:"Scheduled portraits",
    record:{nextDueAt:"2026-11-09T06:00:00Z",seen:{stamp:"same roster"}}};
  const pending={key:"remaining",code:"STATE_PORTRAIT_WORK_REMAINS",detail:"Portraits still owed"};
  const next={...input,excludedFacts:[...input.excludedFacts!,schedule,pending]};
  const held=await holdCandidateFacts(vault,next,null,{retainReadModel:true});
  const metadata=held as unknown as RoutineCandidate;
  assert.deepEqual(metadata.excludedFacts,[schedule,pending]);
  assert.deepEqual(sourceWorkClock(metadata),sourceWorkClock(next));
  assert.deepEqual((await hydrateCandidateFacts(vault,held) as RoutineCandidate).excludedFacts,next.excludedFacts);
});
