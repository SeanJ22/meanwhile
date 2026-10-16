import { createHash } from "node:crypto";
import { canonicalCivicDataHash, canonicalCivicDataJson, civicRecordFacts, civicRecordsFor } from "./changes.ts";
import type { CandidateVersionRecord, IdentityEvidence, ManualSourceSetReceipt, PromotedPointerIdentity, RoutineCandidate } from "./types.ts";

export type NavigationRecord = Record<string, unknown> & { readonly id: string };
export interface NavigationPublicationBase {
  readonly pointer: PromotedPointerIdentity;
  readonly record: CandidateVersionRecord;
  readonly reviewFactsHash: string | null;
  readonly reviewHeldKeysHash: string | null;
  readonly hasSourceReceipt: boolean;
  readonly records: () => AsyncIterable<NavigationRecord>;
  readonly sourceReceipt: () => Promise<ManualSourceSetReceipt | undefined>;
  readonly identities: () => AsyncIterable<IdentityEvidence>;
}

export function navigationFactsHash(records: Iterable<NavigationRecord>): string {
  const hash = createHash("sha256");
  for (const record of [...records].sort((a, b) => a.id.localeCompare(b.id))) {
    const { fieldSources: _sources, ...facts } = civicRecordFacts("CURATED_READER_RECORD", { key: record.id, record }) as NavigationRecord;
    hash.update(canonicalCivicDataJson([record.id, canonicalCivicDataHash(facts)]));
  }
  return hash.digest("hex");
}

export function navigationHeldKeysHash(candidate: RoutineCandidate): string {
  return canonicalCivicDataHash([...new Set((candidate.excludedFacts ?? []).filter(fact => fact.code !== "MANUAL_MEMBER_HELD_LKG" &&
    !(fact.code === "CONFLICT_SUPERSEDED" && typeof (fact.record as { memberId?: unknown } | null)?.memberId === "string"))
    .map(fact => fact.key))].sort());
}

const baseHashes = new WeakMap<CandidateVersionRecord, string>();
export function setPublicationBaseHash(base: CandidateVersionRecord, hash: string): void { baseHashes.set(base, hash); }
export function publicationBaseHash(base: CandidateVersionRecord): string {
  return baseHashes.get(base) ?? canonicalCivicDataHash(base.candidate.readModel);
}

export async function* verifiedNavigationRecords(base: NavigationPublicationBase): AsyncGenerator<NavigationRecord> {
  const hash = createHash("sha256").update('{"kind":"ballot-navigation","records":[');
  let first = true;
  const ids = new Set<string>();
  for await (const record of base.records()) {
    if (!record || typeof record.id !== "string" || !record.id || ids.has(record.id)) throw new Error("MANUAL_SUCCESSOR_BASE_MEMBER_INVALID");
    ids.add(record.id);
    if (!first) hash.update(",");
    first = false;
    hash.update(canonicalCivicDataJson(record));
    yield record;
  }
  const digest = hash.update("]}").digest("hex");
  if (digest !== base.record.candidate.normalization.normalizedHash || digest !== base.record.candidate.normalization.normalizedPayloadHash) {
    throw new Error("MANUAL_SUCCESSOR_BASE_PAYLOAD_HASH_INVALID");
  }
  setPublicationBaseHash(base.record, digest);
}

export function navigationCandidateIndex(candidate: RoutineCandidate): Record<string, string> | null {
  if (candidate.recordClass !== "CURATED_READER_RECORD" || (candidate.readModel as { kind?: string })?.kind !== "ballot-navigation") return null;
  const inherited = new Set((candidate as RoutineCandidate & { manualPriorAuthority?: { retainedMembers: { key: string }[] } })
    .manualPriorAuthority?.retainedMembers.map(member => member.key) ?? []);
  return { reviewFactsHash: navigationFactsHash(civicRecordsFor(candidate.recordClass, candidate.readModel)
    .map(member => member.record as NavigationRecord).filter(record => !inherited.has(record.id))),
    reviewHeldKeysHash: navigationHeldKeysHash(candidate) };
}
