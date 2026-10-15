import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { federalMoneyPlaceKey, type FederalMoneyPlaceIndex } from "../lib/federal-money/edge.ts";
import { federalMoneyLookupKeys, type FederalMoneyProjection } from "../lib/federal-money/model.ts";
import { parseFederalMoney } from "../lib/federal-money/parse.ts";
import { readFederalMoneyForPlace } from "../lib/federal-money/reader.ts";
import { publishFederalMoneyPartition, publishFederalMoneyProgress } from "../lib/federal-money/edge-publication.ts";
import { LocalFileArtifactStore, type ReaderArtifactStore } from "../lib/meetings/edge-store.ts";

const NOW = "2026-10-12T23:01:00.000Z";
const COUNTY = "ocd-division/country:us/state:ar/county:ouachita";
const FOREIGN = "ocd-division/country:us/state:ar/county:pulaski";
const body = readFileSync(new URL("./fixtures/federal-money/openfema-live.json", import.meta.url), "utf8");
const capture = { url: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=1", rawHash: createHash("sha256").update(body).digest("hex"), vaultKey: "fixture", byteLength: Buffer.byteLength(body), format: "json" as const, retrievedAt: NOW, publicationDate: null };
const native = parseFederalMoney("openfema", capture, "AR", body)[0];
function partition(place = COUNTY, count = 1, shard = ""): FederalMoneyProjection {
  const records = Array.from({ length: count }, (_, index) => ({ ...native, id: `openfema:${shard}-${index}`, sourceId: `${shard}-${index}`, divisionIds: [place], joinStatus: "JOINED" as const, joinReason: "Exact county FIPS." }));
  return { formatVersion: 2, source: "openfema", state: "AR", partition: { year: "2026", place, shard }, records, lookupKeys: federalMoneyLookupKeys(records), counts: { loaded: count, joined: count, unjoined: 0 } };
}
function trace(store: LocalFileArtifactStore, reads: string[], writes: string[] = []): ReaderArtifactStore {
  return new Proxy(store, { get(target, key) {
    if (key === "readBytes") return async (path: string) => { reads.push(path); return target.readBytes(path); };
    if (key === "readJsonPointer") return async (path: string) => { reads.push(path); return target.readJsonPointer(path); };
    if (key === "writeJsonPointer") return async (path: string, value: unknown, etag: string | null) => { writes.push(path); return target.writeJsonPointer(path, value, etag); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
}

test("one place loads only its index, status and first bounded page; all later records remain reachable", async t => {
  const directory = mkdtempSync(join(tmpdir(), "federal-edge-place-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalFileArtifactStore(directory);
  for (const projection of [partition(COUNTY, 500), partition(FOREIGN, 500)]) await publishFederalMoneyPartition({ store, projection, previous: null, versionId: projection.partition.place, checkedAt: NOW });
  await publishFederalMoneyProgress({ store, state: "AR", source: "openfema", complete: true, reason: null, checkedAt: NOW });
  const reads: string[] = [];
  const artifactStore = trace(store, reads);
  const first = await readFederalMoneyForPlace({ divisionId: COUNTY }, { artifactStore });
  assert.equal(first.sources[3].records.length, 100);
  assert.equal(first.sources[3].coverageComplete, true);
  assert.ok(first.nextCursor);
  assert.equal(reads.length, 3);
  assert.equal(reads[0], federalMoneyPlaceKey("AR", `division:${COUNTY}`));
  assert.ok(reads.every(key => !key.includes(federalMoneyPlaceKey("AR", `division:${FOREIGN}`))));
  const held = new Set(first.sources[3].records.map(row => row.id));
  let cursor: string | null = first.nextCursor;
  while (cursor) {
    const next = await readFederalMoneyForPlace({ divisionId: COUNTY }, { artifactStore, cursor });
    assert.ok(next.sources[3].records.length <= 100);
    for (const row of next.sources[3].records) held.add(row.id);
    cursor = next.nextCursor;
  }
  assert.equal(held.size, 500);
  assert.equal(await store.readManifest(), null, "there is no national or state record manifest");
});

test("only a changed place segment writes; removed joins clear that segment and leave other places untouched", async t => {
  const directory = mkdtempSync(join(tmpdir(), "federal-edge-change-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalFileArtifactStore(directory);
  const before = partition();
  await publishFederalMoneyPartition({ store, projection: before, previous: null, versionId: "v1", checkedAt: NOW });
  const writes: string[] = [];
  const tracked = trace(store, [], writes);
  assert.equal((await publishFederalMoneyPartition({ store: tracked, projection: before, previous: before, versionId: "v1", checkedAt: NOW })).bytesWritten, 0);
  assert.deepEqual(writes, []);
  const after = { ...before, records: [], lookupKeys: [], counts: { loaded: 0, joined: 0, unjoined: 0 } };
  await publishFederalMoneyPartition({ store: tracked, projection: after, previous: before, versionId: "v2", checkedAt: NOW });
  assert.deepEqual(writes, [federalMoneyPlaceKey("AR", `division:${COUNTY}`)]);
  const pointer = await store.readJsonPointer<FederalMoneyPlaceIndex>(writes[0]);
  assert.deepEqual(pointer!.value.segments, {});
});

test("missing or corrupted page bytes are unavailable without opening a database", async t => {
  const directory = mkdtempSync(join(tmpdir(), "federal-edge-missing-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalFileArtifactStore(directory);
  await publishFederalMoneyPartition({ store, projection: partition(), previous: null, versionId: "v1", checkedAt: NOW });
  const artifactStore = new Proxy(store, { get(target, key) {
    if (key === "readBytes") return async () => null;
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const read = await readFederalMoneyForPlace({ divisionId: COUNTY }, { artifactStore });
  assert.equal(read.sources[3].status, "UNAVAILABLE");
  assert.equal(read.sources[0].status, "NOT_HELD");
});

test("place pagination rejects a cursor copied from another government", async t => {
  const directory = mkdtempSync(join(tmpdir(), "federal-edge-cursor-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactStore = new LocalFileArtifactStore(directory);
  await publishFederalMoneyPartition({ store: artifactStore, projection: partition(COUNTY, 500), previous: null, versionId: "v1", checkedAt: NOW });
  const read = await readFederalMoneyForPlace({ divisionId: COUNTY }, { artifactStore });
  await assert.rejects(readFederalMoneyForPlace({ divisionId: FOREIGN }, { artifactStore, cursor: read.nextCursor }), /page is invalid/);
});

test("a historical Ask year opens that year's place page without reading newer years", async t => {
  const directory = mkdtempSync(join(tmpdir(), "federal-edge-year-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalFileArtifactStore(directory);
  for (const year of ["2015", "2026"]) {
    const current = partition();
    const projection = { ...current, partition: { ...current.partition, year }, records: current.records.map(row => ({ ...row, period: year, provenance: { ...row.provenance, publicationDate: `${year}-01-01T00:00:00.000Z` } })) };
    await publishFederalMoneyPartition({ store, projection, previous: null, versionId: year, checkedAt: NOW });
  }
  const reads: string[] = [];
  const read = await readFederalMoneyForPlace({ divisionId: COUNTY }, { artifactStore: trace(store, reads), year: "2015" });
  assert.equal(read.sources[3].records[0].period, "2015");
  assert.equal(read.nextCursor, null);
  assert.equal(reads.filter(key => key.endsWith("json.gz")).length, 1);
});
