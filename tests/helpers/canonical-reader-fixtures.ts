import {PEOPLE_SOURCE_IDS,peopleSourceRecordClass,peopleSourceScope} from "../../lib/officials/people-sources.ts";
import { MemoryRoutineDataStore, PostgresRoutineDataStore, type RoutineDataStore } from "../../lib/civic-data/store.ts";
import { clearPromotedReadModelCache, type PromotedEdgeEntry } from "../../lib/civic-data/read-model.ts";
import { serializeUnchangedConfirmation } from "../../lib/civic-data/unchanged-confirmation.ts";
import { canonicalCivicDataHash } from "../../lib/civic-data/canonical-hash.ts";
import type { CandidateVersionRecord, PromotedProjection } from "../../lib/civic-data/types.ts";
import { installFactReader } from "../../lib/facts/db.ts";
import { installReaderDatabaseQuery } from "../../lib/reader/database.ts";
import type { Query } from "../../lib/facts/publish.ts";
import { meetingStateOf } from "../../lib/meetings/body-scope.ts";
import type { MeetingsSnapshot } from "../../lib/meetings/snapshot.ts";
import { rosterFactReader } from "./roster-fact-reader.ts";
import type { RegistryRuntimeReadModel } from "../../lib/registry/runtime-data-plane.ts";
import { enterReaderAuthorityEdge, type ReaderAuthorityEdgeBundle } from "../../lib/registry/runtime-edge.ts";
import { censusDistrictEdgeSlice, type CensusDistrictEdge } from "../../lib/census-geography/district-edge.ts";
import { censusWorkDivision } from "../../lib/census-geography/division-id.ts";
import { translationScope } from "../../lib/translate/records.ts";
import { primeOutcomeProjection } from "../../lib/outcomes/store.ts";
import type { OutcomeSnapshot } from "../../lib/outcomes/types.ts";
import { neonConfig } from "@neondatabase/serverless";
import { isCensusPlaceholderDivision } from "../../lib/registry/census-placeholders.ts";
import type { RegistrationReadModel } from "../../lib/registration/candidate.ts";
import { manualEdgeEntry, provenEdgeEntry } from "./promoted-edge-entry.ts";
import { EVERYDAY_ROUTING_POINTER } from "../../lib/routing/everyday-data-plane.ts";

export interface ReaderValue { readonly value: unknown; readonly versionId: string }
export interface ReaderValues {
  readonly authority?: Readonly<Record<string, ReaderValue | undefined>>;
  readonly stateAuthorities?: Readonly<Record<string, Readonly<Record<string, ReaderValue>> | undefined>>;
  readonly registrations?: Readonly<Record<string, ReaderValue>>;
  readonly stateLegislators?: Readonly<Record<string, ReaderValue>>;
}
interface Fixture { store: MemoryRoutineDataStore; meetings?: RoutineDataStore; values?: ReaderValues }
const fixtures = new Map<string, Fixture>();
let active = "default";
const fixture = (key = active) => { let held = fixtures.get(key); if (!held) { held = {store:new MemoryRoutineDataStore()}; fixtures.set(key,held); } return held; };

function censusRows(value: CensusDistrictEdge, state?: unknown): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = value.scopes.map(scope => ({ row_kind: "scope", type: scope.type, version: scope.version, plan: scope.plan,
    version_meta: { applicability: scope.applicability, states: scope.states, retrievalComplete: scope.retrievalComplete,
      provenance: { sourceUrls: scope.sourceUrls, computedAt: scope.observedAt } } }));
  value.containers.forEach(({ ref, plan }, index) => {
    if (typeof state === "string" && state !== ref.stateAbbr && !ref.memberStates?.includes(state)) return;
    rows.push({ row_kind: "grouping", type: ref.type, version: ref.version, plan, geoid: ref.geoid, ocd_id: ref.ocdId,
      label: ref.label, state_fips: ref.stateFips, state_abbr: ref.stateAbbr, member_states: ref.memberStates,
      overlaps: Object.entries(value.codes).flatMap(([zcta5, codes]) => codes.filter(code => code[0] === index).map(code => ({ zcta5, whole: code[1], fraction: code[2] }))) });
  });
  return rows;
}

function canonicalRows(sql: string, params: readonly unknown[]): Record<string, unknown>[] | undefined {
  const held = fixture().store as unknown as { promotions: Map<string, PromotedProjection>; candidates: Map<string, CandidateVersionRecord> };
  const zipPeople = sql.includes("AS zip_people") && sql.includes("selected(ordinal_index)");
  const selectedOutcomes = sql.includes("AS snapshot_shape_valid") && sql.includes("p.record_class='MEETING_OUTCOME'");
  const selectedKeys = sql.includes("FROM civic_data_promotions p") && sql.includes("p.key=ANY($1::text[]");
  if (!selectedOutcomes && !selectedKeys) return undefined;
  const keys = Array.isArray(params[0]) ? [...params[0]] : String(params[0]).match(/"((?:[^"\\]|\\.)*)"/g)?.map(key => JSON.parse(key)) ?? [];
  const exactKeys = selectedOutcomes ? params[3] as readonly string[] : [];
  const stateOutcomes = selectedOutcomes && params[2] === null;
  const ids = new Set(selectedOutcomes && !stateOutcomes ? params[2] as readonly string[] : []);
  const selectors = stateOutcomes ? params[1] as readonly string[] : [], states = stateOutcomes ? params[4] as readonly string[] : [];
  const doorPrefixes = stateOutcomes ? (params[5] as readonly string[]).map(prefix => prefix.slice(0, -1).replace(/\\([\\%_])/g, "$1")) : [];
  const bodySelected = (sitting: OutcomeSnapshot["sittings"][number]) => selectors.includes(sitting.bodyId ?? "") || selectors.includes(sitting.meetingId)
    || states.includes(meetingStateOf(sitting.bodyId));
  const stateScoped = (p: PromotedProjection) => keys.some(prefix => p.scope.startsWith(String(prefix).replace(/%$/, ""))) || doorPrefixes.some(prefix => p.scope.startsWith(prefix));
  const additional: Record<string, unknown>[] = [];
  if (selectedKeys && sql.includes("AS local_divisions") && params[2] === "CENSUS_GEOGRAPHY") {
    const census = fixture().values?.authority?.["census-districts"];
    const value = census?.value as CensusDistrictEdge | undefined;
    const state = String(params[5]);
    const divisionIds = params[6] as readonly string[];
    const registration = held.promotions.get(`REGISTRATION:US-${state}:registration:v1`)?.payload as RegistrationReadModel | undefined;
    const types = params[4] as readonly string[];
    const canonicalKeys = value && typeof params[7] === "string" ? [...new Set((value.codes[params[7]] ?? []).flatMap(([index]) => {
      const { ref } = value.containers[index];
      if (!types.includes(ref.type) || ref.stateAbbr !== state && !ref.memberStates?.includes(state)) return [];
      const id = censusWorkDivision(ref);
      return id ? [`CURATED_READER_RECORD:${translationScope(id)}`] : [];
    }))] : [];
    keys.push(...canonicalKeys);
    additional.push({ row_kind: "additional", part_payload: [{ version_id: census?.versionId ?? null,
      geography: value ? censusRows(value, state).filter(row => row.row_kind === "scope" || types.includes(String(row.type))) : [],
      local_divisions: registration?.divisions.filter(row => divisionIds.includes(row.ocdId)) ?? [], canonical_keys: canonicalKeys }] });
  }
  const zipKey = zipPeople ? `STATE_LEGISLATOR:US-${String(params[5])}:openstates-people:v1` : null;
  const registryKey = sql.includes("AS zip_registry") ? `REGISTRY_RUNTIME_BINDING:US-${String(params[5])}:reader-registry-runtime` : null;
  const officialKey = sql.includes("AS zip_official") ? `STATE_LEGISLATOR:US-${String(params[5])}` : null;
  const sourceKeys=sql.includes("AS zip_sources") ? [`FEDERAL_DIRECTORY:US-${String(params[5])}:current-congress-directory`,
    ...PEOPLE_SOURCE_IDS.map(source=>`${peopleSourceRecordClass(source)}:${peopleSourceScope(`US-${String(params[5])}`,source)}`)] : [];
  const queryKeys = [...keys,...sourceKeys,...(zipKey?[zipKey]:[]),...(registryKey?[registryKey]:[]),...(officialKey?[officialKey]:[])];
  const rows: Record<string, unknown>[] = [...held.promotions.values()].filter(p => selectedOutcomes
    ? p.recordClass === "MEETING_OUTCOME" && (stateScoped(p) || exactKeys.includes(p.key)
      || stateOutcomes && p.scope.startsWith("door:") && (p.payload as OutcomeSnapshot).sittings?.some(bodySelected))
    : queryKeys.includes(p.key)).map(p => {
      const c = held.candidates.get(p.versionId);
      const snapshot = p.payload as OutcomeSnapshot;
      const shape = Array.isArray(snapshot?.sittings) && Array.isArray(snapshot?.tenants);
      const published = c?.state === "PROMOTED" && c.acquisitionSucceeded && c.promotedVersion === p.versionId && c.lastKnownGoodVersion === p.versionId &&
        p.lastKnownGoodVersionId === p.versionId && c.candidate.sourceId === p.sourceId && c.candidate.recordClass === p.recordClass && c.candidate.scope === p.scope &&
        p.receipt.decision === "GOOD" && p.receipt.candidateId === p.versionId && p.receipt.sourceId === p.sourceId && p.receipt.recordClass === p.recordClass && p.receipt.scope === p.scope;
      return { row_kind: "promotion", key: p.key, record_class: p.recordClass, scope: p.scope, source_id: p.sourceId,
        current_version_id: p.versionId, last_known_good_version_id: p.lastKnownGoodVersionId,
        promoted_at: p.promotedAt, validation_receipt: p.receipt,
        payload: selectedOutcomes && shape ? { ...snapshot, sittings: snapshot.sittings.filter(sitting => stateOutcomes ? stateScoped(p) || bodySelected(sitting) : ids.has(sitting.meetingId)) } : p.payload,
        normalized_hash: c?.candidate.normalization.normalizedHash, retrieved_at: c?.candidate.retrieval.retrievedAt,
        temporal: c?.candidate.temporal, confirmation: null, published, ...(selectedOutcomes ? { snapshot_shape_valid: shape,
          selected_by_body: stateOutcomes && shape && snapshot.sittings.some(bodySelected) } : {}) };
    });
  if (zipKey && additional.length) (additional[0].part_payload as Record<string, unknown>[])[0].zip_people = rows.find(row=>row.key===zipKey) ?? null;
  if (registryKey && additional.length) (additional[0].part_payload as Record<string, unknown>[])[0].zip_registry = rows.find(row=>row.key===registryKey) ?? null;
  if (officialKey && additional.length) (additional[0].part_payload as Record<string, unknown>[])[0].zip_official = rows.find(row=>row.key===officialKey) ?? null;
  if (sourceKeys.length && additional.length) (additional[0].part_payload as Record<string, unknown>[])[0].zip_sources = rows.filter(row=>sourceKeys.includes(String(row.key)));
  return structuredClone([...rows.filter(row=>![zipKey,registryKey,officialKey,...sourceKeys].includes(String(row.key)) || keys.includes(String(row.key))), ...additional]);
}

let patched = false;
function patchStore() {
  if (patched) return;
  patched = true;
  process.env.DATABASE_URL ??= "postgresql://fixture:fixture@canonical-reader.invalid/fixture";
  neonConfig.fetchFunction = async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request = JSON.parse(String(init?.body ?? "{}")) as { query?: string; params?: unknown[]; queries?: { query?: string; params?: unknown[] }[] };
    const results = (request.queries ?? [request]).map(statement => {
      const sql = statement.query ?? "", params = statement.params ?? [];
      let rows: Record<string, unknown>[] = [];
      const census = fixture().values?.authority?.["census-districts"];
      if (params[0] === "CENSUS_GEOGRAPHY" && census) {
        const value = census.value as CensusDistrictEdge;
        if (sql.includes("AS version_id")) rows = [{ version_id: census.versionId }];
        else if (sql.includes("'scope' AS row_kind")) {
          rows = censusRows(value, params[3]);
        }
      }
      rows = canonicalRows(sql, params) ?? rows;
      const names = [...new Set(rows.flatMap(row => Object.keys(row)))];
      return { command: "SELECT", rowCount: rows.length, rowAsArray: true,
        fields: names.map(name => ({ name, dataTypeID: 114 })), rows: rows.map(row => names.map(name => JSON.stringify(row[name]))) };
    });
    return Response.json(request.queries ? { results } : results[0]);
  };
  for (const method of ["readPromotion", "readPromotions", "readPromotionIdentity", "readPromotionIdentities", "readCandidate", "readCandidates", "readCandidateProof", "readCandidateProofs", "readPublishedCandidateMetadata", "listPromotionScopes"] as const) {
    Object.defineProperty(PostgresRoutineDataStore.prototype, method, { configurable: true, writable: true,
      value: function(...args: unknown[]) { const held = fixture().store; return Reflect.apply(held[method], held, args); } });
  }
}

/** Canonical pointer/candidate fixtures stand behind the same default store readers use. */
export function installCanonicalEntries(entries: readonly PromotedEdgeEntry[], key = active): void {
  const held = fixture(key).store as unknown as { promotions: Map<string,PromotedProjection>; candidates: Map<string,CandidateVersionRecord> };
  for (const entry of entries) {
    const id = entry.kind === "PROMOTED" ? entry.projection.key : `${entry.recordClass}:${entry.scope}`;
    if (entry.kind !== "PROMOTED") { held.promotions.delete(id); continue; }
    const {attested} = entry;
    let projection = entry.projection;
    if (projection.recordClass === "REGISTRY_RUNTIME_BINDING") {
      const runtime = projection.payload as RegistryRuntimeReadModel;
      const placeholders = new Set(runtime.registry.divisions.filter(isCensusPlaceholderDivision).map(division => division.ocdId));
      const bodies = runtime.registry.bodies.filter(body => body.ocdId === null || !placeholders.has(body.ocdId));
      const ids = new Set(bodies.map(body => body.id));
      projection = { ...projection, payload: { ...runtime, registry: { ...runtime.registry, bodies }, bodyRosters: runtime.bodyRosters.filter(roster => ids.has(roster.bodyId)) } };
    }
    const hash = canonicalCivicDataHash(projection.payload);
    const candidate = {id:projection.versionId,sourceId:projection.sourceId,recordClass:projection.recordClass,scope:projection.scope,
      retrieval:{succeeded:true,retrievedAt:attested.retrievedAt},normalization:{succeeded:true,normalizedHash:hash,normalizedPayloadHash:hash},
      temporal:{staleAtRetrieval:false,version:attested.version ?? "fixture",sourceThrough:attested.sourceThrough ?? attested.retrievedAt.slice(0,10)},
      normalizedPayload:projection.payload,readModel:projection.payload};
    held.promotions.set(id,projection);
    held.candidates.set(projection.versionId,{candidate,state:"PROMOTED",acquisitionSucceeded:true,receipt:projection.receipt,
      promotedVersion:projection.versionId,lastKnownGoodVersion:projection.versionId,failureCode:null,failureDetail:null} as CandidateVersionRecord);
  }
  patchStore();
}

export function installReaderValues(input: ReaderValues, key = active): void {
  fixture(key).values = input;
  for (const entry of [...Object.values(input.authority ?? {}),...Object.values(input.stateAuthorities ?? {}).flatMap(states => Object.values(states ?? {}))]) {
    const value = entry?.value as {kind?:string;entries?:PromotedEdgeEntry[]} | undefined;
    if (value?.kind === "PROMOTED_POINTERS") installCanonicalEntries(value.entries ?? [],key);
  }
  const everyday = input.authority?.["everyday-routing"];
  if (everyday) {
    const value = everyday.value as { projection?: unknown };
    if (value.projection) installCanonicalEntries([manualEdgeEntry("everyday-routing", value.projection, everyday.versionId)], key);
  }
  const outcomes = input.authority?.["meeting-outcomes"];
  if (outcomes) {
    const snapshot = outcomes.value as OutcomeSnapshot;
    for (const state of new Set(snapshot.sittings.map(sitting => meetingStateOf(sitting.bodyId ?? sitting.ocdId)))) {
      const sittings = snapshot.sittings.filter(sitting => meetingStateOf(sitting.bodyId ?? sitting.ocdId) === state);
      installCanonicalEntries([provenEdgeEntry({ recordClass: "MEETING_OUTCOME", scope: `US-${state}:fixture:meeting-outcomes`,
        sourceId: "fixture-meeting-outcomes", versionId: `${outcomes.versionId}:${state}`,
        value: { ...snapshot, sittings, tenants: [...new Set(sittings.map(sitting => sitting.slug))] } })], key);
    }
  }
  activateCanonicalFixture(key);
}

export function installCanonicalMeetings(store: RoutineDataStore, key = active): void {
  fixture(key).meetings = store;
  activateCanonicalFixture(key);
}

/** A saved fixture is activated before a request; all data stays in canonical stores. */
export function activateCanonicalFixture(key: string): void {
  active = key; patchStore();
  const held = fixture(key), input = held.values ?? {};
  const promoted = new Map([...((held.store as unknown as {promotions:Map<string,PromotedProjection>}).promotions.values())].map(p => [p.key,{kind:"PROMOTED" as const,projection:p,attested:{recordClass:p.recordClass,scope:p.scope,versionId:p.versionId,payloadSha256:canonicalCivicDataHash(p.payload),retrievedAt:p.promotedAt,staleAtRetrieval:false,version:"fixture",sourceThrough:p.promotedAt.slice(0,10)}}]));
  const bundle = {promoted,
    stateAuthorities:{families:new Set(Object.keys(input.stateAuthorities ?? {})),load:async(family:string,state:string)=>input.stateAuthorities?.[family]?.[state]?.value ?? null},
    registrations:{load:async(state:string)=>input.registrations?.[state] ?? null},
    stateLegislators:{load:async(scope:string)=>input.stateLegislators?.[scope] ?? null},
    ...(input.authority?.["census-districts"] ? {censusDistricts:{slice:async(zip:string)=>censusDistrictEdgeSlice(input.authority!["census-districts"]!.value as CensusDistrictEdge,input.authority!["census-districts"]!.versionId,zip)}} : {}),
    ...(input.authority?.["meeting-outcomes"] ? {meetingOutcomes:input.authority["meeting-outcomes"]} : {}),
    ...(input.authority?.["everyday-routing"] ? {everydayRouting:input.authority["everyday-routing"]} : {}),
  } as unknown as ReaderAuthorityEdgeBundle;
  if (held.values) { clearPromotedReadModelCache(); enterReaderAuthorityEdge(bundle); }
  if(input.authority?.["meeting-outcomes"]) primeOutcomeProjection(input.authority["meeting-outcomes"].value as OutcomeSnapshot,input.authority["meeting-outcomes"].versionId);
  const readFacts: Query = async (sql,params=[]) => {
    const values = [...(held.store as unknown as {promotions:Map<string,PromotedProjection>}).promotions.values()];
    const registries = values.filter(p => p.recordClass === "REGISTRY_RUNTIME_BINDING").map(p => p.payload as RegistryRuntimeReadModel);
    const rosters = registries.flatMap(r => r.bodyRosters ?? []);
    if (!sql.includes("AS registration_held") && !sql.includes("WITH RECURSIVE ancestors AS")) {
      if (sql.startsWith("SELECT id FROM entity")) return registries.flatMap(r => r.registry.bodies).filter(b => (params[0] as string[]).includes(meetingStateOf(b.id))).map(b => ({id:b.id}));
      if (sql.includes("SELECT place_id FROM entity_place")) return (params[0] as string[]).map(id => ({place_id:id.split("#")[0]}));
      return rosterFactReader(rosters)(sql,params);
    }
    const state = String(params[0]), named = params[2] as string[], all = params[4] === true;
    const divisions = [...new Set([...(params[1] as string[]), ...(params[8] ? named.filter(id => id.startsWith("ocd-division/")).map(id => id.split("#")[0]) : [])])];
    const registration = values.find(p => p.recordClass === "REGISTRATION" && p.scope === `US-${state}:registration:v1`)?.payload as RegistrationReadModel | undefined;
    const governments = (registration?.governments ?? []).filter(government => government.associations.some(association => divisions.includes(association.divisionId)));
    const registrationDivisions = (registration?.divisions ?? []).filter(division => divisions.includes(division.ocdId));
    const sourceStore = held.meetings ?? held.store;
    const scopes = await sourceStore.listPromotionScopes?.(["MEETING"]) ?? [];
    const pointers = await sourceStore.readPromotions<MeetingsSnapshot>("MEETING", scopes.map(p => p.scope));
    const every = new Map<string,{id:string;kind:string;name:string;state:string;parent_id:string|null}>();
    for (const body of registries.flatMap(r => r.registry.bodies)) every.set(body.id,{id:body.id,kind:"body",name:body.name ?? body.id,state:meetingStateOf(body.id),parent_id:body.ocdId});
    for (const p of pointers) for (const m of p.payload.meetings) if (m.bodyId) every.set(m.bodyId,{id:m.bodyId,kind:"body",name:m.bodyName,state:meetingStateOf(m.bodyId),parent_id:m.ocdId});
    const entities = [...every.values()].filter(b => b.state === state && (all || named.includes(b.id) || divisions.some(d => b.id.split("#")[0] === d || b.parent_id === d || b.parent_id?.startsWith(`${d}/`))));
    const ids = entities.map(e => e.id);
    const meeting_rows = pointers.filter(p => (params[5] || !p.scope.endsWith(":history")) && p.payload.meetings.some(m => m.bodyId && ids.includes(m.bodyId)))
      .map(p => ({scope:p.scope,payload:structuredClone(p.payload),current_version_id:p.versionId,confirmation:p.latestConfirmation ? serializeUnchangedConfirmation(p.latestConfirmation) : null}));
    const registry = registries.find(value => value.registry.bodies.some(body => meetingStateOf(body.id) === state)) ?? null;
    const everydayRouting = values.find(p => p.recordClass === EVERYDAY_ROUTING_POINTER.recordClass && p.scope === EVERYDAY_ROUTING_POINTER.scope)?.payload ?? null;
    return [{registry,everyday_routing:everydayRouting,registration_held:registration !== undefined,governments,divisions:registrationDivisions,entities,fields:[],rosters:await rosterFactReader(rosters)("'member:%'",[ids]),comments:[],sittings:[],meeting_rows,parts:{}}];
  };
  installFactReader(readFacts);
  installReaderDatabaseQuery(async statements => Promise.all(statements.map(statement =>
    canonicalRows(statement.text, statement.params) ?? readFacts(statement.text, statement.params))));
}
