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
  /** The division whose government is meeting. */
  ocdId: OcdId;
  /** The body itself: "Mayor and Council", "Planning Commission". */
  bodyName: string;
  /** What this particular sitting is called: "Regular Session", "Budget Hearing". */
  title: string;
  /** Start time, ISO 8601 with offset. Local government meets in local time. */
  startsAt: string;
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
