/**
 * The shapes every ingestion adapter normalizes into.
 *
 * These are the real interfaces, not mock-shaped conveniences. The mock adapter
 * in lib/sources/mock/ produces exactly these; a Legistar or Democracy Works
 * adapter will produce exactly these too, and nothing downstream changes.
 */

// Type-only, so this stays a one-way dependency at runtime: attribution.ts
// imports `OcdId` from here, and nothing is emitted for either import.
import type { MeetingBody } from "../meetings/attribution.ts";
import type { Accounted } from "./normalize-account.ts";

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
  /**
   * The publisher's own words this record was read from, verbatim — set by an
   * adapter that reads a page's prose or cards rather than a structured feed,
   * so the claim can be checked against its source without re-deriving it.
   */
  evidenceExcerpt?: string;
  /**
   * **THE PUBLISHER'S OWN CALENDAR LISTS THIS ONE SITTING MORE THAN ONCE.**
   * (2026-09-25.)
   *
   * Set by an adapter that merged two or more of one source's own listings of
   * one body's sitting because every field the publisher published about them
   * is identical and only the publisher's own entry ids differ — the Town of
   * Newbury's calendar lists some Selectboard sittings under two series. The
   * record keeps every listing: `sourceIds` names each one's id (this row's
   * included) and `sourceUrls` each one's own page, in the same order, so the
   * merge can be audited against the publisher and reversed. See
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
 * This row was NOT retrieved on the run that wrote the snapshot holding it —
 * it was carried forward from the previous snapshot because its source could
 * not be reached (hotfix-0817, 2026-08-17).
 *
 * **Recorded at write time, never inferred at read time.** Before this, a
 * carried row sat in the same array as a fresh one with nothing to tell them
 * apart: the only per-source count of them (`carriedForward`) could not be
 * reconciled against the rows it counted, and every reader-facing freshness
 * statement — all of which derive from the snapshot's `generatedAt` — claimed
 * a carried row had been checked on the run that never reached it. A count
 * derived from an assumption stops being true the moment the thing it derives
 * from grows a new case, and carry-forward was exactly that new case.
 *
 * Absent is the normal state and means the row was freshly retrieved by the
 * run that wrote the snapshot. No adapter sets this — `carryForward` in
 * `lib/meetings/carry-forward.ts` is the only writer.
 */
export interface CarriedForward {
  /** The source whose refusal is the reason this row was carried. */
  source: string;
  /**
   * Wall-clock instant at which this row was last actually retrieved.
   *
   * The row's own `provenance.collectedAt` — set by the adapter when it read
   * the page — carried verbatim, so a row carried twice keeps naming the run
   * that really fetched it rather than the most recent failure. Never a
   * plausible substitute: a row whose collect time cannot be parsed falls
   * back to the `generatedAt` of the snapshot it is being carried out of,
   * which is a recorded instant too.
   */
  lastFreshAt: string;
  /**
   * Exact reason this run retained the prior row. Older snapshots predate the
   * discriminator; new successful-but-thin responses must name
   * `UNEXPLAINED_DISAPPEARANCE` so they cannot masquerade as fresh.
   * `OUTSIDE_FETCH_WINDOW` is a held row the read never asked about (older or
   * later than the dates it fetched); it is never a disappearance.
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
  /** Human-readable, as printed on the agenda: "Tucson City Hall, Mayor and Council Chambers". */
  name: string;
  /** Street address if the source gives one. */
  address: string | null;
  lat: number;
  lng: number;
}

/**
 * How to attend a meeting that is held online (D18).
 *
 * A meeting with no physical place is REAL, PUBLIC and attendable, and it used
 * to be dropped at normalize because the map could not carry it — twelve of
 * them across one refresh, each a public meeting a reader could have joined
 * and never saw. The map was right and the drop was wrong: the answer is a
 * meeting that exists everywhere the map is not.
 *
 * `label` is the location string EXACTLY as the body published it, because
 * "Virtual Meeting" and "Microsoft Teams (Virtual)" are what the reader will
 * see on the notice and rewriting them helps nobody. `joinUrl` is null far
 * more often than not, and a null is rendered as the gap it is — never
 * replaced with the body's homepage, a portal search, or anything else that
 * would look like a way in and not be one.
 */
export interface OnlineAccess {
  /** The published location string, verbatim. */
  label: string;
  /** The join link the body published, or null when it published none. */
  joinUrl: string | null;
}

/**
 * **A PHYSICAL MEETING WHOSE ROOM WE CANNOT PUT ON THE MAP** — a named gap
 * (2026-09-23, official-page events).
 *
 * `location: null` used to mean exactly one thing: held online, nowhere to go
 * (D18). A district's own page dating a Joint Committee meeting without naming
 * a room is a different fact, and so is a card naming "Cholla High School
 * South Gym" that this pipeline has no reviewed coordinates for. Neither is
 * online, and dropping either hides a public meeting a reader could attend.
 * So the gap is carried, named, with whose gap it is:
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
  /**
   * **WHICH BODY IS MEETING — the registry id, not the geography.**
   * (2026-08-27, the coverage-truth session. Red Control 4's second half.)
   *
   * `ocdId` above used to be documented as "the join key on every Meeting",
   * and a body card filtered `allMeetings` on it. That is only a join where a
   * division holds one body. Measured on the 2026-08-27 snapshot: **10 of the
   * 18 divisions carrying meetings hold more than one body, and 364 of 460
   * meetings would render on a body that did not hold them** — all 80 Tucson
   * sittings on each of 58 appointed commissions, all 29 Newbury sittings on
   * each of 18 town committees, the Pima County Board of Supervisors' agenda
   * on the Central Arizona Water Conservation District's card and back again.
   *
   * The relationship was never missing, only unrecorded: every adapter builds
   * its meetings inside a loop over `SOURCE_WIRING` rows and already writes
   * `ocdId: wiring.ocdId`. The row it is standing in IS the statement "this
   * source serves this body", so the body id travels with the meeting from the
   * same place the division does.
   *
   * **Optional, and a guard names every omission.** Making it required would
   * break every recorded fixture at once; instead
   * `tests/meeting-body-attribution.test.ts` requires every meeting in the
   * committed snapshot to carry one that resolves to a registry body, so a new
   * adapter cannot quietly inherit the old behaviour — it fails, by name.
   *
   * A meeting with no `bodyId` is shown on the map and in the meeting list,
   * which are division-scoped and correct there. It is shown on NO body card,
   * because a card that shows it would be claiming this body met.
   */
  bodyId?: string;
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
  /**
   * Where the meeting is held — **null when there is no building to place**
   * (D18; three readings since 2026-09-23).
   *
   * Null is a real, load-bearing value, and `lib/meetings/online.ts` is the one
   * place that reads it, together with the two fields beside it:
   *
   * - `online` set — the body published a location string that names no place
   *   ("Virtual Meeting", "Microsoft Teams (Virtual)"): held online, no room.
   * - `venueGap` set — a physical meeting whose room is a named gap: the
   *   publisher stated a place we hold no reviewed coordinates for (its words
   *   render as text), or its page states none (see `MeetingVenueGap`).
   * - neither — a verified meeting whose place we have not recorded: our own
   *   named gap, never "online". A missing place never suppresses an otherwise
   *   verified meeting (the owner's directive, 2026-09-23); an adapter that
   *   keeps one still counts it (`unknownVenue`, as Diligent does) so the gap
   *   stays visible to the venue hunt.
   *
   * `online` and `venueGap` are never both set, and neither is set beside a
   * location. It is deliberately nullable rather than faked. Giving a virtual meeting
   * its body's home coordinates would put a pin on a building nobody is going
   * to, which is the same class of invention as a constructed agenda URL.
   */
  location: MeetingLocation | null;
  /**
   * Present exactly when the meeting is held online (D18). Set together with
   * a null `location` and never with `venueGap`; see the `location` note.
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
   * Link to the published agenda, or null.
   *
   * **NULL IS A FACT ABOUT US, NOT ABOUT THE BODY.** The comment here used to
   * read "null when the body hasn't posted one yet", and that sentence is the
   * conflation ASK-18 and SWEEP-01 are about: a null here means only that this
   * record carries no agenda link. It could be a clerk who has not posted, an
   * adapter that never looked, a feed with no agenda field at all, or a body
   * that posts packets on a page its calendar never links. Those are four
   * different facts and `agendaUrl === null` cannot tell them apart.
   */
  agendaUrl: string | null;
  /**
   * The public recording of this sitting, when the publisher's own record links one (BX-10): Legistar's
   * `EventVideoPath` while `EventVideoStatus` is "Public". A pointer only, shown on a concluded meeting's card and
   * never fetched. Absent means the publisher gave none, which is not a claim that no recording exists.
   */
  videoUrl?: string;
  /**
   * **THE PUBLISHER'S OWN SURFACE CARRIED AN AGENDA SLOT AND IT WAS EMPTY.**
   * (Session B resume, W2 — ASK-18 / SWEEP-01, 2026-08-31.)
   *
   * Set by the ADAPTER, at the moment of the read, and only when the adapter
   * can say both halves: that the surface it read HAS a place where this
   * sitting's agenda would appear, and that the place was empty. Absent means
   * the adapter did not measure it — which is never the same as the publisher
   * having posted nothing.
   *
   * It is the ONLY thing `observationFromMeetingRecord` will accept as the
   * basis for a `THEIRS` publication claim, and it is deliberately not
   * derivable from anything else on this record. An adapter that cannot
   * distinguish "no slot" from "empty slot" leaves it absent and the surface
   * renders the gap as OURS, which is the honest reading.
   */
  agendaSlotObservedEmpty?: boolean;
  /** Display name of the jurisdiction: "Tucson, AZ". Display only — join on ocdId. */
  jurisdiction: string;
  status: MeetingStatus;
  provenance: Provenance;
  /**
   * Present exactly when this row came out of the previous snapshot because
   * its source refused this run (hotfix-0817). See `CarriedForward` — and note that
   * nothing about a carried row may render a freshness it does not have.
   */
  carried?: CarriedForward;
  /**
   * Which bodies actually acted at this sitting, when the agenda says (D19).
   *
   * `ocdId` above is the HOST — the body whose calendar this is — and it is a
   * single field that cannot express "the county board sat as the library
   * district's board for these nineteen items". Pima County does exactly that,
   * twice on one agenda, so the join rides on the meeting: many rows, each
   * naming the heading it was read from.
   *
   * **Absent is not empty.** An absent field means nobody looked at this
   * meeting's agenda items — most sources do not publish them and the adapter
   * did not ask. An empty array would mean the agenda was read and named no
   * acting body, which is a different fact, and collapsing the two is the
   * render-default failure one layer down.
   *
   * The rule the rows are built under, restated here because this is where a
   * later reader meets them: **an unresolved heading attributes to NOTHING,
   * never to the host.** `lib/meetings/attribution.ts` builds them and
   * `lib/meetings/snapshot.ts` refuses a snapshot that breaks it.
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
 *
 * Counted, never silent. `placeless` and `unknownVenue` are different facts
 * (D18): "there is nothing to place" versus "we could not place it".
 * `notConfigured` counts rows a feed carried that belong to no wired body —
 * a township calendar's yard sale, a district's parent-teacher night — which
 * are dropped by configuration rather than by failure.
 */
export interface NormalizeDropCounts {
  /**
   * Meetings whose published location names no physical place.
   *
   * **These are no longer dropped (D18, 2026-08-17).** They are kept, with a
   * null `location` and an `online` block, and they render in the list
   * overlay and never as a pin. The counter stays under this name because it
   * counts exactly the same quantity it always counted, so the number remains
   * comparable across every snapshot ever written — and because zeroing it
   * would make a real, growing category of public meeting read as absent,
   * which is the failure this row was opened about in the first place. The
   * ingest prints it as kept, not as dropped.
   */
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
  /**
   * **The return is BRANDED** (RULING 43, 2026-08-20). `Accounted<...>` carries
   * a `unique symbol` that only `accountedNormalize()` in
   * `lib/sources/normalize-account.ts` attaches, and that factory throws rather
   * than returning a value for a non-zero fetch with zero meetings and zero
   * drops. A plain object literal here no longer compiles. See that module for
   * why the sixth sighting of the shape had to be closed in the type rather
   * than in a sixth written rule.
   */
  normalizeWithDrops(
    raw: Raw[],
    now?: Date,
  ): Accounted<{
    meetings: Meeting[];
    drops: NormalizeDropCounts;
    /**
     * Divisions this source could not reach THIS run, when the source as a
     * whole still succeeded (g3, 2026-08-16).
     *
     * A source that serves several bodies across several hosts can be
     * partially refused, and the two halves must not be reported as one. A
     * whole-source failure is `ok: false` and already attributes to every
     * body the source serves; this is the narrower claim — "these particular
     * divisions refused us, the rest of this source is fine" — so the
     * reader's card names exactly the bodies with a gap of ours behind them,
     * and no body with a working calendar is smeared with a failure it did
     * not have.
     *
     * Optional: a single-body adapter has nothing to say here, and `ok: false`
     * remains the right report for it.
     */
    unreachableOcdIds?: string[];
    /**
     * **A PARTIAL SOURCE IS A FIRST-CLASS RESULT** — A-004 (external
     * correctness audit of `336a3eb`, remediated 2026-08-24).
     *
     * `unreachableOcdIds` above says WHICH divisions were refused. It cannot
     * say WHAT ABOUT THEM was refused, and that turned out to matter.
     *
     * `ical` fetches two feeds per row: the upcoming list and, where the town
     * publishes one, the past-events feed. The archive's failure was caught
     * and swallowed with a comment saying the absence would be "visible as a
     * jurisdiction with no concluded meetings" — which is the render-default
     * failure written down as a design note. The adapter reported success, so
     * carry-forward (which only preserves rows for a source or division that
     * FAILED) preserved nothing, and every concluded meeting the previous
     * snapshot held for that town was deleted by an archive outage.
     *
     * Marking the whole division unreachable would be worse in the other
     * direction: the upcoming feed answered perfectly, and carrying its rows
     * forward would resurrect a sitting the town had just cancelled.
     *
     * So the result says which SCOPE failed, for which divisions, and why —
     * and carry-forward preserves that scope and no other. Completeness is
     * never inferred from `ok: true`.
     */
    partialScopes?: PartialScopeFailure[];
    /**
     * **A-005 · duplicates, split by WHO decided they were duplicates.**
     *
     * An EXACT duplicate is the publisher's own statement: the same `UID`
     * twice in one feed. A WEAK-ID COLLISION is this code judging two records
     * with no publisher identity to be the same sitting.
     *
     * Pooling them would hide the second inside the first, and the second is
     * the one worth watching — it starting to fire is evidence that a town's
     * feed publishes two genuinely different sittings our fallback identity
     * cannot tell apart. Before A-005 neither was counted at all: the fallback
     * identity was the START INSTANT ALONE, and two boards meeting at 7pm on
     * the same night collapsed into one meeting silently.
     */
    duplicateIdentity?: DuplicateIdentityCounts;
    /** What the adapter did with recurring series, by body (2026-09-23, `ical`). */
    recurrence?: RecurrenceReport;
  }>;
}

/**
 * **WHAT BECAME OF EACH RECURRING SERIES** (2026-09-23).
 *
 * A series whose rule is expanded publishes the sittings its rule states. One
 * that is not expanded publishes only what the feed states one by one, and
 * the reason is named here rather than left for a reader to infer from a
 * short calendar. An in-window sitting the publisher itself struck out
 * (`EXDATE`) is named too, because it is the one authority on which a sitting
 * that was published may be taken down.
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

/**
 * The contract every source directory implements.
 *
 * Adding a source means adding a directory that exports one of these. It never
 * means editing shared ingestion logic.
 */
export interface MeetingSource<Raw = unknown> {
  /** Stable slug, matching the directory name. */
  readonly name: string;
  /**
   * How far back this source's own retrieval actually reaches, in days
   * (g13, 2026-08-18). `null` means "the publisher's whole listed archive,
   * with no back clip"; omitted means the app's serving window.
   *
   * ## Why a source has to say this out loud
   *
   * `lib/meetings/carry-forward.ts` carries a failed source's last known rows
   * "clipped to the same serving window a fresh normalize applies", and until
   * now that clip was one global constant — `CONCLUDED_LOOKBACK_DAYS`. That is
   * true of every adapter that clips to the window itself (schedulepage, iqm2,
   * clerksboards all pass it to their own fetch), and it was FALSE of revize,
   * whose M59 archive rung emits every dated document on the notices page and
   * applies no back clip at all.
   *
   * So on 2026-08-18 a 403 to the CI runner carried 8 of Merrimack County's
   * 14 archive sittings forward and dropped the other 6 — the refresh
   * corollary's own defect, in miniature, inside the code written to prevent
   * it. A failed fetch partially emptied a previously-full surface, and the
   * count line said "8 carried" with nothing to compare it against.
   *
   * The window a carried row is judged against is therefore the window the
   * SOURCE produces, declared here, rather than a constant that happens to be
   * right for most of them.
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
