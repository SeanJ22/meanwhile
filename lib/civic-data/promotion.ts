import { rememberStatePublicationHashes, withStateRecordHashes } from "./state-publication.ts";
import { processRoutineCandidate } from "./candidate-lifecycle.ts";
import type { CandidateVersionRecord, PromotedProjection, RoutineCandidate } from "./types.ts";
import { PostgresRoutineDataStore, routineEventObservedAt, type RoutineDataStore } from "./store.ts";
import { canonicalCivicDataJson, heldCivicRecords } from "./changes.ts";
import { validateRoutineCandidate } from "./validate.ts";
import type { NavigationComparison } from "./navigation-successor.ts";
import { requiredRoutineContract, type RoutineSourceContract } from "./contracts.ts";
import { meetingHistoryContract, requiredMeetingPartitionContract } from "./meeting-partitions.ts";
import { movedToHistoryAuthorityIssue } from "./meeting-history.ts";
import { routineTaskFromContract } from "./runner.ts";
import { authorityFor, authorityForManualReceipt } from "./source-authority.ts";
import {
  manualProductionContract,
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
import { immutableStateCandidate, largePayloadScope, statePublicationScope, withStatePublicationRead } from "./state-publication.ts";

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

/** One frozen JSON value, so an adapter holding references cannot swap payload and digest between async steps. */
function durableCandidateSnapshot(candidate: RoutineCandidate): RoutineCandidate {
  try {
    if (statePublicationScope(candidate.scope)) return withStateRecordHashes(immutableStateCandidate(candidate));
    if (largePayloadScope(candidate.scope)) return immutableStateCandidate(candidate);
    const encoded = JSON.stringify(candidate);
    if (encoded === undefined) throw new Error("candidate is not JSON-representable");
    return JSON.parse(encoded) as RoutineCandidate;
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
  if (candidate.stateRetirement) throw new Error("STATE_RETIREMENT_REQUIRES_TERMINAL_DOOR");
  let boundedCandidate = durableCandidateSnapshot(candidate);
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
  if (candidate.stateRetirement) throw new Error("STATE_RETIREMENT_REQUIRES_TERMINAL_DOOR");
  const boundedCandidate = durableCandidateSnapshot(candidate);
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
  if (candidate.stateRetirement) throw new Error("STATE_RETIREMENT_REQUIRES_TERMINAL_DOOR");
  const boundedCandidate = durableCandidateSnapshot(candidate);
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
  if (candidate.stateRetirement) throw new Error("STATE_RETIREMENT_REQUIRES_TERMINAL_DOOR");
  const boundedCandidate = durableCandidateSnapshot(candidate);
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
  if (candidate.retrieval.succeeded && isScopedManualContractScope(contractId, candidate.scope)) {
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
  if (candidate.stateRetirement) throw new Error("STATE_RETIREMENT_REQUIRES_TERMINAL_DOOR");
  const boundedCandidate = durableCandidateSnapshot(candidate);
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

export async function processNavigationCandidate(
  store: RoutineDataStore,
  candidate: RoutineCandidate,
  comparison: NavigationComparison,
  now: string,
): Promise<{ readonly candidateId: string; readonly promotedVersionId: string }> {
  if (store instanceof PostgresRoutineDataStore) assertRegisteredRuntimeContract("ballot-navigation", "manual");
  const bounded = durableCandidateSnapshot(candidate);
  const contract = requiredManualProductionContract("ballot-navigation");
  const issue = manualCandidateContractIssue("ballot-navigation", bounded);
  if (issue !== null) throw new Error(`MANUAL_CANDIDATE_CONTRACT_MISMATCH:ballot-navigation:${issue}`);
  const changeSet = { ...comparison.changes, held: heldCivicRecords(bounded) };
  const verification = await verifySourceScopedCandidateProjection(contract, { ...bounded, changeSet }, sourceProjectionObservedAt(store, now), null);
  const base = comparison.base;
  const at = await routineEventObservedAt(store, bounded.recordClass, bounded.scope, now);
  if (comparison.kind === "MATCHED_REVIEW" && base && store.confirmUnchanged) {
    const checked = { ...bounded, changeSet };
    const validated = validateRoutineCandidate(checked, base.record, at, [{ consumer: `${verification.verifierId} (source-scoped pre-promotion)`,
      passed: verification.status === "PASS", detail: verification.detail }]);
    if (validated.receipt.decision !== "GOOD") {
      const failed = validated.receipt.checks.find(check => check.verdict !== "PASS");
      throw new Error(`ELECTION_FIELD_PUBLICATION_HELD:${failed?.detail ?? "Candidate did not satisfy the GOOD contract."}`);
    }
    const confirmed = await store.confirmUnchanged({ sourceId: bounded.sourceId, recordClass: bounded.recordClass, scope: bounded.scope,
      parserVersion: bounded.normalization.parserVersion, pointerVersionId: base.pointer.versionId,
      readModelHash: base.record.candidate.normalization.normalizedHash!, basis: "CHANGE_SET_UNCHANGED",
      retrieval: { requestedUrl: bounded.retrieval.requestedUrl, finalUrl: bounded.retrieval.finalUrl,
        httpStatus: bounded.retrieval.httpStatus, rawHash: bounded.retrieval.rawHash!, retrievedAt: bounded.retrieval.retrievedAt } }, at);
    if (confirmed.kind !== "CONFIRMED") throw new Error(`ELECTION_FIELD_CONFIRMATION_REFUSED:${confirmed.kind}:${confirmed.detail}`);
    return { candidateId: confirmed.versionId, promotedVersionId: confirmed.versionId };
  }
  const outcome = await appendTypedReaderProjectionReadback(store, contract,
    await processRoutineCandidate(store, bounded, now, base?.pointer.versionId ?? null, REGISTERED_PRODUCTION_DOOR,
      verification, { confirmUnchanged: false }, comparison), now);
  if (!outcome.promoted) throw new Error(`ELECTION_FIELD_PUBLICATION_HELD:${outcome.candidate.failureDetail ?? outcome.candidate.state}`);
  return { candidateId: outcome.candidate.candidate.id, promotedVersionId: outcome.promoted.versionId };
}

export async function processRegisteredStateRetirementCandidate(
  store: RoutineDataStore,
  contractId: string,
  candidate: RoutineCandidate,
  now: string,
  expectedBaseVersionId: string | null,
): Promise<PromotionOutcome> {
  const routine = contractId.startsWith("candidate-campaign-sites-derived:");
  if (store instanceof PostgresRoutineDataStore) assertRegisteredRuntimeContract(contractId, routine ? "routine" : "manual");
  const { stateRetirementCandidateIssue } = await import("./state-retirement-merge.ts");
  const issue = stateRetirementCandidateIssue(candidate, expectedBaseVersionId);
  if (issue) throw new Error(`STATE_RETIREMENT_AUTHORITY_INVALID:${issue}`);
  const bounded = durableCandidateSnapshot(candidate), evidence = bounded.stateRetirement!;
  const contract = routine ? requiredRoutineContract(contractId) : manualProductionContract(contractId);
  if (!contract) throw new Error("STATE_RETIREMENT_CONTRACT_MISMATCH");
  if (evidence.contractId !== contractId || evidence.priorVersionId !== expectedBaseVersionId ||
      bounded.scope !== contract.scope || bounded.recordClass !== contract.recordClass || bounded.sourceId !== contract.sourceId ||
      bounded.normalization.parserVersion !== contract.parserNormalizerVersion)
    throw new Error("STATE_RETIREMENT_CONTRACT_MISMATCH");
  const origins: Record<string, readonly string[]> = {
    "ballot-contests": ["BALLOT_CANDIDACY:US:state-election-ballots", "BALLOT_CANDIDACY:US-AZ:2026-general:supported-ballot",
      "BALLOT_CANDIDACY:US-NH:merrimack:2026-general", "BALLOT_FILING:US-NJ:county:morris:2026-general"],
    "candidate-profiles": ["CANDIDATE_PROFILE:US-AZ+US-NH+US-NJ:2026-supported-candidates"],
    "candidate-corpus": ["CANDIDATE_PUBLICATION:US-AZ+US-NH+US-NJ:2026-supported-candidates"],
    "voting-sites": ["VOTING_SITE:US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions"],
    "candidate-campaign-sites-derived": ["CURATED_READER_RECORD:US:candidate-campaign-sites-derived"],
    "registry-runtime": ["REGISTRY_RUNTIME_BINDING:US:reader-registry-runtime-bindings"],
  };
  const family = contractId.split(":")[0];
  if (!origins[family]?.includes(`${evidence.origin.recordClass}:${evidence.origin.scope}`) ||
      contractId.split(":")[1] !== evidence.state || !store.readStateRetirementOrigin)
    throw new Error("STATE_RETIREMENT_ORIGIN_SCOPE_INVALID");
  const original = await store.readStateRetirementOrigin(evidence.origin.recordClass, evidence.origin.scope);
  if (!original || !original.promoted || original.versionId !== evidence.origin.versionId || original.lastKnownGoodVersionId !== original.versionId ||
      original.recordClass !== evidence.origin.recordClass || original.scope !== evidence.origin.scope ||
      original.normalizedHash !== evidence.origin.readModelHash || original.sourceAuthenticity !== evidence.origin.sourceAuthenticity)
    throw new Error("STATE_RETIREMENT_ORIGIN_CHANGED");
  const current = await store.readPromotionIdentity(contract.recordClass, contract.scope);
  if ((current?.versionId ?? null) !== expectedBaseVersionId || current &&
      (current.lastKnownGoodVersionId !== expectedBaseVersionId || current.sourceId !== contract.sourceId))
    throw new Error("STATE_RETIREMENT_CURRENT_CHANGED");
  const verification = await verifySourceScopedCandidateProjection(contract, bounded, sourceProjectionObservedAt(store, now), null);
  const outcome = await processRoutineCandidate(store, bounded, now, expectedBaseVersionId, REGISTERED_PRODUCTION_DOOR, verification,
    { retirementAuthority: evidence });
  return appendTypedReaderProjectionReadback(store, contract, outcome, now);
}

/** A re-check whose read model cites a moved outside authority (a roll call's roster version) promotes. */
export function sameCitedAuthority(candidate: RoutineCandidate, pointed: RoutineCandidate): boolean {
  const cited = (value: RoutineCandidate) => {
    const readModel = value.readModel as { readonly officialIdentityAuthority?: unknown } | null;
    return canonicalCivicDataJson(readModel && typeof readModel === "object" ? readModel.officialIdentityAuthority ?? null : null);
  };
  return cited(candidate) === cited(pointed);
}
