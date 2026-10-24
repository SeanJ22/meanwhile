import { candidateChangeSet, heldCivicRecords, civicRecordFacts, civicRecordsFor } from "./changes.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { manualProjectionCandidate, type CuratedReaderProjection, type ManualProjectionPackage } from "./manual-projections.ts";
import { manualPriorAuthorityIssue, type ManualSuccessorCandidate } from "./manual-prior-authority.ts";
import { navigationCandidateIndex, navigationFactsHash, navigationHeldKeysHash, publicationBaseHash, setPublicationBaseHash, verifiedNavigationRecords, type NavigationPublicationBase, type NavigationRecord } from "./navigation-publication-base.ts";
import { promotionProofIssue } from "./read-model.ts";
import { resolveRecordConflicts } from "./source-conflicts.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "./store.ts";
import type { CivicRecordDelta, ManualSourceReview, ManualSourceSetReceipt, PromotedProjection, RoutineCandidate, RoutineChangeSet } from "./types.ts";

export interface NavigationComparison {
  readonly kind: "MATCHED_REVIEW" | "MERGED";
  readonly base: NavigationPublicationBase | null;
  readonly changes: RoutineChangeSet;
}

export async function readNavigationBase(store: RoutineDataStore, scope: string): Promise<NavigationPublicationBase | null> {
  if (store instanceof PostgresRoutineDataStore) return store.readNavigationPublicationBase(scope);
  const pointer = await store.readPromotion<CuratedReaderProjection>("CURATED_READER_RECORD", scope);
  if (!pointer) return null;
  const record = await store.readCandidate(pointer.versionId);
  if (!record || promotionProofIssue("CURATED_READER_RECORD", scope, pointer, record)) throw new Error("MANUAL_PROMOTION_BASE_PROOF_INVALID:ballot-navigation");
  const index = navigationCandidateIndex(record.candidate);
  return { pointer, record, reviewFactsHash: index?.reviewFactsHash ?? null, reviewHeldKeysHash: index?.reviewHeldKeysHash ?? null,
    hasSourceReceipt: record.candidate.retrieval.manualSourceReceipt !== undefined,
    records: async function* () { yield* pointer.payload.records; },
    sourceReceipt: async () => record.candidate.retrieval.manualSourceReceipt,
    identities: async function* () { yield* record.candidate.identities; } };
}

export async function prepareNavigationSuccessor(input: ManualProjectionPackage, store: RoutineDataStore): Promise<{
  readonly candidate: RoutineCandidate; readonly comparison: NavigationComparison;
}> {
  const merged = await mergeWithBase(input, store);
  if ("result" in merged) return merged.result;
  const { current, inherited, changed, conflicts, seen, receipt } = merged;
  let { base } = merged;
  const rebuilt = (): ManualSuccessorCandidate => {
    const cited = new Set<string>();
    const cite = (value: unknown) => {
      const source = value as { sourceUrl?: unknown; collectedAt?: unknown } | null;
      if (typeof source?.sourceUrl === "string" && typeof source.collectedAt === "string") cited.add(`${source.sourceUrl}\n${source.collectedAt}`);
    };
    for (const fact of conflicts) cite((fact.record as { source: unknown }).source);
    for (const record of current.values()) for (const source of Object.values(record.fieldSources ?? {})) cite(source);
    const priorSources = receipt.sources.filter((source: ManualSourceReview) => source.reviewOutcome !== "BLOCKED" &&
      [source.requestedUrl, source.finalUrl].some(url => cited.has(`${url}\n${source.retrievedAt}`)));
    const sources = new Map([...priorSources, ...input.sourceReceipt.sources]
      .map(source => [canonicalCivicDataHash(source), source]));
    const fresh = manualProjectionCandidate({ ...input, payload: { kind: "ballot-navigation", records: [...current.values()] },
      sourceReceipt: { ...input.sourceReceipt, sources: [...sources.values()] } });
    return { ...fresh, excludedFacts: [...fresh.excludedFacts ?? [], ...conflicts] };
  };
  let candidate = merged.candidate ?? rebuilt();
  if (inherited.length) {
    const ids = new Set(inherited.map(record => record.id));
    const identities = [];
    for await (const identity of base.identities()) if (ids.has(identity.identifiers.record_id)) identities.push(identity);
    if (new Set(identities.map(identity => identity.identifiers.record_id)).size !== ids.size) throw new Error("MANUAL_SUCCESSOR_RETAINED_IDENTITY_PROOF_UNAVAILABLE");
    const payload = { kind: "ballot-navigation", records: [...current.values(), ...inherited].sort((a, b) => a.id.localeCompare(b.id)) };
    const members = civicRecordsFor(candidate.recordClass, payload), hash = canonicalCivicDataHash(payload);
    candidate = { ...candidate, id: `${candidate.sourceId}:${canonicalCivicDataHash([candidate.id, base.pointer.versionId, hash]).slice(0, 32)}`,
      normalization: { ...candidate.normalization, normalizedHash: hash, normalizedPayloadHash: hash,
        inputRecords: members.length + candidate.normalization.droppedRecords, outputRecords: members.length },
      normalizedPayload: payload, readModel: payload, civicRecords: members,
      identities: [...candidate.identities, ...identities], horizon: { ...candidate.horizon, returnedRecords: members.length },
      manualPriorAuthority: { kind: "VALIDATED_PRIOR_PROJECTION", versionId: base.pointer.versionId,
        readModelSha256: publicationBaseHash(base.record), retainedMembers: inherited.map(record => ({ key: record.id, sha256: canonicalCivicDataHash(record) })) },
      excludedFacts: [...candidate.excludedFacts ?? [], ...inherited.map(record => ({ key: record.id, code: "MANUAL_MEMBER_HELD_LKG",
        detail: "Exact prior GOOD member retained; this review supplies no independently proven replacement or removal.", record }))],
    };
    const baseHash = publicationBaseHash(base.record);
    base = { ...base, record: { ...base.record, candidate: { ...base.record.candidate,
      readModel: { kind: "ballot-navigation", records: inherited }, identities,
      retrieval: { ...base.record.candidate.retrieval, manualSourceReceipt: receipt } } } };
    setPublicationBaseHash(base.record, baseHash);
    const issue = manualPriorAuthorityIssue(candidate, base.record);
    if (issue) throw new Error(`MANUAL_PROMOTION_BASE_PROOF_INVALID:ballot-navigation:${issue}`);
  }
  const added = [...current.values()].filter(record => !seen.has(record.id)).map(after => ({ key: `curated-reader:${after.id}`, before: null, after }));
  return { candidate, comparison: { kind: "MERGED", base, changes: { outcome: added.length + changed.length ? "CHANGED" : "UNCHANGED",
    added, changed, removed: [], held: heldCivicRecords(candidate) } } };
}

/** The first candidate lives only here: a merge that changes values rebuilds it, so the first is released before the rebuild. */
async function mergeWithBase(input: ManualProjectionPackage, store: RoutineDataStore): Promise<
  | { readonly result: { readonly candidate: RoutineCandidate; readonly comparison: NavigationComparison } }
  | { readonly candidate: ManualSuccessorCandidate | null; readonly base: NavigationPublicationBase; readonly receipt: ManualSourceSetReceipt;
      readonly current: Map<string, NavigationRecord>; readonly inherited: NavigationRecord[]; readonly changed: CivicRecordDelta[];
      readonly conflicts: NonNullable<RoutineCandidate["excludedFacts"]>[number][]; readonly seen: Set<string> }
> {
  const first: ManualSuccessorCandidate = manualProjectionCandidate(input);
  const base = await readNavigationBase(store, first.scope);
  if (!base || !base.hasSourceReceipt) return { result: { candidate: first, comparison: { kind: "MERGED", base, changes: candidateChangeSet(first, null) } } };
  const current = new Map((first.readModel as CuratedReaderProjection).records.map(record => [record.id, record]));
  if (store.confirmUnchanged && !base.record.candidate.bootstrapImport &&
      base.record.candidate.normalization.parserVersion === first.normalization.parserVersion &&
      base.reviewHeldKeysHash === navigationHeldKeysHash(first) &&
      base.reviewFactsHash === navigationFactsHash(current.values())) return { result: { candidate: first,
    comparison: { kind: "MATCHED_REVIEW", base, changes: { outcome: "UNCHANGED", added: [], changed: [], removed: [], held: heldCivicRecords(first) } } } };

  const receipt = await base.sourceReceipt();
  if (!receipt) throw new Error("MANUAL_SUCCESSOR_SOURCE_RECEIPT_MISSING");
  const inherited: NavigationRecord[] = [], changed: CivicRecordDelta[] = [];
  const seen = new Set<string>();
  const conflicts: NonNullable<RoutineCandidate["excludedFacts"]>[number][] = [];
  const facts = (record: NavigationRecord) => canonicalCivicDataHash(civicRecordFacts("CURATED_READER_RECORD", { key: record.id, record }));
  for await (const before of verifiedNavigationRecords(base)) {
    seen.add(before.id);
    const incoming = current.get(before.id);
    if (!incoming) { inherited.push(before); continue; }
    if (facts(before) === facts(incoming)) continue;
    const resolved = resolveRecordConflicts(incoming, before, input.sourceReceipt, receipt);
    current.set(before.id, resolved.record);
    conflicts.push(...resolved.conflicts);
    if (facts(before) !== facts(resolved.record)) changed.push({ key: `curated-reader:${before.id}`, before, after: resolved.record });
  }
  return { candidate: conflicts.length ? null : first, base, receipt, current, inherited, changed, conflicts, seen };
}

export function navigationBaseProjection(base: NavigationPublicationBase): PromotedProjection {
  return { ...base.pointer, payload: null, receipt: base.record.receipt! };
}
