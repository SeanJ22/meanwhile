/** Standing own-page portrait work, scheduled separately from roster readers. */
import { pathToFileURL } from "node:url";
import { STATE_PEOPLE_JURISDICTIONS } from "../lib/officials/people-identity.ts";
import { readStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { STATE_PORTRAIT_RECHECK_MS, statePeoplePortraits } from "../lib/civic-data/state-people-publication.ts";
import { publishPeopleSource, readHeldPeopleSource, readPeopleSourceProjection, type HeldPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { readStateFederalDirectory, withFederalPortraits } from "../lib/officials/federal-directory-read-model.ts";
import { CONGRESS_PORTRAIT_RECHECK_MS, congressPortraits } from "../lib/officials/congress-portraits.ts";
import { portraitInputScopes } from "../lib/photos/portrait-run.ts";
import { promotedInputRef, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PORTRAIT_SCHEDULE_CODE, PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import type { PortraitAttempt, StandingPortraitOptions } from "../lib/photos/portrait-work.ts";
import { portraitHash, type PortraitCapture } from "../lib/photos/evidence.ts";
import { latestPortraitAttempts, pacedPortraitAcquire, portraitDueAt, PORTRAIT_RETRY_MS, storeStandingPortrait } from "../lib/photos/portrait-work.ts";
import { portraitBindingMatches } from "../lib/photos/binding.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { capturedText, type StatePeopleCapture } from "../lib/civic-data/state-people-publication.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { peopleJurisdiction } from "../lib/civic-data/people-source-read.ts";
import { readStateRegistryRuntimeProjection } from "../lib/civic-data/read-model.ts";
import { factReader } from "../lib/facts/db.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { mergePeopleSets } from "../lib/officials/merge-people.ts";

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
    photo:person.photo,social:{},provenance:person.provenance,
    fieldSources:{name:person.fieldSources?.name ?? person.provenance,officeTitle:person.fieldSources?.officeTitle ?? person.provenance,
      ...(person.fieldSources?.photo ? {photo:person.fieldSources.photo} : {})}};
}

async function sourceInputs(store:RoutineDataStore,state:string,linking?:{vault:EvidenceStore;captures:PortraitCapture[]}):Promise<DerivedInputRef[]> {
  const contracts=portraitInputScopes(state).filter(row=>row.recordClass !== "REGISTRY_RUNTIME_BINDING");
  const found=await Promise.all(contracts.map(async contract=>{
    const promotion=await store.readPromotion(contract.recordClass,contract.scope);
    if (!promotion) return null;
    if(linking){
      const saved=await store.readCandidate(promotion.versionId);
      const captures=(saved?.candidate.normalizedPayload as {captures?:StatePeopleCapture[]}|undefined)?.captures ?? [];
      for(const row of captures){
        const text=await capturedText(linking.vault,row);
        linking.captures.push({transport:"REACHABLE",partial:false,httpStatus:row.httpStatus,
          observedAt:row.sourceCheck?.checkedAt ?? row.retrievedAt,evidence:{canonicalUrl:row.finalUrl,sourceId:contract.sourceId,
            contentHash:portraitHash(new TextEncoder().encode(text)),text,retrievedAt:row.retrievedAt,vaultKey:row.capture.vaultKey}});
      }
    }
    return promotedInputRef(contract.recordClass,contract.scope,promotion.versionId,promotion.payload,promotion.promotedAt);
  }));
  return found.filter((ref):ref is DerivedInputRef=>ref !== null);
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

/** A run saves its finished people this many at a time, and once more at its end. */
export const PORTRAIT_BATCH_SIZE = 50;
/** Time a run cut off by its pass deadline keeps for its last save. */
const PORTRAIT_SAVE_MARGIN_MS = 45_000;

/** When the state's next portrait falls due; while it is in the future and no input moves, the runner skips the state. */
export function portraitNextDueAt(people:readonly Officeholder[],members:readonly Officeholder[],facts:readonly PortraitAttempt[],now:string,workRemains:boolean):string {
  if(workRemains)return now;
  const verified=(person:Officeholder)=>portraitBindingMatches(person.personId ?? person.id,person.photo ?? {url:""});
  const state=latestPortraitAttempts(facts,"STATE_PORTRAIT_"),congress=latestPortraitAttempts(facts,"CONGRESS_PORTRAIT_");
  const due=[...people.map(person=>portraitDueAt(person,state.get(person.personId ?? person.id),STATE_PORTRAIT_RECHECK_MS,verified)),
    ...members.map(person=>portraitDueAt(person,congress.get(person.personId ?? person.id),CONGRESS_PORTRAIT_RECHECK_MS,verified))];
  return new Date(Math.max(Date.parse(now),due.length ? Math.min(...due) : Date.parse(now)+PORTRAIT_RETRY_MS)).toISOString();
}

export async function refreshPeoplePortraits(input:{store:RoutineDataStore;vault:EvidenceStore;state:string;options?:StandingPortraitOptions}) {
  const {store,vault,state}=input,options=input.options ?? {},clock=options.now ?? (()=>new Date().toISOString());
  const pacing={sizeFor:websiteSizeFromHoldings([state])};
  const acquire=options.acquire ?? ((request:Parameters<typeof pacedPortraitAcquire>[0])=>pacedPortraitAcquire(request,pacing));
  const portraitOptions={...options,acquire,storePortrait:options.storePortrait ?? ((...args:Parameters<typeof storeStandingPortrait>)=>storeStandingPortrait(args[0],args[1],args[2],args[3],pacing))};
  const jurisdiction=peopleJurisdiction(state);
  const contractId=`people-portraits-${state.toLowerCase()}`;
  // The held record is read once; every save builds on the version the run itself last saved.
  let held:HeldPeopleSource=await readHeldPeopleSource(store,jurisdiction,"people-portraits",clock());
  const heldFacts=(base:HeldPeopleSource)=>(base.normalizedPayload as {excludedFacts?:PortraitAttempt[]}|undefined)?.excludedFacts ?? [];
  const priorFacts=heldFacts(held);
  const priorRoster=held.versionId ? held.roster : null;
  const linkingCaptures:PortraitCapture[]=[...(options.linkingCaptures ?? [])];
  const sources=await sourceInputs(store,state,{vault,captures:linkingCaptures});
  let baseRoster:OfficeholderSet|null=null,last=null as Awaited<ReturnType<typeof publishPeopleSource>>|null;
  let finished=new Map<string,{person:Officeholder;facts:readonly PortraitAttempt[]}>(),queue=Promise.resolve();
  // The last save carries the run's end state: what is left to do, or when the next photo is due.
  const publish=async(end:{continuation:readonly PortraitAttempt[];schedule:PortraitAttempt}|null)=>{
    const batch=[...finished.values()];
    finished=new Map();
    const people=new Set(batch.map(row=>row.person.personId ?? row.person.id));
    const officeholders=batch.length ? batch.map(row=>portraitPerson(row.person)) : baseRoster!.officeholders.map(portraitPerson);
    for(;;){
      const kept=heldFacts(held).filter(fact=>!people.has((fact.record as {personId?:string}|undefined)?.personId ?? "") &&
        fact.code !== PORTRAIT_SCHEDULE_CODE && !(end && fact.code.endsWith("_WORK_REMAINS")));
      // Attempt times and the schedule are the record's own news: an unchanged roster still saves them.
      const heldSchedule=heldFacts(held).find(fact=>fact.code === PORTRAIT_SCHEDULE_CODE);
      const news=batch.some(row=>row.facts.length>0) || Boolean(end && (end.continuation.length>0 ||
        (heldSchedule?.record as {nextDueAt?:string}|undefined)?.nextDueAt !== (end.schedule.record as {nextDueAt:string}).nextDueAt));
      const publication=await publishPeopleSource({store,vault,state,contractId,sourceId:"people-portraits",
        roster:{scope:state,generatedAt:clock(),officeholders,divisions:[],unmatched:[]},acquisitions:[],releaseId:clock(),now:clock(),
        derivedInputs:[...sources,...batch.flatMap(row=>portraitInputs(row.person,row.facts))],
        excludedFacts:[...kept,...batch.flatMap(row=>row.facts),...end ? [...end.continuation,end.schedule] : []],confirmUnchanged:!news,held});
      if(publication.outcome.candidate.failureCode === "PROMOTION_BASE_CHANGED"){held=await readHeldPeopleSource(store,jurisdiction,"people-portraits",clock());continue;}
      if(!publication.outcome.promoted && !publication.outcome.confirmed)throw Error(`PEOPLE_PORTRAIT_PUBLICATION_REFUSED:${publication.outcome.candidate.failureDetail}`);
      if(publication.outcome.promoted)held={versionId:publication.outcome.promoted.versionId,
        roster:(publication.candidate.readModel as {roster:OfficeholderSet}).roster,normalizedPayload:publication.candidate.normalizedPayload};
      last=publication;return;
    }
  };
  const runFacts:PortraitAttempt[]=[],runPeople=new Set<string>();
  const marker=async(person:Officeholder,facts:readonly PortraitAttempt[])=>{
    finished.set(person.personId ?? person.id,{person,facts});
    runPeople.add(person.personId ?? person.id);runFacts.push(...facts);
    if(finished.size>=PORTRAIT_BATCH_SIZE){
      const operation=queue.then(async()=>{if(finished.size>=PORTRAIT_BATCH_SIZE)await publish(null);});
      queue=operation.catch(()=>{});await operation;
    }
    await options.onPerson?.(person,facts);
  };
  // The place's members of Congress share its portrait record; readers lay their photos on the place directory.
  const [peopleRead,placeRead]=await Promise.all([state === "us" ? readPeopleSourceProjection("US","statewide-executive-sources",{store,now:clock(),bypassCache:true}) : readStatePeopleProjection(jurisdiction as `US-${string}`,{store,now:clock(),bypassCache:true}),
    state === "us" ? Promise.resolve(null) : readStateFederalDirectory(state,{store,now:clock(),bypassCache:true})]);
  const people=peopleRead.kind === "PROMOTED" || peopleRead.kind === "BOOTSTRAP" ? peopleRead.value.roster : null;
  const place=placeRead?.kind === "PROMOTED" ? {...placeRead.value,
    roster:priorRoster ? withFederalPortraits(placeRead.value.roster,priorRoster) : placeRead.value.roster} : null;
  if(!people && !place)throw Error("PEOPLE_PORTRAIT_ROSTER_UNAVAILABLE");
  const local:Officeholder[]=[];
  if(state !== "us") {
    const registry=await readStateRegistryRuntimeProjection(state,{store,now:clock(),bypassCache:true});
    if(registry.kind === "PROMOTED" || registry.kind === "BOOTSTRAP") {
      const query=factReader();
      const bodies=query ? await query("SELECT id FROM entity WHERE kind='body' AND state=$1",[state.toUpperCase()]) : [];
      const rosters=[...registry.value.bodyRosters,...query ? (await readFactRosters(query,[...new Set([...registry.value.registry.bodies.map(body=>body.id),...bodies.map(body=>String(body.id))])])).rosters : []];
      for(const roster of rosters) for(const member of roster.members) local.push({id:member.id,personId:member.personId ?? member.id,
        nativeIds:member.nativeIds,name:member.name,officeTitle:member.officeTitle,level:"LOCAL",state:state.toUpperCase(),
        termStart:member.termStart ?? "",termEnd:member.termEnd ?? "",birthDate:null,partyLabel:member.partyLabel ?? null,
        websiteUrl:member.websiteUrl,profileUrls:[...new Set([member.websiteUrl,roster.sourceUrl].filter((url):url is string=>Boolean(url)))],
        contactFormUrl:null,phone:member.phone,email:member.email,campaignUrl:null,photo:null,social:{},
        provenance:{sourceUrl:roster.sourceUrl,sourceOrg:roster.sourceOrg,collectedAt:roster.collectedAt,verifiedAt:null}});
      const promotion=await store.readPromotion("REGISTRY_RUNTIME_BINDING",`US-${state.toUpperCase()}:reader-registry-runtime`);
      if(promotion){const reference=promotedInputRef("REGISTRY_RUNTIME_BINDING",promotion.scope,promotion.versionId,promotion.payload,promotion.promotedAt);if(reference)sources.push(reference);}
    }
  }
  const combined=mergePeopleSets([...(people ? [people] : []),{scope:state,generatedAt:clock(),officeholders:local,divisions:[],unmatched:[]}])!;
  if(priorRoster) {
    const photos=new Map(priorRoster.officeholders.filter(person=>person.photo).map(person=>[person.personId ?? person.id,person.photo]));
    for(const person of combined.officeholders) person.photo=person.photo ?? photos.get(person.personId ?? person.id) ?? null;
  }
  baseRoster={...(people ?? place!.roster),officeholders:[...combined.officeholders,...place?.roster.officeholders ?? []]};
  const stateResult=combined.officeholders.length ? await statePeoplePortraits({roster:combined,state,now:clock(),signal:options.signal},{...portraitOptions,linkingCaptures,previousExcludedFacts:priorFacts,onPerson:marker}) : null;
  const congressResult=place ? await congressPortraits(place,clock(),options.signal,{...portraitOptions,previousExcludedFacts:priorFacts,onPerson:marker}) : null;
  const continuationFacts=[...stateResult?.excludedFacts.filter(fact=>fact.code === "STATE_PORTRAIT_WORK_REMAINS") ?? [],
    ...congressResult?.excludedFacts.filter(fact=>fact.code === "CONGRESS_PORTRAIT_WORK_REMAINS") ?? []];
  await queue;
  // The last save carries the remaining work and the next due time, so a cut-off run resumes and an unchanged state rests.
  const factsNow=[...priorFacts.filter(fact=>!runPeople.has((fact.record as {personId?:string}|undefined)?.personId ?? "")),...runFacts];
  const nextDueAt=portraitNextDueAt(stateResult?.roster.officeholders ?? [],congressResult?.projection.roster.officeholders ?? [],factsNow,clock(),continuationFacts.length>0);
  await publish({continuation:continuationFacts,schedule:{key:`${jurisdiction}:portrait-schedule`,code:PORTRAIT_SCHEDULE_CODE,
    detail:`The next portrait in this state is due ${nextDueAt}; until then the runner skips it unless its people inputs change.`,record:{nextDueAt}}});
  if(!last)throw Error("PEOPLE_PORTRAIT_NO_HELD_PEOPLE");
  printSourceRunnerReceipt(contractId,last.candidate,last.outcome);
  return last;
}


async function main(){
  const state=parsePeoplePortraitArguments(process.argv.slice(2));
  installNeonRequestDeadline();prepareProductionCivicDataWrite();
  // Told when its pass ends, the run stops taking people in time to save where it stopped and print its receipt.
  const stop=new AbortController(),deadline=passDeadlineFromEnv();
  if(Number.isFinite(deadline))setTimeout(()=>stop.abort(Error("PASS_TIME_BUDGET")),Math.max(0,deadline-PORTRAIT_SAVE_MARGIN_MS-Date.now())).unref();
  process.once("SIGTERM",()=>stop.abort(Error("PASS_TIME_BUDGET")));
  await refreshPeoplePortraits({store:new PostgresRoutineDataStore(),vault:rawCaptureVault(),state,options:{signal:stop.signal}});
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)await main();
