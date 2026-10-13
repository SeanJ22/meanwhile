import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { isSourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";
import { censusTigerArchive, TIGER_SOURCE_CHUNK_BYTES } from "../lib/census-geography/tiger-source.ts";
import { tigerFeatures } from "../lib/census-geography/tiger-shapefile.ts";
import { CENSUS_ACQUISITION_PARSER, censusSourceRelease, heldSourcesUnchanged } from "../lib/census-geography/source-release.ts";
import { readBoundaryZip } from "../lib/geo/shapefile.ts";
import { readZipEntries } from "../lib/sources/archive.ts";
import { zip } from "../scripts/xlsx.mjs";

const samplePath = join(process.cwd(), "tests/fixtures/census-tiger/tl_2020_us_zcta520.zip");
const url = "https://www2.census.gov/geo/tiger/TIGER2020/ZCTA520/tl_2020_us_zcta520.zip";
const features = async (path: string, wanted?: ReadonlySet<string>) => {
  const result = []; for await (const feature of tigerFeatures(path, wanted)) result.push(feature); return result;
};
async function temporaryZip(bytes: Buffer, consume: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-tiger-test-"));
  try { const path = join(directory, "sample.zip"); await writeFile(path, bytes); await consume(path); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
function harness(bytes: Buffer) {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  let requests = 0, respond = (_headers: Headers) => new Response(Uint8Array.from(bytes), { headers: { etag: '"one"', "content-length": String(bytes.length) } });
  const options = { cache: { store, locks }, fetchImpl: (async (_url, init) => { requests++; return respond(new Headers(init?.headers)); }) as typeof fetch };
  return { store, options, requests: () => requests, response: (value: typeof respond) => { respond = value; } };
}
const validateShapes = async (path: string) => { for await (const feature of tigerFeatures(path)) void feature; };
async function manifest(store: MemoryEvidenceStore) {
  const key = (await store.list("project/")).find(key => key.endsWith("/manifest.json"));
  return key ? (await store.get(key))!.bytes : null;
}

test("committed full-resolution sample streams polygons with exact DBF ordinals and a state ZIP whitelist", async () => {
  const held = await readFile(samplePath), streamed = await features(samplePath);
  assert.deepEqual(streamed, readBoundaryZip(held).features);
  assert.deepEqual(streamed.map(feature => feature.properties.ZCTA5CE20), ["90001", "90002", "90003", "90004", "90005", "90006", "90007", "90008"]);
  assert.deepEqual((await features(samplePath, new Set(["90002", "90005"]))).map(feature => feature.properties.ZCTA5CE20), ["90002", "90005"]);
});

test("streamed SHP framing, attribute pairing, and coordinate reference errors refuse the sample", async () => {
  const entries = readZipEntries(await readFile(samplePath));
  for (const defect of ["length", "ordinal", "pairing", "projection"] as const) {
    const changed = entries.map(entry => ({ name: entry.name, data: Buffer.from(entry.data) }));
    const shp = changed.find(entry => entry.name.endsWith(".shp"))!, dbf = changed.find(entry => entry.name.endsWith(".dbf"))!;
    if (defect === "length") shp.data.writeInt32BE(49, 24);
    if (defect === "ordinal") shp.data.writeInt32BE(2, 100);
    if (defect === "pairing") dbf.data.writeUInt32LE(dbf.data.readUInt32LE(4) - 1, 4);
    if (defect === "projection") changed.find(entry => entry.name.endsWith(".prj"))!.data = Buffer.from('PROJCS["Unknown",UNIT["Metre",1]]');
    await temporaryZip(zip(changed, "2026-10-01"), async path => { await assert.rejects(features(path), /shp:|pairing|NAD83/); });
  }
});

test("an early geometry consumer still completes the SHP member CRC", async () => {
  const bytes = await readFile(samplePath), directory = bytes.readUInt32LE(bytes.length - 6);
  // The first fixture member is SHP. Change matching directory/local CRCs so
  // framing still admits it and only complete stream validation finds it.
  bytes.writeUInt32LE(1, 14); bytes.writeUInt32LE(1, directory + 16);
  await temporaryZip(bytes, async path => {
    await assert.rejects(async () => { for await (const feature of tigerFeatures(path)) { void feature; break; } }, /CRC/);
  });
});

test("TIGER source checks restore held compressed chunks on 304 and dispose only temporary files", async () => {
  const bytes = await readFile(samplePath), h = harness(bytes);
  const first = await censusTigerArchive(url, h.options, validateShapes);
  try {
    assert.equal(first.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(first.reused, false); assert.equal(first.sourceValidator.bytes, bytes.length);
    h.response(headers => { assert.equal(headers.get("if-none-match"), '"one"'); return new Response(null, { status: 304 }); });
    const held = await censusTigerArchive(url, h.options, validateShapes);
    try {
      assert.equal(h.requests(), 2); assert.equal(held.reused, true);
      assert.notEqual(held.path, first.path); assert.equal(held.sha256, first.sha256); assert.equal(held.retrievedAt, first.retrievedAt);
      assert.deepEqual(await readFile(held.path), bytes);
    } finally { await held.dispose(); }
    assert.ok((await h.store.list("project/")).some(key => key.includes("/chunks/")));
  } finally { await first.dispose(); }
  await assert.rejects(stat(first.path), /ENOENT/);
});

test("a malformed or partial TIGER update cannot replace the last good archive", async () => {
  const bytes = await readFile(samplePath), h = harness(bytes), first = await censusTigerArchive(url, h.options, validateShapes);
  await first.dispose(); const priorManifest = await manifest(h.store);
  h.response(() => new Response(bytes.subarray(0, -1), { headers: { etag: '"bad"' } }));
  await assert.rejects(censusTigerArchive(url, h.options, validateShapes), error => {
    assert.ok(isSourceAcquisitionFailure(error)); assert.equal(error.code, "PUBLISHER_DOCUMENT_INVALID"); return true;
  });
  assert.deepEqual(await manifest(h.store), priorManifest);
  h.response(() => new Response(bytes, { headers: { "content-length": String(bytes.length + 1) } }));
  await assert.rejects(censusTigerArchive(url, h.options, validateShapes), error => {
    assert.ok(isSourceAcquisitionFailure(error)); assert.equal(error.code, "PUBLISHER_RESPONSE_REFUSED"); return true;
  });
  assert.deepEqual(await manifest(h.store), priorManifest);
  h.response(headers => { assert.equal(headers.get("if-none-match"), '"one"'); return new Response(null, { status: 304 }); });
  const restored = await censusTigerArchive(url, h.options, validateShapes);
  try { assert.equal(restored.sha256, first.sha256); } finally { await restored.dispose(); }
});

test("source parser failures, missing held chunks, and aborted bodies never advance the source index", async () => {
  const bytes = await readFile(samplePath), h = harness(bytes);
  await assert.rejects(censusTigerArchive(url, h.options, async () => { throw new Error("fixture attribute mismatch"); }), /fixture attribute mismatch/);
  assert.equal(await manifest(h.store), null);
  const controller = new AbortController(), reason = new Error("fixture acquisition stopped");
  let canceled = false;
  h.response(() => new Response(new ReadableStream({
    start(stream) { stream.enqueue(bytes.subarray(0, 50)); },
    pull() { controller.abort(reason); },
    cancel() { canceled = true; },
  })));
  await assert.rejects(censusTigerArchive(url, { ...h.options, signal: controller.signal }, validateShapes), error => error === reason);
  assert.equal(canceled, true); assert.equal(await manifest(h.store), null);
  h.response(() => new Response(bytes, { headers: { etag: '"one"' } }));
  const accepted = await censusTigerArchive(url, h.options, validateShapes); await accepted.dispose();
  const originalGet = h.store.get.bind(h.store);
  h.store.get = async key => key.includes("/chunks/") ? null : originalGet(key);
  h.response(headers => { assert.equal(headers.get("if-none-match"), null); return new Response(null, { status: 304 }); });
  const prior = await manifest(h.store);
  await assert.rejects(censusTigerArchive(url, h.options, validateShapes), /304 without held bytes/);
  assert.deepEqual(await manifest(h.store), prior);
});

test("publisher request and streamed-body errors retain existing acquisition failure categories", async () => {
  const h = harness(await readFile(samplePath));
  await assert.rejects(censusTigerArchive(url, { ...h.options, fetchImpl: async () => { throw new TypeError("socket failed"); } }, validateShapes), error => {
    assert.ok(isSourceAcquisitionFailure(error)); assert.equal(error.code, "PUBLISHER_UNAVAILABLE"); return true;
  });
  h.response(() => new Response(new ReadableStream({ start(stream) { stream.error(new Error("body broke")); } })));
  await assert.rejects(censusTigerArchive(url, h.options, validateShapes), error => {
    assert.ok(isSourceAcquisitionFailure(error)); assert.equal(error.code, "PUBLISHER_RESPONSE_REFUSED"); return true;
  });
  assert.equal(await manifest(h.store), null);
});

test("archive Retry-After on 429 or 503 blocks later archive, byte, and HEAD requests without changing held evidence", async () => {
  const bytes = await readFile(samplePath);
  for (const status of [429, 503]) {
    const h = harness(bytes), first = await censusTigerArchive(url, h.options, validateShapes);
    await first.dispose();
    const prior = await manifest(h.store);
    h.response(() => new Response(null, { status, headers: { "retry-after": "3600" } }));
    await assert.rejects(censusTigerArchive(url, h.options, validateShapes), new RegExp(`HTTP ${status}`));
    assert.deepEqual(await manifest(h.store), prior);
    const requests = h.requests();
    await assert.rejects(censusTigerArchive(url, h.options, validateShapes), /KNOWN_SOURCE_RETRY_AFTER/);
    await assert.rejects(censusSourceRelease("https://www2.census.gov/geo/tiger/", h.options), /KNOWN_SOURCE_RETRY_AFTER/);
    await assert.rejects(heldSourcesUnchanged({
      sourceUrls: [url], sourceDataset: "TIGER sample", sourceFiles: ["sample.zip"], sourceChecksums: [first.sha256],
      sourceValidators: [first.sourceValidator], parserVersion: CENSUS_ACQUISITION_PARSER, method: "Sample polygons", computedAt: first.retrievedAt,
    }, [url], h.options), /KNOWN_SOURCE_RETRY_AFTER/);
    assert.equal(h.requests(), requests); assert.deepEqual(await manifest(h.store), prior);
  }
});

test("a HEAD Retry-After shares the source cooldown with the archive download path", async () => {
  const h = harness(await readFile(samplePath)), first = await censusTigerArchive(url, h.options, validateShapes);
  await first.dispose(); const prior = await manifest(h.store);
  h.response(() => new Response(null, { status: 503, headers: { "retry-after": "3600" } }));
  await assert.rejects(heldSourcesUnchanged({
    sourceUrls: [url], sourceDataset: "TIGER sample", sourceFiles: ["sample.zip"], sourceChecksums: [first.sha256],
    sourceValidators: [first.sourceValidator], parserVersion: CENSUS_ACQUISITION_PARSER, method: "Sample polygons", computedAt: first.retrievedAt,
  }, [url], h.options), /HTTP 503/);
  const requests = h.requests();
  await assert.rejects(censusTigerArchive(url, h.options, validateShapes), /KNOWN_SOURCE_RETRY_AFTER/);
  assert.equal(h.requests(), requests); assert.deepEqual(await manifest(h.store), prior);
});

test("a source ZIP above 256 MiB never makes a vault body larger than 4 MiB", async () => {
  // A stored ZIP member containing 257 MiB of zeros. Only one 1 MiB zero
  // buffer exists; its exact CRC was calculated by the ZIP standard.
  const size = 257 * 1024 * 1024, zero = Buffer.alloc(1024 * 1024), name = Buffer.from("large-source.bin"), crc = 3292254773;
  const local = Buffer.alloc(30 + name.length); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(size, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(size, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(name.length, 28); name.copy(central, 46);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + size, 16);
  const h = harness(Buffer.alloc(0)), put = h.store.put.bind(h.store);
  let largestBody = 0;
  h.store.put = async (key, bytes, meta) => { if (key.includes("/chunks/")) largestBody = Math.max(largestBody, bytes.length); return put(key, bytes, meta); };
  let at = -1;
  const fetchImpl = (async () => new Response(new ReadableStream({ pull(stream) {
    if (at === -1) { stream.enqueue(local); at++; }
    else if (at < 257) { stream.enqueue(zero); at++; }
    else if (at === 257) { stream.enqueue(central); at++; }
    else if (at === 258) { stream.enqueue(end); at++; }
    else stream.close();
  } }), { headers: { "content-length": String(local.length + size + central.length + end.length), etag: '"large"' } })) as typeof fetch;
  const source = await censusTigerArchive(url, { ...h.options, fetchImpl }, async () => {});
  try {
    assert.ok(source.sourceValidator.bytes! > 256 * 1024 * 1024);
    assert.equal(largestBody, TIGER_SOURCE_CHUNK_BYTES);
    assert.ok((await h.store.list("project/")).filter(key => key.includes("/chunks/")).length <= 3, "repeated compressed source chunks reuse immutable evidence");
  } finally { await source.dispose(); }
});
