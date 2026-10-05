/**
 * Client-safe shapes for the snapshot freshness surface.
 *
 * `lib/meetings/snapshot.ts` owns the file and imports `node:fs`, so client
 * components must not touch it; these are the types the API route serializes
 * for them. A stale snapshot rendering as though it were current is the
 * silent-fallback failure this project has recorded twice (the raster
 * basemap, the vector tiles) — the freshness line is what keeps it loud.
 */

import type { CarriedForward } from "../sources/types.ts";

export interface SnapshotFailureNote {
  source: string;
  /** Divisions whose calendars this source serves — the bodies now dark. */
  ocdIds: string[];
}

/**
 * The rows in the snapshot that the run behind it never retrieved (hotfix-0817).
 *
 * `generatedAt` is the age of the FILE. It is true of the rows this run
 * fetched and false of the rows carried out of the previous snapshot because
 * a source refused — and the footer stated it for all of them, which is a
 * render default manufacturing a claim: "last checked 6 hours ago" about a
 * Kearsarge sitting nobody has been able to reach for a day.
 */
export interface SnapshotCarriedNote {
  count: number;
  /**
   * When those rows were last actually fetched — non-null only when they all
   * agree on one day. Null renders as its own sentence, never as a date
   * picked from among several.
   */
  lastFreshAt: string | null;
}

export interface SnapshotStatus {
  /**
   * Wire-format version (D.4, 2026-09-14). Absent on payloads cached before the
   * trim; a later shape change bumps it rather than being guessed from shape.
   */
  version?: number;
  generatedAt: string;
  /**
   * The per-(adapter × body) source rows. No reader surface reads these, so as
   * of 2026-09-14 the API no longer ships them — the 124-row block was ~40-50 KB
   * of every meetings response. Kept optional for payloads cached before the
   * trim and for the proof fixtures that still construct a full status.
   */
  sources?: Array<{ source: string; ok: boolean; error: string | null }>;
  failed: SnapshotFailureNote[];
  /** Present only when the snapshot holds rows this run did not retrieve. */
  carried?: SnapshotCarriedNote;
}

/**
 * The snapshot as it bears on what the reader has IN VIEW.
 *
 * `snapshot.carried` counts every row the refresh carried forward, anywhere in
 * the country, so 10001 said "2 calendar listings are older than that" under a
 * map with no listings at all. The note describes the listings on screen: the
 * count is of the carried rows among `meetings`, the shared date is theirs, and
 * with none in view the sentence is not said.
 */
export function snapshotInView(
  snapshot: SnapshotStatus | null | undefined,
  meetings: ReadonlyArray<{ carried?: { lastFreshAt: string } }>,
): SnapshotStatus | null {
  if (!snapshot) return null;
  if (!snapshot.carried) return snapshot;
  const carried = meetings.flatMap((m) => (m.carried ? [m.carried.lastFreshAt] : []));
  if (carried.length === 0) {
    const { carried: _wholeSnapshotNote, ...rest } = snapshot;
    void _wholeSnapshotNote;
    return rest;
  }
  const days = new Set(carried.map((at) => at.slice(0, 10)));
  return {
    ...snapshot,
    carried: { count: carried.length, lastFreshAt: days.size === 1 ? carried[0] : null },
  };
}

/** "3 minutes ago" / "2 hours ago" / "4 days ago", coarse on purpose. */
export function relativeAge(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/*
 * THE FOOTER'S DISCLOSURE, AS ONE CONTRACT (RLC-1, 2026-09-05).
 *
 * `components/map/data-freshness.tsx` renders these sentences, and the final
 * rendered Reader proof (`scripts/reader-last-mile-final-render.mts`, through
 * `scripts/lib/reader-freshness-disclosure.ts`) requires them — both from the
 * functions below, neither from a copy. Refresh run #25 refused two genuine
 * holding changes because the proof kept its own sentence, "we last reached
 * them", while the refreshed snapshot's carried rows disagreed on a day and
 * the footer rightly said "each one says when we last reached it". A proof
 * that owns a second copy of reader prose is stale the day the prose moves;
 * this is the only copy, and the proof follows it.
 */

/** Which carried-rows sentence the rows support. */
export type CarriedListingsForm = "REACHED_TOGETHER" | "EACH_ON_ITS_OWN";

export interface CarriedListingsDisclosure {
  /** How many rows this refresh carried forward rather than fetched. */
  count: number;
  /** "74 calendar listings are older than that:" / "1 calendar listing is older than that:" */
  lead: string;
  form: CarriedListingsForm;
  /**
   * REACHED_TOGETHER: "we last reached them" — the footer appends the relative
   * age of `lastFreshAt` as a `<time>`. EACH_ON_ITS_OWN: "each one says when we
   * last reached it" — no single date is true of every carried row.
   */
  reached: string;
  /** The one instant true of every carried row; null when no single date is. */
  lastFreshAt: string | null;
}

/** The sentence a form renders after the lead, for this many carried rows. */
export function carriedListingsSentence(form: CarriedListingsForm, count: number): string {
  return form === "REACHED_TOGETHER"
    ? `we last reached ${count === 1 ? "it" : "them"}`
    : "each one says when we last reached it";
}

export function carriedListingsDisclosure(carried: SnapshotCarriedNote): CarriedListingsDisclosure {
  const form: CarriedListingsForm = carried.lastFreshAt ? "REACHED_TOGETHER" : "EACH_ON_ITS_OWN";
  return {
    count: carried.count,
    lead: `${carried.count === 1 ? "1 calendar listing is" : `${carried.count} calendar listings are`} older than that:`,
    form,
    reached: carriedListingsSentence(form, carried.count),
    lastFreshAt: carried.lastFreshAt,
  };
}

export interface FreshnessDisclosure {
  /** The carried-rows sentence; null when the snapshot carries no rows. */
  carried: CarriedListingsDisclosure | null;
}

/*
 * Everything the footer must say beyond the snapshot's own age (RLC-1). As of
 * 2026-09-14 the footer NO LONGER lists which sources were unreachable. That
 * line joined raw partition/adapter ids — "couldn't reach clerksboards,
 * clerksboards, … ical, ical … schedulepage" — unscoped to the reader's area:
 * an internal id on a reader surface (RULING 258) and a verdict on ourselves
 * (RULING 254), for a board that in most cases simply lists nothing. Per-body
 * attribution now lives on each body's own row in the who-governs card, in
 * plain language and scoped to the reader. The footer keeps only its age and
 * the carried-rows sentence.
 */
export function freshnessDisclosure(status: Pick<SnapshotStatus, "carried">): FreshnessDisclosure {
  return {
    carried: status.carried && status.carried.count > 0 ? carriedListingsDisclosure(status.carried) : null,
  };
}

/*
 * THE CARRIED ROW'S OWN REASON, AS ONE CONTRACT (2026-09-23).
 *
 * A carried row says "Last reached <when>" on the venue card and in the popup,
 * and both surfaces used to follow it with one fixed sentence: our latest check
 * could not reach this calendar. That was true of the only writer there was
 * when it was written (hotfix-0817, a source that refused the run). The
 * permanent data plane (2026-09-10) added a second writer and a second reason:
 * a partition whose calendar ANSWERED, with authenticated and hashed bytes, but
 * whose answer no longer held a listing the last one did, is retained as
 * `UNEXPLAINED_DISAPPEARANCE` (`reconcileSuccessfulMeetingPartition` in
 * `scripts/ingest.ts`). On 2026-09-23 that was every carried row production
 * held, 12 of 12, and each told the reader that a calendar we had just read
 * was one we could not reach.
 *
 * So the clause is chosen here, once, from the reason recorded at write time,
 * and both surfaces render what this returns. Three reasons, three facts:
 *
 * - `SOURCE_UNAVAILABLE`: the calendar refused or failed the run.
 * - `PARTIAL_SCOPE_UNAVAILABLE`: part of it answered and part of it did not.
 * - `UNEXPLAINED_DISAPPEARANCE`: it answered, and the answer did not hold this
 *   LISTING. The clause is about our check and about the listing, and neither
 *   word is an accident. A response is an open fact set, and "unexplained" is
 *   the writer saying it does not know why. Some of these listings left the
 *   body's own list (Tucson Unified's 16 September audit committee, absent
 *   since 8 September). Others aged off a feed that lists only what is
 *   upcoming: Rockaway Township's 22 September council sitting left the
 *   township's upcoming-only feed the morning after it met, and the SAME check
 *   read the same sitting fresh from the township's agenda archive, a second
 *   listing that renders beside the carried one (a date without a time, so
 *   the Reader's same-instant merge does not join them). "This calendar no
 *   longer lists this sitting" would be false there, a claim about a
 *   government; so would "our check didn't find this meeting". What is true of
 *   every such row is that this listing was not in the answer.
 *
 * A missing or unrecognised reason renders NO clause: the date stands alone,
 * and it is true on its own. Marks older than the discriminator come from
 * `lib/meetings/carry-forward.ts`, which records no reason, and its three
 * conditions are not one fact. A whole-source failure and an unreachable
 * division are refusals, but a refused archive feed (A-004) is a partial read
 * of a calendar whose upcoming feed answered. Nothing on such a row says which,
 * so nothing is chosen for it: the `calendarLabel` rule in `source-labels.ts`,
 * where an unknown gets null and never a plausible phrase.
 *
 * `CarriedForward`'s doc in `lib/sources/types.ts` predates the second writer
 * and speaks of every carried row as a refusal; read this block for what each
 * value means to a reader. The union itself is derived from that type, never
 * restated, so this contract cannot drift from the writers.
 */

/** The reasons a writer records, read off `CarriedForward` rather than retyped. */
export type CarriedReason = NonNullable<CarriedForward["reason"]>;

/** The clause each recorded carry reason earns. Plain words; never the enum value. */
export const CARRIED_ROW_CLAUSE: Readonly<Record<CarriedReason, string>> = {
  SOURCE_UNAVAILABLE: "our latest check couldn't reach this calendar",
  PARTIAL_SCOPE_UNAVAILABLE: "our latest check couldn't read all of this calendar",
  UNEXPLAINED_DISAPPEARANCE: "our latest check of this calendar didn't find this listing",
  OUTSIDE_FETCH_WINDOW: "our latest check covered nearer dates than this one",
};

/**
 * What a carried row says after "Last reached <when>", or null.
 *
 * Null for a row that is not carried, for a mark older than the discriminator,
 * and for any value this contract does not name, including one that happens to
 * share a name with an object property. The argument is typed loosely because
 * it arrives over the wire, where nothing guarantees the union.
 */
export function carriedRowClause(
  carried: { readonly reason?: unknown } | null | undefined,
): string | null {
  const reason = carried?.reason;
  if (typeof reason !== "string") return null;
  return Object.prototype.hasOwnProperty.call(CARRIED_ROW_CLAUSE, reason)
    ? CARRIED_ROW_CLAUSE[reason as CarriedReason]
    : null;
}

/**
 * **WHEN EACH DIVISION'S CALENDAR WAS LAST READ, FROM THE ROWS ON SCREEN.**
 * (2026-09-24.)
 *
 * The footer's "Last checked" is the newest read of ANY partition in the
 * corpus, so it read "minutes ago" to a reader at 85701 while the Pima County
 * Board's calendar had not been read since September 8 — a regenerated
 * response is not refreshed evidence. This is the per-division fact.
 *
 * A division read by two routes can be current on one and weeks old on the
 * other. At 85701 the Board's API route was read at 11:14Z and carried no
 * upcoming sitting, while every upcoming sitting shown came from the portal's
 * September 8 read. So the upcoming listings are dated by the OLDEST read
 * among them. Only a division with nothing upcoming on screen is dated by its
 * newest read of any listing.
 */
export interface DivisionRead {
  readonly at: string;
  /** True when {@link at} dates the division's upcoming listings. */
  readonly upcoming: boolean;
}

export function lastReadByDivision(
  meetings: readonly {
    readonly ocdId: string | null;
    readonly startsAt?: string | null;
    readonly provenance?: { readonly collectedAt?: string | null } | null;
  }[],
  now: number = Date.now(),
): Record<string, DivisionRead> {
  const newest: Record<string, string> = {};
  const oldestUpcoming: Record<string, string> = {};
  for (const meeting of meetings) {
    const at = meeting.provenance?.collectedAt ?? null;
    if (!meeting.ocdId || !at || !Number.isFinite(Date.parse(at))) continue;
    if (!newest[meeting.ocdId] || at > newest[meeting.ocdId]!) newest[meeting.ocdId] = at;
    const starts = meeting.startsAt ? Date.parse(meeting.startsAt) : Number.NaN;
    if (Number.isFinite(starts) && starts >= now && (!oldestUpcoming[meeting.ocdId] || at < oldestUpcoming[meeting.ocdId]!)) {
      oldestUpcoming[meeting.ocdId] = at;
    }
  }
  const out: Record<string, DivisionRead> = {};
  for (const [ocdId, at] of Object.entries(newest)) {
    out[ocdId] = oldestUpcoming[ocdId] ? { at: oldestUpcoming[ocdId]!, upcoming: true } : { at, upcoming: false };
  }
  return out;
}

/** A division's calendar read older than this is dated on the card. */
export const DIVISION_READ_STALE_MS = 36 * 3_600_000;

/** The read to date on the card, or null while it is recent. */
export function staleDivisionRead(read: DivisionRead | undefined, now: number = Date.now()): DivisionRead | null {
  if (!read) return null;
  const at = Date.parse(read.at);
  return Number.isFinite(at) && now - at > DIVISION_READ_STALE_MS ? read : null;
}
