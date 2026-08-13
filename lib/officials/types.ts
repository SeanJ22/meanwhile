import type { OcdId, Provenance } from "../sources/types.ts";

/**
 * Officeholders — the people currently holding a seat.
 *
 * Separate from `lib/registry/` because a division and a body are structural
 * claims that can be *derived* from geometry, and a person never can. Every
 * field here traces to a record somebody published; `CLAUDE.md` line 17 forbids
 * rendering an attribution without one, and a name on a district line with
 * nothing behind it is exactly the failure that rule exists to catch.
 *
 * Like the registry, this ships as generated JSON rather than database rows.
 * Nothing at runtime reads Postgres, and officials do not change that — the
 * first source that needs *writes* is meetings, not people.
 */

/** What kind of seat this is. Not a rank, and never ordered by it. */
export type OfficeLevel = "FEDERAL" | "STATE" | "LOCAL";

/**
 * A portrait, with the licence that decides whether it may be shown.
 *
 * Images are downloaded at build time and served from our own origin, never
 * hotlinked: rendering `<img src="https://azleg.gov/...">` makes the reader's
 * browser announce itself to a state legislature, which is a leak the reader
 * did not agree to and cannot see.
 *
 * `license: null` means unknown, which is **not clearable** — such a photo is
 * recorded and not shipped. No photo is fine; initials render instead. A wrong
 * face on an elected official is the visual form of a fabricated agenda URL.
 */
export interface OfficeholderPhoto {
  /** Path on our origin, e.g. `/officials/az-cd-6.jpg`. */
  url: string;
  /** Where the image was fetched from. */
  sourceUrl: string;
  /** Required attribution text, where the source states one. */
  attribution: string | null;
  /** Null means unknown, and unknown means do not ship it. */
  license: string | null;
  collectedAt: string;
}

export interface Officeholder {
  /** Namespaced by source: `congress:A000370`. */
  id: string;
  /** As the source publishes it. Never reformatted or reconstructed. */
  name: string;
  /** "U.S. Senator", "U.S. Representative". */
  officeTitle: string;
  level: OfficeLevel;
  /** ISO date the current term began. */
  termStart: string;
  /** ISO date it ends. */
  termEnd: string;
  /**
   * **Display only.** Never used to infer a position, a vote, or anything
   * about a district. `CLAUDE.md` forbids inferring from party affiliation,
   * and this field existing is the most likely place that rule gets broken.
   */
  partyLabel: string | null;
  /** The officeholder's official site. */
  websiteUrl: string | null;
  /** Official contact form, where one is published. */
  contactFormUrl: string | null;
  phone: string | null;
  photo: OfficeholderPhoto | null;
  provenance: Provenance;
}

/**
 * Which divisions a person represents. **A join, never a column.**
 *
 * One seat can cover several divisions and one division can elect several
 * people: Arizona's legislative districts each elect one senator and *two*
 * representatives, so the relationship is many-to-many from the very first row.
 * A `divisionOcdId` column on the officeholder would break on Arizona
 * immediately.
 */
export interface OfficeholderDivision {
  officeholderId: string;
  ocdId: OcdId;
  /** Set where the seat belongs to a specific body rather than a district. */
  bodyId: string | null;
}

/** What a generated officeholder file holds. */
export interface OfficeholderSet {
  /** Which slice this is: `us` for the federal roster, or a state FIPS. */
  scope: string;
  generatedAt: string;
  officeholders: Officeholder[];
  divisions: OfficeholderDivision[];
  /**
   * Seats the source described that could not be attached to a division in the
   * registry, with the reason. **Reported, never dropped silently** — an
   * unmatched seat is a real person the reader will not see, and it needs to be
   * visible as a number rather than discovered later as an absence.
   */
  unmatched: { officeholderId: string; reason: string }[];
}

/**
 * The contract an officials adapter implements — the same three verbs as a
 * meeting source, so adding one is still adding a directory.
 */
export interface OfficialSource<Raw = unknown> {
  readonly name: string;
  /** The only step allowed to touch the network. */
  fetch(): Promise<Raw[]>;
  /** Pure. Drops nothing silently; anything unattachable lands in `unmatched`. */
  normalize(raw: Raw[], collectedAt: string): OfficeholderSet;
  upsert(set: OfficeholderSet): Promise<{ inserted: number; updated: number }>;
}
