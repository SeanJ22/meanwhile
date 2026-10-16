
import type { MeetingBody } from "../meetings/attribution.ts";
import type { Accounted } from "./normalize-account.ts";

export type OcdId = string;

export interface Provenance {
  kind?: import("../control-plane/promotion/source-kinds.ts").SourceKind;
  /** Exact saved source span supporting this field. */
  quote?: string;
  sourceUrl: string | null;
  /** The organization that published it, e.g. "City Clerk". */
  sourceOrg: string;
  /** When we fetched it. */
  collectedAt: string;
  /** When a human or check last confirmed it still matches the source. */
  verifiedAt: string | null;
  doorId?: string;
  secondHand?: boolean;
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

export interface CarriedForward {
  /** The source whose refusal is the reason this row was carried. */
  source: string;
  lastFreshAt: string;
  reason?: "SOURCE_UNAVAILABLE" | "PARTIAL_SCOPE_UNAVAILABLE" | "UNEXPLAINED_DISAPPEARANCE" | "OUTSIDE_FETCH_WINDOW";
}

export interface MeetingLocation {
  /** Human-readable, as printed on the agenda: "City Hall, Council Chambers". */
  name: string;
  /** Street address if the source gives one. */
  address: string | null;
  lat: number;
  lng: number;
}

export interface OnlineAccess {
  /** The published location string, verbatim. */
  label: string;
  /** The join link the body published, or null when it published none. */
  joinUrl: string | null;
}

export interface MeetingVenueGap {
  kind: "NOT_STATED_BY_PUBLISHER" | "STATED_NOT_PLACED";
  /** The venue exactly as published, or null when none was. */
  publishedText: string | null;
  /** Whose page this was read from — the name the gap line cites. */
  publisher: string;
}

export type MeetingStatus = "SCHEDULED" | "CONCLUDED" | "CANCELED";

export interface Meeting {
  /** Source and exact quote for each composed field, when available. */
  fieldSources?: Readonly<Record<string, Provenance>>;
  /** Original partition ids retained so agenda links and evidence can follow a merge. */
  mergedMeetingIds?: readonly string[];
  publicationConflicts?: readonly import("../civic-data/manual-source-isolation.ts").SourceScopedHeldFact[];
  /** Stable within a source. Namespaced by source to stay unique across them. */
  id: string;
  ocdId: OcdId | null;
  bodyId?: string;
  /** The body itself: "Mayor and Council", "Planning Commission". */
  bodyName: string;
  /** What this particular sitting is called: "Regular Session", "Budget Hearing". */
  title: string;
  /** Start time, ISO 8601 with offset. Local government meets in local time. */
  startsAt: string;
  startPrecision?: "MINUTE" | "DAY";
  /** IANA zone the meeting is held in, for rendering times honestly. */
  timeZone: string;
  location: MeetingLocation | null;
  online?: OnlineAccess;
  venueGap?: MeetingVenueGap;
  eventType?: string;
  endsAt?: string | null;
  publishedLinks?: Array<{ label: string; href: string; kind?: "MINUTES" | "RESULTS" }>;
  publishedDocuments?: readonly import("../outcomes/types.ts").PublishedMeetingDocument[];
  agendaUrl: string | null;
  videoUrl?: string;
  postedAt?: string;
  agendaSlotObservedEmpty?: boolean;
  /** Display name of the jurisdiction: "<City>, <ST>". Display only — join on ocdId. */
  jurisdiction: string;
  status: MeetingStatus;
  provenance: Provenance;
  carried?: CarriedForward;
  actingBodies?: MeetingBody[];
}

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

export interface NormalizeDropCounts {
  placeless: number;
  unknownVenue: number;
  unplaceableInTime: number;
  notConfigured: number;
}

export interface ReportingMeetingSource<Raw = unknown>
  extends MeetingSource<Raw> {
  normalizeWithDrops(
    raw: Raw[],
    now?: Date,
  ): Accounted<{
    meetings: Meeting[];
    drops: NormalizeDropCounts;
    unreachableOcdIds?: string[];
    partialScopes?: PartialScopeFailure[];
    duplicateIdentity?: DuplicateIdentityCounts;
    /** What the adapter did with recurring series, by body. */
    recurrence?: RecurrenceReport;
  }>;
}

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
  publisherRelisted?: number;
}

/** Which half of a two-feed source failed — see `partialScopes`. */
export type SourceScope = "UPCOMING" | "ARCHIVE";

export interface PartialScopeFailure {
  scope: SourceScope;
  ocdIds: (string | null)[];
  /** What refused, in the terms the retrieval saw it. */
  cause: string;
}

/** The contract every source directory implements. */
export interface MeetingSource<Raw = unknown> {
  /** Stable slug, matching the directory name. */
  readonly name: string;
  readonly publishedLookbackDays?: number | null;
  /** Hit the upstream system. The only step allowed to touch the network. */
  fetch(query: MeetingQuery): Promise<Raw[]>;
  normalize(raw: Raw[], now?: Date): Meeting[];
  /** Persist normalized records. */
  upsert(meetings: Meeting[]): Promise<{ inserted: number; updated: number }>;
}
