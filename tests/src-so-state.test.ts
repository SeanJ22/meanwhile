import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { MemoryRoutineDataStore, PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { readOpenDataArea } from "../lib/sources/open-data/area-read.ts";
import { readOpenDataProjection, publishOpenData } from "../lib/sources/open-data/publication.ts";
import { createOpenDataPublicationIndex } from "../lib/sources/open-data/publication-index.ts";
import { OpenDataSpool } from "../lib/sources/open-data/spool.ts";
import { createSocrataGovernmentIndex } from "../lib/sources/open-data/government-index.ts";
import { normalizeEcho, normalizeSocrata, openDataReports } from "../lib/sources/open-data/normalize.ts";
import { parseCatalogPage } from "../lib/sources/open-data/acquire.ts";
import { ECHO_EXPORT, type OpenDataPartitionRef } from "../lib/sources/open-data/model.ts";
import { facilityCell } from "../lib/sources/open-data/geography.ts";
import { saveOpenDataPartition } from "../lib/sources/open-data/artifacts.ts";
import { readerOpenData } from "../lib/sources/open-data/reader.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { lookupZcta } from "../lib/geo/zcta.ts";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";
import { repairFanOutReaderReadbacks } from "../lib/civic-data/fanout-reader-repair.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import type { ReaderReadbackRepairOutcome } from "../lib/civic-data/reader-verification.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { AGGREGATE_LIST_READ_PAGE, pgFieldManualRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { newFieldManualEntry, normalizeEntry, readFieldManual } from "../lib/control-plane/field-manual.ts";
import { publicKindOwedForDivisions, readPublicKindOwed } from "../lib/coverage/public-kind-owed.ts";
import { recordNewPublicKinds } from "../lib/civic-data/public-records.ts";
import type { PublicRecord } from "../lib/civic-data/types.ts";

const NOW = "2026-10-19T00:00:00Z";
const reference = (id: string, index: number): OpenDataPartitionRef => {
  const sha256 = index.toString(16).padStart(64, "0");
  return { id, sha256, key: `project/freshness/source/epa-echo/reader/${sha256}.json`, count: 1 };
};

test("open-data reads legacy and current references inside exact state/place SQL slices and retains their original proof", async () => {
  const pg = new PGlite(), store = Object.create(PostgresRoutineDataStore.prototype) as PostgresRoutineDataStore;
  const own = reference("zip:85701:state:AZ", 1), foreign = Array.from({ length: 2_000 }, (_, i) => reference(`zip:foreign-country-record-${i}:state:NJ`, i + 2));
  const payload = { kind: "open-data", sourceId: "epa-echo", records: [], reports: [], partitions: [...foreign, own] };
  const encoded = partitionCivicPayload(payload);
  let transferred = "";
  try {
    await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)", [part.hash, JSON.stringify(part.payload)]);
    await insertPublishedSliceFixture(pg, { id: "legacy", sourceId: "epa-echo", recordClass: "CURATED_READER_RECORD", scope: "epa-echo:national", readModel: payload, storedReadModel: encoded.value, at: NOW });
    installReaderDatabaseQuery(async statements => Promise.all(statements.map(async statement => {
      const rows = (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows;
      transferred += JSON.stringify(rows); return rows;
    })));
    const legacy = await readOpenDataArea("epa-echo", "AZ", ["zip:85701"], { store });
    assert.equal(legacy.kind, "PROMOTED");
    if (legacy.kind !== "PROMOTED") throw new Error("legacy publication missing");
    assert.deepEqual(legacy.value.partitions, [own]);
    assert.equal(legacy.sourceInputs?.[0].readModelSha256, canonicalCivicDataHash(payload));
    assert.ok(!transferred.includes("foreign-country-record"), "country reference IDs and payload parts never cross the connection");
    const newer = reference(own.id, 9_000), otherPlace = reference("zip:other-arizona-place:state:AZ", 9_001);
    const statePayload = { ...payload, partitions: [newer, otherPlace] };
    await insertPublishedSliceFixture(pg, { id: "state", sourceId: "epa-echo", recordClass: "CURATED_READER_RECORD", scope: "epa-echo:state:AZ", readModel: statePayload, at: NOW });
    transferred = "";
    const current = await readOpenDataArea("epa-echo", "AZ", ["zip:85701"], { store });
    assert.equal(current.kind, "PROMOTED");
    if (current.kind !== "PROMOTED") throw new Error("state publication missing");
    assert.deepEqual(current.value.partitions, [newer]);
    assert.deepEqual(current.sourceInputs?.map(input => input.versionId), ["state", "legacy"]);
    assert.ok(!transferred.includes("foreign-country-record") && !transferred.includes("other-arizona-place"));
    await assert.rejects(readOpenDataProjection("epa-echo", "national", { store }), /AREA_REQUIRED/);
  } finally { installReaderDatabaseQuery(undefined); await pg.close(); }
});

test("EPA nearby cells and shared ZIPs never bring another state's facilities into the reader", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), point = lookupZcta("85701")!;
  const raw = { REGISTRY_ID: "own", FAC_NAME: "Own Arizona facility", FAC_STATE: "AZ", FAC_ZIP: "85702", FAC_LAT: String(point.lat), FAC_LONG: String(point.lng) };
  const own = normalizeEcho(raw, NOW, NOW), foreign = normalizeEcho({ ...raw, REGISTRY_ID: "foreign", FAC_NAME: "Other state facility", FAC_STATE: "NM", FAC_ZIP: "85701" }, NOW, NOW);
  const captures = [own, foreign].map(row => ({ url: ECHO_EXPORT, retrievedAt: NOW, rawHash: row.id, sourceRows: [row.sourceRow] }));
  const cell = facilityCell(point.lat, point.lng);
  const ownRef = await saveOpenDataPartition({ source: "epa-echo", partition: `${cell}:state:AZ`, rows: [own], captures: [captures[0]], now: NOW }, vault);
  const foreignRef = await saveOpenDataPartition({ source: "epa-echo", partition: `${cell}:state:NM`, rows: [foreign], captures: [captures[1]], now: NOW }, vault);
  await publishOpenData({ store, source: "epa-echo", partition: "state:AZ", rows: [], reports: openDataReports([own]), partitions: [ownRef], captures, now: NOW });
  await publishOpenData({ store, source: "epa-echo", partition: "state:NM", rows: [], reports: openDataReports([foreign]), partitions: [foreignRef], captures, now: NOW });
  await assert.rejects(publishOpenData({ store, source: "epa-echo", partition: "state:AZ", rows: [], reports: openDataReports([own]), partitions: [foreignRef], captures, now: NOW }), /STATE_BOUNDARY/);
  const get = vault.get.bind(vault), opened: string[] = [];
  vault.get = async key => { opened.push(key); return get(key); };
  const read = await readerOpenData({ zip: "85701", divisionIds: ["ocd-division/country:us/state:az"] }, { store, vault });
  assert.deepEqual(read.records.map(row => row.id), [own.id]);
  assert.deepEqual(opened, [ownRef.key], "the other state's artifact is excluded before download");
  await assert.rejects(readerOpenData({ divisionIds: ["ocd-division/country:us/state:az", "ocd-division/country:us/state:nm"] }, { store, vault }), /STATE_BOUNDARY/);
});

test("disk source/partition inventories preserve all places and unresolved native pages without a national release array", async () => {
  const spool = await OpenDataSpool.create(), refs = await createOpenDataPublicationIndex(), joins = await createSocrataGovernmentIndex();
  const raw = parseCatalogPage(readFileSync(new URL("./fixtures/src-so/socrata-ny.json", import.meta.url), "utf8")).rows[0];
  const row = normalizeSocrata(raw, NOW), store = new MemoryRoutineDataStore();
  try {
    for (let i = 0; i < 1_000; i++) {
      const id = `place-${i}`, ref = reference(id, i + 1);
      refs.append(i % 2 ? "NY" : "AZ", ref);
      joins.addDomain(`${i}.ny.gov`);
      await spool.append(id, { ...row, id }, { url: row.sourceUrl, retrievedAt: NOW, rawHash: row.id });
    }
    assert.equal([...refs.forState("AZ")].length, 500);
    assert.equal(joins.domains.has("999.ny.gov"), true);
    let domains = 0; for (const _domain of joins.domains.withinHost("ny.gov")) domains++; assert.equal(domains, 1_000);
    let places = 0; for await (const partition of spool.partitions({ pageRows: 2 })) { assert.equal(partition.rows.length, 1); places++; } assert.equal(places, 1_000);
    const capture = { url: ECHO_EXPORT, retrievedAt: NOW, rawHash: "fixture", sourceRows: [] };
    const unresolved = reference("unlocated:UNRESOLVED:page:0", 8_000);
    const native = await publishOpenData({ store, source: "epa-echo", partition: "native:unlocated:UNRESOLVED:page:0", rows: [], reports: [{ id: "state:UNRESOLVED", state: "UNRESOLVED", loaded: 1, joined: 0, unjoined: 1 }], partitions: [unresolved], captures: [capture], now: NOW });
    assert.ok(native.outcome.promoted);
    const release = await publishOpenData({ store, source: "epa-echo", rows: [], reports: [{ id: "state:UNRESOLVED", state: "UNRESOLVED", loaded: 1, joined: 0, unjoined: 1 }], stateScopes: ["epa-echo:state:AZ"], captures: [capture], now: NOW });
    assert.equal((release.candidate.readModel as { partitions?: unknown }).partitions, undefined);
    assert.equal((await readOpenDataProjection("epa-echo", "native:unlocated:UNRESOLVED:page:0", { store })).kind, "PROMOTED");
    await assert.rejects(publishOpenData({ store, source: "epa-echo", rows: [], partitions: [unresolved], captures: [capture], now: NOW }), /COUNTS_ONLY/);
  } finally { await spool.dispose(); await refs.dispose(); await joins.dispose(); }
});

test("open-data repair visits only bounded release, state and native pointers while legacy data stays SQL-sliced", async () => {
  for (const source of ["socrata-discovery", "epa-echo"] as const) {
    const contract = requiredRoutineContract(source), store = new MemoryRoutineDataStore(), visited: string[] = [];
    const scopes = [`${source}:national`, `${source}:release`, `${source}:state:AZ`, `${source}:native:unresolved:page:0`, `${source}:unbounded-old-domain`];
    store.listPromotionScopes = async () => scopes.map(scope => ({ recordClass: "CURATED_READER_RECORD", scope }));
    const result = await repairFanOutReaderReadbacks({ store, contract, now: NOW, repair: async part => {
      visited.push(part.scope); return { kind: "CURRENT", receipt: { status: "PASS" } } as ReaderReadbackRepairOutcome;
    } });
    assert.deepEqual(visited, scopes.slice(1, 4)); assert.equal(result.passed, 3);
  }
});

test("every native public kind remains standing work for its exact place beyond the worker context page", async () => {
  const pg = new PGlite(), own = "ocd-division/country:us/state:ny", foreign = "ocd-division/country:us/state:wa";
  const transferred: unknown[] = [];
  let maxRows = 0;
  try {
    await pg.exec("CREATE TABLE cp_field_manual_entries(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb,changed_at timestamptz DEFAULT now())");
    const sql: Sql = { query: async (text, params) => {
      const rows = (await pg.query(text, params ? [...params] : [])).rows;
      maxRows = Math.max(maxRows, rows.length); transferred.push(rows); return rows;
    } };
    const repos = { ...createMemoryRepositories(), fieldManual: pgFieldManualRepository(sql) };
    repos.fieldManual.slice = async () => { throw new Error("a machine queue never collects a full manual slice"); };
    const records: PublicRecord[] = Array.from({ length: 80 }, (_, n) => ({ id: `native-catalog-${n}`, kind: "PUBLIC_RECORD", bodyId: null, ocdId: own,
      kindLabel: `Native source kind ${n}`, title: `Dataset ${n}`, sourceSentence: `Dataset ${n} publishes Native source kind ${n}.`,
      sourceUrl: `https://data.ny.gov/d/native-catalog-${n}`, capturedAt: NOW }));
    await recordNewPublicKinds(repos, records, NOW);
    const context = await readFieldManual(repos, { role: "SHARED", recordClass: "PUBLIC_RECORD", kinds: ["PUBLIC_RECORD_PLACE_KIND"], ocdIds: [own] });
    assert.equal(context.error, undefined);
    assert.equal(context.store.entries.length, 40, "the worker's context stays a bounded page");
    assert.equal(publicKindOwedForDivisions(context.store.entries, [own]).length, 40, "projected manual rows retain each kind's timed source and exact place");
    const other = normalizeEntry(newFieldManualEntry("public-place-kinds", "foreign", { role: "SHARED", kind: "PUBLIC_RECORD_PLACE_KIND", title: "Other place", summary: "Other place",
      outcome: "YIELDED", recordClasses: ["PUBLIC_RECORD"], ocdIds: [foreign], payload: { divisionId: foreign, kindLabel: "Other place", owedSince: NOW,
        sourceUrl: "https://data.wa.gov/d/foreign", firstRecordId: "FOREIGN_NATIVE_ID", evidence: "UNRELATED_COUNTRY_RECORD ".repeat(20_000) } }));
    await pg.query("INSERT INTO cp_field_manual_entries VALUES($1,1,$2,$3,now())", [other.id, NOW, JSON.stringify(other)]);
    await pg.query("UPDATE cp_field_manual_entries SET value=jsonb_set(value,'{payload,evidence}',to_jsonb($1::text)) WHERE value->>'kind'='PUBLIC_RECORD_PLACE_KIND' AND value#>>'{payload,firstRecordId}'='native-catalog-0'", ["UNNEEDED_SOURCE_BODY ".repeat(20_000)]);
    transferred.length = 0;
    await recordNewPublicKinds(repos, records, "2026-10-19T01:00:00Z");
    const owed = await readPublicKindOwed(repos, [own]);
    assert.equal(owed.length, records.length, "the machine queue retains every own-place kind past the context limit");
    assert.deepEqual(owed.map(row => row.firstRecordId).sort(), records.map(row => row.id).sort());
    assert.ok(owed.every(row => row.divisionId === own && row.owedSince === NOW && row.sourceUrl === records.find(record => record.id === row.firstRecordId)!.sourceUrl));
    const count = (await pg.query<{ count: string }>("SELECT count(*) FROM cp_field_manual_entries WHERE value->>'kind'='PUBLIC_RECORD_PLACE_KIND' AND value#>>'{payload,divisionId}'=$1", [own])).rows[0].count;
    assert.equal(Number(count), records.length, "rechecking the source reuses every existing place-kind row");
    assert.ok(maxRows <= AGGREGATE_LIST_READ_PAGE);
    assert.doesNotMatch(JSON.stringify(transferred), /UNRELATED_COUNTRY_RECORD|UNNEEDED_SOURCE_BODY|FOREIGN_NATIVE_ID/);
  } finally { await pg.close(); }
});
