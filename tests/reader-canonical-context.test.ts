import assert from "node:assert/strict";
import { test } from "node:test";
import { primeReaderCanonicalStore, readerCanonicalEntry, readerCanonicalEntries } from "../lib/reader/canonical-context.ts";
import { withReaderSelection, type ReaderSelection } from "../lib/db/reader-route.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { readStateAuthorityProjection } from "../lib/civic-data/state-reader.ts";
import { stateAuthorityPointers } from "../lib/civic-data/state-reader.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import { readStatePackage, readStateAuthorities, readStateDistricts, primeStateDistrictPointers, primeStateReaderPointers } from "../lib/reader/state.ts";
import { installReaderDatabaseQuery as installQuery } from "../lib/reader/database.ts";
import { forgetNationalShelf } from "../lib/reader/shelf.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { Division } from "../lib/registry/types.ts";
import { BALLOT_PLACE_PAGES_SQL } from "../lib/ballot/place-package-until-nov-4.ts";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { versionedSelect } from "../lib/db/versioned-query.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";

/** These tests are about a state's own reads: the President is held in this server's memory and answers nothing here. */
function installReaderDatabaseQuery(query: Parameters<typeof installQuery>[0]): void {
  forgetNationalShelf();
  installQuery(query && (async statements => {
    const [only] = statements, keys = only?.params[0];
    if (statements.length === 1 && Array.isArray(keys) && keys.length && keys.every(key => String(key).includes(":US:people:") || String(key).includes("US:people:"))) {
      return [only.text.includes("p.xmin::text") ? [{ value: "a".repeat(64) }] : []];
    }
    return query(statements);
  }));
}

function stateRows(version: string, divisions: readonly string[], zip = false, withMember = false) {
  const at = "2026-10-19T00:00:00.000Z", scope = "US-AZ:reader-registry-runtime";
  const division = (ocdId: string, label: string, local = false): Division => ({
    ocdId, label, divisionType: local ? ocdId.includes("/county:") ? "county" : "place" : "state", tier: local ? "local" : "state", state: "AZ",
    parentOcdId: ocdId.slice(0, ocdId.lastIndexOf("/")), lsad: null, funcstat: null, classfp: null, geoid: null,
    canonicalOcdId: ocdId, canonicalMatch: "exact", sourceDataset: "TIGER_CB2023",
    provenance: { sourceUrl: "https://www.census.gov/geographies.html", sourceOrg: "U.S. Census Bureau", collectedAt: at, verifiedAt: at },
  });
  const runtime: RegistryRuntimeReadModel = { formatVersion: 1,
    registry: { generatedAt: at, divisions: [division("ocd-division/country:us/state:az", version)], bodies: [] },
    bodyRosters: withMember ? [{ bodyId: "fixture-body", sourceUrl: "https://example.gov/roster", sourceOrg: "Fixture", collectedAt: at,
      members: [{ id: "fixture-member", name: "Fixture Member", officeTitle: "Council member" }] }] as unknown as RegistryRuntimeReadModel["bodyRosters"] : [],
    rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
    officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } };
  const entry = provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope, sourceId: "registry-reviewed-bindings", versionId: version, value: runtime });
  const p = entry.projection;
  const row = { row_kind: "promotion", key: p.key, record_class: p.recordClass, scope: p.scope, source_id: p.sourceId,
    current_version_id: p.versionId, last_known_good_version_id: p.lastKnownGoodVersionId, promoted_at: p.promotedAt,
    retrieved_at: entry.attested.retrievedAt, validation_receipt: p.receipt, normalized_hash: entry.attested.payloadSha256, payload: p.payload, published: true };
  return [...(zip?[]:[row]),{ row_kind: "additional", part_payload: [{ version_id: `geography:${version}`, geography: [],
    ...(zip?{zip_registry:row}:{}),local_divisions: divisions.map(ocdId => division(ocdId, ocdId, true)) }] }];
}

const selection = (state: string): ReaderSelection => ({ states: [state], keys: new Set([`state:${state}`]) });
const absentStore: CivicDataReadStore = {
  async readPromotion() { throw new Error("Unexpected second read"); },
  async readCandidate() { throw new Error("Unexpected second read"); },
  async readPromotedEntry(recordClass, scope) { return { kind: "NOT_RECORDED", recordClass, scope }; },
};

test("a ballot's canonical batch is shared by state readers and streamed cards, isolated from another place", async () => {
  const az = selection("AZ"), nh = selection("NH");
  const ballot = stateAuthorityPointers("ballot-contests", "AZ")[0];
  const filing = { recordClass: "CURATED_READER_RECORD" as const, scope: "US:bs01-test-filings" };
  await withReaderSelection(az, async () => {
    await primeReaderCanonicalStore([ballot, filing], absentStore);
    assert.equal((await readStateAuthorityProjection("ballot-contests", "AZ")).result.kind, "NOT_RECORDED");
    assert.equal((await readPromotedCivicData(filing.recordClass, filing.scope)).kind, "NOT_RECORDED");
    await withReaderSelection(nh, async () => {
      assert.equal(readerCanonicalEntry(ballot.recordClass, ballot.scope), undefined);
      await primeReaderCanonicalStore([filing], absentStore);
      assert.equal(readerCanonicalEntries().size, 1);
    });
    assert.equal(readerCanonicalEntries().size, 2);
  });
  await withReaderSelection(az, async () => assert.equal((await readerCanonicalEntry(filing.recordClass, filing.scope))?.kind, "NOT_RECORDED"));
});

test("a failed canonical batch stays a failed read and never falls back to another query", async () => {
  const ballot = stateAuthorityPointers("ballot-contests", "AZ")[0];
  const filing = { recordClass: "CURATED_READER_RECORD" as const, scope: "US:bs01-test-filings" };
  await withReaderSelection(selection("AZ"), async () => {
    const error = new Error("First canonical read failed");
    await assert.rejects(primeReaderCanonicalStore([ballot, filing], Promise.reject(error)), value => value === error);
    assert.equal((await readStateAuthorityProjection("ballot-contests", "AZ")).result.kind, "STORE_UNREACHABLE");
    assert.equal((await readPromotedCivicData(filing.recordClass, filing.scope)).kind, "STORE_UNREACHABLE");
    await assert.rejects(readerCanonicalEntry(filing.recordClass, filing.scope)!, value => value === error);
  });
});

test("settled state and geography reads stay consistent within one request while the next request sees a new publication", async () => {
  const city = "ocd-division/country:us/state:az/place:tucson", county = "ocd-division/country:us/state:az/county:pima";
  let version = "request-state:one", reads = 0, block: Promise<void> | undefined, release: (() => void) | undefined;
  let queryStarted: (() => void) | undefined;
  installReaderDatabaseQuery(async statements => {
    assert.equal(statements.length, 1);
    const statement = statements[0], keys = statement.params[0] as string[];
    if (!keys.some(key => key.startsWith("REGISTRY_RUNTIME_BINDING:"))) return [[]];
    reads++;
    queryStarted?.();
    const currentVersion = version, divisions = statement.params.at(-1) as readonly string[];
    await block;
    return [stateRows(currentVersion, divisions)];
  });
  try {
    await withReaderSelection(selection("AZ"), async () => {
      const raw = readStatePackage("az"), first = await raw;
      assert.equal(first.registry.registry.divisions[0].label, "request-state:one");
      assert.equal(readStatePackage("US-AZ"), raw, "streamed cards reuse the settled state read");
      assert.equal(await readStateDistricts("AZ"), first.districts, "settled geography remains available in this request's composition");
      assert.equal(reads, 1);

      version = "request-state:two";
      block = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { queryStarted = resolve; });
      const next = withReaderSelection(selection("AZ"), () => readStatePackage("AZ"));
      const concurrent = withReaderSelection(selection("AZ"), () => readStatePackage("AZ"));
      assert.notEqual(next, concurrent, "different requests each check their own current state");
      await started;
      assert.equal(reads, 3);
      assert.equal(await readStateDistricts("AZ"), first.districts, "another request's newer in-flight geography cannot replace this request's settled geography");
      release!(); block = undefined;
      const refreshed = await next;
      assert.equal((await concurrent).registry.registry.divisions[0].label, "request-state:two");
      assert.equal(refreshed.registry.registry.divisions[0].label, "request-state:two");
      assert.notEqual(refreshed.version, first.version);

      const zip = readStatePackage("AZ", [city, county, city]), selected = await zip;
      assert.notEqual(zip, raw, "a ZIP-selected state package remains distinct from the complete state package");
      assert.equal(readStatePackage("US-AZ", [county, city]), zip, "equivalent ZIP selections share the same normalized request key");
      assert.deepEqual(selected.localDivisions?.map(row => row.ocdId), [county, city]);
      assert.deepEqual(first.localDivisions, []);
      assert.equal(readStatePackage("AZ"), raw);
      assert.equal(reads, 4);
    });
    version = "request-state:three";
    const next = await withReaderSelection(selection("AZ"), () => readStatePackage("AZ"));
    assert.equal(next.registry.registry.divisions[0].label, version, "a later request checks the current canonical publication without a global TTL");
    assert.equal(reads, 5);
  } finally { release?.(); installReaderDatabaseQuery(undefined); }
});

test("an independent state request checks a committed change while an older query response is still pending", async () => {
  const {pg,publish}=await migratedReaderDb();
  const copies=new Map<string,string>();
  const checked=versionedSelect("state-request-race",new CivicReadCache({read:async key=>copies.get(key)??null,
    write:async(key,value)=>{copies.set(key,value);}}));
  let reads=0,release=()=>{},started=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve;});
  const queried=new Promise<void>(resolve=>{started=resolve;});
  const publishState=async(version:string)=>publish({id:version,recordClass:"REGISTRY_RUNTIME_BINDING",
    scope:stateRegistryRuntimeScope("AZ"),sourceId:"registry-reviewed-bindings",at:"2026-10-19T00:00:00.000Z",
    value:(stateRows(version,[])[0] as {payload:RegistryRuntimeReadModel}).payload});
  const firstSelection=selection("AZ"),secondSelection=selection("AZ");
  installReaderDatabaseQuery(async statements=>{
    const call=++reads,rows=[];
    for(const statement of statements)rows.push(await checked(async(text,params)=>(await pg.query<Record<string,unknown>>(text,[...params])).rows,
      statement.text,statement.params));
    if(call===1){started();await held;}
    return rows;
  });
  try {
    await publishState("request-race:before");
    const first=withReaderSelection(firstSelection,()=>readStatePackage("AZ"));
    await queried;
    await publishState("request-race:after");
    const second=withReaderSelection(secondSelection,()=>readStatePackage("AZ"));
    assert.notEqual(second,first,"a new request never joins an older database snapshot");
    assert.equal(withReaderSelection(firstSelection,()=>readStatePackage("AZ")),first,"same-request composition retains its own snapshot");
    assert.equal((await second).registry.registry.divisions[0].label,"request-race:after");
    assert.equal(reads,2,"the independent request issues a fresh database version check");
    release();
    assert.equal((await first).registry.registry.divisions[0].label,"request-race:before");
  } finally {release();installReaderDatabaseQuery(undefined);await pg.close();}
});

test("a ballot's geography, people and canonical pointers share one answer across concurrent requests", async () => {
  const firstSelection=selection("AZ"),secondSelection=selection("AZ"),zip="85701";
  const scope=(version:string)=>`US:plain-english-translations:ocd-division/country:us/state:az/cd:${version}`;
  let version="before",release=()=>{},firstStarted=()=>{},reads=0;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const starting=new Promise<void>(resolve=>{firstStarted=resolve;});
  installReaderDatabaseQuery(async()=>{
    reads++;
    const selectedVersion=version;
    const row=stateRows(selectedVersion,[],true)[0] as {part_payload:Record<string,unknown>[]};
    row.part_payload[0].canonical_keys=[`CURATED_READER_RECORD:${scope(selectedVersion)}`];
    if(selectedVersion==="before"){firstStarted();await held;}
    return [[row]];
  });
  try {
    const first=withReaderSelection(firstSelection,()=>readStatePackage("AZ",[],zip,{earlyDistricts:true}));
    await starting;
    version="after";
    const second=withReaderSelection(secondSelection,()=>readStatePackage("AZ",[],zip,{earlyDistricts:true}));
    assert.notEqual(second,first);
    const secondState=await second;
    assert.equal(secondState.registry.registry.divisions[0].label,"after");
    await withReaderSelection(secondSelection,()=>primeStateDistrictPointers(second));
    const secondDistricts=await withReaderSelection(secondSelection,()=>readStateDistricts("AZ"));
    assert.equal(secondDistricts.kind,"HELD");
    if(secondDistricts.kind==="HELD")assert.equal(secondDistricts.versionId,"geography:after");
    release();
    const firstState=await first;
    assert.equal(firstState.registry.registry.divisions[0].label,"before");
    assert.equal(firstState.districts.kind,"HELD");
    if(firstState.districts.kind==="HELD")assert.equal(firstState.districts.versionId,"geography:before");
    await withReaderSelection(firstSelection,()=>primeStateDistrictPointers(first));
    for(const [selected,own,other] of [[firstSelection,"before","after"],[secondSelection,"after","before"]] as const)
      await withReaderSelection(selected,async()=>{
        assert.equal((await readerCanonicalEntry("CURATED_READER_RECORD",scope(own)))?.kind,"NOT_RECORDED");
        assert.equal(readerCanonicalEntry("CURATED_READER_RECORD",scope(other)),undefined);
      });
    assert.equal(reads,2,"each request reads its own geography and selected people together once");
  } finally {release();installReaderDatabaseQuery(undefined);}
});

test("the ballot receives verified state authorities without waiting for member-office details", async () => {
  let release = () => {}, started = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const officeStarted = new Promise<void>(resolve => { started = resolve; });
  installReaderDatabaseQuery(async statements => {
    if (statements[0].text.includes("collection='memberOffices'")) {
      started(); await blocked; return [[]];
    }
    return [stateRows("early-authorities", [], true, true)];
  });
  try {
    await withReaderSelection(selection("AZ"), async () => {
      const state = readStatePackage("AZ", [], "85701", { earlyDistricts: true });
      const authorities = readStateAuthorities(state);
      await officeStarted;
      let stateFinished = false;
      void state.then(() => { stateFinished = true; });
      const early = await authorities;
      assert.equal(early.registryRead.kind, "PROMOTED");
      assert.equal(stateFinished, false, "the separate office query remains pending");
      release();
      const complete = await state;
      assert.equal(early.registryRead, complete.registryRead);
      assert.equal(early.federalRead, complete.federalRead);
    });
  } finally { release(); installReaderDatabaseQuery(undefined); }
});

test("a failed state read remains failed for that request and a later request can retry", async () => {
  const failure = new Error("The selected state could not be read");
  let reads = 0, failed = true;
  installReaderDatabaseQuery(async statements => {
    const keys = statements[0].params[0] as string[];
    if (!keys.some(key => key.startsWith("REGISTRY_RUNTIME_BINDING:"))) return [[]];
    reads++;
    if (failed) throw failure;
    return [stateRows("request-state:recovered", [])];
  });
  try {
    await withReaderSelection(selection("AZ"), async () => {
      const first = readStatePackage("AZ");
      await assert.rejects(first, error => error === failure);
      assert.equal(readStatePackage("US-AZ"), first);
      await assert.rejects(readStateDistricts("AZ"), error => error === failure);
      assert.equal(reads, 1, "later cards do not retry a failed state within the same request");
    });
    failed = false;
    const recovered = await withReaderSelection(selection("AZ"), () => readStatePackage("AZ"));
    assert.equal(recovered.registry.registry.divisions[0].label, "request-state:recovered");
    assert.equal(reads, 2);
  } finally { installReaderDatabaseQuery(undefined); }
});

test("a ZIP-loaded state primes absent district pointers and satisfies later raw state consumers in that request", async () => {
  let reads = 0;
  const scope = "US:plain-english-translations:ocd-division/country:us/state:az/cd:7";
  installReaderDatabaseQuery(async statements => {
    const statement = statements[0], keys = Array.isArray(statement.params[0]) ? statement.params[0] as string[] : [];
    if (!statement.text.includes("AS zip_registry") && !keys.some(key=>key.startsWith("REGISTRY_RUNTIME_BINDING:"))) return [[]];
    reads++;
    const rows = stateRows(`zip-request:${statement.params[6]}`,[]);
    return [[rows[0],{ row_kind:"additional",part_payload:[{version_id:"zip-geography",geography:[],local_divisions:[],zip_registry:rows[0],canonical_keys:[`CURATED_READER_RECORD:${scope}`]}] }]];
  });
  try {
    await withReaderSelection(selection("AZ"),async()=>{
      const zip = readStatePackage("AZ",[],"85701");
      const people = primeStateReaderPointers("AZ",zip);
      const federalScope = stateAuthorityPointers("federal-directory","AZ")[0].scope;
      assert.ok(readerCanonicalEntry("FEDERAL_DIRECTORY",federalScope),"early ballot readers reserve the in-flight state answer");
      const held = await zip;
      await people;
      assert.equal((await readStateAuthorityProjection("federal-directory","AZ")).result.kind,"NOT_RECORDED");
      assert.equal((await readPromotedCivicData("STATE_LEGISLATOR","US-AZ")).kind,"NOT_RECORDED");
      assert.equal(readStatePackage("AZ"),zip,"late incumbent reads reuse the ZIP's identical state data");
      assert.equal(await readStateDistricts("AZ"),held.districts);
      await primeStateDistrictPointers(held);
      assert.equal((await readerCanonicalEntry("CURATED_READER_RECORD",scope))?.kind,"NOT_RECORDED");
      assert.equal(reads,1,"district, incumbent and federal readers reuse held absences without another query");
    });
    await withReaderSelection(selection("AZ"),()=>readStatePackage("AZ",[],"85003"));
    assert.equal(reads,2,"a different request and ZIP performs its own selected lookup");
  } finally { installReaderDatabaseQuery(undefined); }
});

test("the ballot submits state and place reads before its independent auxiliary canonical groups", async () => {
  const { readBallotReaderData } = await import("../lib/ballot/reader-data.ts");
  const { ballotPlaceFromParams } = await import("../lib/ballot/reader-place.ts");
  const order: string[] = [];
  const auxiliaryKeys: string[] = [];
  const newDistrict = "ocd-division/country:us/state:az/cd:99";
  const newTranslation = `US:plain-english-translations:${newDistrict}`;
  let release: (()=>void) | undefined;
  const blocked = new Promise<void>(resolve=>{ release=resolve; });
  installReaderDatabaseQuery(async statements=>{
    assert.equal(statements.length,1);
    const statement=statements[0], keys=Array.isArray(statement.params[0]) ? statement.params[0] as string[] : [];
    if (keys.length && keys.every(key=>key.startsWith("STATE_LEGISLATOR:US:people:"))) return [[]];
    const family=statement.text.includes("additional AS MATERIALIZED") || statement.text.includes("AS zip_registry") || keys.some(key=>key.startsWith("REGISTRY_RUNTIME_BINDING:")) ? "state" : statement.params[0] === "AZ" ? "place" : "auxiliary";
    order.push(family);
    if (family === "auxiliary") auxiliaryKeys.push(...keys);
    await blocked;
    if (family === "state") {
      const rows = stateRows("priority-state",[],statement.text.includes("AS zip_registry"));
      const additional = rows.find(row => "part_payload" in row) as { part_payload: Record<string, unknown>[] };
      additional.part_payload[0].canonical_keys = [`CURATED_READER_RECORD:${newTranslation}`];
      // A district only the state's geography names never joins the ZIP: its districts come from the shared place map.
      additional.part_payload[0].geography = [
        { row_kind: "scope", type: "congressional_district", version: "cd:119", plan: "cd119", version_meta: {} },
        { row_kind: "grouping", type: "congressional_district", version: "cd:119", plan: "cd119", geoid: "0499",
          ocd_id: newDistrict, label: "Fixture district", state_abbr: "AZ", state_fips: "04",
          overlaps: [{ zcta5: "85701", whole: true, fraction: 1 }] },
      ];
      return [rows];
    }
    if (family === "place") {
      assert.equal(statement.text,BALLOT_PLACE_PAGES_SQL);
      const divisions=statement.params[1] as string[];
      return [[{page_id:divisions[0],page_kind:"place",built_at:"2026-10-19T00:00:00.000Z",body_ids:statement.params[2] as string[],row:{
        division_ids:divisions,entities:[],fields:[],rosters:[],comments:[],sittings:[],meeting_rows:[],parts:{},governments:[],divisions:[],registration_held:false,
      }}]];
    }
    return [[]];
  });
  try {
    const data=await withReaderSelection(selection("AZ"),async()=>readBallotReaderData(await ballotPlaceFromParams({zip:"85701"})));
    assert.ok(data);
    assert.deepEqual(order,["state","place","auxiliary"],
      "the local lookup reaches the shared pool before any ballot auxiliary group can occupy its connection slot");
    for (const prefix of ["CURATED_READER_RECORD:US-AZ:official-ballot-navigation"]) assert.ok(auxiliaryKeys.some(key=>key.startsWith(prefix)),`the single auxiliary batch retains ${prefix}`);
    assert.ok(auxiliaryKeys.every(key=>!key.startsWith("BALLOT_CANDIDACY:")), "the state supplies the selected ZIP ballot");
    assert.ok(auxiliaryKeys.every(key=>!key.startsWith("CANDIDATE_PROFILE:")&&!key.startsWith("CANDIDATE_PUBLICATION:")&&!key.endsWith(":candidate-campaign-sites-derived")),
      "candidate details wait for the displayed contests instead of reading the whole state's candidates");
    release!();
    await data.districtRead;
    const entry = await data.entry();
    assert.ok(entry?.ids.includes("ocd-division/country:us/state:az/county:pima"), "the ZIP's places come from the shared place map");
    assert.ok(!entry?.ids.includes(newDistrict), "the state's geography cannot add a district the place map does not hold");
    await data.registryRead;
    assert.deepEqual(order,["state","place","auxiliary"], "the ballot never repeats the geography or its held translation absences");
  } finally { release?.(); installReaderDatabaseQuery(undefined); }
});

test("an unavailable local territory file leaves the ballot's canonical families available", async () => {
  const { readBallotReaderData } = await import("../lib/ballot/reader-data.ts");
  const { ballotPlaceFromParams } = await import("../lib/ballot/reader-place.ts");
  const failure=new Error("The local territory file is unavailable");
  let auxiliaries=0;
  installReaderDatabaseQuery(async statements=>{
    if(statements[0].text.includes("AS zip_registry")&&!Array.isArray(statements[0].params[0])) {
      const row=stateRows("territory-failure-state",[],true).find(row=>"part_payload" in row);
      assert.ok(row&&"part_payload" in row);return [[row.part_payload[0]]];
    }
    const keys=statements[0].params[0] as string[];
    assert.ok(Array.isArray(keys),"a failed territory read cannot submit a local place query");
    if (statements[0].text.includes("additional AS MATERIALIZED") || statements[0].text.includes("AS zip_registry") || keys.some(key=>key.startsWith("REGISTRY_RUNTIME_BINDING:"))) return [stateRows("territory-failure-state",[],statements[0].text.includes("AS zip_registry"))];
    if (keys.length && keys.every(key=>key.startsWith("STATE_LEGISLATOR:US:people:"))) return [[]];
    auxiliaries++;
    return [[]];
  });
  try {
    await withReaderSelection(selection("AZ"),async()=>{
      const data=await readBallotReaderData(await ballotPlaceFromParams({zip:"85701"}),async()=>{ throw failure; });
      assert.ok(data,"a registry-local failure cannot abort ballot initialization");
      await assert.rejects(data.registryRead,error=>error === failure);
      await data.districtRead;
      assert.equal(auxiliaries,1,"the single canonical batch still loads all independent ballot families");
      assert.equal((await readerCanonicalEntry("BALLOT_CANDIDACY",stateAuthorityPointers("ballot-contests","AZ")[0].scope))?.kind,"NOT_RECORDED");
    });
  } finally { installReaderDatabaseQuery(undefined); }
});

test("the selected funding slice stays scoped after aliases and sees the next current database answer", async () => {
  const { neonConfig } = await import("@neondatabase/serverless");
  const { primeReaderProjection } = await import("../lib/civic-data/read-model.ts");
  const { provenEdgeEntry } = await import("./helpers/promoted-edge-entry.ts");
  const { requiredRoutineContract } = await import("../lib/civic-data/contracts.ts");
  const contract = requiredRoutineContract("fec-funding");
  const entry = provenEdgeEntry({ recordClass: "FEC_FUNDING", scope: contract.scope, sourceId: contract.sourceId,
    versionId: "bs01-funding-slice", value: { candidates: [{ targetKeys: ["ballot-az-federal-candidate"] }] } });
  assert.equal(entry.kind, "PROMOTED");
  if (entry.kind !== "PROMOTED") return;
  const p = entry.projection;
  const row = { key: p.key, source_id: p.sourceId, record_class: p.recordClass, scope: p.scope, current_version_id: p.versionId,
    last_known_good_version_id: p.lastKnownGoodVersionId, promoted_at: p.promotedAt, validation_receipt: p.receipt, payload: p.payload,
    retrieved_at: entry.attested.retrievedAt, temporal: { version: entry.attested.version, sourceThrough: entry.attested.sourceThrough } };
  const originalUrl = process.env.DATABASE_URL, originalReport = process.env.WTP_VITAL_SIGNS_REPORT, originalFetch = neonConfig.fetchFunction;
  let reads = 0;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@canonical-reader.invalid/fixture";
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  neonConfig.fetchFunction = async () => { throw new Error("Selected projections must not fall back to HTTP"); };
  installReaderDatabaseQuery(async statements => {
    assert.equal(statements.length, 1);
    const keys = statements[0].params[2] as readonly string[];
    assert.ok(keys.includes("ballot-az-federal-candidate"));
    assert.ok(!keys.includes("ballot-nh-candidate"));
    reads++;
    return [[structuredClone(row)]];
  });
  try {
    const place = selection("AZ");
    await withReaderSelection(place, async () => {
      await primeReaderProjection("FEC_FUNDING", contract.scope, ["ballot-az-federal-candidate"]);
      place.keys.add("congress:an-official-alias");
      assert.equal((await readPromotedCivicData("FEC_FUNDING", contract.scope)).kind, "PROMOTED");
      assert.equal(reads, 2, "the next operation goes through the shared database query path again");
      Object.assign(row, { payload: { candidates: [{ targetKeys: ["ballot-az-federal-candidate"], updated: true }] } });
      const changed = await readPromotedCivicData<{ candidates: { updated?: true }[] }>("FEC_FUNDING", contract.scope);
      assert.equal(changed.kind, "PROMOTED");
      if (changed.kind === "PROMOTED") assert.equal(changed.value.candidates[0]?.updated, true);
      assert.equal(reads, 3, "the next operation sees a changed row without a request snapshot bypass");
    });
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
    if (originalReport === undefined) delete process.env.WTP_VITAL_SIGNS_REPORT; else process.env.WTP_VITAL_SIGNS_REPORT = originalReport;
    neonConfig.fetchFunction = originalFetch;
    installReaderDatabaseQuery(undefined);
  }
});
