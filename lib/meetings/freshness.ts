/**
 * Client-safe shapes for the snapshot freshness surface.
 *
 * `lib/meetings/snapshot.ts` owns the file and imports `node:fs`, so client
 * components must not touch it; these are the types the API route serializes
 * for them. A stale snapshot rendering as though it were current is the
 * silent-fallback failure this project has recorded twice (the raster
 * basemap, the vector tiles) — the freshness line is what keeps it loud.
 */

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
  generatedAt: string;
  sources: Array<{ source: string; ok: boolean; error: string | null }>;
  failed: SnapshotFailureNote[];
  /** Present only when the snapshot holds rows this run did not retrieve. */
  carried?: SnapshotCarriedNote;
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
  /** "couldn't reach schedulepage, ical — some calendars may be missing"; null when every source was reached. */
  unreachable: string | null;
  /** The carried-rows sentence; null when the snapshot carries no rows. */
  carried: CarriedListingsDisclosure | null;
}

/** Everything the footer must say beyond the snapshot's own age, given what the route served. */
export function freshnessDisclosure(status: Pick<SnapshotStatus, "failed" | "carried">): FreshnessDisclosure {
  return {
    unreachable:
      status.failed.length > 0
        ? `couldn't reach ${status.failed.map((f) => f.source).join(", ")} — some calendars may be missing`
        : null,
    carried: status.carried && status.carried.count > 0 ? carriedListingsDisclosure(status.carried) : null,
  };
}
