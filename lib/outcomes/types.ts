import type {
  LegistarAgendaRecord,
  LegistarOutcomeRecord,
  LegistarRollCallRecord,
  LegistarMinutesPointer,
} from "../sources/legistar/outcomes.ts";
import type { AgendaPublicationObservation } from "./publication.ts";

export interface PublishedMeetingDocument {
  readonly meetingId: string;
  readonly kind: "MINUTES" | "RESULTS";
  readonly url: string;
  readonly publisherLabel: string;
  readonly contentHash: string;
  readonly contentType: string;
  readonly retrievedAt: string;
  readonly checkedAt: string;
  readonly text: string | null;
  readonly extraction: "TEXT_EXTRACTED" | "UNREADABLE";
  readonly extractionNote: string | null;
}

export interface PersistedPublicationStatus {
  /** "Final", "Draft", null — the tenant's label, which a clerk may rename. */
  readonly agendaStatusName: string | null;
  /** The vendor's enum behind that label. */
  readonly agendaStatusId: number | null;
  /** The document URL the publisher names. Recorded; see `agendaRetrieval`. */
  readonly agendaFile: string | null;
  /** UTC, from `EventAgendaLastPublishedUTC`. Null when never published. */
  readonly agendaLastPublishedUtc: string | null;

  readonly minutesStatusName: string | null;
  readonly minutesStatusId: number | null;
  readonly minutesFile: string | null;
  readonly minutesLastPublishedUtc: string | null;
  /** The public permalink for the sitting. Real, and the right `sourceUrl`. */
  readonly inSiteUrl: string | null;
  /** The publisher's last-modified stamp for the event row: the incremental refresh key. */
  readonly lastModifiedUtc: string | null;
  /** "Public", "Not Viewable", null. A media fact, never an outcome. */
  readonly videoStatus: string | null;
  /** The instant we observed the fields above (not the publisher's clock). */
  readonly observedAt: string;
}

export type OutcomeExtractionState =
  /** The items route returned rows and they were transformed. */
  | "RETRIEVED"
  /** The items route returned zero rows: a failed extraction, never "this meeting had no items". */
  | "ZERO_ROWS_FAILED"
  /** The request itself failed. Retryable, and it stays open — never absence. */
  | "REQUEST_FAILED"

  | "NOT_YET_PUBLISHED";

export type MinutesApprovalState =
  | "DRAFT_ACTION_MINUTES"
  /** Published as the body's minutes; no later sitting we hold records approving them. */
  | "APPROVAL_NOT_SEEN"
  /** A later sitting's minutes we hold record the body approving these minutes. */
  | "APPROVED";

export interface PersistedMinutesDocument {
  /** The exact URL read, on the tenant's permitted portal host. */
  readonly url: string;
  readonly format: "PDF" | "HTML";
  /** The portal grid cell's own label, verbatim: "Minutes", "Results". */
  readonly publisherLabel: string;
  /** The document's own title: "COUNCIL MINUTES", "COUNCIL STRATEGIC PLANNING ACTION MINUTES". */
  readonly title: string | null;
  readonly sha256: string;
  readonly byteCount: number;
  readonly pageCount: number | null;
  /** The grid's meeting-kind line ("Special Council Meeting"), or null for a regular sitting. */
  readonly sittingKind: string | null;
  readonly approval: {
    readonly state: MinutesApprovalState;
    /** A sentence a reader may be shown. */
    readonly detail: string;
    /** The sitting whose minutes record the approval, and its words. */
    readonly approvedAt: { readonly meetingId: string; readonly startsAt: string | null; readonly quote: string } | null;
  };
  readonly approves: readonly { readonly kind: string; readonly date: string }[];
  readonly approvesQuote: string | null;
  readonly approvalCarried: boolean;

  readonly parserRevision?: string;
  readonly contentType?: string | null;
  readonly etag?: string | null;
  readonly lastModified?: string | null;
  readonly readAt?: string;
}

export interface PersistedFailedMinutesRead {
  /** The exact URL read, and the grid label it was linked under. The failure belongs to this link only. */
  readonly url: string;
  readonly publisherLabel: string;
  /** The identity of the bytes that failed. */
  readonly sha256: string;
  readonly byteCount: number;
  readonly contentType: string | null;
  /** The response's own validators, as served with those bytes; null where the host sends none. */
  readonly etag: string | null;
  readonly lastModified: string | null;
  /** The parser revision that failed on these bytes. */
  readonly parserRevision: string;
  /** When the bytes were read. */
  readonly readAt: string;
  /** Why the extraction failed, in the sentence the sitting carries. */
  readonly reason: string;
}

/** One item whose votes request failed. Open, retryable, never an empty roll. */
export interface PersistedVoteRequestFailure {
  readonly eventItemId: number;
  readonly reason: string;
}

export interface PersistedSittingOutcomes {
  /** `<adapter>:<tenant>:<upstream id>`; joins to the sitting by string equality. */
  readonly meetingId: string;
  /** `ocd-division/...#governing`. */
  readonly bodyId: string | null;
  readonly ocdId: string | null;
  readonly slug: string;
  readonly eventId: number;
  readonly bodyName: string;
  readonly jurisdiction: string;
  /** ISO instant of the sitting's start, for ordering and for "last meeting". */
  readonly startsAt: string | null;
  readonly sourceOrg: string;
  readonly sourceUrl: string | null;

  readonly extraction: OutcomeExtractionState;
  /** Why, whenever `extraction` is not `RETRIEVED`. Always a sentence. */
  readonly extractionNote: string | null;

  readonly publication: PersistedPublicationStatus;
  /** Known to exist, not read. Has NO record class, deliberately. */
  readonly minutesPointer: LegistarMinutesPointer;

  /** What was NOTICED. Never evidence of an outcome. */
  readonly agenda: readonly LegistarAgendaRecord[];
  /** What the body DID. One per ACTED item, not one per item. */
  readonly outcomes: readonly LegistarOutcomeRecord[];
  /** Per-person rolls. Only ever built from rows the votes route returned. */
  readonly rollCalls: readonly LegistarRollCallRecord[];

  /** Items whose own record asserts a roll call and whose roll came back empty. Reported, never reconciled. */
  readonly failedRollCallExtractions: readonly number[];
  readonly voteRequestFailures: readonly PersistedVoteRequestFailure[];

  /** Ids from `lib/sources/legistar/routes.ts` of the routes that succeeded for this sitting. */
  readonly routesWalked: readonly string[];


  readonly publicationObservations: readonly AgendaPublicationObservation[];

  /** The minutes document read, on sittings the InSite minutes route wrote. */
  readonly minutesDocument?: PersistedMinutesDocument;

  readonly failedMinutesRead?: PersistedFailedMinutesRead;
}

/** The committed store. One file, every tenant. */
export interface OutcomeSnapshot {
  /** From `pnpm stamp`. Never a plausible date. */
  readonly generatedOn: string;
  /** ISO instant the ingest run finished. */
  readonly generatedAt: string;
  /** Tenant slugs this store holds anything for. */
  readonly tenants: readonly string[];
  readonly sittings: readonly PersistedSittingOutcomes[];
  readonly pointers?: readonly { readonly contractId: string; readonly tenant: string; readonly versionId: string }[];
}
