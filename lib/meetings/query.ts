import { haversineKm } from "../geo/distance.ts";
import type { CoverageSummary } from "../registry/coverage.ts";
import type { Meeting } from "../sources/types.ts";

import {
  CONCLUDED_LOOKBACK_DAYS,
  RADIUS_LADDER_KM,
  UPCOMING_HORIZON_DAYS,
  type CoverageTier,
} from "./constants.ts";
import { getMeetingSource } from "./registry.ts";

/**
 * The empty-state cascade.
 *
 * An empty map is a dead end: it reads as "your government does nothing" when
 * the truth is "nothing within fifteen miles this fortnight." So the search
 * steps outward, and when it runs out of future it reaches into the recent
 * past — always saying which rung it landed on, because a widened radius the
 * user wasn't told about is just a wrong answer.
 */

// Moved to ./constants.ts so client code can import the values without
// pulling this module's server-only graph; re-exported here so server-side
// callers keep their import path.
export {
  CONCLUDED_LOOKBACK_DAYS,
  RADIUS_LADDER_KM,
  UPCOMING_HORIZON_DAYS,
} from "./constants.ts";
export type { CoverageTier } from "./constants.ts";

export interface MeetingSearchResult {
  meetings: Meeting[];
  tier: CoverageTier;
  /** Radius the returned meetings were found in. */
  radiusKm: number;
  /** Radius originally asked for — differs from `radiusKm` when widened. */
  requestedRadiusKm: number;
  center: { lat: number; lng: number };
  /**
   * Who governs this point and how much of their calendar we hold.
   *
   * Attached by the route rather than by `searchMeetings`, which stays pure and
   * geometry-free. `null` when the registry could not be read — a coverage
   * statement we cannot stand behind is worse than none, so the UI falls back to
   * saying only what the cascade knows.
   */
  coverage: CoverageSummary | null;
}

function byStartAscending(a: Meeting, b: Meeting) {
  return Date.parse(a.startsAt) - Date.parse(b.startsAt);
}

function byStartDescending(a: Meeting, b: Meeting) {
  return Date.parse(b.startsAt) - Date.parse(a.startsAt);
}

function within(meetings: Meeting[], lat: number, lng: number, radiusKm: number) {
  return meetings.filter(
    (m) => haversineKm(lat, lng, m.location.lat, m.location.lng) <= radiusKm,
  );
}

/**
 * Find meetings to render for a map centered on `lat`/`lng`.
 *
 * Walks the radius ladder from `startRadiusKm` outward looking for upcoming
 * meetings, then falls back to recently concluded ones at the widest radius.
 */
export async function searchMeetings(
  lat: number,
  lng: number,
  startRadiusKm: number = RADIUS_LADDER_KM[0],
  now: Date = new Date(),
): Promise<MeetingSearchResult> {
  const source = getMeetingSource();
  const center = { lat, lng };

  const ladder = RADIUS_LADDER_KM.filter((r) => r >= startRadiusKm);
  // A caller asking for something wider than the whole ladder still gets one
  // pass at exactly what they asked for.
  const rungs = ladder.length > 0 ? ladder : [startRadiusKm];
  const widest = rungs[rungs.length - 1];

  // One fetch at the widest radius; the rungs are filters over it. Saves the
  // real adapter from three round trips to the same upstream.
  const horizonMs = UPCOMING_HORIZON_DAYS * 86_400_000;
  const lookbackMs = CONCLUDED_LOOKBACK_DAYS * 86_400_000;

  const all = await source.load(
    {
      lat,
      lng,
      radiusKm: widest,
      startsAfter: new Date(now.getTime() - lookbackMs).toISOString(),
      startsBefore: new Date(now.getTime() + horizonMs).toISOString(),
    },
    now,
  );

  const upcoming = all
    .filter((m) => m.status === "SCHEDULED")
    .filter((m) => {
      const t = Date.parse(m.startsAt);
      return t >= now.getTime() && t <= now.getTime() + horizonMs;
    });

  for (const radiusKm of rungs) {
    const hits = within(upcoming, lat, lng, radiusKm);
    if (hits.length > 0) {
      return {
        meetings: hits.sort(byStartAscending),
        tier: radiusKm === rungs[0] ? "exact" : "widened",
        radiusKm,
        requestedRadiusKm: startRadiusKm,
        center,
        coverage: null,
      };
    }
  }

  // No future anywhere on the ladder. Show what was recently decided rather
  // than an empty map — a council that met last Tuesday is still the answer to
  // "who governs here."
  const concluded = within(
    all.filter((m) => {
      if (m.status !== "CONCLUDED") return false;
      const t = Date.parse(m.startsAt);
      return t >= now.getTime() - lookbackMs && t < now.getTime();
    }),
    lat,
    lng,
    widest,
  );

  if (concluded.length > 0) {
    return {
      meetings: concluded.sort(byStartDescending),
      tier: "concluded",
      radiusKm: widest,
      requestedRadiusKm: startRadiusKm,
      center,
      coverage: null,
    };
  }

  // Nothing either way. CLAUDE.md calls for one more rung here — district
  // boundaries with officeholders — which needs TIGER/Line geometry and an
  // officeholder source. Until those exist, say so plainly.
  return {
    meetings: [],
    tier: "none",
    radiusKm: widest,
    requestedRadiusKm: startRadiusKm,
    center,
    coverage: null,
  };
}
