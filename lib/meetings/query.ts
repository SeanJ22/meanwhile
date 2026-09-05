import { haversineKm } from "../geo/distance.ts";
import type { CoverageSummary } from "../registry/coverage.ts";
import type { Meeting } from "../sources/types.ts";
import type { MeetingListingIdentityReadback } from "./listing-identity.ts";

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
  /** Route readback of exact canonical body/listing identity, before UI filters. */
  listingIdentity?: MeetingListingIdentityReadback;
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
  /**
   * The OCD-IDs of every division the reader's point resolved into (M81).
   *
   * Attached by the route, like `coverage`, so `searchMeetings` stays pure and
   * geometry-free. **NULL means the resolution FAILED** and is deliberately
   * not the same as an empty array: an empty array treated as an answer would
   * badge every meeting on screen "Nearby, different jurisdiction", which is a
   * specific false claim produced by our own lookup failing.
   */
  governingOcdIds?: string[] | null;
  /**
   * The divisions covering only PART of this zip (`JUR-2`, 2026-08-23).
   *
   * Attached by the route from the same lattice measurement the ballot page's
   * RULING 71 pill reads, so the meeting badge and the ballot pill cannot
   * disagree about which town is unsettled. **NULL means unmeasured** — the
   * zip is outside the committed geometry — and is not the same as an empty
   * array, which means measured and nothing is partial.
   */
  partialOcdIds?: string[] | null;
}

function byStartAscending(a: Meeting, b: Meeting) {
  return Date.parse(a.startsAt) - Date.parse(b.startsAt);
}

function byStartDescending(a: Meeting, b: Meeting) {
  return Date.parse(b.startsAt) - Date.parse(a.startsAt);
}

/**
 * The key that says "these sittings belong to the same government".
 *
 * `ocdId` where there is one; otherwise the meeting id's source-and-tenant
 * prefix, because every adapter namespaces `<source>:<tenant>:<id>` and the
 * tenant IS the government — `diligent:pcc` is Pima Community College, whose
 * division does not exist.
 *
 * It is deliberately NOT `bodyName`. The first version keyed on it and Pima
 * Community College's three online committee sittings stayed invisible while
 * five of its in-person sittings were on screen: Diligent publishes a
 * per-sitting name ("Regular Governing Board", "Finance and Audit Committee
 * Meeting"), so a name key says every committee is a different government.
 * Caught by asking the live route what it returned rather than by reading the
 * code back.
 */
function bodyKey(m: Meeting): string {
  return m.ocdId ?? m.id.split(":").slice(0, 2).join(":");
}

/**
 * Which meetings are in view — including the ones held nowhere (D18).
 *
 * A meeting with no physical place has no distance to a map centre, so a
 * radius filter silently excludes every one of them. That is the drop this
 * row exists to end, one layer further along: the adapter now keeps the
 * meeting, and this is where it would have been lost again.
 *
 * An online meeting is in view when EITHER holds:
 *
 * - the division it belongs to contains the centre. The exact answer, and the
 *   only one that reaches a body which meets ONLY online, since nothing about
 *   such a body would otherwise be in radius. `divisionsAtPoint` is the
 *   point-in-polygon set the route already resolves for the coverage summary
 *   — the same committed geometry, never a second source.
 * - one of the same body's PHYSICAL sittings is in radius. This is what covers
 *   a division-less government, where the first clause has no identifier to
 *   test: Pima Community College's board is in view exactly when its in-person
 *   sittings are.
 *
 * Neither clause invents a coordinate, and an online meeting that satisfies
 * neither is simply not in view — the same answer a distant building gets.
 */
function within(
  meetings: Meeting[],
  lat: number,
  lng: number,
  radiusKm: number,
  divisionsAtPoint: ReadonlySet<string> = new Set(),
) {
  const physical = meetings.filter((m) => m.location !== null);
  const inRadius = physical.filter(
    (m) => haversineKm(lat, lng, m.location!.lat, m.location!.lng) <= radiusKm,
  );
  const bodiesInView = new Set(inRadius.map(bodyKey));

  const online = meetings.filter(
    (m) =>
      m.location === null &&
      ((m.ocdId !== null && divisionsAtPoint.has(m.ocdId)) || bodiesInView.has(bodyKey(m))),
  );

  // Ordering is applied by the caller; concatenating keeps this a filter.
  return [...inRadius, ...online];
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
  /**
   * Divisions whose boundary contains the centre (D18).
   *
   * Supplied by the caller because this module stays geometry-free — the
   * route already resolves this set for the coverage summary, and resolving
   * it twice in two places is how two answers to one question appear. Absent
   * falls back to the body-in-view clause alone, which is what every
   * non-route caller wants.
   */
  divisionsAtPoint: ReadonlySet<string> = new Set(),
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

  // The recent past rides along with a successful rung (3g): concluded and
  // canceled sittings inside the lookback, at the same radius, so the date
  // slider's backward range has something to reveal. They never decide the
  // tier — that stays a claim about the future — and the client's default
  // window (0 days back) keeps them off screen until asked for. CANCELED
  // stays out of the *fallback* tier below: a canceled meeting is news, but
  // it must never be what fills an otherwise-empty map.
  const recentPast = all.filter((m) => {
    if (m.status !== "CONCLUDED" && m.status !== "CANCELED") return false;
    const t = Date.parse(m.startsAt);
    return t >= now.getTime() - lookbackMs && t < now.getTime() + horizonMs;
  });

  for (const radiusKm of rungs) {
    const hits = within(upcoming, lat, lng, radiusKm, divisionsAtPoint);
    if (hits.length > 0) {
      return {
        meetings: [...hits, ...within(recentPast, lat, lng, radiusKm, divisionsAtPoint)].sort(
          byStartAscending,
        ),
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
    divisionsAtPoint,
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
