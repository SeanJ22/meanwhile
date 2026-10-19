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
import { mergePeopleSets } from "../officials/merge-people.ts";
import { readCuratedReaderProjection, type CampaignSiteProjectionRecord } from "../civic-data/curated-reader-read-model.ts";
import { EVERYDAY_ROUTING_POINTER, readEverydayRoutingProjection } from "../routing/everyday-data-plane.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
import { readNationalPresident } from "./national.ts";
import type { MemberOfficeRecord } from "../officials/member-offices.ts";

export interface ReaderStatePackage {
  readonly state: string;
  readonly registryRead: CivicDataReadResult<RegistryRuntimeReadModel>;
  readonly federalRead: CivicDataReadResult<FederalDirectoryReadModel>;
  readonly peopleRead: CivicDataReadResult<OfficialStateLegislatorReadModel>;
  readonly everyday: CivicDataReadResult<EverydayRoutingProjection>;
  readonly districts: Slice<GeographySlice>;
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

async function loadState(state: string): Promise<ReaderStatePackage> {
  const jurisdiction = `US-${state}` as const;
  const presidentRead = readNationalPresident().catch(() => null);
  const canonical = await readCanonicalShelf([
    { recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state) },
    { recordClass: "FEDERAL_DIRECTORY", scope: federalDirectoryScope(state) },
    { recordClass: "STATE_LEGISLATOR", scope: jurisdiction },
    { recordClass: "CURATED_READER_RECORD", scope: "US:verified-officeholder-campaign-sites" },
    { recordClass: "CURATED_READER_RECORD", scope: "US:state-legislator-member-offices" },
    EVERYDAY_ROUTING_POINTER,
    { recordClass: "STATE_LEGISLATOR", scope: `${jurisdiction}:openstates-people:v1` },
    ...PEOPLE_SOURCE_IDS.map(source => ({ recordClass: peopleSourceRecordClass(source), scope: peopleSourceScope(jurisdiction, source) })),
  ], readerDatabaseQuery(), stateContainersStatement(state)), options = { store: canonical };
  const geoVersion = canonical.additionalRows[0]?.version_id;
  const districts: Slice<GeographySlice> = typeof geoVersion === "string"
    ? { kind: "HELD", versionId: geoVersion, value: geographyOfRows(canonical.additionalRows, true) }
    : { kind: "NOT_PUBLISHED" };
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
  const authoritativeKeys = new Set(authoritative?.officeholders.flatMap(holder => [...personIdentityKeys(holder)]) ?? []);
  const matching = authoritative && roster ? roster.officeholders.filter(holder => [...personIdentityKeys(holder)].some(key => authoritativeKeys.has(key))) : [];
  const matchingIds = new Set(matching.map(holder => holder.id));
  const legislativePeople = authoritative ? mergePeopleSets([authoritative, ...(roster ? [{ ...roster, officeholders: matching, divisions: roster.divisions.filter(link => matchingIds.has(link.officeholderId)) }] : [])]) : roster;
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
    districts.kind === "HELD" ? districts.versionId : districts.kind, JSON.stringify(president)].join("|")).digest("hex");
  return {
    state, version, districts,
    registryRead: runtime, peopleRead: people, everyday,
    federalRead: directory ? { kind: "BOOTSTRAP", value: directory, metadata: federal.metadata, detail: "The state's current delegation, loaded with its offices and contact details." } : federal,
    registry: runtime.value, people: roster, legislativePeople,
    stateLegislatorAuthority: stateLegislatorCoverageAuthority(`US-${state}`, people),
    federal: directory, president, memberOffices, boundaryUrl: BOUNDARY_ARCHIVE_FALLBACK,
  };
}

/** Coalesce concurrent reads; an edge miss always sees the current published state. */
export function readStatePackage(value: string): Promise<ReaderStatePackage> {
  const state = requireRegistryState(value.replace(/^US-/i, ""));
  let read = states.get(state);
  if (!read) {
    read = loadState(state).finally(() => { if (states.get(state) === read) states.delete(state); });
    states.set(state, read);
  }
  return read;
}
