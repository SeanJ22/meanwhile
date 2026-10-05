import { createHash } from "node:crypto";
import { canonicalCivicDataJson, civicRecordsFor } from "./changes.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { manualProjectionCandidate, readManualProjectionPrior, type CuratedReaderProjection, type ManualProjectionPackage } from "./manual-projections.ts";
import { readPromotedCivicData, type CivicDataReadStore } from "./read-model.ts";
import type { AuditPullRemovalEvidence } from "./types.ts";
import { manualPriorAuthorityIssue, type ManualSuccessorCandidate } from "./manual-prior-authority.ts";
import { everydayRoutingProjectionFromRecords, type EverydayRoutingRecord } from "../routing/everyday.ts";

const hash = (value: unknown) => createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex");

function exactMembers(payload: CuratedReaderProjection): Map<string, CuratedReaderProjection["records"][number]> {
  if (!payload || !Array.isArray(payload.records)) throw new Error("MANUAL_SUCCESSOR_BASE_RECORDS_INVALID");
  const members = new Map<string, CuratedReaderProjection["records"][number]>();
  for (const row of payload.records) {
    if (!row || typeof row.id !== "string" || !row.id || members.has(row.id)) throw new Error("MANUAL_SUCCESSOR_BASE_MEMBER_INVALID");
    members.set(row.id, row);
  }
  return members;
}

/** One removal row per pulled member, keyed the way change accounting keys the prior version. */
function auditPullEvidence(baseModel: CuratedReaderProjection, memberIds: readonly string[]): AuditPullRemovalEvidence[] {
  const wanted = new Set(memberIds);
  return civicRecordsFor("CURATED_READER_RECORD", baseModel)
    .filter((row) => wanted.has((row.record as { id: string }).id))
    .map((row) => ({ key: row.key, code: "REMOVED_BY_AUDIT_PULL" as const, memberId: (row.record as { id: string }).id }));
}

/**
 * Producer-only composition. The existing source builder certifies this review's
 * facts; omitted GOOD facts retain their exact old bytes and explicit authority.
 * Neither Reader code nor the retired bootstrap admission door changes.
 */
export async function prepareManualProjectionSuccessor(
  input: ManualProjectionPackage,
  store: CivicDataReadStore,
  now: string,
  /** Members an auditor pulled (BROKE): they leave this version instead of being inherited from the base (DP-15). */
  pulledMemberIds: ReadonlySet<string> = new Set(),
): Promise<{ readonly candidate: ManualSuccessorCandidate; readonly expectedBaseVersionId: string | null }> {
  const contract = requiredManualProductionContract(input.contractId);
  if (contract.recordClass !== "CURATED_READER_RECORD") {
    const prior = await readManualProjectionPrior(input.contractId, store, now);
    return { candidate: manualProjectionCandidate(input, { prior }), expectedBaseVersionId: prior?.versionId ?? null };
  }
  const fresh = manualProjectionCandidate(input);
  const read = await readPromotedCivicData<CuratedReaderProjection>(contract.recordClass, fresh.scope, { store, now, bypassCache: true });
  if (read.kind === "NOT_RECORDED") return { candidate: fresh, expectedBaseVersionId: null };
  if (read.kind !== "PROMOTED") throw new Error(`MANUAL_PROMOTION_BASE_UNAVAILABLE:${input.contractId}:${read.detail}`);
  const base = await store.readCandidate(read.projection.versionId);
  if (!base || base.candidate.sourceId !== fresh.sourceId || hash(base.candidate.readModel) !== hash(read.value)) {
    throw new Error("MANUAL_SUCCESSOR_EXACT_BASE_UNAVAILABLE");
  }
  const current = exactMembers(fresh.readModel as CuratedReaderProjection);
  const prior = exactMembers(read.value);
  const currentContactCells = new Set([...current.values()].filter((row) => row.kind === "CONTACT")
    .map((row) => `${row.topicId}|${row.zip}`));
  const resolvedOwed = new Set<string>();
  const pulled = [...prior].filter(([id]) => pulledMemberIds.has(id) && !current.has(id));
  const inherited = [...prior].filter(([id, row]) => {
    if (current.has(id)) return false;
    if (pulledMemberIds.has(id)) return false;
    if (input.contractId === "everyday-routing" && row.kind === "CONTACT_OWED" && currentContactCells.has(`${row.topicId}|${row.zip}`)) {
      resolvedOwed.add(id);
      return false;
    }
    return true;
  });
  if (inherited.length === 0) {
    const pulledFacts = pulled.map(([key, record]) => ({ key, code: "AUDIT_PULLED_FROM_VERSION",
      detail: "An auditor broke this published member; it is not carried into the next version.", record }));
    return { candidate: pulledFacts.length ? { ...fresh, excludedFacts: [...(fresh.excludedFacts ?? []), ...pulledFacts],
      removalEvidence: auditPullEvidence(read.value, pulled.map(([id]) => id)) } : fresh,
      expectedBaseVersionId: base.candidate.id };
  }
  const inheritedIds = new Set(inherited.map(([id]) => id));
  const priorIdentities = base.candidate.identities.filter((identity) => inheritedIds.has(identity.identifiers.record_id));
  if (new Set(priorIdentities.map((identity) => identity.identifiers.record_id)).size !== inheritedIds.size) {
    throw new Error("MANUAL_SUCCESSOR_RETAINED_IDENTITY_PROOF_UNAVAILABLE");
  }
  const records = [...current, ...inherited].sort(([left], [right]) => left.localeCompare(right)).map(([, row]) => row);
  const payload = input.contractId === "everyday-routing"
    ? everydayRoutingProjectionFromRecords(records as unknown as readonly EverydayRoutingRecord[])
    : { ...(fresh.readModel as CuratedReaderProjection), records };
  const civicRecords = civicRecordsFor(fresh.recordClass, payload);
  const normalizedHash = hash(payload);
  const candidate: ManualSuccessorCandidate = {
    ...fresh,
    id: `${fresh.sourceId}:${hash({ freshId: fresh.id, base: base.candidate.id, normalizedHash }).slice(0, 32)}`,
    normalization: { ...fresh.normalization, normalizedHash, normalizedPayloadHash: normalizedHash,
      inputRecords: civicRecords.length + fresh.normalization.droppedRecords, outputRecords: civicRecords.length },
    identities: [...fresh.identities, ...priorIdentities],
    horizon: { ...fresh.horizon, returnedRecords: civicRecords.length },
    normalizedPayload: payload, readModel: payload, civicRecords,
    manualPriorAuthority: { kind: "VALIDATED_PRIOR_PROJECTION", versionId: base.candidate.id,
      readModelSha256: hash(base.candidate.readModel), retainedMembers: inherited.map(([key, row]) => ({ key, sha256: hash(row) })) },
    ...(pulled.length ? { removalEvidence: auditPullEvidence(read.value, pulled.map(([id]) => id)) } : {}),
    excludedFacts: [ ...(fresh.excludedFacts ?? []), ...inherited.map(([key, record]) => ({ key,
      code: "MANUAL_MEMBER_HELD_LKG", detail: "Exact prior GOOD member retained; this review supplies no independently proven replacement or removal.", record })),
      ...pulled.map(([key, record]) => ({ key, code: "AUDIT_PULLED_FROM_VERSION",
        detail: "An auditor broke this published member; it is not carried into the next version.", record })),
      ...[...resolvedOwed].map((key) => ({ key, code: "CONTACT_OWED_RESOLVED_BY_SUPPORTED_CONTACT",
        detail: "The current source-reviewed contact covers this exact topic/ZIP cell.", record: prior.get(key) })),
    ],
  };
  const issue = manualPriorAuthorityIssue(candidate, base);
  if (issue) throw new Error(`MANUAL_PROMOTION_BASE_PROOF_INVALID:${input.contractId}:${issue}`);
  return { candidate, expectedBaseVersionId: base.candidate.id };
}
