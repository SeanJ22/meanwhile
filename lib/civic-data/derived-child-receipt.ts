/**
 * A derived routine child's one promotion and its receipt line, shared by the
 * children that opt into the unchanged confirmation (R23): the meeting-source
 * wiring and the verified candidate campaign sites. Through the registered
 * routine door; a re-check whose read model is the pointed one is receipted
 * on that version instead of re-promoted, and the receipt then names it; a
 * pass that promotes nothing exits non-zero so the runner records it.
 */
import { processRegisteredRoutineCandidate, type PromotionOutcome } from "./promotion.ts";
import { ZERO_RELEASE_EVENTS } from "./release.ts";
import { routineReceiptFields } from "./runner-receipt.ts";
import type { RoutineDataStore } from "./store.ts";
import type { RoutineCandidate } from "./types.ts";

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
