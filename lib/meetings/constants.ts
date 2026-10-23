export const DEFAULT_RADIUS_KM = 25;
export const MAX_RADIUS_KM = 150;

/** Rolling upcoming window. */
export const UPCOMING_HORIZON_DAYS = 90;

export const CONCLUDED_LOOKBACK_DAYS = 90;

export const MEETING_HELD_LOOKBACK_DAYS = 120;
export const MEETING_HELD_HORIZON_DAYS = 120;

export const MEETING_READER_SERVING_WINDOW_CONTRACT =
  "MEETING_READER_SERVING_WINDOW_V2" as const;
export const MEETING_READER_SERVING_WINDOW_CONTRACT_V1 =
  "MEETING_READER_SERVING_WINDOW_V1" as const;

export interface MeetingReaderServingWindow {
  readonly contract: typeof MEETING_READER_SERVING_WINDOW_CONTRACT;
  readonly lowerBound: string;
  readonly upperBound: string;
}

export interface MeetingLegacyServingWindow {
  readonly contract: typeof MEETING_READER_SERVING_WINDOW_CONTRACT_V1;
  readonly lowerBound: string;
  readonly upperBound: string;
}

/** The held window around `anchor`: 120 days back, 120 ahead. Null for an unparseable anchor. */
export function meetingHeldWindowAt(anchor: string): MeetingReaderServingWindow | null {
  const instant = Date.parse(anchor);
  if (!Number.isFinite(instant)) return null;
  return {
    contract: MEETING_READER_SERVING_WINDOW_CONTRACT,
    lowerBound: new Date(instant - MEETING_HELD_LOOKBACK_DAYS * 86_400_000).toISOString(),
    upperBound: new Date(instant + MEETING_HELD_HORIZON_DAYS * 86_400_000).toISOString(),
  };
}

/** The registered window a removal may name today: the held window. */

/** The old shown (90/90) window, accepted on a `V1` removal row for one pass. */
export function meetingLegacyServingWindowAt(anchor: string): MeetingLegacyServingWindow | null {
  const instant = Date.parse(anchor);
  if (!Number.isFinite(instant)) return null;
  return {
    contract: MEETING_READER_SERVING_WINDOW_CONTRACT_V1,
    lowerBound: new Date(instant - CONCLUDED_LOOKBACK_DAYS * 86_400_000).toISOString(),
    upperBound: new Date(instant + UPCOMING_HORIZON_DAYS * 86_400_000).toISOString(),
  };
}

/**
 * The window a read actually fetched: adapters fetch 90 days each way, so a
 * prior row between 90 and 120 days out was never asked about by this read.
 */
export function meetingFetchedWindowAt(anchor: string): { readonly lowerBound: string; readonly upperBound: string } | null {
  const legacy = meetingLegacyServingWindowAt(anchor);
  return legacy === null ? null : { lowerBound: legacy.lowerBound, upperBound: legacy.upperBound };
}

export type CoverageTier = "exact" | "concluded" | "none";
