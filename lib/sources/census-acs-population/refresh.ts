import { createHash,randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { acquireNationalAcsSources,joinNationalAcsSources,type AcsNationalSources } from "./national.ts";
import { heldAcsJoinTargets } from "./held-joins.ts";
import { acsSourceProbe,acsSourceContentHash,acsSourceContext } from "./source-hash.ts";
import { censusAcsCandidate } from "../../civic-data/candidate-builders.ts";
import { confirmSourceHashUnchanged } from "../../civic-data/source-hash.ts";
import { readSourceProbeDependencies,type SourceProbeDependencies } from "../../civic-data/source-probe.ts";
import { processRegisteredRoutineCandidate } from "../../civic-data/promotion.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { registrationTarget } from "../../registration/publication.ts";
import { stateRegistryRuntimeScope } from "../../civic-data/state-scopes.ts";
import { CENSUS_GEO_RECORD_CLASS,CENSUS_GEO_SCOPE } from "../../census-geography/publication.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { runtimeCivicReadCache,type CivicReadCache } from "../../db/civic-read-cache.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { rawCaptureVault } from "../../civic-data/raw-capture-remote.ts";
import { continueOfficialVoteDocument } from "../../state-rollcalls/source-continuation.ts";
import { acsTableTooShort } from "../bulk-completeness.ts";
import { sourceAcquisitionFailure } from "../../civic-data/source-acquisition-error.ts";

const progressNamespace="source-probe-progress:v1",progressKey="census-acs-population";
/** Source metadata and identity inputs are scalar; no held table or inventory is read here. */
async function sourceInputs(store:RoutineDataStore,sources:AcsNationalSources,root:string) {
  const states=sources.states.map(row=>FIPS_TO_STATE[row.state.code]?.postal).filter((state):state is string=>!!state);
  const referenceHashes:Record<string,string>={};
  for(const state of states)referenceHashes[state]=createHash("sha256").update(await readFile(join(root,"data/derived/registration",`${state.toLowerCase()}.json`))).digest("hex");
  const dependencies=await readSourceProbeDependencies(store,[{recordClass:CENSUS_GEO_RECORD_CLASS,scope:CENSUS_GEO_SCOPE},
    ...states.flatMap(state=>[{recordClass:"REGISTRATION" as const,scope:registrationTarget(state).scope},
      {recordClass:"REGISTRY_RUNTIME_BINDING" as const,scope:stateRegistryRuntimeScope(state)}])]);
  return {dependencies,referenceHashes};
}

/** All provider bodies precede held joins; interrupted passes retain only completed source documents. */
export async function refreshNationalAcs(input:Parameters<typeof acquireNationalAcsSources>[0]&{
  readonly store:RoutineDataStore;readonly root?:string;readonly cache?:CivicReadCache;readonly vault?:EvidenceStore;
  readonly targets?:Parameters<typeof joinNationalAcsSources>[1];
  readonly readSources?:typeof acquireNationalAcsSources;
  readonly inputs?:(store:RoutineDataStore,sources:AcsNationalSources,root:string)=>Promise<{dependencies:SourceProbeDependencies;referenceHashes:Readonly<Record<string,string>>}>;
}) {
  const copies=(input.cache??runtimeCivicReadCache()).jobState();
  const saved=await copies.readCheckpoint<{passId:string;startedAt:string}>(progressNamespace,progressKey);
  const progress=saved?.passId&&Number.isFinite(Date.parse(saved.startedAt))?saved:{passId:randomUUID(),startedAt:new Date().toISOString()};
  await copies.checkpoint(progressNamespace,progressKey,progress);
  const signal=input.signal??new AbortController().signal;
  let vault=input.vault;
  const sources=await(input.readSources??acquireNationalAcsSources)({...input,sourceDocument:input.sourceDocument??(async({url,read})=>{
    vault??=rawCaptureVault();
    return continueOfficialVoteDocument({sourceId:"census-data-api",parserVersion:"census-data-api/3",context:acsSourceContext(progress),url,
      vault,signal,cache:input.cache,acceptedStatuses:[200,204],read});
  })});
  const zcta=sources.captures.find(table=>table.scope==="zcta")!,state=sources.captures.find(table=>table.scope==="state")!;
  for(const fetched of [zcta,state]){
    const short=acsTableTooShort(fetched.scope as "zcta"|"state",fetched.rows.length-1);
    if(short!==null)throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID",short);
  }
  const {dependencies,referenceHashes}=await(input.inputs??sourceInputs)(input.store,sources,input.root??process.cwd());
  const probe=acsSourceProbe(sources,dependencies,referenceHashes),rawHash=acsSourceContentHash(probe);
  const retrievedAt=sources.captures.map(capture=>capture.fetchedAt).sort()[0];
  if(!retrievedAt)throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID","The ACS source set has no actual source observations.");
  const head=await input.store.readSourceHead("CENSUS_REFERENCE","acs-population");
  const confirmation=head?.rawHashBasis==="SOURCE_CONTENT_V1"?await confirmSourceHashUnchanged({store:input.store,sourceId:"census-data-api",
    recordClass:"CENSUS_REFERENCE",scope:"acs-population",parserVersion:"census-data-api/3",rawHash,complete:true,now:new Date().toISOString(),
    retrieval:{requestedUrl:zcta.url,finalUrl:zcta.finalUrl??zcta.url,httpStatus:200,rawHash,retrievedAt}}):null;
  if(confirmation){await copies.checkpoint(progressNamespace,progressKey,null);return {confirmation,publication:null};}
  const national={...await joinNationalAcsSources(sources,input.targets??heldAcsJoinTargets),sourceProbe:probe};
  const candidate=censusAcsCandidate(zcta,state,national);
  const outcome=await processRegisteredRoutineCandidate(input.store,"census-acs-population",candidate,new Date().toISOString());
  if(outcome.promoted||outcome.confirmed)await copies.checkpoint(progressNamespace,progressKey,null);
  return {confirmation:null,publication:{national,candidate,outcome}};
}
