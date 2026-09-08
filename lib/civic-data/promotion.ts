import type { CandidateState, CandidateVersionRecord, PromotedProjection, RoutineCandidate } from "./types.ts";
import type { RoutineDataStore } from "./store.ts";
import { validateRoutineCandidate } from "./validate.ts";

function failureOf(receipt: NonNullable<CandidateVersionRecord["receipt"]>): { code: string; detail: string } {
  const check = receipt.checks.find((item) => item.verdict !== "PASS");
  return { code: check?.code ?? "VALIDATION_REFUSED", detail: check?.detail ?? "Candidate did not satisfy the GOOD contract." };
}

export interface PromotionOutcome {
  readonly candidate: CandidateVersionRecord;
  readonly promoted: PromotedProjection | null;
}

/**
 * The only transition driver. A successful fetch is persisted even when a
 * later check refuses promotion; the existing pointer is never cleared.
 */
export async function processRoutineCandidate(
  store: RoutineDataStore,
  candidate: RoutineCandidate,
  now: string = new Date().toISOString(),
): Promise<PromotionOutcome> {
  const current = await store.readPromotion(candidate.recordClass, candidate.scope);
  const lkg = current ? await store.readCandidate(current.lastKnownGoodVersionId) : null;
  const initialState: CandidateState = candidate.retrieval.succeeded ? "FETCHED" : "SOURCE_BLOCKED";
  const validated = validateRoutineCandidate(candidate, lkg, now);
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
    at: now,
    detail: candidate.retrieval.succeeded ? `Acquired raw ${candidate.retrieval.rawHash}.` : (candidate.retrieval.failureDetail ?? "Source route blocked."),
  });

  if (!candidate.retrieval.succeeded) {
    return { candidate: (await store.readCandidate(candidate.id))!, promoted: null };
  }
  if (!candidate.normalization.succeeded || validated.receipt.checks.find((check) => check.check === "SCHEMA_PARSE_VALIDITY")?.verdict !== "PASS") {
    const failed = failureOf(validated.receipt);
    // The receipt is ordered by the GOOD contract. If authenticity failed
    // before parsing (for example an unregistered redirect returned HTML), the
    // terminal state must preserve that earlier cause instead of relabeling it
    // as a parser defect merely because the payload also failed to normalize.
    const terminal = validated.state === "VALIDATED" ? "PARSE_INVALID" : validated.state;
    const record = await store.transition(candidate.id, terminal, now, failed.detail, validated.receipt, failed);
    return { candidate: record, promoted: null };
  }

  await store.transition(candidate.id, "NORMALIZED", now, `Normalized ${candidate.normalization.outputRecords}/${candidate.normalization.inputRecords} records as ${candidate.normalization.normalizedHash}.`);
  if (validated.state !== "VALIDATED") {
    const failed = failureOf(validated.receipt);
    const record = await store.transition(candidate.id, validated.state, now, failed.detail, validated.receipt, failed);
    return { candidate: record, promoted: null };
  }
  await store.transition(candidate.id, "VALIDATED", now, "Every applicable GOOD check passed.", validated.receipt);
  const promoted = await store.promote(candidate.id, validated.receipt, now);
  return { candidate: (await store.readCandidate(candidate.id))!, promoted };
}
