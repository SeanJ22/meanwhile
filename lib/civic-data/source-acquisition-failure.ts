/** @freshness-reads-here: attemptedAt dates the failed attempt and is never projected as source freshness. */
import { failedAcquisitionCandidate } from "./candidate-builders.ts";
import { requiredRoutineContract } from "./contracts.ts";
import { processRegisteredRoutineCandidate, type PromotionOutcome } from "./promotion.ts";
import { ZERO_RELEASE_EVENTS } from "./release.ts";
import { routineTaskFromContract } from "./runner.ts";
import type { RoutineRunnerReceipt } from "./runner-receipt.ts";
import type { RoutineDataStore } from "./store.ts";
import {
  isSourceAcquisitionFailure,
  type SourceAcquisitionFailure,
} from "./source-acquisition-error.ts";

export {
  isSourceAcquisitionFailure,
  readPublisherBody,
  requestPublisher,
  publisherDeadlineFailure,
  sourceAcquisitionFailure,
  SourceAcquisitionFailure,
  withPublisherAcquisitionDeadline,
} from "./source-acquisition-error.ts";
export type { SourceAcquisitionFailureCode } from "./source-acquisition-error.ts";

export interface RegisteredSourceFailureRecord {
  readonly outcome: PromotionOutcome;
  readonly receipt: RoutineRunnerReceipt;
  readonly line: string;
}

export async function recordRegisteredSourceAcquisitionFailure(input: {
  readonly store: RoutineDataStore;
  readonly contractId: string;
  readonly failure: SourceAcquisitionFailure;
  readonly attemptedAt?: string;
  /** Defaults to the registered SINGLE_ROUTE. Multi-route adapters must name the exact registered route. */
  readonly requestedUrl?: string;
}): Promise<RegisteredSourceFailureRecord> {
  if (!isSourceAcquisitionFailure(input.failure)) {
    throw new Error(`SOURCE_FAILURE_NOT_CLASSIFIED:${input.contractId}`);
  }
  const contract = requiredRoutineContract(input.contractId);
  const task = routineTaskFromContract(contract);
  const requestedUrl = input.requestedUrl ?? task.requestedUrl;
  if (requestedUrl === "") {
    throw new Error(`SOURCE_FAILURE_ROUTE_REQUIRED:${input.contractId}`);
  }
  const attemptedAt = input.attemptedAt ?? new Date().toISOString();
  const candidate = failedAcquisitionCandidate({
    sourceId: task.sourceId,
    recordClass: task.recordClass,
    scope: task.scope,
    requestedUrl,
    attemptedAt,
    failureDetail: `${input.failure.code}: ${input.failure.message}`,
    parserVersion: task.parserVersion,
  });
  const outcome = await processRegisteredRoutineCandidate(
    input.store,
    input.contractId,
    candidate,
    attemptedAt,
  );
  if (
    outcome.candidate.candidate.id !== candidate.id ||
    outcome.candidate.acquisitionSucceeded ||
    outcome.candidate.state !== "SOURCE_BLOCKED" ||
    outcome.promoted !== null
  ) {
    throw new Error(`SOURCE_FAILURE_DURABILITY_CONTRACT_BROKEN:${input.contractId}:${candidate.id}`);
  }
  const receipt: RoutineRunnerReceipt = {
    source: input.contractId,
    candidateId: candidate.id,
    acquisitionSucceeded: false,
    state: outcome.candidate.state,
    decision: outcome.candidate.receipt?.decision ?? null,
    promotedVersion: null,
    lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  return {
    outcome,
    receipt,
    line: `RCD_RECEIPT=${JSON.stringify(receipt)}`,
  };
}
