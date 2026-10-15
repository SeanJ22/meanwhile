import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { sourceCorpusReferenceValid } from "../lib/ballot/source-corpus-contract.ts";
import { readBallotSourceCorpus, type BallotSourceCorpusEntry } from "../lib/ballot/source-corpus.ts";
import type { BallotSourceCorpusReference } from "../lib/ballot/types.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { deriveSanitized, recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { MemoryEvidenceStore, type EvidenceStore, type StoredObjectStream } from "../lib/control-plane/evidence/store.ts";
import { ballotProvenanceUrls, mergeBallotSourceReferences } from "../lib/civic-data/manual-projections.ts";
import { genericBallotProblems, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { manualSourceUrls } from "../lib/civic-data/manual-source-urls.ts";
import type { ManualSourceSetReceipt } from "../lib/civic-data/types.ts";

const at = "2026-10-15T04:00:00Z";
function entry(id: string): BallotSourceCorpusEntry {
  const sourceUrl = `https://elections.example.gov/${id}.pdf`, sourceHash = contentHash(id).slice(7);
  return {
    source: { sourceUrl, sourceHash, retrievedAt: at, publisher: "State election authority", vault: {
      key: `project/freshness/source/elections.example.gov/2026/10/15/${id}/sha256-${sourceHash}.pdf`, byteLength: 100, contentType: "application/pdf" } },
    receipt: { requestedUrl: sourceUrl, finalUrl: sourceUrl, retrievedAt: at, publisher: "State election authority",
      sourceClass: "ELECTION_AUTHORITY", httpStatus: 200, rawHash: sourceHash, reviewedEvidence: "Official sample ballot: José’s precinct." },
  };
}

async function corpus(lines: BallotSourceCorpusEntry[], bodyOverride?: string) {
  const vault = new MemoryEvidenceStore(), bytes = new TextEncoder().encode(bodyOverride ?? lines.map(line => JSON.stringify(line) + "\n").join(""));
  const sourceHash = contentHash(bytes).slice(7);
  const reference: BallotSourceCorpusReference = { format: "ballot-source-corpus@1", state: "DE", electionId: "2026-general", sourceHash,
    reviewedAt: at, reviewedBy: "Source reviewer", documentCount: lines.length,
    vault: { key: `project/freshness/source/ballot-corpus-de/2026/10/15/test/sha256-${sourceHash}.ndjson`, byteLength: bytes.byteLength, contentType: "application/x-ndjson" } };
  await vault.put(reference.vault.key, bytes, { contentHash: `sha256-${sourceHash}`, byteLength: bytes.byteLength, contentType: reference.vault.contentType,
    custom: { format: reference.format, state: reference.state, electionId: reference.electionId, reviewedAt: at, reviewedBy: reference.reviewedBy } });
  return { vault, reference, bytes };
}

function streamed(vault: EvidenceStore, transform: (held: StoredObjectStream) => StoredObjectStream): EvidenceStore {
  return { put: vault.put.bind(vault), get: async () => { throw new Error("Corpus verification must stream."); },
    head: vault.head.bind(vault), list: vault.list.bind(vault), stream: async key => {
      const held = await vault.stream(key);
      return held && transform(held);
    } };
}

async function collect(vault: EvidenceStore, reference: BallotSourceCorpusReference) {
  const result: BallotSourceCorpusEntry[] = [];
  for await (const row of readBallotSourceCorpus(vault, reference)) result.push(row);
  return result;
}

test("the corpus streams ordered entries across UTF-8 chunk boundaries and cancels on early exit", async () => {
  const lines = [entry("a"), entry("b"), entry("c")], { vault, reference, bytes } = await corpus(lines);
  assert.ok(sourceCorpusReferenceValid(reference));
  let canceled = false;
  const chunks = streamed(vault, held => {
    let offset = 0;
    return { ...held, body: new ReadableStream({ pull(controller) {
      if (offset === bytes.length) controller.close();
      else { controller.enqueue(bytes.subarray(offset, offset += Math.min(7, bytes.length - offset))); }
    }, cancel() { canceled = true; } }) };
  });
  assert.deepEqual(await collect(chunks, reference), lines);
  for await (const row of readBallotSourceCorpus(chunks, reference)) { assert.deepEqual(row, lines[0]); break; }
  assert.equal(canceled, true);
});

test("the corpus rejects changed bytes, wrong state, duplicate keys, false review and oversized entries", async () => {
  const { vault, reference, bytes } = await corpus([entry("a"), entry("b")]);
  for (const changed of [{ ...reference, documentCount: 1 }, { ...reference, documentCount: 3 },
    { ...reference, electionId: "2028-general" }, { ...reference, state: "CA" }, { ...reference, reviewedBy: "Other reviewer" }]) {
    await assert.rejects(collect(vault, changed));
  }
  const corrupt = streamed(vault, held => ({ ...held, body: new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(new TextDecoder().decode(bytes).replace("José", "Jose"))); controller.close();
  } }) }));
  await assert.rejects(collect(corrupt, reference), /bytes|count/);
  for (const lines of [[entry("a"), entry("a")], [entry("b"), entry("a")],
    [{ ...entry("a"), receipt: { ...entry("a").receipt, finalUrl: "https://other.example.gov/", requestedUrl: "https://other.example.gov/" } }],
    [{ ...entry("a"), receipt: { ...entry("a").receipt, reviewedEvidence: "x".repeat(65_536) } }]]) {
    const input = await corpus(lines);
    await assert.rejects(collect(input.vault, input.reference));
  }
  for (const value of [{ ...reference, entries: [] }, { ...reference, documentCount: 0 }, { ...reference, sourceHash: "0".repeat(64) },
    { ...reference, vault: { ...reference.vault, key: reference.vault.key.replace("/test/", "/../") } }]) {
    assert.equal(sourceCorpusReferenceValid(value), false);
  }
});

test("a differing raw receipt requires the exact source-bound sanitization artifact", async () => {
  const row = entry("sanitized"), raw = `<p>Official election notice</p><script>key="${["AIza", "x".repeat(35)].join("")}"</script>`;
  const acquisition = recordAcquisition({ canonicalUrl: row.source.sourceUrl, retrievedAt: at, httpStatus: 200,
    contentType: "text/html", sourceId: "elections.example.gov", methodRouteId: "test-capture", workItemId: "test",
    attemptId: "test", permission: "ALLOWED", transport: "REACHABLE" }, raw);
  const sanitized = deriveSanitized(acquisition.artifact, raw, at).artifact;
  assert.notEqual(sanitized.contentHash, acquisition.artifact.contentHash);
  row.receipt = { ...row.receipt, rawHash: acquisition.artifact.contentHash.slice(7) };
  row.source.sourceHash = sanitized.contentHash.slice(7);
  row.source.vault = { key: `project/freshness/source/elections.example.gov/2026/10/15/sanitized/${sanitized.contentHash}.html`,
    contentType: sanitized.contentType, byteLength: sanitized.byteLength };
  const missing = await corpus([row]);
  await assert.rejects(collect(missing.vault, missing.reference), /exact source and review/);
  row.sanitization = sanitized;
  const valid = await corpus([row]);
  assert.deepEqual(await collect(valid.vault, valid.reference), [row]);
  for (const changed of [
    { ...row, receipt: { ...row.receipt, rawHash: contentHash("another response").slice(7) } },
    { ...row, sanitization: { ...sanitized, canonicalUrl: "https://elections.example.gov/another.pdf" } },
    { ...row, sanitization: { ...sanitized, derivation: undefined } },
    { ...row, sanitization: { ...sanitized, derivation: { ...sanitized.derivation!, derivedHash: contentHash("different sanitized output") } } },
  ]) {
    const invalid = await corpus([changed]);
    await assert.rejects(collect(invalid.vault, invalid.reference), /exact source and review/);
  }
});

test("state packages cite one corpus and preserve every direct official source", async () => {
  const directory = new URL("../data/ballot/2026-general/", import.meta.url);
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".json")) continue;
    const data = JSON.parse(await readFile(new URL(name, directory), "utf8")) as GenericBallotProjection & { sourceReceipt: ManualSourceSetReceipt };
    assert.deepEqual(genericBallotProblems({ ...data, kind: "ballot-contests" }, name.slice(0, -5).toUpperCase()), [], name);
    const sources = new Set(data.sourceReceipt.sources.flatMap(manualSourceUrls));
    for (const url of ballotProvenanceUrls(data.ballots)) assert.ok(sources.has(url), `${name}: ${url}`);
    for (const ballot of Object.values(data.ballots)) {
      assert.ok(sourceCorpusReferenceValid(ballot.sourceCorpus), name);
      assert.equal("sourceDocuments" in ballot, false);
      assert.deepEqual(mergeBallotSourceReferences({ ...ballot, sourceCorpus: undefined }, ballot).sourceCorpus, ballot.sourceCorpus);
      if (name === "de.json") {
        assert.equal(ballot.sourceCorpus.documentCount, 532);
        assert.equal(data.sourceReceipt.sources.length, 6);
      }
    }
  }
});
