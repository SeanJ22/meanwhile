/**
 * The shapes every ingestion adapter normalizes into.
 *
 * These are the real interfaces, not mock-shaped conveniences. The mock adapter
 * in lib/sources/mock/ produces exactly these; a Legistar or Democracy Works
 * adapter will produce exactly these too, and nothing downstream changes.
 */

/**
 * An OCD division identifier, e.g.
 * `ocd-division/country:us/state:az/place:tucson`.
 *
 * The universal join key for districts, offices, and elections. Never join
 * geographic entities on name strings — names collide across states and change
 * between sources.
 */
export type OcdId = string;

/**
 * Where an externally sourced record came from and when we last looked at it.
 *
 * Carried on every record from an outside system and never dropped in a
 * transform. If a field can't be filled, it is null and the UI says so — it is
 * never inferred.
 */
export interface Provenance {
  /**
   * The exact page or endpoint this record was read from.
   *
   * Null when there is no such page to name. That is a real state, not an
   * oversight: a body that publishes by phone or by paper has no permalink,
   * and a fixture was not read from anywhere at all. The one thing this field
   * must never hold is a plausible-looking URL that was constructed rather
   * than observed — a fabricated citation is worse than a missing one,
   * because it is invisible until a reader clicks it.
   */
  sourceUrl: string | null;
  /** The organization that published it, e.g. "City of Tucson Clerk". */
  sourceOrg: string;
  /** When we fetched it. */
  collectedAt: string;
  /** When a human or check last confirmed it still matches the source. */
  verifiedAt: string | null;
  /**
   * The record came from somewhere OTHER than the publishing body's own site
   * or feed — an aggregator, a press report, a third party's index (6f2,
   * 2026-08-15).
   *
   * **Absent/false is the normal case and is what retires the "Not
   * independently verified" line.** When a meeting comes off a town's own
   * planning-board page, there is no independent party who could verify it
   * and none is wanted: the body is the authority on its own calendar and the
   * SOURCE link is the verification. The old line rendered on every record
   * that merely lacked a `verifiedAt` stamp, which taught readers to distrust
   * the most reliable record this product has.
   *
   * No adapter sets this today — every wired source is a body's own
   * publication or its own agenda vendor. It exists so the day one is not,
   * the line is available and the claim is precise rather than blanket.
   */
  secondHand?: boolean;
}

/**
 * Where a meeting physically happens.
 *
 * `lat`/`lng` are the pin. A meeting with no resolvable coordinates cannot be
 * placed on the map and is dropped by the adapter rather than guessed at.
 */
export interface MeetingLocation {
  /** Human-readable, as printed on the agenda: "Tucson City Hall, Mayor and Council Chambers". */
  name: string;
  /** Street address if the source gives one. */
  address: string | null;
  lat: number;
  lng: number;
}

/**
 * Where a meeting sits relative to now.
 *
 * `SCHEDULED` — upcoming, on the published calendar.
 * `CONCLUDED` — already happened. Surfaced only by the empty-state cascade, and
 *               always rendered visually distinct from upcoming meetings.
 * `CANCELED`  — called off by the body. Kept because a canceled meeting is
 *               itself news, but never used to fill an empty map.
 */
export type MeetingStatus = "SCHEDULED" | "CONCLUDED" | "CANCELED";

/**
 * A single sitting of a public body: a council session, a commission hearing, a
 * school board meeting.
 */
export interface Meeting {
  /** Stable within a source. Namespaced by source to stay unique across them. */
  id: string;
  /**
   * The division whose government is meeting.
   *
   * **Null when the body is associated with no Census division** — Pima
   * Community College's district, a special district, a regional council.
   * That is a stated fact, not a missing value: Census enumerates no boundary
   * for these governments, and minting an identifier is a convention decision
   * (tracker D31) that must not be made ad hoc by an adapter. A null-division
   * meeting is local-tier by construction — see `tierForMeeting` in
   * `lib/state/derive.ts`.
   */
  ocdId: OcdId | null;
  /** The body itself: "Mayor and Council", "Planning Commission". */
  bodyName: string;
  /** What this particular sitting is called: "Regular Session", "Budget Hearing". */
  title: string;
  /** Start time, ISO 8601 with offset. Local government meets in local time. */
  startsAt: string;
  /**
   * How precisely the publisher dated this sitting (M59, 2026-08-15).
   *
   * `MINUTE` — the normal case: the source gave a date AND a start time, and
   *   `startsAt` means exactly what it says.
   * `DAY` — **the source gave a date and no start time.** Two real archives do
   *   this: Rockaway Township's AgendaCenter and Merrimack County's notices
   *   page both publish past sittings as dated documents with no clock on
   *   them. Those meetings happened, so refusing to ingest them is its own
   *   kind of lie about coverage — but inventing 7pm to fill this field would
   *   be a generated fact about a government, which is the failure this
   *   product cannot survive.
   *
   * So on a `DAY` meeting `startsAt` carries local midnight and that midnight
   * is **an ordering artifact, never a claim**. Nothing may render it as a
   * time: `formatMeetingTime` returns the honest line instead, and calendar
   * links build an all-day event. `tests/day-precision.test.ts` holds both.
   *
   * Optional because every source that predates M59 publishes real times, and
   * absent means `MINUTE`. A source that CAN emit date-only rows must set it
   * explicitly — the guard names those sources so a new one cannot inherit
   * the default by omission.
   */
  startPrecision?: "MINUTE" | "DAY";
  /** IANA zone the meeting is held in, for rendering times honestly. */
  timeZone: string;
  location: MeetingLocation;
  /** Link to the published agenda. Null when the body hasn't posted one yet. */
  agendaUrl: string | null;
  /** Display name of the jurisdiction: "Tucson, AZ". Display only — join on ocdId. */
  jurisdiction: string;
  status: MeetingStatus;
  provenance: Provenance;
}

/**
 * Geographic window a caller wants meetings for.
 */
export interface MeetingQuery {
  lat: number;
  lng: number;
  radiusKm: number;
  /** Only meetings starting at or after this instant. */
  startsAfter?: string;
  /** Only meetings starting at or before this instant. */
  startsBefore?: string;
  status?: MeetingStatus[];
}

/**
 * What a normalize() pass could not turn into a placed meeting, and why.
 *
 * Counted, never silent. `placeless` and `unknownVenue` are different facts
 * (D18): "there is nothing to place" versus "we could not place it".
 * `notConfigured` counts rows a feed carried that belong to no wired body —
 * a township calendar's yard sale, a district's parent-teacher night — which
 * are dropped by configuration rather than by failure.
 */
export interface NormalizeDropCounts {
  placeless: number;
  unknownVenue: number;
  unplaceableInTime: number;
  notConfigured: number;
}

/**
 * A source that reports its drops alongside its meetings.
 *
 * The composite requires this of every child: a source that cannot say what
 * it dropped cannot be audited, and "fewer meetings than the reader would
 * otherwise have seen" must never happen silently.
 */
export interface ReportingMeetingSource<Raw = unknown>
  extends MeetingSource<Raw> {
  normalizeWithDrops(
    raw: Raw[],
    now?: Date,
  ): { meetings: Meeting[]; drops: NormalizeDropCounts };
}

/**
 * The contract every source directory implements.
 *
 * Adding a source means adding a directory that exports one of these. It never
 * means editing shared ingestion logic.
 */
export interface MeetingSource<Raw = unknown> {
  /** Stable slug, matching the directory name. */
  readonly name: string;
  /** Hit the upstream system. The only step allowed to touch the network. */
  fetch(query: MeetingQuery): Promise<Raw[]>;
  /**
   * Map upstream payloads onto Meeting. Pure, and drops what it can't place.
   *
   * `now` decides SCHEDULED vs CONCLUDED. It is a parameter rather than a call
   * to the clock so the transform stays deterministic and testable.
   */
  normalize(raw: Raw[], now?: Date): Meeting[];
  /** Persist normalized records. */
  upsert(meetings: Meeting[]): Promise<{ inserted: number; updated: number }>;
}
