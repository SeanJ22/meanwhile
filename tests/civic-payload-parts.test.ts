import assert from "node:assert/strict";
import test from "node:test";
import { CivicPayloadParts, composeRegistryAreaView, partitionCivicPayload, registryAreaInheritanceIssue, registryAreaViewOf, type CivicPayloadPartIO } from "../lib/civic-data/payload-parts.ts";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";

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

const areaPayload = (): RegistryRuntimeReadModel => ({ formatVersion: 1,
  registry: { generatedAt: "2026-10-02T00:00:00.000Z", divisions: ["az", "nh"].flatMap(state => Array.from({ length: 25 }, (_, index) =>
    ({ ...row(state, index), ocdId: row(state, index).id, state: state.toUpperCase(), label: `${state} place ${index}` }))), bodies: [] },
  bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
  officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } } as unknown as RegistryRuntimeReadModel);

test("an area composition reads only selected place/ring parts and retains every other area on publication", async () => {
  const memory = memoryParts();
  const payload = composeRegistryAreaView(areaPayload());
  const stored = await new CivicPayloadParts(memory.io).store(payload);
  const selected = payload.registry.divisions[0]!.ocdId;
  const view = await new CivicPayloadParts(memory.io).load(stored, [selected]) as RegistryRuntimeReadModel;
  assert.deepEqual(view.registry.divisions.map(row => row.ocdId), [selected]);
  const readParts = memory.reads.flatMap(hashes => hashes.map(hash => memory.saved.get(hash)));
  assert.ok(!JSON.stringify(readParts).includes("nh official content"), "foreign-state facts never cross the wire");
  assert.ok(!JSON.stringify(readParts).includes("az official content 1 "), "another district in the same state is not loaded");
  assert.equal(canonicalCivicDataJson(view), canonicalCivicDataJson(payload), "a selected view binds the same canonical composition");
  const changed = composeRegistryAreaView({ ...view, registry: { ...view.registry,
    divisions: view.registry.divisions.map(row => ({ ...row, label: "New official place name" })) } }, view);
  assert.equal(registryAreaInheritanceIssue(view, changed), null);
  const firstWrites = memory.writes.length;
  const successor = await new CivicPayloadParts(memory.io).store(changed);
  const additions = memory.writes.slice(firstWrites).flat();
  assert.ok(!JSON.stringify(additions).includes("nh official content"));
  const complete = await new CivicPayloadParts(memory.io).load(successor) as RegistryRuntimeReadModel;
  assert.equal(complete.registry.divisions.length, 50);
  assert.equal(complete.registry.divisions.find(row => row.ocdId === selected)?.label, "New official place name");
  assert.deepEqual(complete.registry.divisions.filter(row => row.ocdId !== selected).sort((a, b) => a.ocdId.localeCompare(b.ocdId)),
    payload.registry.divisions.filter(row => row.ocdId !== selected).sort((a, b) => a.ocdId.localeCompare(b.ocdId)));
});

test("selected registry areas and country reads share bounded part batches without reading unselected facts", async () => {
  const memory = memoryParts();
  const payload = composeRegistryAreaView(areaPayload());
  const stored = await new CivicPayloadParts(memory.io).store(payload);
  const manifest = registryAreaViewOf(payload)!;
  const selected = payload.registry.divisions.filter((_, index) => index % 4 === 0).map(division => division.ocdId).reverse();
  const view = await new CivicPayloadParts(memory.io).load(stored, selected) as RegistryRuntimeReadModel;
  assert.deepEqual(view.registry.divisions.map(division => division.ocdId), selected, "batch completion preserves requested area order");
  assert.equal(canonicalCivicDataJson(view), canonicalCivicDataJson(payload));
  const indexes = Object.values(manifest.indexes);
  const allowed = new Set([...Object.values(manifest.manifest.states).map(pointer => pointer.$civicPayloadPart),
    ...selected.map(area => indexes.find(index => area in index)![area].part.$civicPayloadPart)]);
  assert.ok(memory.reads.flat().every(hash => allowed.has(hash)), "only selected area facts and their state indexes are read");
  assert.equal(memory.reads[0].length, 2, "both required state indexes use one existing bounded batch");
  assert.ok(memory.reads.slice(1).some(hashes => hashes.length === 8), "selected area roots are batched rather than read one by one");
  assert.ok(memory.reads.every(hashes => hashes.length <= 8));

  memory.reads.length = 0;
  const country = await new CivicPayloadParts(memory.io).load(stored) as RegistryRuntimeReadModel;
  const countryOrder = Object.values(manifest.manifest.states).flatMap(pointer => Object.keys(memory.saved.get(pointer.$civicPayloadPart) as object));
  assert.deepEqual(country.registry.divisions.map(division => division.ocdId), countryOrder, "country composition keeps original state/index order");
  assert.equal(canonicalCivicDataJson(country), canonicalCivicDataJson(payload));
  assert.equal(memory.reads.length, 1 + Math.ceil(countryOrder.length / 8), "country reads use the same part batches");
  assert.ok(memory.reads.every(hashes => hashes.length <= 8));
});

test("batched registry reads reject missing parts and changed index or area facts", async () => {
  const memory = memoryParts();
  const payload = composeRegistryAreaView(areaPayload());
  const stored = await new CivicPayloadParts(memory.io).store(payload);
  const view = registryAreaViewOf(payload)!;
  const selected = payload.registry.divisions.slice(0, 12).map(division => division.ocdId);
  const indexHash = view.manifest.states.AZ.$civicPayloadPart;
  const areaHash = view.indexes.AZ[selected[0]].part.$civicPayloadPart;
  const originalIndex = memory.saved.get(indexHash);
  const originalArea = memory.saved.get(areaHash);
  memory.saved.delete(areaHash);
  await assert.rejects(() => new CivicPayloadParts(memory.io).load(stored, selected), /CIVIC_PAYLOAD_PART_MISSING/);
  memory.saved.set(areaHash, originalArea);
  memory.saved.delete(indexHash);
  await assert.rejects(() => new CivicPayloadParts(memory.io).load(stored, selected), /CIVIC_PAYLOAD_PART_MISSING/);
  memory.saved.set(indexHash, { ...(originalIndex as object), changed: true });
  await assert.rejects(() => new CivicPayloadParts(memory.io).load(stored, selected), /REGISTRY_AREA_INDEX_CHANGED/);
  memory.saved.set(indexHash, originalIndex);
  const changedArea = structuredClone(originalArea) as { registry: { divisions: { label: string }[] } };
  changedArea.registry.divisions[0].label = "Changed stored fact";
  memory.saved.set(areaHash, changedArea);
  await assert.rejects(() => new CivicPayloadParts(memory.io).load(stored, selected), /REGISTRY_AREA_VIEW_CHANGED/);
});

test("materialized fact corruption and a changed unselected reference cannot inherit GOOD authority", async () => {
  const memory = memoryParts();
  const stored = await new CivicPayloadParts(memory.io).store(composeRegistryAreaView(areaPayload()));
  const selected = row("az", 0).id;
  const view = await new CivicPayloadParts(memory.io).load(stored, [selected]) as RegistryRuntimeReadModel;
  const corrupt = structuredClone(view);
  corrupt.registry.divisions[0]!.label = "Invented name";
  assert.throws(() => canonicalCivicDataJson(corrupt), /REGISTRY_AREA_VIEW_CHANGED/);
  const foreign = structuredClone(view);
  const index = registryAreaViewOf(foreign)!.indexes.AZ as Record<string, unknown>;
  index[row("az", 1).id] = index[selected];
  const successor = composeRegistryAreaView(foreign, foreign);
  assert.equal(registryAreaInheritanceIssue(view, successor), "An unselected area's registry reference changed.");
});

test("native district and territory roots retain separate jurisdiction parts and scoped inheritance", async () => {
  const memory = memoryParts();
  const roots = ["district:dc", "territory:as", "territory:gu", "territory:mp", "territory:pr", "territory:vi"];
  const base = areaPayload();
  const divisions = roots.map(root => ({ ...base.registry.divisions[0]!,
    id: `ocd-division/country:us/${root}/cd:at-large`, ocdId: `ocd-division/country:us/${root}/cd:at-large`,
    label: `${root} congressional district`, state: root.split(":")[1]!.toUpperCase() }));
  const payload = composeRegistryAreaView({ ...base, registry: { ...base.registry,
    divisions: [...base.registry.divisions, ...divisions] } });
  const manifest = registryAreaViewOf(payload)!.manifest;
  assert.deepEqual(Object.keys(manifest.states).sort(), ["AS", "AZ", "DC", "GU", "MP", "NH", "PR", "VI"]);
  assert.equal("shared" in manifest.states, false);
  const stored = await new CivicPayloadParts(memory.io).store(payload);
  const selected = divisions[0]!.ocdId;
  const view = await new CivicPayloadParts(memory.io).load(stored, [selected]) as RegistryRuntimeReadModel;
  assert.deepEqual(view.registry.divisions.map(row => row.ocdId), [selected]);
  assert.deepEqual(Object.keys(registryAreaViewOf(view)!.indexes), ["DC"]);
  assert.equal(canonicalCivicDataJson(view), canonicalCivicDataJson(payload));
  const successor = composeRegistryAreaView({ ...view, registry: { ...view.registry,
    divisions: view.registry.divisions.map(row => ({ ...row, label: "Updated district name" })) } }, view);
  assert.equal(registryAreaInheritanceIssue(view, successor), null);
  for (const jurisdiction of ["AS", "AZ", "GU", "MP", "NH", "PR", "VI"]) {
    assert.deepEqual(registryAreaViewOf(successor)!.manifest.states[jurisdiction], manifest.states[jurisdiction]);
  }
  const firstWrites = memory.writes.length;
  const next = await new CivicPayloadParts(memory.io).store(successor);
  assert.ok(!JSON.stringify(memory.writes.slice(firstWrites)).includes("territory:pr"));
  const prView = await new CivicPayloadParts(memory.io).load(next, [divisions[4]!.ocdId]) as RegistryRuntimeReadModel;
  assert.deepEqual(prView.registry.divisions.map(row => row.ocdId), [divisions[4]!.ocdId]);
  assert.equal(canonicalCivicDataJson(prView), canonicalCivicDataJson(successor));
});

test("large district and territory arrays reuse unselected jurisdiction chunks losslessly", async () => {
  const memory = memoryParts();
  const parts = new CivicPayloadParts(memory.io);
  const district = Array.from({ length: 20 }, (_, index) => ({
    ...row("dc", index), id: `ocd-division/country:us/district:dc/cd:at-large#body:${index}` }));
  const territory = Array.from({ length: 20 }, (_, index) => ({
    ...row("pr", index), id: `ocd-division/country:us/territory:pr/cd:at-large#body:${index}` }));
  const original = [...district, ...territory];
  await parts.store(original);
  const firstWrites = memory.writes.length;
  const changed = [...district.map((value, index) => index === 0 ? { ...value, name: "Updated official body" } : value), ...territory];
  const stored = await parts.store(changed);
  assert.ok(!JSON.stringify(memory.writes.slice(firstWrites)).includes("pr official content"),
    "a DC update does not rewrite Puerto Rico into a shared chunk");
  assert.deepEqual(await new CivicPayloadParts(memory.io).load(stored), changed);
});
