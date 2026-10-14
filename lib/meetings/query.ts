import { readReaderMeetingSettings } from "./reader-settings.ts";
import type { Body } from "../registry/types.ts";
import type { CoverageSummary } from "../registry/coverage.ts";
import type { Meeting } from "../sources/types.ts";
import type { MeetingListingIdentityReadback } from "./listing-identity.ts";

import {
  DEFAULT_RADIUS_KM,
  type CoverageTier,
} from "./constants.ts";
import { getMeetingSource, type ResolvedMeetingSource } from "./registry.ts";

// Re-exported from ./constants.ts so client code can import the values without this module's server-only graph.
export {
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
} from "./constants.ts";
export type { CoverageTier } from "./constants.ts";

export interface MeetingSearchResult {
  /** Held meetings of the place’s governments. */
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
  /** Radius requested by the map. */
  radiusKm: number;
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

export async function searchMeetings(
  lat: number,
  lng: number,
  radiusKm: number = DEFAULT_RADIUS_KM,
  now: Date = new Date(),
  divisionsAtPoint: ReadonlySet<string> = new Set(),
  injectedSource?: ResolvedMeetingSource,
  shownSettings?: Pick<import("./settings.ts").MeetingSettings, "shownBackDays" | "shownAheadDays">,
  bodies: readonly Pick<Body, "id" | "ocdId" | "alsoServesOcdIds">[] = [],
): Promise<MeetingSearchResult> {
  const source = injectedSource ?? getMeetingSource();
  const shown = shownSettings ?? await readReaderMeetingSettings();
  const horizonMs = shown.shownAheadDays * 86_400_000;
  const lookbackMs = shown.shownBackDays * 86_400_000;
  const byBody = new Map(bodies.map(body => [body.id, body]));
  const all = (await source.load({
    lat,
    lng,
    radiusKm,
    startsAfter: new Date(now.getTime() - lookbackMs).toISOString(),
    startsBefore: new Date(now.getTime() + horizonMs).toISOString(),
  }, now)).filter(meeting => {
    const body = meeting.bodyId ? byBody.get(meeting.bodyId) : undefined;
    const divisions = [body?.ocdId ?? meeting.ocdId, ...(body?.alsoServesOcdIds ?? [])];
    return divisions.some(id => id != null && divisionsAtPoint.has(id.split("#")[0]));
  }).map(meeting => {
    const jurisdiction = readerJurisdictionLabel(meeting.jurisdiction);
    return jurisdiction === meeting.jurisdiction ? meeting : { ...meeting, jurisdiction };
  });

  const upcoming = all.filter(meeting => meeting.status === "SCHEDULED" &&
    Date.parse(meeting.startsAt) >= now.getTime() &&
    Date.parse(meeting.startsAt) <= now.getTime() + horizonMs);
  const recentPast = all.filter(meeting =>
    (meeting.status === "CONCLUDED" || meeting.status === "CANCELED") &&
    Date.parse(meeting.startsAt) >= now.getTime() - lookbackMs &&
    Date.parse(meeting.startsAt) < now.getTime() + horizonMs);
  const concluded = recentPast.filter(meeting => meeting.status === "CONCLUDED" &&
    Date.parse(meeting.startsAt) < now.getTime());

  return {
    meetings: upcoming.length > 0
      ? [...upcoming, ...recentPast].sort(byStartAscending)
      : concluded.sort(byStartDescending),
    tier: upcoming.length > 0 ? "exact" : concluded.length > 0 ? "concluded" : "none",
    radiusKm,
    center: { lat, lng },
    coverage: null,
  };
}
