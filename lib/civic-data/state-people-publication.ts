import { createHash } from "node:crypto";
import type { OfficeholderSet } from "../officials/types.ts";
import type { OfficialStateLegislatorReadModel } from "./candidate-builders.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { readOpenStatesPeopleProjection, mergeStatePeople } from "../state-rollcalls/legislators.ts";
import { processRegisteredRoutineCandidate } from "./promotion.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "./types.ts";
import type { RoutineDataStore } from "./store.ts";
import { PLURAL_PARSER_VERSION } from "../sources/plural/targets.ts";

export interface StatePeopleAcquisition {
  readonly requestedUrl:string; readonly finalUrl:string; readonly httpStatus:number; readonly body:string; readonly retrievedAt:string;
  readonly rawHash?:string;
  readonly artifactId?:string;
  readonly vaultKey?:string;
  readonly sourceCheck?: NonNullable<import("./types.ts").RetrievalEvidence["sourceCheck"]>;
  readonly extractedFrom?: {readonly requestedUrl:string;readonly finalUrl:string;readonly sha256:string;readonly member:string};
}
const hash = (value:unknown) => createHash("sha256").update(typeof value === "string" ? value : canonicalCivicDataJson(value)).digest("hex");
interface StatePeopleEvidence {
  readonly gaps?: readonly {sourceUrl:string;detail:string}[];
  readonly excludedFacts?: RoutineCandidate["excludedFacts"];
}

export function statePeopleCandidate(input: {state:string;roster:OfficeholderSet;acquisitions:readonly StatePeopleAcquisition[];releaseId:string;now:string} & StatePeopleEvidence): RoutineCandidate {
  const jurisdiction = `US-${input.state.toUpperCase()}` as const;
  const scope = `${jurisdiction}:openstates-people:v1`, sourceId = "plural-openstates";
  const acquiredAt = input.acquisitions.map(row=>row.retrievedAt).sort().at(-1) ?? input.now;
  const sourceCheck = input.acquisitions.flatMap(row=>row.sourceCheck ? [row.sourceCheck] : []).sort((a,b)=>b.checkedAt.localeCompare(a.checkedAt))[0];
  const readModel: OfficialStateLegislatorReadModel = JSON.parse(JSON.stringify({formatVersion:1,sourceId,jurisdiction,term:input.releaseId,generatedAt:acquiredAt,roster:input.roster}));
  const excludedFacts = [...(input.excludedFacts ?? []),...(input.gaps ?? []).map(gap=>({
    key:`${gap.sourceUrl}:native-record:${hash(gap.detail).slice(0,16)}`,code:gap.detail.split(":")[0],detail:gap.detail,record:{sourceUrl:gap.sourceUrl},
  }))];
  const normalizedPayload = {releaseId:input.releaseId,acquisitions:input.acquisitions.map(({body,sourceCheck:_sourceCheck,...row})=>({...row,textHash:hash(body)})),excludedFacts};
  // Keep the exact saved bytes in the durable candidate so parser changes can replay them.
  const payload = JSON.parse(JSON.stringify({releaseId:input.releaseId,acquisitions:input.acquisitions,gaps:input.gaps ?? [],excludedFacts}));
  const rawHash = hash(normalizedPayload), normalizedHash = hash(readModel);
  const people = input.roster.officeholders;
  return {id:`cv-${hash(`${sourceId}|${scope}|${rawHash}|${normalizedHash}|${hash(sourceCheck ?? null)}`).slice(0,32)}`,sourceId,recordClass:"STATE_LEGISLATOR",scope,
    retrieval:{succeeded:input.acquisitions.length>0 && input.acquisitions.every(row=>row.httpStatus>=200 && row.httpStatus<300 && row.body.length>0),
      requestedUrl:input.acquisitions[0]?.requestedUrl ?? "",finalUrl:input.acquisitions[0]?.finalUrl ?? null,httpStatus:input.acquisitions[0]?.httpStatus ?? null,retrievedAt:acquiredAt,rawHash,...(sourceCheck ? {sourceCheck} : {})},
    normalization:{succeeded:true,parserVersion:PLURAL_PARSER_VERSION,schemaVersion:"state-people/3",normalizedHash,normalizedPayloadHash:hash(payload),
      inputRecords:people.length,outputRecords:people.length,droppedRecords:0,missingRequiredFields:people.some(row=>!row.id || !row.name || !row.officeTitle || !row.provenance?.sourceUrl)?["person/office/source"]:[]},
    identities:people.map(row=>({subjectId:row.id,jurisdiction,identifiers:{person_id:row.personId ?? row.id},matchBasis:"OFFICIAL_ID" as const,ambiguous:false,office:row.officeTitle,chamber:row.chamber})),
    temporal:{version:input.releaseId,expectedVersion:input.releaseId,sourceThrough:acquiredAt,staleAtRetrieval:false},
    semantics:{factKind:"source-native people, memberships and independently sourced profile facts",violations:[]},
    horizon:{kind:input.roster.currentMembershipComplete ? "BOUNDED" : "OPEN_FACT_SET",query:`${jurisdiction} native current source membership at ${input.releaseId}`,returnedRecords:people.length,declaredTotal:input.roster.currentMembershipComplete ? people.length : null,paginationComplete:input.roster.currentMembershipComplete === true,claimsComplete:input.roster.currentMembershipComplete === true},
    absence:{claimsAbsence:false,basis:"NONE",exactSubject:null,exactHorizon:null},
    sourceProjectionEvidence:sourceProjectionEvidence(sourceId,"STATE_LEGISLATOR",scope),
    dependentChecks:[{consumer:"state people reader",passed:people.length>0 && new Set(people.map(row=>row.id)).size===people.length,detail:`${people.length} independently sourced people; unresolved boundaries do not suppress people.`}],
    excludedFacts,normalizedPayload:payload,readModel};
}

export async function publishStatePeople(input: {store:RoutineDataStore;state:string;roster:OfficeholderSet;acquisitions:readonly StatePeopleAcquisition[];sourceId?:string;releaseId:string;now:string;confirmUnchanged?:boolean} & StatePeopleEvidence) {
  const jurisdiction = `US-${input.state.toUpperCase()}` as const;
  const prior = await readOpenStatesPeopleProjection(jurisdiction,{store:input.store,now:input.now,bypassCache:true});
  if (prior.kind === "STORE_UNREACHABLE") throw new Error("STATE_PEOPLE_PRIOR_UNAVAILABLE");
  const held = prior.kind === "PROMOTED" || prior.kind === "BOOTSTRAP" ? prior.value.roster : null;
  const currentIds=new Set(input.roster.officeholders.map(row=>row.id));
  const explicitEnded = new Set(input.roster.officeholders.flatMap(row=>(row.memberships ?? []).filter(membership=>membership.current === false).map(membership=>membership.id)));
  const priorFacts = held ? {...held,
    officeholders:held.officeholders.filter(row=>!input.roster.currentMembershipComplete || currentIds.has(row.id)).map(row=>({...row,
      memberships:row.memberships?.map(membership=>input.roster.currentMembershipComplete || explicitEnded.has(membership.id) ? {...membership,current:false} : membership)})),
    divisions:input.roster.currentMembershipComplete ? [] : held.divisions.filter(row=>!row.membershipId || !explicitEnded.has(row.membershipId)),
    unmatched:input.roster.currentMembershipComplete ? [] : held.unmatched,
  } : null;
  const roster = mergeStatePeople(priorFacts,input.roster);
  const priorCandidate = prior.kind === "PROMOTED" && input.excludedFacts === undefined ? await input.store.readCandidate(prior.metadata.versionId!) : null;
  const carriedPortraitFacts = priorCandidate?.candidate.excludedFacts?.filter(fact=>fact.code.startsWith("STATE_PORTRAIT_")) ?? [];
  const candidate = statePeopleCandidate({...input,roster,excludedFacts:input.excludedFacts ?? carriedPortraitFacts});
  const outcome = await processRegisteredRoutineCandidate(input.store,`openstates-people-${input.state.toLowerCase()}`,candidate,input.now,
    prior.kind === "PROMOTED" ? prior.metadata.versionId : null,{confirmUnchanged:input.confirmUnchanged});
  return {candidate,outcome};
}

/** Finite known profiles share the existing deadline; per-person failures remain durable continuation work. */
export async function refreshStatePeoplePortraits(input: {store:RoutineDataStore;state:string;now?:string;signal?:AbortSignal;limit?:number}, options: {
  now?:()=>string;
  acquire?:typeof import("../sources/known-release.ts").acquireKnownRelease;
  storePortrait?:(personId:string,sources:import("../photos/evidence.ts").PortraitSources,now:string,signal:AbortSignal)=>Promise<import("../officials/types.ts").OfficeholderPhoto>;
} = {}) {
  const clock = options.now ?? (()=>new Date().toISOString());
  const now = input.now ?? clock();
  const read = await readOpenStatesPeopleProjection(`US-${input.state.toUpperCase()}`,{store:input.store,now,bypassCache:true});
  if (read.kind !== "PROMOTED") return null;
  const prior = await input.store.readCandidate(read.metadata.versionId!);
  const source = prior?.candidate.normalizedPayload as {releaseId?:string;acquisitions?:StatePeopleAcquisition[];gaps?:StatePeopleEvidence["gaps"]}|undefined;
  if (!source?.releaseId || !source.acquisitions?.length) return null;
  const { acquireKnownRelease } = await import("../sources/known-release.ts");
  const { isOfficialSource } = await import("./source-authority.ts");
  const { imagesIn,pickPortraits } = await import("../hunt/portrait-pick.ts");
  const { portraitHash } = await import("../photos/evidence.ts");
  const { storeVerifiedPortrait } = await import("../photos/store.ts");
  const { portraitBindingMatches } = await import("../photos/binding.ts");
  const { runBoundedWorkPool } = await import("../ops/bounded-work-pool.ts");
  const { sanitizedErrorDiagnostic } = await import("../ops/error-diagnostic.ts");
  const acquire = options.acquire ?? acquireKnownRelease;
  const storePortrait = options.storePortrait ?? ((id,sources,at,signal)=>storeVerifiedPortrait(id,sources,at,undefined,"officials",signal));
  const sourceSignal = input.signal ?? AbortSignal.timeout(5*60_000);
  const roster = {...read.value.roster,officeholders:read.value.roster.officeholders.map(row=>({...row}))};
  const lastAttempt = new Map<string,string>();
  for (const fact of prior?.candidate.excludedFacts ?? []) {
    const record = fact.record as {personId?:string;attemptedAt?:string}|undefined;
    if (fact.code.startsWith("STATE_PORTRAIT_") && record?.personId && record.attemptedAt) lastAttempt.set(record.personId,record.attemptedAt);
  }
  const due = roster.officeholders.filter(row=>!portraitBindingMatches(row.personId ?? row.id,row.photo ?? {url:""}) ||
    Date.parse(now)-Date.parse(row.photo!.verification!.checkedAt)>=7*86400000)
    .sort((a,b)=>(lastAttempt.get(a.personId ?? a.id) ?? "").localeCompare(lastAttempt.get(b.personId ?? b.id) ?? "") || a.id.localeCompare(b.id));
  const work = input.limit === undefined ? due : due.slice(0,Math.max(1,Math.min(input.limit,64)));
  const dueIds = new Set(due.map(person=>person.personId ?? person.id));
  const excludedFacts = (prior?.candidate.excludedFacts ?? []).filter(fact=>fact.code.startsWith("STATE_PORTRAIT_") &&
    dueIds.has((fact.record as {personId?:string}|undefined)?.personId ?? ""));
  let changed=false, attempted=0;
  const gap = (person:OfficeholderSet["officeholders"][number],code:string,detail:string,page?:import("../sources/known-release.ts").KnownRelease) => {
    excludedFacts.push({key:`${person.personId ?? person.id}:portrait`,code,detail,
      record:{personId:person.personId ?? person.id,sourceUrl:person.websiteUrl,attemptedAt:clock(),
        ...(page ? {sourceRetrievedAt:page.retrievedAt,sourceCheckedAt:page.checkedAt,rawHash:page.sha256,vaultKey:page.vaultKey} : {}),
        retainedVerifiedPortrait:Boolean(person.photo && portraitBindingMatches(person.personId ?? person.id,person.photo))}});
  };
  await runBoundedWorkPool(work,3,async person=>{
    if (sourceSignal.aborted) return;
    attempted++;
    for (let i=excludedFacts.length-1;i>=0;i--) if (excludedFacts[i].key === `${person.personId ?? person.id}:portrait`) excludedFacts.splice(i,1);
    if (!person.websiteUrl || !isOfficialSource(person.websiteUrl)) {
      gap(person,"STATE_PORTRAIT_PROFILE_UNRESOLVED","No verified official profile URL is held for this native person; no source route was invented."); return;
    }
    let page:import("../sources/known-release.ts").KnownRelease|undefined;
    try {
      const signal = AbortSignal.any([sourceSignal,AbortSignal.timeout(20000)]);
      const profile = new URL(person.websiteUrl!);
      if (profile.protocol === "http:") profile.protocol = "https:";
      const host = profile.hostname.replace(/^www\./, "");
      page = await acquire({sourceId:"official-person-profile",releaseId:person.websiteUrl!,url:profile.href,parserVersion:"portrait-profile/2",maxBytes:2*1024*1024,checkAfterMs:7*86400000,signal,allowedHosts:[host,`www.${host}`],headers:{accept:"text/html"}});
      if (!isOfficialSource(page.finalUrl)) throw Error("STATE_PORTRAIT_PROFILE_REDIRECT_UNVERIFIED");
      const text=new TextDecoder("utf-8",{fatal:true}).decode(page.bytes);
      const candidates=pickPortraits(person.name,imagesIn(text,page.finalUrl));
      candidates.sort((a,b)=>Number(b.src===person.portraitCandidate?.imageUrl)-Number(a.src===person.portraitCandidate?.imageUrl));
      if (!candidates.length) { gap(person,"STATE_PORTRAIT_IMAGE_NOT_FOUND","The captured official profile does not identify a portrait for this person.",page); return; }
      const capture: import("../photos/evidence.ts").PortraitCapture = {transport:"REACHABLE",partial:false,httpStatus:page.httpStatus,observedAt:page.checkedAt,
        evidence:{retrievedAt:page.retrievedAt,vaultKey:page.vaultKey,canonicalUrl:page.finalUrl,sourceId:new URL(page.finalUrl).hostname,contentHash:portraitHash(page.bytes),text}};
      let failure:unknown;
      for (const selected of candidates) {
        signal.throwIfAborted();
        try {
          // A real capture can finish after this continuation began. Verify at
          // the post-capture clock while retaining its original source vintage.
          person.photo=await storePortrait(person.personId ?? person.id,{subject:{personId:person.personId ?? person.id,name:person.name,nativeIds:person.nativeIds,profileUrls:[page.finalUrl]},imageUrl:selected.src,captures:[capture]},clock(),signal);
          changed=true; return;
        } catch (error) { failure=error; }
      }
      throw failure ?? Error("STATE_PORTRAIT_IMAGE_UNVERIFIED");
    } catch (error) {
      gap(person,"STATE_PORTRAIT_PROCESSING_FAILED",`The known profile/image did not complete; prior person facts and verified portrait remain. ${sanitizedErrorDiagnostic(error,500)}`,page);
    }
  });
  if (attempted<due.length) excludedFacts.push({key:`US-${input.state.toUpperCase()}:portrait-continuation`,code:"STATE_PORTRAIT_WORK_REMAINS",
    detail:`${due.length-attempted} known native profiles remain after this continuation; saved attempt dates prioritize unattempted people next.`});
  if (!changed && !attempted && !excludedFacts.length) return null;
  return publishStatePeople({store:input.store,state:input.state,roster,acquisitions:source.acquisitions,releaseId:source.releaseId,
    now:clock(),gaps:source.gaps,excludedFacts,confirmUnchanged:false});
}
