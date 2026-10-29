import {statePageId} from "./page-authorities.ts";
import {selectedMemberOfficeSlice} from "./member-offices.ts";
import type {MemberOfficeSlice} from "../officials/member-office-data.ts";
import {stateBallotScope} from "../civic-data/state-scopes.ts";
import {memberContextPointers,zipSourcePointers} from "./place-builder.ts";
import { readMemberOfficeStateProjection } from "../civic-data/curated-reader-read-model.ts";
import {selectedStateEntry} from "./selected-entry.ts";
import {FIPS_TO_STATE} from "../ocd/fips.ts";
import { geographyOfRows, type Slice, type GeographySlice } from "../control-plane/admin-view/promoted-slices.ts";
import { readerDatabaseQuery } from "./database.ts";
import { createHash } from "node:crypto";
import { readPromotedCivicData, CivicDataStoreUnavailableError, type CivicDataReadResult, type CivicDataReadStore, type PromotedEdgeEntry,type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { requireRegistryState, stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { registryRuntimeProjectionIssues } from "../registry/runtime-issues.ts";
import { readStatePeopleProjection, readOfficialStateLegislatorsProjection } from "../state-rollcalls/legislators.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import type { FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import { readStateFederalDirectory, withFederalPortraits } from "../officials/federal-directory-read-model.ts";
import { stateLegislatorCoverageAuthority, type StateLegislatorCoverageAuthority } from "../registry/coverage.ts";
import { BOUNDARY_ARCHIVE_FALLBACK } from "../map/districts.ts";
import { serverReaderValue } from "./memory.ts";
import { readCanonicalShelf, readCanonicalPackages } from "./canonical.ts";
import { PEOPLE_SOURCE_IDS, peopleSourceRecordClass, peopleSourceScope } from "../officials/people-sources.ts";
import { federalDirectoryScope } from "../officials/federal-directory-data-plane.ts";
import { officialStateLegislatorTargetByScope } from "../state-rollcalls/authority.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";
import { statePeopleWithLegislativeAuthority } from "./state-people.ts";
import { readCuratedReaderProjection, type CampaignSiteProjectionRecord } from "../civic-data/curated-reader-read-model.ts";
import { EVERYDAY_ROUTING_POINTER, readEverydayRoutingProjection } from "../routing/everyday-data-plane.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
import { readNationalPresident, nationalPresidentPointers } from "./national.ts";
import { readZipPlace } from "../place-map/reader.ts";
import type { MemberOfficeRecord } from "../officials/member-offices.ts";
import type { Division } from "../registry/types.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { primeReaderCanonicalStore } from "./canonical-context.ts";
import { readCandidateProfilesProjection } from "../civic-data/manual-read-models.ts";
import type { CandidateProfilesProjection } from "../civic-data/manual-projections.ts";
import { readDerivedCampaignSites, type DerivedCampaignSitesProjection } from "../civic-data/derived-campaign-sites.ts";
import { stateAuthorityPointers } from "../civic-data/state-reader.ts";
import { readGenericBallotProjection, type GenericBallotProjection } from "../ballot/generic-projection.ts";

export interface ReaderStatePackage {
  readonly state: string;
  readonly registryRead: CivicDataReadResult<RegistryRuntimeReadModel>;
  readonly federalRead: CivicDataReadResult<FederalDirectoryReadModel>;
  readonly peopleRead: CivicDataReadResult<OfficialStateLegislatorReadModel>;
  readonly candidateProfilesRead?: CivicDataReadResult<CandidateProfilesProjection>;
  readonly candidatePortraitsRead?: CivicDataReadResult<DerivedCampaignSitesProjection>;
  readonly ballotRead?: CivicDataReadResult<GenericBallotProjection>;
  readonly everyday: CivicDataReadResult<EverydayRoutingProjection>;
  readonly districts: Slice<GeographySlice>;
  readonly localDivisions?: readonly Division[];
  readonly version: string;
  readonly registry: RegistryRuntimeReadModel;
  readonly people: OfficeholderSet | null;
  readonly legislativePeople: OfficeholderSet | null;
  readonly stateLegislatorAuthority: StateLegislatorCoverageAuthority;
  readonly federal: FederalDirectoryReadModel | null;
  readonly president: OfficeholderSet | null;
  readonly memberOffices: readonly MemberOfficeRecord[];
  /** The map requests only the vector tiles visible in its viewport. */
  readonly boundaryUrl: string;
}

type StateAuthorities = Pick<ReaderStatePackage, "registryRead" | "federalRead">;
type StateComposition = {
  authorities: Promise<StateAuthorities>;
  resolveAuthorities: (value: StateAuthorities) => void;
  canonical?: Promise<Awaited<ReturnType<typeof readCanonicalShelf>>>;
  districts?: Promise<Slice<GeographySlice>>;
  selected?: Promise<CivicDataReadStore>;
};
const compositions = serverReaderValue("state-read-compositions", () => new WeakMap<Promise<ReaderStatePackage>, StateComposition>());
const requests = serverReaderValue("state-requests", () => new WeakMap<object, Map<string, Promise<ReaderStatePackage>>>());
const districtCanonical = serverReaderValue("state-district-canonical", () => new WeakMap<ReaderStatePackage, Awaited<ReturnType<typeof readCanonicalShelf>>>());
const selectedCanonical = serverReaderValue("state-selected-canonical", () => new WeakMap<ReaderStatePackage, import("../civic-data/read-model.ts").CivicDataReadStore>());

/** Reserve the ZIP's existing people and directory reads before ballot cards ask for them. */
export function primeStateReaderPointers(state: string, read: Promise<ReaderStatePackage>): Promise<void> {
  return primeReaderCanonicalStore([...zipSourcePointers(state), ...stateAuthorityPointers("ballot-contests", state), {recordClass:"STATE_LEGISLATOR",scope:`US-${state}`}], compositions.get(read)?.selected ?? read.then(value => {
    const canonical = selectedCanonical.get(value);
    if (!canonical) throw new Error("READER_SELECTED_STATE_REQUIRED");
    return canonical;
  }));
}

/** The ZIP's district pointers travelled with its state and keep the same canonical proof. */
export function primeStateDistrictPointers(state: ReaderStatePackage | Promise<ReaderStatePackage>): Promise<void> {
  if (state instanceof Promise) {
    const pending = compositions.get(state)?.canonical;
    return pending ? pending.then(canonical => primeReaderCanonicalStore(canonical.additionalEntries, canonical))
      : state.then(value => primeStateDistrictPointers(value));
  }
  const canonical = districtCanonical.get(state);
  return canonical ? primeReaderCanonicalStore(canonical.additionalEntries, canonical) : Promise.resolve();
}

/** Registry and delegation are usable before the independent member-office slice finishes. */
export function readStateAuthorities(read: Promise<ReaderStatePackage>): Promise<StateAuthorities> {
  return compositions.get(read)?.authorities ?? read.then(value => ({ registryRead: value.registryRead, federalRead: value.federalRead }));
}

/** Ballot and its streamed cards share the state's held geography. */
export function readStateDistricts(value: string): Promise<Slice<GeographySlice>> {
  const state = requireRegistryState(value.replace(/^US-/i, ""));
  const pending = readStatePackage(state);
  void pending.catch(() => {});
  const districts = compositions.get(pending)?.districts;
  return districts ?? pending.then(value => value.districts);
}

function selectedZipStore(state: string, canonical: Awaited<ReturnType<typeof readCanonicalShelf>>): CivicDataReadStore {
  const jurisdiction = `US-${state}`;
  const selectedRow = canonical.additionalRows[0];
  const openStates = zipPeopleEntry(state, selectedRow?.zip_people as Record<string, unknown> | null);
  const registry = selectedStateEntry("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state),
    selectedRow?.zip_registry as Record<string, unknown> | null);
  const selected = new Map<string,PromotedEdgeEntry>();
  for (const row of selectedRow?.zip_context as readonly Record<string, unknown>[] ?? []) {
    const pointer = memberContextPointers.find(pointer => `${pointer.recordClass}:${pointer.scope}` === row.key);
    if (pointer) selected.set(String(row.key), selectedStateEntry(pointer.recordClass, pointer.scope, row));
  }
  for (const pointer of memberContextPointers) if (!selected.has(`${pointer.recordClass}:${pointer.scope}`))
    selected.set(`${pointer.recordClass}:${pointer.scope}`, { kind: "NOT_RECORDED", ...pointer });
  for (const row of selectedRow?.zip_sources as readonly Record<string,unknown>[] ?? []) {
    const key=String(row.key),pointer=zipSourcePointers(state).find(pointer=>`${pointer.recordClass}:${pointer.scope}`===key);
    if(!pointer)throw new Error("READER_SCOPE_NOT_SELECTED");
    selected.set(key,selectedStateEntry(pointer.recordClass,pointer.scope,row));
  }
  for (const pointer of zipSourcePointers(state)) {
    const key=`${pointer.recordClass}:${pointer.scope}`;
    if(!selected.has(key))selected.set(key,{kind:"NOT_RECORDED",...pointer});
  }
  for (const pointer of stateAuthorityPointers("ballot-contests", state)) selected.set(`${pointer.recordClass}:${pointer.scope}`,
    selectedStateEntry(pointer.recordClass, pointer.scope, selectedRow?.zip_ballot as Record<string, unknown> | null));
  selected.set(`STATE_LEGISLATOR:${jurisdiction}:openstates-people:v1`,openStates);
  selected.set(`REGISTRY_RUNTIME_BINDING:${stateRegistryRuntimeScope(state)}`,registry);
  selected.set(`STATE_LEGISLATOR:${jurisdiction}`,selectedStateEntry("STATE_LEGISLATOR",jurisdiction,
    selectedRow?.zip_official as Record<string,unknown>|null));
  return {...canonical,readPromotedEntry:(recordClass:import("../civic-data/types.ts").RoutineRecordClass,scope:string)=>
    selected.has(`${recordClass}:${scope}`) ? Promise.resolve(selected.get(`${recordClass}:${scope}`)!) : canonical.readPromotedEntry!(recordClass,scope)};
}

async function loadState(state: string, divisionIds: readonly string[], zip: string | undefined, composition: StateComposition, ballotOnly: boolean): Promise<ReaderStatePackage> {
  const jurisdiction = `US-${state}` as const;
  let needsPresident = false;
  const presidentRead = zip ? Promise.resolve(null) : readNationalPresident(() => {
    needsPresident = true;
    return groupsRead.then(groups => groups.readGroup(1));
  }).catch(() => null);
  const entries = [
    ...(!zip ? [{ recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: stateRegistryRuntimeScope(state) }] : []),
    ...(!zip ? [{ recordClass: "FEDERAL_DIRECTORY" as const, scope: federalDirectoryScope(state) }] : []),
    ...(!zip ? [{ recordClass: "STATE_LEGISLATOR" as const, scope: jurisdiction }] : []),
    ...(!zip ? [memberContextPointers[0]] : []),
    EVERYDAY_ROUTING_POINTER,
    ...(!zip ? [...stateAuthorityPointers("candidate-profiles", state),
      ...stateAuthorityPointers("candidate-campaign-sites-derived", state), ...stateAuthorityPointers("ballot-contests", state)] : []),
    ...(!zip ? [{ recordClass: "STATE_LEGISLATOR" as const, scope: `${jurisdiction}:openstates-people:v1` }] : []),
    ...(!zip ? PEOPLE_SOURCE_IDS.map(source => ({ recordClass: peopleSourceRecordClass(source), scope: peopleSourceScope(jurisdiction, source) })) : []),
  ];
  const query = readerDatabaseQuery();
  const idsRead = zip && !divisionIds.length ? readZipPlace(zip).then(value=>[...new Set(value?.ids ?? [])].sort()) : Promise.resolve(divisionIds);
  const load = (ids: readonly string[]) => {
    const statement = statePackageStatement(state, ids, zip);
    return readCanonicalPackages([entries, needsPresident ? nationalPresidentPointers() : []], query, statement);
  };
  const groupsRead = Promise.resolve().then(async () => load(await idsRead));
  const canonicalRead = groupsRead.then(groups => groups.readGroup(0));
  composition.canonical = canonicalRead;
  const districtsRead = canonicalRead.then((canonical): Slice<GeographySlice> => {
    const geoVersion = canonical.additionalRows[0]?.version_id;
    return typeof geoVersion === "string"
      ? { kind: "HELD", versionId: geoVersion, value: geographyOfRows(canonical.additionalRows[0].geography as readonly import("../control-plane/admin-view/promoted-slices.ts").Row[], true) }
      : { kind: "NOT_PUBLISHED" };
  });
  composition.districts = districtsRead;
  void districtsRead.catch(() => {});
  const selectedRead = canonicalRead.then(canonical => zip ? selectedZipStore(state, canonical) : canonical);
  if (zip) composition.selected = selectedRead;
  const [canonical, districts, store] = await Promise.all([canonicalRead, districtsRead, selectedRead]);
  const localDivisions = (canonical.additionalRows[0]?.local_divisions ?? []) as readonly Division[];
  const officeStore:CivicDataReadStore&{readMemberOfficeSlice(state:string,members?:readonly string[]):Promise<MemberOfficeSlice|null>}={...store,
    readMemberOfficeSlice:async(_state,members=[])=>selectedMemberOfficeSlice(canonical.additionalRows[0]?.member_offices as MemberOfficeSlice??null,members)};
  const options:PromotedCivicDataReadOptions={store:officeStore};
  const target = officialStateLegislatorTargetByScope(jurisdiction);
  const officialRead = target ? readOfficialStateLegislatorsProjection(target.jurisdiction,options) : Promise.resolve(null);
  const [runtime, people, federal, official, campaigns, everyday, president, profiles, portraits, ballot] = await Promise.all([
    readPromotedCivicData<RegistryRuntimeReadModel>("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state), options),
    readStatePeopleProjection(`US-${state}`, options),
    readStateFederalDirectory(state, options),
    officialRead,
    readCuratedReaderProjection("campaign-sites", options, zip ? "SELECTED" : "ALL"),
    readEverydayRoutingProjection(options),
    presidentRead,
    zip ? Promise.resolve(undefined) : readCandidateProfilesProjection(state, options),
    zip ? Promise.resolve(undefined) : readDerivedCampaignSites(state, options),
    readGenericBallotProjection(state, options),
  ]);
  if (runtime.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(runtime);
  if (runtime.kind !== "PROMOTED" && runtime.kind !== "BOOTSTRAP") throw new Error(`STATE_PACKAGE_NOT_RECORDED:${state}`);
  const issues = registryRuntimeProjectionIssues(runtime.value);
  if (issues.length) throw new Error(`STATE_PACKAGE_INVALID:${state}:${issues.join(",")}`);
  const roster = people.kind === "PROMOTED" || people.kind === "BOOTSTRAP" ? people.value.roster : null;
  const authoritative = official?.kind === "PROMOTED" || official?.kind === "BOOTSTRAP" ? official.value.roster : null;
  const legislativePeople = statePeopleWithLegislativeAuthority(roster, authoritative, runtime.value.statewideExecutives);
  const heldFederal = federal.kind === "PROMOTED" || federal.kind === "BOOTSTRAP" ? federal.value : null;
  const directoryWithPortraits = heldFederal && roster ? { ...heldFederal, roster: withFederalPortraits(heldFederal.roster, roster) } : heldFederal;
  const sites = campaigns.kind === "PROMOTED" || campaigns.kind === "BOOTSTRAP" ? campaigns.value.records as unknown as CampaignSiteProjectionRecord[] : [];
  const campaignsByPerson = new Map(sites.flatMap(row => typeof row.site.url === "string" ? [[row.officeholderId, row.site.url] as const] : []));
  const directory = directoryWithPortraits ? { ...directoryWithPortraits, roster: { ...directoryWithPortraits.roster,
    officeholders: directoryWithPortraits.roster.officeholders.map(holder => ({ ...holder,
      campaignUrl: holder.campaignUrl ?? [...personIdentityKeys(holder)].flatMap(key => campaignsByPerson.get(key) ?? []).at(0) ?? null,
    })),
  } } : null;
  const federalRead = directory ? { kind: "BOOTSTRAP" as const, value: directory, metadata: federal.metadata,
    detail: "The state's current delegation, loaded with its offices and contact details." } : federal;
  composition.resolveAuthorities({ registryRead: runtime, federalRead });
  const officeMembers = [...new Set([...(roster?.officeholders ?? []), ...(authoritative?.officeholders ?? []),
    ...(directory?.roster.officeholders ?? []), ...runtime.value.bodyRosters.flatMap(row => row.members),
    ...runtime.value.statewideExecutives.flatMap(row => row.holder ? [row.holder] : [])].flatMap(holder => [...personIdentityKeys(holder)]))];
  const offices = officeMembers.length ? await readMemberOfficeStateProjection(state, options, officeMembers) : null;
  const memberOffices = offices?.kind === "PROMOTED" || offices?.kind === "BOOTSTRAP" ? offices.value.records as unknown as MemberOfficeRecord[] : [];
  const version = createHash("sha256").update([runtime.metadata.versionId, people.metadata.versionId, federal.metadata.versionId, campaigns.metadata.versionId, offices?.metadata.versionId,
    profiles?.metadata.versionId, portraits?.metadata.versionId, ballot.metadata.versionId,
    districts.kind === "HELD" ? districts.versionId : districts.kind, JSON.stringify(president), JSON.stringify(localDivisions)].join("|")).digest("hex");
  const result: ReaderStatePackage = {
    state, version, districts, localDivisions,
    registryRead: runtime, peopleRead: people, candidateProfilesRead: profiles, candidatePortraitsRead: portraits, ballotRead: ballot, everyday,
    federalRead,
    registry: runtime.value, people: roster, legislativePeople,
    stateLegislatorAuthority: stateLegislatorCoverageAuthority(`US-${state}`, people),
    federal: directory, president, memberOffices, boundaryUrl: BOUNDARY_ARCHIVE_FALLBACK,
  };
  if (zip) {
    districtCanonical.set(result, canonical);
    selectedCanonical.set(result, officeStore);
  }
  return result;
}

/** Compose one state's answer within a request; every independent request checks current rows. */
export function readStatePackage(value: string, divisionIds: readonly string[] = [], zip?: string, options: {readonly earlyDistricts?: true} = {}): Promise<ReaderStatePackage> {
  const state = requireRegistryState(value.replace(/^US-/i, ""));
  const divisions = [...new Set(divisionIds)].sort();
  const base = `${state}|${divisions.join("|")}`, key = zip ? `${base}|zip:${zip}` : base;
  const selection = currentReaderSelection();
  let request = selection ? requests.get(selection) : undefined;
  if (selection && !request) { request = new Map(); requests.set(selection, request); }
  const held = request?.get(key);
  if (held) return held;
  let resolveAuthorities!: (value: StateAuthorities) => void;
  let rejectAuthorities!: (error: unknown) => void;
  const authorities = new Promise<StateAuthorities>((resolve, reject) => { resolveAuthorities = resolve; rejectAuthorities = reject; });
  void authorities.catch(() => {});
  const composition: StateComposition = { authorities, resolveAuthorities };
  const read = loadState(state, divisions, zip, composition, options.earlyDistricts === true);
  void read.catch(rejectAuthorities);
  compositions.set(read, composition);
  request?.set(key, read);
  if (zip && !request?.has(base)) request?.set(base, read);
  return read;
}

/** Geography and selected authorities were composed by the place builder. */
export function statePackageStatement(state:string,divisions:readonly string[]=[],zip?:string) {
  const pageId=zip?`zip:${zip}`:statePageId(state);
  const geo=`coalesce(page.context->'authorityGeographies'->'${state}',page.context->'authorityGeography')`;
  const source=(key:string)=>`page.context->'authorities'->'${key.replaceAll("'","''")}'`;
  const rows=(keys:readonly string[])=>`coalesce((SELECT jsonb_agg(value) FROM jsonb_each(page.context->'authorities') WHERE key=ANY(ARRAY[${keys.map(key=>`'${key.replaceAll("'","''")}'`).join(',')}]::text[])),'[]'::jsonb)`;
  return {pageId,canonicalKeys:true as const,params:[pageId,divisions],text:`SELECT
    ${geo}->>'version_id' AS version_id,
    coalesce(${geo}->'geography','[]'::jsonb) AS geography,
    ${zip?`coalesce(${geo}->'local_divisions','[]'::jsonb)`:`coalesce((SELECT jsonb_agg(d.value ORDER BY d.value->>'ocdId') FROM jsonb_array_elements(${geo}->'local_divisions') d(value) WHERE d.value->>'ocdId'=ANY($2::text[])),'[]'::jsonb)`} AS local_divisions,
    ${geo}->'member_offices' AS member_offices,
    ARRAY(SELECT jsonb_array_elements_text(coalesce(${geo}->'canonical_keys','[]'::jsonb))) AS canonical_keys,
    ${source(`STATE_LEGISLATOR:US-${state}:openstates-people:v1`)} AS zip_people,
    ${source(`REGISTRY_RUNTIME_BINDING:${stateRegistryRuntimeScope(state)}`)} AS zip_registry,
    ${source(`STATE_LEGISLATOR:US-${state}`)} AS zip_official,
    ${rows(zipSourcePointers(state).map(row=>`${row.recordClass}:${row.scope}`))} AS zip_sources,
    ${rows(memberContextPointers.map(row=>`${row.recordClass}:${row.scope}`))} AS zip_context,
    ${source(`BALLOT_CANDIDACY:${stateBallotScope('ballot-contests',state)}`)} AS zip_ballot
    FROM place_page page WHERE page.place_id=$1`};
}

export function zipPeopleEntry(state: string, row: Record<string, unknown> | null | undefined): PromotedEdgeEntry {
  return selectedStateEntry("STATE_LEGISLATOR",`US-${requireRegistryState(state)}:openstates-people:v1`,row);
}
