import { createHash } from "node:crypto";
import type { OfficeholderSet } from "../officials/types.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { processRegisteredRoutineCandidate } from "./promotion.ts";
import { sourceAuthority, isOfficialSource } from "./source-authority.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "./types.ts";
import type { RoutineDataStore } from "./store.ts";
import { capturedText, holdPeopleCaptures, priorPeopleCaptures, type StatePeopleAcquisition, type StatePeopleCapture } from "./state-people-publication.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { peopleSourceRecordClass, peopleSourceScope } from "../officials/people-sources.ts";
import { mergePeopleSets } from "../officials/merge-people.ts";
import { derivedRetrieval, type DerivedInputRef } from "./derived-authority.ts";
import { derivedRequestedUrl } from "./derived-door.ts";
import { statewidePageText, verifyStatewideOfficialPage } from "../sources/statewide/parse.ts";
import { legislaturePageNamesPerson } from "../sources/people/legislature.ts";

const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : canonicalCivicDataJson(value)).digest("hex");
export { peopleJurisdiction, readPeopleSourceProjection, type PeopleSourceReadModel } from "./people-source-read.ts";
import { peopleJurisdiction, readPeopleSourceProjection, type PeopleSourceReadModel } from "./people-source-read.ts";
interface PublishPeopleSourceInput {
  readonly store: RoutineDataStore;
  readonly vault: EvidenceStore;
  readonly state: string;
  readonly sourceId: string;
  readonly contractId?: string;
  readonly roster: OfficeholderSet;
  readonly acquisitions: readonly StatePeopleAcquisition[];
  readonly releaseId: string;
  readonly now: string;
  readonly gaps?: readonly {sourceUrl:string;detail:string}[];
  readonly excludedFacts?: RoutineCandidate["excludedFacts"];
  readonly derivedInputs?: readonly DerivedInputRef[];
  readonly confirmUnchanged?: boolean;
}
type PeopleCandidateInput = Omit<PublishPeopleSourceInput,"store"|"vault"|"acquisitions"> & {
  readonly captures: readonly StatePeopleCapture[];
  readonly violations: readonly string[];
};
const words = (text:string) => text.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

/* Each person must be named, with office and quote, on an official page this source saved; pages not read this run come from the vault. */
async function peopleSourceViolations(input:{sourceId:string;roster:OfficeholderSet;captures:readonly StatePeopleCapture[];read:readonly StatePeopleAcquisition[];vault:EvidenceStore}):Promise<string[]> {
  if (!["official-state-people", "statewide-executive-sources"].includes(input.sourceId)) return [];
  const texts=new Map(input.read.map(row=>[row.finalUrl,row.body]));
  const textOf=async (row:StatePeopleCapture)=>{
    if (!texts.has(row.finalUrl)) texts.set(row.finalUrl,await capturedText(input.vault,row));
    return texts.get(row.finalUrl)!;
  };
  const violations:string[]=[];
  for (const person of input.roster.officeholders) {
    const quote = person.provenance.quote ?? person.provenance.evidenceExcerpt;
    const own = input.captures.filter(row=>row.finalUrl === person.provenance.sourceUrl);
    const capture = quote ? own.find(row=>row.retrievedAt === person.provenance.collectedAt) ?? own[0] : undefined;
    const body = capture ? await textOf(capture) : "";
    let linkingPage:{url:string;html:string}|undefined;
    if (capture && !isOfficialSource(capture.finalUrl)) for (const row of input.captures) {
      const page={url:row.finalUrl,html:await textOf(row)};
      if (isOfficialSource(capture.finalUrl,page)) { linkingPage=page; break; }
    }
    const pageText = words(statewidePageText(body));
    if (!capture || !quote || !pageText.includes(words(quote)) || !isOfficialSource(capture.finalUrl,linkingPage) ||
      !(input.sourceId === "official-state-people" ? legislaturePageNamesPerson(body,person.name) : pageText.includes(words(person.name)))
      || !pageText.includes(words(person.officeTitle).replace(/^state /,""))) violations.push(`PEOPLE_OWN_OFFICIAL_PAGE_UNVERIFIED:${person.id}`);
    else if (input.sourceId === "statewide-executive-sources") {
      const bound = verifyStatewideOfficialPage({sourceId:input.sourceId,sourceOrg:person.provenance.sourceOrg,sourceUrl:capture.finalUrl,collectedAt:capture.retrievedAt,
        state:person.state!,name:person.name,officeTitle:person.officeTitle,profileUrls:[capture.finalUrl]},
        {url:capture.finalUrl,html:body,retrievedAt:capture.retrievedAt,linkingPage});
      if (!("person" in bound) || person.selectionMethod && person.selectionMethod !== bound.person.selectionMethod) violations.push(`PEOPLE_OWN_OFFICIAL_OFFICE_UNVERIFIED:${person.id}`);
    }
  }
  return violations;
}
function peopleSourceCandidate(input: PeopleCandidateInput): RoutineCandidate {
  const jurisdiction = peopleJurisdiction(input.state), scope = peopleSourceScope(jurisdiction, input.sourceId);
  const recordClass = peopleSourceRecordClass(jurisdiction, input.sourceId), parserVersion = sourceAuthority(input.sourceId)?.parserVersion ?? "people-sources/1";
  const acquiredAt = input.captures.map(row=>row.retrievedAt).sort().at(-1) ?? input.now;
  const readModel: PeopleSourceReadModel = JSON.parse(JSON.stringify({formatVersion:1,sourceId:input.sourceId,jurisdiction,term:input.releaseId,generatedAt:acquiredAt,roster:input.roster}));
  const people = input.roster.officeholders;
  const excludedFacts = [...(input.excludedFacts ?? []), ...(input.gaps ?? []).map(gap=>({key:gap.sourceUrl,code:"PEOPLE_SOURCE_GAP",detail:gap.detail,record:gap})),
    ...(input.roster.disagreements ?? []).map(row=>({key:row.key,code:"PEOPLE_FIELD_DISAGREEMENT",detail:`${row.field} has conflicting source values; the preferred value is published and BL-01 is owed the disagreement.`,record:row}))];
  const payload = JSON.parse(JSON.stringify({releaseId:input.releaseId,captures:input.captures,excludedFacts}));
  const rawHash = hash(payload), normalizedHash = hash(readModel);
  const derived = input.derivedInputs?.length ? derivedRetrieval(input.derivedInputs) : null;
  // The read's own instant orders versions; the "read:" prefix sorts after any content-hash version.
  const version = `read:${input.now}`;
  return {id:`cv-${hash([input.sourceId, scope, rawHash, normalizedHash]).slice(0,32)}`, sourceId:input.sourceId,recordClass,scope,
    retrieval: derived ? {succeeded:true,requestedUrl:derivedRequestedUrl(input.sourceId,scope),finalUrl:null,httpStatus:null,retrievedAt:derived.retrievedAt!,rawHash:derived.rawHash,derived:{inputs:input.derivedInputs!}}
      : {succeeded:input.captures.length>0 && input.captures.every(row=>row.httpStatus>=200 && row.httpStatus<300 && row.capture.byteLength>0),requestedUrl:input.captures[0]?.requestedUrl ?? "",finalUrl:input.captures[0]?.finalUrl ?? null,httpStatus:input.captures[0]?.httpStatus ?? null,retrievedAt:acquiredAt,rawHash},
    normalization:{succeeded:input.violations.length===0,parserVersion,schemaVersion:"people-sources/1",normalizedHash,normalizedPayloadHash:rawHash,inputRecords:people.length,outputRecords:people.length,droppedRecords:0,
      missingRequiredFields:people.some(row=>!row.id || !row.name || !row.officeTitle || !row.provenance.sourceUrl) ? ["person/office/source"] : []},
    identities:people.map(row=>({subjectId:row.id,jurisdiction,identifiers:{person_id:row.personId ?? row.id},matchBasis:"OFFICIAL_ID" as const,ambiguous:false,office:row.officeTitle,chamber:row.chamber})),
    temporal:{version,expectedVersion:version,sourceThrough:acquiredAt,staleAtRetrieval:false},semantics:{factKind:"source-bound people and current offices",violations:[...input.violations]},
    horizon:{kind:"OPEN_FACT_SET",query:`${jurisdiction} ${input.sourceId} known current people`,returnedRecords:people.length,declaredTotal:null,paginationComplete:false,claimsComplete:false},
    absence:{claimsAbsence:false,basis:"NONE",exactSubject:null,exactHorizon:null},sourceProjectionEvidence:sourceProjectionEvidence(input.sourceId,recordClass,scope),
    dependentChecks:[{consumer:"people readers",passed:new Set(people.map(row=>row.id)).size===people.length,detail:`${people.length} sourced people; partial acquisition never establishes absence.`}],excludedFacts,normalizedPayload:payload,readModel};
}
/** Publish one source/state independently. A failed or partial route retains prior verified facts. */
export async function publishPeopleSource(input: PublishPeopleSourceInput) {
  const jurisdiction = peopleJurisdiction(input.state);
  const prior = await readPeopleSourceProjection(jurisdiction,input.sourceId,{store:input.store,now:input.now,bypassCache:true});
  if (prior.kind === "STORE_UNREACHABLE") throw Error("PEOPLE_SOURCE_PRIOR_UNAVAILABLE");
  const old = prior.kind === "PROMOTED" ? await input.store.readCandidate(prior.metadata.versionId!) : null;
  const held = prior.kind === "PROMOTED" || prior.kind === "BOOTSTRAP" ? prior.value.roster : null;
  let roster = mergePeopleSets([...(held ? [held] : []), input.roster])!;
  const comparisonFacts: NonNullable<RoutineCandidate["excludedFacts"]>[number][] = [];
  // Source comparisons are standing blanks on the existing roster evidence,
  // not a publication gate or another store. Publish only this source's people.
  if (jurisdiction !== "US" && input.sourceId !== "people-portraits") {
    try {
      const { readStatePeopleProjection } = await import("../state-rollcalls/legislators.ts");
      const composite = await readStatePeopleProjection(jurisdiction,{store:input.store,now:input.now,bypassCache:true});
      if (composite.kind === "PROMOTED" || composite.kind === "BOOTSTRAP") {
        const comparison = mergePeopleSets([composite.value.roster,roster])!;
        roster = {...roster,disagreements:comparison.disagreements};
      }
    } catch {
      comparisonFacts.push({key:`${jurisdiction}:source-comparison`,code:"PEOPLE_SOURCE_COMPARISON_PENDING",detail:"Another held source could not be read for comparison. This source's verified people publish; comparison remains standing work.",record:{state:jurisdiction,owner:"BL-01",status:"OPEN"}});
    }
  }
  // A page read this run replaces its earlier capture; pages not read again keep theirs.
  const read = await holdPeopleCaptures(input.vault,input.sourceId,input.acquisitions);
  const reread = new Set(read.map(row=>row.finalUrl));
  const carried = priorPeopleCaptures(old?.candidate.normalizedPayload).filter(row=>!reread.has(row.finalUrl));
  const captures = [...new Map(read.map(row=>[row.finalUrl,row])).values(), ...carried];
  const violations = await peopleSourceViolations({sourceId:input.sourceId,roster,captures,read:input.acquisitions,vault:input.vault});
  const candidate = peopleSourceCandidate({...input,roster,captures,violations,excludedFacts:[...(input.excludedFacts ?? []),...comparisonFacts]});
  const state = input.state.replace(/^US-/i, "").toLowerCase();
  const contractId = input.contractId ?? (input.sourceId === "people-portraits"
    ? `people-portraits-${state === "us" ? "federal" : state}`
    : `people-${input.sourceId}-${state}`);
  const outcome = await processRegisteredRoutineCandidate(input.store,contractId,candidate,input.now,prior.kind === "PROMOTED" ? prior.metadata.versionId : null,{confirmUnchanged:input.confirmUnchanged});
  return {candidate,outcome};
}
