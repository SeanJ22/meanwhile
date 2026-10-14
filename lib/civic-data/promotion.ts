import type { CandidateState, CandidateVersionRecord, PromotedProjection, RoutineCandidate, ValidationReceipt } from "./types.ts";
import { PostgresRoutineDataStore, PromotionBaseChangedError, routineEventObservedAt, type RoutineDataStore } from "./store.ts";
import { validateRoutineCandidate } from "./validate.ts";
import { canonicalCivicDataJson, candidateChangeSet } from "./changes.ts";
import { promotionProofIssue } from "./read-model.ts";
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
import type { RoutineReaderVerification } from "./reader-verification.ts";
import { officialStateRollIdentityAuthorityIssue } from "../state-rollcalls/promotion-authority.ts";
import { derivedInputAuthorityIssue } from "./derived-door.ts";
import { isScopedManualContractScope, manualPayloadScope } from "./scoped-manual-contracts.ts";

/** Only the exact registered contract doors in this module possess this token. */
const REGISTERED_PRODUCTION_DOOR = Symbol("REGISTERED_PRODUCTION_DOOR");

function trustedLkgPredecessorVersionId(candidate: RoutineCandidate): string | null {
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
    const encoded = JSON.stringify(candidate);
    if (encoded === undefined) throw new Error("candidate is not JSON-representable");
    return JSON.parse(encoded) as RoutineCandidate;
  } catch (error) {
    throw new Error(
      `ROUTINE_CANDIDATE_NOT_DURABLE_JSON:${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function failureOf(receipt: NonNullable<CandidateVersionRecord["receipt"]>): { code: string; detail: string } {
  const check = receipt.checks.find((item) => item.verdict !== "PASS");
  return { code: check?.code ?? "VALIDATION_REFUSED", detail: check?.detail ?? "Candidate did not satisfy the GOOD contract." };
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
  if (outcome.promoted === null || outcome.confirmed || contract.readerProjection === null) return outcome;
  const receipt = await recordRoutineReaderProjectionReadback(store, contract, outcome.promoted, requestedAt);
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
  options: { readonly confirmUnchanged?: boolean } = {},
): Promise<PromotionOutcome> {
  if (store instanceof PostgresRoutineDataStore) assertRegisteredRuntimeContract(contractId, "routine");
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
  const boundedCandidate = durableCandidateSnapshot(candidate);
  const contract = requiredRoutineContract(contractId);
  if (contract.fanOut !== true) throw new Error(`FANOUT_CONTRACT_NOT_DECLARED:${contractId}`);
  if (Object.prototype.hasOwnProperty.call(boundedCandidate, "bootstrapImport") && boundedCandidate.bootstrapImport !== undefined) {
    throw new Error("TRUSTED_LKG_ADMISSION_RETIRED");
  }
  const issue = routineCandidateFanOutContractIssue(contract, boundedCandidate);
  if (issue !== null) throw new Error(`FANOUT_CANDIDATE_CONTRACT_MISMATCH:${contractId}:${issue}`);
  const sourceProjectionVerification = await verifySourceScopedCandidateProjection(
    contract,
    boundedCandidate,
    sourceProjectionObservedAt(store, now),
    null,
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

function invalidLkgReceipt(receipt: ValidationReceipt, code: string, detail: string): ValidationReceipt {
  return {
    ...receipt,
    decision: "CANNOT_TELL",
    checks: receipt.checks.map((check) => check.check === "TEMPORAL_VALIDITY" ? {
      ...check,
      verdict: "CANNOT_TELL",
      code,
      detail,
    } : check),
  };
}

/** A newly held or released record is evidence the pointed version lacks, so such a re-check promotes. */
function sameHeldRecords(candidate: RoutineCandidate, pointed: RoutineCandidate): boolean {
  const keys = (value: RoutineCandidate) => [...new Set((value.excludedFacts ?? []).map((fact) => fact.key))].sort();
  const [left, right] = [keys(candidate), keys(pointed)];
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

/** Collector progress and second-hop finance records must survive an unchanged amount. */
function sameFinanceProgress(candidate: RoutineCandidate, pointed: RoutineCandidate): boolean {
  if (candidate.recordClass !== "FEC_FUNDING" && candidate.recordClass !== "STATE_CAMPAIGN_FINANCE") return true;
  const progress = (value: RoutineCandidate) => {
    const model = value.readModel as { refreshAttempts?: unknown; acquisitionCursors?: unknown; secondHop?: unknown };
    return canonicalCivicDataJson({ refreshAttempts: model.refreshAttempts ?? {},
      acquisitionCursors: model.acquisitionCursors ?? {}, secondHop: model.secondHop ?? [] });
  };
  return progress(candidate) === progress(pointed);
}

/** A re-check whose read model cites a moved outside authority (a roll call's roster version) promotes. */
export function sameCitedAuthority(candidate: RoutineCandidate, pointed: RoutineCandidate): boolean {
  const cited = (value: RoutineCandidate) => {
    const readModel = value.readModel as { readonly officialIdentityAuthority?: unknown } | null;
    return canonicalCivicDataJson(readModel && typeof readModel === "object" ? readModel.officialIdentityAuthority ?? null : null);
  };
  return cited(candidate) === cited(pointed);
}

function sameAcquisitionProgress(candidate: RoutineCandidate, pointed: RoutineCandidate): boolean {
  if (candidate.recordClass === "MEETING_OUTCOME") {
    const checks = (value: RoutineCandidate) => canonicalCivicDataJson((value.readModel as {
      sittings?: { meetingId: string; minutesDocument?: { readAt?: string } }[]
    }).sittings?.map(row => [row.meetingId, row.minutesDocument?.readAt ?? null]) ?? []);
    return checks(candidate) === checks(pointed);
  }
  if (!["FEC_FUNDING", "STATE_CAMPAIGN_FINANCE"].includes(candidate.recordClass)) return true;
  const progress = (value: RoutineCandidate) => {
    const payload = value.readModel as { refreshAttempts?: unknown; acquisitionCursors?: unknown };
    return canonicalCivicDataJson([payload.refreshAttempts ?? null, payload.acquisitionCursors ?? null]);
  };
  return progress(candidate) === progress(pointed);
}

export async function processRoutineCandidate(
  store: RoutineDataStore,
  inputCandidate: RoutineCandidate,
  now: string = new Date().toISOString(),
  expectedBaseVersionId: string | null | undefined = undefined,
  registeredDoor: symbol | null = null,
  sourceProjectionVerification: RoutineReaderVerification | null = null,
  options: { readonly confirmUnchanged?: boolean } = {},
): Promise<PromotionOutcome> {
  const productionStore = store instanceof PostgresRoutineDataStore;
  if (productionStore && registeredDoor !== REGISTERED_PRODUCTION_DOOR) {
    throw new Error("PRODUCTION_PROMOTION_REQUIRES_REGISTERED_CONTRACT_DOOR");
  }
  if (Object.prototype.hasOwnProperty.call(inputCandidate, "bootstrapImport") && inputCandidate.bootstrapImport !== undefined) {
    throw new Error("TRUSTED_LKG_ADMISSION_RETIRED");
  }
  const current = await store.readPromotion(inputCandidate.recordClass, inputCandidate.scope);
  const observedBaseVersionId = current?.versionId ?? null;
  const preloadedBaseChanged = expectedBaseVersionId !== undefined && expectedBaseVersionId !== observedBaseVersionId;
  const lkg = current ? await store.readCandidate(current.lastKnownGoodVersionId) : null;
  const lkgPredecessorVersionId = lkg === null
    ? null
    : trustedLkgPredecessorVersionId(lkg.candidate);
  const lkgTransferPredecessor = lkgPredecessorVersionId === null
    ? null
    : await store.readCandidate(lkgPredecessorVersionId);
  const declaredBase = preloadedBaseChanged && expectedBaseVersionId !== null && expectedBaseVersionId !== undefined
    ? await store.readCandidate(expectedBaseVersionId)
    : null;
  const exactDeclaredBase = declaredBase &&
      declaredBase.candidate.id === expectedBaseVersionId &&
      declaredBase.candidate.sourceId === inputCandidate.sourceId &&
      declaredBase.candidate.recordClass === inputCandidate.recordClass &&
      declaredBase.candidate.scope === inputCandidate.scope &&
      declaredBase.state === "PROMOTED" &&
      declaredBase.acquisitionSucceeded &&
      declaredBase.promotedVersion === expectedBaseVersionId &&
      declaredBase.lastKnownGoodVersion === expectedBaseVersionId
    ? declaredBase
    : null;
  const lkgProofIssue = current === null
    ? null
    : lkg === null
      ? "The canonical pointer's last-known-good candidate row is missing."
      : promotionProofIssue(
          inputCandidate.recordClass,
          inputCandidate.scope,
          current,
          lkg,
          lkgTransferPredecessor,
        );
  const candidate: RoutineCandidate = {
    ...inputCandidate,
    changeSet: candidateChangeSet(
      inputCandidate,
      preloadedBaseChanged ? exactDeclaredBase?.candidate.readModel ?? null : current?.payload ?? null,
    ),
  };
  const initialState: CandidateState = candidate.retrieval.succeeded ? "FETCHED" : "SOURCE_BLOCKED";
  const trustedPredecessorVersionId = trustedLkgPredecessorVersionId(candidate);
  const continuingExactLkg = trustedPredecessorVersionId !== null &&
    lkg?.candidate.id === trustedPredecessorVersionId;
    // Evaluate a trusted first-pointer candidate against the empty base it names; a pointer that appeared since is
    // recorded by the later CAS branch, not turned into an earlier validation failure.
  const validationLkg = preloadedBaseChanged
    ? exactDeclaredBase
    : continuingExactLkg || lkgProofIssue === null ? lkg : null;
    // Production observes this write's time and never trusts an adapter clock.
  const transitionAt = await routineEventObservedAt(store, candidate.recordClass, candidate.scope, now);
  const nativeRetirementCheck=candidate.sourceId === "plural-openstates" && candidate.recordClass === "STATE_LEGISLATOR" &&
    (candidate.changeSet?.removed.length ?? 0)>0 && !candidate.horizon.claimsComplete
    ? (await import("../sources/plural/retirement.ts")).statePeopleRetirementSourceCheck(candidate,validationLkg,transitionAt) : null;
  const validated = validateRoutineCandidate(
    candidate,
    validationLkg,
    transitionAt,
    [...(sourceProjectionVerification === null ? [] : [{
      consumer: `${sourceProjectionVerification.verifierId} (source-scoped pre-promotion)`,
      passed: sourceProjectionVerification.status === "PASS",
      detail: sourceProjectionVerification.detail,
    }]),...(nativeRetirementCheck ? [nativeRetirementCheck] : [])],
  );
    // A re-check whose read model is exactly the pointed one is a receipted no-change; any refusal falls through to
    // the ordinary candidate and promotion below.
  if (
    options.confirmUnchanged !== false &&
    typeof store.confirmUnchanged === "function" &&
    current !== null && lkg !== null && lkgProofIssue === null && !preloadedBaseChanged &&
    current.versionId === current.lastKnownGoodVersionId && lkg.candidate.id === current.versionId &&
    candidate.retrieval.succeeded && candidate.normalization.succeeded &&
    candidate.normalization.parserVersion === lkg.candidate.normalization.parserVersion &&
    validated.state === "VALIDATED" && validated.receipt.decision === "GOOD" &&
    candidate.changeSet?.outcome === "UNCHANGED" &&
    typeof lkg.candidate.normalization.normalizedHash === "string" &&
    sameHeldRecords(candidate, lkg.candidate) &&
    sameFinanceProgress(candidate, lkg.candidate) &&
    sameCitedAuthority(candidate, lkg.candidate) &&
    sameAcquisitionProgress(candidate, lkg.candidate)
  ) {
    const retained = (candidate as { readonly retainedSourceResponses?: readonly unknown[] }).retainedSourceResponses;
    const confirmed = await store.confirmUnchanged({
      sourceId: candidate.sourceId,
      recordClass: candidate.recordClass,
      scope: candidate.scope,
      parserVersion: candidate.normalization.parserVersion,
      pointerVersionId: current.versionId,
      readModelHash: lkg.candidate.normalization.normalizedHash,
      basis: candidate.normalization.normalizedHash === lkg.candidate.normalization.normalizedHash
        ? "READ_MODEL_RECOMPUTED"
        : "CHANGE_SET_UNCHANGED",
      retrieval: {
        requestedUrl: candidate.retrieval.requestedUrl,
        finalUrl: candidate.retrieval.httpStatus === null
          ? candidate.retrieval.finalUrl
          : candidate.retrieval.finalUrl ?? candidate.retrieval.requestedUrl,
        httpStatus: candidate.retrieval.httpStatus,
        rawHash: candidate.retrieval.rawHash ?? "",
        retrievedAt: candidate.retrieval.retrievedAt,
        ...(candidate.retrieval.sourceCheck ? { sourceCheck: candidate.retrieval.sourceCheck } : {}),
      },
      retainedSourceResponses: retained ?? null,
    }, transitionAt);
    if (confirmed.kind === "CONFIRMED") {
      return {
        candidate: lkg,
        promoted: current,
        readerReadback: null,
        confirmed: { versionId: confirmed.versionId, at: confirmed.at, recheck: candidate },
      };
    }
  }
  const acquisitionFailure = candidate.retrieval.succeeded ? null : failureOf(validated.receipt);
  await store.create({
    candidate,
    state: initialState,
    acquisitionSucceeded: candidate.retrieval.succeeded,
    receipt: candidate.retrieval.succeeded ? null : validated.receipt,
    promotedVersion: null,
    lastKnownGoodVersion: current?.lastKnownGoodVersionId ?? null,
    failureCode: acquisitionFailure?.code ?? null,
    failureDetail: acquisitionFailure?.detail ?? null,
  }, {
    candidateId: candidate.id,
    sequence: 1,
    state: initialState,
    at: transitionAt,
    detail: candidate.retrieval.succeeded ? `Acquired raw ${candidate.retrieval.rawHash}.` : (candidate.retrieval.failureDetail ?? "Source route blocked."),
  });

  if (!candidate.retrieval.succeeded) {
    return { candidate: (await store.readCandidate(candidate.id))!, promoted: null, readerReadback: null };
  }
  const held = { candidate };
  if (!candidate.normalization.succeeded || validated.receipt.checks.find((check) => check.check === "SCHEMA_PARSE_VALIDITY")?.verdict !== "PASS") {
    const failed = failureOf(validated.receipt);
        // Preserve an earlier authenticity failure as the terminal cause instead of relabeling it a parser defect.
    const terminal = validated.state === "VALIDATED" ? "PARSE_INVALID" : validated.state;
    const record = await store.transition(candidate.id, terminal, transitionAt, failed.detail, validated.receipt, failed, held);
    return { candidate: record, promoted: null, readerReadback: null };
  }

  await store.transition(candidate.id, "NORMALIZED", transitionAt, `Normalized ${candidate.normalization.outputRecords}/${candidate.normalization.inputRecords} records as ${candidate.normalization.normalizedHash}.`, undefined, undefined, held);
  if (validated.state !== "VALIDATED") {
    const failed = failureOf(validated.receipt);
    const record = await store.transition(candidate.id, validated.state, transitionAt, failed.detail, validated.receipt, failed, held);
    return { candidate: record, promoted: null, readerReadback: null };
  }
  if (preloadedBaseChanged) {
    const code = "PROMOTION_BASE_CHANGED";
    const detail =
      `Promotion refused because the source-scoped merge base moved from ${expectedBaseVersionId ?? "no pointer"} ` +
      `to ${observedBaseVersionId ?? "no pointer"} before this candidate entered validation. ` +
      "The current LKG remains live; a stale merge cannot overwrite facts from a newer authority.";
    const receipt = invalidLkgReceipt(validated.receipt, code, detail);
    const record = await store.transition(candidate.id, "CANNOT_TELL", transitionAt, detail, receipt, { code, detail }, held);
    return { candidate: record, promoted: null, readerReadback: null };
  }
  if (current !== null && lkgProofIssue !== null && !continuingExactLkg) {
    const code = lkg === null ? "LKG_CANDIDATE_MISSING" : "LKG_PROMOTION_PROOF_INVALID";
    const detail = `The existing canonical pointer is not a valid last-known-good proof (${lkgProofIssue}); promotion is held until the durable chain is repaired.`;
    const receipt = invalidLkgReceipt(validated.receipt, code, detail);
    const record = await store.transition(candidate.id, "CANNOT_TELL", transitionAt, detail, receipt, {
      code,
      detail,
    }, held);
    return { candidate: record, promoted: null, readerReadback: null };
  }
  const validatedRecord = await store.transition(candidate.id, "VALIDATED", transitionAt, "Every applicable GOOD check passed.", validated.receipt, undefined, held);
  let promoted: PromotedProjection;
  try {
    promoted = await store.promote(candidate.id, validated.receipt, transitionAt);
  } catch (error) {
    if (!(error instanceof PromotionBaseChangedError)) throw error;
    const code = "PROMOTION_BASE_CHANGED";
    const detail =
      `Promotion refused because the canonical pointer moved from ${error.expectedVersionId ?? "no pointer"} ` +
      `to ${error.actualVersionId ?? "no pointer"} after this candidate was validated. ` +
      "The current LKG remains live; this candidate did not overwrite an authority it was never checked against.";
    const receipt = invalidLkgReceipt(validated.receipt, code, detail);
    const record = await store.transition(candidate.id, "CANNOT_TELL", transitionAt, detail, receipt, { code, detail }, held);
    return { candidate: record, promoted: null, readerReadback: null };
  }
  const summary = await store.readCandidateSummary(candidate.id);
  if (summary === null) throw new Error(`CANDIDATE_NOT_FOUND:${candidate.id}`);
  const { candidate: _sameRow, ...promotedColumns } = summary;
  return { candidate: { ...promotedColumns, candidate: validatedRecord.candidate }, promoted, readerReadback: null };
}
