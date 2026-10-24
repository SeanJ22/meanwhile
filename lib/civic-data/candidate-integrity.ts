import { durableCivicDataHash } from "./canonical-hash.ts";
import { durableStateHash, statePublicationScope } from "./state-publication.ts";
import { federalMoneySavedSourceIssue } from "../federal-money/verify.ts";
import { VOTING_SOURCE_REPLACEMENT_VERIFIER, votingSourceReplacement, votingSourceReplacementVerifier } from "../ballot/voting-source-replacement-contract.ts";

import { candidateChangeSet } from "./changes.ts";
import type { RoutineSourceContract } from "./contracts.ts";
import type { ManualProductionSourceContract } from "./manual-contracts.ts";
import type { MeetingPartitionContract } from "./meeting-partitions.ts";
import { readMeetingPartitionProjection } from "../meetings/snapshot.ts";
import { verifyRoutineReaderProjection, type RoutineReaderVerification } from "./reader-verification.ts";
import {
  candidateVersionSummary,
  publishedCandidateMetadata,
  projectionKey,
  promotedPointerIdentity,
  type CandidateVersionReadback,
  type RoutineDataStore,
} from "./store.ts";
import {
  VALIDATION_CHECKS,
  type CandidateEvent,
  type CandidateVersionRecord,
  type PromotedProjection,
  type RoutineCandidate,
  type RoutineRecordClass,
  type ValidationReceipt,
} from "./types.ts";

type CandidateContract = RoutineSourceContract | ManualProductionSourceContract;
const SHA256 = /^[a-f0-9]{64}$/;

function pass(verifierId: string, detail: string): RoutineReaderVerification {
  return { verifierId, status: "PASS", detail };
}

function fail(verifierId: string, detail: string): RoutineReaderVerification {
  return { verifierId, status: "FAIL", detail };
}

export function candidateHasIntrinsicHorizonRefusal(candidate: RoutineCandidate): boolean {
  return candidate.horizon.returnedRecords === candidate.normalization.outputRecords &&
    candidate.horizon.claimsComplete &&
    (
      candidate.horizon.kind !== "BOUNDED" ||
      !candidate.horizon.paginationComplete ||
      candidate.horizon.declaredTotal !== candidate.horizon.returnedRecords
    );
}

function preflightReceipt(candidate: RoutineCandidate, observedAt: string): ValidationReceipt {
  return {
    contractVersion: 2,
    decision: "GOOD",
    candidateId: candidate.id,
    sourceId: candidate.sourceId,
    recordClass: candidate.recordClass,
    scope: candidate.scope,
    validatedAt: observedAt,
    checks: VALIDATION_CHECKS.map((check) => ({
      check,
      verdict: "PASS" as const,
      code: candidate.bootstrapImport && check === "SOURCE_AUTHENTICITY"
        ? candidate.bootstrapImport.kind === "TRUSTED_LKG_REATTESTATION"
          ? "TRUSTED_LKG_REATTESTATION_PROVENANCE_VALID"
          : "TRUSTED_LKG_IMPORT_PROVENANCE_VALID"
        : `SOURCE_SCOPED_PREFLIGHT_${check}`,
      detail: "Ephemeral read-only candidate projection used only for pre-promotion structural verification.",
    })),
    excludedFacts: candidate.excludedFacts ?? [],
  };
}

function candidateReadOnlyStore(
  candidate: RoutineCandidate,
  observedAt: string,
  predecessor: CandidateVersionRecord | null,
): RoutineDataStore {
  const provedCandidate: RoutineCandidate = candidate.changeSet
    ? candidate
    : {
        ...candidate,
        changeSet: candidateChangeSet(candidate, predecessor?.candidate.readModel ?? null),
      };
  const receipt = preflightReceipt(provedCandidate, observedAt);
  const projection: PromotedProjection = {
    key: projectionKey(candidate.recordClass, candidate.scope),
    sourceId: candidate.sourceId,
    recordClass: candidate.recordClass,
    scope: candidate.scope,
    versionId: candidate.id,
    lastKnownGoodVersionId: candidate.id,
    promotedAt: observedAt,
    payload: provedCandidate.readModel,
    receipt,
  };
  const record: CandidateVersionRecord = {
    candidate: provedCandidate,
    state: "PROMOTED",
    acquisitionSucceeded: true,
    receipt,
    promotedVersion: candidate.id,
    lastKnownGoodVersion: candidate.id,
    failureCode: null,
    failureDetail: null,
  };
  const readOnly = async (): Promise<never> => {
    throw new Error("SOURCE_SCOPED_PREFLIGHT_STORE_IS_READ_ONLY");
  };
  return {
    create: readOnly,
    transition: readOnly,
    promote: readOnly,
    appendEvidence: readOnly,
    readCandidate: async (candidateId) => candidateId === candidate.id
      ? record
      : predecessor?.candidate.id === candidateId ? predecessor : null,
    readRegistryDivisions: async () => [],
    readPublishedCandidateMetadata: async (candidateId) => candidateId === candidate.id
      ? publishedCandidateMetadata(record)
      : predecessor?.candidate.id === candidateId ? publishedCandidateMetadata(predecessor) : null,
    readCandidateSummary: async (candidateId) => candidateId === candidate.id
      ? candidateVersionSummary(record)
      : predecessor?.candidate.id === candidateId ? candidateVersionSummary(predecessor) : null,
    readCandidates: async (candidateIds): Promise<readonly CandidateVersionReadback[]> =>
      [
        ...(candidateIds.includes(candidate.id) ? [{ candidateId: candidate.id, record }] : []),
        ...(predecessor && candidateIds.includes(predecessor.candidate.id)
          ? [{ candidateId: predecessor.candidate.id, record: predecessor }]
          : []),
      ],
    readPromotion: async <T>(recordClass: RoutineRecordClass, scope: string) =>
      recordClass === candidate.recordClass && scope === candidate.scope
        ? projection as PromotedProjection<T>
        : null,
    readPromotions: async <T>(recordClass: RoutineRecordClass, scopes: readonly string[]) =>
      recordClass === candidate.recordClass && scopes.includes(candidate.scope)
        ? [projection as PromotedProjection<T>]
        : [],
    readPromotionIdentity: async (recordClass, scope) =>
      recordClass === candidate.recordClass && scope === candidate.scope
        ? promotedPointerIdentity(projection)
        : null,
    readPromotionIdentities: async (recordClass, scopes) =>
      recordClass === candidate.recordClass && scopes.includes(candidate.scope)
        ? [promotedPointerIdentity(projection)]
        : [],
    events: async (_candidateId): Promise<readonly CandidateEvent[]> => [],
    clock: async () => ({}),
  };
}

export async function verifySourceScopedCandidateProjection(
  contract: CandidateContract,
  candidate: RoutineCandidate,
  observedAt: string,
  predecessor: CandidateVersionRecord | null = null,
  proofStore?: RoutineDataStore,
): Promise<RoutineReaderVerification> {
  if (!candidate.retrieval.succeeded || !candidate.normalization.succeeded) {
    return pass(
      "lib/civic-data/candidate-integrity.ts#nonPromotableAttempt",
      "The attempt cannot reach promotion, so no candidate projection was exposed to a Reader.",
    );
  }
  if (candidateHasIntrinsicHorizonRefusal(candidate)) {
    return pass(
      "lib/civic-data/candidate-integrity.ts#intrinsicHorizonRefusal",
      "The candidate's own completeness envelope refuses promotion, so no incomplete value was exposed to a typed Reader.",
    );
  }

  // JSONB is the durable authority. Reject values whose in-memory meaning
  // would change or disappear when persisted before any typed Reader sees it.
  try {
    const scoped = statePublicationScope(candidate.scope);
    const readModelCanonical = scoped ? durableStateHash(candidate.readModel) : durableCivicDataHash(candidate.readModel);
    const normalizedPayloadCanonical = candidate.normalizedPayload === candidate.readModel ? readModelCanonical :
      scoped ? durableStateHash(candidate.normalizedPayload) : durableCivicDataHash(candidate.normalizedPayload);
    if (readModelCanonical === null) {
      return fail(
        "lib/civic-data/candidate-integrity.ts#durableJsonRoundTrip",
        "The proposed Reader projection changes under the canonical JSONB round trip.",
      );
    }
    if (normalizedPayloadCanonical === null) {
      return fail(
        "lib/civic-data/candidate-integrity.ts#durableJsonRoundTrip",
        "The normalized evidence changes under the canonical JSONB round trip.",
      );
    }
    if (
      !candidate.normalization.normalizedHash ||
      !SHA256.test(candidate.normalization.normalizedHash) ||
      candidate.normalization.normalizedHash !== readModelCanonical
    ) {
      return fail(
        "lib/civic-data/candidate-integrity.ts#readModelDigest",
        "The normalized hash does not bind the exact bounded Reader projection.",
      );
    }
    if (
      !candidate.normalization.normalizedPayloadHash ||
      !SHA256.test(candidate.normalization.normalizedPayloadHash) ||
      candidate.normalization.normalizedPayloadHash !== normalizedPayloadCanonical
    ) {
      return fail(
        "lib/civic-data/candidate-integrity.ts#normalizedEvidenceDigest",
        "The registered candidate does not bind its exact normalized/provenance evidence envelope.",
      );
    }
  } catch (error) {
    return fail(
      "lib/civic-data/candidate-integrity.ts#durableJsonRoundTrip",
      `The proposed Reader projection is not durable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (contract.readerProjection === null) return fail("lib/civic-data/candidate-integrity.ts#readerProjection", "The source contract declares no typed Reader projection.");

  if (candidate.recordClass === "FEDERAL_MONEY") {
    const { FEDERAL_MONEY_SOURCES } = await import("../federal-money/model.ts");
    const source = FEDERAL_MONEY_SOURCES.find((source) => source === contract.sourceId);
    const verifierId = "lib/federal-money/verify.ts#federalMoneySavedSourceIssue";
    if (!source) return fail(verifierId, "The federal source is not registered.");
    const sourceIssue = await federalMoneySavedSourceIssue(candidate, source, predecessor?.candidate ?? null, proofStore);
    if (sourceIssue) return fail(verifierId, sourceIssue);
  }
  if(candidate.sourceId==="legiscan-bills"&&candidate.recordClass==="STATE_BILL"){
    const {bulkManifestIssue}=await import("../sources/legiscan/publication.ts");
    const issue=await bulkManifestIssue(candidate,proofStore);
    if(issue)return fail("lib/sources/legiscan/publication.ts#bulkManifestIssue",issue);
  }

  const replacement = candidate.recordClass === "VOTING_SITE" && votingSourceReplacement(candidate.normalizedPayload);
  if (replacement) {
    if (!predecessor && proofStore) {
      const pointer = await proofStore.readPromotionIdentity(candidate.recordClass, candidate.scope);
      if (pointer) predecessor = await proofStore.readCandidate(pointer.versionId);
    }
    const verify = votingSourceReplacementVerifier();
    const issue = verify ? await verify(candidate, predecessor?.candidate ?? null)
      : "The saved-source replacement verifier is not loaded in this process; the replacement stays held.";
    if (issue) return fail(VOTING_SOURCE_REPLACEMENT_VERIFIER, issue);
  }

  const store = candidateReadOnlyStore(candidate, observedAt, predecessor);
  if (candidate.recordClass === "MEETING") {
    const partition = contract as MeetingPartitionContract;
    const result = await readMeetingPartitionProjection(partition, {
      store,
      now: observedAt,
      bypassCache: true,
    });
    return result.kind === "PROMOTED" && result.metadata.versionId === candidate.id
      ? pass(
          "lib/meetings/snapshot.ts#readMeetingPartitionProjection",
          `The source-scoped typed meeting Reader accepted only ${partition.id}:${candidate.id}.`,
        )
      : fail(
          "lib/meetings/snapshot.ts#readMeetingPartitionProjection",
          `The source-scoped typed meeting Reader refused ${partition.id}:${candidate.id}: ${result.kind}:` +
            `${"detail" in result ? result.detail : "projection mismatch"}.`,
        );
  }
  const verification = await verifyRoutineReaderProjection(contract, {
    store,
    now: observedAt,
    expectedVersionId: candidate.id,
    scope: candidate.scope,
  });
  return replacement && verification.status === "PASS"
    ? pass(VOTING_SOURCE_REPLACEMENT_VERIFIER, `Complete saved official sources reconstruct the exact scoped successor. ${verification.detail}`)
    : verification;
}
