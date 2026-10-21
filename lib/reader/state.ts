import { stateContainersStatement, geographyOfRows, type Slice, type GeographySlice } from "../control-plane/admin-view/promoted-slices.ts";
import { readerDatabaseQuery } from "./database.ts";
import { createHash } from "node:crypto";
import { readPromotedCivicData, CivicDataStoreUnavailableError, type CivicDataReadResult } from "../civic-data/read-model.ts";
import { requireRegistryState, stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { registryRuntimeProjectionIssues } from "../registry/runtime-data-plane.ts";
import { readStatePeopleProjection, readOfficialStateLegislatorsProjection } from "../state-rollcalls/legislators.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import type { FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import { readStateFederalDirectory, withFederalPortraits } from "../officials/federal-directory-read-model.ts";
import { stateLegislatorCoverageAuthority, type StateLegislatorCoverageAuthority } from "../registry/coverage.ts";
import { BOUNDARY_ARCHIVE_FALLBACK } from "../map/districts.ts";
import { serverReaderValue } from "./memory.ts";
import { readCanonicalShelf } from "./canonical.ts";
import { PEOPLE_SOURCE_IDS, peopleSourceRecordClass, peopleSourceScope } from "../officials/people-sources.ts";
import { federalDirectoryScope } from "../officials/federal-directory-data-plane.ts";
import { officialStateLegislatorTargetByScope } from "../state-rollcalls/authority.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";
import { statePeopleWithLegislativeAuthority } from "./state-people.ts";
import { readCuratedReaderProjection, type CampaignSiteProjectionRecord } from "../civic-data/curated-reader-read-model.ts";
import { EVERYDAY_ROUTING_POINTER, readEverydayRoutingProjection } from "../routing/everyday-data-plane.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
import { readNationalPresident } from "./national.ts";
import type { MemberOfficeRecord } from "../officials/member-offices.ts";
import type { Division } from "../registry/types.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { primeReaderCanonicalStore } from "./canonical-context.ts";

export interface ReaderStatePackage {
  readonly state: string;
  readonly registryRead: CivicDataReadResult<RegistryRuntimeReadModel>;
  readonly federalRead: CivicDataReadResult<FederalDirectoryReadModel>;
  readonly peopleRead: CivicDataReadResult<OfficialStateLegislatorReadModel>;
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

const states = serverReaderValue("state-reads", () => new Map<string, Promise<ReaderStatePackage>>());
const districtReads = serverReaderValue("district-reads", () => new Map<string, Promise<Slice<GeographySlice>>>());
const requests = serverReaderValue("state-requests", () => new WeakMap<object, Map<string, Promise<ReaderStatePackage>>>());
const districtCanonical = serverReaderValue("state-district-canonical", () => new WeakMap<ReaderStatePackage, Awaited<ReturnType<typeof readCanonicalShelf>>>());

/** The ZIP's district pointers travelled with its state and keep the same canonical proof. */
export function primeStateDistrictPointers(state: ReaderStatePackage): Promise<void> {
  const canonical = districtCanonical.get(state);
  return canonical ? primeReaderCanonicalStore(canonical.additionalEntries, canonical) : Promise.resolve();
}

/** Ballot and its streamed cards share the geography from the state's one query. */
export function readStateDistricts(value: string): Promise<Slice<GeographySlice>> {
  const state = requireRegistryState(value.replace(/^US-/i, ""));
  const pending = readStatePackage(state);
  void pending.catch(() => {});
  const active = [...states].find(([, read]) => read === pending)?.[0];
  const districts = active ? districtReads.get(active) : undefined;
  return districts ?? pending.then(value => value.districts);
}

async function loadState(state: string, divisionIds: readonly string[], zip: string | undefined, key: string): Promise<ReaderStatePackage> {
  const jurisdiction = `US-${state}` as const;
  const presidentRead = readNationalPresident().catch(() => null);
  const canonicalRead = readCanonicalShelf([
    { recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state) },
    { recordClass: "FEDERAL_DIRECTORY", scope: federalDirectoryScope(state) },
    { recordClass: "STATE_LEGISLATOR", scope: jurisdiction },
    { recordClass: "CURATED_READER_RECORD", scope: "US:verified-officeholder-campaign-sites" },
    { recordClass: "CURATED_READER_RECORD", scope: "US:state-legislator-member-offices" },
    EVERYDAY_ROUTING_POINTER,
    { recordClass: "STATE_LEGISLATOR", scope: `${jurisdiction}:openstates-people:v1` },
    ...PEOPLE_SOURCE_IDS.map(source => ({ recordClass: peopleSourceRecordClass(source), scope: peopleSourceScope(jurisdiction, source) })),
  ], readerDatabaseQuery(), stateContainersStatement(state, divisionIds, zip));
  const districtsRead = canonicalRead.then((canonical): Slice<GeographySlice> => {
    const geoVersion = canonical.additionalRows[0]?.version_id;
    return typeof geoVersion === "string"
      ? { kind: "HELD", versionId: geoVersion, value: geographyOfRows(canonical.additionalRows[0].geography as readonly import("../control-plane/admin-view/promoted-slices.ts").Row[], true) }
      : { kind: "NOT_PUBLISHED" };
  });
  if (!divisionIds.length) districtReads.set(key, districtsRead);
  void districtsRead.catch(() => {});
  const canonical = await canonicalRead, options = { store: canonical }, districts = await districtsRead;
  const localDivisions = (canonical.additionalRows[0]?.local_divisions ?? []) as readonly Division[];
  const target = officialStateLegislatorTargetByScope(jurisdiction);
  const [runtime, people, federal, official, campaigns, everyday, president, offices] = await Promise.all([
    readPromotedCivicData<RegistryRuntimeReadModel>("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state), options),
    readStatePeopleProjection(`US-${state}`, options),
    readStateFederalDirectory(state, options),
    target ? readOfficialStateLegislatorsProjection(target.jurisdiction, options) : Promise.resolve(null),
    readCuratedReaderProjection("campaign-sites", options),
    readEverydayRoutingProjection(options),
    presidentRead,
    readCuratedReaderProjection("member-offices", options),
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
  const memberOffices = offices.kind === "PROMOTED" || offices.kind === "BOOTSTRAP" ? offices.value.records as unknown as MemberOfficeRecord[] : [];
  const version = createHash("sha256").update([runtime.metadata.versionId, people.metadata.versionId, federal.metadata.versionId, campaigns.metadata.versionId, offices.metadata.versionId,
    districts.kind === "HELD" ? districts.versionId : districts.kind, JSON.stringify(president), JSON.stringify(localDivisions)].join("|")).digest("hex");
  const result: ReaderStatePackage = {
    state, version, districts, localDivisions,
    registryRead: runtime, peopleRead: people, everyday,
    federalRead: directory ? { kind: "BOOTSTRAP", value: directory, metadata: federal.metadata, detail: "The state's current delegation, loaded with its offices and contact details." } : federal,
    registry: runtime.value, people: roster, legislativePeople,
    stateLegislatorAuthority: stateLegislatorCoverageAuthority(`US-${state}`, people),
    federal: directory, president, memberOffices, boundaryUrl: BOUNDARY_ARCHIVE_FALLBACK,
  };
  if (zip) districtCanonical.set(result, canonical);
  return result;
}

/** Reuse one state's read within a request; other requests share only work still in progress. */
export function readStatePackage(value: string, divisionIds: readonly string[] = [], zip?: string): Promise<ReaderStatePackage> {
  const state = requireRegistryState(value.replace(/^US-/i, ""));
  const divisions = [...new Set(divisionIds)].sort();
  const base = `${state}|${divisions.join("|")}`, key = zip ? `${base}|zip:${zip}` : base;
  const selection = currentReaderSelection();
  let request = selection ? requests.get(selection) : undefined;
  if (selection && !request) { request = new Map(); requests.set(selection, request); }
  const held = request?.get(key);
  if (held) return held;
  let read = states.get(key);
  if (!read) {
    read = loadState(state, divisions, zip, key).finally(() => {
      if (states.get(key) === read) {
        states.delete(key);
        if (!divisions.length) districtReads.delete(key);
      }
    });
    states.set(key, read);
  }
  request?.set(key, read);
  if (zip && !request?.has(base)) request?.set(base, read);
  return read;
}
