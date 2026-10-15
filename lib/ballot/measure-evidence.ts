import type { BallotSet, MeasureSourceReference, MeasureVoterGuide } from "./types.ts";
import { measureRecordIssue, type MeasureRecord } from "./measure-record-contract.ts";
import { measureSourceReferenceValid } from "./measure-source-contract.ts";
import { contentHash } from "../control-plane/ids.ts";
import { extensionFor, objectClassOf, type EvidenceStore, type StoredObject } from "../control-plane/evidence/store.ts";

type SourceReader = (reference: MeasureSourceReference) => Promise<string>;

function sourceIdentity(reference: MeasureSourceReference): unknown {
  return [reference.sourceUrl, reference.sourceHash, reference.vault.key, reference.vault.byteLength,
    reference.vault.contentType, reference.originals && JSON.stringify(reference.originals)];
}

const sourceKey = (reference: MeasureSourceReference) => JSON.stringify(sourceIdentity(reference));
const sameSource = (next: MeasureSourceReference, before?: MeasureSourceReference) =>
  measureSourceReferenceValid(next) && measureSourceReferenceValid(before) && sourceKey(next) === sourceKey(before);

async function readObject(vault: EvidenceStore, reference: MeasureSourceReference, cache: Map<string, Promise<StoredObject>>, verified: ReadonlySet<string>): Promise<StoredObject> {
  if (!measureSourceReferenceValid(reference)) throw new Error("Measure evidence reference is invalid.");
  const key = sourceKey(reference);
  let held = cache.get(key);
  if (!held) { held = verifyObject(vault, reference, cache, verified); cache.set(key, held); }
  return held;
}

async function verifyObject(vault: EvidenceStore, reference: MeasureSourceReference, cache: Map<string, Promise<StoredObject>>, verified: ReadonlySet<string>): Promise<StoredObject> {
  const object = await vault.get(reference.vault.key);
  const hash = `sha256-${reference.sourceHash}`;
  if (!object || object.key !== reference.vault.key || object.meta.contentHash !== hash || contentHash(object.bytes) !== hash ||
      object.meta.byteLength !== reference.vault.byteLength || object.bytes.byteLength !== reference.vault.byteLength ||
      object.meta.contentType !== reference.vault.contentType || !object.key.endsWith(`/${hash}.${extensionFor(object.meta.contentType)}`) ||
      objectClassOf(object.meta) !== "IMMUTABLE_BODY" || object.meta.custom?.canonicalUrl !== reference.sourceUrl) {
    throw new Error(`Measure evidence is missing or differs from its source reference: ${reference.sourceUrl}`);
  }
  const custom = object.meta.custom;
  if (custom.tier === "RESTRICTED_RAW") throw new Error("Measure evidence is not readable source material.");
  if (custom.format === "measure-source-text@1") {
    if (!reference.originals?.length || custom.originals !== JSON.stringify(reference.originals)) throw new Error("Measure transcription lacks its original documents.");
  } else if (!["RAW", "SANITIZED_DERIVED", "EXTRACTED_DERIVED"].includes(custom.tier ?? "")) {
    throw new Error("Measure evidence is not readable source material.");
  }
  if (custom.tier === "EXTRACTED_DERIVED") {
    const extraction = JSON.parse(custom.extraction ?? "null") as { complete?: boolean; parent?: { contentHash?: string; canonicalUrl?: string } } | null;
    if (!extraction?.complete || !reference.originals?.some(original => `sha256-${original.sourceHash}` === extraction.parent?.contentHash &&
        original.sourceUrl === extraction.parent.canonicalUrl)) throw new Error("Measure document extraction lacks its complete original.");
  }
  for (const original of reference.originals ?? []) if (!verified.has(sourceKey(original))) await readObject(vault, original, cache, verified);
  return object;
}

function sourceReader(vault: EvidenceStore, verified: ReadonlySet<string> = new Set()) {
  const cache = new Map<string, Promise<StoredObject>>();
  const read: SourceReader = async reference => {
    const object = await readObject(vault, reference, cache, verified);
    if (!/^(?:text\/|application\/(?:xhtml\+xml|xml|json)(?:;|$))/i.test(object.meta.contentType)) throw new Error("Measure source requires a saved text transcription.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(object.bytes);
    if (!text.trim()) throw new Error("Measure source text is empty.");
    return text;
  };
  return { read, verify: async (reference: MeasureSourceReference) => {
    if (!measureSourceReferenceValid(reference) || !verified.has(sourceKey(reference))) await readObject(vault, reference, cache, verified);
  } };
}

export function measureSourceReader(vault: EvidenceStore): SourceReader { return sourceReader(vault).read; }

export async function verifyMeasureSource(vault: EvidenceStore, reference: MeasureSourceReference): Promise<void> {
  await sourceReader(vault).verify(reference);
}

export async function readMeasureSource(vault: EvidenceStore, reference: MeasureSourceReference): Promise<string> {
  return measureSourceReader(vault)(reference);
}

function validateRecordSource(record: MeasureRecord, source: MeasureSourceReference): void {
  if (measureRecordIssue(record) || record.sourceHash !== source.sourceHash || record.sourceUrl !== source.sourceUrl) throw new Error("Measure record differs from its official source reference.");
}

export async function validateMeasureRecordEvidence(record: MeasureRecord, source: MeasureSourceReference, vault: EvidenceStore, read: SourceReader = measureSourceReader(vault)): Promise<string> {
  validateRecordSource(record, source);
  const text = await read(source);
  if ([record.whatItDoes, record.yesMeans, record.noMeans, ...record.parts.map(part => part.what)]
    .some(excerpt => excerpt !== null && !text.includes(excerpt))) throw new Error(`Measure record contains text absent from its official source: ${record.contestId}`);
  return text;
}

function verifiedSources(ballot?: BallotSet): Set<string> {
  const verified = new Set<string>();
  const add = (reference?: MeasureSourceReference) => {
    if (!measureSourceReferenceValid(reference)) return;
    verified.add(sourceKey(reference));
    reference.originals?.forEach(add);
  };
  for (const measure of ballot?.measures ?? []) {
    add(measure.officialText); add(measure.voterGuide);
    add(measure.voterGuide?.fiscalImpactSource); add(measure.voterGuide?.passageThresholdSource);
  }
  ballot?.sourceAuthorities?.forEach(add); ballot?.sourceDocuments?.forEach(add);
  return verified;
}

const recordExcerpts = (record?: MeasureRecord) => record && JSON.stringify([
  record.sourceUrl, record.sourceHash, record.whatItDoes, record.yesMeans, record.noMeans, record.parts.map(part => part.what),
]);
const guideExcerpts = (guide?: MeasureVoterGuide) => guide && JSON.stringify([
  guide.summary, guide.argumentsFor, guide.argumentsAgainst, guide.fiscalImpact, guide.passageThreshold,
  guide.fiscalImpactSource && sourceIdentity(guide.fiscalImpactSource), guide.passageThresholdSource && sourceIdentity(guide.passageThresholdSource),
]);

export async function validateBallotMeasureEvidence(ballot: BallotSet, vault: EvidenceStore, prior?: BallotSet): Promise<void> {
  const { read, verify } = sourceReader(vault, verifiedSources(prior));
  for (const measure of ballot.measures) {
    const before = prior?.measures.find(row => row.contestId === measure.contestId);
    const record = ballot.measureRecords?.find(row => row.contestId === measure.contestId);
    if (measure.officialText) {
      const changed = !sameSource(measure.officialText, before?.officialText);
      if (record) {
        validateRecordSource(record, measure.officialText);
        const held = prior?.measureRecords?.find(row => row.contestId === measure.contestId);
        if (changed || recordExcerpts(record) !== recordExcerpts(held)) await validateMeasureRecordEvidence(record, measure.officialText, vault, read);
      } else if (changed) await read(measure.officialText);
    }
    const guide = measure.voterGuide;
    if (!guide || sameSource(guide, before?.voterGuide) &&
      [guide.fiscalImpactSource, guide.passageThresholdSource].every(source => source === undefined || measureSourceReferenceValid(source)) &&
      guideExcerpts(guide) === guideExcerpts(before?.voterGuide)) continue;
    const text = await read(guide);
    const fields = [guide.summary, ...(guide.argumentsFor ?? []), ...(guide.argumentsAgainst ?? [])];
    if (fields.some(excerpt => excerpt !== undefined && (!excerpt.trim() || !text.includes(excerpt)))) throw new Error(`Voter guide excerpt differs from its state publication: ${measure.contestId}`);
    for (const [excerpt, source] of [[guide.fiscalImpact, guide.fiscalImpactSource], [guide.passageThreshold, guide.passageThresholdSource]] as const) {
      if (source && !excerpt) throw new Error(`Voter guide field has no published excerpt: ${measure.contestId}`);
      if (excerpt !== undefined && (!excerpt.trim() || !(source ? await read(source) : text).includes(excerpt))) throw new Error(`Voter guide field differs from its state publication: ${measure.contestId}`);
    }
  }
  for (const authority of ballot.sourceAuthorities ?? []) if (!prior?.sourceAuthorities?.some(held => sameSource(authority, held))) await read(authority);
  for (const source of ballot.sourceDocuments ?? []) await verify(source);
}
