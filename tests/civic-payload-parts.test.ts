import assert from "node:assert/strict";
import test from "node:test";
import { CivicPayloadParts, partitionCivicPayload, type CivicPayloadPartIO } from "../lib/civic-data/payload-parts.ts";

const inline = ["id", "sourceId", "recordClass", "scope", "retrieval", "normalization", "temporal"];
const row = (state: string, index: number) => ({ id: `ocd-division/country:us/state:${state}/place:${index}`,
  name: `${state} verified public body ${index}`, source: `https://${state}.example.gov/${index}`, text: `${state} official content ${index} ` + "published ".repeat(500) });
function memoryParts() {
  const saved = new Map<string, unknown>();
  const writes: { hash: string; payload: unknown }[][] = [];
  const reads: string[][] = [];
  const io: CivicPayloadPartIO = {
    existing: async hashes => hashes.filter(hash => saved.has(hash)),
    write: async parts => { writes.push([...parts]); parts.forEach(part => saved.set(part.hash, structuredClone(part.payload))); },
    read: async hashes => { reads.push([...hashes]); return hashes.flatMap(hash => saved.has(hash) ? [{ hash, payload: saved.get(hash) }] : []); },
  };
  return { saved, writes, reads, io };
}

test("a large registry plus one new state writes only new state records and small reference metadata", async () => {
  const memory = memoryParts();
  const parts = new CivicPayloadParts(memory.io);
  const registry = { formatVersion: 1, divisions: [...Array.from({ length: 200 }, (_, index) => row("az", index)),
    ...Array.from({ length: 200 }, (_, index) => row("nh", index))] };
  const payload = { registry, bodyRosters: [], statewideExecutives: [] };
  const candidate = { id: "before", recordClass: "REGISTRY_RUNTIME_BINDING", retrieval: { succeeded: true, retrievedAt: "2026-09-30" },
    normalizedPayload: payload, readModel: payload };
  const before = await parts.store(candidate, inline);
  assert.equal(JSON.stringify(before).includes("official content"), false);
  const firstWrites = memory.writes.length;
  const nextPayload = { ...payload, registry: { ...registry, divisions: [...registry.divisions.slice(0, 200), row("oh", 0), ...registry.divisions.slice(200)] },
    statewideExecutives: [{ state: "OH", officeTitle: "Governor", name: "Verified holder", sourceUrl: "https://ohio.example.gov" }] };
  const next = { ...candidate, id: "after", readModel: nextPayload, normalizedPayload: nextPayload };
  const stored = await parts.store(next, inline);
  const added = memory.writes.slice(firstWrites).flat();
  assert.ok(added.length > 0);
  assert.ok(!JSON.stringify(added).includes("az official content") && !JSON.stringify(added).includes("nh official content"), "prior state rows are references only");
  assert.ok(Buffer.byteLength(JSON.stringify(added)) < 30_000, "one new state's rows do not rewrite the multi-megabyte national data");
  const freshReader = new CivicPayloadParts(memory.io);
  assert.deepEqual(await freshReader.load(stored), next, "canonical typed readers get the complete exact JSON");
  assert.deepEqual(await freshReader.load(before), candidate, "the previous immutable edition still reads");
  assert.ok(memory.reads.every(hashes => hashes.length <= 8));
});

test("identical evidence and reader payloads share parts, and unchanged values write nothing", async () => {
  const memory = memoryParts();
  const parts = new CivicPayloadParts(memory.io);
  const payload = { divisions: Array.from({ length: 50 }, (_, index) => row("az", index)) };
  const single = partitionCivicPayload({ readModel: payload }, inline);
  const duplicate = partitionCivicPayload({ readModel: payload, normalizedPayload: payload }, inline);
  assert.equal(single.parts.length, duplicate.parts.length);
  await parts.store(payload);
  const count = memory.writes.length;
  await parts.store(payload);
  assert.equal(memory.writes.length, count);
});

test("a payload over Neon's request limit is lossless and every part write remains bounded", async () => {
  const memory = memoryParts();
  const parts = new CivicPayloadParts(memory.io);
  const payload = { giantPublishedText: '"🙂\\'.repeat(9_000_000) };
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) > 64 * 1024 * 1024);
  const stored = await parts.store(payload);
  assert.ok(memory.writes.every(batch => Buffer.byteLength(JSON.stringify(batch)) < 3 * 1024 * 1024));
  assert.deepEqual(await new CivicPayloadParts(memory.io).load(stored), payload);
});

test("missing storage parts report failure and old inline candidates remain readable", async () => {
  const memory = memoryParts();
  const parts = new CivicPayloadParts(memory.io);
  const inlineCandidate = { id: "legacy", readModel: { officials: [{ name: "Held official" }] } };
  assert.deepEqual(await parts.load(inlineCandidate), inlineCandidate);
  assert.equal(memory.reads.length, 0);
  const stored = await parts.store({ text: "x".repeat(100_000) });
  memory.saved.clear();
  await assert.rejects(() => new CivicPayloadParts(memory.io).load(stored), /CIVIC_PAYLOAD_PART_MISSING/);
});

test("a load assembles parts as they arrive, writing caches nothing, and recent parts are reused without another read", async () => {
  const memory = memoryParts();
  const parts = new CivicPayloadParts(memory.io);
  const payload = { divisions: Array.from({ length: 300 }, (_, index) => row("wi", index)) };
  const stored = await parts.store({ id: "wi", normalizedPayload: payload }, ["id"]);
  assert.deepEqual(await parts.load(stored), { id: "wi", normalizedPayload: payload });
  const firstReads = memory.reads.flat().length;
  assert.ok(firstReads > 0, "a write keeps no parts in memory; the first load reads them");
  assert.deepEqual(await parts.load(stored), { id: "wi", normalizedPayload: payload });
  assert.equal(memory.reads.flat().length, firstReads, "parts just read are served from the bounded cache");
  assert.ok(memory.reads.every(batch => batch.length <= 8));
});

test("partitioning keeps the caller's rows rather than copying the record, and still drops undefined fields exactly as JSON does", () => {
  const rows = Array.from({ length: 400 }, (_, index) => row("az", index));
  const { parts } = partitionCivicPayload({ id: "c", retrieval: { at: "2026-10-01", skipped: undefined }, readModel: { rows } }, inline);
  const held = parts.flatMap(part => Array.isArray(part.payload) ? part.payload : []);
  assert.equal(held.length, rows.length);
  assert.ok(held.every((value, index) => value === rows[index]), "each stored row is the caller's own object");
  const loose = { id: "d", readModel: { rows: rows.map(value => ({ ...value, note: undefined })) } };
  const copied = partitionCivicPayload(loose, inline).parts.flatMap(part => Array.isArray(part.payload) ? part.payload : []);
  assert.ok(copied.every(value => !("note" in (value as object))), "a row carrying undefined is written without it");
});
