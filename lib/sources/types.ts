/** The shapes every ingestion adapter normalizes into. */

// Type-only, so this stays a one-way dependency at runtime: attribution.ts
// imports `OcdId` from here, and nothing is emitted for either import.
import type { MeetingBody } from "../meetings/attribution.ts";
import type { Accounted } from "./normalize-account.ts";

/**
 * An OCD division identifier, e.g.
 * `ocd-division/country:us/state:<st>/place:<name>`.
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
  kind?: import("../control-plane/promotion/source-kinds.ts").SourceKind;
  /** Exact saved source span supporting this field. */
  quote?: string;
  /**
   * The exact page or endpoint this record was read from. Null when there is
   * no such page to name; never a URL constructed rather than observed.
   */
  sourceUrl: string | null;
  /** The organization that published it, e.g. "City Clerk". */
  sourceOrg: string;
  /** When we fetched it. */
  collectedAt: string;
  /** When a human or check last confirmed it still matches the source. */
  verifiedAt: string | null;
  /**
   * The registry id of the feed or page that holds this record. Stamped where the record is published, never by
   * an adapter. Absent when not known yet.
   */
  doorId?: string;
  /**
   * The record came from somewhere OTHER than the publishing body's own site
   * or feed — an aggregator, a press report, a third party's index. Absent is
   * the normal case: the body is the authority on its own calendar.
   */
  secondHand?: boolean;
  /**
   * The publisher's own words this record was read from, verbatim — set by an
   * adapter that reads a page's prose or cards rather than a structured feed,
   * so the claim can be checked against its source without re-deriving it.
   */
  evidenceExcerpt?: string;
  /**
   * Set when an adapter merged two or more of one source's own listings of one
   * body's sitting because every published field is identical and only the
   * publisher's entry ids differ. `sourceIds` and `sourceUrls` keep every
   * listing, in the same order, so the merge can be audited and reversed. See
   * `collapsePublisherRelistings` in `lib/sources/ical/index.ts`.
   */
  publisherListings?: {
    /** "listed twice in the publisher's own calendar". */
    readonly note: string;
    readonly sourceIds: readonly string[];
    readonly sourceUrls: readonly (string | null)[];
  };
}

/**
 * This row was NOT retrieved on the run that wrote the snapshot holding it; it
 * was carried forward because its source could not be reached. Recorded at
 * write time, never inferred at read time. `carryForward` in
 * `lib/meetings/carry-forward.ts` is the only writer.
 */
export interface CarriedForward {
  /** The source whose refusal is the reason this row was carried. */
  source: string;
  /**
   * When this row was last actually retrieved: the row's own
   * `provenance.collectedAt`, carried verbatim, or the source snapshot's
   * `generatedAt` when that cannot be parsed.
   */
  lastFreshAt: string;
  /**
   * Why this run retained the prior row. Older snapshots lack it; new
   * successful-but-thin responses name `UNEXPLAINED_DISAPPEARANCE`.
   * `OUTSIDE_FETCH_WINDOW` is a held row the read never asked about; it is
   * never a disappearance.
   */
  reason?: "SOURCE_UNAVAILABLE" | "PARTIAL_SCOPE_UNAVAILABLE" | "UNEXPLAINED_DISAPPEARANCE" | "OUTSIDE_FETCH_WINDOW";
}

/**
 * Where a meeting physically happens.
 *
 * `lat`/`lng` are the pin. A meeting with no resolvable coordinates cannot be
 * placed on the map and is dropped by the adapter rather than guessed at.
 */
export interface MeetingLocation {
  /** Human-readable, as printed on the agenda: "City Hall, Council Chambers". */
  name: string;
  /** Street address if the source gives one. */
  address: string | null;
  lat: number;
  lng: number;
}

/**
 * How to attend a meeting that is held online. `label` is the location string
 * exactly as published; `joinUrl` is null when the body published none and is
 * never replaced with a homepage or portal search.
 */
export interface OnlineAccess {
  /** The published location string, verbatim. */
  label: string;
  /** The join link the body published, or null when it published none. */
  joinUrl: string | null;
}

/**
 * A physical meeting whose room we cannot put on the map — a named gap:
 *
 * - `NOT_STATED_BY_PUBLISHER` — the publisher's own page states no venue.
 * - `STATED_NOT_PLACED` — the publisher states `publishedText` verbatim; the
 *   gap is ours (no reviewed coordinates), so it renders as text, never a pin.
 *
 * Set together with `location: null` and never with `online`: the three are
 * mutually exclusive, and `isOnlineOnly` reads this field so a venue gap is
 * never labeled online.
 */
export interface MeetingVenueGap {
  kind: "NOT_STATED_BY_PUBLISHER" | "STATED_NOT_PLACED";
  /** The venue exactly as published, or null when none was. */
  publishedText: string | null;
  /** Whose page this was read from — the name the gap line cites. */
  publisher: string;
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
  /** Source and exact quote for each composed field, when available. */
  fieldSources?: Readonly<Record<string, Provenance>>;
  /** Original partition ids retained so agenda links and evidence can follow a merge. */
  mergedMeetingIds?: readonly string[];
  publicationConflicts?: readonly import("../civic-data/manual-source-isolation.ts").SourceScopedHeldFact[];
  /** Stable within a source. Namespaced by source to stay unique across them. */
  id: string;
  /**
   * The division whose government is meeting. Null when the body is associated
   * with no Census division (a community college district, a special
   * district); such a meeting is local-tier (`tierForMeeting` in
   * `lib/state/derive.ts`).
   */
  ocdId: OcdId | null;
  /**
   * Which body is meeting — the registry id, not the geography. A division can
   * hold many bodies, so body cards filter on this, never on `ocdId`. Adapters
   * take it from the wiring row they are standing in.
   *
   * A meeting with no `bodyId` is shown on the map and in the meeting list,
   * which are division-scoped, and on NO body card.
   */
  bodyId?: string;
  /** The body itself: "Mayor and Council", "Planning Commission". */
  bodyName: string;
  /** What this particular sitting is called: "Regular Session", "Budget Hearing". */
  title: string;
  /** Start time, ISO 8601 with offset. Local government meets in local time. */
  startsAt: string;
  /**
   * How precisely the publisher dated this sitting.
   *
   * `MINUTE` — the source gave a date AND a start time.
   * `DAY` — the source gave a date and no start time. `startsAt` then carries
   *   local midnight as an ordering position, never a claim: nothing renders
   *   it as a time, and calendar links build an all-day event.
   *
   * Absent means `MINUTE`. A source that can emit date-only rows must set it.
   */
  startPrecision?: "MINUTE" | "DAY";
  /** IANA zone the meeting is held in, for rendering times honestly. */
  timeZone: string;
  /**
   * Where the meeting is held — null when there is no building to place.
   * `lib/meetings/online.ts` reads it together with the two fields beside it:
   *
   * - `online` set — the body published a location string that names no place
   *   ("Virtual Meeting", "Microsoft Teams (Virtual)"): held online, no room.
   * - `venueGap` set — a physical meeting whose room is a named gap: the
   *   publisher stated a place we hold no reviewed coordinates for (its words
   *   render as text), or its page states none (see `MeetingVenueGap`).
   * - neither — a verified meeting whose place we have not recorded: our own
   *   named gap, never "online". A missing place never suppresses an otherwise
   *   verified meeting; an adapter that keeps one counts it (`unknownVenue`).
   *
   * `online` and `venueGap` are never both set, and neither is set beside a
   * location. A virtual meeting is never given its body's home coordinates.
   */
  location: MeetingLocation | null;
  /**
   * Present exactly when the meeting is held online. Set together with a null
   * `location` and never with `venueGap`.
   */
  online?: OnlineAccess;
  /**
   * A physical meeting with no placeable room — see `MeetingVenueGap`. Set
   * together with a null `location` and never with `online`.
   */
  venueGap?: MeetingVenueGap;
  /**
   * The kind of sitting in the publisher's own terms — "Joint Committee
   * meeting", "Community engagement session" — where the source states one
   * the title alone does not. Never promoted upward: a committee's sitting is
   * never labeled the governing body's.
   */
  eventType?: string;
  /**
   * End instant, ISO 8601 with offset, when the publisher states one. Absent
   * or null means no end was published — never a default duration.
   */
  endsAt?: string | null;
  /** RSVP, livestream or registration links the publisher gave for this sitting. */
  publishedLinks?: Array<{ label: string; href: string }>;
  /**
   * Link to the published agenda, or null. Null means only that this record
   * carries no agenda link — never that the body posted none.
   */
  agendaUrl: string | null;
  /**
   * The public recording of this sitting, when the publisher's own record links one (Legistar's `EventVideoPath`
   * while `EventVideoStatus` is "Public"). A pointer only, never fetched. Absent is not a claim that no recording
   * exists.
   */
  videoUrl?: string;
  /**
   * The publisher's own stamp of when this sitting's newest posting was made, as an ISO instant, where its feed
   * states one: Legistar's `EventAgendaLastPublishedUTC` or `EventMinutesLastPublishedUTC`, whichever is later;
   * iCalendar's `LAST-MODIFIED`. Never our clock and never `DTSTAMP`, which a feed may restamp on every export.
   * Absent means the feed states none.
   */
  postedAt?: string;
  /**
   * The publisher's own surface had a place for this sitting's agenda and it
   * was empty. Set by the adapter at read time, only when it can say both
   * halves. It is the only basis `observationFromMeetingRecord` accepts for a
   * `THEIRS` publication claim; absent renders the gap as OURS.
   */
  agendaSlotObservedEmpty?: boolean;
  /** Display name of the jurisdiction: "<City>, <ST>". Display only — join on ocdId. */
  jurisdiction: string;
  status: MeetingStatus;
  provenance: Provenance;
  /**
   * Present exactly when this row came out of the previous snapshot because
   * its source refused this run. See `CarriedForward`.
   */
  carried?: CarriedForward;
  /**
   * Which bodies actually acted at this sitting, when the agenda says: a board
   * can sit as another district's board for some items. `ocdId` is the HOST.
   *
   * Absent means nobody read the agenda items; an empty array means they were
   * read and named no acting body. An unresolved heading attributes to
   * NOTHING, never to the host (`lib/meetings/attribution.ts`).
   */
  actingBodies?: MeetingBody[];
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
  /** Exact source-child cancellation domain; never persisted or cached. */
  signal?: AbortSignal;
}

/**
 * What a normalize() pass could not turn into a placed meeting, and why.
 * `placeless` and `unknownVenue` are different facts: "there is nothing to
 * place" versus "we could not place it". `notConfigured` counts feed rows that
 * belong to no wired body.
 */
export interface NormalizeDropCounts {
  /**
   * Meetings whose published location names no physical place. These are KEPT
   * (null `location`, an `online` block) and the ingest prints them as kept;
   * the counter keeps its name so snapshots stay comparable.
   */
  placeless: number;
  unknownVenue: number;
  unplaceableInTime: number;
  notConfigured: number;
}

/**
 * A source that reports its drops alongside its meetings. The composite
 * requires this of every child.
 */
export interface ReportingMeetingSource<Raw = unknown>
  extends MeetingSource<Raw> {
  /**
   * The return is branded: only `accountedNormalize()` in
   * `lib/sources/normalize-account.ts` builds an `Accounted<...>`, and it
   * throws for a non-zero fetch with zero meetings and zero drops.
   */
  normalizeWithDrops(
    raw: Raw[],
    now?: Date,
  ): Accounted<{
    meetings: Meeting[];
    drops: NormalizeDropCounts;
    /**
     * Divisions this source could not reach THIS run while the source as a
     * whole succeeded, so the reader's card names exactly those bodies. A
     * whole-source failure is `ok: false` instead.
     */
    unreachableOcdIds?: string[];
    /**
     * Which SCOPE of a two-feed source failed (e.g. the past-events feed while
     * the upcoming feed answered), for which divisions, and why. Carry-forward
     * preserves that scope and no other; completeness is never inferred from
     * `ok: true`.
     */
    partialScopes?: PartialScopeFailure[];
    /**
     * Duplicates, split by who decided: an EXACT duplicate is the publisher's
     * own (the same `UID` twice in one feed); a WEAK-ID COLLISION is this code
     * judging two records with no publisher identity to be one sitting.
     */
    duplicateIdentity?: DuplicateIdentityCounts;
    /** What the adapter did with recurring series, by body. */
    recurrence?: RecurrenceReport;
  }>;
}

/**
 * What became of each recurring series. An expanded series publishes the
 * sittings its rule states; an unexpanded one publishes only what the feed
 * states one by one, with the reason named. An in-window sitting the publisher
 * struck out (`EXDATE`) is named too.
 */
export interface RecurrenceReport {
  /** Series (per body) whose rule was expanded into its in-window sittings. */
  expandedSeries: number;
  exclusions: PublisherExclusion[];
  notExpanded: SeriesNotExpanded[];
}

export interface PublisherExclusion {
  bodyId: string;
  /** The series' own meeting id, `<source>:<slug>:<UID>`. */
  seriesId: string;
  /** The excluded sitting's recurrence slot (see `occurrenceId`). */
  slot: string;
  /** The id that sitting has, or would have, as an occurrence. */
  meetingId: string;
  /** The publisher's statement, as written (`params:value`). */
  statedBy: string;
}

export interface SeriesNotExpanded {
  bodyId: string;
  /** Null when the refusal is about the whole feed rather than one series. */
  seriesId: string | null;
  reason: "UNSUPPORTED_RULE" | "RULE_RESTATED_ON_PUBLISHED_SITTINGS";
  detail: string;
}

export interface DuplicateIdentityCounts {
  /** The feed published the same publisher identity twice. */
  exact: number;
  /** Two records with no publisher identity that this code judged identical. */
  weakIdCollision: number;
  /**
   * Listings of one sitting the publisher gave different ids to, every
   * published field identical, merged into one (`provenance.publisherListings`).
   * Absent from sources that never merge their own listings.
   */
  publisherRelisted?: number;
}

/** Which half of a two-feed source failed — see `partialScopes`. */
export type SourceScope = "UPCOMING" | "ARCHIVE";

export interface PartialScopeFailure {
  scope: SourceScope;
  /**
   * The divisions affected. A division-less body has nothing to attribute to
   * and appears as `null`, which is honest rather than absent.
   */
  ocdIds: (string | null)[];
  /** What refused, in the terms the retrieval saw it. */
  cause: string;
}

/** The contract every source directory implements. */
export interface MeetingSource<Raw = unknown> {
  /** Stable slug, matching the directory name. */
  readonly name: string;
  /**
   * How far back this source's own retrieval reaches, in days. `null` means
   * the publisher's whole listed archive, with no back clip; omitted means the
   * app's serving window. Carry-forward judges a carried row against this
   * window, not the global constant.
   */
  readonly publishedLookbackDays?: number | null;
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
