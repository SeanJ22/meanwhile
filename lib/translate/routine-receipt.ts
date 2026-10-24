import type { BallotSet } from "../ballot/types.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { isCheckedMeasureTranslation } from "./provider.ts";
import { translationScope } from "./records.ts";
import { failedAcquisitionCandidate } from "../civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../civic-data/promotion.ts";
import { ZERO_RELEASE_EVENTS } from "../civic-data/release.ts";
import { durableRoutineRunnerReceiptIssue, routineReceiptFields, type RoutineRunnerReceipt } from "../civic-data/runner-receipt.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { readTranslationProjection } from "./projection-reader.ts";
import { measureTranslationRoutineTask } from "./routine-contract.ts";

/** The normal source outcome the independent routine supervisor can read back. */
export async function measureTranslationRoutineReceipt(input: {
  readonly store: RoutineDataStore;
  readonly state: string;
  readonly now: string;
  readonly ballots: readonly BallotSet[];
  /** Any open sentence, source, paid gate or retry prevents a successful state outcome. */
  readonly holdReason: string | null;
}) {
  const task = measureTranslationRoutineTask(input.state);
  let holdReason = input.holdReason;
  let receipt: RoutineRunnerReceipt | null = null;
  const divisions = [...new Set(input.ballots.flatMap(ballot => ballot.contests.filter(row => row.type === "MEASURE").map(row => row.ocdId)))];
  if (holdReason === null && (!divisions.length || divisions.some(division => jurisdictionFromOcdId(division)?.usps !== input.state.toUpperCase()))) {
    holdReason = "No checked measure scope is held for this state's translation clock.";
  }
  for (const division of divisions) {
    if (holdReason !== null) break;
    const scope = translationScope(division);
    const read = await readTranslationProjection({ scope, store: input.store, now: input.now, bypassCache: true });
    if (read.kind !== "PROMOTED") holdReason = "No checked explainer is held for a measure scope on this translation clock.";
    else if (input.ballots.some(ballot => ballot.contests.some(contest => contest.type === "MEASURE" && contest.ocdId === division &&
      !isCheckedMeasureTranslation(ballot, { subjectId: contest.id, division }, read.value.records)))) {
      holdReason = "A measure still has no checked explainer on its ballot card.";
    } else {
      const current = await input.store.readCandidate(read.projection.versionId);
      const candidate = current?.candidate;
      if (!candidate?.normalization.normalizedHash || !candidate.retrieval.succeeded ||
          !candidate.retrieval.rawHash || !input.store.confirmUnchanged) {
        holdReason = "The existing checked explainer cannot record its standing source check.";
      } else {
        // Recompute from held, checked records. Preserve the original source's
        // retrieval date; observing held bytes today is not a new publisher fetch.
        const confirmed = await input.store.confirmUnchanged({
          sourceId: task.sourceId, recordClass: task.recordClass, scope,
          parserVersion: task.parserVersion, pointerVersionId: candidate.id,
          readModelHash: candidate.normalization.normalizedHash, basis: "READ_MODEL_RECOMPUTED",
          retrieval: {
            requestedUrl: candidate.retrieval.requestedUrl, finalUrl: candidate.retrieval.finalUrl,
            httpStatus: candidate.retrieval.httpStatus, rawHash: candidate.retrieval.rawHash,
            retrievedAt: candidate.retrieval.retrievedAt,
            ...(candidate.retrieval.sourceCheck ? { sourceCheck: candidate.retrieval.sourceCheck } : {}),
          },
        }, input.now);
        if (confirmed.kind !== "CONFIRMED") holdReason = confirmed.detail;
        else receipt = {
          source: task.id, candidateId: candidate.id, acquisitionSucceeded: true, state: "PROMOTED", decision: "GOOD",
          promotedVersion: candidate.id, lastKnownGoodVersion: candidate.id, confirmedAt: confirmed.at,
          structuralReleaseContract: ZERO_RELEASE_EVENTS,
        };
      }
    }
  }
  if (holdReason !== null || receipt === null) {
    const candidate = failedAcquisitionCandidate({
      sourceId: task.sourceId, recordClass: task.recordClass, scope: task.scope, requestedUrl: "",
      attemptedAt: input.now, parserVersion: task.parserVersion,
      failureDetail: holdReason ?? "The measure explainer remains open.",
    });
    // A failed normalization carries only its real scheduled jurisdiction for
    // manual-contract scope validation. It contains no proposed reader fact.
    const payload = { kind: "plain-english-translations", records: [{ ocdId: task.scope.slice("US:plain-english-translations:".length) }] };
    const held = { ...candidate, readModel: payload, normalizedPayload: payload,
      normalization: { ...candidate.normalization, failureDetail: "No complete checked translation reached publication." },
      semantics: { factKind: "measure translation attempt", violations: [] },
    };
    const outcome = await processRegisteredManualCandidate(input.store, "plain-english-translations", held, input.now);
    receipt = { source: task.id, ...routineReceiptFields(held, outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS };
  }
  const issue = await durableRoutineRunnerReceiptIssue(receipt, task, input.store, holdReason === null ? "SUCCESS" : "HELD");
  if (issue) throw new Error(`The standing translation receipt could not be read back: ${issue}`);
  return { receipt, line: `RCD_RECEIPT=${JSON.stringify(receipt)}`, holdReason, exitCode: holdReason === null ? 0 : 2 };
}
