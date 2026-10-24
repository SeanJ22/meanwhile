import { createHash } from "node:crypto";
import type { Officeholder, OfficeholderSet } from "../officials/types.ts";
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
import { verifiedWhiteHouseOfficial, ADMINISTRATION_URL } from "../sources/white-house/president.ts";
import { whiteHouseOffice } from "../officials/white-house-offices.ts";
import { withExecutiveCompleteness, executiveEvidenceReferences } from "../officials/national-executive.ts";
import { legislaturePageNamesPerson } from "../sources/people/legislature.ts";
import { rosterChanges, type RosterChange } from "../officials/roster-changes.ts";
import { publishRosterOfficePoints, type OfficePointResolver } from "../officials/office-points-publication.ts";

const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : canonicalCivicDataJson(value)).digest("hex");
export {  readPeopleSourceProjection,  } from "./people-source-read.ts";
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
  readonly resolveOfficePoint?: OfficePointResolver;
}
type PeopleCandidateInput = Omit<PublishPeopleSourceInput,"store"|"vault"|"acquisitions"> & {
  readonly captures: readonly StatePeopleCapture[];
  readonly violations: readonly string[];
  /** Seats this read changed against the source's last published read, for Admin's officials check. */
  readonly changes?: readonly RosterChange[];
};
const words = (text:string) => text.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

/* Each person must be named, with office and quote, on an official page this source saved; pages not read this run come from the vault. */
async function peopleSourceViolations(input:{state:string;sourceId:string;roster:OfficeholderSet;captures:readonly StatePeopleCapture[];read:readonly StatePeopleAcquisition[];vault:EvidenceStore;verifyNationalCurrent?:boolean}):Promise<string[]> {
  if (!["official-state-people", "statewide-executive-sources"].includes(input.sourceId)) return [];
  const captureKey = (row: Pick<StatePeopleCapture,"finalUrl"|"retrievedAt">) => `${row.finalUrl}|${row.retrievedAt}`;
  const texts=new Map(input.read.map(row=>[captureKey(row),row.body]));
  const textOf=async (row:StatePeopleCapture)=>{
    const key = captureKey(row);
    if (!texts.has(key)) texts.set(key,await capturedText(input.vault,row));
    return texts.get(key)!;
  };
  const violations:string[]=[];
  const national = input.state.toUpperCase() === "US" && input.sourceId === "statewide-executive-sources";
  const countryIds = new Set(input.roster.divisions.filter(link => link.ocdId === "ocd-division/country:us").map(link => link.officeholderId));
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
      || !(input.sourceId === "statewide-executive-sources" && !national) && !pageText.includes(words(person.officeTitle).replace(/^state /,""))) violations.push(`PEOPLE_OWN_OFFICIAL_PAGE_UNVERIFIED:${person.id}`);
    else if (national && input.verifyNationalCurrent !== false) {
      const index = input.captures.filter(row => row.finalUrl === ADMINISTRATION_URL).sort((a,b)=>b.retrievedAt.localeCompare(a.retrievedAt))[0];
      try {
        const office = whiteHouseOffice(person.officeTitle);
        if (!index || !office || !countryIds.has(person.id)) throw new Error("NATIONAL_OFFICIAL_CURRENT_OFFICE_UNRESOLVED");
        const verified = verifiedWhiteHouseOfficial(office, { url: index.finalUrl, html: await textOf(index), retrievedAt:index.retrievedAt }, { url: capture.finalUrl, requestedUrl: capture.requestedUrl, html: body, retrievedAt: capture.retrievedAt });
        const held = verified.officeholders[0];
        if (held.id !== person.id || held.name !== person.name || held.officeTitle !== person.officeTitle ||
          !person.memberships?.some(membership=>membership.id === held.memberships?.[0].id && membership.current === true && membership.divisionId === "ocd-division/country:us" && membership.officeTitle === held.officeTitle)) throw new Error("NATIONAL_OFFICIAL_PUBLISHED_IDENTITY_MISMATCH");
      } catch { violations.push(`PEOPLE_OWN_OFFICIAL_OFFICE_UNVERIFIED:${person.id}`); }
    }
    else if (!national && input.sourceId === "statewide-executive-sources") {
      const bound = verifyStatewideOfficialPage({sourceId:input.sourceId,sourceOrg:person.provenance.sourceOrg,sourceUrl:capture.finalUrl,collectedAt:capture.retrievedAt,
        state:person.state!,name:person.name,officeTitle:person.officeTitle,profileUrls:[capture.finalUrl]},
        {url:capture.finalUrl,html:body,retrievedAt:capture.retrievedAt,linkingPage});
      if (!("person" in bound) || person.selectionMethod && person.selectionMethod !== bound.person.selectionMethod) violations.push(`PEOPLE_OWN_OFFICIAL_OFFICE_UNVERIFIED:${person.id}`);
    }
  }
  // An empty seat publishes only in the official page's own words.
  for (const vacancy of input.roster.vacancies ?? []) {
    const capture = input.captures.filter(row=>row.finalUrl === vacancy.sourceUrl).sort((a,b)=>b.retrievedAt.localeCompare(a.retrievedAt))[0];
    const body = capture ? await textOf(capture) : "";
    let official = capture ? isOfficialSource(capture.finalUrl) : false;
    if (capture && !official) for (const row of input.captures) if (isOfficialSource(capture.finalUrl,{url:row.finalUrl,html:await textOf(row)})) { official = true; break; }
    if (!capture || !official || !words(statewidePageText(body)).includes(words(vacancy.reason))) violations.push(`PEOPLE_VACANCY_UNVERIFIED:${vacancy.ocdId}`);
  }
  return violations;
}
function peopleSourceCandidate(input: PeopleCandidateInput): RoutineCandidate {
  const jurisdiction = peopleJurisdiction(input.state), scope = peopleSourceScope(jurisdiction, input.sourceId);
  const recordClass = peopleSourceRecordClass(input.sourceId), parserVersion = sourceAuthority(input.sourceId)?.parserVersion ?? "people-sources/1";
  const acquiredAt = input.captures.map(row=>row.retrievedAt).sort().at(-1) ?? input.now;
  const readModel: PeopleSourceReadModel = JSON.parse(JSON.stringify({formatVersion:1,sourceId:input.sourceId,jurisdiction,term:input.releaseId,generatedAt:acquiredAt,roster:input.roster}));
  const people = input.roster.officeholders, vacancies = input.roster.vacancies ?? [];
  // A stated empty seat is a sourced record of its own.
  const records = people.length + vacancies.length;
  const excludedFacts = [...(input.excludedFacts ?? []), ...(input.gaps ?? []).map(gap=>({key:gap.sourceUrl,code:"PEOPLE_SOURCE_GAP",detail:gap.detail,record:gap})),
    ...(input.roster.disagreements ?? []).map(row=>({key:row.key,code:"PEOPLE_FIELD_DISAGREEMENT",detail:`${row.field} has conflicting source values; the preferred value is published and BL-01 is owed the disagreement.`,record:row}))];
  const payload = JSON.parse(JSON.stringify({releaseId:input.releaseId,captures:input.captures,excludedFacts,...(input.changes?.length ? {changes:input.changes} : {})}));
  const rawHash = hash(payload), normalizedHash = hash(readModel);
  const derived = input.derivedInputs?.length ? derivedRetrieval(input.derivedInputs) : null;
  // The read's own instant orders versions; the "read:" prefix sorts after any content-hash version.
  const version = `read:${input.now}`;
  return {id:`cv-${hash([input.sourceId, scope, rawHash, normalizedHash]).slice(0,32)}`, sourceId:input.sourceId,recordClass,scope,
    retrieval: derived ? {succeeded:true,requestedUrl:derivedRequestedUrl(input.sourceId,scope),finalUrl:null,httpStatus:null,retrievedAt:derived.retrievedAt!,rawHash:derived.rawHash,derived:{inputs:input.derivedInputs!}}
      : {succeeded:input.captures.length>0 && input.captures.every(row=>row.httpStatus>=200 && row.httpStatus<300 && row.capture.byteLength>0),requestedUrl:input.captures[0]?.requestedUrl ?? "",finalUrl:input.captures[0]?.finalUrl ?? null,httpStatus:input.captures[0]?.httpStatus ?? null,retrievedAt:acquiredAt,rawHash},
    normalization:{succeeded:input.violations.length===0,parserVersion,schemaVersion:"people-sources/1",normalizedHash,normalizedPayloadHash:rawHash,inputRecords:records,outputRecords:records,droppedRecords:0,
      missingRequiredFields:people.some(row=>!row.id || !row.name || !row.officeTitle || !row.provenance.sourceUrl) ? ["person/office/source"] : []},
    identities:[...people.map(row=>({subjectId:row.id,jurisdiction,identifiers:{person_id:row.personId ?? row.id},matchBasis:"OFFICIAL_ID" as const,ambiguous:false,office:row.officeTitle,chamber:row.chamber})),
      ...vacancies.map(row=>({subjectId:row.ocdId,jurisdiction,identifiers:{office_id:row.ocdId},matchBasis:"OFFICIAL_ID" as const,ambiguous:false,...(row.officeTitle ? {office:row.officeTitle} : {})}))],
    temporal:{version,expectedVersion:version,sourceThrough:acquiredAt,staleAtRetrieval:false},semantics:{factKind:"source-bound people and current offices",violations:[...input.violations]},
    horizon:{kind:"OPEN_FACT_SET",query:`${jurisdiction} ${input.sourceId} known current people and stated vacancies`,returnedRecords:records,declaredTotal:null,paginationComplete:false,claimsComplete:false},
    absence:{claimsAbsence:false,basis:"NONE",exactSubject:null,exactHorizon:null},sourceProjectionEvidence:sourceProjectionEvidence(input.sourceId,recordClass,scope),
    dependentChecks:[{consumer:"people readers",passed:new Set(people.map(row=>row.id)).size===people.length,detail:`${people.length} sourced people and ${vacancies.length} stated vacancies; partial acquisition never establishes absence.`}],excludedFacts,normalizedPayload:payload,readModel};
}
/** Publish one source/state independently. A failed or partial route retains prior verified facts. */
export async function publishPeopleSource(input: PublishPeopleSourceInput) {
  const jurisdiction = peopleJurisdiction(input.state);
  const prior = await readPeopleSourceProjection(jurisdiction,input.sourceId,{store:input.store,now:input.now,bypassCache:true});
  if (prior.kind === "STORE_UNREACHABLE") throw Error("PEOPLE_SOURCE_PRIOR_UNAVAILABLE");
  const old = prior.kind === "PROMOTED" ? await input.store.readCandidate(prior.metadata.versionId!) : null;
  const held = prior.kind === "PROMOTED" || prior.kind === "BOOTSTRAP" ? prior.value.roster : null;
  const national = jurisdiction === "US" && input.sourceId === "statewide-executive-sources";
  const read = await holdPeopleCaptures(input.vault,input.sourceId,input.acquisitions);
  const reread = new Set(read.map(row=>row.finalUrl));
  // A failed reread of one national official must retain the earlier bytes
  // behind that official's still-current last verified facts.
  const priorCaptures = national ? (old?.candidate.normalizedPayload as {captures?:StatePeopleCapture[]}|undefined)?.captures ?? []
    : priorPeopleCaptures(old?.candidate.normalizedPayload);
  const carried = priorCaptures.filter(row=>national || !reread.has(row.finalUrl));
  let captures = [...new Map([...carried,...read].map(row=>[national ? `${row.finalUrl}|${row.retrievedAt}` : row.finalUrl,row])).values()];
  const nationalExcluded: NonNullable<RoutineCandidate["excludedFacts"]>[number][] = [];
  let incoming = input.roster;
  if (national) {
    const counts = new Map<string,number>();
    for (const person of incoming.officeholders) {
      const office = whiteHouseOffice(person.officeTitle);
      if (office) counts.set(office,(counts.get(office) ?? 0)+1);
    }
    const accepted: Officeholder[] = [];
    for (const person of incoming.officeholders) {
      const selected = { ...incoming,officeholders:[person],divisions:incoming.divisions.filter(link=>link.officeholderId === person.id) };
      const office = whiteHouseOffice(person.officeTitle);
      const failures = office && counts.get(office) === 1
        ? await peopleSourceViolations({...input,roster:selected,captures,read:input.acquisitions})
        : ["NATIONAL_OFFICIAL_OFFICE_UNRESOLVED"];
      if (failures.length) nationalExcluded.push({key:person.id,code:"NATIONAL_OFFICIAL_UNVERIFIED",detail:failures.join("; "),record:{officeTitle:person.officeTitle,sourceUrl:person.provenance.sourceUrl}});
      else accepted.push(person);
    }
    const ids = new Set(accepted.map(person=>person.id));
    incoming = { ...incoming,officeholders:accepted,divisions:incoming.divisions.filter(link=>ids.has(link.officeholderId)),unmatched:incoming.unmatched.filter(row=>ids.has(row.officeholderId)) };
  }
  const replacing = new Map(incoming.officeholders.flatMap(person=>{
    const office = whiteHouseOffice(person.officeTitle);
    return office ? [[office,person.id] as const] : [];
  }));
  // A verified holder ends the prior holder's membership in that office, and a verified person now named in another office leaves the old one.
  const nowHolds = new Map(incoming.officeholders.map(person=>[person.id,whiteHouseOffice(person.officeTitle)]));
  const endedMemberships: NonNullable<OfficeholderSet["endedMemberships"]>[number][] = [];
  const priorPeople = national ? held?.officeholders.map(person=>({ ...person,memberships:person.memberships?.map(membership=>{
    const office = whiteHouseOffice(membership.officeTitle);
    const moved = Boolean(office && nowHolds.get(person.id) && nowHolds.get(person.id) !== office);
    if (!office || membership.current === false || !moved && (!replacing.has(office) || replacing.get(office) === person.id)) return membership;
    const ended = { ...membership,current:false };
    endedMemberships.push(ended);
    return ended;
  }) })) ?? [] : [];
  const priorById = new Map(priorPeople.map(person=>[person.id,person]));
  const priorRoster = national && held ? { ...held,officeholders:priorPeople,
    divisions:held.divisions.filter(link=>{
      const person = priorById.get(link.officeholderId);
      if (!person) return false;
      if (link.membershipId) return person.memberships?.find(membership=>membership.id === link.membershipId)?.current !== false;
      const office = whiteHouseOffice(person.officeTitle);
      return !office || !replacing.has(office) || replacing.get(office) === person.id;
    }),endedMemberships:[...(held.endedMemberships ?? []),...endedMemberships] } : held;
  // A reread page's newer read replaces its earlier statement that a seat is empty.
  const carriedPrior = priorRoster ? { ...priorRoster, vacancies: (priorRoster.vacancies ?? []).filter(row=>!reread.has(row.sourceUrl)) } : null;
  let roster = mergePeopleSets([...(carriedPrior ? [carriedPrior] : []),incoming])!;
  if (national) {
    roster = { ...roster, officeholders: roster.officeholders.map(withExecutiveCompleteness) };
    const referenced = new Set(roster.officeholders.flatMap(person=>[person.provenance,...Object.values(person.fieldSources ?? {})])
      .map(source=>`${source.sourceUrl}|${source.collectedAt}`));
    for (const person of roster.officeholders) for (const key of executiveEvidenceReferences(person.executive)) referenced.add(key);
    const fresh = new Set(read.map(row=>`${row.finalUrl}|${row.retrievedAt}`));
    captures = captures.filter(row=>referenced.has(`${row.finalUrl}|${row.retrievedAt}`) || fresh.has(`${row.finalUrl}|${row.retrievedAt}`));
  }
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
  const violations = await peopleSourceViolations({state:input.state,sourceId:input.sourceId,roster,captures,read:input.acquisitions,vault:input.vault,verifyNationalCurrent:!national});
  if (national && !roster.officeholders.length) violations.push("NATIONAL_OFFICIAL_NONE_VERIFIED");
  roster = await publishRosterOfficePoints(roster, held, input.resolveOfficePoint);
  const candidate = peopleSourceCandidate({...input,roster,captures,violations,changes:rosterChanges(held,roster),excludedFacts:[...(input.excludedFacts ?? []),...nationalExcluded,...comparisonFacts]});
  const state = input.state.replace(/^US-/i, "").toLowerCase();
  const contractId = input.contractId ?? (input.sourceId === "people-portraits"
    ? `people-portraits-${state}`
    : `people-${input.sourceId}-${state}`);
  const outcome = await processRegisteredRoutineCandidate(input.store,contractId,candidate,input.now,prior.kind === "PROMOTED" ? prior.metadata.versionId : null,{confirmUnchanged:input.confirmUnchanged});
  return {candidate,outcome};
}
