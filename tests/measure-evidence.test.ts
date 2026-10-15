import assert from "node:assert/strict";
import test from "node:test";
import type { BallotSet, MeasureSourceReference } from "../lib/ballot/types.ts";
import { measureSourceReferenceValid } from "../lib/ballot/measure-source-contract.ts";
import { readMeasureSource, validateBallotMeasureEvidence, verifyMeasureSource } from "../lib/ballot/measure-evidence.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { extensionFor, MemoryEvidenceStore, type EvidenceStore, type StoredObject } from "../lib/control-plane/evidence/store.ts";

const retrievedAt = "2026-10-15T16:00:00Z", sourceUrl = "https://elections.example.gov/measure.pdf";
async function put(vault: EvidenceStore, body: string | Uint8Array, options: {
  url?: string; type?: string; originals?: MeasureSourceReference[];
} = {}): Promise<MeasureSourceReference> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const sourceHash = contentHash(bytes).slice(7), type = options.type ?? "text/plain", url = options.url ?? sourceUrl;
  const reference: MeasureSourceReference = { sourceUrl: url, sourceHash, retrievedAt, publisher: "State election authority",
    vault: { key: `project/freshness/source/${new URL(url).hostname}/2026/10/15/evidence-test/sha256-${sourceHash}.${extensionFor(type)}`,
      byteLength: bytes.byteLength, contentType: type }, ...(options.originals ? { originals: options.originals } : {}) };
  await vault.put(reference.vault.key, bytes, { contentType: type, contentHash: `sha256-${sourceHash}`, byteLength: bytes.byteLength,
    custom: { canonicalUrl: url, ...(options.originals ? { format: "measure-source-text@1", originals: JSON.stringify(options.originals) } : { tier: "RAW" }) } });
  return reference;
}
function countingStore(vault: EvidenceStore, reads: Map<string, number>, alter?: (object: StoredObject) => StoredObject): EvidenceStore {
  return { put: vault.put.bind(vault), head: vault.head.bind(vault), list: vault.list.bind(vault), get: async key => {
    reads.set(key, (reads.get(key) ?? 0) + 1);
    const object = await vault.get(key);
    return object && alter ? alter(object) : object;
  } };
}

test("state evidence validates exact legal and attributed guide excerpts while reading each shared original once", async () => {
  const vault = new MemoryEvidenceStore();
  const original = await put(vault, new Uint8Array([37, 80, 68, 70, 255, 0]), { type: "application/pdf" });
  const text = "SECTION 1. Libraries receive funding. A YES vote adopts the levy. A NO vote retains current law.";
  const officialText = await put(vault, text, { originals: [original] });
  const guide = await put(vault, "Official analysis. Annual cost: $5. State-published support. State-published opposition.", { originals: [original] });
  const threshold = await put(vault, "Approval requires a majority of votes.", { url: "https://elections.example.gov/threshold" });
  const record = { contestId: "measure:1", whatItDoes: "Libraries receive funding.", yesMeans: "A YES vote adopts the levy.",
    noMeans: "A NO vote retains current law.", parts: [{ id: "measure:1#section1", number: "1", label: "Section 1", kind: "FUNDING", what: "Libraries receive funding." }],
    sourceUrl, sourceHash: officialText.sourceHash, writtenAt: retrievedAt };
  const ballot = { measures: [{ contestId: "measure:1", officialText, voterGuide: { ...guide, summary: "Official analysis.",
    fiscalImpact: "Annual cost: $5.", passageThreshold: "Approval requires a majority of votes.", passageThresholdSource: threshold,
    argumentsFor: ["State-published support."], argumentsAgainst: ["State-published opposition."] } }],
    measureRecords: [record], sourceDocuments: [original] } as unknown as BallotSet;
  const reads = new Map<string, number>();
  const tracked = countingStore(vault, reads);
  await validateBallotMeasureEvidence(ballot, tracked);
  assert.equal(reads.get(original.vault.key), 1);
  reads.clear();
  await validateBallotMeasureEvidence(structuredClone(ballot), tracked, ballot);
  assert.equal(reads.size, 0);
  await validateBallotMeasureEvidence({ ...ballot, measureRecords: [{ ...record, whatItDoes: "SECTION 1. Libraries receive funding." }] }, tracked, ballot);
  assert.deepEqual([...reads], [[officialText.vault.key, 1]]);
  reads.clear();
  const revised = await put(vault, `${text} Additional official text.`, { originals: [original] });
  await validateBallotMeasureEvidence({ ...ballot, measures: [{ ...ballot.measures[0], officialText: revised }],
    measureRecords: [{ ...record, sourceHash: revised.sourceHash }] }, tracked, ballot);
  assert.deepEqual([...reads], [[revised.vault.key, 1]]);
  reads.clear();
  const collateral = await put(vault, "%PDF additional source", { type: "application/pdf" });
  await validateBallotMeasureEvidence({ ...ballot, sourceDocuments: [original, collateral] }, tracked, ballot);
  assert.deepEqual([...reads], [[collateral.vault.key, 1]]);
  assert.equal(await readMeasureSource(vault, officialText), text);
  await verifyMeasureSource(vault, original);
  await assert.rejects(readMeasureSource(vault, original), /transcription/);
  await assert.rejects(validateBallotMeasureEvidence({ ...ballot, measureRecords: [{ ...record, whatItDoes: "Invented benefit." }] }, vault, ballot), /absent/);
  await assert.rejects(validateBallotMeasureEvidence({ ...ballot, measures: [{ ...ballot.measures[0], voterGuide: {
    ...ballot.measures[0].voterGuide!, argumentsFor: ["Invented argument."] } }] }, vault, ballot), /differs/);
  await validateBallotMeasureEvidence({ ...ballot, measureRecords: [] }, vault);
});

test("compact source references reject inline source text, traversal and mismatched hashes", async () => {
  const vault = new MemoryEvidenceStore(), source = await put(vault, "Official source.");
  assert.ok(measureSourceReferenceValid(source));
  for (const value of [{ ...source, text: "Official source." }, { ...source, sourceUrl: "http://example.gov/source" },
    { ...source, sourceHash: "0".repeat(64) }, { ...source, vault: { ...source.vault, key: source.vault.key.replace("evidence-test", "..") } },
    { ...source, vault: { ...source.vault, byteLength: 0 } }]) assert.equal(measureSourceReferenceValid(value), false);
  const cyclic = { ...source, originals: [] as MeasureSourceReference[] }; cyclic.originals.push(cyclic);
  assert.equal(measureSourceReferenceValid(cyclic), false);
});

test("vault reads refuse corrupt bodies, untrusted metadata and incomplete document lineage", async () => {
  const vault = new MemoryEvidenceStore(), source = await put(vault, "Official source.");
  await assert.rejects(readMeasureSource(new MemoryEvidenceStore(), source), /missing/);
  const alterations: ((object: StoredObject) => StoredObject)[] = [
    object => ({ ...object, bytes: new TextEncoder().encode("Different text.") }),
    object => ({ ...object, key: `${object.key}-other` }),
    object => ({ ...object, meta: { ...object.meta, byteLength: object.meta.byteLength + 1 } }),
    object => ({ ...object, meta: { ...object.meta, contentHash: `sha256-${"0".repeat(64)}` } }),
    object => ({ ...object, meta: { ...object.meta, objectClass: "MUTABLE_INDEX" } }),
    object => ({ ...object, meta: { ...object.meta, custom: { ...object.meta.custom, canonicalUrl: "https://other.example.gov/" } } }),
    object => ({ ...object, meta: { ...object.meta, custom: { ...object.meta.custom, tier: "RESTRICTED_RAW" } } }),
    object => ({ ...object, meta: { ...object.meta, custom: { ...object.meta.custom, format: "measure-source-text@1" } } }),
    object => ({ ...object, meta: { ...object.meta, custom: { ...object.meta.custom, tier: "EXTRACTED_DERIVED", extraction: JSON.stringify({ complete: false }) } } }),
  ];
  for (const alter of alterations) await assert.rejects(readMeasureSource(countingStore(vault, new Map(), alter), source));
  const original = await put(vault, "%PDF original", { type: "application/pdf" });
  const derived = await put(vault, "Transcribed source.", { originals: [original] });
  const missing = countingStore(vault, new Map());
  missing.get = async key => key === original.vault.key ? null : vault.get(key);
  await assert.rejects(readMeasureSource(missing, derived), /missing/);
});
