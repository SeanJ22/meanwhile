import type { OcdId, Provenance } from "../sources/types.ts";

/** Officeholders: every field traces to a record somebody published. */

/** What kind of seat this is. Not a rank, and never ordered by it. */
export type OfficeLevel = "FEDERAL" | "STATE" | "LOCAL";

/** A portrait and the licence that decides whether it may be shown; served from our own origin, never hotlinked. */
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
  verification?: import("../photos/evidence.ts").PortraitVerification;
}

/** An upstream image is a lead until identity, licence and stored bytes check out. */
export interface PortraitCandidate {
  readonly imageUrl: string;
  readonly sourceUrl: string;
  readonly collectedAt: string;
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
  /** ISO birth date where an authoritative source publishes one; stored as a date, never an age. */
  birthDate: string | null;
  /** Display only: never used to infer a position, a vote, or anything about a district. */
  partyLabel: string | null;
  /** The officeholder's official site. */
  websiteUrl: string | null;
  /** Official contact form, where one is published. */
  contactFormUrl: string | null;
  phone: string | null;
  /** Published official email, where the source publishes one. */
  email: string | null;
  /** The campaign or personal site, distinct from the official page and always labelled as such. */
  campaignUrl: string | null;
  photo: OfficeholderPhoto | null;
  portraitCandidate?: PortraitCandidate;
  /** The member's social accounts, each with its kind, source page and collection time. Only what is held renders. */
  social?: SocialAccounts;
  /** The state and chamber the member's own current term states (item 7). */
  state?: string;
  chamber?: string;
  provenance: Provenance;
}

/** The channels the congress-legislators directory carries, under the source's own field names (`twitter` renders as X). */
export interface DirectorySocial {
  twitter?: string;
  facebook?: string;
  youtube?: string;
  youtubeId?: string;
  instagram?: string;
  mastodon?: string;
}

/** Whose account it is: the office's own, the campaign's, or a person's public personal page. */
export type AccountKind = "OFFICIAL" | "CAMPAIGN" | "PERSONAL_PUBLIC";

/** One social account, with the page it was read from and when. */
export interface SocialAccount {
  /** The id of a platform in the social platform list. */
  platform: string;
  url: string;
  accountKind: AccountKind;
  sourceUrl: string;
  collectedAt: string;
}

/** What a stored record holds: the directory's own fields, or the list of accounts. */
export type SocialAccounts = DirectorySocial | readonly SocialAccount[];

/** Which divisions a person represents: a many-to-many join, never a column. */
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
  /** Seats the source described that could not be attached to a division, with the reason; reported, never dropped. */
  unmatched: { officeholderId: string; reason: string }[];
}

/** The contract an officials adapter implements. */
export interface OfficialSource<Raw = unknown> {
  readonly name: string;
  /** The only step allowed to touch the network. */
  fetch(): Promise<Raw[]>;
  /** Pure. Drops nothing silently; anything unattachable lands in `unmatched`. */
  normalize(raw: Raw[], collectedAt: string): OfficeholderSet;
  upsert(set: OfficeholderSet): Promise<{ inserted: number; updated: number }>;
}
