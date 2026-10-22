import type { CarriedForward } from "../sources/types.ts";

export interface SnapshotFailureNote {
  source: string;
  /** Divisions whose calendars this source serves — the bodies now dark. */
  ocdIds: string[];
}

export interface SnapshotCarriedNote {
  count: number;
  /** Non-null only when every carried row agrees on one day; null renders as its own sentence. */
  lastFreshAt: string | null;
}

export interface SnapshotStatus {
  /** Wire-format version; a later shape change bumps it rather than being guessed from shape. */
  version?: number;
  generatedAt: string;
  /** No reader surface reads these, and the API no longer ships them. */
  sources?: Array<{ source: string; ok: boolean; error: string | null }>;
  failed: SnapshotFailureNote[];
  /** Present only when the snapshot holds rows this run did not retrieve. */
  carried?: SnapshotCarriedNote;
}

/**
 * The snapshot when it names a real day, else null. A place with no held calendar
 * has no "Checked" date to show, and a zero or unreadable date is never one.
 */
export function heldSnapshot<T extends { generatedAt: string }>(snapshot: T | null | undefined): T | null {
  if (!snapshot) return null;
  return Date.parse(snapshot.generatedAt) > 0 ? snapshot : null;
}

/** The snapshot as the meetings API sends it; null when the place holds no calendar. */
export function wireSnapshot(
  heldAt: string | null,
  sources: ReadonlyArray<{ source: string; ok: boolean; unreachableOcdIds?: string[] }>,
): (SnapshotStatus & { version: 2 }) | null {
  if (!heldAt) return null;
  return {
    version: 2,
    generatedAt: heldAt,
    failed: sources.filter((source) => !source.ok)
      .map((source) => ({ source: source.source, ocdIds: source.unreachableOcdIds ?? [] })),
  };
}

/** The snapshot as it bears on the listings in view: carried rows among `meetings`, not across the corpus. */
export function snapshotInView(
  snapshot: SnapshotStatus | null | undefined,
  meetings: ReadonlyArray<{ carried?: { lastFreshAt: string } }>,
): SnapshotStatus | null {
  if (!snapshot || !heldSnapshot(snapshot)) return null;
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

export function freshnessDisclosure(status: Pick<SnapshotStatus, "carried">): FreshnessDisclosure {
  return {
    carried: status.carried && status.carried.count > 0 ? carriedListingsDisclosure(status.carried) : null,
  };
}

/*
 * The clause after "Last reached <when>" comes from the reason recorded at write time. `UNEXPLAINED_DISAPPEARANCE`
 * means the calendar answered and the answer did not hold this listing: neither a refusal nor a claim that the body
 * stopped listing it. A missing or unrecognised reason renders no clause.
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

/** What a carried row says after "Last reached <when>", or null. Typed loosely because it arrives over the wire. */
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
 * When each division's calendar was last read, from the rows on screen. Upcoming listings are dated by the oldest read
 * among them; a division with nothing upcoming on screen is dated by its newest read of any listing.
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
