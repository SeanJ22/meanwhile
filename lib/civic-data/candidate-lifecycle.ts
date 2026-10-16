import { statePublicationPriorOf } from "./state-publication.ts";
import type { CandidateState, CandidateVersionRecord, PromotedProjection, RoutineCandidate, ValidationReceipt } from "./types.ts";
import { PostgresRoutineDataStore, PromotionBaseChangedError, routineEventObservedAt, type RoutineDataStore } from "./store.ts";
import { validateRoutineCandidate } from "./validate.ts";
import { canonicalCivicDataJson, candidateChangeSet } from "./changes.ts";
import { promotionProofIssue } from "./read-model.ts";
import { isRegisteredCandidateDoor, sameCitedAuthority, trustedLkgPredecessorVersionId, type PromotionOutcome } from "./promotion.ts";
import type { RoutineReaderVerification } from "./reader-verification.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { statePublicationScope } from "./state-publication.ts";


function failureOf(receipt: NonNullable<CandidateVersionRecord["receipt"]>): { code: string; detail: string } {
  const check = receipt.checks.find((item) => item.verdict !== "PASS");
  return { code: check?.code ?? "VALIDATION_REFUSED", detail: check?.detail ?? "Candidate did not satisfy the GOOD contract." };
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
  options: { readonly confirmUnchanged?: boolean; readonly vault?: EvidenceStore } = {},
): Promise<PromotionOutcome> {
  const productionStore = store instanceof PostgresRoutineDataStore;
  if (productionStore && !isRegisteredCandidateDoor(registeredDoor)) {
    throw new Error("PRODUCTION_PROMOTION_REQUIRES_REGISTERED_CONTRACT_DOOR");
  }
  if (Object.prototype.hasOwnProperty.call(inputCandidate, "bootstrapImport") && inputCandidate.bootstrapImport !== undefined) {
    throw new Error("TRUSTED_LKG_ADMISSION_RETIRED");
  }
  const scoped = statePublicationScope(inputCandidate.scope);
  let base = scoped && store.readStatePublicationBase ? await store.readStatePublicationBase(inputCandidate.recordClass, inputCandidate.scope) : null;
  let current = base ? base.current : await store.readPromotion(inputCandidate.recordClass, inputCandidate.scope);
  let lkg = base ? base.lkg : current ? await store.readCandidate(current.lastKnownGoodVersionId) : null;
  let indexedPrior = lkg ? statePublicationPriorOf(lkg.candidate) : undefined;
  const observedBaseVersionId = current?.versionId ?? null;
  const preloadedBaseChanged = expectedBaseVersionId !== undefined && expectedBaseVersionId !== observedBaseVersionId;
  const lkgPredecessorVersionId = lkg === null
    ? null
    : trustedLkgPredecessorVersionId(lkg.candidate);
  let lkgTransferPredecessor = lkgPredecessorVersionId === null
    ? null
    : await store.readCandidate(lkgPredecessorVersionId);
  let declaredBase = !scoped && preloadedBaseChanged && expectedBaseVersionId !== null && expectedBaseVersionId !== undefined
    ? await store.readCandidate(expectedBaseVersionId)
    : null;
  let exactDeclaredBase = declaredBase &&
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
    // A receiptless curated base contributes no verified records to the change set.
    changeSet: candidateChangeSet(
      inputCandidate,
      inputCandidate.recordClass === "CURATED_READER_RECORD" && inputCandidate.retrieval.manualSourceReceipt &&
        !(preloadedBaseChanged ? exactDeclaredBase : lkg)?.candidate.retrieval.manualSourceReceipt
        ? null
        : preloadedBaseChanged ? exactDeclaredBase?.candidate.readModel ?? null : current?.payload ?? null,
      undefined, preloadedBaseChanged ? undefined : indexedPrior,
    ),
  };
  const initialState: CandidateState = candidate.retrieval.succeeded ? "FETCHED" : "SOURCE_BLOCKED";
  const trustedPredecessorVersionId = trustedLkgPredecessorVersionId(candidate);
  const continuingExactLkg = trustedPredecessorVersionId !== null &&
    lkg?.candidate.id === trustedPredecessorVersionId;
    // Evaluate a trusted first-pointer candidate against the empty base it names; a pointer that appeared since is
    // recorded by the later CAS branch, not turned into an earlier validation failure.
  let validationLkg = preloadedBaseChanged
    ? exactDeclaredBase
    : continuingExactLkg || lkgProofIssue === null ? lkg : null;
    // Production observes this write's time and never trusts an adapter clock.
  const transitionAt = await routineEventObservedAt(store, candidate.recordClass, candidate.scope, now);
  const nativeRetirementCheck=candidate.sourceId === "plural-openstates" && candidate.recordClass === "STATE_LEGISLATOR" &&
    (candidate.changeSet?.removed.length ?? 0)>0 && !candidate.horizon.claimsComplete
    ? await (await import("../sources/plural/retirement.ts")).statePeopleRetirementSourceCheck(candidate,validationLkg,transitionAt,options.vault) : null;
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
    sameCitedAuthority(candidate, indexedPrior ? { ...lkg.candidate, readModel: { officialIdentityAuthority: indexedPrior.officialIdentityAuthority } } : lkg.candidate) &&
    sameAcquisitionProgress(candidate, lkg.candidate)
  ) {
    if (scoped) {
      const latest = await store.readPromotionIdentity(candidate.recordClass, candidate.scope);
      if (latest?.versionId === current.versionId && latest.lastKnownGoodVersionId === current.versionId) {
        return { candidate: lkg, promoted: current, readerReadback: null,
          confirmed: { versionId: current.versionId, at: current.promotedAt, recheck: candidate } };
      }
    }
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
  const missingLkg = lkg === null;
  const lastKnownGoodVersionId = current?.lastKnownGoodVersionId ?? null;
  if (scoped) {
    indexedPrior = undefined;
    base = null;
    lkg = null;
    lkgTransferPredecessor = null;
    declaredBase = null;
    exactDeclaredBase = null;
    validationLkg = null;
    current = null;
  }
  // A re-read refused for the same reason with the same extracted values as the newest candidate writes no new one.
  const refusal = candidate.retrieval.succeeded && validated.state !== "VALIDATED" ? failureOf(validated.receipt) : null;
  const latest = refusal ? await store.latestCandidate(candidate.sourceId, candidate.recordClass, candidate.scope) : null;
  if (refusal && latest && latest.id !== observedBaseVersionId && latest.failureCode === refusal.code &&
    latest.normalizedHash === candidate.normalization.normalizedHash && latest.parserVersion === candidate.normalization.parserVersion) {
    await store.recordRecheck(latest.id, transitionAt, `RECHECKED_UNCHANGED: read ${candidate.retrieval.retrievedAt} (${candidate.id}); the same values meet the same refusal, ${refusal.code}.`);
    return { candidate: (await store.readCandidate(latest.id))!, promoted: null, readerReadback: null };
  }
  const acquisitionFailure = candidate.retrieval.succeeded ? null : failureOf(validated.receipt);
  await store.create({
    candidate,
    state: initialState,
    acquisitionSucceeded: candidate.retrieval.succeeded,
    receipt: candidate.retrieval.succeeded ? null : validated.receipt,
    promotedVersion: null,
    lastKnownGoodVersion: lastKnownGoodVersionId,
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
  if (observedBaseVersionId !== null && lkgProofIssue !== null && !continuingExactLkg) {
    const code = missingLkg ? "LKG_CANDIDATE_MISSING" : "LKG_PROMOTION_PROOF_INVALID";
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
    promoted = await store.promote(candidate.id, validated.receipt, transitionAt, scoped ? held : undefined);
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
