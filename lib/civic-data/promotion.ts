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

/**
 * Bound the contract check, typed preflight, validation, and pointer move to
 * one immutable-by-ownership JSON value. An adapter retaining references to
 * its input cannot swap both payload and digest between those async steps.
 */
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
  /**
   * Present when a validated re-check found nothing new and was confirmed on
   * the pointed version instead of promoted: `candidate` is then the pointed
   * record and `promoted` the unchanged pointer (see UnchangedConfirmation).
   */
  readonly confirmed?: {
    readonly versionId: string;
    readonly at: string;
    /** The validated re-check that found nothing new; never stored as a candidate. */
    readonly recheck: RoutineCandidate;
  };
}

async function appendTypedReaderProjectionReadback(
  store: RoutineDataStore,
  contract: RoutineSourceContract | ManualProductionSourceContract,
  outcome: PromotionOutcome,
  requestedAt: string,
): Promise<PromotionOutcome> {
  // A confirmation leaves the pointed version, and its readback, as they were.
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
    /* No route to authorize: the validator checks the named inputs, and the door checks them against the store. */
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

/** Standing adapters enter promotion only through their exact registered contract. */
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

/**
 * A fan-out contract owns a scope family, not a single scope: its own per-state
 * marker at the contract scope, plus one bounded per-member candidate at
 * `<sourceId>:<officeholderId>`. The runner still enumerates and clocks exactly
 * one contract per state; the family lives inside the child. Every member and
 * the marker still pass the identical GOOD contract, authority, and typed
 * per-contract verification below — only the one-scope equality is widened to
 * the declared family.
 */
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

/**
 * Promote one candidate of a state's per-legislator fan-out — its per-state
 * marker or one member — through the exact registered fan-out contract. Each
 * call is one bounded write; the caller promotes the marker and every changed
 * member, and re-promotes only members whose votes changed this cycle.
 */
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

/**
 * A meeting route/body enters the plane only through its SOURCE_WIRING-derived contract.
 *
 * Its Reader readback is not taken here. The Reader of a meeting partition is
 * the aggregate meetings Reader, which composes every partition, so a readback
 * per promotion moved all 84 partitions' payloads and candidate rows (~24 MB)
 * once per promoted partition. `repairMeetingReaderProjectionReadbacks`, the
 * meeting Reader domain of every routine pass, appends the same typed receipt
 * to each newly promoted partition from one aggregate read; the pass that
 * promotes a partition records its readback before it ends.
 */
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

/**
 * A partition's durable history enters only through its own partition's registered authority (DB-06): the partition's
 * child holds the contract, and the history contract is derived from it. Its candidate names the promoted partition
 * version the sittings were taken from, checked against the store like any derived input.
 */
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

/** A partition candidate that removes sittings into history is refused, by name, unless the history pointer holds them. */
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

/**
 * A DERIVED contract's candidate enters only with its named inputs checked against the store (C16): every promoted
 * version it names exists as hashed, and every member read is on a host its named wiring version attests. A failure
 * is a named failing dependent check, so the refusal is durable and the last known good stays live.
 */
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
  if (candidate.scope !== contract.scope) return `scope ${candidate.scope} does not equal ${contract.scope}`;
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

/** Owner-invoked sources enter the durable plane through their exact manual contract. */
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

/**
 * The only transition driver. A successful fetch is persisted even when a
 * later check refuses promotion; the existing pointer is never cleared.
 */
/**
 * A record newly held (the source stopped listing it) or newly released is
 * evidence the pointed version does not carry, so such a re-check promotes.
 */
function sameHeldRecords(candidate: RoutineCandidate, pointed: RoutineCandidate): boolean {
  const keys = (value: RoutineCandidate) => [...new Set((value.excludedFacts ?? []).map((fact) => fact.key))].sort();
  const [left, right] = [keys(candidate), keys(pointed)];
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

/**
 * The authority a read model cites outside its own records: a roll call's
 * member join names the exact roster version it was checked against
 * (`officialStateRollIdentityAuthorityIssue`), which its change set never
 * sees. A re-check that cites a moved authority promotes, so a pointed version
 * never keeps naming a superseded one.
 */
export function sameCitedAuthority(candidate: RoutineCandidate, pointed: RoutineCandidate): boolean {
  const cited = (value: RoutineCandidate) => {
    const readModel = value.readModel as { readonly officialIdentityAuthority?: unknown } | null;
    return canonicalCivicDataJson(readModel && typeof readModel === "object" ? readModel.officialIdentityAuthority ?? null : null);
  };
  return cited(candidate) === cited(pointed);
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
  // A trusted first-pointer candidate is evaluated against the empty base it
  // actually names. If a pointer appeared after its scan, the later CAS branch
  // records that race; feeding the new pointer into validation would instead
  // manufacture an earlier TRUSTED_LKG_IMPORT_REQUIRES_EMPTY_POINTER failure
  // and make the durable receipt disagree with the real disposition.
  const validationLkg = preloadedBaseChanged
    ? exactDeclaredBase
    : continuingExactLkg || lkgProofIssue === null ? lkg : null;
  // A prior publication/readback in this pass may be later than its start.
  // Production observes this write's time and never trusts an adapter clock.
  const transitionAt = await routineEventObservedAt(store, candidate.recordClass, candidate.scope, now);
  const validated = validateRoutineCandidate(
    candidate,
    validationLkg,
    transitionAt,
    sourceProjectionVerification === null ? [] : [{
      consumer: `${sourceProjectionVerification.verifierId} (source-scoped pre-promotion)`,
      passed: sourceProjectionVerification.status === "PASS",
      detail: sourceProjectionVerification.detail,
    }],
  );
  // A validated re-check whose read model is exactly the pointed one is a
  // durably receipted no-change (RULING 283): readers keep their version and
  // nothing is recomposed, read back or republished. Any refusal (the pointer
  // moved, an import is pointed, the hash differs, the evidence is malformed)
  // falls through to the ordinary candidate and promotion below.
  if (
    options.confirmUnchanged !== false &&
    typeof store.confirmUnchanged === "function" &&
    current !== null && lkg !== null && lkgProofIssue === null && !preloadedBaseChanged &&
    current.versionId === current.lastKnownGoodVersionId && lkg.candidate.id === current.versionId &&
    candidate.retrieval.succeeded && candidate.normalization.succeeded &&
    validated.state === "VALIDATED" && validated.receipt.decision === "GOOD" &&
    candidate.changeSet?.outcome === "UNCHANGED" &&
    typeof lkg.candidate.normalization.normalizedHash === "string" &&
    sameHeldRecords(candidate, lkg.candidate) &&
    sameCitedAuthority(candidate, lkg.candidate)
  ) {
    const retained = (candidate as { readonly retainedSourceResponses?: readonly unknown[] }).retainedSourceResponses;
    const confirmed = await store.confirmUnchanged({
      sourceId: candidate.sourceId,
      recordClass: candidate.recordClass,
      scope: candidate.scope,
      parserVersion: candidate.normalization.parserVersion,
      pointerVersionId: current.versionId,
      // The pointed version's read model is the one this re-check confirms.
      readModelHash: lkg.candidate.normalization.normalizedHash,
      basis: candidate.normalization.normalizedHash === lkg.candidate.normalization.normalizedHash
        ? "READ_MODEL_RECOMPUTED"
        : "CHANGE_SET_UNCHANGED",
      // A derived version fetched nothing: its status and final URL stay null
      // and the receipt's shape rule admits that only for its own derived route.
      retrieval: {
        requestedUrl: candidate.retrieval.requestedUrl,
        finalUrl: candidate.retrieval.httpStatus === null
          ? candidate.retrieval.finalUrl
          : candidate.retrieval.finalUrl ?? candidate.retrieval.requestedUrl,
        httpStatus: candidate.retrieval.httpStatus,
        rawHash: candidate.retrieval.rawHash ?? "",
        retrievedAt: candidate.retrieval.retrievedAt,
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
  // The envelope this run created is the durable one: each transition verifies
  // it against the row's hash columns and returns it, so no step reads the
  // dataset back (R26).
  const held = { candidate };
  if (!candidate.normalization.succeeded || validated.receipt.checks.find((check) => check.check === "SCHEMA_PARSE_VALIDITY")?.verdict !== "PASS") {
    const failed = failureOf(validated.receipt);
    // The receipt is ordered by the GOOD contract. If authenticity failed
    // before parsing (for example an unregistered redirect returned HTML), the
    // terminal state must preserve that earlier cause instead of relabeling it
    // as a parser defect merely because the payload also failed to normalize.
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
  // The promoted row's columns, read after the move; its envelope is the
  // durable one the VALIDATED transition returned (written once at create,
  // never updated), so the dataset is not read back a further time.
  const summary = await store.readCandidateSummary(candidate.id);
  if (summary === null) throw new Error(`CANDIDATE_NOT_FOUND:${candidate.id}`);
  const { candidate: _sameRow, ...promotedColumns } = summary;
  return { candidate: { ...promotedColumns, candidate: validatedRecord.candidate }, promoted, readerReadback: null };
}
