import { registryJurisdictions, requireRegistryState, stateRegistryRuntimeContractId,stateRegistryRuntimeScope } from "./state-scopes.ts";
/** A one-person profile is never a complete roster, so a partial roster reading never departs anyone. */
import type { RoutineDataStore } from "./store.ts";
import type { OfficialLinkingPage } from "./source-authority.ts";
import type { Body, Division, SourceDataset } from "../registry/types.ts";
import { bodiesFor } from "../registry/derive.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate, acceptedRegistryPrior,copyRegistryRuntimePrior,type RegistryRuntimePrior } from "../registry/runtime-data-plane.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import { recordRoutineReaderProjectionReadback } from "./reader-verification.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { captureProblem, registryEdition, section3SourceReceipt } from "./worker-publication-evidence.ts";
import { type WorkerPublicationCapture } from "./worker-roster-publication.ts";
import type { Clocks, FactDb, Query } from "../facts/publish.ts";
import { publishRosterFacts } from "../facts/roster-facts.ts";
import { rosterMemberId } from "../facts/roster-read.ts";
import { section3Page, section3Record, valueOnPage } from "../control-plane/promotion/section3.ts";
import type { StatewideExecutive } from "../officials/statewide-executives.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import { createHash } from "node:crypto";
import { storeVerifiedPortrait, type PortraitRuntime } from "../photos/store.ts";
import type { PortraitSources } from "../photos/evidence.ts";
import { isOfficialSource } from "./source-authority.ts";
import { DEFAULT_KINDS, registeredKind, type KindTable } from "../registry/kinds.ts";

export interface NationalDivisionInput {
  readonly id: string;
  readonly label: string;
  readonly divisionType: string;
  readonly geoid: string | null;
  readonly sourceUrl: string;
  readonly sourceDataset: SourceDataset;
  readonly lsad?: string | null;
  readonly funcstat?: string | null;
  readonly classfp?: string | null;
}

export interface NationalOfficialInput {
  readonly discoveryId: string;
  readonly divisionId: string;
  readonly name: string;
  readonly officeTitle: string;
  readonly officialUrl: string;
  readonly document: { readonly url: string; readonly capture?: WorkerPublicationCapture };
  readonly linkingPage?: OfficialLinkingPage | null;
  readonly portrait?: Omit<PortraitSources,"subject">;
}

interface NationalPlacePublicationInput {
  readonly store: RoutineDataStore;
  readonly state: string;
  readonly facts: FactDb & { readonly query: Query };
  readonly clocks: Clocks;
  readonly now: string;
  readonly divisions: readonly NationalDivisionInput[];
  readonly geographyCaptures: readonly WorkerPublicationCapture[];
  readonly sources: { readonly officials: readonly NationalOfficialInput[] };
  readonly portraitRuntime?: PortraitRuntime;
  readonly kinds?: KindTable;
}

export interface NationalPlacePublication {
  readonly candidateId: string | null;
  readonly promotedVersionId: string | null;
  readonly divisions: readonly string[];
  readonly bodies: readonly string[];
  readonly members: readonly { readonly bodyId: string; readonly versionId: string; readonly discoveryIds: readonly string[] }[];
  readonly gaps: readonly { readonly key: string; readonly detail: string }[];
}

const DIVISION_TYPES: Readonly<Record<string, Division["divisionType"]>> = {
  place: "place", county: "county", school: "school_district", school_district: "school_district", cd: "cd", sldu: "sldu", sldl: "sldl",
  cousub: "place", county_subdivision: "place",
};
const SCOPE_DIVISIONS = new Set(["country", "state"]);
const GOVERNING_FUNCSTAT = new Set(["A", "B", "C", "G"]);
const LEGISLATIVE = new Set<Division["divisionType"]>(["cd", "sldu", "sldl"]);
const STATE_DIVISION = /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/;

function statewideRow(official: NationalOfficialInput, capture: WorkerPublicationCapture, now: string, stateLabel: string | null): StatewideExecutive | string {
  const page = { url: capture.evidence.canonicalUrl, text: capture.evidence.text, retrievedAt: capture.observedAt, linkingPage: official.linkingPage ?? null };
  const verdict = section3Record({ recordClass: "OFFICIAL_ROSTER", fields: { name: official.name, office: official.officeTitle }, page, now });
  if (!verdict.live) return verdict.reason ?? "STATEWIDE_OFFICIAL_UNVERIFIED";
  // The right place: the page names the state it serves.
  if (stateLabel && !valueOnPage(stateLabel, capture.evidence.text)) return "STATEWIDE_PAGE_NOT_THIS_STATE";
  const state = official.divisionId.slice(-2);
  return { stateOcdId: official.divisionId,
    holder: { id: `statewide:${state}/${createHash("sha256").update(`${capture.evidence.canonicalUrl}\n${official.discoveryId}\n${official.name}`).digest("hex").slice(0,24)}`, name: official.name, officeTitle: official.officeTitle, partyLabel: null,
      websiteUrl: capture.evidence.canonicalUrl, email: null, phone: null, contactFormUrl: null, photoUrl: null, campaignUrl: null, termEnd: null, birthDate: null },
    sourceUrl: capture.evidence.canonicalUrl, sourceOrg: capture.evidence.sourceId,
    partyAbsence: "The officeholder's own page does not state a party; no election filing has been read for it yet.",
    collectedAt: capture.observedAt.slice(0, 10), verification: "PAGE_FETCHED" } as StatewideExecutive;
}

export function nationalBodyId(division: Pick<Division, "ocdId" | "divisionType">): string {
  if (LEGISLATIVE.has(division.divisionType)) throw Error("LEGISLATIVE_MEMBERS_USE_STATE_LEGISLATOR_AUTHORITY");
  return `${division.ocdId}#${division.divisionType === "school_district" ? "board" : "governing"}`;
}

function divisionRow(input: NationalDivisionInput, captures: readonly WorkerPublicationCapture[], now: string, kinds: KindTable): Division | string | null {
  if (SCOPE_DIVISIONS.has(input.divisionType)) return null;
  // A statistical or fictitious subdivision is not a government; Census has said so, and the place layer holds the one that is.
  if (["cousub", "county_subdivision"].includes(input.divisionType) && !GOVERNING_FUNCSTAT.has((input.funcstat ?? "").toUpperCase())) return null;
  const divisionType = registeredKind(kinds, "division", DIVISION_TYPES[input.divisionType] ?? input.divisionType);
  if (!divisionType) return `DIVISION_TYPE_NOT_A_REGISTRY_DIVISION:${input.divisionType}`;
  const tier = kinds.division.find(row => row.key === divisionType)?.tier;
  if (!tier) return `DIVISION_TIER_NOT_REGISTERED:${input.divisionType}`;
  const state = /\/state:([a-z]{2})\b/.exec(input.id)?.[1]?.toUpperCase();
  if (!state) return "DIVISION_STATE_UNRESOLVED";
  const capture = captures.find(c => c.evidence.canonicalUrl === input.sourceUrl);
  if (!capture) return `DIVISION_SOURCE_NOT_SAVED:${input.sourceUrl}`;
  if (captureProblem(capture)) return `DIVISION_SOURCE_UNUSABLE:${captureProblem(capture)}`;
  const verdict = section3Page({ url: capture.evidence.canonicalUrl, text: capture.evidence.text, retrievedAt: capture.observedAt }, "CENSUS_GEOGRAPHY", now);
  if (!verdict.ok) return verdict.reason!;
  if (!valueOnPage(input.label, capture.evidence.text) || (input.geoid !== null && !capture.evidence.text.includes(input.geoid))) return "DIVISION_NOT_ON_SAVED_SOURCE";
  return { ocdId: input.id, divisionType, tier, state, label: input.label, parentOcdId: input.id.replace(/\/[^/]+$/, ""),
    lsad: input.lsad ?? null, funcstat: input.funcstat ?? null, classfp: input.classfp ?? null, geoid: input.geoid,
    canonicalOcdId: input.id, canonicalMatch: "exact", sourceDataset: input.sourceDataset,
    provenance: { sourceUrl: input.sourceUrl, sourceOrg: "U.S. Census Bureau", collectedAt: capture.observedAt, verifiedAt: now } } as Division;
}

async function promote(store: RoutineDataStore, prepared: Parameters<typeof registryRuntimeCandidate>[0], prior: NonNullable<Awaited<ReturnType<typeof readRegistryRuntimePrior>>>, now: string) {
  const candidate = registryRuntimeCandidate(prepared, { prior:copyRegistryRuntimePrior(prior) });
  const published = await processRegisteredManualCandidate(store, prepared.contractId, candidate, now, prior.versionId);
  if (!published.promoted) throw new Error(`NATIONAL_REGISTRY_GATE_HELD:${published.candidate.failureCode ?? ""}:${published.candidate.failureDetail ?? published.candidate.state}`);
  if (!published.confirmed) {
    const readback = published.readerReadback ?? await recordRoutineReaderProjectionReadback(store,
      requiredManualProductionContract(prepared.contractId), published.promoted, now);
    if (readback?.status !== "PASS") throw new Error(`NATIONAL_REGISTRY_READBACK_FAILED:${readback?.detail ?? "missing typed reader receipt"}`);
  }
  return { candidateId: candidate.id, versionId: published.promoted.versionId,
    prior: await acceptedRegistryPrior(store, published) };
}

/** One registered state publisher owns one immutable base; a ZIP worker never receives it. */
class NationalStatePublication {
  private prior:RegistryRuntimePrior|null=null;
  readonly store:RoutineDataStore;
  readonly state:string;
  constructor(store:RoutineDataStore,state:string){this.store=store;this.state=state;}
  accept(prior:RegistryRuntimePrior):RegistryRuntimePrior{this.prior=prior;return copyRegistryRuntimePrior(prior);}
  async read(now:string):Promise<RegistryRuntimePrior>{
    if(this.prior){
      const scope=stateRegistryRuntimeScope(this.state),pointer=await this.store.readPromotionIdentity("REGISTRY_RUNTIME_BINDING",scope);
      if(pointer&&pointer.key===`REGISTRY_RUNTIME_BINDING:${scope}`&&pointer.recordClass==="REGISTRY_RUNTIME_BINDING"&&pointer.scope===scope&&
        pointer.sourceId===requiredManualProductionContract(stateRegistryRuntimeContractId(this.state)).sourceId&&
        pointer.versionId===pointer.lastKnownGoodVersionId&&pointer.versionId===this.prior.versionId)return copyRegistryRuntimePrior(this.prior);
    }
    const prior=await readRegistryRuntimePrior(this.store,now,this.state);
    if(!prior)throw new Error("NATIONAL_REGISTRY_PRIOR_MISSING");
    return this.accept(prior);
  }
  async refresh(now:string):Promise<RegistryRuntimePrior>{this.prior=null;return this.read(now);}
}

export function createNationalPlacePublisher(store:RoutineDataStore,state:string){
  const session=new NationalStatePublication(store,requireRegistryState(state));
  return (input:NationalPlacePublicationInput)=>{
    if(input.store!==store||requireRegistryState(input.state)!==session.state)throw new Error("NATIONAL_PLACE_PUBLISHER_STATE_MISMATCH");
    return publishNationalPlaceWithSession(input,session);
  };
}

export async function publishNationalPlaceSources(input: NationalPlacePublicationInput): Promise<NationalPlacePublication> {
  return publishNationalPlaceWithSession(input,new NationalStatePublication(input.store,requireRegistryState(input.state)));
}

async function publishNationalPlaceWithSession(input:NationalPlacePublicationInput,session:NationalStatePublication):Promise<NationalPlacePublication>{
  const state = requireRegistryState(input.state);
  if (input.divisions.some(row => registryJurisdictions(row.id).some(value => value !== state)) ||
    input.sources.officials.some(row => registryJurisdictions(row.divisionId).some(value => value !== state)))
    throw new Error(`NATIONAL_PLACE_STATE_SCOPE_MISMATCH:${state}`);
  const gaps: { key: string; detail: string }[] = [];
  let prior = await session.read(input.now);
  let candidateId: string | null = null, promotedVersionId: string | null = null;

  const heldDivisions = new Map(prior.payload.registry.divisions.map(d => [d.ocdId, d]));
  const heldBodies = new Set(prior.payload.registry.bodies.map(b => b.id));
  const divisions: Division[] = [], bodies: Body[] = [], used = new Set<string>();
  for (const row of input.divisions) {
    const held = heldDivisions.get(row.id);
    let division = held ?? divisionRow(row, input.geographyCaptures, input.now, input.kinds ?? DEFAULT_KINDS);
    if (division === null) continue;
    if (typeof division === "string") { gaps.push({ key: `division:${row.id}`, detail: division }); continue; }
    if (!heldDivisions.has(row.id)) { divisions.push(division); used.add(row.sourceUrl); }
    const impliedBy = (division: Division) => LEGISLATIVE.has(division.divisionType) ? [] : bodiesFor(division, input.now);
    if (held && impliedBy(held).some(body => !heldBodies.has(body.id))) {
            // Bind a new body to the bytes checked here; held provenance may name an older download.
      division = divisionRow(row, input.geographyCaptures, input.now, input.kinds ?? DEFAULT_KINDS);
      if (division === null) continue;
      if (typeof division === "string") { gaps.push({ key: `division:${row.id}`, detail: division }); continue; }
      if (division.divisionType !== held.divisionType || division.geoid !== held.geoid) {
        gaps.push({ key: `division:${row.id}`, detail: "DIVISION_IDENTITY_CHANGED" }); continue;
      }
    }
    const implied = impliedBy(division);
    for (const body of implied) {
      if (heldBodies.has(body.id)) continue;
      bodies.push({ ...body, provenance: { ...body.provenance, sourceUrl: division.provenance.sourceUrl } });
      used.add(division.provenance.sourceUrl ?? "");
    }
  }
  if (divisions.length || bodies.length) {
    try {
    const captures = input.geographyCaptures.filter(c => used.has(c.evidence.canonicalUrl));
    const sourceReceipt = section3SourceReceipt(captures, input.now, "section3-validator:national-place",
      `${divisions.length} Census division(s) found on their saved Census responses inside the freshness window (§3); ${bodies.length} implied body row(s).`);
    const digest = createHash("sha256").update(canonicalJson({ divisions, bodies: bodies.map(b => b.id) })).digest("hex").slice(0, 16);
    const published = await promote(input.store, { contractId: stateRegistryRuntimeContractId(state), scope: "MEMBERS", version: registryEdition(`national-place:${digest}`), sourceThrough: input.now, sourceReceipt,
      payload: { ...prior.payload, registry: { ...prior.payload.registry, divisions, bodies },
        statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
        officialCandidacies: { ...prior.payload.officialCandidacies, rows: [] } } }, prior, input.now);
    ({ candidateId } = published); promotedVersionId = published.versionId;
    prior = session.accept(published.prior);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/PROMOTION_BASE_CHANGED|READBACK_FAILED/.test(detail)) prior = await session.refresh(input.now);
      for (const division of divisions) gaps.push({ key: `division:${division.ocdId}`, detail });
      for (const body of bodies) gaps.push({ key: `body:${body.id}`, detail });
      divisions.length = 0;
      bodies.length = 0;
    }
  }

  const statewide: { official: NationalOfficialInput; row: StatewideExecutive; capture: WorkerPublicationCapture }[] = [];
  for (const official of input.sources.officials.filter(o => STATE_DIVISION.test(o.divisionId))) {
    const capture = official.document.capture;
    const row = capture && !captureProblem(capture) ? statewideRow(official, capture, input.now, input.divisions.find(d => d.id === official.divisionId)?.label ?? null) : capture ? `OFFICIAL_PAGE_UNUSABLE:${captureProblem(capture)}` : `OFFICIAL_PAGE_NOT_SAVED:${official.document.url}`;
    if (typeof row === "string") gaps.push({ key: `official:${official.discoveryId}`, detail: row });
    else statewide.push({ official, row, capture: capture! });
  }
  const statewideMembers: { bodyId: string; versionId: string; discoveryIds: string[] }[] = [];
    // A holder already live under the same name and title is confirmed, never replaced, keeping its contact, party and photo facts.
  const live = (s: typeof statewide[number]) => prior!.payload.statewideExecutives.find(row => row.holder.id === s.row.holder.id);
  for (const s of statewide.filter(s => live(s)?.holder.name === s.row.holder.name && live(s)?.holder.officeTitle === s.row.holder.officeTitle)) {
    statewideMembers.push({ bodyId: s.row.stateOcdId, versionId: prior.versionId, discoveryIds: [s.official.discoveryId] });
  }
  statewide.splice(0, statewide.length, ...statewide.filter(s => !(live(s)?.holder.name === s.row.holder.name && live(s)?.holder.officeTitle === s.row.holder.officeTitle)));
  if (statewide.length) {
    try {
      const sourceReceipt = section3SourceReceipt(statewide.map(s => s.capture), input.now, "section3-validator:national-statewide",
        `${statewide.length} statewide official(s): name and office found on their own saved official page inside the freshness window (§3).`);
      const digest = createHash("sha256").update(canonicalJson(statewide.map(s => s.row))).digest("hex").slice(0, 16);
      const published = await promote(input.store, { contractId: stateRegistryRuntimeContractId(state), scope: "MEMBERS", version: registryEdition(`national-statewide:${digest}`), sourceThrough: input.now, sourceReceipt,
        departures: statewide.flatMap(s=>prior!.payload.statewideExecutives.filter(old=>old.stateOcdId===s.row.stateOcdId && old.holder.officeTitle===s.row.holder.officeTitle && old.sourceUrl===s.row.sourceUrl && old.holder.id!==s.row.holder.id).map(old=>({bodyId:s.row.stateOcdId,holderId:old.holder.id,replacementHolderId:s.row.holder.id,officeTitle:s.row.holder.officeTitle,sourceUrl:s.row.sourceUrl}))),
        payload: { ...prior.payload, registry: { ...prior.payload.registry, divisions: [], bodies: [] },
          statewideExecutives: statewide.map(s => s.row), officialPhotos: { photos: [] }, rosterPhotos: {},
                    // A new holder of an office keyed by its seat owes its candidacy check again rather than inheriting the last holder's.
          officialCandidacies: { ...prior.payload.officialCandidacies, rows: statewide
            .map(s => ({ holder: { id: s.row.holder.id, name: s.row.holder.name, officeTitle: s.row.holder.officeTitle, divisions: [s.row.stateOcdId],
              authority: "REGISTRY_STATEWIDE_EXECUTIVE" as const, sourceUrl: s.row.sourceUrl }, status: "NOT_CHECKED" as const, candidacy: null, unresolvedCandidacyIds: [],
              reason: "Officeholding verified on the official's own page. Ballot candidacy remains owed; no candidacy or absence is asserted." })) } } }, prior, input.now);
      ({ candidateId } = published); promotedVersionId = published.versionId;
      prior = session.accept(published.prior);
      for (const s of statewide) statewideMembers.push({ bodyId: s.row.stateOcdId, versionId: published.versionId, discoveryIds: [s.official.discoveryId] });
    } catch (error) {
      if (/PROMOTION_BASE_CHANGED|READBACK_FAILED/.test(error instanceof Error ? error.message : String(error)))
        prior = await session.refresh(input.now);
      for (const s of statewide) gaps.push({ key: `official:${s.official.discoveryId}`, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const byBody = new Map<string, NationalOfficialInput[]>();
  const registered = new Map(prior.payload.registry.divisions.map(d => [d.ocdId, d]));
  for (const official of input.sources.officials) {
    if (STATE_DIVISION.test(official.divisionId)) continue;
    const division = registered.get(official.divisionId);
    const capture = official.document.capture;
    if (!division) { gaps.push({ key: `official:${official.discoveryId}`, detail: "OFFICIAL_DIVISION_NOT_REGISTERED" }); continue; }
    if (!capture) { gaps.push({ key: `official:${official.discoveryId}`, detail: `OFFICIAL_PAGE_NOT_SAVED:${official.document.url}` }); continue; }
    if (captureProblem(capture)) { gaps.push({ key: `official:${official.discoveryId}`, detail: `OFFICIAL_PAGE_UNUSABLE:${captureProblem(capture)}` }); continue; }
    if (LEGISLATIVE.has(division.divisionType)) { gaps.push({key:`official:${official.discoveryId}`,detail:"STATE_PEOPLE_SOURCE_REFRESH_OWNS_LEGISLATIVE_MEMBERS"}); continue; }
    const bodyId = nationalBodyId(division);
    if (!prior.payload.registry.bodies.some(b => b.id === bodyId)) { gaps.push({ key: `official:${official.discoveryId}`, detail: `OFFICIAL_BODY_NOT_REGISTERED:${bodyId}` }); continue; }
    byBody.set(bodyId, [...(byBody.get(bodyId) ?? []), official]);
  }
  const members: { bodyId: string; versionId: string; discoveryIds: string[] }[] = [...statewideMembers];
  for (const [bodyId, officials] of byBody) {
    for (const official of officials) {
      const capture = official.document.capture!;
      const recordId = `national:${official.discoveryId}`;
      const body = prior.payload.registry.bodies.find(b => b.id === bodyId)!;
      try {
        const tally = await publishRosterFacts(input.facts, { body: { id: bodyId, name: body.name, state: /\/state:([a-z]{2})/.exec(bodyId)?.[1]?.toUpperCase() ?? null, parentId: body.ocdId },
          capture, members: [{ recordId, fields: { name: official.name, office: official.officeTitle, websiteUrl: official.officialUrl } }], complete: false,
          producedBy: recordId }, input.clocks, new Date(input.now));
        const personId = tally.people.get(recordId);
        if (!personId || tally.live + tally.confirmed + tally.held === 0) throw new Error("OFFICIAL_FACTS_BLANK: the name and office were not confirmed on the saved page");
        members.push({ bodyId, versionId: prior.versionId, discoveryIds: [official.discoveryId] });
        if (official.portrait) {
          try {
            const [shown] = await input.facts.query("SELECT value FROM entity_external_id WHERE entity_id = $1 AND scheme = 'roster-member'", [personId]);
            const holder = { id: rosterMemberId(bodyId, personId, shown?.value as string | undefined), personId, name: official.name, nativeIds: undefined };
            const photo = await storeVerifiedPortrait(holder.personId ?? holder.id, {...official.portrait,subject:{personId:holder.personId ?? holder.id,name:holder.name,nativeIds:holder.nativeIds,profileUrls:[official.document.url,official.officialUrl]}}, input.now, input.portraitRuntime);
            const receipt = section3SourceReceipt(official.portrait.captures,input.now,"section3:portrait",
              "The same named portrait is supported by two saved sources; its permitted use is attributed and its decoded bytes are stored on our origin.");
            const saved = await promote(input.store, {contractId:stateRegistryRuntimeContractId(state),scope:"MEMBERS",
              version:registryEdition(`portrait:${holder.id}:${photo.verification!.imageHash}`),sourceThrough:input.now,
              sourceReceipt:{...receipt,sources:[...receipt.sources.map(s=>({...s,sourceClass:isOfficialSource(s.finalUrl) ? "OFFICIAL_PUBLISHER" as const : "REFERENCE_PUBLISHER" as const})),
                {requestedUrl:photo.sourceUrl,finalUrl:photo.sourceUrl,publisher:new URL(photo.sourceUrl).hostname,
                  sourceClass:"REFERENCE_PUBLISHER",retrievedAt:photo.collectedAt,httpStatus:200,rawHash:photo.verification!.sourceImageHash.slice(7),
                  reviewedEvidence:"Downloaded, checked by the existing image decoder and stored; source identity and permitted use are bound to the saved corroborating pages."}]},
              payload:{...prior!.payload,registry:{...prior!.payload.registry,divisions:[],bodies:[]},statewideExecutives:[],officialCandidacies:{...prior!.payload.officialCandidacies,rows:[]},
                officialPhotos:{photos:[{officeholderId:holder.id,personId:holder.personId ?? holder.id,name:official.name,...photo}]},rosterPhotos:{[holder.id]:photo.url}}},prior!,input.now);
            prior=session.accept(saved.prior);candidateId=saved.candidateId;promotedVersionId=saved.versionId;
          } catch (error) {
            gaps.push({key:`portrait:${official.discoveryId}`,detail:error instanceof Error ? error.message : String(error)});
          }
        }
      } catch (error) {
        if (/PROMOTION_BASE_CHANGED|READBACK_FAILED/.test(error instanceof Error ? error.message : String(error)))
          prior = await session.refresh(input.now);
        gaps.push({ key: `official:${official.discoveryId}`, detail: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { candidateId, promotedVersionId, divisions: divisions.map(d => d.ocdId), bodies: bodies.map(b => b.id), members, gaps };
}

export function nationalDelivery(publications: readonly NationalPlacePublication[]) {
  const last = publications.filter(p => p.promotedVersionId).at(-1) ?? null;
  const versionId = last?.promotedVersionId ?? publications.flatMap(p => p.members).at(-1)?.versionId ?? null;
  return { records: publications.reduce((sum, p) => sum + (p.promotedVersionId
    ? p.members.reduce((n, m) => n + m.discoveryIds.length, 0) : 0), 0),
    versionId, candidateId: versionId, gaps: publications.flatMap(p => p.gaps) };
}
