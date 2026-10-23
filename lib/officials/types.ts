import type { OcdId, Provenance } from "../sources/types.ts";

/** Officeholders: every field traces to a record somebody published. */

/** What kind of seat this is. Not a rank, and never ordered by it. */
export type OfficeLevel = "FEDERAL" | "STATE" | "LOCAL";

/** A source-bound portrait with verified image bytes, served from our own origin. */
export interface OfficeholderPhoto {
  /** Path on our origin, e.g. `/officials/az-cd-6.jpg`. */
  url: string;
  /** Where the image was fetched from. */
  sourceUrl: string;
  /** Required attribution text, where the source states one. */
  attribution: string | null;
  /** A licence statement when the source supplies one; an official own-page binding is also admissible. */
  license: string | null;
  collectedAt: string;
  verification?: import("../photos/binding.ts").PortraitVerification;
}

/** An upstream image is a lead until source identity and stored bytes check out. */
export interface PortraitCandidate {
  readonly imageUrl: string;
  readonly sourceUrl: string;
  readonly collectedAt: string;
  readonly license?: string | null;
  readonly licenseUrl?: string | null;
  readonly attribution?: string | null;
}

type OfficeSelectionMethod = "ELECTED_STATEWIDE" | "APPOINTED" | "UNKNOWN";

/** A source disagreement remains acquisition work while the preferred fact serves readers. */
export interface PersonFieldDisagreement {
  readonly key: string;
  readonly personId: string;
  readonly state: string;
  readonly field: string;
  readonly selected: { readonly value: unknown; readonly source: Provenance };
  readonly alternative: { readonly value: unknown; readonly source: Provenance };
  readonly owner: "BL-01";
  readonly status: "OPEN";
}

export interface Officeholder {
  /** Namespaced by source: `congress:A000370`. */
  id: string;
  /** Stable person identity, independent of any seat or tenure. */
  personId?: string;
  /** Exact publisher identifiers. Names are never identity aliases. */
  nativeIds?: Readonly<Record<string, readonly string[]>>;
  fecCandidateIds?: readonly string[];
  offices?: readonly { id?: string; name?: string; address?: string; phone?: string; email?: string; sourceUrl: string; collectedAt: string }[];
  memberships?: readonly PersonMembership[];
  fieldSources?: Readonly<Record<string, Provenance>>;
  selectionMethod?: OfficeSelectionMethod;
  selectionMethodSourceUrl?: string;
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
  /** Direct profile links/sources in this person's native record; leads until the page and portrait verify. */
  profileUrls?: readonly string[];
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
  /** Official national executive facts, shared by every place and card. */
  executive?: import("./national-executive.ts").NationalExecutiveData;
  /** The state and chamber the member's own current term states (item 7). */
  state?: string;
  chamber?: string;
  provenance: Provenance;
}

export interface PersonMembership {
  readonly id: string;
  readonly personId: string;
  readonly officeId: string;
  readonly jurisdiction: string;
  readonly chamber?: string;
  readonly district?: string;
  readonly officeTitle?: string;
  readonly level?: OfficeLevel;
  readonly selectionMethod?: OfficeSelectionMethod;
  readonly selectionMethodSourceUrl?: string;
  readonly current?: boolean;
  readonly divisionId?: string;
  readonly termStart?: string | null;
  readonly termEnd?: string | null;
  readonly sourceUrl: string;
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
  /** The exact current role, when a person serves more than one office. */
  membershipId?: string;
  /** Set where the seat belongs to a specific body rather than a district. */
  bodyId: string | null;
}

/** A seat the office's own source explicitly states is empty. A missing holder is never a vacancy. */
export interface SeatVacancy {
  readonly ocdId: OcdId;
  readonly sourceUrl: string;
  readonly sourceOrg: string;
  readonly collectedAt: string;
  /** The publisher's own words stating the vacancy. */
  readonly reason: string;
  /** The departure date the publisher states with the vacancy, or null when it states none. */
  readonly since?: string | null;
  readonly officeTitle?: string;
  /** Identity keys of the current holders the same source lists in this division; others there are stale. */
  readonly heldBy?: readonly string[];
}

/** What a generated officeholder file holds. */
export interface OfficeholderSet {
  /** Explicit empty seats published by the office's own source. */
  vacancies?: readonly SeatVacancy[];
  readonly disagreements?: readonly PersonFieldDisagreement[];
  /** Complete enumerated current source memberships; permits retiring omitted memberships, never required for adding facts. */
  currentMembershipComplete?: boolean;
  /** Explicitly ended native tenures, retained even when the person has no current office. */
  endedMemberships?: readonly PersonMembership[];
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
