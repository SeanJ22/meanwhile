/**
 * Whose gap an absent agenda is. Holding no agenda document for a sitting is
 * a fact about us; it never becomes a claim that the body has not posted one.
 * A `whose: "THEIRS"` publication claim is emitted only from a first-party
 * publisher observation of that exact meeting, inside its freshness window.
 * Two axes stay apart: `PublisherPublicationStatus` (what the publisher's
 * surface said, and when) and `AgendaAcquisitionState` (how far we got).
 * Nothing on the acquisition axis can promote a publication status; `UNKNOWN`
 * is the default.
 *
 * Observations expire because publication state changes: each carries
 * `observedAt`, each reading `recheckDueAt`, and a stale observation falls back
 * to the OURS gap with the obligation open. Items are read by
 * `lib/routing/agenda-search.ts#agendaItems`; the emitted shape is
 * `lib/ask/evidence.ts#EvidenceGap`.
 *
 * Pure and total apart from the store at the bottom. No clock (the caller
 * supplies `now`), no disk, no network.
 */

import { agendaContentGroups, isPublisherPageNote } from "../meetings/agenda-content.ts";
import { isAnotherBodysNoticePage, isWiredNoticePage } from "../meetings/notice-pages.ts";
import { agendaItems, type AgendaDocumentLike } from "../routing/agenda-search.ts";
import type { EvidenceGap } from "./evidence.ts";

/* ─────────────────────────────────────────────── the publisher's own axis */

/**
 * How the observation was come by. Only `FIRST_PARTY_PUBLISHER` can produce a
 * THEIRS sentence. `THIRD_PARTY` is a vendor portal or aggregator; `INFERRED`
 * records anything derived from our own collection state and can never become
 * a claim about a government.
 */
export type PublisherObservationProvenance =
  | "FIRST_PARTY_PUBLISHER"
  | "THIRD_PARTY"
  | "INFERRED";

/** What the publisher's surface said about THIS sitting's agenda. */
export type PublisherAgendaReport = "NOT_AVAILABLE" | "AVAILABLE";

/**
 * One reading of a publisher's own surface, scoped to one sitting. Every field
 * is required; an observation missing one is refused, not downgraded.
 */
export interface PublisherAgendaObservation {
  /** The exact sitting this measured. */
  readonly meetingId: string;
  readonly provenance: PublisherObservationProvenance;
  readonly report: PublisherAgendaReport;
  /** ISO instant the surface was read. Minted by the code that read it. */
  readonly observedAt: string;
  /** The publisher surface that was read. Observed, never constructed. */
  readonly observedUrl: string;
  /** The publisher, as they name themselves. */
  readonly sourceOrg: string;
  /**
   * What the surface said, verbatim and trimmed ("Agenda not yet posted"), or
   * the structural basis from `structuralBasisFor`: a first-party listing row
   * that carried no agenda link, observed on a named page at a named time. It
   * describes the page, never whether an agenda exists.
   */
  readonly evidenceQuote: string;
  /**
   * Hours this reading may stand as current. Absent takes
   * `DEFAULT_PUBLISHER_OBSERVATION_HOURS`; above
   * `MAX_PUBLISHER_OBSERVATION_HOURS` it is clamped.
   */
  readonly freshnessHours?: number;
}

/**
 * Packets often land the evening before a sitting, so a negative reading
 * expires within a day; a nightly refresh keeps the state renderable.
 */
export const DEFAULT_PUBLISHER_OBSERVATION_HOURS = 24;

/**
 * The only sentence allowed to describe a calendar row with no agenda link.
 * It describes the page and never says whether an agenda exists.
 */
export function structuralBasisFor(sourceOrg: string): string {
  return (
    `${sourceOrg}'s own calendar listing for this meeting carried no agenda link when we ` +
    `read it`
  );
}

/**
 * A first-party observation from a meeting record we already hold. An empty
 * agenda slot on a page that has one is evidence; a feed with no agenda field
 * is not, so `agendaUrl === null` alone never qualifies. The adapter must set
 * `agendaSlotObservedEmpty` at the moment of the read.
 */
export function observationFromMeetingRecord(meeting: {
  readonly id: string;
  readonly agendaUrl?: string | null;
  /**
   * The source surface carries an agenda slot for this sitting and it was
   * empty when read. Set by the adapter; never inferred from a null `agendaUrl`.
   */
  readonly agendaSlotObservedEmpty?: boolean;
  readonly provenance?: {
    readonly sourceUrl: string | null;
    readonly sourceOrg: string;
    readonly collectedAt: string;
    readonly secondHand?: boolean;
  };
  readonly carried?: unknown;
}): PublisherAgendaObservation | null {
  /* Not measured is never not published. */
  if (meeting.agendaSlotObservedEmpty !== true) return null;
  /* An agenda we hold is not an absence to observe. */
  if (meeting.agendaUrl != null) return null;
  const p = meeting.provenance;
  /* No provenance is not an observation. */
  if (!p) return null;
  /* A page we cannot name cannot be checked. */
  if (!p.sourceUrl) return null;
  /* An aggregator's missing link says nothing about what the BODY posted. */
  if (p.secondHand === true) return null;
  /* A carried-forward row was not read on the run that wrote it, so its `collectedAt` is not the read time. */
  if (meeting.carried !== undefined) return null;
  if (!p.collectedAt) return null;

  return {
    meetingId: meeting.id,
    provenance: "FIRST_PARTY_PUBLISHER",
    report: "NOT_AVAILABLE",
    observedAt: p.collectedAt,
    observedUrl: p.sourceUrl,
    sourceOrg: p.sourceOrg,
    evidenceQuote: structuralBasisFor(p.sourceOrg),
  };
}

/** A week. Nothing about a docket stays measured for longer than this. */
export const MAX_PUBLISHER_OBSERVATION_HOURS = 168;

export type PublisherPublicationStatus =
  /** No first-party evidence measuring this sitting's publication state. */
  | "UNKNOWN"
  /** A first-party surface reports no agenda posted, and the reading is current. */
  | "REPORTS_NOT_AVAILABLE"
  /** A first-party surface reports an agenda is posted, and the reading is current. */
  | "REPORTS_AVAILABLE"
  /** A first-party reading past its window: kept for the recheck, never rendered as current. */
  | "STALE_OBSERVATION";

/* ───────────────────────────────────────────────────── our own axis */

/** How far we got toward putting the sitting's agenda in front of a reader. Facts about us only. */
export type AgendaAcquisitionState =
  /** The sitting is known and we hold no representation of its agenda. */
  | "NOT_ACQUIRED"
  /** A document URL is known and no bytes were kept for it. */
  | "REPRESENTATION_DISCOVERED"
  /** A route to the representation was attempted and blocked or failed. */
  | "ROUTE_BLOCKED"
  /** Bytes are held and no text came out of them. */
  | "ACQUIRED_NOT_READABLE"
  /** What we hold for this sitting is the body's agenda index, not an agenda. */
  | "ACQUIRED_IS_PUBLICATION_INDEX"
  /** Text is held and no item structure could be read off it. */
  | "READ_NO_ITEMS_EXTRACTED"
  /** Items are held and a reader can be shown them. */
  | "ITEMS_READER_READY";

/** One attempt at one route to the representation: a fact about the route. */
export interface AgendaRouteAttempt {
  readonly meetingId: string;
  readonly routeId: string;
  readonly outcome: "BLOCKED" | "FAILED" | "SUCCEEDED";
  readonly attemptedAt: string;
  /** The wall, named. `CAPTCHA`, `403`, `REQUIRES_NEW_ADAPTER`, and so on. */
  readonly note: string;
}

/* ──────────────────────────────────────────────────────── the reading */

/**
 * The pair plus the one sentence a reader may be shown. `state` is the joined
 * name for logging and switching; `publication` and `acquisition` stay
 * separately readable.
 */
export interface AgendaPublicationReading {
  readonly state: `${PublisherPublicationStatus}/${AgendaAcquisitionState}`;
  readonly publication: PublisherPublicationStatus;
  readonly acquisition: AgendaAcquisitionState;
  /** The same held link is attached to more than one canonical government. */
  readonly documentSharedAcrossGovernments?: boolean;
  /** The observation the publication status rests on. Null when UNKNOWN. */
  readonly observation: PublisherAgendaObservation | null;
  /** The named gap, or null when items are reader-ready and nothing is owed. */
  readonly gap: EvidenceGap | null;
  /**
   * Whether we still owe the reader this agenda: true for every state except
   * `ITEMS_READER_READY`. A publisher's "not posted yet" does not close it.
   */
  readonly obligationOpen: boolean;
  /**
   * When the publication state must be measured again. Non-null whenever an
   * observation exists (its window end) and whenever the obligation is open
   * with no observation at all (immediately: `now`).
   */
  readonly recheckDueAt: string | null;
  /** Another avenue is left to try: true until the reader has the items. */
  readonly alternateSearchOpen: boolean;
  /** The version the reading was taken over. Null when nothing is held. */
  readonly currentDocumentUrl: string | null;
  /**
   * Earlier DISTINCT versions of the sitting's own agenda, newest first — see
   * `readerAgendaDocuments`. A re-fetch of identical content is not a version,
   * and a publication index is never a version of a sitting's agenda.
   */
  readonly supersededDocumentUrls: readonly string[];
  /**
   * True only when we hold two or more distinct contents of the sitting's own
   * document: the agenda was amended. Never true from fetch count alone.
   */
  readonly revised: boolean;
  readonly items: readonly string[];
}

export interface AgendaPublicationInput {
  /** Canonical meeting identities; no government is inferred from page text. */
  readonly meetingsAcrossCorpus?: readonly { id: string; ocdId: string | null }[];
  /** The body as a reader named it. Reader-safe plain language only. */
  readonly bodyName: string;
  readonly meetingId: string;
  /** Every document linked to THIS sitting, any version. */
  readonly documentsForMeeting: readonly AgendaDocumentLike[];
  /**
   * The agenda link the publisher's calendar exposed (`Meeting.agendaUrl`). A
   * known unfetched link and no link are both facts about us; neither reaches
   * the THEIRS branch.
   */
  readonly discoveredDocumentUrl?: string | null;
  /** The whole corpus, used to detect a URL held for two sittings: an index page by construction. */
  readonly documentsAcrossCorpus: readonly AgendaDocumentLike[];
  /** Publisher readings. Filtered to this meeting here, not by the caller. */
  readonly observations?: readonly PublisherAgendaObservation[];
  /** Route attempts. Filtered to this meeting here, not by the caller. */
  readonly routeAttempts?: readonly AgendaRouteAttempt[];
  /** Epoch millis. This module is not a clock. */
  readonly now: number;
}

function windowHours(observation: PublisherAgendaObservation): number {
  const raw = observation.freshnessHours;
  if (!Number.isFinite(raw) || (raw as number) <= 0) {
    return DEFAULT_PUBLISHER_OBSERVATION_HOURS;
  }
  return Math.min(raw as number, MAX_PUBLISHER_OBSERVATION_HOURS);
}

/** The instant an observation stops standing as current. Null if unparseable. */
export function observationFreshUntil(observation: PublisherAgendaObservation): string | null {
  const at = Date.parse(observation.observedAt);
  if (!Number.isFinite(at)) return null;
  return new Date(at + windowHours(observation) * 3_600_000).toISOString();
}

/** Is this reading still current? An unparseable `observedAt` is not fresh. */
export function observationIsFresh(
  observation: PublisherAgendaObservation,
  now: number,
): boolean {
  const until = observationFreshUntil(observation);
  if (!until) return false;
  const at = Date.parse(observation.observedAt);
  /* A reading stamped in the future is not fresh either. */
  if (at > now) return false;
  return Date.parse(until) > now;
}

/**
 * The newest first-party observation for this exact meeting. Third-party and
 * inferred rows are dropped here, so none can reach the THEIRS branch.
 */
function governingObservation(
  meetingId: string,
  observations: readonly PublisherAgendaObservation[],
): PublisherAgendaObservation | null {
  const eligible = observations
    .filter((o) => o.meetingId === meetingId && o.provenance === "FIRST_PARTY_PUBLISHER")
    .filter((o) => Number.isFinite(Date.parse(o.observedAt)))
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  return eligible[0] ?? null;
}

/**
 * A Diligent/iCompass meeting page as stored: the whole page, the skip links
 * alone, or the page's own content. In every case it is the portal, not the
 * sitting's agenda, which is the linked document.
 */
function diligentPortalPageText(text: string): boolean {
  const wholePage = /Skip Navigation\s+Jump to SideBar\s+Quick Menu/i.test(text)
    && /(?:Board Application:|Schedule of Meetings|Upcoming Meetings)/i.test(text);
  const skipLinksAlone = /^\s*Skip Navigation\s+Jump to SideBar\b/i.test(text);
  const documentPanel = /Private Version For:/i.test(text) && /Accessible Web Version/i.test(text);
  return wholePage || skipLinksAlone || documentPanel;
}

/**
 * The stored extraction label is not evidence that its bytes are an agenda.
 * Older HTML readers stored document-viewer shells, portal navigation, and
 * even ZIP/DOCX bytes as text. These are representation facts, not a claim
 * about whether the publisher has posted an agenda. Keep the original bytes;
 * classify their reader use here, for both Ask and the meeting card.
 */
export function agendaDocumentRepresentation(
  document: AgendaDocumentLike & { readonly extractionNote?: string | null },
): "TEXT" | "PUBLICATION_PORTAL" | "UNREADABLE" {
  // A read recorded as failed because its words were another sitting's
  // publisher page: what is held is that page, not unread bytes.
  if (document.extraction === "failed" && isPublisherPageNote(document.extractionNote)) {
    return "PUBLICATION_PORTAL";
  }
  const text = document.text;
  if (!text?.trim() || /^(?:PK\u0003\u0004|%PDF-)/.test(text) || text.includes("\u0000")) {
    return "UNREADABLE";
  }
  if (document.extraction !== "html") return "TEXT";
  let url: URL;
  try { url = new URL(document.documentUrl); } catch { return "TEXT"; }

  // Diligent/iCompass's meeting-specific URL is still a portal, even when
  // no other sitting shares the URL. Its accessible agenda is a linked file.
  if (/\/Portal\/(?:MeetingInformation\.aspx)?\/?$/i.test(url.pathname) && diligentPortalPageText(text)) {
    return "PUBLICATION_PORTAL";
  }
  // The browser application has not loaded a document into these shells.
  if (/Public Portal\s*[•·-]?\s*CivicClerk/i.test(text)
      && /(?:need to enable|requires?) JavaScript/i.test(text)) return "PUBLICATION_PORTAL";
  if (url.hostname === "drive.google.com" && /^\/file\/d\/[^/]+\/view\/?$/.test(url.pathname)
      && /Google Drive\s+Loading(?:&hellip;|\.{3}|…)?\s+Sign in/i.test(text)) return "PUBLICATION_PORTAL";
  // A board's meeting directory is not an individual meeting's notice.
  if (/Skip to content/i.test(text)
      && /Board (?:and|&) Committee Meetings\s+View Meetings\s+Get Notifications/i.test(text)
      && /(?:Cancel\s+Continue\s*){1,}/i.test(text)) return "PUBLICATION_PORTAL";
  return "TEXT";
}

/** Corpus context shared by the publication reading and the reader document projection. */
export interface AgendaCorpusContext {
  readonly documentsAcrossCorpus: readonly AgendaDocumentLike[];
  /** `bodyId`, when the caller has it, lets a notice page be matched to its own body. */
  readonly meetingsAcrossCorpus?: readonly { id: string; ocdId: string | null; bodyId?: string | null }[];
}

interface HeldDocumentReading {
  readonly representation: "TEXT" | "PUBLICATION_PORTAL" | "UNREADABLE";
  readonly sharedAcrossGovernments: boolean;
  readonly items: readonly string[];
  /** The body's publication index (portal, listing page, shared landing page), not a sitting's own document. */
  readonly publicationIndex: boolean;
  /** A wired notice page that is neither this sitting's body's nor its publisher's; never shown for it. */
  readonly anotherBodysNoticePage: boolean;
}

/** One reading of one held document, shared by the publication reading and the reader projection. */
function heldDocumentReader(context: AgendaCorpusContext): (document: AgendaDocumentLike) => HeldDocumentReading {
  const governmentByMeeting = new Map((context.meetingsAcrossCorpus ?? []).map((meeting) => [meeting.id, meeting.ocdId]));
  const bodyByMeeting = new Map((context.meetingsAcrossCorpus ?? []).map((meeting) => [meeting.id, meeting.bodyId ?? null]));
  const meetingsByUrl = new Map<string, Set<string>>();
  for (const document of context.documentsAcrossCorpus) {
    const meetings = meetingsByUrl.get(document.documentUrl) ?? new Set<string>();
    meetings.add(document.meetingId);
    meetingsByUrl.set(document.documentUrl, meetings);
  }
  const memo = new Map<string, HeldDocumentReading>();
  return (document) => {
    // A row with no text is told apart by its note: two failed reads of one
    // URL can be different findings (no text at all, or the publisher's page).
    const note = (document as { readonly extractionNote?: string | null }).extractionNote ?? "";
    // The notice-page verdict depends on the sitting's body and publisher, so both are in the key.
    const memoKey = `${document.documentUrl}\u0000${document.extraction}\u0000${document.text ?? `\u0001null\u0000${note}`}` +
      `\u0000${bodyByMeeting.get(document.meetingId) ?? ""}\u0000${document.sourceOrg ?? ""}`;
    const known = memo.get(memoKey);
    if (known) return known;
    const holders = meetingsByUrl.get(document.documentUrl) ?? new Set<string>();
    const sharedWith = holders.size;
    const representation = agendaDocumentRepresentation(document);
    const sharedAcrossGovernments = new Set(
      [...holders].map((meetingId) => governmentByMeeting.get(meetingId)).filter((id): id is string => Boolean(id)),
    ).size > 1;
    const items = !sharedAcrossGovernments && representation === "TEXT" && document.text ? agendaItems(document.text) : [];
    // A wired notice page is the body's page by its URL alone; one stating no item is an index.
    const noticePage = isWiredNoticePage(document.documentUrl);
    const reading: HeldDocumentReading = {
      representation,
      sharedAcrossGovernments,
      items,
      // Unreadable bytes are named as unreadable first, exactly as the
      // publication reading orders it; an index needs readable evidence, which
      // for a wired notice page is its URL.
      publicationIndex: (noticePage && items.length === 0) || (representation !== "UNREADABLE" &&
        (sharedAcrossGovernments || representation === "PUBLICATION_PORTAL" || (sharedWith > 1 && items.length === 0))),
      anotherBodysNoticePage: isAnotherBodysNoticePage(document.documentUrl, {
        bodyId: bodyByMeeting.get(document.meetingId) ?? null,
        publisher: document.sourceOrg ?? null,
      }),
    };
    memo.set(memoKey, reading);
    return reading;
  };
}

function retrievedAtOrder(left: AgendaDocumentLike & { readonly id?: string }, right: AgendaDocumentLike & { readonly id?: string }): number {
  const leftAt = Date.parse(left.retrievedAt);
  const rightAt = Date.parse(right.retrievedAt);
  if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) return rightAt - leftAt;
  if (left.retrievedAt !== right.retrievedAt) return left.retrievedAt < right.retrievedAt ? 1 : -1;
  return (left.id ?? left.documentUrl).localeCompare(right.id ?? right.documentUrl);
}

export interface ReaderAgendaDocumentProjection<T> {
  /**
   * Exactly the documents a reader is shown for this sitting, newest first:
   * ONE row per distinct content (the newest stored row carrying it). Every
   * stored row stays in the holding as provenance; this is a reading of it.
   */
  readonly documents: readonly T[];
  /** True when `documents` are the sitting's own documents; false when only publication-index pages are held. */
  readonly sittingSpecific: boolean;
  /** Stored rows held for this sitting. */
  readonly heldRows: number;
  /** Held rows not shown because their content is identical to a shown row: re-fetches, not versions. */
  readonly identicalContentRows: number;
  /** Held publication-index rows not shown because the sitting's own document is held. */
  readonly publicationIndexRowsSetAside: number;
  /** Held rows not shown because they are another body's notice page. */
  readonly anotherBodysPagesSetAside: number;
}

/**
 * What a reader is shown for one sitting's agenda. A version is a distinct
 * content (`sameAgendaContent`); identical re-fetches are one version, newest
 * row speaking for it. Once the sitting's own document is held, publication
 * index rows are set aside; a sitting holding only index pages shows them as
 * such. Nothing is deleted: shown, identical and set-aside counts reconcile to
 * the rows held.
 */
export function readerAgendaDocuments<T extends AgendaDocumentLike & { readonly id?: string; readonly contentHash?: string }>(
  documentsForMeeting: readonly T[],
  context: AgendaCorpusContext,
): ReaderAgendaDocumentProjection<T> {
  const read = heldDocumentReader(context);
  const held = [...documentsForMeeting].sort(retrievedAtOrder);
  // Another body's notice page is never shown for this sitting.
  const newestFirst = held.filter((document) => !read(document).anotherBodysNoticePage);
  const sittingRows = newestFirst.filter((document) => !read(document).publicationIndex);
  const sittingSpecific = sittingRows.length > 0;
  const candidates = sittingSpecific ? sittingRows : newestFirst;
  // Newest first in, so the newest row of each distinct content speaks for it.
  const documents = agendaContentGroups(candidates).map((group) => group[0]!);
  return {
    documents,
    sittingSpecific,
    heldRows: documentsForMeeting.length,
    identicalContentRows: candidates.length - documents.length,
    publicationIndexRowsSetAside: sittingSpecific ? newestFirst.length - sittingRows.length : 0,
    anotherBodysPagesSetAside: held.length - newestFirst.length,
  };
}

/** The reading. The only place `whose: "THEIRS"` is produced for an agenda, and only from an observation. */
export function classifyAgendaPublication(
  input: AgendaPublicationInput,
): AgendaPublicationReading {
  const {
    bodyName,
    meetingId,
    documentsForMeeting,
    documentsAcrossCorpus,
    discoveredDocumentUrl = null,
    observations = [],
    routeAttempts = [],
    meetingsAcrossCorpus = [],
    now,
  } = input;

  /* ── the publisher axis, decided before and independently of ours ────── */
  const observation = governingObservation(meetingId, observations);
  const fresh = observation ? observationIsFresh(observation, now) : false;
  const publication: PublisherPublicationStatus = !observation
    ? "UNKNOWN"
    : !fresh
      ? "STALE_OBSERVATION"
      : observation.report === "NOT_AVAILABLE"
        ? "REPORTS_NOT_AVAILABLE"
        : "REPORTS_AVAILABLE";

  /* ── our axis ────────────────────────────────────────────────────────── */
  // Taken over exactly what a reader is shown (`readerAgendaDocuments`).
  const context: AgendaCorpusContext = { documentsAcrossCorpus, meetingsAcrossCorpus };
  const shown = readerAgendaDocuments(documentsForMeeting, context);
  const newest = shown.documents[0] ?? null;
  const sittingVersions = shown.sittingSpecific ? shown.documents : [];
  const superseded = sittingVersions.slice(1).map((d) => d.documentUrl);
  const reading = newest ? heldDocumentReader(context)(newest) : null;
  const representation = reading?.representation ?? null;
  const documentSharedAcrossGovernments = reading?.sharedAcrossGovernments ?? false;
  const items = reading?.items ?? [];
  const attempts = routeAttempts.filter((a) => a.meetingId === meetingId);
  const blocked = attempts.some((a) => a.outcome === "BLOCKED" || a.outcome === "FAILED");

  const acquisition: AgendaAcquisitionState = !newest
    ? blocked
      ? "ROUTE_BLOCKED"
      : discoveredDocumentUrl
        ? "REPRESENTATION_DISCOVERED"
        : "NOT_ACQUIRED"
    : reading?.publicationIndex && isWiredNoticePage(newest.documentUrl)
      // A body's notice page is its publication index by URL, readable or not.
      ? "ACQUIRED_IS_PUBLICATION_INDEX"
      : representation === "UNREADABLE"
      ? "ACQUIRED_NOT_READABLE"
      : reading?.publicationIndex
        ? "ACQUIRED_IS_PUBLICATION_INDEX"
        : items.length === 0
          ? "READ_NO_ITEMS_EXTRACTED"
          : "ITEMS_READER_READY";

  const obligationOpen = acquisition !== "ITEMS_READER_READY";
  const freshUntil = observation ? observationFreshUntil(observation) : null;
  const recheckDueAt = freshUntil ?? (obligationOpen ? new Date(now).toISOString() : null);

  return {
    state: `${publication}/${acquisition}`,
    publication,
    acquisition,
    documentSharedAcrossGovernments,
    observation,
    gap: gapFor({ publication, acquisition, observation, fresh, bodyName, documentSharedAcrossGovernments }),
    obligationOpen,
    recheckDueAt,
    alternateSearchOpen: obligationOpen,
    currentDocumentUrl: newest?.documentUrl ?? null,
    supersededDocumentUrls: superseded,
    revised: sittingVersions.length > 1,
    items,
  };
}

/**
 * The gap sentence. The OURS sentences stay distinct by what was returned,
 * and carry no apology or verdict on ourselves. The THEIRS sentence names the
 * publisher and the day the page was read.
 */
function gapFor(args: {
  publication: PublisherPublicationStatus;
  acquisition: AgendaAcquisitionState;
  observation: PublisherAgendaObservation | null;
  fresh: boolean;
  bodyName: string;
  documentSharedAcrossGovernments: boolean;
}): EvidenceGap | null {
  const { publication, acquisition, observation, bodyName } = args;

  switch (acquisition) {
    case "ITEMS_READER_READY":
      return null;
    case "ACQUIRED_NOT_READABLE":
      return {
        whose: "OURS",
        statement: `We hold an agenda document for that meeting but could not read its text.`,
      };
    case "ACQUIRED_IS_PUBLICATION_INDEX":
      return {
        whose: "OURS",
        statement: args.documentSharedAcrossGovernments
          ? "The stored link is shared by meeting records for more than one government. It has not been verified as this body's agenda."
          : `The link we hold for that meeting is ${bodyName}'s agenda portal rather than the agenda itself.`,
      };
    case "READ_NO_ITEMS_EXTRACTED":
      return {
        whose: "OURS",
        statement: `We hold the agenda document for that meeting but could not extract its items.`,
      };
    case "ROUTE_BLOCKED":
    case "REPRESENTATION_DISCOVERED":
    case "NOT_ACQUIRED":
      break;
  }

  /*
   * The only THEIRS branch: a fresh first-party observation of this meeting
   * reporting NOT_AVAILABLE. It says what a named publisher's page showed on a
   * named day, with the publisher first and the date as its scope.
   */
  if (publication === "REPORTS_NOT_AVAILABLE" && observation) {
    return {
      whose: "THEIRS",
      statement:
        `${observation.sourceOrg} has not posted an agenda for that ${bodyName} meeting — ` +
        `its own page showed none when we read it on ` +
        `${observation.observedAt.slice(0, 10)}. We are still checking.`,
    };
  }

  /*
   * Everything else (no observation, a stale one, or a publisher saying the
   * agenda is up while we do not hold it) is OURS: "have not yet acquired".
   * No progress claim is made.
   */
  const tail =
    publication === "REPORTS_AVAILABLE" && observation
      ? ` ${observation.sourceOrg} shows one posted, and we are going after it.`
      : ``;
  const middle =
    acquisition === "ROUTE_BLOCKED"
      ? ` The route we tried did not land.`
      : acquisition === "REPRESENTATION_DISCOVERED"
        ? ` We hold the link their calendar gave and not the document behind it.`
        : ``;
  return {
    whose: "OURS",
    statement: `We have not yet acquired the agenda for that ${bodyName} meeting.${middle}${tail}`,
  };
}

/* ──────────────────────────────────────────────────────────── the store */

/**
 * Publisher observations, in memory per process. An adapter that reads a
 * portal's "Agenda: not yet posted" cell calls
 * `recordPublisherAgendaObservation` at the moment of the read.
 */
const observationStore = new Map<string, PublisherAgendaObservation[]>();

/** Record one reading. Newest wins at read time; nothing is overwritten. */
export function recordPublisherAgendaObservation(
  observation: PublisherAgendaObservation,
): void {
  const rows = observationStore.get(observation.meetingId) ?? [];
  rows.push(observation);
  observationStore.set(observation.meetingId, rows);
}

/** Every reading held for one sitting. */
export function publisherAgendaObservationsFor(
  meetingId: string,
): readonly PublisherAgendaObservation[] {
  return observationStore.get(meetingId) ?? [];
}

/** Test seam, and the ingest reset. The suite must not inherit a reading. */
export function resetPublisherAgendaObservations(): void {
  observationStore.clear();
}
