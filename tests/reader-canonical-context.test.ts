import assert from "node:assert/strict";
import { test } from "node:test";
import { primeReaderCanonicalStore, readerCanonicalEntry, readerCanonicalEntries } from "../lib/reader/canonical-context.ts";
import { withReaderSelection, type ReaderSelection } from "../lib/db/reader-route.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { readStateAuthorityProjection } from "../lib/civic-data/state-reader.ts";
import { stateAuthorityPointers } from "../lib/civic-data/state-reader.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import { readStatePackage, readStateDistricts, primeStateDistrictPointers } from "../lib/reader/state.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { Division } from "../lib/registry/types.ts";

function stateRows(version: string, divisions: readonly string[]) {
  const at = "2026-10-19T00:00:00.000Z", scope = "US-AZ:reader-registry-runtime";
  const division = (ocdId: string, label: string, local = false): Division => ({
    ocdId, label, divisionType: local ? ocdId.includes("/county:") ? "county" : "place" : "state", tier: local ? "local" : "state", state: "AZ",
    parentOcdId: ocdId.slice(0, ocdId.lastIndexOf("/")), lsad: null, funcstat: null, classfp: null, geoid: null,
    canonicalOcdId: ocdId, canonicalMatch: "exact", sourceDataset: "TIGER_CB2023",
    provenance: { sourceUrl: "https://www.census.gov/geographies.html", sourceOrg: "U.S. Census Bureau", collectedAt: at, verifiedAt: at },
  });
  const runtime: RegistryRuntimeReadModel = { formatVersion: 1,
    registry: { generatedAt: at, divisions: [division("ocd-division/country:us/state:az", version)], bodies: [] },
    bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
    officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } };
  const entry = provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope, sourceId: "registry-reviewed-bindings", versionId: version, value: runtime });
  const p = entry.projection;
  return [{ row_kind: "promotion", key: p.key, record_class: p.recordClass, scope: p.scope, source_id: p.sourceId,
    current_version_id: p.versionId, last_known_good_version_id: p.lastKnownGoodVersionId, promoted_at: p.promotedAt,
    retrieved_at: entry.attested.retrievedAt, validation_receipt: p.receipt, normalized_hash: entry.attested.payloadSha256, payload: p.payload, published: true },
  { row_kind: "additional", part_payload: [{ version_id: `geography:${version}`, geography: [],
    local_divisions: divisions.map(ocdId => division(ocdId, ocdId, true)) }] }];
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
  installReaderDatabaseQuery(async statements => {
    assert.equal(statements.length, 1);
    const statement = statements[0], keys = statement.params[0] as string[];
    if (!keys.some(key => key.startsWith("REGISTRY_RUNTIME_BINDING:"))) return [[]];
    reads++;
    const currentVersion = version, divisions = statement.params.at(-1) as readonly string[];
    await block;
    return [stateRows(currentVersion, divisions)];
  });
  try {
    await withReaderSelection(selection("AZ"), async () => {
      const raw = readStatePackage("az"), first = await raw;
      assert.equal(first.registry.registry.divisions[0].label, "request-state:one");
      assert.equal(readStatePackage("US-AZ"), raw, "streamed cards reuse the settled state read");
      assert.equal(await readStateDistricts("AZ"), first.districts, "settled geography remains available after the global in-flight entry is removed");
      assert.equal(reads, 1);

      version = "request-state:two";
      block = new Promise<void>(resolve => { release = resolve; });
      const next = withReaderSelection(selection("AZ"), () => readStatePackage("AZ"));
      const concurrent = withReaderSelection(selection("AZ"), () => readStatePackage("AZ"));
      assert.equal(next, concurrent, "different requests share the same state only while it is in flight");
      assert.equal(reads, 2);
      assert.equal(await readStateDistricts("AZ"), first.districts, "another request's newer in-flight geography cannot replace this request's settled geography");
      release!(); block = undefined;
      const refreshed = await next;
      assert.equal(refreshed.registry.registry.divisions[0].label, "request-state:two");
      assert.notEqual(refreshed.version, first.version);

      const zip = readStatePackage("AZ", [city, county, city]), selected = await zip;
      assert.notEqual(zip, raw, "a ZIP-selected state package remains distinct from the complete state package");
      assert.equal(readStatePackage("US-AZ", [county, city]), zip, "equivalent ZIP selections share the same normalized request key");
      assert.deepEqual(selected.localDivisions?.map(row => row.ocdId), [county, city]);
      assert.deepEqual(first.localDivisions, []);
      assert.equal(readStatePackage("AZ"), raw);
      assert.equal(reads, 3);
    });
    version = "request-state:three";
    const next = await withReaderSelection(selection("AZ"), () => readStatePackage("AZ"));
    assert.equal(next.registry.registry.divisions[0].label, version, "a later request checks the current canonical publication without a global TTL");
    assert.equal(reads, 4);
  } finally { release?.(); installReaderDatabaseQuery(undefined); }
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
    const statement = statements[0], keys = statement.params[0] as string[];
    if (!keys.some(key=>key.startsWith("REGISTRY_RUNTIME_BINDING:"))) return [[]];
    reads++;
    const rows = stateRows(`zip-request:${statement.params[7]}`,[]);
    return [[rows[0],{ row_kind:"additional",part_payload:[{version_id:"zip-geography",geography:[],local_divisions:[],canonical_keys:[`CURATED_READER_RECORD:${scope}`]}] }]];
  });
  try {
    await withReaderSelection(selection("AZ"),async()=>{
      const zip = readStatePackage("AZ",[],"85701"), held = await zip;
      assert.equal(readStatePackage("AZ"),zip,"late incumbent reads reuse the ZIP's identical state data");
      assert.equal(await readStateDistricts("AZ"),held.districts);
      await primeStateDistrictPointers(held);
      assert.equal((await readerCanonicalEntry("CURATED_READER_RECORD",scope))?.kind,"NOT_RECORDED");
      assert.equal(reads,1,"priming absent district pointers adds no query");
    });
    await withReaderSelection(selection("AZ"),()=>readStatePackage("AZ",[],"85003"));
    assert.equal(reads,2,"a different request and ZIP performs its own selected lookup");
  } finally { installReaderDatabaseQuery(undefined); }
});

test("the ballot submits state and place reads before its independent auxiliary canonical groups", async () => {
  const { readBallotReaderData } = await import("../lib/ballot/reader-data.ts");
  const { ballotPlaceFromParams } = await import("../lib/ballot/reader-place.ts");
  const order: string[] = [];
  let release: (()=>void) | undefined;
  const blocked = new Promise<void>(resolve=>{ release=resolve; });
  installReaderDatabaseQuery(async statements=>{
    assert.equal(statements.length,1);
    const statement=statements[0], keys=Array.isArray(statement.params[0]) ? statement.params[0] as string[] : [];
    if (keys.some(key=>key.startsWith("STATE_LEGISLATOR:US:people:"))) return [[]];
    const family=keys.some(key=>key.startsWith("REGISTRY_RUNTIME_BINDING:")) ? "state" : statement.params[0] === "AZ" ? "place" : "auxiliary";
    order.push(family);
    await blocked;
    if (family === "state") return [stateRows("priority-state",[])];
    if (family === "place") return [[{ entities:[],fields:[],rosters:[],comments:[],sittings:[],meeting_rows:[],parts:{},governments:[],divisions:[],registration_held:false }]];
    return [[]];
  });
  try {
    const data=await withReaderSelection(selection("AZ"),()=>readBallotReaderData(ballotPlaceFromParams({zip:"85701"})));
    assert.ok(data);
    assert.deepEqual(order,["state","place","auxiliary","auxiliary","auxiliary","auxiliary"],
      "the local lookup reaches the shared pool before any ballot auxiliary group can occupy its connection slot");
    release!();
    await Promise.all([data.registryRead,data.districtRead]);
    assert.equal(order.length,6,"geographic qualification and registry composition add no follow-up lookup");
  } finally { release?.(); installReaderDatabaseQuery(undefined); }
});

test("an unavailable local territory file leaves the ballot's canonical families available", async () => {
  const { readBallotReaderData } = await import("../lib/ballot/reader-data.ts");
  const { ballotPlaceFromParams } = await import("../lib/ballot/reader-place.ts");
  const failure=new Error("The local territory file is unavailable");
  let auxiliaries=0;
  installReaderDatabaseQuery(async statements=>{
    const keys=statements[0].params[0] as string[];
    assert.ok(Array.isArray(keys),"a failed territory read cannot submit a local place query");
    if (keys.some(key=>key.startsWith("REGISTRY_RUNTIME_BINDING:"))) return [stateRows("territory-failure-state",[])];
    if (keys.some(key=>key.startsWith("STATE_LEGISLATOR:US:people:"))) return [[]];
    auxiliaries++;
    return [[]];
  });
  try {
    await withReaderSelection(selection("AZ"),async()=>{
      const data=await readBallotReaderData(ballotPlaceFromParams({zip:"85701"}),async()=>{ throw failure; });
      assert.ok(data,"a registry-local failure cannot abort ballot initialization");
      await assert.rejects(data.registryRead,error=>error === failure);
      await data.districtRead;
      assert.equal(auxiliaries,4,"all independent canonical ballot families still load");
      assert.equal((await readerCanonicalEntry("BALLOT_CANDIDACY",stateAuthorityPointers("ballot-contests","AZ")[0].scope))?.kind,"NOT_RECORDED");
    });
  } finally { installReaderDatabaseQuery(undefined); }
});

test("the selected funding slice survives later official aliases without another data read", async () => {
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
    reads++;
    assert.equal(statements.length, 1);
    const keys = statements[0].params[2] as readonly string[];
    assert.ok(keys.includes("ballot-az-federal-candidate"));
    assert.ok(!keys.includes("ballot-nh-candidate"));
    return [[structuredClone(row)]];
  });
  try {
    const place = selection("AZ");
    await withReaderSelection(place, async () => {
      await primeReaderProjection("FEC_FUNDING", contract.scope, ["ballot-az-federal-candidate"]);
      place.keys.add("congress:an-official-alias");
      assert.equal((await readPromotedCivicData("FEC_FUNDING", contract.scope)).kind, "PROMOTED");
      assert.equal(reads, 1);
    });
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
    if (originalReport === undefined) delete process.env.WTP_VITAL_SIGNS_REPORT; else process.env.WTP_VITAL_SIGNS_REPORT = originalReport;
    neonConfig.fetchFunction = originalFetch;
    installReaderDatabaseQuery(undefined);
  }
});
