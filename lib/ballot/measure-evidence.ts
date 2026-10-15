import { createHash } from "node:crypto";
import { canonicalJson } from "../control-plane/repository/types.ts";
import type { BallotSet, MeasureSourceReference, MeasureVoterGuide } from "./types.ts";
import { measureRecordIssue, type MeasureRecord } from "./measure-record-contract.ts";
import { measureSourceReferenceValid } from "./measure-source-contract.ts";
import { readBallotSourceCorpus } from "./source-corpus.ts";
import { sourceCorpusReferenceValid } from "./source-corpus-contract.ts";
import type { ManualSourceReview } from "../civic-data/types.ts";
import { extensionFor, objectClassOf, type EvidenceStore, type StoredObjectStream } from "../control-plane/evidence/store.ts";

type SourceReader = (reference: MeasureSourceReference) => Promise<string>;

function sourceIdentity(reference: MeasureSourceReference): unknown {
  return [reference.sourceUrl, reference.sourceHash, reference.vault.key, reference.vault.byteLength,
    reference.vault.contentType, reference.originals && canonicalJson(reference.originals)];
}

const sourceKey = (reference: MeasureSourceReference) => createHash("sha256").update(JSON.stringify(sourceIdentity(reference))).digest("hex");
const sameSource = (next: MeasureSourceReference, before?: MeasureSourceReference) =>
  measureSourceReferenceValid(next) && measureSourceReferenceValid(before) && sourceKey(next) === sourceKey(before);

function validateObjectMetadata(object: StoredObjectStream, reference: MeasureSourceReference): void {
  const hash = `sha256-${reference.sourceHash}`;
  if (object.key !== reference.vault.key || object.meta.contentHash !== hash ||
      object.meta.byteLength !== reference.vault.byteLength || object.meta.contentType !== reference.vault.contentType ||
      !object.key.endsWith(`/${hash}.${extensionFor(object.meta.contentType)}`) ||
      objectClassOf(object.meta) !== "IMMUTABLE_BODY" || object.meta.custom?.canonicalUrl !== reference.sourceUrl) {
    throw new Error(`Measure evidence is missing or differs from its source reference: ${reference.sourceUrl}`);
  }
  const custom = object.meta.custom;
  if (custom.tier === "RESTRICTED_RAW") throw new Error("Measure evidence is not readable source material.");
  if (custom.format === "measure-source-text@1") {
    if (!reference.originals?.length || !custom.originals || canonicalJson(JSON.parse(custom.originals)) !== canonicalJson(reference.originals)) {
      throw new Error("Measure transcription lacks its original documents.");
    }
  } else if (!["RAW", "SANITIZED_DERIVED", "EXTRACTED_DERIVED"].includes(custom.tier ?? "")) {
    throw new Error("Measure evidence is not readable source material.");
  }
  if (custom.tier === "EXTRACTED_DERIVED") {
    const extraction = JSON.parse(custom.extraction ?? "null") as { complete?: boolean; parent?: { contentHash?: string; canonicalUrl?: string } } | null;
    if (!extraction?.complete || !reference.originals?.some(original => `sha256-${original.sourceHash}` === extraction.parent?.contentHash &&
        original.sourceUrl === extraction.parent.canonicalUrl)) throw new Error("Measure document extraction lacks its complete original.");
  }
}

function sourceReader(vault: EvidenceStore, verified = new Set<string>()) {
  async function* chunks(reference: MeasureSourceReference): AsyncGenerator<Uint8Array> {
    if (!measureSourceReferenceValid(reference)) throw new Error("Measure evidence reference is invalid.");
    const object = await vault.stream(reference.vault.key);
    if (!object) throw new Error(`Measure evidence is missing: ${reference.sourceUrl}`);
    const reader = object.body.getReader(), hash = createHash("sha256");
    let received = 0;
    try {
      validateObjectMetadata(object, reference);
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        received += next.value.byteLength;
        if (received > reference.vault.byteLength) throw new Error(`Measure evidence differs from its source reference: ${reference.sourceUrl}`);
        hash.update(next.value); yield next.value;
      }
      if (received !== reference.vault.byteLength || hash.digest("hex") !== reference.sourceHash) throw new Error(`Measure evidence differs from its source reference: ${reference.sourceUrl}`);
      for (const original of reference.originals ?? []) await verify(original);
      verified.add(sourceKey(reference));
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  async function verify(reference: MeasureSourceReference): Promise<void> {
    if (!measureSourceReferenceValid(reference)) throw new Error("Measure evidence reference is invalid.");
    if (verified.has(sourceKey(reference))) return;
    for await (const chunk of chunks(reference)) void chunk;
  }
  async function* textChunks(reference: MeasureSourceReference): AsyncGenerator<string> {
    if (!/^(?:text\/|application\/(?:xhtml\+xml|xml|json)(?:;|$))/i.test(reference.vault.contentType)) throw new Error("Measure source requires a saved text transcription.");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let nonempty = false;
    for await (const chunk of chunks(reference)) {
      const text = decoder.decode(chunk, { stream: true });
      if (/\S/.test(text)) nonempty = true;
      yield text;
    }
    const tail = decoder.decode();
    if (!nonempty && !/\S/.test(tail)) throw new Error("Measure source text is empty.");
    yield tail;
  }
  const read: SourceReader = async reference => {
    const pieces: string[] = [];
    for await (const text of textChunks(reference)) pieces.push(text);
    return pieces.join("");
  };
  const contains = async (reference: MeasureSourceReference, excerpts: readonly string[], message: string) => {
    if (excerpts.some(excerpt => !excerpt.trim())) throw new Error(message);
    const missing = new Set(excerpts);
    const suffixLength = excerpts.reduce((longest, excerpt) => Math.max(longest, excerpt.length - 1), 0);
    let suffix = "";
    for await (const text of textChunks(reference)) {
      const window = suffix + text;
      for (const excerpt of missing) if (window.includes(excerpt)) missing.delete(excerpt);
      suffix = missing.size && suffixLength ? window.slice(-suffixLength) : "";
    }
    if (missing.size) throw new Error(message);
  };
  return { read, verify, contains };
}

export function measureSourceReader(vault: EvidenceStore): SourceReader { return sourceReader(vault).read; }

export async function verifyMeasureSource(vault: EvidenceStore, reference: MeasureSourceReference): Promise<void> {
  await sourceReader(vault).verify(reference);
}

export async function readMeasureSource(vault: EvidenceStore, reference: MeasureSourceReference): Promise<string> {
  return measureSourceReader(vault)(reference);
}

export function measureOriginalSourceReceipts(source: MeasureSourceReference): readonly ManualSourceReview[] {
  const originals = new Map<string, ManualSourceReview>(), pending = [...source.originals ?? []];
  for (const original of pending) {
    originals.set(`${original.sourceUrl}\n${original.sourceHash}`, { requestedUrl: original.sourceUrl, finalUrl: original.sourceUrl,
      publisher: original.publisher, sourceClass: "OFFICIAL_PUBLISHER", retrievedAt: original.retrievedAt, httpStatus: 200,
      rawHash: original.sourceHash, reviewOutcome: "SUPPORTED", reviewedEvidence: "The original document matched its saved content hash before translation." });
    pending.push(...original.originals ?? []);
  }
  return [...originals.values()];
}

function validateRecordSource(record: MeasureRecord, source: MeasureSourceReference): void {
  if (measureRecordIssue(record) || record.sourceHash !== source.sourceHash || record.sourceUrl !== source.sourceUrl) throw new Error("Measure record differs from its official source reference.");
}
const officialRecordExcerpts = (record: MeasureRecord) => [record.whatItDoes, record.yesMeans, record.noMeans,
  ...record.parts.map(part => part.what)].filter((excerpt): excerpt is string => excerpt !== null);

export async function validateMeasureRecordEvidence(record: MeasureRecord, source: MeasureSourceReference, vault: EvidenceStore, read: SourceReader = measureSourceReader(vault)): Promise<string> {
  validateRecordSource(record, source);
  const text = await read(source);
  if (officialRecordExcerpts(record).some(excerpt => !text.includes(excerpt))) throw new Error(`Measure record contains text absent from its official source: ${record.contestId}`);
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
  ballot?.sourceAuthorities?.forEach(add);
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
  const { verify, contains } = sourceReader(vault, verifiedSources(prior));
  for (const measure of ballot.measures) {
    const before = prior?.measures.find(row => row.contestId === measure.contestId);
    const record = ballot.measureRecords?.find(row => row.contestId === measure.contestId);
    if (measure.officialText) {
      const changed = !sameSource(measure.officialText, before?.officialText);
      if (record) {
        validateRecordSource(record, measure.officialText);
        const held = prior?.measureRecords?.find(row => row.contestId === measure.contestId);
        if (changed || recordExcerpts(record) !== recordExcerpts(held)) await contains(measure.officialText,
          officialRecordExcerpts(record), `Measure record contains text absent from its official source: ${record.contestId}`);
      } else if (changed) await verify(measure.officialText);
    }
    const guide = measure.voterGuide;
    if (!guide || sameSource(guide, before?.voterGuide) &&
      [guide.fiscalImpactSource, guide.passageThresholdSource].every(source => source === undefined || measureSourceReferenceValid(source)) &&
      guideExcerpts(guide) === guideExcerpts(before?.voterGuide)) continue;
    const fields = [guide.summary, ...(guide.argumentsFor ?? []), ...(guide.argumentsAgainst ?? [])].filter((text): text is string => text !== undefined);
    for (const [excerpt, source] of [[guide.fiscalImpact, guide.fiscalImpactSource], [guide.passageThreshold, guide.passageThresholdSource]] as const) {
      if (source && !excerpt) throw new Error(`Voter guide field has no published excerpt: ${measure.contestId}`);
      if (excerpt === undefined) continue;
      if (source) await contains(source, [excerpt], `Voter guide field differs from its state publication: ${measure.contestId}`);
      else fields.push(excerpt);
    }
    await contains(guide, fields, `Voter guide excerpt differs from its state publication: ${measure.contestId}`);
  }
  for (const authority of ballot.sourceAuthorities ?? []) if (!prior?.sourceAuthorities?.some(held => sameSource(authority, held))) await contains(authority, [], "Official publisher authority is unreadable.");
  if (ballot.sourceCorpus) {
    if (!sourceCorpusReferenceValid(ballot.sourceCorpus)) throw new Error("Ballot source corpus reference is invalid.");
    if (canonicalJson(ballot.sourceCorpus) !== canonicalJson(prior?.sourceCorpus)) {
      for await (const entry of readBallotSourceCorpus(vault, ballot.sourceCorpus)) await verify(entry.source);
    }
  }
}
