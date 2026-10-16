import { rememberStatePublicationHashes, withStateRecordHashes } from "./state-publication.ts";
import { processRoutineCandidate } from "./candidate-lifecycle.ts";
import type { CandidateVersionRecord, PromotedProjection, RoutineCandidate } from "./types.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "./store.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { requiredRoutineContract, type RoutineSourceContract } from "./contracts.ts";
import { meetingHistoryContract, requiredMeetingPartitionContract } from "./meeting-partitions.ts";
import { movedToHistoryAuthorityIssue } from "./meeting-history.ts";
import { routineTaskFromContract } from "./runner.ts";
import { authorityFor, authorityForManualReceipt } from "./source-authority.ts";
import {
  requiredManualProductionContract,
  type ManualProductionContractId,
  type ManualProductionSourceContract,
} from "./manual-contracts.ts";
import type { ReaderProjectionReadbackReceipt } from "./reader-readback.ts";
import { recordRoutineReaderProjectionReadback } from "./reader-verification.ts";
import { trustedLkgImportUrl } from "./trusted-lkg-import.ts";
import { assertRegisteredRuntimeContract } from "./runtime-authority.ts";
import { verifySourceScopedCandidateProjection } from "./candidate-integrity.ts";
import { officialStateRollIdentityAuthorityIssue } from "../state-rollcalls/promotion-authority.ts";
import { derivedInputAuthorityIssue } from "./derived-door.ts";
import { isScopedManualContractScope, manualPayloadScope } from "./scoped-manual-contracts.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { freezeDurableJson } from "./durable-json.ts";
import { immutableStateCandidate, statePublicationScope, withStatePublicationRead } from "./state-publication.ts";

/** Only the exact registered contract doors in this module possess this token. */
const REGISTERED_PRODUCTION_DOOR = Symbol("REGISTERED_PRODUCTION_DOOR");

export const isRegisteredCandidateDoor = (door: symbol | null): boolean => door === REGISTERED_PRODUCTION_DOOR;

export function trustedLkgPredecessorVersionId(candidate: RoutineCandidate): string | null {
  const evidence = candidate.bootstrapImport;
  if (evidence?.kind === "TRUSTED_LKG_REATTESTATION") return evidence.predecessorVersionId;
  return evidence?.kind === "TRUSTED_LKG_IMPORT"
    ? evidence.pimaOutcomeUnion?.predecessorVersionId ?? null
    : null;
}

function sourceProjectionObservedAt(store: RoutineDataStore, requested: string): string {
  return store instanceof PostgresRoutineDataStore ? new Date().toISOString() : requested;
}

/** A state candidate takes its immutable state form; any other becomes its own JSON form, frozen in place.
 * Either way no adapter can swap payload and digest between async steps. */
function durableCandidate(candidate: RoutineCandidate): RoutineCandidate {
  try {
    if (statePublicationScope(candidate.scope)) return withStateRecordHashes(immutableStateCandidate(candidate));
    return freezeDurableJson(candidate);
  } catch (error) {
    throw new Error(
      `ROUTINE_CANDIDATE_NOT_DURABLE_JSON:${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface PromotionOutcome {
  readonly candidate: CandidateVersionRecord;
  readonly promoted: PromotedProjection | null;
  readonly readerReadback: ReaderProjectionReadbackReceipt | null;
    /** Present when a re-check found nothing new: `candidate` is the pointed record and `promoted` the unchanged pointer. */
  readonly confirmed?: {
    readonly versionId: string;
    readonly at: string;
    readonly recheck: RoutineCandidate;
  };
}

async function appendTypedReaderProjectionReadback(
  store: RoutineDataStore,
  contract: RoutineSourceContract | ManualProductionSourceContract,
  outcome: PromotionOutcome,
  requestedAt: string,
): Promise<PromotionOutcome> {
  if (outcome.promoted && statePublicationScope(outcome.promoted.scope))
    rememberStatePublicationHashes(outcome.promoted, outcome.candidate.candidate.normalization);
  if (outcome.promoted === null || outcome.confirmed || contract.readerProjection === null) return outcome;
  const read = () => recordRoutineReaderProjectionReadback(store, contract, outcome.promoted!, requestedAt);
  const receipt = await (statePublicationScope(outcome.promoted.scope) ? withStatePublicationRead(outcome.promoted, read) : read());
  return { ...outcome, readerReadback: receipt };
}

function routineCandidateContractIssueFor(
  contract: RoutineSourceContract,
  candidate: RoutineCandidate,
): string | null {
  const task = routineTaskFromContract(contract);
  if (candidate.sourceId !== task.sourceId) return `source ${candidate.sourceId} does not equal ${task.sourceId}`;
  if (candidate.recordClass !== task.recordClass) return `record class ${candidate.recordClass} does not equal ${task.recordClass}`;
  if (candidate.scope !== task.scope) return `scope ${candidate.scope} does not equal ${task.scope}`;
  if (candidate.normalization.parserVersion !== task.parserVersion) return `parser ${candidate.normalization.parserVersion} does not equal ${task.parserVersion}`;
  if (candidate.bootstrapImport) {
    if (candidate.bootstrapImport.contractId !== contract.id) {
      return `trusted-LKG contract ${candidate.bootstrapImport.contractId} does not equal ${contract.id}`;
    }
    if (
      candidate.bootstrapImport.kind === "TRUSTED_LKG_IMPORT" &&
      (candidate.retrieval.requestedUrl !== trustedLkgImportUrl(contract.id) || candidate.retrieval.finalUrl !== null)
    ) {
      return "trusted-LKG retrieval envelope does not name this exact registered contract";
    }
    return null;
  }
  if (task.authorityMode === "DERIVED") {
    if (candidate.retrieval.requestedUrl !== task.requestedUrl) return `a derived candidate requests ${task.requestedUrl}, not ${candidate.retrieval.requestedUrl}`;
    if (candidate.retrieval.finalUrl !== null) return "a derived candidate has no final URL";
    if (candidate.retrieval.succeeded && candidate.retrieval.derived === undefined) return "a derived candidate names the inputs it was computed from";
    return null;
  }
  if (task.authorityMode === "SINGLE_ROUTE") {
    if (!candidate.retrieval.requestedUrl.startsWith(task.requestedUrl)) return `requested route ${candidate.retrieval.requestedUrl} is outside ${task.requestedUrl}`;
    const authority = authorityFor(task.sourceId, task.recordClass, candidate.retrieval.requestedUrl);
    if (!authority.ok) return `${authority.code}: ${authority.detail}`;
  } else if (candidate.retrieval.succeeded) {
    const authority = authorityFor(task.sourceId, task.recordClass, candidate.retrieval.requestedUrl);
    if (!authority.ok) return `${authority.code}: ${authority.detail}`;
  } else if (candidate.retrieval.requestedUrl !== "") {
    const authority = authorityFor(task.sourceId, task.recordClass, candidate.retrieval.requestedUrl);
    if (!authority.ok) return `${authority.code}: ${authority.detail}`;
  }
  return null;
}

export function routineCandidateContractIssue(contractId: string, candidate: RoutineCandidate): string | null {
  return routineCandidateContractIssueFor(requiredRoutineContract(contractId), candidate);
}

export async function processRegisteredRoutineCandidate(
  store: RoutineDataStore,
  contractId: string,
  candidate: RoutineCandidate,
  now: string = new Date().toISOString(),
  expectedBaseVersionId: string | null | undefined = undefined,
  // Rechecks keep the held version by default. Explicit false is reserved for
  // callers that need a distinct candidate even when its facts are unchanged.
  options: { readonly confirmUnchanged?: boolean; readonly vault?: EvidenceStore } = {},
): Promise<PromotionOutcome> {
  if (store instanceof PostgresRoutineDataStore) assertRegisteredRuntimeContract(contractId, "routine");
  let boundedCandidate = durableCandidate(candidate);
  const contract = requiredRoutineContract(contractId);
  if (Object.prototype.hasOwnProperty.call(boundedCandidate, "bootstrapImport") && boundedCandidate.bootstrapImport !== undefined) {
    throw new Error("TRUSTED_LKG_ADMISSION_RETIRED");
  }
  const issue = routineCandidateContractIssue(contractId, boundedCandidate);
  if (issue !== null) throw new Error(`ROUTINE_CANDIDATE_CONTRACT_MISMATCH:${contractId}:${issue}`);
  boundedCandidate = await withDerivedInputAuthority(store, contract, boundedCandidate);
  const identityAuthorityIssue = await officialStateRollIdentityAuthorityIssue(store, boundedCandidate);
  if (identityAuthorityIssue !== null) {
    boundedCandidate = {
      ...boundedCandidate,
      dependentChecks: [
        ...boundedCandidate.dependentChecks,
        {
          consumer: "canonical official state-legislator identity authority",
          passed: false,
          detail: identityAuthorityIssue,
        },
      ],
    };
  }
  const sourceProjectionVerification = await verifySourceScopedCandidateProjection(
    contract,
    boundedCandidate,
    sourceProjectionObservedAt(store, now),
    trustedLkgPredecessorVersionId(boundedCandidate) !== null
      ? await store.readCandidate(trustedLkgPredecessorVersionId(boundedCandidate)!)
      : null,
  );
  return appendTypedReaderProjectionReadback(
    store,
    contract,
    await processRoutineCandidate(
      store,
      boundedCandidate,
      now,
      expectedBaseVersionId,
      REGISTERED_PRODUCTION_DOOR,
      sourceProjectionVerification,
      options,
    ),
    now,
  );
}

/** A fan-out contract owns a scope family: its per-state marker plus one candidate per `<sourceId>:<officeholderId>`. */
function routineCandidateFanOutContractIssue(
  contract: RoutineSourceContract,
  candidate: RoutineCandidate,
): string | null {
  const task = routineTaskFromContract(contract);
  if (candidate.sourceId !== task.sourceId) return `source ${candidate.sourceId} does not equal ${task.sourceId}`;
  if (candidate.recordClass !== task.recordClass) return `record class ${candidate.recordClass} does not equal ${task.recordClass}`;
  if (candidate.scope !== task.scope && !candidate.scope.startsWith(`${task.sourceId}:`)) {
    return `scope ${candidate.scope} is outside the ${task.sourceId} fan-out family (${task.scope} or ${task.sourceId}:*)`;
  }
  if (candidate.normalization.parserVersion !== task.parserVersion) return `parser ${candidate.normalization.parserVersion} does not equal ${task.parserVersion}`;
  if (candidate.bootstrapImport) return "a fan-out member candidate does not accept trusted-LKG import";
  if (candidate.retrieval.succeeded || candidate.retrieval.requestedUrl !== "") {
    const authority = authorityFor(task.sourceId, task.recordClass, candidate.retrieval.requestedUrl);
    if (!authority.ok) return `${authority.code}: ${authority.detail}`;
  }
  return null;
}

export async function processRegisteredFanOutCandidate(
  store: RoutineDataStore,
  contractId: string,
  candidate: RoutineCandidate,
  now: string = new Date().toISOString(),
  expectedBaseVersionId: string | null | undefined = undefined,
): Promise<PromotionOutcome> {
  if (store instanceof PostgresRoutineDataStore) assertRegisteredRuntimeContract(contractId, "routine");
  const boundedCandidate = durableCandidate(candidate);
  const contract = requiredRoutineContract(contractId);
  if (contract.fanOut !== true) throw new Error(`FANOUT_CONTRACT_NOT_DECLARED:${contractId}`);
  if (Object.prototype.hasOwnProperty.call(boundedCandidate, "bootstrapImport") && boundedCandidate.bootstrapImport !== undefined) {
    throw new Error("TRUSTED_LKG_ADMISSION_RETIRED");
  }
  const issue = routineCandidateFanOutContractIssue(contract, boundedCandidate);
  if (issue !== null) throw new Error(`FANOUT_CANDIDATE_CONTRACT_MISMATCH:${contractId}:${issue}`);
  const federalPrior = boundedCandidate.recordClass === "FEDERAL_MONEY"
    ? await store.readPromotion(boundedCandidate.recordClass, boundedCandidate.scope) : null;
  const sourceProjectionVerification = await verifySourceScopedCandidateProjection(
    contract,
    boundedCandidate,
    sourceProjectionObservedAt(store, now),
    federalPrior ? await store.readCandidate(federalPrior.versionId) : null,
    store,
  );
  return appendTypedReaderProjectionReadback(
    store,
    contract,
    await processRoutineCandidate(
      store,
      boundedCandidate,
      now,
      expectedBaseVersionId,
      REGISTERED_PRODUCTION_DOOR,
      sourceProjectionVerification,
    ),
    now,
  );
}

/** No readback here: `repairMeetingReaderProjectionReadbacks` records each partition's from one aggregate read per pass. */
export async function processRegisteredMeetingPartitionCandidate(
  store: RoutineDataStore,
  partitionId: string,
  candidate: RoutineCandidate,
  now: string = new Date().toISOString(),
  expectedBaseVersionId: string | null | undefined = undefined,
  options: { readonly confirmUnchanged?: boolean } = {},
): Promise<PromotionOutcome> {
  if (store instanceof PostgresRoutineDataStore) assertRegisteredRuntimeContract(partitionId, "routine");
  const boundedCandidate = durableCandidate(candidate);
  const contract = requiredMeetingPartitionContract(partitionId);
  const issue = routineCandidateContractIssueFor(contract, boundedCandidate);
  if (issue !== null) {
    throw new Error(`MEETING_PARTITION_CANDIDATE_MISMATCH:${partitionId}:${issue}`);
  }
  const derivedChecked = await withMovedToHistoryAuthority(store, await withDerivedInputAuthority(store, contract, boundedCandidate));
  const sourceProjectionVerification = await verifySourceScopedCandidateProjection(
    contract,
    derivedChecked,
    sourceProjectionObservedAt(store, now),
    trustedLkgPredecessorVersionId(boundedCandidate) !== null
      ? await store.readCandidate(trustedLkgPredecessorVersionId(boundedCandidate)!)
      : null,
  );
  return processRoutineCandidate(
    store,
    derivedChecked,
    now,
    expectedBaseVersionId,
    REGISTERED_PRODUCTION_DOOR,
    sourceProjectionVerification,
    options,
  );
}

export async function processRegisteredMeetingHistoryCandidate(
  store: RoutineDataStore,
  partitionId: string,
  candidate: RoutineCandidate,
  now: string = new Date().toISOString(),
  expectedBaseVersionId: string | null | undefined = undefined,
  options: { readonly confirmUnchanged?: boolean } = {},
): Promise<PromotionOutcome> {
  if (store instanceof PostgresRoutineDataStore) assertRegisteredRuntimeContract(partitionId, "routine");
  const boundedCandidate = durableCandidate(candidate);
  const contract = meetingHistoryContract(requiredMeetingPartitionContract(partitionId));
  const issue = routineCandidateContractIssueFor(contract, boundedCandidate);
  if (issue !== null) {
    throw new Error(`MEETING_HISTORY_CANDIDATE_MISMATCH:${partitionId}:${issue}`);
  }
  const derivedChecked = await withDerivedInputAuthority(store, contract, boundedCandidate);
  const sourceProjectionVerification = await verifySourceScopedCandidateProjection(
    contract,
    derivedChecked,
    sourceProjectionObservedAt(store, now),
    null,
  );
  return processRoutineCandidate(
    store,
    derivedChecked,
    now,
    expectedBaseVersionId,
    REGISTERED_PRODUCTION_DOOR,
    sourceProjectionVerification,
    options,
  );
}

async function withMovedToHistoryAuthority(store: RoutineDataStore, candidate: RoutineCandidate): Promise<RoutineCandidate> {
  const issue = await movedToHistoryAuthorityIssue(store, candidate);
  return issue === null
    ? candidate
    : {
        ...candidate,
        dependentChecks: [
          ...candidate.dependentChecks,
          { consumer: "moved-to-history authority (lib/civic-data/meeting-history.ts)", passed: false, detail: issue },
        ],
      };
}

async function withDerivedInputAuthority(
  store: RoutineDataStore,
  contract: RoutineSourceContract,
  candidate: RoutineCandidate,
): Promise<RoutineCandidate> {
  if (contract.acquisitionAdapter.authorityMode !== "DERIVED" || candidate.retrieval.derived === undefined) return candidate;
  const issue = await derivedInputAuthorityIssue(store, candidate);
  return issue === null
    ? candidate
    : {
        ...candidate,
        dependentChecks: [
          ...candidate.dependentChecks,
          { consumer: "derived input authority (lib/civic-data/derived-door.ts)", passed: false, detail: issue },
        ],
      };
}

export function manualCandidateContractIssue(contractId: ManualProductionContractId, candidate: RoutineCandidate): string | null {
  const contract = requiredManualProductionContract(contractId);
  if (candidate.sourceId !== contract.sourceId) return `source ${candidate.sourceId} does not equal ${contract.sourceId}`;
  if (candidate.recordClass !== contract.recordClass) return `record class ${candidate.recordClass} does not equal ${contract.recordClass}`;
  if (candidate.scope !== contract.scope && !isScopedManualContractScope(contractId, candidate.scope)) return `scope ${candidate.scope} does not equal ${contract.scope}`;
  if (isScopedManualContractScope(contractId, candidate.scope)) {
    try {
      if (manualPayloadScope(contractId, contract.scope, candidate.readModel) !== candidate.scope) return "scoped candidate records do not belong to its exact jurisdiction";
    } catch { return "scoped candidate records have no exact jurisdiction"; }
  }
  if (candidate.normalization.parserVersion !== contract.parserNormalizerVersion) {
    return `parser ${candidate.normalization.parserVersion} does not equal ${contract.parserNormalizerVersion}`;
  }
  if (candidate.bootstrapImport) {
    if (candidate.bootstrapImport.contractId !== contract.id) {
      return `trusted-LKG contract ${candidate.bootstrapImport.contractId} does not equal ${contract.id}`;
    }
    if (
      candidate.bootstrapImport.kind === "TRUSTED_LKG_IMPORT" &&
      (candidate.retrieval.requestedUrl !== trustedLkgImportUrl(contract.id) || candidate.retrieval.finalUrl !== null)
    ) {
      return "trusted-LKG retrieval envelope does not name this exact registered contract";
    }
    return null;
  }
  const finalUrl = candidate.retrieval.finalUrl ?? candidate.retrieval.requestedUrl;
  if (candidate.retrieval.succeeded || finalUrl !== "") {
    const authority = candidate.retrieval.manualSourceReceipt
      ? authorityForManualReceipt(
          contract.sourceId,
          contract.recordClass,
          candidate.retrieval.manualSourceReceipt,
          candidate.retrieval.finalUrl,
        )
      : authorityFor(contract.sourceId, contract.recordClass, finalUrl);
    if (!authority.ok) return `${authority.code}: ${authority.detail}`;
  }
  return null;
}

export async function processRegisteredManualCandidate(
  store: RoutineDataStore,
  contractId: ManualProductionContractId,
  candidate: RoutineCandidate,
  now: string = new Date().toISOString(),
  expectedBaseVersionId: string | null | undefined = undefined,
  options: { readonly confirmUnchanged?: boolean } = {},
): Promise<PromotionOutcome> {
  if (store instanceof PostgresRoutineDataStore) assertRegisteredRuntimeContract(contractId, "manual");
  const boundedCandidate = durableCandidate(candidate);
  const contract = requiredManualProductionContract(contractId);
  const issue = manualCandidateContractIssue(contractId, boundedCandidate);
  if (issue !== null) throw new Error(`MANUAL_CANDIDATE_CONTRACT_MISMATCH:${contractId}:${issue}`);
  const sourceProjectionVerification = await verifySourceScopedCandidateProjection(
    contract,
    boundedCandidate,
    sourceProjectionObservedAt(store, now),
    trustedLkgPredecessorVersionId(boundedCandidate) !== null
      ? await store.readCandidate(trustedLkgPredecessorVersionId(boundedCandidate)!)
      : null,
  );
  return appendTypedReaderProjectionReadback(
    store,
    contract,
    await processRoutineCandidate(store, boundedCandidate, now, expectedBaseVersionId, REGISTERED_PRODUCTION_DOOR, sourceProjectionVerification, options),
    now,
  );
}

/** A re-check whose read model cites a moved outside authority (a roll call's roster version) promotes. */
export function sameCitedAuthority(candidate: RoutineCandidate, pointed: RoutineCandidate): boolean {
  const cited = (value: RoutineCandidate) => {
    const readModel = value.readModel as { readonly officialIdentityAuthority?: unknown } | null;
    return canonicalCivicDataJson(readModel && typeof readModel === "object" ? readModel.officialIdentityAuthority ?? null : null);
  };
  return cited(candidate) === cited(pointed);
}
