import { createHash } from "node:crypto";
import type { OfficeholderSet } from "../officials/types.ts";
import type { OfficialStateLegislatorReadModel } from "./candidate-builders.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { readOpenStatesPeopleProjection, mergeStatePeople } from "../state-rollcalls/legislators.ts";
import { processRegisteredRoutineCandidate } from "./promotion.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "./types.ts";
import type { RoutineDataStore } from "./store.ts";
import { PLURAL_PARSER_VERSION } from "../sources/plural/targets.ts";
import { readManualProjectionPrior } from "./manual-projections.ts";
import type { GenericBallotProjection } from "../ballot/generic-projection.ts";
import { publishOfficialBallotCandidacies } from "./official-candidacy-publication.ts";

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
  const payload = JSON.parse(JSON.stringify({releaseId:input.releaseId,acquisitions:input.acquisitions,
    endedMemberships:input.roster.endedMemberships ?? [],gaps:input.gaps ?? [],excludedFacts}));
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
  const priorCandidate = prior.kind === "PROMOTED" ? await input.store.readCandidate(prior.metadata.versionId!) : null;
  const held = prior.kind === "PROMOTED" || prior.kind === "BOOTSTRAP" ? prior.value.roster : null;
  const currentIds=new Set(input.roster.officeholders.map(row=>row.id));
  const explicitEnded = new Map((input.roster.endedMemberships ?? []).map(membership=>[membership.id,membership]));
  const priorPeople = held?.officeholders.filter(row=>!input.roster.currentMembershipComplete || currentIds.has(row.id)).flatMap(row=>{
    const memberships=row.memberships?.map(membership=>{
      const ended=explicitEnded.get(membership.id);
      return ended?.personId === membership.personId ? {...membership,...ended,current:false}
        : input.roster.currentMembershipComplete ? {...membership,current:false} : membership;
    });
    // A partial archive cannot assert absence, but an exact native end date
    // independently retires that tenure, including a person's final office.
    if (!currentIds.has(row.id) && memberships?.length && memberships.every(membership=>membership.current === false) &&
      memberships.some(membership=>explicitEnded.get(membership.id)?.personId === membership.personId)) return [];
    return [{...row,...(memberships ? {memberships} : {})}];
  }) ?? [];
  const priorIds=new Set(priorPeople.map(row=>row.id));
  const priorFacts = held ? {...held,
    officeholders:priorPeople,
    divisions:input.roster.currentMembershipComplete ? [] : held.divisions.filter(row=>priorIds.has(row.officeholderId) && (!row.membershipId || !explicitEnded.has(row.membershipId))),
    unmatched:input.roster.currentMembershipComplete ? [] : held.unmatched.filter(row=>priorIds.has(row.officeholderId) && !currentIds.has(row.officeholderId)),
  } : null;
  const roster = mergeStatePeople(priorFacts,input.roster);
  // Keep the original captures behind still-held facts. A malformed next
  // release must not sever a prior tenure's evidence before it later ends.
  const referenced = new Set([...roster.officeholders.flatMap(person=>[person.provenance.sourceUrl,
    ...(person.memberships ?? []).map(row=>row.sourceUrl),...(person.offices ?? []).map(row=>row.sourceUrl),
    ...Object.values(person.fieldSources ?? {}).map(row=>row.sourceUrl)]),
    ...(roster.endedMemberships ?? []).map(row=>row.sourceUrl)]);
  const captureUrl = (row:StatePeopleAcquisition) => {
    const revision=/^https:\/\/codeload\.github\.com\/openstates\/people\/zip\/([a-f0-9]{40})$/.exec(row.requestedUrl)?.[1];
    return revision && row.extractedFrom ? `https://raw.githubusercontent.com/openstates/people/${revision}/${row.extractedFrom.member}` : row.finalUrl;
  };
  const captured=new Set(input.acquisitions.map(captureUrl));
  const priorAcquisitions=(priorCandidate?.candidate.normalizedPayload as {acquisitions?:StatePeopleAcquisition[]}|undefined)?.acquisitions ?? [];
  const acquisitions=[...input.acquisitions,...priorAcquisitions.filter(row=>{
    const url=captureUrl(row);
    if (!referenced.has(url) || captured.has(url)) return false;
    captured.add(url); return true;
  })];
  const carriedPortraitFacts = priorCandidate?.candidate.excludedFacts?.filter(fact=>fact.code.startsWith("STATE_PORTRAIT_")) ?? [];
  const candidate = statePeopleCandidate({...input,roster,acquisitions,excludedFacts:input.excludedFacts ?? carriedPortraitFacts});
  const outcome = await processRegisteredRoutineCandidate(input.store,`openstates-people-${input.state.toLowerCase()}`,candidate,input.now,
    prior.kind === "PROMOTED" ? prior.metadata.versionId : null,{confirmUnchanged:input.confirmUnchanged});
  if (outcome.promoted) {
    const ballotPrior = await readManualProjectionPrior("ballot-contests", input.store, input.now);
    const ballots = Object.values((ballotPrior?.payload as GenericBallotProjection | undefined)?.ballots ?? {})
      .filter(ballot => ballot.election.state === input.state.toUpperCase());
    if (ballots.length && ballotPrior) await publishOfficialBallotCandidacies({ store: input.store, now: input.now, ballots,
      sourceReceipt: ballotPrior.sourceReceipt, statePeople: new Map([[jurisdiction, roster]]) });
  }
  return {candidate,outcome};
}

/** Every due profile is standing work, independent of its roster refresh. */
export async function statePeoplePortraits(input: {roster:OfficeholderSet;state:string;now?:string;signal?:AbortSignal},
  options:import("../photos/portrait-work.ts").StandingPortraitOptions = {}) {
  const clock = options.now ?? (()=>new Date().toISOString());
  const now = input.now ?? clock();
  const { isOfficialSource } = await import("./source-authority.ts");
  const { imagesIn,pickPortraits } = await import("../hunt/portrait-pick.ts");
  const { portraitHash } = await import("../photos/evidence.ts");
  const { portraitBindingMatches } = await import("../photos/binding.ts");
  const { runBoundedWorkPool } = await import("../ops/bounded-work-pool.ts");
  const { sanitizedErrorDiagnostic } = await import("../ops/error-diagnostic.ts");
  const { linkingPageFrom } = await import("../control-plane/promotion/section3.ts");
  const { pacedPortraitAcquire, storeStandingPortrait } = await import("../photos/portrait-work.ts");
  const acquire = options.acquire ?? pacedPortraitAcquire;
  const storePortrait = options.storePortrait ?? storeStandingPortrait;
  const sourceSignal = input.signal ?? new AbortController().signal;
  const linkingCaptures=options.linkingCaptures ?? [];
  const official=(url:string)=>isOfficialSource(url,linkingPageFrom(url,linkingCaptures.map(row=>row.evidence)));
  const roster = {...input.roster,officeholders:input.roster.officeholders.map(row=>({...row}))};
  const lastAttempt = new Map<string,string>();
  for (const fact of options.previousExcludedFacts ?? []) {
    const record = fact.record as {personId?:string;attemptedAt?:string}|undefined;
    if (fact.code.startsWith("STATE_PORTRAIT_") && record?.personId && record.attemptedAt) lastAttempt.set(record.personId,record.attemptedAt);
  }
  const due = roster.officeholders.filter(row=>!portraitBindingMatches(row.personId ?? row.id,row.photo ?? {url:""}) ||
    Date.parse(now)-Date.parse(row.photo!.verification!.checkedAt)>=7*86400000)
    .sort((a,b)=>(lastAttempt.get(a.personId ?? a.id) ?? "").localeCompare(lastAttempt.get(b.personId ?? b.id) ?? "") || a.id.localeCompare(b.id));
  const dueIds = new Set(due.map(person=>person.personId ?? person.id));
  const excludedFacts = (options.previousExcludedFacts ?? []).filter(fact=>fact.code.startsWith("STATE_PORTRAIT_") &&
    dueIds.has((fact.record as {personId?:string}|undefined)?.personId ?? ""));
  let attempted=0;
  const publicationErrors:unknown[]=[];
  const recordPerson = async (person:OfficeholderSet["officeholders"][number]) => {
    try { await options.onPerson?.(person,excludedFacts.filter(fact=>(fact.record as {personId?:string}|undefined)?.personId === (person.personId ?? person.id))); }
    catch (error) { publicationErrors.push(error); }
  };
  const gap = (person:OfficeholderSet["officeholders"][number],code:string,detail:string,page?:import("../sources/known-release.ts").KnownRelease,
    profileAttempts?:readonly {sourceUrl:string;code:string;detail:string}[]) => {
    excludedFacts.push({key:`${person.personId ?? person.id}:portrait`,code,detail,
      record:{personId:person.personId ?? person.id,sourceUrl:page?.finalUrl ?? person.websiteUrl,attemptedAt:clock(),
        ...(profileAttempts ? {profileAttempts} : {}),
        ...(page ? {sourceRetrievedAt:page.retrievedAt,sourceCheckedAt:page.checkedAt,rawHash:page.sha256,vaultKey:page.vaultKey} : {}),
        retainedVerifiedPortrait:Boolean(person.photo && portraitBindingMatches(person.personId ?? person.id,person.photo))}});
  };
  const results=await runBoundedWorkPool(due,3,async person=>{
    if (sourceSignal.aborted) return;
    attempted++;
    for (let i=excludedFacts.length-1;i>=0;i--) if (excludedFacts[i].key === `${person.personId ?? person.id}:portrait`) excludedFacts.splice(i,1);
    const profiles = [...new Set([person.websiteUrl,...(person.profileUrls ?? [])])]
      .filter((url):url is string=>Boolean(url && official(url)));
    if (!profiles.length) {
      gap(person,"STATE_PORTRAIT_PROFILE_UNRESOLVED","No verified official profile URL is held for this native person; no source route was invented."); await recordPerson(person); return;
    }
    let page:import("../sources/known-release.ts").KnownRelease|undefined;
    const profileAttempts:{sourceUrl:string;code:string;detail:string}[]=[];
    // Per-request cancellation remains; there is no deadline on the due roster.
    for (const sourceUrl of profiles) {
      if (sourceSignal.aborted) break;
      const signal = AbortSignal.any([sourceSignal,AbortSignal.timeout(20000)]);
      try {
        const profile = new URL(sourceUrl);
        if (profile.protocol === "http:") profile.protocol = "https:";
        const host = profile.hostname.replace(/^www\./, "");
        page = await acquire({sourceId:"official-person-profile",releaseId:sourceUrl,url:profile.href,parserVersion:"portrait-profile/2",maxBytes:2*1024*1024,checkAfterMs:7*86400000,signal,allowedHosts:[host,`www.${host}`],headers:{accept:"text/html"}});
        if (!official(page.finalUrl)) throw Error("STATE_PORTRAIT_PROFILE_REDIRECT_UNVERIFIED");
        const text=new TextDecoder("utf-8",{fatal:true}).decode(page.bytes);
        const candidates=pickPortraits(person.name,imagesIn(text,page.finalUrl));
        candidates.sort((a,b)=>Number(b.src===person.portraitCandidate?.imageUrl)-Number(a.src===person.portraitCandidate?.imageUrl));
        if (!candidates.length) {
          profileAttempts.push({sourceUrl,code:"STATE_PORTRAIT_IMAGE_NOT_FOUND",detail:"The captured official profile does not identify a portrait for this person."});
          continue;
        }
        const capture: import("../photos/evidence.ts").PortraitCapture = {transport:"REACHABLE",partial:false,httpStatus:page.httpStatus,observedAt:page.checkedAt,
          evidence:{retrievedAt:page.retrievedAt,vaultKey:page.vaultKey,canonicalUrl:page.finalUrl,sourceId:new URL(page.finalUrl).hostname,contentHash:portraitHash(page.bytes),text}};
        let failure:unknown;
        for (const selected of candidates) {
          signal.throwIfAborted();
          try {
            // Verify after capture while preserving the source's original vintage.
            person.photo=await storePortrait(person.personId ?? person.id,{subject:{personId:person.personId ?? person.id,name:person.name,nativeIds:person.nativeIds,profileUrls:[page.finalUrl]},imageUrl:selected.src,captures:[capture,...linkingCaptures]},clock(),signal);
            person.profileUrls=[...new Set([...(person.profileUrls ?? []),page.finalUrl])];
            person.fieldSources={...person.fieldSources,photo:{sourceUrl:page.finalUrl,sourceOrg:new URL(page.finalUrl).hostname,collectedAt:page.retrievedAt,verifiedAt:clock()}};
            await recordPerson(person); return;
          } catch (error) { failure=error; }
        }
        throw failure ?? Error("STATE_PORTRAIT_IMAGE_UNVERIFIED");
      } catch (error) {
        profileAttempts.push({sourceUrl,code:"STATE_PORTRAIT_PROCESSING_FAILED",detail:sanitizedErrorDiagnostic(error,500)});
      }
    }
    const code = profileAttempts.length && profileAttempts.every(row=>row.code === "STATE_PORTRAIT_IMAGE_NOT_FOUND")
      ? "STATE_PORTRAIT_IMAGE_NOT_FOUND" : "STATE_PORTRAIT_PROCESSING_FAILED";
    gap(person,code,"The directly held profile/image leads did not verify within this attempt; prior person facts and verified portrait remain.",page,profileAttempts);
    await recordPerson(person);
  });
  if (attempted<due.length) excludedFacts.push({key:`US-${input.state.toUpperCase()}:portrait-continuation`,code:"STATE_PORTRAIT_WORK_REMAINS",
    detail:`${due.length-attempted} known native profiles remain after this continuation; saved attempt dates prioritize unattempted people next.`});
  for (const result of results) if (!result.ok) {
    const person=due[result.index]!;
    gap(person,"STATE_PORTRAIT_PROCESSING_FAILED",result.error);
    await recordPerson(person);
  }
  if (publicationErrors.length) throw new AggregateError(publicationErrors,"STATE_PORTRAIT_PUBLICATION_FAILED");
  return {roster,excludedFacts,attempted};
}
