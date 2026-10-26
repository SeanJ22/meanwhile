/** Standing own-page portrait work, scheduled separately from roster readers. */
import { pathToFileURL } from "node:url";
import { STATE_PEOPLE_JURISDICTIONS } from "../lib/officials/people-identity.ts";
import { statePeoplePortraits } from "../lib/civic-data/state-people-publication.ts";
import { publishPeopleSource, readHeldPeopleSource, type HeldPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { congressPortraits } from "../lib/officials/congress-portraits.ts";
import { portraitInputScopes, portraitList, portraitNextDueAt, portraitSnapshotSettled, readPortraitSourceSnapshot, type PortraitList, type PortraitSourceProbe } from "../lib/photos/portrait-run.ts";
import { derivedRetrieval, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import { derivedSourceContentHash } from "../lib/civic-data/derived-source-hash.ts";
import { confirmSourceHashUnchanged, sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import { sourceAuthority } from "../lib/civic-data/source-authority.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PORTRAIT_SCHEDULE_CODE, PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import type { PortraitAttempt, StandingPortraitOptions } from "../lib/photos/portrait-work.ts";
import { portraitHash, type PortraitCapture } from "../lib/photos/evidence.ts";
import { pacedPortraitAcquire, storeStandingPortrait } from "../lib/photos/portrait-work.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { capturedText, type StatePeopleCapture } from "../lib/civic-data/state-people-publication.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { peopleJurisdiction } from "../lib/civic-data/people-source-read.ts";
import { peopleSourceScope } from "../lib/officials/people-sources.ts";
import { factReader } from "../lib/facts/db.ts";
import { personIdentityKeys } from "../lib/officials/people-identity.ts";
import type { Query } from "../lib/facts/publish.ts";

export function parsePeoplePortraitArguments(args:readonly string[]):string {
  const state=args.find(arg=>arg.startsWith("--state="))?.slice(8).toLowerCase();
  const force=args.filter(arg=>arg === "--force").length;
  if (args.filter(arg=>arg === "--promote").length !== 1 || force>1 || args.length !== 2+force ||
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

/** The pages a person's own facts cite: their roster rows, profile and portrait lead, and an Open States archive file by its path. */
function personSources(person:Officeholder):{urls:string[];members:string[]} {
  const urls=[person.provenance?.sourceUrl,...Object.values(person.fieldSources ?? {}).map(source=>source?.sourceUrl),
    person.portraitCandidate?.sourceUrl,person.websiteUrl,...(person.profileUrls ?? [])].filter((url):url is string=>Boolean(url));
  const members=urls.flatMap(url=>/^https:\/\/raw\.githubusercontent\.com\/openstates\/people\/[a-f0-9]{40}\/(data\/.+)$/.exec(url)?.[1] ?? []);
  return {urls:[...new Set(urls)],members:[...new Set(members)]};
}

/** Only the saved pages of the people whose portraits are due; no state's whole file set is loaded. */
async function personCaptures(store:RoutineDataStore,vault:EvidenceStore,list:PortraitList,people:readonly Officeholder[]):Promise<PortraitCapture[]> {
  if(!people.length)return [];
  const wanted=people.map(personSources),urls=[...new Set(wanted.flatMap(row=>row.urls))],members=[...new Set(wanted.flatMap(row=>row.members))];
  const captures:PortraitCapture[]=[],sourceIds=new Map(portraitInputScopes(list.state).map(row=>[row.scope,row.sourceId]));
  for(const roster of list.rosters){
    for(const row of await store.readCandidateCaptures(roster.versionId,urls,members) as StatePeopleCapture[]){
      const text=await capturedText(vault,row);
      captures.push({transport:"REACHABLE",partial:false,httpStatus:row.httpStatus,
        observedAt:row.sourceCheck?.checkedAt ?? row.retrievedAt,evidence:{canonicalUrl:row.finalUrl,sourceId:sourceIds.get(roster.scope) ?? roster.scope,
          contentHash:portraitHash(new TextEncoder().encode(text)),text,retrievedAt:row.retrievedAt,vaultKey:row.capture.vaultKey}});
    }
  }
  return captures;
}

/** The promotions a save's people came from, named by their immutable source headers. */
async function sourceInputs(store:RoutineDataStore,list:PortraitList):Promise<(people:readonly Officeholder[])=>DerivedInputRef[]> {
  const rosters=list.rosters.flatMap(row=>row.readModelSha256 ? [{row,ref:{kind:"PROMOTED_VERSION" as const,recordClass:row.recordClass,scope:row.scope,
    versionId:row.versionId,readModelSha256:row.readModelSha256,promotedAt:row.promotedAt}}] : []);
  const promotion=list.registry ? await store.readSourceHead("REGISTRY_RUNTIME_BINDING",list.registry) : null;
  const registry:DerivedInputRef|null=promotion?.normalizedHash && promotion.candidateState === "PROMOTED" ? {kind:"PROMOTED_VERSION",
    recordClass:promotion.recordClass,scope:promotion.scope,versionId:promotion.versionId,readModelSha256:promotion.normalizedHash,promotedAt:promotion.promotedAt} : null;
  const place=list.placeInput,members=new Set(list.place?.roster.officeholders.map(person=>person.id) ?? []);
  const fallback=registry ?? place ?? rosters[0]?.ref ?? null;
  return people=>{
    const keys=new Set(people.flatMap(person=>[...personIdentityKeys(person)]));
    const refs:DerivedInputRef[]=rosters.filter(({row})=>row.roster.officeholders.some(person=>[...personIdentityKeys(person)].some(key=>keys.has(key)))).map(({ref})=>ref);
    if(registry && people.some(person=>person.level === "LOCAL"))refs.push(registry);
    if(place?.kind === "PROMOTED_VERSION" && people.some(person=>members.has(person.id)) && !refs.some(ref=>ref.kind === "PROMOTED_VERSION" && ref.scope === place.scope))refs.push(place);
    return refs.length || !fallback ? refs : [fallback];
  };
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

export async function refreshPeoplePortraits(input:{store:RoutineDataStore;vault:EvidenceStore;state:string;query?:Query|null;options?:StandingPortraitOptions;force?:boolean}) {
  const {store,vault,state}=input,options=input.options ?? {},clock=options.now ?? (()=>new Date().toISOString());
  const query=input.query === undefined ? factReader() : input.query;
  const pacing={sizeFor:websiteSizeFromHoldings([state])};
  const acquire=options.acquire ?? ((request:Parameters<typeof pacedPortraitAcquire>[0])=>pacedPortraitAcquire(request,pacing));
  const portraitOptions={...options,acquire,storePortrait:options.storePortrait ?? ((...args:Parameters<typeof storeStandingPortrait>)=>storeStandingPortrait(args[0],args[1],args[2],args[3],pacing))};
  const jurisdiction=peopleJurisdiction(state);
  const contractId=`people-portraits-${state.toLowerCase()}`;
  const snapshot=await readPortraitSourceSnapshot(store,state,query),at=clock();
  const rawHash=snapshot.probe?.sourceContentHash ?? "";
  const confirmation=await confirmSourceHashUnchanged({store,sourceId:"people-portraits",recordClass:"STATE_LEGISLATOR",
    scope:peopleSourceScope(jurisdiction,"people-portraits"),parserVersion:sourceAuthority("people-portraits")!.parserVersion,
    rawHash,retrieval:{requestedUrl:`derived:people-portraits:${peopleSourceScope(jurisdiction,"people-portraits")}`,finalUrl:null,httpStatus:null,
      rawHash,retrievedAt:snapshot.probe?.retrievedAt ?? at},now:at,complete:!input.force && portraitSnapshotSettled(snapshot,at)});
  if(confirmation){
    console.log("RCD_RECEIPT="+JSON.stringify({source:contractId,...sourceHashReceiptFields(confirmation),structuralReleaseContract:ZERO_RELEASE_EVENTS}));
    return {kind:"CONFIRMED_UNCHANGED" as const,confirmation};
  }
  // The held record is read once; every save builds on the version the run itself last saved.
  let held:HeldPeopleSource=await readHeldPeopleSource(store,jurisdiction,"people-portraits",clock());
  const heldFacts=(base:HeldPeopleSource)=>(base.normalizedPayload as {excludedFacts?:PortraitAttempt[]}|undefined)?.excludedFacts ?? [];
  const priorFacts=heldFacts(held);
  // Work starts from the people without a portrait readers are shown; everyone else is never read again.
  const list=await portraitList(store,state,clock(),priorFacts,query,snapshot.stamp);
  const sourceContentInputs=[...snapshot.sourceContentInputs,...list.everyone.flatMap(person=>portraitInputs(person,
    priorFacts.filter(fact=>(fact.record as {personId?:string}|undefined)?.personId === (person.personId ?? person.id))))];
  const sources=await sourceInputs(store,list);
  const linkingCaptures:PortraitCapture[]=[...(options.linkingCaptures ?? []),...await personCaptures(store,vault,list,list.due.people)];
  let last=null as Awaited<ReturnType<typeof publishPeopleSource>>|null;
  let finished=new Map<string,{person:Officeholder;facts:readonly PortraitAttempt[]}>(),queue=Promise.resolve();
  // The last save carries the run's end state: what is left to do, when the next person is due, and what the list was built from.
  const publish=async(end:{continuation:readonly PortraitAttempt[];schedule:PortraitAttempt}|null)=>{
    const batch=[...finished.values()];
    finished=new Map();
    const people=new Set(batch.map(row=>row.person.personId ?? row.person.id));
    for(;;){
      // A state's first record names everyone listed; later saves carry only the people they finished.
      const officeholders=batch.length ? batch.map(row=>portraitPerson(row.person)) : held.versionId ? [] : list.everyone.map(portraitPerson);
      const kept=heldFacts(held).filter(fact=>!people.has((fact.record as {personId?:string}|undefined)?.personId ?? "") &&
        fact.code !== PORTRAIT_SCHEDULE_CODE && !(end && fact.code.endsWith("_WORK_REMAINS")));
      sourceContentInputs.push(...batch.flatMap(row=>portraitInputs(row.person,row.facts)));
      const sourceProbe:PortraitSourceProbe={formatVersion:1,sourceId:"people-portraits",state:state.toUpperCase(),
        complete:Boolean(end && end.continuation.length===0),normalizationInputHash:snapshot.normalizationInputHash,
        dependencies:snapshot.dependencies,discovery:snapshot.discovery,
        nextTermAt:end ? (end.schedule.record as {nextDueAt:string|null}).nextDueAt : null,
        sourceContentHash:derivedSourceContentHash(sourceContentInputs),retrievedAt:derivedRetrieval(sourceContentInputs).retrievedAt ?? clock()};
      const publication=await publishPeopleSource({store,vault,state,contractId,sourceId:"people-portraits",
        roster:{scope:state,generatedAt:clock(),officeholders,divisions:[],unmatched:[]},acquisitions:[],releaseId:clock(),now:clock(),
        derivedInputs:[...sources(batch.length ? batch.map(row=>row.person) : held.versionId ? [] : list.everyone),...batch.flatMap(row=>portraitInputs(row.person,row.facts))],
        sourceContentInputs,sourceProbe,
        excludedFacts:[...kept,...batch.flatMap(row=>row.facts),...end ? [...end.continuation,end.schedule] : []],confirmUnchanged:false,held});
      if(publication.outcome.candidate.failureCode === "PROMOTION_BASE_CHANGED"){held=await readHeldPeopleSource(store,jurisdiction,"people-portraits",clock());continue;}
      if(!publication.outcome.promoted && !publication.outcome.confirmed)throw Error(`PEOPLE_PORTRAIT_PUBLICATION_REFUSED:${publication.outcome.candidate.failureDetail}`);
      if(publication.outcome.promoted)held={versionId:publication.outcome.promoted.versionId,
        roster:(publication.candidate.readModel as {roster:OfficeholderSet}).roster,normalizedPayload:publication.candidate.normalizedPayload};
      last=publication;return;
    }
  };
  const runFacts:PortraitAttempt[]=[],runPeople=new Map<string,Officeholder>();
  const marker=async(person:Officeholder,facts:readonly PortraitAttempt[])=>{
    finished.set(person.personId ?? person.id,{person,facts});
    runPeople.set(person.personId ?? person.id,person);runFacts.push(...facts);
    if(finished.size>=PORTRAIT_BATCH_SIZE){
      const operation=queue.then(async()=>{if(finished.size>=PORTRAIT_BATCH_SIZE)await publish(null);});
      queue=operation.catch(()=>{});await operation;
    }
    await options.onPerson?.(person,facts);
  };
  const stateResult=list.due.people.length ? await statePeoplePortraits({roster:{scope:state,generatedAt:clock(),officeholders:[...list.due.people],divisions:[],unmatched:[]},
    state,now:clock(),signal:options.signal},{...portraitOptions,linkingCaptures,previousExcludedFacts:priorFacts,onPerson:marker}) : null;
  const congressResult=list.place && list.due.members.length ? await congressPortraits({...list.place,roster:{...list.place.roster,officeholders:[...list.due.members]}},
    clock(),options.signal,{...portraitOptions,previousExcludedFacts:priorFacts,onPerson:marker}) : null;
  const continuationFacts=[...stateResult?.excludedFacts.filter(fact=>fact.code === "STATE_PORTRAIT_WORK_REMAINS") ?? [],
    ...congressResult?.excludedFacts.filter(fact=>fact.code === "CONGRESS_PORTRAIT_WORK_REMAINS") ?? []];
  await queue;
  // The last save carries the remaining work, the next due time and the list's inputs, so a cut-off run resumes and a settled state rests.
  const factsNow=[...priorFacts.filter(fact=>!runPeople.has((fact.record as {personId?:string}|undefined)?.personId ?? "")),...runFacts];
  const now=(person:Officeholder)=>runPeople.get(person.personId ?? person.id) ?? person;
  const nextDueAt=portraitNextDueAt(list.unverified.people.map(now),list.unverified.members.map(now),factsNow,clock(),continuationFacts.length>0);
  await publish({continuation:continuationFacts,schedule:{key:`${jurisdiction}:portrait-schedule`,code:PORTRAIT_SCHEDULE_CODE,
    detail:nextDueAt ? `The next person without a portrait in this state is due ${nextDueAt}; until then the runner skips the state unless its rosters name someone new.`
      : "Everyone this state's rosters name has a portrait; the runner skips the state until they name someone new.",
    record:{nextDueAt,seen:list.stamp}}});
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
  await refreshPeoplePortraits({store:new PostgresRoutineDataStore(),vault:rawCaptureVault(),state,force:process.argv.includes("--force"),options:{signal:stop.signal}});
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)await main();
