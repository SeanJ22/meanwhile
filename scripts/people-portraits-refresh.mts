/** Standing own-page portrait work, scheduled separately from roster readers. */
import { pathToFileURL } from "node:url";
import { STATE_PEOPLE_JURISDICTIONS } from "../lib/officials/people-identity.ts";
import { statePeoplePortraits } from "../lib/civic-data/state-people-publication.ts";
import { readPeopleSourceProjection, publishPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { congressPortraits } from "../lib/officials/congress-portraits.ts";
import type { DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import type { PortraitAttempt, StandingPortraitOptions } from "../lib/photos/portrait-work.ts";
import { portraitHash, type PortraitCapture } from "../lib/photos/evidence.ts";
import { pacedPortraitAcquire, storeStandingPortrait } from "../lib/photos/portrait-work.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { capturedText, type StatePeopleCapture } from "../lib/civic-data/state-people-publication.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { peopleJurisdiction } from "../lib/civic-data/people-source-read.ts";
import { mergePeopleSets } from "../lib/officials/merge-people.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { isOfficialSource } from "../lib/civic-data/source-authority.ts";

export function parsePeoplePortraitArguments(args:readonly string[]):string {
  const state=args.find(arg=>arg.startsWith("--state="))?.slice(8).toLowerCase();
  if (args.filter(arg=>arg === "--promote").length !== 1 || args.length !== 2 ||
    !state || state !== "us" && !STATE_PEOPLE_JURISDICTIONS.includes(`US-${state.toUpperCase()}`)) throw Error("PEOPLE_PORTRAITS_EXACT_SCOPE_REQUIRED");
  return state;
}

function portraitPerson(person:Officeholder):Officeholder {
  return {id:person.id,personId:person.personId ?? person.id,nativeIds:person.nativeIds,
    name:person.name,officeTitle:person.officeTitle,level:person.level,state:person.state,chamber:person.chamber,
    profileUrls:[...new Set([person.websiteUrl,...(person.profileUrls ?? [])].filter((url):url is string=>Boolean(url)))],
    termStart:"",termEnd:"",birthDate:null,partyLabel:null,websiteUrl:null,contactFormUrl:null,phone:null,email:null,campaignUrl:null,
    photo:person.photo,portraitCandidate:person.portraitCandidate,social:{},provenance:person.provenance,
    fieldSources:{name:person.fieldSources?.name ?? person.provenance,officeTitle:person.fieldSources?.officeTitle ?? person.provenance,
      ...(person.fieldSources?.photo ? {photo:person.fieldSources.photo} : {})}};
}

async function sourceInputs(store:RoutineDataStore,jurisdiction:string,linking:{vault:EvidenceStore;captures:PortraitCapture[];people:readonly Officeholder[]}):Promise<readonly DerivedInputRef[]> {
  if(!store.readPortraitSources)throw Error("PEOPLE_PORTRAIT_SCOPED_SOURCES_REQUIRED");
  const inputs=await store.readPortraitSources(jurisdiction);
  if(!store.readPortraitCaptures)throw Error("PEOPLE_PORTRAIT_SCOPED_CAPTURES_REQUIRED");
  const urls=[...new Set(linking.people.flatMap(person=>person.portraitCandidate ? [person.portraitCandidate.sourceUrl] : []))];
  const includeOfficial=linking.people.some(person=>[person.websiteUrl,...person.profileUrls ?? []]
    .some(url=>url && !isOfficialSource(url)));
  const captures=urls.length||includeOfficial ? await store.readPortraitCaptures(inputs.map(ref=>ref.versionId),urls,includeOfficial) : [];
  for(const row of captures){
        if(!row.capture)continue;
        const text=await capturedText(linking.vault,row);
        linking.captures.push({transport:"REACHABLE",partial:false,httpStatus:row.httpStatus,
          observedAt:row.sourceCheck?.checkedAt ?? row.retrievedAt,evidence:{canonicalUrl:row.finalUrl,sourceId:new URL(row.finalUrl).hostname,
            contentHash:portraitHash(new TextEncoder().encode(text)),text,retrievedAt:row.retrievedAt,vaultKey:row.capture.vaultKey}});
  }
  return inputs;
}

export async function readPortraitRunPeople(store:RoutineDataStore,state:string,at:string):Promise<OfficeholderSet|null> {
  if(!store.readPortraitPeople)throw Error("PEOPLE_PORTRAIT_SCOPED_READ_REQUIRED");
  const rows=await store.readPortraitPeople(peopleJurisdiction(state),at);
  if(!rows.length)return null;
  if(rows.some(row=>typeof row.person.name!=="string"||typeof row.person.officeTitle!=="string"))throw Error("PEOPLE_PORTRAIT_PERSON_INVALID");
  const ordered=[...rows].sort((a,b)=>Number(!a.scope.endsWith(":openstates-people:v1"))-Number(!b.scope.endsWith(":openstates-people:v1")));
  return mergePeopleSets(ordered.map(row=>({scope:state,generatedAt:at,officeholders:[row.person],divisions:[],unmatched:[]})));
}

function portraitInputs(person:Officeholder,facts:readonly PortraitAttempt[]):DerivedInputRef[] {
  const saved=(person.photo?.verification?.sources ?? []).flatMap(row=>row.artifactId || row.vaultKey ? [{
    kind:"VAULTED_EVIDENCE" as const,artifactId:row.artifactId ?? row.vaultKey!,contentHash:row.contentHash,tier:"RAW" as const,retrievedAt:row.retrievedAt,
  }] : []);
  for (const fact of facts) {
    const record=fact.record as {vaultKey?:string;rawHash?:string;sourceRetrievedAt?:string}|undefined;
    if (record?.vaultKey && record.rawHash && record.sourceRetrievedAt) saved.push({kind:"VAULTED_EVIDENCE",artifactId:record.vaultKey,
      contentHash:`sha256-${record.rawHash}`,tier:"RAW",retrievedAt:record.sourceRetrievedAt});
  }
  return saved;
}

export async function refreshPeoplePortraits(input:{store:RoutineDataStore;vault:EvidenceStore;state:string;options?:StandingPortraitOptions}) {
  const {store,vault,state}=input,options=input.options ?? {},clock=options.now ?? (()=>new Date().toISOString());
  const pacing={sizeFor:websiteSizeFromHoldings([state])};
  const acquire=options.acquire ?? ((request:Parameters<typeof pacedPortraitAcquire>[0])=>pacedPortraitAcquire(request,pacing));
  const portraitOptions={...options,acquire,storePortrait:options.storePortrait ?? ((...args:Parameters<typeof storeStandingPortrait>)=>storeStandingPortrait(args[0],args[1],args[2],args[3],pacing))};
  const jurisdiction=peopleJurisdiction(state);
  const contractId=`people-portraits-${state.toLowerCase()}`;
  const selected=await readPortraitRunPeople(store,state,clock());
  if(!selected)return null;
  const refreshPersonIds=new Set(selected.officeholders.map(person=>person.personId ?? person.id));
  if(!store.readPortraitVersion)throw Error("PEOPLE_PORTRAIT_VERSION_READ_REQUIRED");
  const priorVersion=await store.readPortraitVersion(jurisdiction);
  const priorFacts=priorVersion ? await store.readCandidatePath<RoutineCandidate["excludedFacts"]>(priorVersion,["excludedFacts"]) ?? [] : [];
  const linkingCaptures:PortraitCapture[]=[...(options.linkingCaptures ?? [])];
  const sources=await sourceInputs(store,jurisdiction,{vault,captures:linkingCaptures,people:selected.officeholders});
  let baseRoster:OfficeholderSet|null=null,last=null as Awaited<ReturnType<typeof publishPeopleSource>>|null;
  let publicationBase:null|{versionId:string|null;roster:OfficeholderSet|null;captures:readonly StatePeopleCapture[];facts:NonNullable<RoutineCandidate["excludedFacts"]>}=null;
  const loadPublicationBase=async()=>{
    const held=await readPeopleSourceProjection(jurisdiction,"people-portraits",{store,now:clock(),bypassCache:true});
    if(held.kind==="STORE_UNREACHABLE")throw Error("PEOPLE_PORTRAIT_MARKER_UNAVAILABLE");
    const versionId=held.kind==="PROMOTED" ? held.metadata.versionId : null;
    return {versionId,roster:held.kind==="PROMOTED"||held.kind==="BOOTSTRAP" ? held.value.roster : null,
      captures:versionId ? await store.readCandidatePath<readonly StatePeopleCapture[]>(versionId,["normalizedPayload","captures"]) ?? [] : [],
      facts:versionId===priorVersion ? priorFacts : versionId ? await store.readCandidatePath<NonNullable<RoutineCandidate["excludedFacts"]>>(versionId,["excludedFacts"]) ?? [] : []};
  };
  let finished=new Map<string,{person:Officeholder;facts:readonly PortraitAttempt[]}>(),queue=Promise.resolve();
  const publish=async(continuation:readonly PortraitAttempt[]|null)=>{
    const batch=[...finished.values()];
    finished=new Map();
    const people=new Set(batch.map(row=>row.person.personId ?? row.person.id));
    const officeholders=batch.length ? batch.map(row=>portraitPerson(row.person)) : baseRoster!.officeholders.map(portraitPerson);
    for(;;){
      publicationBase ??= await loadPublicationBase();
      const kept=publicationBase.facts.filter(fact=>!people.has((fact.record as {personId?:string}|undefined)?.personId ?? "") &&
        !(continuation && fact.code.endsWith("_WORK_REMAINS")));
      const publication=await publishPeopleSource({store,vault,state,contractId,sourceId:"people-portraits",
        roster:{scope:state,generatedAt:clock(),officeholders,divisions:[],unmatched:[]},acquisitions:[],releaseId:clock(),now:clock(),
        derivedInputs:[...sources,...batch.flatMap(row=>portraitInputs(row.person,row.facts))],
        excludedFacts:[...kept,...batch.flatMap(row=>row.facts),...continuation ?? []],confirmUnchanged:true,portraitBase:publicationBase});
      if(publication.outcome.candidate.failureCode === "PROMOTION_BASE_CHANGED"){publicationBase=null;continue;}
      if(!publication.outcome.promoted && !publication.outcome.confirmed)throw Error(`PEOPLE_PORTRAIT_PUBLICATION_REFUSED:${publication.outcome.candidate.failureDetail}`);
      if(publication.outcome.promoted)publicationBase={versionId:publication.outcome.promoted.versionId,
        roster:(publication.candidate.readModel as {roster:OfficeholderSet}).roster,
        captures:(publication.candidate.normalizedPayload as {captures:readonly StatePeopleCapture[]}).captures,
        facts:publication.candidate.excludedFacts ?? []};
      last=publication;return;
    }
  };
  const marker=async(person:Officeholder,facts:readonly PortraitAttempt[])=>{
    finished.set(person.personId ?? person.id,{person,facts});
    const operation=queue.then(async()=>{if(finished.size)await publish(null);});
    queue=operation.catch(()=>{});await operation;
    await options.onPerson?.(person,facts);
  };
  const combined={...selected,officeholders:selected.officeholders.filter(person=>!person.id.startsWith("congress:"))};
  const members=selected.officeholders.filter(person=>person.id.startsWith("congress:"));
  const place=members.length ? {roster:{...selected,officeholders:members}} : null;
  baseRoster=selected;
  const stateResult=combined.officeholders.length ? await statePeoplePortraits({roster:combined,state,now:clock(),signal:options.signal},{...portraitOptions,refreshPersonIds,linkingCaptures,previousExcludedFacts:priorFacts,onPerson:marker}) : null;
  // This holding previously sent its retained members of Congress through the seven-day state pass too.
  const congressResult=place ? await congressPortraits(place,clock(),options.signal,{...portraitOptions,refreshPersonIds,recheckEveryMs:7*86400000,previousExcludedFacts:priorFacts,onPerson:marker}) : null;
  const continuationFacts=[...stateResult?.excludedFacts.filter(fact=>fact.code === "STATE_PORTRAIT_WORK_REMAINS") ?? [],
    ...congressResult?.excludedFacts.filter(fact=>fact.code === "CONGRESS_PORTRAIT_WORK_REMAINS") ?? []];
  await queue;
  // The last batch carries the remaining work; a run that finished nothing still advances its own clock.
  if(finished.size || !last || continuationFacts.length)await publish(continuationFacts);
  if(!last)throw Error("PEOPLE_PORTRAIT_NO_HELD_PEOPLE");
  printSourceRunnerReceipt(contractId,last.candidate,last.outcome);
  return last;
}


async function main(){
  const state=parsePeoplePortraitArguments(process.argv.slice(2));
  installNeonRequestDeadline();prepareProductionCivicDataWrite();
  await refreshPeoplePortraits({store:new PostgresRoutineDataStore(),vault:rawCaptureVault(),state});
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)await main();
