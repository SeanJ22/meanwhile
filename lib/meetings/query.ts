import { readReaderMeetingSettings } from "./reader-settings.ts";
import { haversineKm } from "../geo/distance.ts";
import type { CoverageSummary } from "../registry/coverage.ts";
import type { Meeting } from "../sources/types.ts";
import type { MeetingListingIdentityReadback } from "./listing-identity.ts";

import {
  RADIUS_LADDER_KM,
  type CoverageTier,
} from "./constants.ts";
import { getMeetingSource, type ResolvedMeetingSource } from "./registry.ts";

/** The empty-state cascade: widen the radius, then reach into the recent past, always saying which rung it landed on. */

// Re-exported from ./constants.ts so client code can import the values without this module's server-only graph.
export {
  CONCLUDED_LOOKBACK_DAYS,
  RADIUS_LADDER_KM,
  UPCOMING_HORIZON_DAYS,
} from "./constants.ts";
export type { CoverageTier } from "./constants.ts";

export interface MeetingSearchResult {
  /** Held meetings of the place’s governments, apart from widened nearby results. */
  readerScope?: import("./reader-scope.ts").ReaderMeetingScope;
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
  /** Who governs this point and how much of their calendar we hold; null when the registry could not be read. */
  coverage: CoverageSummary | null;
  /** Divisions the reader's point resolved into. Null means the resolution failed, which is not an empty array. */
  governingOcdIds?: string[] | null;
  /** Divisions covering only part of this ZIP. Null means unmeasured; an empty array means none is partial. */
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

/** A reader-facing jurisdiction name: an id-shaped value becomes the name it spells; a name comes back untouched. */
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
 * The key for "these sittings belong to the same government": `ocdId`, else the id's source-and-tenant prefix. Never
 * `bodyName`, which some publishers set per sitting.
 */
function bodyKey(m: Meeting): string {
  return m.ocdId ?? m.id.split(":").slice(0, 2).join(":");
}

/**
 * Which meetings are in view, including online ones with no distance to a centre. An online meeting is in view when
 * its division contains the centre, or when one of its body's physical sittings (upcoming or concluded) is in radius.
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

/** Bodies (by `bodyKey`) with a physical sitting within `radiusKm`, answered once for every list at that radius. */
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
  /** Divisions whose boundary contains the centre, supplied by the caller so this module stays geometry-free. */
  divisionsAtPoint: ReadonlySet<string> = new Set(),
  /** The resolved meeting source, injected so one request composes the projection once. */
  injectedSource?: ResolvedMeetingSource,
  shownSettings?: Pick<import("./settings.ts").MeetingSettings, "shownBackDays" | "shownAheadDays">,
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
  const shown = shownSettings ?? await readReaderMeetingSettings();
  const horizonMs = shown.shownAheadDays * 86_400_000;
  const lookbackMs = shown.shownBackDays * 86_400_000;

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

  // Recent concluded and canceled sittings ride along with a successful rung but never decide the tier, and canceled
  // sittings never fill the fallback tier.
  const recentPast = all.filter((m) => {
    if (m.status !== "CONCLUDED" && m.status !== "CANCELED") return false;
    const t = Date.parse(m.startsAt);
    return t >= now.getTime() - lookbackMs && t < now.getTime() + horizonMs;
  });

  // Bodies placed from both lists: a building listed only among upcoming sittings keeps the body's online concluded
  // sittings in view, and the reverse.
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

  // No future anywhere on the ladder: show what was recently decided rather than an empty map.
  const recentlyConcluded = all.filter((m) => {
    if (m.status !== "CONCLUDED") return false;
    const t = Date.parse(m.startsAt);
    return t >= now.getTime() - lookbackMs && t < now.getTime();
  });
  // Upcoming or recently concluded, never canceled.
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

  // Nothing either way; say so plainly.
  return {
    meetings: [],
    tier: "none",
    radiusKm: widest,
    requestedRadiusKm: startRadiusKm,
    center,
    coverage: null,
  };
}
