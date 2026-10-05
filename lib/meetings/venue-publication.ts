/**
 * BX-09: venue pins publish on their own. Every address a meeting pass freshly matches to one exact Census street
 * point (lib/meetings/automatic-venue-resolutions.ts) is promoted into the `venue-resolutions` pointer by this code,
 * with the same receipts that proved it, so later passes and other bodies reuse the pin without any person's review.
 * `reviewedBy` is the automatic reviewer's code version; the §3 validator (manual-projections.ts) is the only check.
 *
 * A refused or failed promotion holds only this pointer: the meeting pass has already promoted its own sittings,
 * the prior GOOD resolutions stay live, and the same addresses are matched again on the next pass.
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
