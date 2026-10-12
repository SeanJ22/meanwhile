import { processRegisteredRoutineCandidate, type PromotionOutcome } from "./promotion.ts";
import { ZERO_RELEASE_EVENTS } from "./release.ts";
import { routineReceiptFields } from "./runner-receipt.ts";
import type { RoutineDataStore } from "./store.ts";
import type { RoutineCandidate } from "./types.ts";

/** Promotes through the registered routine door. A re-check whose read model is already pointed is receipted on that version instead of re-promoted; a pass that promotes nothing exits non-zero. */
export async function promoteDerivedCandidate(
  store: RoutineDataStore,
  contractId: string,
  candidate: RoutineCandidate,
  now: string,
): Promise<PromotionOutcome> {
  const outcome = await processRegisteredRoutineCandidate(store, contractId, candidate, now, undefined, { confirmUnchanged: true });
  console.log("RCD_RECEIPT=" + JSON.stringify({
    source: contractId,
    ...routineReceiptFields(candidate, outcome),
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  }));
  if (!outcome.promoted) process.exitCode = 2;
  return outcome;
}
