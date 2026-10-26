import { PostgresRoutineDataStore,type RoutineDataStore } from "../../civic-data/store.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { processRegisteredFanOutCandidate, processRegisteredRoutineCandidate } from "../../civic-data/promotion.ts";
import { civicCandidate } from "./publication.ts";
import { readCivicApi, parseCivicResponse, recordCivicCatalogFailure, CivicSourceError, type CivicReadOptions } from "./acquisition.ts";
import { civicElectionRows } from "./model.ts";
import { GOOGLE_CIVIC_SOURCE_ID, GOOGLE_CIVIC_ELECTION_DAY, GOOGLE_CIVIC_SCOPE, GOOGLE_CIVIC_STATES, GOOGLE_CIVIC_API,GOOGLE_CIVIC_RECORD_CLASS,GOOGLE_CIVIC_PARSER_VERSION,civicStateScope } from "./targets.ts";
import { readRegistrationProjection } from "../../registration/reader.ts";
import { requiredRoutineContract } from "../../civic-data/contracts.ts";
import { routineTaskFromContract } from "../../civic-data/runner.ts";
import { readPromotedCivicData } from "../../civic-data/read-model.ts";
import { stateBallotScope,stateRegistryRuntimeScope } from "../../civic-data/state-scopes.ts";
import { readRegistryRuntimePrior } from "../../registry/runtime-data-plane.ts";
import type { VotingSitesFile } from "../../ballot/voting-sites.ts";
import type { CountyCivicCoverage, CountyCivicStateCoverage } from "./coverage.ts";
import { readCountyCivicContactInputs,type CountyCivicContactInputs } from "./county-inputs.ts";
import { readerQuery } from "../../civic-data/promoted-reader-query.ts";
import { registrationTarget } from "../../registration/publication.ts";
import { readSourceProbeDependencies } from "../../civic-data/source-probe.ts";
import { civicBytesHash,civicInputHash,civicSourceContentHash,type CivicSourceProbe } from "./source-hash.ts";
import { countyCivicProgress,nationalCivicProgress,type CountyCivicSample } from "./county-progress.ts";
import { runBoundedWorkPool } from "../../ops/bounded-work-pool.ts";
import { confirmSourceHashUnchanged,type SourceHashConfirmation } from "../../civic-data/source-hash.ts";
import type { RoutineCandidate,SourceCheckEvidence } from "../../civic-data/types.ts";
import type { PromotionOutcome } from "../../civic-data/promotion.ts";
import { factClocks } from "../../facts/clocks.ts";
import type { CivicReadCache } from "../../db/civic-read-cache.ts";

const electionOffice = /\b(?:elections?|voter registration|registrar of voters|supervisor of elections)\b/i;
export interface CountyCivicProbeTarget { countyFips: string; address: string }

/** A county hall or a school's contact is not evidence of an election-office address. */
export function countyCivicProbeTargets(registration: NonNullable<CountyCivicContactInputs["registration"]>,
  votingSites: CountyCivicContactInputs["votingSites"],reviewedBodies:CountyCivicContactInputs["reviewedBodies"] = []): { counties: number; targets: CountyCivicProbeTarget[] } {
  const counties = registration.divisions.filter(division => division.divisionType === "county" && /^\d{5}$/.test(division.geoid ?? ""));
  const byDivision = new Map<string, string>(counties.map(division => [division.ocdId, division.geoid]));
  const targets = new Map<string, CountyCivicProbeTarget>();
  const add = (countyFips: string | undefined, address: string | null | undefined) => {
    if (countyFips && address?.trim() && !targets.has(countyFips)) targets.set(countyFips, { countyFips, address: address.trim() });
  };
  // A parsed election-office contact is already scoped by the official directory's county mapping.
  for (const jurisdiction of votingSites?.jurisdictions ?? []) if (jurisdiction.office?.address) {
    add(byDivision.get(jurisdiction.ocdId), jurisdiction.office.address);
  }
  for (const body of [...reviewedBodies, ...(registration.bodies ?? [])]) {
    if (body.ocdId && body.name && electionOffice.test(body.name)) add(byDivision.get(body.ocdId), body.officeAddress);
  }
  for (const government of registration.governments ?? []) if (electionOffice.test(`${government.name} ${government.contactTitle ?? ""}`)) {
    const counties = new Set(government.associations.flatMap(association => byDivision.get(association.divisionId) ?? []));
    if (counties.size === 1) add([...counties][0], government.officeAddress);
  }
  return { counties: counties.length, targets: [...targets.values()].sort((a, b) => a.countyFips.localeCompare(b.countyFips)) };
}

/** The raw voterinfo response dies in this call; its only output is yes/no and three counts. */
async function readCountyCivicSample(target: CountyCivicProbeTarget, electionId: string, options: CivicReadOptions): Promise<CountyCivicSample> {
  try {
    const response = await readCivicApi("voterinfo", { address: target.address, electionId }, options);
    const data = JSON.parse(response.raw) as Record<string, unknown>;
    const election = data?.election as { id?: string; electionDay?: string } | undefined;
    if (election?.id !== electionId || election.electionDay !== GOOGLE_CIVIC_ELECTION_DAY) throw new Error("Google Civic returned a different election.");
    const count = (field: string): number => {
      const value = data[field];
      if (value !== undefined && (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || Array.isArray(row)))) throw new Error("Google Civic returned an invalid site list.");
      return Array.isArray(value) ? value.length : 0;
    };
    const pollingLocations = count("pollingLocations"), earlyVoteSites = count("earlyVoteSites"), dropOffLocations = count("dropOffLocations");
    return {addressHash:civicInputHash(target.address),responseHash:civicBytesHash(response.raw),status:response.status,checkedAt:response.checkedAt,
      coverage:{ countyFips: target.countyFips, available: pollingLocations + earlyVoteSites + dropOffLocations > 0, pollingLocations, earlyVoteSites, dropOffLocations }};
  } catch (error) {
    // A missing address result is a no; transport, quota and parsing failures remain unmeasured.
    if (!(error instanceof CivicSourceError) || error.failureReason !== "NO_DATA") throw error;
    return {addressHash:civicInputHash(target.address),responseHash:null,status:error.status!,checkedAt:(options.now??(()=>new Date().toISOString()))(),
      coverage:{ countyFips: target.countyFips, available: false, pollingLocations: 0, earlyVoteSites: 0, dropOffLocations: 0 }};
  }
}
export async function probeCountyCivicCoverage(target:CountyCivicProbeTarget,electionId:string,options:CivicReadOptions):Promise<CountyCivicCoverage> {
  return (await readCountyCivicSample(target,electionId,options)).coverage;
}

interface GoogleCivicRefreshInput {
  store:RoutineDataStore;vault:EvidenceStore;readOptions?:CivicReadOptions;
  registration?:typeof readRegistrationProjection;votingSites?:(state:string)=>Promise<VotingSitesFile|null>;
  reviewedRegistry?:typeof readRegistryRuntimePrior;maxProgressAgeMs?:number;cache?:CivicReadCache;
}
type GoogleCivicRefreshResult={candidate:RoutineCandidate;outcome:PromotionOutcome;confirmation:null;coverage:CountyCivicStateCoverage[]}|
  {candidate:null;outcome:null;confirmation:SourceHashConfirmation;coverage:null};

async function countyInputs(input:GoogleCivicRefreshInput,state:string,at:string):Promise<{contacts:CountyCivicContactInputs;complete:boolean}> {
  if(input.store instanceof PostgresRoutineDataStore) {
    const query=readerQuery();if(!query)throw Error("Google Civic office inputs have no reader connection.");
    return {contacts:await readCountyCivicContactInputs(query,state),complete:true};
  }
  const dependencies=await readSourceProbeDependencies(input.store,[{recordClass:"REGISTRATION",scope:registrationTarget(state).scope},
    {recordClass:"VOTING_SITE",scope:stateBallotScope("voting-sites",state)},
    {recordClass:"REGISTRY_RUNTIME_BINDING",scope:stateRegistryRuntimeScope(state)}]);
  const registration=await (input.registration??readRegistrationProjection)(state,{store:input.store});
  if(registration.kind!=="PROMOTED")return {contacts:{registration:null,votingSites:null,reviewedBodies:[],dependencies},complete:false};
  const [sites,registry]=await Promise.allSettled([input.votingSites?input.votingSites(state):
    readPromotedCivicData<VotingSitesFile>("VOTING_SITE",stateBallotScope("voting-sites",state),{store:input.store}).then(read=>read.kind==="PROMOTED"?read.value:null),
    (input.reviewedRegistry??readRegistryRuntimePrior)(input.store,at,state)]);
  return {contacts:{registration:registration.value,votingSites:sites.status==="fulfilled"?sites.value:null,
    reviewedBodies:registry.status==="fulfilled"?registry.value?.payload.registry.bodies??[]:[],dependencies},
    complete:sites.status==="fulfilled"&&registry.status==="fulfilled"};
}

const validCounty=(row:CountyCivicCoverage)=>/^\d{5}$/.test(row.countyFips)&&typeof row.available==="boolean"&&
  [row.pollingLocations,row.earlyVoteSites,row.dropOffLocations].every(value=>Number.isSafeInteger(value)&&value>=0);

export async function refreshGoogleCivic(input:GoogleCivicRefreshInput):Promise<GoogleCivicRefreshResult> {

  const options = input.readOptions ?? {};
  const now=options.now??(()=>new Date().toISOString());
  const clocks=factClocks(null),maxProgressAgeMs=input.maxProgressAgeMs??Math.min(clocks.windowHours("ballot")*3_600_000,clocks.retryMinutes("ballot")*60_000);
  let catalog: Awaited<ReturnType<typeof readCivicApi>>;
  try { catalog = await readCivicApi("elections", {}, options); }
  catch (error) {
    const failed = await recordCivicCatalogFailure(input.store, error instanceof CivicSourceError ? error.reason : "Google Civic elections could not be read.", new Date().toISOString());
    return { candidate: failed.outcome.candidate.candidate, outcome: failed.outcome, coverage: [],confirmation:null };
  }
  const elections = parseCivicResponse("elections", catalog, raw => civicElectionRows(raw, catalog.checkedAt, new Set(["ocd-division/country:us"])), {}, options);
  const electionId = elections.find(row => row.ocdId === "ocd-division/country:us")?.electionId;
  const catalogHash=civicBytesHash(catalog.raw);
  const nationalWork=await nationalCivicProgress({context:civicInputHash([GOOGLE_CIVIC_PARSER_VERSION,catalogHash,GOOGLE_CIVIC_STATES]),
    checkedAt:catalog.checkedAt,maxAgeMs:maxProgressAgeMs,progress:input.cache});
  const states=new Map<string,{hash:string;versionId:string;complete:boolean;basis:SourceCheckEvidence;report:CountyCivicStateCoverage|null}>();
  const task = routineTaskFromContract(requiredRoutineContract(GOOGLE_CIVIC_SOURCE_ID));
  const stateClocks = await Promise.all(GOOGLE_CIVIC_STATES.map(async (state, index) => {
    const [clock,head]=await Promise.all([input.store.clock(GOOGLE_CIVIC_SOURCE_ID,task.recordClass,civicStateScope(state),task.parserVersion),
      input.store.readSourceHead(GOOGLE_CIVIC_RECORD_CLASS,civicStateScope(state))]);
    const checked = Date.parse(clock.lastSucceededObservedAt ?? "");
    return { state, index,head,checked: Number.isFinite(checked) ? checked : -Infinity };
  }));
  // Finish states with no completed pass first after a bounded child's restart.
  stateClocks.sort((a, b) => a.checked - b.checked || a.index - b.index);
  for (const { state,head } of stateClocks) {
    options.signal?.throwIfAborted();
    const report: CountyCivicStateCoverage = { state, electionDate: GOOGLE_CIVIC_ELECTION_DAY, counties: [], governments: 0, addresses: 0, checked: 0, unavailable: 0, withoutAddress: 0, loaded: 0, joined: 0, unjoined: 0, reason: null };
    const scope=civicStateScope(state),prior=head?.rawHashBasis==="SOURCE_CONTENT_V1"&&head.parserVersion===GOOGLE_CIVIC_PARSER_VERSION?
      await input.store.readCandidatePath<CivicSourceProbe>(head.versionId,["normalizedPayload","sourceProbe"]):null;
    let contacts:CountyCivicContactInputs={registration:null,votingSites:null,reviewedBodies:[],dependencies:{}},inputsComplete=false;
    try {const selected=await countyInputs(input,state,catalog.checkedAt);contacts=selected.contacts;inputsComplete=selected.complete&&!!contacts.registration;}
    catch {options.signal?.throwIfAborted();}
    let targets:CountyCivicProbeTarget[]=[];
    if(!contacts.registration)report.reason="The held government inventory could not be read for this state.";
    else {
      const inventory=countyCivicProbeTargets(contacts.registration,contacts.votingSites,contacts.reviewedBodies);targets=inventory.targets;
      report.governments = inventory.counties;
      report.addresses = inventory.targets.length;
      report.withoutAddress = inventory.counties - inventory.targets.length;
      report.reason = electionId ? "Each county sample uses one public election-office address. Only availability and site counts are saved."
        : "Google Civic has not published the November 3 national election.";
      if(!inputsComplete)report.reason="Some held election-office contacts could not be read; counties without an office address remain unmeasured.";
    }
    const inputHash=civicInputHash({parser:GOOGLE_CIVIC_PARSER_VERSION,state,catalogHash,electionId:electionId??null,
      dependencies:contacts.dependencies,inputsComplete,targets:targets.map(target=>[target.countyFips,civicInputHash(target.address)])});
    const completed=nationalWork.get(state);
    if(completed?.complete&&prior?.complete&&head?.versionId===completed.versionId&&head.rawHash===completed.hash&&head.versionId===head.lastKnownGoodVersionId&&
      head.sourceId===GOOGLE_CIVIC_SOURCE_ID&&head.candidateState==="PROMOTED"&&head.acquisitionSucceeded&&!head.imported&&completed.inputHash===inputHash){
      states.set(state,{hash:completed.hash,versionId:completed.versionId,complete:true,basis:completed.basis,report:null});continue;
    }
    const progress=await countyCivicProgress({state,context:inputHash,catalogHash,checkedAt:catalog.checkedAt,maxAgeMs:maxProgressAgeMs,progress:input.cache});
    const samples:CountyCivicSample[]=[],remaining:CountyCivicProbeTarget[]=[];
    if(electionId)for(const target of targets){const saved=progress.get(target.countyFips,civicInputHash(target.address));if(saved)samples.push(saved);else remaining.push(target);}
    for(let offset=0;offset<remaining.length;offset+=8){
      options.signal?.throwIfAborted();
      const batch=await runBoundedWorkPool(remaining.slice(offset,offset+8),8,target=>readCountyCivicSample(target,electionId!,options));
      for(const result of batch)if(result.ok){samples.push(result.value);progress.put(result.value);}
      await progress.save();options.signal?.throwIfAborted();
      if(batch.some(result=>!result.ok))report.reason="Some county samples could not be measured. Provider failures are left unmeasured and retried on the next scheduled pass.";
    }
    samples.sort((a,b)=>a.coverage.countyFips.localeCompare(b.coverage.countyFips));
    report.counties=samples.map(sample=>sample.coverage);report.checked=samples.length;
    const measured=new Set(report.counties.map(row=>row.countyFips));
    const complete=inputsComplete&&(!electionId||samples.length===targets.length);
    const responseHash=civicInputHash(samples.map(sample=>[sample.coverage.countyFips,sample.addressHash,sample.responseHash,sample.status]));
    let probe:CivicSourceProbe={formatVersion:1,catalogHash,inputHash,responseHash,complete,representedCounties:[...measured].sort()};
    const rawHash=civicSourceContentHash(probe),coversPrior=Array.isArray(prior?.representedCounties)&&prior.representedCounties.every(county=>measured.has(county));
    const fullConfirmation=complete&&coversPrior&&prior?.complete===true;
    const exactPartial=prior?.complete===false&&!(complete&&coversPrior)&&prior.inputHash===inputHash&&prior.responseHash===responseHash;
    if(head?.rawHash===rawHash&&(fullConfirmation||exactPartial)){
      const retrieval=fullConfirmation?{succeeded:true,requestedUrl:`${GOOGLE_CIVIC_API}elections`,finalUrl:`${GOOGLE_CIVIC_API}elections`,httpStatus:200,
        retrievedAt:progress.basis.checkedAt,rawHash,sourceCheck:progress.basis}:
        await input.store.readCandidatePath<RoutineCandidate["retrieval"]>(head.versionId,["retrieval"]);
      const confirmed=await confirmSourceHashUnchanged({store:input.store,sourceId:GOOGLE_CIVIC_SOURCE_ID,recordClass:GOOGLE_CIVIC_RECORD_CLASS,scope,
        parserVersion:GOOGLE_CIVIC_PARSER_VERSION,rawHash,now:now(),complete:!!retrieval&&retrieval.rawHash===rawHash,retrieval:{...retrieval!,rawHash}});
      if(confirmed){if(fullConfirmation)await progress.clear();
        report.unavailable=report.counties.filter(row=>!row.available).length;report.loaded=report.counties.reduce((n,row)=>n+row.pollingLocations+row.earlyVoteSites+row.dropOffLocations,0);report.unjoined=report.loaded;
        states.set(state,{hash:rawHash,versionId:confirmed.head.versionId,complete:fullConfirmation,basis:progress.basis,report:fullConfirmation?report:null});
        await nationalWork.put({state,inputHash,hash:rawHash,versionId:confirmed.head.versionId,complete:fullConfirmation,basis:progress.basis});continue;}
    }
    let original:RoutineCandidate["retrieval"]|null=null,carried=false;
    if(head&&(!complete||!coversPrior)){
      const held=await input.store.readCandidatePath<CountyCivicStateCoverage[]>(head.versionId,["readModel","coverage"]);
      const previous=held?.find(row=>row.state===state&&row.electionDate===GOOGLE_CIVIC_ELECTION_DAY);
      for(const row of previous?.counties??[])if(validCounty(row)&&!measured.has(row.countyFips)){report.counties.push(row);carried=true;}
      if(!contacts.registration&&previous){report.governments=previous.governments;report.addresses=previous.addresses;report.withoutAddress=previous.withoutAddress;}
    }
    probe={...probe,complete:complete&&!carried,representedCounties:report.counties.map(row=>row.countyFips).sort()};
    if(head&&!probe.complete)original=await input.store.readCandidatePath<RoutineCandidate["retrieval"]>(head.versionId,["retrieval"]);
    report.counties.sort((a,b)=>a.countyFips.localeCompare(b.countyFips));
    report.unavailable=report.counties.filter(row=>!row.available).length;report.loaded=report.counties.reduce((n,row)=>n+row.pollingLocations+row.earlyVoteSites+row.dropOffLocations,0);report.unjoined=report.loaded;
    if(carried)report.reason="Earlier county samples remain held while their source checks are retried.";
    const marker=await civicCandidate(input.vault,scope,{formatVersion:1,kind:"STATE",checkedAt:catalog.checkedAt,rows:elections,coverage:[report]},catalog.raw,"elections",
      {probe,sourceCheck:probe.complete?progress.basis:original?.sourceCheck,retrieval:original??undefined});
    const outcome=await processRegisteredFanOutCandidate(input.store,GOOGLE_CIVIC_SOURCE_ID,marker,now(),head?.versionId??null,
      {confirmUnchanged:prior?.formatVersion===1&&prior.complete===probe.complete});
    if(!outcome.promoted&&!outcome.confirmed)throw Error("Google Civic state source publication was refused.");
    const versionId=outcome.promoted?.versionId??outcome.confirmed!.versionId;
    states.set(state,{hash:rawHash,versionId,complete:probe.complete,basis:progress.basis,report});if(probe.complete)await progress.clear();
    await nationalWork.put({state,inputHash,hash:rawHash,versionId,complete:probe.complete,basis:progress.basis});
  }
  const selected=[...states].sort(([a],[b])=>a.localeCompare(b));
  const basis=[{requestedUrl:`${GOOGLE_CIVIC_API}elections`,finalUrl:`${GOOGLE_CIVIC_API}elections`,httpStatus:200 as const,
    checkedAt:catalog.checkedAt,rawHash:catalogHash},...selected.map(([,row])=>row.basis)].sort((a,b)=>a.checkedAt.localeCompare(b.checkedAt))[0];
  const probe:CivicSourceProbe={formatVersion:1,catalogHash,inputHash:civicInputHash([GOOGLE_CIVIC_ELECTION_DAY,GOOGLE_CIVIC_STATES]),
    responseHash:civicInputHash(selected.map(([state,row])=>[state,row.hash])),complete:selected.every(([,row])=>row.complete),representedStates:selected.map(([state])=>state)};
  const rawHash=civicSourceContentHash(probe),head=await input.store.readSourceHead(GOOGLE_CIVIC_RECORD_CLASS,GOOGLE_CIVIC_SCOPE);
  const prior=head?.rawHashBasis==="SOURCE_CONTENT_V1"&&head.parserVersion===GOOGLE_CIVIC_PARSER_VERSION?
    await input.store.readCandidatePath<CivicSourceProbe>(head.versionId,["normalizedPayload","sourceProbe"]):null;
  let original:RoutineCandidate["retrieval"]|null=null;
  const coversPrior=Array.isArray(prior?.representedStates)&&prior.representedStates.length===states.size&&prior.representedStates.every(state=>states.has(state));
  if(head?.rawHash===rawHash&&coversPrior&&prior?.complete===probe.complete){
    if(!probe.complete)original=await input.store.readCandidatePath<RoutineCandidate["retrieval"]>(head.versionId,["retrieval"]);
    const sourceCheck=probe.complete?basis:original?.sourceCheck;
    const retrieval=probe.complete?{requestedUrl:`${GOOGLE_CIVIC_API}elections`,finalUrl:`${GOOGLE_CIVIC_API}elections`,httpStatus:200,
      retrievedAt:basis.checkedAt,rawHash,sourceCheck}:{...original!,rawHash};
    const confirmed=await confirmSourceHashUnchanged({store:input.store,sourceId:GOOGLE_CIVIC_SOURCE_ID,recordClass:GOOGLE_CIVIC_RECORD_CLASS,scope:GOOGLE_CIVIC_SCOPE,
      parserVersion:GOOGLE_CIVIC_PARSER_VERSION,rawHash,complete:probe.complete||!!original&&original.rawHash===rawHash,now:now(),retrieval});
    if(confirmed){await nationalWork.clear();return {candidate:null,outcome:null,confirmation:confirmed,coverage:null};}
  }
  const coverage:CountyCivicStateCoverage[]=[];
  for(const [state,row]of selected){
    const report=row.report??(await input.store.readCandidatePath<CountyCivicStateCoverage[]>(row.versionId,["readModel","coverage"]))?.find(report=>report.state===state);
    if(!report)throw Error("Google Civic completed state has no retained count summary.");coverage.push(report);
  }
  if(head&&!probe.complete)original??=await input.store.readCandidatePath<RoutineCandidate["retrieval"]>(head.versionId,["retrieval"]);
  const candidate=await civicCandidate(input.vault,GOOGLE_CIVIC_SCOPE,{formatVersion:1,kind:"CATALOG",checkedAt:catalog.checkedAt,rows:elections,coverage},catalog.raw,"elections",
    {probe,sourceCheck:probe.complete?basis:original?.sourceCheck,retrieval:original??undefined});
  const outcome=await processRegisteredRoutineCandidate(input.store,GOOGLE_CIVIC_SOURCE_ID,candidate,now(),head?.versionId??null,
    {confirmUnchanged:prior?.formatVersion===1&&prior.complete===probe.complete});
  if(outcome.promoted||outcome.confirmed)await nationalWork.clear();
  return {candidate,outcome,coverage,confirmation:null};
}
