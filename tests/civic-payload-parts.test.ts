import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { CivicPayloadParts, type CivicPayloadPartIO } from "../lib/civic-data/payload-parts.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";

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

test("owned preloaded parts hydrate shared rows without IO and release their input map", async () => {
  const payload = { rows: Array.from({ length: 40 }, (_, index) => row("az", index)) };
  const plan = partitionCivicPayload({ first: payload, second: payload });
  const preloaded = Object.fromEntries(plan.parts.map(part => [part.hash, part.payload]));
  const loader = new CivicPayloadParts({ existing: async () => [], write: async () => {}, read: async () => { throw new Error("unexpected IO"); } });
  const decoded = await loader.loadOwned(plan.value, preloaded) as { first: typeof payload; second: typeof payload };
  assert.deepEqual(decoded.first, payload);
  assert.equal(decoded.first, decoded.second);
  assert.deepEqual(preloaded, {});
  for (const [parts, error] of [
    [{}, /PART_MISSING/],
    [{ bad: { $civicPayloadPart: "bad" } }, /PART_CYCLE/],
    [{ bad: { kind: "array", groups: [[]], order: "[1]" } }, /PART_ORDER_INVALID/],
  ] as const) {
    const input = structuredClone(parts);
    await assert.rejects(() => loader.loadOwned({ $civicPayloadPart: "bad" }, input), error);
    assert.deepEqual(input, {});
  }
});

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
  assert.deepEqual(partitionCivicPayload({ readModel: payload }, inline, ["readModel"]), single, "large roots retain their existing parts and hashes");
  const duplicate = partitionCivicPayload({ readModel: payload, normalizedPayload: payload }, inline);
  assert.equal(single.parts.length, duplicate.parts.length);
  await parts.store(payload);
  const count = memory.writes.length;
  await parts.store(payload);
  assert.equal(memory.writes.length, count);
});

test("durable JSON normalization preserves encoded part bytes, hashes and property order", async () => {
  const input = { integerKeys: { 10: "ten", 2: "two", z: undefined, a: "first" }, checkedAt: new Date("2026-10-16T12:00:00Z"),
    values: [undefined, NaN, Infinity, -0, , "🙂\ud800"],
    rows: Array.from({ length: 160 }, (_, index) => ({ id: `US-${index % 2 ? "NH" : "AZ"}:district:${index}`,
      text: 'Unicode🙂 "\\\n'.repeat(100), missing: undefined })), text: '"🙂\\'.repeat(12_000),
    custom: { toJSON(key: string) { return { key, when: "2026-10-16" }; } } };
  const plan = partitionCivicPayload(input);
  assert.equal(plan.parts.length, 7);
  assert.deepEqual(plan.value, { $civicPayloadPart: "5c931e1c8a6677bd51390607c57ada33885dc14529db2462e9cdf61a8a5afb19" });
  assert.equal(createHash("sha256").update(JSON.stringify(plan)).digest("hex"), "535217574b4394f0e28600f7663d85a3db6f59ab08ea6d658b340961caf37856");
  const held = new Map(plan.parts.map(part => [part.hash, part.payload]));
  const reader = new CivicPayloadParts({ existing: async () => [], write: async () => {},
    read: async hashes => hashes.map(hash => ({ hash, payload: held.get(hash) })) });
  assert.deepEqual(await reader.load(plan.value), JSON.parse(JSON.stringify(input)));
});

test("a large state unit shares unchanged records and never serializes an input container or giant scalar", async t => {
  const input = { rows: Array.from({ length: 300 }, (_, id) => ({ id, state: "IL", text: "Published fact ".repeat(80) })),
    text: '🗳️"\\\n'.repeat(150_000), optional: undefined };
  const stringify = JSON.stringify;
  t.mock.method(JSON, "stringify", (value: unknown) => {
    assert.ok(value === null || typeof value !== "object", "partitioning cannot stringify a whole input container");
    assert.ok(typeof value !== "string" || value.length <= 32 * 1024, "string probes and hashes stay bounded");
    return stringify(value);
  });
  const plan = partitionCivicPayload(input);
  assert.ok(plan.parts.some(part => Array.isArray(part.payload) && part.payload.includes(input.rows[0])), "unchanged records share their original object");
  t.mock.restoreAll();
  const held = new Map(plan.parts.map(part => [part.hash, part.payload]));
  const reader = new CivicPayloadParts({ existing: async () => [], write: async () => {},
    read: async hashes => hashes.map(hash => ({ hash, payload: held.get(hash) })) });
  assert.deepEqual(await reader.load(plan.value), { rows: input.rows, text: input.text });
});

test("durable normalization calls key-sensitive toJSON once and refuses non-JSON roots and cycles", () => {
  const calls: string[] = [], custom = { toJSON(key: string) { calls.push(key); return { key }; } };
  const value = { before: custom, after: custom, boxed: new Number(4), boolean: new Boolean(false), string: new String("held") };
  assert.deepEqual(partitionCivicPayload(value).value, { before: { key: "before" }, after: { key: "after" }, boxed: 4, boolean: false, string: "held" });
  assert.deepEqual(calls, ["before", "after"]);
  let conversions = 0;
  const selfReturning = Object.defineProperty({ value: "held" }, "toJSON", { value() { conversions++; return this; } });
  const durable = partitionCivicPayload(selfReturning).value;
  assert.equal(JSON.stringify(durable), '{"value":"held"}');
  assert.equal(conversions, 1, "encoding strips a non-enumerable toJSON hook before persistence");
  const cyclic: Record<string, unknown> = { text: "long".repeat(20_000) }; cyclic.self = cyclic;
  assert.throws(() => partitionCivicPayload(cyclic), /circular/);
  for (const invalid of [undefined, Symbol("invalid"), BigInt(1)]) assert.throws(() => partitionCivicPayload(invalid), TypeError);
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

test("owned hydration reuses decoded rows across a part DAG without caching or serializing them", async t => {
  const ref = (hash: string) => ({ $civicPayloadPart: hash });
  const encoded = new Map<string, unknown>([
    ["parent", { kind: "object", value: { id: "parent", shared: ref("leaf") } }],
    ["leaf", { id: "leaf", evidence: { source: "https://example.gov/official" } }],
    ["array", { kind: "array", groups: [ref("group")], order: "[0,0]" }],
    ["group", [ref("leaf"), { id: "inline", shared: ref("leaf") }]],
  ]);
  const received = new Map<string, unknown>(), reads: string[][] = [];
  const parts = new CivicPayloadParts({ existing: async () => [], write: async () => {}, read: async hashes => {
    reads.push([...hashes]);
    return hashes.map(hash => {
      const payload = structuredClone(encoded.get(hash));
      received.set(hash, payload);
      return { hash, payload };
    });
  } });
  const source = () => ({ head: ref("parent"), shared: ref("leaf"), rows: ref("array"), inline: { held: true } });
  const input = source(), originalInline = input.inline;
  t.mock.method(JSON, "stringify", () => assert.fail("owned hydration must not serialize decoded or encoded parts"));
  const output = await parts.loadOwned(input) as { head: { shared: unknown }; shared: { evidence: object }; rows: unknown[]; inline: object };
  assert.equal(output, input);
  assert.equal(output.inline, originalInline);
  assert.equal(output.head, (received.get("parent") as { value: unknown }).value);
  assert.equal(output.shared, received.get("leaf"));
  assert.equal(output.head.shared, output.shared);
  assert.equal(output.rows[0], output.shared);
  assert.equal(output.rows[1], (received.get("group") as unknown[])[1]);
  assert.equal((output.rows[1] as { shared: unknown }).shared, output.shared);
  assert.deepEqual(reads.flat().sort(), [...encoded.keys()].sort(), "each DAG part is read exactly once");
  const next = await parts.loadOwned(source()) as typeof output;
  assert.notEqual(next.shared, output.shared, "a later load owns fresh database rows");
  assert.equal(reads.flat().length, encoded.size * 2, "owned hydration retains no parts between loads");
  assert.ok(reads.every(batch => batch.length <= 8));
});

test("owned hydration refuses cycles and missing parts without retaining failed reads", async () => {
  const ref = (hash: string) => ({ $civicPayloadPart: hash });
  const saved = new Map<string, unknown>([["parent", { child: ref("child") }], ["child", { parent: ref("parent") }]]);
  const parts = new CivicPayloadParts({ existing: async () => [], write: async () => {},
    read: async hashes => hashes.flatMap(hash => saved.has(hash) ? [{ hash, payload: structuredClone(saved.get(hash)) }] : []) });
  await assert.rejects(() => parts.loadOwned(ref("parent")), /CIVIC_PAYLOAD_PART_CYCLE/);
  saved.delete("child");
  await assert.rejects(() => parts.loadOwned(ref("parent")), /CIVIC_PAYLOAD_PART_MISSING/);
  saved.set("child", { id: "verified" });
  assert.deepEqual(await parts.loadOwned(ref("parent")), { child: { id: "verified" } });
});

test("owned hydration roundtrips the production codec with ordered rows and shared projection roots", async () => {
  const payload = { rows: Array.from({ length: 80 }, (_, index) => row(index % 2 ? "az" : "nh", index)), text: "official text ".repeat(12_000) };
  const candidate = { id: "owned", normalizedPayload: payload, readModel: payload };
  const plan = partitionCivicPayload(candidate, ["id"]), saved = new Map(plan.parts.map(part => [part.hash, part.payload]));
  const reader = new CivicPayloadParts({ existing: async () => [], write: async () => {}, read: async hashes =>
    hashes.map(hash => ({ hash, payload: structuredClone(saved.get(hash)) })) });
  const root = structuredClone(plan.value);
  const loaded = await reader.loadOwned(root) as typeof candidate;
  assert.equal(loaded, root);
  assert.deepEqual(loaded, candidate);
  assert.equal(loaded.readModel, loaded.normalizedPayload, "shared codec roots become the same owned projection");
  assert.deepEqual(loaded.readModel.rows.map(value => value.id), payload.rows.map(value => value.id));
  assert.deepEqual(await reader.load(structuredClone(plan.value)), candidate, "owned hydration did not mutate persisted parts");
});


test("required state roots share one immutable part even when empty or below the inline threshold", async () => {
  for (const payload of [{}, { cards: {} }, { documents: [] }, { records: [{ id: "official-one", text: "Published fact" }] }]) {
    const memory = memoryParts(), parts = new CivicPayloadParts(memory.io);
    const candidate = { id: "state-candidate", readModel: payload };
    const stored = await parts.store(candidate, ["id"], ["readModel"]) as typeof candidate;
    const promotion = { payload: stored.readModel };
    assert.deepEqual(Object.keys(stored.readModel), ["$civicPayloadPart"]);
    assert.equal(memory.saved.size, 1);
    assert.deepEqual(await parts.load(promotion.payload), payload);
    assert.deepEqual(await parts.load(stored), candidate);
    const writes = memory.writes.length;
    await parts.store(candidate, ["id"], ["readModel"]);
    assert.equal(memory.writes.length, writes, "an unchanged small state writes no duplicate part");
    assert.deepEqual(partitionCivicPayload(candidate, ["id"]), { value: candidate, parts: [] }, "other families retain inline storage");
  }
});
