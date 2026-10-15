import { createHash } from "node:crypto";
import { artifactId, type Artifact } from "../control-plane/evidence/artifact.ts";
import { SANITIZER_VERSION } from "../ops/fixture-credentials.ts";
import { manualSourceReceiptStructureIssue } from "../civic-data/source-authority.ts";
import type { ManualSourceReview } from "../civic-data/types.ts";
import { objectClassOf, type EvidenceStore } from "../control-plane/evidence/store.ts";
import { measureSourceReferenceValid } from "./measure-source-contract.ts";
import { sourceCorpusReferenceValid } from "./source-corpus-contract.ts";
import type { BallotSourceCorpusReference, MeasureSourceReference } from "./types.ts";

export interface BallotSourceCorpusEntry {
  source: MeasureSourceReference;
  receipt: ManualSourceReview;
  sanitization?: Artifact;
}

const MAX_LINE_CHARACTERS = 64 * 1024;

function sourceReceiptMatches(entry: BallotSourceCorpusEntry): boolean {
  const { source, receipt, sanitization } = entry;
  if (receipt.rawHash === source.sourceHash) return sanitization === undefined;
  const rawHash = `sha256-${receipt.rawHash}`, derivedHash = `sha256-${source.sourceHash}`;
  const derivation = sanitization?.derivation;
  if (!sanitization || sanitization.tier !== "SANITIZED_DERIVED" || sanitization.contentHash !== derivedHash ||
    sanitization.id !== artifactId("SANITIZED_DERIVED", derivedHash) || sanitization.byteLength !== source.vault.byteLength ||
    sanitization.contentType !== source.vault.contentType || sanitization.canonicalUrl !== source.sourceUrl ||
    sanitization.retrievalUrl !== receipt.finalUrl || sanitization.retrievedAt !== source.retrievedAt ||
    sanitization.httpStatus !== receipt.httpStatus || sanitization.retentionPolicy !== "EVIDENCE_PERMANENT" ||
    !derivation || derivation.rawHash !== rawHash || derivation.derivedHash !== derivedHash ||
    derivation.rawArtifactId !== artifactId("RESTRICTED_RAW", rawHash) || derivation.derivedArtifactId !== sanitization.id ||
    derivation.sanitizerVersion !== SANITIZER_VERSION || !Number.isFinite(Date.parse(derivation.derivedAt)) ||
    !Number.isSafeInteger(derivation.distinctValuesRedacted) || derivation.distinctValuesRedacted < 1 ||
    !Array.isArray(derivation.fingerprints) || derivation.fingerprints.length !== derivation.distinctValuesRedacted ||
    new Set(derivation.fingerprints).size !== derivation.fingerprints.length ||
    derivation.fingerprints.some(value => typeof value !== "string" || !/^[a-f0-9]{12}$/.test(value)) ||
    !derivation.redactionsByClass || typeof derivation.redactionsByClass !== "object" || Array.isArray(derivation.redactionsByClass)) return false;
  const counts = Object.values(derivation.redactionsByClass);
  return counts.length > 0 && counts.every(value => Number.isSafeInteger(value) && value > 0) &&
    Number.isSafeInteger(derivation.substringsReplaced) && derivation.substringsReplaced >= derivation.distinctValuesRedacted &&
    counts.reduce((sum, count) => sum + count, 0) === derivation.substringsReplaced;
}

function parseEntry(line: string, reference: BallotSourceCorpusReference): BallotSourceCorpusEntry {
  if (!line || line.length > MAX_LINE_CHARACTERS) throw new Error("Ballot corpus entry exceeds its bounded line format.");
  const entry = JSON.parse(line) as BallotSourceCorpusEntry;
  if (!entry || !measureSourceReferenceValid(entry.source) || !entry.receipt ||
    manualSourceReceiptStructureIssue({ contractVersion: 1, reviewedAt: reference.reviewedAt, reviewedBy: reference.reviewedBy, sources: [entry.receipt] }) ||
    ![entry.receipt.requestedUrl, entry.receipt.finalUrl].includes(entry.source.sourceUrl) ||
    entry.receipt.retrievedAt !== entry.source.retrievedAt || entry.receipt.reviewOutcome === "BLOCKED" || !sourceReceiptMatches(entry)) {
    throw new Error("Ballot corpus entry lacks its exact source and review.");
  }
  return entry;
}

export async function* readBallotSourceCorpus(vault: EvidenceStore, reference: BallotSourceCorpusReference): AsyncGenerator<BallotSourceCorpusEntry> {
  if (!sourceCorpusReferenceValid(reference)) throw new Error("Ballot corpus reference is invalid.");
  const object = await vault.stream(reference.vault.key);
  if (!object) throw new Error("Ballot corpus is missing from the evidence vault.");
  const reader = object.body.getReader();
  try {
    const meta = object.meta;
    if (object.key !== reference.vault.key || meta.contentHash !== `sha256-${reference.sourceHash}` ||
      meta.byteLength !== reference.vault.byteLength || meta.contentType !== reference.vault.contentType || objectClassOf(meta) !== "IMMUTABLE_BODY" ||
      meta.custom?.format !== reference.format || meta.custom.state !== reference.state || meta.custom.electionId !== reference.electionId ||
      meta.custom.reviewedAt !== reference.reviewedAt || meta.custom.reviewedBy !== reference.reviewedBy) throw new Error("Ballot corpus metadata differs from its reference.");
    const hash = createHash("sha256"), decoder = new TextDecoder("utf-8", { fatal: true });
    let pending = "", byteLength = 0, count = 0, previousKey = "";
    const take = (line: string) => {
      const entry = parseEntry(line, reference);
      if (entry.source.vault.key <= previousKey) throw new Error("Ballot corpus entries must have unique ordered vault keys.");
      previousKey = entry.source.vault.key;
      if (++count > reference.documentCount) throw new Error("Ballot corpus document count differs from its reference.");
      return entry;
    };
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > reference.vault.byteLength) throw new Error("Ballot corpus bytes exceed its reference.");
      hash.update(chunk.value);
      pending += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n")) !== -1) {
        yield take(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
      if (pending.length > MAX_LINE_CHARACTERS) throw new Error("Ballot corpus entry exceeds its bounded line format.");
    }
    pending += decoder.decode();
    if (pending) yield take(pending);
    if (byteLength !== reference.vault.byteLength || hash.digest("hex") !== reference.sourceHash || count !== reference.documentCount) {
      throw new Error("Ballot corpus bytes or document count differ from its reference.");
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
