import { createHash } from "node:crypto";
import type { OfficeholderSet } from "../officials/types.ts";
import type { OfficialStateLegislatorReadModel } from "./candidate-builders.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { readOpenStatesPeopleProjection, mergeStatePeople } from "../state-rollcalls/legislators.ts";
import { processRegisteredRoutineCandidate } from "./promotion.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "./types.ts";
import type { RoutineDataStore } from "./store.ts";

export interface StatePeopleAcquisition {
  readonly requestedUrl:string; readonly finalUrl:string; readonly httpStatus:number; readonly body:string; readonly retrievedAt:string;
  readonly rawHash?:string;
  readonly artifactId?:string;
  readonly vaultKey?:string;
  readonly sourceCheck?: NonNullable<import("./types.ts").RetrievalEvidence["sourceCheck"]>;
  readonly extractedFrom?: {readonly requestedUrl:string;readonly finalUrl:string;readonly sha256:string;readonly member:string};
}
const hash = (value:unknown) => createHash("sha256").update(typeof value === "string" ? value : canonicalCivicDataJson(value)).digest("hex");

export function statePeopleCandidate(input: {state:string;roster:OfficeholderSet;acquisitions:readonly StatePeopleAcquisition[];releaseId:string;now:string}): RoutineCandidate {
  const jurisdiction = `US-${input.state.toUpperCase()}` as const;
  const scope = `${jurisdiction}:openstates-people:v1`, sourceId = "plural-openstates";
  const acquiredAt = input.acquisitions.map(row=>row.retrievedAt).sort().at(-1) ?? input.now;
  const sourceCheck = input.acquisitions.flatMap(row=>row.sourceCheck ? [row.sourceCheck] : []).sort((a,b)=>b.checkedAt.localeCompare(a.checkedAt))[0];
  const readModel: OfficialStateLegislatorReadModel = JSON.parse(JSON.stringify({formatVersion:1,sourceId,jurisdiction,term:input.releaseId,generatedAt:acquiredAt,roster:input.roster}));
  const normalizedPayload = {releaseId:input.releaseId,acquisitions:input.acquisitions.map(({body,sourceCheck:_sourceCheck,...row})=>({...row,textHash:hash(body)}))};
  // Keep the exact saved bytes in the durable candidate so parser changes can replay them.
  const payload = JSON.parse(JSON.stringify({releaseId:input.releaseId,acquisitions:input.acquisitions}));
  const rawHash = hash(normalizedPayload), normalizedHash = hash(readModel);
  const people = input.roster.officeholders;
  return {id:`cv-${hash(`${sourceId}|${scope}|${rawHash}|${normalizedHash}|${hash(sourceCheck ?? null)}`).slice(0,32)}`,sourceId,recordClass:"STATE_LEGISLATOR",scope,
    retrieval:{succeeded:input.acquisitions.length>0 && input.acquisitions.every(row=>row.httpStatus>=200 && row.httpStatus<300 && row.body.length>0),
      requestedUrl:input.acquisitions[0]?.requestedUrl ?? "",finalUrl:input.acquisitions[0]?.finalUrl ?? null,httpStatus:input.acquisitions[0]?.httpStatus ?? null,retrievedAt:acquiredAt,rawHash,...(sourceCheck ? {sourceCheck} : {})},
    normalization:{succeeded:true,parserVersion:"plural-roster/2",schemaVersion:"state-people/2",normalizedHash,normalizedPayloadHash:hash(payload),
      inputRecords:people.length,outputRecords:people.length,droppedRecords:0,missingRequiredFields:people.some(row=>!row.id || !row.name || !row.officeTitle || !row.provenance?.sourceUrl)?["person/office/source"]:[]},
    identities:people.map(row=>({subjectId:row.id,jurisdiction,identifiers:{person_id:row.personId ?? row.id},matchBasis:"OFFICIAL_ID" as const,ambiguous:false,office:row.officeTitle,chamber:row.chamber})),
    temporal:{version:input.releaseId,expectedVersion:input.releaseId,sourceThrough:acquiredAt,staleAtRetrieval:false},
    semantics:{factKind:"source-native people, memberships and independently sourced profile facts",violations:[]},
    horizon:{kind:input.roster.currentMembershipComplete ? "BOUNDED" : "OPEN_FACT_SET",query:`${jurisdiction} native current source membership at ${input.releaseId}`,returnedRecords:people.length,declaredTotal:input.roster.currentMembershipComplete ? people.length : null,paginationComplete:input.roster.currentMembershipComplete === true,claimsComplete:input.roster.currentMembershipComplete === true},
    absence:{claimsAbsence:false,basis:"NONE",exactSubject:null,exactHorizon:null},
    sourceProjectionEvidence:sourceProjectionEvidence(sourceId,"STATE_LEGISLATOR",scope),
    dependentChecks:[{consumer:"state people reader",passed:people.length>0 && new Set(people.map(row=>row.id)).size===people.length,detail:`${people.length} independently sourced people; unresolved boundaries do not suppress people.`}],
    normalizedPayload:payload,readModel};
}

export async function publishStatePeople(input: {store:RoutineDataStore;state:string;roster:OfficeholderSet;acquisitions:readonly StatePeopleAcquisition[];sourceId?:string;releaseId:string;now:string}) {
  const jurisdiction = `US-${input.state.toUpperCase()}` as const;
  const prior = await readOpenStatesPeopleProjection(jurisdiction,{store:input.store,now:input.now,bypassCache:true});
  if (prior.kind === "STORE_UNREACHABLE") throw new Error("STATE_PEOPLE_PRIOR_UNAVAILABLE");
  const held = prior.kind === "PROMOTED" || prior.kind === "BOOTSTRAP" ? prior.value.roster : null;
  const currentIds=new Set(input.roster.officeholders.map(row=>row.id));
  const priorFacts=held && input.roster.currentMembershipComplete ? {...held,officeholders:held.officeholders.filter(row=>currentIds.has(row.id)),divisions:held.divisions.filter(row=>currentIds.has(row.officeholderId)),unmatched:held.unmatched.filter(row=>currentIds.has(row.officeholderId))} : held;
  const roster = mergeStatePeople(priorFacts,input.roster);
  const candidate = statePeopleCandidate({...input,roster});
  const outcome = await processRegisteredRoutineCandidate(input.store,`openstates-people-${input.state.toLowerCase()}`,candidate,input.now,
    prior.kind === "PROMOTED" ? prior.metadata.versionId : null);
  return {candidate,outcome};
}

/** Portrait enrichment follows core promotion and uses only known official profile URLs.
 * A deterministic rotating slice bounds work while ensuring one failed image cannot starve later people. */
export async function refreshStatePeoplePortraits(input: {store:RoutineDataStore;state:string;now?:string;signal?:AbortSignal;limit?:number}) {
  const now = input.now ?? new Date().toISOString();
  const read = await readOpenStatesPeopleProjection(`US-${input.state.toUpperCase()}`,{store:input.store,now,bypassCache:true});
  if (read.kind !== "PROMOTED") return null;
  const prior = await input.store.readCandidate(read.metadata.versionId!);
  const source = prior?.candidate.normalizedPayload as {releaseId?:string;acquisitions?:StatePeopleAcquisition[]}|undefined;
  if (!source?.releaseId || !source.acquisitions?.length) return null;
  const { acquireKnownRelease } = await import("../sources/known-release.ts");
  const { isOfficialSource } = await import("./source-authority.ts");
  const { imagesIn,pickPortraits } = await import("../hunt/portrait-pick.ts");
  const { portraitHash } = await import("../photos/evidence.ts");
  const { storeVerifiedPortrait } = await import("../photos/store.ts");
  const roster = {...read.value.roster,officeholders:read.value.roster.officeholders.map(row=>({...row}))};
  const due = roster.officeholders.filter(row=>row.websiteUrl && isOfficialSource(row.websiteUrl) &&
    (!row.photo?.verification || Date.parse(now)-Date.parse(row.photo.verification.checkedAt)>=7*86400000)).sort((a,b)=>a.id.localeCompare(b.id));
  const limit=Math.max(1,Math.min(input.limit ?? 24,64)), groups=Math.max(1,Math.ceil(due.length/limit));
  const start = (Math.floor(Date.parse(now)/86400000)%groups)*limit;
  let changed=false;
  for (const person of due.slice(start,start+limit)) {
    if (input.signal?.aborted) break;
    try {
      const signal = input.signal ? AbortSignal.any([input.signal,AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
      const profile = new URL(person.websiteUrl!);
      if (profile.protocol === "http:") profile.protocol = "https:";
      const host = profile.hostname.replace(/^www\./, "");
      const page = await acquireKnownRelease({sourceId:"official-person-profile",releaseId:person.websiteUrl!,url:profile.href,parserVersion:"portrait-profile/2",maxBytes:2*1024*1024,checkAfterMs:7*86400000,signal,allowedHosts:[host,`www.${host}`],headers:{accept:"text/html"}});
      if (!isOfficialSource(page.finalUrl)) continue;
      const text=new TextDecoder("utf-8",{fatal:true}).decode(page.bytes);
      const candidates=pickPortraits(person.name,imagesIn(text,page.finalUrl));
      const selected=candidates.find(row=>row.src===person.portraitCandidate?.imageUrl) ?? (candidates.length===1 ? candidates[0] : null);
      if (!selected) continue;
      const capture: import("../photos/evidence.ts").PortraitCapture = {transport:"REACHABLE",partial:false,httpStatus:page.httpStatus,observedAt:page.checkedAt,
        evidence:{retrievedAt:page.retrievedAt,vaultKey:page.vaultKey,canonicalUrl:page.finalUrl,sourceId:new URL(page.finalUrl).hostname,contentHash:portraitHash(page.bytes),text}};
      person.photo=await storeVerifiedPortrait(person.personId ?? person.id,{subject:{personId:person.personId ?? person.id,name:person.name,nativeIds:person.nativeIds,profileUrls:[page.finalUrl]},imageUrl:selected.src,captures:[capture]},now);
      changed=true;
    } catch { /* The already published person and prior verified portrait remain readable; next scheduled slice retries. */ }
  }
  if (!changed) return null;
  return publishStatePeople({store:input.store,state:input.state,roster,acquisitions:source.acquisitions,releaseId:source.releaseId,now});
}
