/**
 * Every address a meeting pass freshly matches to one exact Census street point is promoted into the
 * `venue-resolutions` pointer with the receipts that proved it. A refused promotion holds only this pointer.
 */
import type { ManualProjectionPackage } from "../civic-data/manual-projections.ts";
import { prepareManualProjectionSuccessor } from "../civic-data/manual-successor.ts";
import { processRegisteredManualCandidate, type PromotionOutcome } from "../civic-data/promotion.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";

export interface VenuePublication {
  readonly records: number;
  readonly outcome: PromotionOutcome | null;
  /** Why nothing was promoted, in one line; null when the door answered. */
  readonly held: string | null;
}

export async function publishVenueResolutions(input: {
  readonly store: RoutineDataStore;
  readonly package: ManualProjectionPackage | null;
  readonly now: string;
}): Promise<VenuePublication> {
  const records = (input.package?.payload as { records?: readonly unknown[] } | undefined)?.records?.length ?? 0;
  if (!input.package || records === 0) return { records: 0, outcome: null, held: null };
  try {
    const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(input.package, input.store, input.now);
    const outcome = await processRegisteredManualCandidate(input.store, "venue-resolutions", candidate, input.now, expectedBaseVersionId);
    return { records, outcome, held: outcome.promoted || outcome.confirmed ? null : (outcome.candidate.failureDetail ?? outcome.candidate.state) };
  } catch (error) {
    return { records, outcome: null, held: (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 300) };
  }
}
