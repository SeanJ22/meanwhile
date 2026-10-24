/** Public catalog GETs -> normalizeSocrata -> SQLite spool -> two exact, bounded reads.
 * Run with an outside-repository TMPDIR and --max-old-space-size=512. The output
 * is a local measurement; this script does not publish or read registrations.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, rename, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { socrataPages } from "../lib/sources/open-data/acquire.ts";
import { normalizeSocrata } from "../lib/sources/open-data/normalize.ts";
import { OpenDataSpool } from "../lib/sources/open-data/spool.ts";
import type { KnownRelease, KnownReleaseOptions } from "../lib/sources/known-release.ts";

const output = process.argv.find(value => value.startsWith("--output="))?.slice(9)
  ?? join(tmpdir(), "src01-socrata-sqlite-proof.json");
const frozen = "00e4ed4aa7392757fbcfa4af085ed3b15089e58c7aa51bb49670f08bad4d9afd";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const spoolPath = new URL("../lib/sources/open-data/spool.ts", import.meta.url);
assert.equal(sha(await readFile(spoolPath)), frozen);

interface SourcePage {
  url: string;
  status: number;
  retrievedAt: string;
  rawSha256: string;
  byteLength: number;
}
interface Sink {
  native: ReturnType<typeof createHash>;
  normalized: ReturnType<typeof createHash>;
  rows: number;
  sourceRowBytes: number;
}
interface ReadPass {
  pass: number;
  status: string;
  rows: number;
  partitions: number;
  chunks: number;
  sourceRowBytes: number;
  sourceBytes: number;
  sourceManifestSha256: string;
  nativeOrderedRowSha256: string;
  partitionManifestSha256: string;
  elapsedMs: number;
  rssBytes: number;
  heapUsedBytes: number;
}

const started = Date.now();
const spool = await OpenDataSpool.create();
const controller = AbortSignal.timeout(20 * 60_000);
const manifests: SourcePage[] = [];
const expected = new Map<string, Sink>();
const keyOf = (state: string | null, partition: string) => JSON.stringify([state, partition]);
const sinkFor = (sinks: Map<string, Sink>, key: string): Sink => sinks.get(key)
  ?? { native: createHash("sha256"), normalized: createHash("sha256"), rows: 0, sourceRowBytes: 0 };
const finishSinks = (sinks: Map<string, Sink>) => [...sinks].map(([key, value]) => ({
  key, rows: value.rows, sourceRowBytes: value.sourceRowBytes,
  nativeOrderedSha256: value.native.digest("hex"), normalizedOrderedSha256: value.normalized.digest("hex"),
})).sort((a, b) => a.key.localeCompare(b.key));
const proof: Record<string, unknown> & { requests: number; rows: number; sourceBytes: number; passes: ReadPass[] } = {
  status: "RUNNING", startedAt: new Date().toISOString(), source: "socrata-discovery", spoolSha256: frozen,
  scope: "Full unrestricted public catalog; no registration or production reads/writes",
  transport: "Direct readonly public GETs; no evidence-store or production-cache writes",
  readOptions: { consume: false, maxRows: 1000, maxBytes: 4 * 1024 * 1024 },
  requests: 0, rows: 0, sourceBytes: 0, sourcePages: manifests, passes: [],
};
const save = async () => {
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(proof, null, 2) + "\n");
  await rename(temporary, output);
};
const memory = () => {
  const usage = process.memoryUsage();
  assert.ok(usage.rss < 768 * 1024 * 1024, `Replay RSS exceeded 0.75GiB: ${usage.rss}`);
  return { rssBytes: usage.rss, heapUsedBytes: usage.heapUsed };
};

// Override only acquisition storage: the production pager and its publisher
// backoff still run, with each public response held only until it is spooled.
const acquire = async (options: KnownReleaseOptions): Promise<KnownRelease> => {
  const response = await (options.fetchImpl ?? fetch)(options.url, {
    method: "GET", headers: options.headers, signal: options.signal,
  });
  if (!response.ok) throw Error(`Public Socrata HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.ok(bytes.length <= options.maxBytes);
  const at = new Date().toISOString(), hash = sha(bytes);
  const release: KnownRelease = {
    sourceId: options.sourceId, releaseId: options.releaseId, bytes, sha256: hash,
    requestedUrl: String(options.url), finalUrl: response.url || String(options.url), httpStatus: response.status,
    retrievedAt: at, sourceObservedAt: at, checkedAt: at, lastCheckStatus: response.status,
    etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"),
    contentType: response.headers.get("content-type") ?? "", reused: false,
  };
  await options.validate?.(bytes, release);
  manifests.push({ url: release.finalUrl, status: response.status, retrievedAt: at, rawSha256: hash, byteLength: bytes.length });
  proof.requests = manifests.length;
  proof.sourceBytes += bytes.length;
  return release;
};

try {
  for await (const page of socrataPages({ signal: controller, acquire })) {
    assert.ok(page.rows.length <= 1000);
    const capture = { url: page.url, retrievedAt: page.retrievedAt, rawHash: page.sha256, sourceCheck: page.sourceCheck };
    for (const raw of page.rows) {
      const row = normalizeSocrata(raw, page.retrievedAt), partition = `domain:${row.nativeIds.domain}`;
      const key = keyOf(row.state, partition), sink = sinkFor(expected, key);
      const source = JSON.stringify(row.sourceRow);
      sink.native.update(JSON.stringify([row.id, row.sourceRow]) + "\n");
      sink.normalized.update(JSON.stringify(row) + "\n");
      sink.sourceRowBytes += Buffer.byteLength(source);
      sink.rows++;
      expected.set(key, sink);
      await spool.append(partition, row, capture);
      proof.rows++;
    }
    if (manifests.length % 20 === 0) {
      const disk = await statfs(tmpdir());
      console.log(JSON.stringify({ stage: "catalog", requests: manifests.length, rows: proof.rows,
        sourceBytes: proof.sourceBytes, elapsedMs: Date.now() - started, ...memory(), diskFreeBytes: disk.bavail * disk.bsize }));
      await save();
    }
  }
  proof.catalogMs = Date.now() - started;
  const sourceManifestSha256 = sha(JSON.stringify(manifests) + "\n");
  proof.sourceManifestSha256 = sourceManifestSha256;
  const nativeExpected = finishSinks(expected);
  proof.expectedPartitions = nativeExpected;
  assert.equal(nativeExpected.reduce((sum, sink) => sum + sink.rows, 0), proof.rows);
  await save();
  console.log(JSON.stringify({ stage: "catalog-complete", requests: proof.requests, rows: proof.rows,
    sourceBytes: proof.sourceBytes, partitions: nativeExpected.length, sourceManifestSha256, ...memory() }));

  for (let pass = 1; pass <= 2; pass++) {
    const passStarted = Date.now(), ordered = createHash("sha256"), actual = new Map<string, Sink>();
    let count = 0, chunks = 0, sourceRowBytes = 0;
    for await (const chunk of spool.partitions({ maxRows: 1000, maxBytes: 4 * 1024 * 1024 })) {
      const partition = chunk.partition.replace(/:part:\d+$/, "");
      const key = keyOf(chunk.state, partition), sink = sinkFor(actual, key);
      const capturedRows = new Set(chunk.captures.flatMap(capture => {
        assert.ok(manifests.some(page => page.rawSha256 === capture.rawHash
          && page.url === capture.url && page.retrievedAt === capture.retrievedAt));
        return capture.sourceRows;
      }));
      for (const row of chunk.rows) {
        assert.ok(capturedRows.has(row.sourceRow));
        const source = JSON.stringify(row.sourceRow), frame = JSON.stringify([row.id, row.sourceRow]) + "\n";
        sink.native.update(frame);
        sink.normalized.update(JSON.stringify(row) + "\n");
        sink.sourceRowBytes += Buffer.byteLength(source);
        sink.rows++;
        ordered.update(JSON.stringify([key, row.id, row.sourceRow]) + "\n");
        count++;
        sourceRowBytes += Buffer.byteLength(source);
      }
      actual.set(key, sink);
      chunks++;
      if (chunks % 100 === 0) console.log(JSON.stringify({ stage: "read", pass, chunks, rows: count,
        elapsedMs: Date.now() - passStarted, ...memory() }));
    }
    const actualRows = finishSinks(actual);
    assert.equal(count, proof.rows);
    assert.equal(actualRows.length, nativeExpected.length);
    assert.deepEqual(actualRows, nativeExpected);
    const result: ReadPass = {
      pass, status: "PASS", rows: count, partitions: actualRows.length, chunks, sourceRowBytes,
      sourceBytes: proof.sourceBytes, sourceManifestSha256, nativeOrderedRowSha256: ordered.digest("hex"),
      partitionManifestSha256: sha(JSON.stringify(actualRows) + "\n"), elapsedMs: Date.now() - passStarted, ...memory(),
    };
    proof.passes.push(result);
    await save();
    console.log(JSON.stringify({ stage: "read-complete", ...result }));
  }
  assert.equal(proof.passes[0].nativeOrderedRowSha256, proof.passes[1].nativeOrderedRowSha256);
  assert.equal(proof.passes[0].partitionManifestSha256, proof.passes[1].partitionManifestSha256);
  assert.equal(sha(await readFile(spoolPath)), frozen);
  proof.status = "PASS";
  proof.completedAt = new Date().toISOString();
  proof.elapsedMs = Date.now() - started;
  proof.peakRssKiB = process.resourceUsage().maxRSS;
  await save();
} catch (error) {
  proof.status = "FAIL";
  proof.failure = error instanceof Error ? error.message : String(error);
  proof.failedAt = new Date().toISOString();
  await save();
  throw error;
} finally {
  await spool.dispose();
}
console.log(JSON.stringify({ stage: "complete", output, status: proof.status, requests: proof.requests,
  rows: proof.rows, sourceBytes: proof.sourceBytes, passes: proof.passes, peakRssKiB: proof.peakRssKiB }));
