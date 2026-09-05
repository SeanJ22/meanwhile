/**
 * **WHOSE GAP AN ABSENT AGENDA IS — measured, never assumed.** (ASK-07,
 * 2026-08-29.)
 *
 * ## The line this module exists to delete
 *
 * `app/api/ask/grounded/route.ts` held this, and a test pinned it as correct:
 *
 * ```ts
 * if (forMeeting.length === 0) {
 *   gaps.push({
 *     whose: "THEIRS",
 *     statement: `No agenda has been published for that ${subject.name} meeting yet.`,
 *   });
 * }
 * ```
 *
 * `forMeeting.length === 0` is one measurement and it is a measurement OF US:
 * this product holds zero agenda documents linked to that meeting id. The
 * sentence it produced is a claim about a GOVERNMENT — that a clerk has not
 * posted the agenda for a sitting on their own calendar. Nothing in the input
 * measures that. The corpus carries 34 bodies with future sittings and no
 * document at all, and for every one of them the honest reading is *we have
 * not gone and got it*, which is exactly the reading the emitted sentence
 * denied.
 *
 * `CLAUDE.md`: *"A render default may never manufacture a claim. A null renders
 * as its NAMED GAP, on every surface, always — and the name says WHOSE gap it
 * is."* RULING 184: *"A blocked route may never become a blocked fact."*
 * RULING 170: a finite attempt count never earns an absence. Zero documents is
 * a count of attempts that landed, which is the smallest finite count there is.
 *
 * ## The rule, mechanically
 *
 * A `whose: "THEIRS"` publication claim is emitted **only** when a first-party
 * publisher observation measures the publication state of THAT EXACT MEETING
 * and is still inside its freshness window. There is no other path to THEIRS
 * in this module, and the two axes below are kept apart so there cannot be one:
 *
 * - `PublisherPublicationStatus` — what the PUBLISHER's own surface said, and
 *   when. Facts about them.
 * - `AgendaAcquisitionState` — how far WE got. Facts about us.
 *
 * A reading is the pair, plus the derived sentence. Nothing in the acquisition
 * axis can promote a publication status, and a publication status of `UNKNOWN`
 * is the default, the common case, and never silently the negative one.
 *
 * ## Why the observation expires
 *
 * Publication state CHANGES. A clerk posts the packet the Friday before the
 * Tuesday sitting; a "not available" reading taken a week out is true of the
 * moment it was taken and false of now. Rendering it as current truth forever
 * is the stale-snapshot failure this repository has already recorded twice
 * (the raster basemap, the vector tiles) pointed at a claim about a government
 * instead of at a map layer. So every observation carries `observedAt`, every
 * reading carries `recheckDueAt`, and an observation past its window stops
 * being renderable as a THEIRS fact and falls back to the OURS gap with the
 * acquisition obligation still open.
 *
 * ## What this module REUSES rather than re-declares
 *
 * - `lib/routing/agenda-search.ts#agendaItems` is the one extractive item
 *   reader in the repository and stays the one.
 * - `lib/answerability/stages.ts` owns the SEVEN-STAGE answerability ladder and
 *   its block codes, measured over a whole corpus for coverage reporting. This
 *   module is the READER-FACING reading of one meeting, and the state names
 *   below are deliberately the same distinctions under names that say whose
 *   fact each one is. They are not merged because they answer different
 *   questions: that module asks *how far did the corpus get*, this one asks
 *   *what may we say to a reader about this sitting*.
 * - `lib/ask/evidence.ts#EvidenceGap` is the emitted shape. This module does
 *   not invent a second gap type.
 *
 * PURE and TOTAL apart from the store at the bottom. No clock (the caller
 * supplies `now`), no disk, no network.
 */

import { agendaItems, type AgendaDocumentLike } from "../routing/agenda-search.ts";
import type { EvidenceGap } from "./evidence.ts";

/* ─────────────────────────────────────────────── the publisher's own axis */

/**
 * How the observation was come by. **Only `FIRST_PARTY_PUBLISHER` can ever
 * produce a THEIRS sentence**, and that is enforced below rather than
 * documented here.
 *
 * `THIRD_PARTY` is a vendor portal or aggregator reporting on a body's behalf:
 * real evidence, worth keeping, and not the government's own statement about
 * its own docket. `INFERRED` exists so that anything derived from our own
 * collection state has somewhere to be recorded that is structurally incapable
 * of becoming a claim about a government — which is the defect this file was
 * opened to remove.
 */
export type PublisherObservationProvenance =
  | "FIRST_PARTY_PUBLISHER"
  | "THIRD_PARTY"
  | "INFERRED";

/** What the publisher's surface said about THIS sitting's agenda. */
export type PublisherAgendaReport = "NOT_AVAILABLE" | "AVAILABLE";

/**
 * One reading of a publisher's own surface, scoped to ONE sitting.
 *
 * Every field is required because every one of them is load-bearing for the
 * question *may this become a sentence about a government?* — an observation
 * that cannot say which meeting it measured, when it was taken, where it was
 * taken, or what the surface actually said is not evidence of a publication
 * state and is refused rather than downgraded.
 */
export interface PublisherAgendaObservation {
  /** The exact sitting this measured. Scoping is the whole rule. */
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
   * What the surface ACTUALLY SAID, verbatim and trimmed — "Agenda not yet
   * posted", "Agenda: none", the empty-cell label. A report with no quoted
   * basis is an assertion, and this product does not carry those.
   *
   * **OR a STRUCTURAL basis, which is the ASK-18 extension (2026-08-30) and is
   * held to the same standard.** Many calendars say nothing at all about a
   * missing agenda: the row simply carries no agenda link. That absence is
   * observed on a named page at a named time and is exactly as checkable as a
   * quote — a reader can open `observedUrl` and see the same empty cell.
   *
   * It is NOT a loophole, and the difference from an assertion is precise:
   *
   * ```
   *   ALLOWED   "the body's own calendar listing for this meeting carried no
   *             agenda link when we read it"      — a description of a page
   *   REFUSED   "no agenda has been published"    — a claim about a government
   *             that no page was read for
   * ```
   *
   * `structuralBasisFor` below is the ONE constructor, so the sentence a
   * reader eventually meets cannot be hand-written per adapter. And the
   * provenance still has to be `FIRST_PARTY_PUBLISHER`: a missing link on an
   * aggregator's copy of a calendar says nothing about what the body posted.
   */
  readonly evidenceQuote: string;
  /**
   * How long this reading may stand as current, in hours. Absent takes
   * `DEFAULT_PUBLISHER_OBSERVATION_HOURS`; anything above
   * `MAX_PUBLISHER_OBSERVATION_HOURS` is clamped down to it, because a
   * publisher cannot grant its own negative an unlimited shelf life.
   */
  readonly freshnessHours?: number;
}

/**
 * **24 hours.** Agenda packets in this corpus land in the last few days before
 * a sitting and frequently the evening before; a negative reading is at its
 * most wrong exactly when a reader is most likely to ask. A day is short
 * enough that a stale negative expires before the sitting it is about, and long
 * enough that a nightly refresh keeps the state renderable.
 */
export const DEFAULT_PUBLISHER_OBSERVATION_HOURS = 24;

/**
 * **THE STRUCTURAL BASIS SENTENCE, AND THERE IS ONE OF IT.** (ASK-18.)
 *
 * A calendar row with no agenda link is evidence, and this is the only
 * sentence allowed to describe it. One constructor rather than a string per
 * adapter, because the whole risk here is an adapter author writing something
 * a shade stronger — *"no agenda published"* instead of *"the listing carried
 * no agenda link"* — and that shade is the difference between describing a
 * page and making a claim about a government.
 *
 * It describes the PAGE. It never says whether an agenda exists.
 */
export function structuralBasisFor(sourceOrg: string): string {
  return (
    `${sourceOrg}'s own calendar listing for this meeting carried no agenda link when we ` +
    `read it`
  );
}

/**
 * Derive a first-party observation from a meeting record we already hold.
 *
 * **Why this exists.** `gapFor` has had a THEIRS branch since ASK-05 and it is
 * unreachable outside the Legistar lane: nothing else populates observations,
 * so every other body's answer falls to the OURS branch and tells a reader *we
 * have not yet acquired the agenda... we are still looking for it* about a
 * meeting whose body had simply not posted one. The owner checked at 8:30 that
 * morning, confirmed nothing was posted for either Pima sitting, and reported
 * the answer as the product blaming itself for someone else's timing.
 *
 * ## THE NARROWING THIS FUNCTION EXISTS TO ENFORCE, AND IT IS THE WHOLE POINT
 *
 * The first cut of this fired on `agendaUrl === null` and a first-party
 * provenance. `tests/agenda-publication-state.test.ts` refused it, correctly,
 * and the reason is the one thing that matters here:
 *
 * ```
 *   an EMPTY AGENDA CELL on a page that has one   is evidence
 *   a feed with NO AGENDA FIELD AT ALL            is not evidence of anything
 * ```
 *
 * A Legistar InSite grid prints a literal "Not Available" in an Agenda column
 * — the publisher saying something. A generic iCal feed has no agenda field, so
 * its silence measures the FEED FORMAT, not the docket. Many bodies also post
 * packets on a page the calendar never links. `agendaUrl === null` conflates
 * all three, and turning that into *"they have not posted an agenda"* is a
 * claim about a government drawn from the shape of a file format.
 *
 * So the caller must state that the surface it read HAS an agenda slot and
 * that the slot was empty. That is per-adapter knowledge and **no adapter
 * records it yet**, which means this returns null everywhere today. The seam
 * is built, wired and tested; what it needs is the adapter work, and naming
 * that precisely is more use than a derivation that would have shipped a false
 * absence to close a feedback row.
 */
export function observationFromMeetingRecord(meeting: {
  readonly id: string;
  readonly agendaUrl?: string | null;
  /**
   * The source surface carries an agenda slot for this sitting AND it was
   * empty when read. Set by the ADAPTER at the moment of the read; nothing may
   * infer it from a null `agendaUrl`, which is exactly the conflation above.
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
  /*
   * **THE GATE.** Absent means the adapter did not measure the publisher's
   * agenda state, and not-measured is never not-published.
   */
  if (meeting.agendaSlotObservedEmpty !== true) return null;
  /* An agenda we hold is not an absence to observe. */
  if (meeting.agendaUrl != null) return null;
  const p = meeting.provenance;
  /* No provenance is NOT an observation. A shape that dropped the fields
     produces nothing here rather than an observation with blanks in it. */
  if (!p) return null;
  /* A page we cannot name is a page a reader cannot check, and an
     unverifiable observation is an assertion wearing a timestamp. */
  if (!p.sourceUrl) return null;
  /* An aggregator's missing link says nothing about what the BODY posted. */
  if (p.secondHand === true) return null;
  /* A carried-forward row was NOT retrieved on the run that wrote it, so its
     `collectedAt` is not when this listing was read. Nothing about a carried
     row may render a freshness it does not have. */
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
  /**
   * A first-party reading exists and has aged past its window. It is KEPT and
   * NAMED — dropping it would lose the recheck obligation — and it may not be
   * rendered as current truth.
   */
  | "STALE_OBSERVATION";

/* ───────────────────────────────────────────────────── our own axis */

/**
 * How far THIS product got toward putting that sitting's agenda in front of a
 * reader. Every value is a fact about us, and none of them may be worded as a
 * fact about a government.
 */
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

/** One attempt at one route to the representation. A ROUTE fact (RULING 184). */
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
 * The pair, plus the one sentence a reader may be shown.
 *
 * `state` is the joined name, kept as a single string so a caller can log,
 * count or switch on one value; `publication` and `acquisition` remain
 * separately readable so nothing downstream has to parse it back apart.
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
   * **Is this product still on the hook to go and get it?**
   *
   * True for every state except `ITEMS_READER_READY`. A publisher reporting
   * "not posted yet" does NOT close it — the recheck is the obligation, and a
   * negative that closed the hunt would be RULING 170's finite attempt count
   * earning an absence.
   */
  readonly obligationOpen: boolean;
  /**
   * When the publication state must be measured again. Non-null whenever an
   * observation exists (its window end) and whenever the obligation is open
   * with no observation at all (immediately: `now`).
   */
  readonly recheckDueAt: string | null;
  /**
   * Is there another avenue left to try? True whenever nothing is reader-ready
   * — the universe of methods is not bounded (RULING 177), so this is false
   * only once the reader has the items.
   */
  readonly alternateSearchOpen: boolean;
  /** The version the reading was taken over. Null when nothing is held. */
  readonly currentDocumentUrl: string | null;
  /** Earlier versions of the same sitting's agenda, newest first. */
  readonly supersededDocumentUrls: readonly string[];
  /** True when we hold more than one version: the agenda was amended. */
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
   * The agenda link the publisher's calendar exposed for this sitting, when it
   * exposed one — `Meeting.agendaUrl`.
   *
   * A KNOWN LINK WE DID NOT FETCH is a different fact from no link at all, and
   * it is a fact about US either way: the presence of a link says a route
   * exists, its absence says only that this calendar row did not carry one.
   * Neither measures whether an agenda is posted, which is why neither can
   * reach the THEIRS branch.
   */
  readonly discoveredDocumentUrl?: string | null;
  /**
   * The whole document corpus, used for one thing: detecting that the URL we
   * hold for this sitting is also held for another, which makes it an index
   * page by construction. One page cannot be the agenda of two meetings.
   */
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

/**
 * Is this reading still current?
 *
 * An observation whose `observedAt` will not parse is NOT fresh. A stamp we
 * cannot read is not a stamp, and failing open here would let a malformed row
 * mint a permanent claim about a government.
 */
export function observationIsFresh(
  observation: PublisherAgendaObservation,
  now: number,
): boolean {
  const until = observationFreshUntil(observation);
  if (!until) return false;
  const at = Date.parse(observation.observedAt);
  /* A reading stamped in the future is not fresh either — it is a broken
     clock, and a broken clock must never be the thing that authorises a
     sentence about a government. */
  if (at > now) return false;
  return Date.parse(until) > now;
}

/**
 * The one observation a reading may rest on: the newest FIRST-PARTY one for
 * this exact meeting.
 *
 * Third-party and inferred rows are dropped here rather than downgraded later,
 * so there is no code path in which one of them reaches the THEIRS branch.
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
 * The stored extraction label is not evidence that its bytes are an agenda.
 * Older HTML readers stored document-viewer shells, portal navigation, and
 * even ZIP/DOCX bytes as text. These are representation facts, not a claim
 * about whether the publisher has posted an agenda. Keep the original bytes;
 * classify their reader use here, for both Ask and the meeting card.
 */
export function agendaDocumentRepresentation(document: AgendaDocumentLike):
  "TEXT" | "PUBLICATION_PORTAL" | "UNREADABLE" {
  const text = document.text;
  if (!text?.trim() || /^(?:PK\u0003\u0004|%PDF-)/.test(text) || text.includes("\u0000")) {
    return "UNREADABLE";
  }
  if (document.extraction !== "html") return "TEXT";
  let url: URL;
  try { url = new URL(document.documentUrl); } catch { return "TEXT"; }

  // Diligent/iCompass's meeting-specific URL is still a portal, even when
  // no other sitting shares the URL. Its accessible agenda is a linked file.
  if (/\/Portal\/(?:MeetingInformation\.aspx)?\/?$/i.test(url.pathname)
      && /Skip Navigation\s+Jump to SideBar\s+Quick Menu/i.test(text)
      && /(?:Board Application:|Schedule of Meetings|Upcoming Meetings)/i.test(text)) {
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

/**
 * **The reading. This is the only place `whose: "THEIRS"` can be produced for
 * an agenda, and it is produced from an observation or not at all.**
 */
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
  const versions = [...documentsForMeeting].sort((a, b) =>
    a.retrievedAt < b.retrievedAt ? 1 : -1,
  );
  const newest = versions[0] ?? null;
  const superseded = versions.slice(1).map((d) => d.documentUrl);
  const sharedWith = newest
    ? new Set(
        documentsAcrossCorpus
          .filter((d) => d.documentUrl === newest.documentUrl)
          .map((d) => d.meetingId),
      ).size
    : 0;
  const representation = newest ? agendaDocumentRepresentation(newest) : null;
  const governmentByMeeting = new Map(meetingsAcrossCorpus.map(meeting => [meeting.id, meeting.ocdId]));
  const documentSharedAcrossGovernments = newest ? new Set(documentsAcrossCorpus
    .filter(document => document.documentUrl === newest.documentUrl)
    .map(document => governmentByMeeting.get(document.meetingId))
    .filter((id): id is string => Boolean(id))).size > 1 : false;
  const items = !documentSharedAcrossGovernments && representation === "TEXT" && newest?.text ? agendaItems(newest.text) : [];
  const attempts = routeAttempts.filter((a) => a.meetingId === meetingId);
  const blocked = attempts.some((a) => a.outcome === "BLOCKED" || a.outcome === "FAILED");

  const acquisition: AgendaAcquisitionState = !newest
    ? blocked
      ? "ROUTE_BLOCKED"
      : discoveredDocumentUrl
        ? "REPRESENTATION_DISCOVERED"
        : "NOT_ACQUIRED"
    : representation === "UNREADABLE"
      ? "ACQUIRED_NOT_READABLE"
      : documentSharedAcrossGovernments || representation === "PUBLICATION_PORTAL" || (sharedWith > 1 && items.length === 0)
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
    revised: versions.length > 1,
    items,
  };
}

/**
 * **The sentence, and the attribution that goes with it.**
 *
 * Four of the five OURS sentences below are the four the body-agenda branch has
 * emitted since ASK-05, preserved word for word: a meeting with no readable
 * document, an index page, a document that would not yield items, and now the
 * one that used to be a claim about a government. They stay four DIFFERENT
 * sentences because RULING 100 asks an operation that can return nothing WHAT
 * it returned, and collapsing them would hand a reader one flat absence.
 *
 * RULING 139 applies to every one of them: the attribution is required, the
 * verdict on ourselves is struck. No apology, no "we failed", no
 * "unfortunately" — a fact and a next step.
 *
 * The one THEIRS sentence names the publisher and the day, because a claim
 * about a government that does not say who said it and when is not sourced,
 * and an unsourced claim about a government is the thing this product cannot
 * survive shipping.
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
   * **THE ONLY THEIRS BRANCH IN THIS FILE.**
   *
   * It is reachable only with a first-party observation that measured THIS
   * meeting, is inside its freshness window, and reports NOT_AVAILABLE. The
   * date is the day the surface was read, not today, so a reader can see the
   * age of the claim rather than being handed it as a standing fact.
   *
   * Note what it does NOT say: not "there is no agenda", not "none has been
   * published". It says what a named publisher's own page said on a named day,
   * which is the largest true statement the evidence supports.
   */
  if (publication === "REPORTS_NOT_AVAILABLE" && observation) {
    /*
     * **ASK-18 (2026-08-30) — THE SENTENCE LEADS WITH WHOSE FACT IT IS.**
     *
     * The clauses are unchanged and their ORDER is not. It read *"As of
     * <date>, <org> had not posted an agenda..."*, which buries the subject
     * behind a date and reads like hedging. The owner's instruction: *"we
     * should very clearly say that this agenda is not posted"*, and separately
     * that the map card's NO AGENDA POSTED YET is the right register.
     *
     * So the publisher and the fact come first and the date follows as the
     * scope it is. Nothing is added: this still says only what a named
     * publisher's own page showed on a named day, which is the largest true
     * statement the evidence supports. Not "there is no agenda". Not "none has
     * been published".
     */
    return {
      whose: "THEIRS",
      statement:
        `${observation.sourceOrg} has not posted an agenda for that ${bodyName} meeting — ` +
        `its own page showed none when we read it on ` +
        `${observation.observedAt.slice(0, 10)}. We are still checking.`,
    };
  }

  /*
   * Everything else — no observation, a stale one, or a publisher that says the
   * agenda IS up while we do not hold it — is OURS, and is worded to keep the
   * acquisition obligation OPEN. "have not yet acquired" is a fact about this
   * product's state at a moment. "has not been published" was a fact about a
   * government that nothing measured.
   */
  const tail =
    publication === "REPORTS_AVAILABLE" && observation
      ? ` ${observation.sourceOrg} shows one posted, and we are going after it.`
      : ` We are still looking for it.`;
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
 * **Where observations come from, and why this is a store rather than a file.**
 *
 * No ingest adapter records publisher publication state today, which is exactly
 * why the route was inventing it. The store is written the way
 * `lib/meetings/agenda-documents.ts` writes `AgendaDocumentStore` and states the
 * same lifetime honestly: in-memory, per-process, until persistence lands. An
 * adapter that reads a portal's "Agenda: not yet posted" cell calls
 * `recordPublisherAgendaObservation` at the moment of the read, and Ask starts
 * emitting the scoped THEIRS sentence for that sitting with no further change
 * here.
 *
 * **Empty is the correct and current content.** A reader today gets the OURS
 * gap for every sitting with no document, because that is the only thing this
 * product has actually measured.
 */
const observationStore = new Map<string, PublisherAgendaObservation[]>();

/**
 * Record one reading. Newest wins at read time; nothing is overwritten, so the
 * history of a docket's publication state survives for a later recheck to
 * reason over.
 */
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
