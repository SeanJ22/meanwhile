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
import { getMeetingSource, type ResolvedMeetingSource } from "./registry.ts";

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
  /** Canonical public-comment rules hydrated by the server data plane. */
  commentAccess?: readonly import("../registry/comment-access.ts").CommentAccess[];
  /** Canonical direct-owner service routing, including explicit owed cells. */
  everydayRouting?: import("../routing/everyday.ts").EverydayRoutingProjection | null;
  everydayRoutingDataState?: "PROMOTED" | "FIRST_SEED" | "NOT_RECORDED" | "STORE_UNREACHABLE" | "INVALID";
  everydayRoutingDataDetail?: string | null;
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

const SMALL_WORDS = new Set(["of", "and", "the", "for", "at", "in"]);

function titleWords(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

/**
 * A reader-facing jurisdiction name for a meeting.
 *
 * Some calendars are wired under the internal id of the government they belong
 * to ("az:county:county-of-cochise", or an OCD division id) rather than its
 * name, and every reader surface prints `meeting.jurisdiction` as it finds it.
 * An id-shaped value becomes the name it spells — "Cochise County, AZ" — and
 * anything already a name comes back untouched, so the fix holds for every
 * calendar wired this way and not for one county.
 */
export function readerJurisdictionLabel(jurisdiction: string): string {
  const internal = /^([a-z]{2}):([a-z_]+):([a-z0-9][a-z0-9_-]*)$/.exec(jurisdiction);
  const ocd = /^ocd-division\/country:us(?:\/state:([a-z]{2}))?(?:.*\/)?([a-z_]+):([a-z0-9_~.'-]+)$/.exec(
    jurisdiction,
  );
  const [state, kind, slug] = internal
    ? [internal[1], internal[2], internal[3]]
    : ocd
      ? [ocd[1] ?? "", ocd[2], ocd[3]]
      : [null, "", ""];
  if (state === null) return jurisdiction;

  let name: string;
  const prefixed = /^(county|city|town|village|borough|township)-of-(.+)$/.exec(slug);
  if (prefixed) {
    const rest = titleWords(prefixed[2]);
    name = prefixed[1] === "county" ? `${rest} County` : prefixed[1] === "township" ? `${rest} Township` : rest;
  } else if (kind === "county" && !/-county$/.test(slug)) {
    name = `${titleWords(slug)} County`;
  } else {
    name = titleWords(slug);
  }
  return state ? `${name}, ${state.toUpperCase()}` : name;
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
 * - one of the same body's PHYSICAL sittings, upcoming or recently concluded,
 *   is in radius — whichever of the two lists that sitting is in. This is
 *   what covers a division-less government, where the first clause has no
 *   identifier to test: Pima Community College's board is in view exactly
 *   when one of its in-person sittings is. `bodiesInView` is that set, built
 *   by the caller ONCE per radius from both lists (`bodiesSittingWithin`) and
 *   handed to the call for each list. Built from the list being filtered, as
 *   it first was, it lost the college's two concluded sittings on 2026-09-24:
 *   both were online, its building appeared only among its upcoming
 *   sittings, and the concluded list, asked about itself, found no building.
 *
 * Neither clause invents a coordinate, and an online meeting that satisfies
 * neither is simply not in view — the same answer a distant building gets.
 */
function within(
  meetings: Meeting[],
  lat: number,
  lng: number,
  radiusKm: number,
  bodiesInView: ReadonlySet<string>,
  divisionsAtPoint: ReadonlySet<string> = new Set(),
) {
  const physical = meetings.filter((m) => m.location !== null);
  const inRadius = physical.filter(
    (m) => haversineKm(lat, lng, m.location!.lat, m.location!.lng) <= radiusKm,
  );

  const online = meetings.filter(
    (m) =>
      m.location === null &&
      ((m.ocdId !== null && divisionsAtPoint.has(m.ocdId)) || bodiesInView.has(bodyKey(m))),
  );

  // Ordering is applied by the caller; concatenating keeps this a filter.
  return [...inRadius, ...online];
}

/**
 * The bodies (by `bodyKey`) with a PHYSICAL sitting among `sittings` within
 * `radiusKm` of the centre — the second clause of `within`, answered once for
 * every list served at that radius. Only a sitting's own published place
 * counts; a sitting with no place contributes nothing.
 */
function bodiesSittingWithin(
  sittings: readonly Meeting[],
  lat: number,
  lng: number,
  radiusKm: number,
): Set<string> {
  return new Set(
    sittings
      .filter(
        (m) =>
          m.location !== null &&
          haversineKm(lat, lng, m.location.lat, m.location.lng) <= radiusKm,
      )
      .map(bodyKey),
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
  /**
   * The resolved meeting source. Injected by the API route so the request reads
   * and composes the canonical projection ONCE and feeds the same snapshot to
   * both the search and the freshness metadata (D.1). Every other caller omits
   * it and gets the active source for the environment.
   */
  injectedSource?: ResolvedMeetingSource,
): Promise<MeetingSearchResult> {
  const source = injectedSource ?? getMeetingSource();
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

  const all = (
    await source.load(
      {
        lat,
        lng,
        radiusKm: widest,
        startsAfter: new Date(now.getTime() - lookbackMs).toISOString(),
        startsBefore: new Date(now.getTime() + horizonMs).toISOString(),
      },
      now,
    )
  ).map((m) => {
    const jurisdiction = readerJurisdictionLabel(m.jurisdiction);
    return jurisdiction === m.jurisdiction ? m : { ...m, jurisdiction };
  });

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

  // Where each body is, read once per rung from BOTH lists: a building listed
  // only among a body's upcoming sittings keeps its online concluded ones in
  // view, and the reverse. The recent past still never earns a rung by
  // itself — it can place a body, and only an upcoming sitting in view counts.
  const servedAtRung = [...upcoming, ...recentPast];

  for (const radiusKm of rungs) {
    const bodiesInView = bodiesSittingWithin(servedAtRung, lat, lng, radiusKm);
    const hits = within(upcoming, lat, lng, radiusKm, bodiesInView, divisionsAtPoint);
    if (hits.length > 0) {
      return {
        meetings: [
          ...hits,
          ...within(recentPast, lat, lng, radiusKm, bodiesInView, divisionsAtPoint),
        ].sort(byStartAscending),
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
  const recentlyConcluded = all.filter((m) => {
    if (m.status !== "CONCLUDED") return false;
    const t = Date.parse(m.startsAt);
    return t >= now.getTime() - lookbackMs && t < now.getTime();
  });
  // The same rule over what this tier serves: upcoming or recently concluded,
  // never canceled. (Reaching here means no upcoming sitting was in view at
  // the widest rung, so every building in radius is a concluded one.)
  const concluded = within(
    recentlyConcluded,
    lat,
    lng,
    widest,
    bodiesSittingWithin([...upcoming, ...recentlyConcluded], lat, lng, widest),
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
