import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { publishFederalMoneyPartition } from "../lib/federal-money/edge-publication.ts";
import { readFederalMoneyForPlace } from "../lib/federal-money/reader.ts";
import { compareFederalMoneyActions, federalMoneyLookupKeys, federalMoneyPartitionScope, type FederalMoneyFact, type FederalMoneyProjection } from "../lib/federal-money/model.ts";
import { FederalMoneyIndex, federalMoneyArtifactHash, federalMoneyPlaceKey, federalMoneySegmentOrder, readFederalMoneyJson,
  type FederalMoneyPlaceIndex, type FederalMoneyPlaceSnapshot, type FederalMoneySegmentArtifact } from "../lib/federal-money/edge.ts";

const COUNTY = "ocd-division/country:us/state:az/county:pima", BOARD = `${COUNTY}#supervisors`, ALIAS = "government:US-AZ:cog:123456";
const NOW = "2026-10-26T00:00:00.000Z";
function award(id: string, date: string | null, onlyAlias = false): FederalMoneyFact {
  return { id: `usaspending:${id}`, source: "usaspending", sourceId: id, state: "AZ", kind: "GRANT", title: "Housing assistance",
    amount: 100, amountLabel: "Federal obligation", recipient: "COUNTY OF PIMA", period: date, uei: null, identifiers: {}, geography: [],
    bodyIds: onlyAlias ? [ALIAS] : [BOARD, ALIAS], divisionIds: onlyAlias ? [] : [COUNTY], joinStatus: "JOINED", joinReason: "Held recipient government.",
    details: { actionDate: date, recipientState: "AZ" }, provenance: { sourceUrl: `https://www.usaspending.gov/award/${id}`,
      sourceOrg: "USAspending", publicationDate: NOW, retrievedAt: NOW, official: true, rawHash: "a".repeat(64) } };
}
function projection(records: readonly FederalMoneyFact[], shard: string): FederalMoneyProjection {
  return { formatVersion: 2, source: "usaspending", state: "AZ", partition: { year: "2026", place: COUNTY, shard }, records,
    lookupKeys: federalMoneyLookupKeys(records), counts: { loaded: records.length, joined: records.length, unjoined: 0 } };
}

test("the newest page merges overlapping partitions and recipient aliases, then reaches every award once", async t => {
  const directory = mkdtempSync(join(tmpdir(), "fm01-action-merge-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalFileArtifactStore(directory);
  const a = [award("a-new", "2026-01-01"), ...Array.from({ length: 100 }, (_, n) => award(`a-old-${String(n).padStart(3, "0")}`, "1900-01-01"))];
  const b = Array.from({ length: 100 }, (_, n) => award(`b-${String(n).padStart(3, "0")}`, n < 50 ? "2025-01-01" : "2024-01-01"));
  const alias = [award("alias-newest", "2027-01-01", true), award("undated", null, true)];
  for (const [records, shard] of [[a, "a"], [b, "b"], [alias, "c"]] as const) {
    await publishFederalMoneyPartition({ store, projection: projection(records, shard), previous: null, versionId: shard, checkedAt: NOW });
  }
  const target = { divisionId: COUNTY, bodyId: BOARD, bodyIds: [ALIAS], recipientNames: ["COUNTY OF PIMA"], recipientState: "AZ" };
  const expected = [...a, ...b, ...alias].sort(compareFederalMoneyActions);
  const held: FederalMoneyFact[] = [];
  let cursor: string | null = null, pages = 0;
  do {
    const started = performance.now();
    const response = await readFederalMoneyForPlace(target, { artifactStore: store, cursor });
    const current = response.sources[0].records;
    assert.ok(current.length > 0 && current.length <= 100);
    assert.deepEqual(current.map(fact => fact.id), expected.slice(held.length, held.length + current.length).map(fact => fact.id));
    if (pages === 0) {
      assert.equal(current[0].id, "usaspending:alias-newest");
      assert.ok(current.every(fact => fact.period !== "1900-01-01" && fact.period !== null), "an old tail never hides a newer award in another partition");
      await assert.rejects(readFederalMoneyForPlace({ ...target, recipientNames: ["Another government"] }, { artifactStore: store, cursor: response.nextCursor }), /page is invalid/);
    }
    assert.ok(performance.now() - started < 3000, "the complete selected page is usable within three seconds");
    held.push(...current); cursor = response.nextCursor; pages++;
  } while (cursor);
  assert.equal(pages, 3);
  assert.equal(new Set(held.map(fact => fact.id)).size, expected.length, "geography and both recipient aliases share each award once");
  assert.deepEqual(held.map(fact => fact.id), expected.map(fact => fact.id));
});

test("old published pages normalize award dates before the same reader merges them", async t => {
  const directory = mkdtempSync(join(tmpdir(), "fm01-old-action-order-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalFileArtifactStore(directory);
  const records = [...Array.from({ length: 100 }, (_, n) => award(`old-${n}`, "1900-01-01")), award("recent", "2026-01-01")];
  const current = projection(records, "a");
  await publishFederalMoneyPartition({ store, projection: current, previous: null, versionId: "old", checkedAt: NOW });
  const place = `division:${COUNTY}`, pointerKey = federalMoneyPlaceKey("AZ", place);
  const pointer = await store.readJsonPointer<FederalMoneyPlaceIndex>(pointerKey);
  const snapshot = await readFederalMoneyJson<FederalMoneyPlaceSnapshot>(store, pointer!.value.snapshot);
  const segmentId = federalMoneyPartitionScope(current.source, current.state, current.partition);
  const segments = new FederalMoneyIndex(store, `${pointerKey}:segments`), order = new FederalMoneyIndex(store, `${pointerKey}:order`);
  const segmentKey = await segments.get(snapshot.segments, segmentId);
  const modern = await readFederalMoneyJson<FederalMoneySegmentArtifact>(store, segmentKey!);
  const pages = [];
  for (let offset = 0; offset < records.length; offset += 100) {
    const plain = Buffer.from(JSON.stringify({ formatVersion: 2, state: "AZ", place, source: "usaspending", versionId: "old", records: records.slice(offset, offset + 100) }));
    pages.push({ key: await store.putImmutable(gzipSync(plain), "json.gz"), hash: federalMoneyArtifactHash(plain), count: Math.min(100, records.length - offset) });
  }
  const { actionOrderVersion: _version, latestActionDate: _date, latestActionId: _id, ...legacyFields } = modern;
  const legacy: FederalMoneySegmentArtifact = { ...legacyFields, pages };
  const legacyKey = await store.putImmutable(Buffer.from(JSON.stringify(legacy)), "json");
  snapshot.segments = await segments.set(snapshot.segments, segmentId, legacyKey);
  for (const period of ["*", "2026"]) {
    snapshot.order = await order.set(snapshot.order, `usaspending:${period}:${federalMoneySegmentOrder(modern)}`, null);
    snapshot.order = await order.set(snapshot.order, `usaspending:${period}:${federalMoneySegmentOrder(legacy)}`, legacyKey);
  }
  delete snapshot.legacyActionSegments;
  await store.writeJsonPointer(pointerKey, { ...pointer!.value, snapshot: await store.putImmutable(Buffer.from(JSON.stringify(snapshot)), "json") }, pointer!.etag);
  const result = await readFederalMoneyForPlace({ divisionId: COUNTY }, { artifactStore: store });
  assert.equal(result.sources[0].records.length, 100);
  assert.equal(result.sources[0].records[0].id, "usaspending:recent", "the award hidden on old page two is first on the reader's first request");
  assert.ok(result.nextCursor);
  const next = await readFederalMoneyForPlace({ divisionId: COUNTY }, { artifactStore: store, cursor: result.nextCursor });
  assert.equal(next.sources[0].records.length, 1);
  assert.equal(next.nextCursor, null);
  assert.equal(new Set([...result.sources[0].records, ...next.sources[0].records].map(fact => fact.id)).size, records.length);
});

test("a correction across recipient and geographic snapshots keeps one current award without dropping their other records", async t => {
  const directory = mkdtempSync(join(tmpdir(), "fm01-alias-revision-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalFileArtifactStore(directory);
  const a = projection([award("changed", "1900-01-01"), ...Array.from({ length: 99 }, (_, n) => award(`older-${n}`, "1901-01-01"))], "a");
  const b = projection(Array.from({ length: 100 }, (_, n) => award(`current-${n}`, "2025-01-01")), "b");
  for (const projection of [a, b]) await publishFederalMoneyPartition({ store, projection, previous: null, versionId: projection.partition.shard, checkedAt: NOW });
  const stale = await Promise.all([`division:${COUNTY}`, `body:${BOARD}`].map(async place => {
    const key = federalMoneyPlaceKey("AZ", place);
    return { key, pointer: await store.readJsonPointer<FederalMoneyPlaceIndex>(key) };
  }));
  const corrected = { ...a, records: a.records.map(fact => fact.sourceId === "changed" ? { ...fact, amount: 200, period: "2028-01-01",
    details: { ...fact.details, actionDate: "2028-01-01" }, provenance: { ...fact.provenance, retrievedAt: "2026-10-27T00:00:00.000Z" } } : fact) };
  await publishFederalMoneyPartition({ store, projection: corrected, previous: a, versionId: "corrected", checkedAt: "2026-10-27T00:00:00.000Z" });
  // The reader catches the publication between the alias and geographic writes.
  for (const { key, pointer } of stale) {
    const current = await store.readJsonPointer<FederalMoneyPlaceIndex>(key);
    await store.writeJsonPointer(key, pointer!.value, current!.etag);
  }
  const held: FederalMoneyFact[] = [];
  let cursor: string | null = null;
  do {
    const result = await readFederalMoneyForPlace({ divisionId: COUNTY, bodyId: BOARD, bodyIds: [ALIAS] }, { artifactStore: store, cursor });
    assert.ok(result.sources[0].records.length > 0);
    held.push(...result.sources[0].records); cursor = result.nextCursor;
  } while (cursor);
  const expected = [...corrected.records, ...b.records].sort(compareFederalMoneyActions);
  assert.deepEqual(held.map(fact => fact.id), expected.map(fact => fact.id));
  assert.equal(held.filter(fact => fact.sourceId === "changed").length, 1);
  assert.equal(held[0].amount, 200);
  assert.equal(held[0].period, "2028-01-01");
});
