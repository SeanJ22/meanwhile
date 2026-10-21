import {selectedPointerSql,selectedMetadataSql,selectedStateEntry,peopleIdentityKeysSql} from "./selected-entry.ts";
import {FIPS_TO_STATE} from "../ocd/fips.ts";
import { stateContainersStatement, geographyOfRows, type Slice, type GeographySlice } from "../control-plane/admin-view/promoted-slices.ts";
import { readerDatabaseQuery } from "./database.ts";
import { createHash } from "node:crypto";
import { readPromotedCivicData, CivicDataStoreUnavailableError, type CivicDataReadResult, type PromotedEdgeEntry } from "../civic-data/read-model.ts";
import { requireRegistryState, stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { registryRuntimeProjectionIssues } from "../registry/runtime-issues.ts";
import { readStatePeopleProjection, readOfficialStateLegislatorsProjection, NH_COUNTY } from "../state-rollcalls/legislators.ts";
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
import { mergePeopleSets } from "../officials/merge-people.ts";
import { readCuratedReaderProjection, type CampaignSiteProjectionRecord } from "../civic-data/curated-reader-read-model.ts";
import { EVERYDAY_ROUTING_POINTER, readEverydayRoutingProjection } from "../routing/everyday-data-plane.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
import { readNationalPresident, nationalPresidentPointers, readZipPlace } from "./national.ts";
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
const pendingDistrictCanonical = serverReaderValue("state-district-pending", () => new Map<string, Promise<Awaited<ReturnType<typeof readCanonicalShelf>>>>());
const selectedCanonical = serverReaderValue("state-selected-canonical", () => new WeakMap<ReaderStatePackage, import("../civic-data/read-model.ts").CivicDataReadStore>());

/** Reserve the ZIP's existing people and directory reads before ballot cards ask for them. */
export function primeStateReaderPointers(state: string, read: Promise<ReaderStatePackage>): Promise<void> {
  return primeReaderCanonicalStore([...zipSourcePointers(state), {recordClass:"STATE_LEGISLATOR",scope:`US-${state}`}], read.then(value => {
    const canonical = selectedCanonical.get(value);
    if (!canonical) throw new Error("READER_SELECTED_STATE_REQUIRED");
    return canonical;
  }));
}

/** The ZIP's district pointers travelled with its state and keep the same canonical proof. */
export function primeStateDistrictPointers(state: ReaderStatePackage | Promise<ReaderStatePackage>): Promise<void> {
  if (state instanceof Promise) {
    const key = [...states].find(([, read]) => read === state)?.[0];
    const pending = key ? pendingDistrictCanonical.get(key) : undefined;
    return pending ? pending.then(canonical => primeReaderCanonicalStore(canonical.additionalEntries, canonical))
      : state.then(value => primeStateDistrictPointers(value));
  }
  const canonical = districtCanonical.get(state);
  return canonical ? primeReaderCanonicalStore(canonical.additionalEntries, canonical) : Promise.resolve();
}

/** Ballot and its streamed cards share the state's held geography. */
export function readStateDistricts(value: string): Promise<Slice<GeographySlice>> {
  const state = requireRegistryState(value.replace(/^US-/i, ""));
  const pending = readStatePackage(state);
  void pending.catch(() => {});
  const active = [...states].find(([, read]) => read === pending)?.[0];
  const districts = active ? districtReads.get(active) : undefined;
  return districts ?? pending.then(value => value.districts);
}

async function loadState(state: string, divisionIds: readonly string[], zip: string | undefined, key: string, earlyDistricts: boolean): Promise<ReaderStatePackage> {
  const jurisdiction = `US-${state}` as const;
  let needsPresident = false;
  const presidentRead = readNationalPresident(() => {
    needsPresident = true;
    return groupsRead.then(groups => groups.readGroup(1));
  }).catch(() => null);
  const entries = [
    ...(!zip ? [{ recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: stateRegistryRuntimeScope(state) }] : []),
    ...(!zip ? [{ recordClass: "FEDERAL_DIRECTORY" as const, scope: federalDirectoryScope(state) }] : []),
    ...(!zip ? [{ recordClass: "STATE_LEGISLATOR" as const, scope: jurisdiction }] : []),
    { recordClass: "CURATED_READER_RECORD" as const, scope: "US:verified-officeholder-campaign-sites" },
    { recordClass: "CURATED_READER_RECORD" as const, scope: "US:state-legislator-member-offices" },
    EVERYDAY_ROUTING_POINTER,
    ...(!zip ? [{ recordClass: "STATE_LEGISLATOR" as const, scope: `${jurisdiction}:openstates-people:v1` }] : []),
    ...(!zip ? PEOPLE_SOURCE_IDS.map(source => ({ recordClass: peopleSourceRecordClass(source), scope: peopleSourceScope(jurisdiction, source) })) : []),
  ];
  const query = readerDatabaseQuery();
  const idsRead = zip && !divisionIds.length ? readZipPlace(zip).then(value=>value?.ids ?? []) : Promise.resolve(divisionIds);
  const split = earlyDistricts && Boolean(zip);
  const load = (ids: readonly string[]) => readCanonicalPackages([entries, needsPresident ? nationalPresidentPointers() : []],
    query, split ? stateContainersStatement(state, ids, zip) : statePackageStatement(state, ids, zip));
  // The resident President reader requests its group only on a cache miss or refresh.
  const groupsRead = Promise.resolve().then(async () => load(await idsRead));
  const canonicalRead = groupsRead.then(groups => groups.readGroup(0));
  pendingDistrictCanonical.set(key, canonicalRead);
  const selectedRead = split ? canonicalRead.then(async canonical => {
    if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
    const statement = statePackageStatement(state, await idsRead, zip, canonical.additionalRows[0]);
    const [rows] = await query([statement]);
    return rows[0];
  }) : canonicalRead.then(canonical => canonical.additionalRows[0]);
  void selectedRead.catch(() => {});
  const districtsRead = canonicalRead.then((canonical): Slice<GeographySlice> => {
    const geoVersion = canonical.additionalRows[0]?.version_id;
    return typeof geoVersion === "string"
      ? { kind: "HELD", versionId: geoVersion, value: geographyOfRows(canonical.additionalRows[0].geography as readonly import("../control-plane/admin-view/promoted-slices.ts").Row[], true) }
      : { kind: "NOT_PUBLISHED" };
  });
  if (!divisionIds.length) districtReads.set(key, districtsRead);
  void districtsRead.catch(() => {});
  const [canonical, districts, selectedRow] = await Promise.all([canonicalRead, districtsRead, selectedRead]);
  const openStates = zip ? zipPeopleEntry(state, selectedRow?.zip_people as Record<string, unknown> | null) : undefined;
  const registry = zip ? selectedStateEntry("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state),
    selectedRow?.zip_registry as Record<string, unknown> | null) : undefined;
  const localDivisions = (canonical.additionalRows[0]?.local_divisions ?? []) as readonly Division[];
  const selected = new Map<string,PromotedEdgeEntry>();
  if (zip) {
    for (const row of selectedRow?.zip_sources as readonly Record<string,unknown>[] ?? []) {
      const key=String(row.key),pointer=zipSourcePointers(state).find(pointer=>`${pointer.recordClass}:${pointer.scope}`===key);
      if(!pointer)throw new Error("READER_SCOPE_NOT_SELECTED");
      selected.set(key,selectedStateEntry(pointer.recordClass,pointer.scope,row));
    }
    for (const pointer of zipSourcePointers(state)) {
      const key=`${pointer.recordClass}:${pointer.scope}`;
      if(!selected.has(key))selected.set(key,{kind:"NOT_RECORDED",...pointer});
    }
    selected.set(`STATE_LEGISLATOR:${jurisdiction}:openstates-people:v1`,openStates!);
    selected.set(`REGISTRY_RUNTIME_BINDING:${stateRegistryRuntimeScope(state)}`,registry!);
    selected.set(`STATE_LEGISLATOR:${jurisdiction}`,selectedStateEntry("STATE_LEGISLATOR",jurisdiction,
      selectedRow?.zip_official as Record<string,unknown>|null));
  }
  const options = {store:selected.size ? {...canonical,readPromotedEntry:(recordClass:import("../civic-data/types.ts").RoutineRecordClass,scope:string)=>
    selected.has(`${recordClass}:${scope}`) ? Promise.resolve(selected.get(`${recordClass}:${scope}`)!) : canonical.readPromotedEntry!(recordClass,scope)} : canonical};
  const target = officialStateLegislatorTargetByScope(jurisdiction);
  const officialRead = target ? readOfficialStateLegislatorsProjection(target.jurisdiction,options) : Promise.resolve(null);
  const [runtime, people, federal, official, campaigns, everyday, president, offices] = await Promise.all([
    readPromotedCivicData<RegistryRuntimeReadModel>("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state), options),
    readStatePeopleProjection(`US-${state}`, options),
    readStateFederalDirectory(state, options),
    officialRead,
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
    districts.kind === "HELD" ? districts.versionId : districts.kind, JSON.stringify(president), JSON.stringify(localDivisions)].join("|")).digest("hex");
  const result: ReaderStatePackage = {
    state, version, districts, localDivisions,
    registryRead: runtime, peopleRead: people, everyday,
    federalRead: directory ? { kind: "BOOTSTRAP", value: directory, metadata: federal.metadata, detail: "The state's current delegation, loaded with its offices and contact details." } : federal,
    registry: runtime.value, people: roster, legislativePeople,
    stateLegislatorAuthority: stateLegislatorCoverageAuthority(`US-${state}`, people),
    federal: directory, president, memberOffices, boundaryUrl: BOUNDARY_ARCHIVE_FALLBACK,
  };
  if (zip) {
    districtCanonical.set(result, canonical);
    selectedCanonical.set(result, options.store);
  }
  return result;
}

/** Reuse one state's read within a request; other requests share only work still in progress. */
export function readStatePackage(value: string, divisionIds: readonly string[] = [], zip?: string, options: {readonly earlyDistricts?: true} = {}): Promise<ReaderStatePackage> {
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
    read = loadState(state, divisions, zip, key, options.earlyDistricts === true).finally(() => {
      if (states.get(key) === read) {
        states.delete(key);
        pendingDistrictCanonical.delete(key);
        if (!divisions.length) districtReads.delete(key);
      }
    });
    states.set(key, read);
  }
  request?.set(key, read);
  if (zip && !request?.has(base)) request?.set(base, read);
  return read;
}

/** Select people against either this query's geography or its already held exact snapshot. */
export function statePackageStatement(state: string, divisions: readonly string[] = [], zip?: string, heldGeography?: Record<string, unknown>) {
  const geography = heldGeography ? {text:"SELECT $1::text AS version_id,$2::jsonb AS geography,$3::jsonb AS local_divisions,$4::text[] AS canonical_keys",
    params:[heldGeography.version_id,JSON.stringify(heldGeography.geography),JSON.stringify(heldGeography.local_divisions),heldGeography.canonical_keys]} : stateContainersStatement(state, divisions, zip);
  if (!zip) return geography;
  const jurisdiction=Object.values(FIPS_TO_STATE).find(entry=>entry.postal===requireRegistryState(state));
  if(!jurisdiction)throw new Error("READER_JURISDICTION_UNAVAILABLE");
  // ZIP shards name local and legislative divisions; statewide officers govern every ZIP too.
  const places=[...new Set([...divisions,"ocd-division/country:us",`ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.postal.toLowerCase()}`])];
  const parts=[['zip_official',zipOfficialStatement(state,places)],['zip_people',zipPeopleStatement(state,places)],
    ['zip_sources',zipSourcesStatement(state,places)],['zip_registry',zipRegistryStatement(state,places)]] as const;
  const params:unknown[]=[...geography.params];
  const ctes=parts.map(([name,statement])=>{const offset=params.length;params.push(...statement.params);
    return `${name} AS MATERIALIZED (${statement.text.replace(/\$(\d+)/g,(_,index:string)=>`$${Number(index)+offset}`)})`;});
  return {...geography,text:`WITH state_geography AS MATERIALIZED (${geography.text}),${ctes.join(',')}
    SELECT g.*,(SELECT to_jsonb(p) FROM zip_people p) AS zip_people,(SELECT to_jsonb(r) FROM zip_registry r) AS zip_registry,
      (SELECT to_jsonb(o) FROM zip_official o) AS zip_official,(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM zip_sources s) AS zip_sources FROM state_geography g`,params};
}

const selectedDivisionsSql = `SELECT unnest($2::text[]) AS id UNION SELECT substring(unnest(canonical_keys)
  FROM ${"CURATED_READER_RECORD:US:plain-english-translations:".length + 1}) FROM state_geography`;
function zipSourcePointers(state: string) {
  return [{recordClass:"FEDERAL_DIRECTORY" as const,scope:federalDirectoryScope(state)},
    ...PEOPLE_SOURCE_IDS.map(source=>({recordClass:peopleSourceRecordClass(source),scope:peopleSourceScope(`US-${state}`,source)}))];
}

/** Exact identities and name ambiguity stay closed across sources before the ordinary people merge. */
function zipSourcesStatement(state: string,divisions:readonly string[]) {
  return {params:[zipSourcePointers(state).map(pointer=>`${pointer.recordClass}:${pointer.scope}`),divisions],text:`WITH RECURSIVE
    selected_divisions AS MATERIALIZED (${selectedDivisionsSql}),pointer AS MATERIALIZED (${selectedPointerSql.replace('p.key=$1','p.key=ANY($1::text[])')}),
    roots AS MATERIALIZED (SELECT key,reader_payload_node(payload) AS value FROM pointer WHERE published),
    rosters AS MATERIALIZED (SELECT key,reader_payload_node(value->'roster') AS value FROM roots),
    links AS MATERIALIZED (SELECT key,d.ordinal_index,reader_payload_node(d.item) AS value FROM rosters,LATERAL reader_payload_members(value->'divisions') d),
    seed_rosters AS MATERIALIZED (SELECT reader_payload_node(payload->'roster') AS value FROM zip_people UNION ALL SELECT reader_payload_node(payload->'roster') FROM zip_official),
    seeds AS MATERIALIZED (SELECT reader_payload_node(h.item) AS value FROM seed_rosters,LATERAL reader_payload_members(value->'officeholders') h
      UNION ALL SELECT jsonb_build_object('id',i.value->>'officeholderId','personId',i.value->>'officeholderId',
        'name',concat_ws(' ',nullif(m.value->>'givenName',''),nullif(m.value->>'middleName',''),nullif(m.value->>'familyName','')),
        'nativeIds',jsonb_build_object('nh-general-court',jsonb_build_array(i.value->>'officialPersonId')))
        FROM zip_official o,LATERAL reader_payload_members(o.payload->'members') member,LATERAL (SELECT reader_payload_node(member.item) AS value) m,
          LATERAL reader_payload_members(o.payload->'identities') identity,LATERAL (SELECT reader_payload_node(identity.item) AS value) i
        WHERE m.value->>'chamber'=i.value->>'chamber' AND m.value->>'seatNo'=i.value->>'seatNo' AND m.value->>'district'=i.value->>'district'),
    seed_ids AS MATERIALIZED (SELECT unnest(${peopleIdentityKeysSql("value")}) AS id FROM seeds),
    seed_names AS MATERIALIZED (SELECT regexp_replace(lower(normalize(reader_payload_value(value->'name')#>>'{}',NFKD)),'[^a-z0-9]','','g') AS name FROM seeds),
    people AS MATERIALIZED (SELECT r.key,h.ordinal_index,header.value,
      ${peopleIdentityKeysSql("header.value")} AS identities,
      regexp_replace(lower(normalize(reader_payload_value(header.value->'name')#>>'{}',NFKD)),'[^a-z0-9]','','g') AS name
      FROM rosters r,LATERAL reader_payload_members(r.value->'officeholders') h,LATERAL (SELECT reader_payload_node(h.item) AS value) header),
    selected(key,ordinal_index) AS (SELECT p.key,p.ordinal_index FROM people p WHERE identities && ARRAY(SELECT id FROM seed_ids) OR name IN (SELECT name FROM seed_names)
      OR value->>'id' IN (SELECT value->>'officeholderId' FROM links WHERE links.key=p.key AND value->>'ocdId' IN (SELECT id FROM selected_divisions))
      UNION SELECT next.key,next.ordinal_index FROM selected s JOIN people prior ON prior.key=s.key AND prior.ordinal_index=s.ordinal_index
        JOIN people next ON next.identities && prior.identities OR next.name=prior.name),
    chosen AS MATERIALIZED (SELECT p.* FROM people p JOIN selected s USING(key,ordinal_index)),
    identities AS MATERIALIZED (SELECT unnest(identities) AS id FROM chosen)
    SELECT pointer.key,pointer.source_id,pointer.current_version_id,pointer.last_known_good_version_id,pointer.promoted_at,
      (pointer.validation_receipt-'excludedFacts')||jsonb_build_object('excludedFacts','[]'::jsonb) AS validation_receipt,
      pointer.retrieved_at,pointer.confirmation,pointer.published,
      CASE WHEN published THEN reader_payload_value(roots.value-'roster'-'directory')||jsonb_build_object('roster',
        reader_payload_value(rosters.value-'officeholders'-'divisions'-'unmatched'-'disagreements')||jsonb_build_object(
          'officeholders',coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM chosen WHERE chosen.key=pointer.key),'[]'::jsonb),
          'divisions',coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM links WHERE links.key=pointer.key AND value->>'officeholderId' IN (SELECT value->>'id' FROM chosen WHERE chosen.key=pointer.key)),'[]'::jsonb),
          'unmatched',coalesce((SELECT jsonb_agg(reader_payload_value(u.item) ORDER BY u.ordinal_index) FROM reader_payload_members(rosters.value->'unmatched') u WHERE reader_payload_node(u.item)->>'officeholderId' IN (SELECT id FROM identities)),'[]'::jsonb),
          'disagreements',coalesce((SELECT jsonb_agg(reader_payload_value(d.item) ORDER BY d.ordinal_index) FROM reader_payload_members(rosters.value->'disagreements') d WHERE reader_payload_node(d.item)->>'personId' IN (SELECT id FROM identities)),'[]'::jsonb)))
        ||CASE WHEN roots.value ? 'directory' THEN jsonb_build_object('directory',reader_payload_value(reader_payload_node(roots.value->'directory')-'byMember')||jsonb_build_object('byMember',
          coalesce((SELECT jsonb_object_agg(d.key,reader_payload_value(d.value)) FROM jsonb_each(reader_payload_node(reader_payload_node(roots.value->'directory')->'byMember')) d
            WHERE 'congress:'||d.key IN (SELECT value->>'id' FROM chosen WHERE chosen.key=pointer.key)),'{}'::jsonb))) ELSE '{}'::jsonb END
      END AS payload FROM pointer LEFT JOIN roots USING(key) LEFT JOIN rosters USING(key)`};
}

/** Keep the ZIP's governments, statewide officers, and complete records for its people and held rosters. */
function zipRegistryStatement(state: string, divisions: readonly string[]) {
  return {text:`WITH selected_divisions AS MATERIALIZED (${selectedDivisionsSql}),
    pointer AS MATERIALIZED (${selectedPointerSql}),
    root AS MATERIALIZED (SELECT reader_payload_node(payload) AS value FROM pointer WHERE published),
    registry AS MATERIALIZED (SELECT reader_payload_node(value->'registry') AS value FROM root),
    divisions AS MATERIALIZED (
      SELECT d.ordinal_index,reader_payload_node(d.item) AS value FROM registry,LATERAL reader_payload_members(value->'divisions') d
    ), own_divisions AS MATERIALIZED (
      SELECT * FROM divisions WHERE value->>'ocdId' IN (SELECT id FROM selected_divisions)
        OR value->>'canonicalOcdId' IN (SELECT id FROM selected_divisions)
    ), bodies AS MATERIALIZED (
      SELECT b.ordinal_index,reader_payload_node(b.item) AS value FROM registry,LATERAL reader_payload_members(value->'bodies') b
    ), own_bodies AS MATERIALIZED (
      SELECT * FROM bodies WHERE value->>'ocdId' IS NULL OR value->>'ocdId' IN (SELECT value->>'ocdId' FROM own_divisions)
        OR reader_payload_value(value->'alsoServesOcdIds') ?| ARRAY(SELECT value->>'ocdId' FROM own_divisions)
        OR value->>'id' IN (SELECT reader_payload_node(r.item)->>'bodyId' FROM root,LATERAL reader_payload_members(value->'bodyRosters') r)
    ), needed_divisions AS MATERIALIZED (
      SELECT value->>'ocdId' AS id FROM own_divisions UNION SELECT value->>'ocdId' FROM own_bodies
      UNION SELECT jsonb_array_elements_text(coalesce(nullif(reader_payload_value(value->'alsoServesOcdIds'),'null'::jsonb),'[]'::jsonb)) FROM own_bodies
    ), people AS MATERIALIZED (
      SELECT reader_payload_node(h.item) AS value FROM (
        SELECT payload->'roster' AS value FROM zip_people UNION ALL SELECT payload->'roster' FROM zip_official
        UNION ALL SELECT payload->'roster' FROM zip_sources
      ) roster,LATERAL reader_payload_members(roster.value->'officeholders') h
      UNION ALL SELECT reader_payload_node(m.item) FROM root,LATERAL reader_payload_members(root.value->'bodyRosters') r,
        LATERAL reader_payload_members(reader_payload_node(r.item)->'members') m
      UNION ALL SELECT reader_payload_node(e.item)->'holder' FROM root,LATERAL reader_payload_members(root.value->'statewideExecutives') e
    ), identities AS MATERIALIZED (
      SELECT unnest(${peopleIdentityKeysSql("value")}) AS id FROM people
      UNION SELECT reader_payload_node(i.item)->>'officeholderId' FROM zip_official o,LATERAL reader_payload_members(o.payload->'identities') i
    ), candidacies AS MATERIALIZED (
      SELECT c.ordinal_index,reader_payload_node(c.item) AS value FROM root,
        LATERAL reader_payload_members(reader_payload_node(root.value->'officialCandidacies')->'rows') c
      WHERE reader_payload_node(reader_payload_node(c.item)->'holder')->>'id' IN (SELECT id FROM identities)
        OR reader_payload_value(reader_payload_node(reader_payload_node(c.item)->'holder')->'divisions') ?| ARRAY(SELECT id FROM selected_divisions)
    ), photos AS MATERIALIZED (
      SELECT p.ordinal_index,reader_payload_node(p.item) AS value FROM root,
        LATERAL reader_payload_members(reader_payload_node(root.value->'officialPhotos')->'photos') p
      WHERE reader_payload_node(p.item)->>'officeholderId' IN (SELECT id FROM identities UNION SELECT reader_payload_node(value->'holder')->>'id' FROM candidacies)
        OR reader_payload_node(p.item)->>'personId' IN (SELECT id FROM identities)
        OR reader_payload_node(p.item)->>'url' IN (SELECT r.value FROM jsonb_each_text(reader_payload_value(root.value->'rosterPhotos')) r)
    ) SELECT ${selectedMetadataSql}, CASE WHEN published THEN
      reader_payload_value(root.value-'registry'-'officialPhotos'-'officialCandidacies') || jsonb_build_object(
        'officialPhotos',reader_payload_value(reader_payload_node(root.value->'officialPhotos')-'photos') || jsonb_build_object('photos',
          coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM photos),'[]'::jsonb)),
        'officialCandidacies',reader_payload_value(reader_payload_node(root.value->'officialCandidacies')-'rows') || jsonb_build_object('rows',
          coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM candidacies),'[]'::jsonb)),
        'registry',
        reader_payload_value(registry.value-'divisions'-'bodies') || jsonb_build_object(
          'divisions',coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM divisions
            WHERE value->>'ocdId' IN (SELECT id FROM needed_divisions)),'[]'::jsonb),
          'bodies',coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM own_bodies),'[]'::jsonb)))
      END AS payload FROM pointer LEFT JOIN root ON true LEFT JOIN registry ON true`,
    params:[`REGISTRY_RUNTIME_BINDING:${stateRegistryRuntimeScope(state)}`,divisions]};
}

/** The same county ordinal and numeric district encoding as nhReadModel. */
function nhMemberDivisionSql(value: string, counties: string): string {
  const number = `((${value}->>'district')::int)`;
  return `CASE WHEN btrim(${value}->>'district') ~ '^[0-9]+$' AND ${number}>0 THEN
    CASE WHEN ${value}->>'chamber'='S' THEN 'ocd-division/country:us/state:nh/sldu:'||${number}::text
      WHEN array_position(${counties}::text[],btrim(${value}->>'county')) IS NOT NULL THEN 'ocd-division/country:us/state:nh/sldl:'||
        (((array_position(${counties}::text[],btrim(${value}->>'county'))-1)::text||
          CASE WHEN ${number}<10 THEN '0'||${number}::text ELSE ${number}::text END)::int)::text END END`;
}

/** ZIP readers retain the official members attached to their divisions, with every source field. */
function zipOfficialStatement(state: string, divisions: readonly string[]) {
  return {text:`WITH RECURSIVE selected_divisions AS MATERIALIZED (${selectedDivisionsSql}),
    pointer AS MATERIALIZED (${selectedPointerSql}),
    root AS MATERIALIZED (SELECT reader_payload_node(payload) AS value FROM pointer WHERE published),
    roster AS MATERIALIZED (SELECT reader_payload_node(value->'roster') AS value FROM root),
    links AS MATERIALIZED (SELECT d.ordinal_index,reader_payload_node(d.item) AS value FROM roster,LATERAL reader_payload_members(value->'divisions') d),
    all_people AS MATERIALIZED (SELECT h.ordinal_index,header.value,${peopleIdentityKeysSql("header.value")} AS identities,
      regexp_replace(lower(normalize(reader_payload_value(header.value->'name')#>>'{}',NFKD)),'[^a-z0-9]','','g') AS name
      FROM roster,LATERAL reader_payload_members(value->'officeholders') h,LATERAL (SELECT reader_payload_node(h.item) AS value) header),
    selected(ordinal_index) AS (SELECT ordinal_index FROM all_people WHERE value->>'id' IN
      (SELECT value->>'officeholderId' FROM links WHERE value->>'ocdId' IN (SELECT id FROM selected_divisions))
      UNION SELECT next.ordinal_index FROM selected s JOIN all_people prior USING(ordinal_index)
        JOIN all_people next ON next.identities && prior.identities OR next.name=prior.name),
    people AS MATERIALIZED (SELECT p.* FROM all_people p JOIN selected s USING(ordinal_index)),
    all_members AS MATERIALIZED (SELECT m.ordinal_index,reader_payload_node(m.item) AS value,
      regexp_replace(lower(normalize(concat_ws(' ',reader_payload_node(m.item)->>'givenName',nullif(reader_payload_node(m.item)->>'middleName',''),reader_payload_node(m.item)->>'familyName'),NFKD)),'[^a-z0-9]','','g') AS name
      FROM root,LATERAL reader_payload_members(root.value->'members') m),
    members AS MATERIALIZED (SELECT * FROM all_members WHERE name IN (SELECT name FROM all_members WHERE ${nhMemberDivisionSql("value","$3")} IN (SELECT id FROM selected_divisions))),
    identities AS MATERIALIZED (SELECT i.ordinal_index,reader_payload_node(i.item) AS value FROM root,LATERAL reader_payload_members(root.value->'identities') i
      WHERE EXISTS (SELECT 1 FROM members m WHERE m.value->>'chamber'=reader_payload_node(i.item)->>'chamber'
        AND m.value->>'seatNo'=reader_payload_node(i.item)->>'seatNo' AND m.value->>'district'=reader_payload_node(i.item)->>'district'))
    SELECT ${selectedMetadataSql}, CASE WHEN published THEN CASE WHEN root.value ? 'members' THEN
      reader_payload_value(root.value-'members'-'identities') || jsonb_build_object(
        'members',coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM members),'[]'::jsonb),
        'identities',coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM identities),'[]'::jsonb))
    ELSE reader_payload_value(root.value-'roster') || jsonb_build_object('roster',
      reader_payload_value(roster.value-'officeholders'-'divisions'-'unmatched') || jsonb_build_object(
        'officeholders',coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM people),'[]'::jsonb),
        'divisions',coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM links WHERE value->>'officeholderId' IN (SELECT value->>'id' FROM people)),'[]'::jsonb),
        'unmatched',coalesce((SELECT jsonb_agg(reader_payload_value(u.item) ORDER BY u.ordinal_index) FROM reader_payload_members(roster.value->'unmatched') u
          WHERE reader_payload_node(u.item)->>'officeholderId' IN (SELECT value->>'id' FROM people)),'[]'::jsonb))) END
    END AS payload FROM pointer LEFT JOIN root ON true LEFT JOIN roster ON true`,
    params:[`STATE_LEGISLATOR:US-${requireRegistryState(state)}`,divisions,Object.keys(NH_COUNTY)]};
}

/** Keep exact aliases and every same-name candidate before the ordinary identity merge. */
function zipPeopleStatement(state: string, divisions: readonly string[]) {
  const stateCode = requireRegistryState(state);
  return {text:`WITH RECURSIVE selected_divisions AS MATERIALIZED (${selectedDivisionsSql}), official_root AS MATERIALIZED (
    SELECT reader_payload_node(payload) AS value FROM zip_official WHERE published
  ), official_roster AS MATERIALIZED (
    SELECT reader_payload_node(value->'roster') AS value FROM official_root
  ), official_people AS MATERIALIZED (
    SELECT reader_payload_node(h.item) AS value FROM official_roster,LATERAL reader_payload_members(value->'officeholders') h
    UNION ALL SELECT jsonb_build_object('id',i.value->>'officeholderId','personId',i.value->>'officeholderId',
      'name',concat_ws(' ',nullif(m.value->>'givenName',''),nullif(m.value->>'middleName',''),nullif(m.value->>'familyName','')),
      'nativeIds',jsonb_build_object('nh-general-court',jsonb_build_array(i.value->>'officialPersonId')))
    FROM official_root,LATERAL reader_payload_members(official_root.value->'members') member,
      LATERAL (SELECT reader_payload_node(member.item) AS value) m,
      LATERAL reader_payload_members(official_root.value->'identities') identity,
      LATERAL (SELECT reader_payload_node(identity.item) AS value) i
    WHERE m.value->>'chamber'=i.value->>'chamber' AND m.value->>'seatNo'=i.value->>'seatNo' AND m.value->>'district'=i.value->>'district'
  ), seed_ids AS MATERIALIZED (SELECT id FROM selected_divisions UNION SELECT unnest(${peopleIdentityKeysSql("value")}) FROM official_people
  ), seed_names AS MATERIALIZED (
    SELECT regexp_replace(lower(normalize(reader_payload_value(value->'name')#>>'{}',NFKD)),'[^a-z0-9]','','g') AS name FROM official_people
  ), pointer AS MATERIALIZED (${selectedPointerSql}), root AS MATERIALIZED (
    SELECT reader_payload_node(payload) AS value FROM pointer WHERE published
  ), roster AS MATERIALIZED (
    SELECT reader_payload_node(value->'roster') AS value FROM root
  ), links AS MATERIALIZED (
    SELECT d.ordinal_index,reader_payload_node(d.item) AS value FROM roster,LATERAL reader_payload_members(value->'divisions') d
  ), people AS MATERIALIZED (
    SELECT h.ordinal_index,header.value,
      ${peopleIdentityKeysSql("header.value")} AS identities,
      regexp_replace(lower(normalize(reader_payload_value(header.value->'name')#>>'{}',NFKD)),'[^a-z0-9]','','g') AS name
    FROM roster,LATERAL reader_payload_members(value->'officeholders') h,
      LATERAL (SELECT reader_payload_node(h.item) AS value) header
  ), selected(ordinal_index) AS (
    SELECT ordinal_index FROM people WHERE identities && ARRAY(SELECT id FROM seed_ids) OR name IN (SELECT name FROM seed_names)
      OR value->>'id' IN (SELECT value->>'officeholderId' FROM links WHERE value->>'ocdId' IN (SELECT id FROM selected_divisions))
    UNION
    SELECT next.ordinal_index FROM selected s JOIN people prior ON prior.ordinal_index=s.ordinal_index
      JOIN people next ON next.identities && prior.identities OR next.name=prior.name
  ), chosen AS MATERIALIZED (
    SELECT p.* FROM people p JOIN selected s USING(ordinal_index)
  ) SELECT ${selectedMetadataSql},
    CASE WHEN published THEN reader_payload_value(root.value-'roster') || jsonb_build_object('roster',
      reader_payload_value(roster.value-'officeholders'-'divisions'-'unmatched'-'endedMemberships') || jsonb_build_object(
        'officeholders',coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM chosen),'[]'::jsonb),
        'divisions',coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM links
          WHERE value->>'officeholderId' IN (SELECT value->>'id' FROM chosen)),'[]'::jsonb),
        'endedMemberships',coalesce((SELECT jsonb_agg(reader_payload_value(e.item) ORDER BY e.ordinal_index) FROM reader_payload_members(roster.value->'endedMemberships') e
          WHERE reader_payload_node(e.item)->>'personId' IS NULL
            OR reader_payload_node(e.item)->>'personId' IN (SELECT unnest(identities) FROM chosen)
            OR reader_payload_node(e.item)->>'divisionId' IN (SELECT id FROM selected_divisions)),'[]'::jsonb),
        'unmatched',coalesce((SELECT jsonb_agg(reader_payload_value(u.item) ORDER BY u.ordinal_index) FROM reader_payload_members(roster.value->'unmatched') u
          WHERE reader_payload_node(u.item)->>'officeholderId' IN (SELECT value->>'id' FROM chosen)),'[]'::jsonb)))
    END AS payload FROM pointer LEFT JOIN root ON true LEFT JOIN roster ON true`,
    params:[`STATE_LEGISLATOR:US-${stateCode}:openstates-people:v1`,divisions]};
}

export function zipPeopleEntry(state: string, row: Record<string, unknown> | null | undefined): PromotedEdgeEntry {
  return selectedStateEntry("STATE_LEGISLATOR",`US-${requireRegistryState(state)}:openstates-people:v1`,row);
}
