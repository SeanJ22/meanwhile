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
  /**
   * Where the meeting is held — **null when it is held nowhere** (D18).
   *
   * Null is a real, load-bearing value and not a missing one: the body
   * published a location string that names no place ("Virtual Meeting",
   * "Microsoft Teams (Virtual)"), so there is no building, no address and no
   * coordinates to have. `online` carries what there IS instead, and the two
   * fields are required to agree — a null location with no `online` is a
   * meeting nobody can attend and nothing may write one.
   *
   * It is deliberately nullable rather than faked. Giving a virtual meeting
   * its body's home coordinates would put a pin on a building nobody is going
   * to, which is the same class of invention as a constructed agenda URL.
   */
  location: MeetingLocation | null;
  /**
   * Present exactly when the meeting is held online (D18). Set together with
   * a null `location`; see both notes.
   */
  online?: OnlineAccess;
  /** Link to the published agenda. Null when the body hasn't posted one yet. */
  agendaUrl: string | null;
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
  normalizeWithDrops(
    raw: Raw[],
    now?: Date,
  ): {
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
  };
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
