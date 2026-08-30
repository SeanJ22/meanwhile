/**
 * **WHAT THE PUBLISHER SAID ABOUT ITS OWN AGENDA — kept, not thrown away.**
 * (WS-LEGI, 2026-08-29.)
 *
 * ## The reading that was being discarded
 *
 * `lib/sources/legistar-insite/index.ts` reads the portal grid's agenda column
 * for every sitting. The cell carries a VERBATIM string the body published —
 * "Not Available", "Agenda", "Agenda and Addendum" — and the adapter used it for
 * exactly one thing: deciding whether to emit an `agendaUrl`. When the cell said
 * "Not Available" the URL became null and **the reading itself was dropped on
 * the floor.**
 *
 * Its own comment said what that cost: the null "renders as the NAMED GAP it is
 * — the body has not posted an agenda". That sentence is a claim about a
 * government, and after the drop the only thing left to support it was our own
 * empty field. The government's actual statement — the one that could have
 * supported the claim honestly — had been read, understood, and discarded in the
 * same expression.
 *
 * This module is where it goes instead.
 *
 * ## Two representations of one fact, and NEITHER retires the other
 *
 * The same fact is published twice, in two shapes, by two routes:
 *
 * | route | shape | what it says |
 * |---|---|---|
 * | `INSITE_CALENDAR` | HTML grid cell | the clerk's label, verbatim |
 * | `WEBAPI_EVENT` | `EventAgendaStatusName` + `EventAgendaFile` + `EventAgendaLastPublishedUTC` | the structured record |
 *
 * **RULING 207: one route succeeding never retires another.** So both are
 * recorded and {@link reconcilePublicationObservations} names their relationship
 * rather than picking a winner. They can genuinely disagree — the API returns
 * only sittings whose InSite detail page is publicly viewable, so a sitting the
 * grid lists can be absent from the API entirely, and a document published
 * between two reads shows up in one representation before the other. A
 * disagreement is INFORMATION about how fresh each surface is, and the moment
 * one is allowed to silently win, that information is gone.
 *
 * ## Provenance decides what may ever be SAID, and it is not a formality
 *
 * `lib/ask/agenda-publication.ts` will only let `FIRST_PARTY_PUBLISHER` reach a
 * sentence about a government. That classification is a real judgement and it is
 * made here, explicitly, rather than defaulted:
 *
 * **The tenant-branded Legistar surfaces are first-party.** `pima.legistar.com`
 * and `webapi.legistar.com/v1/pima` serve the Pima County Clerk of the Board's
 * OWN record. Granicus is the software the clerk publishes through, in the way
 * a city's newsroom is the software a city publishes through; the "Not
 * Available" cell is the clerk having attached no agenda document to that event,
 * not a vendor's opinion about the county. The county links readers to this
 * portal from `pima.gov` as its meeting information.
 *
 * **A genuine aggregator would NOT qualify** and must be classed `THIRD_PARTY`:
 * a regional meeting-search site, a news database, anything republishing a
 * body's docket without the body's own record behind it. The line is whether the
 * surface renders the BODY'S OWN RECORD or somebody's copy of it.
 *
 * **Anything derived from our own collection state is `INFERRED`** and can never
 * become a claim about a government whatever else is true of it. Nothing in this
 * module ever mints one; the type exists so that if a later caller is tempted,
 * it has a structurally harmless place to put it.
 */

import type { LegistarEvent } from "../sources/legistar/types.ts";

/**
 * How the observation was come by.
 *
 * Structurally identical to `PublisherObservationProvenance` in
 * `lib/ask/agenda-publication.ts` and deliberately declared here rather than
 * imported: this module is a SOURCE-side producer and `lib/ask/` is a
 * reader-side consumer. An import would make the collection layer depend on the
 * rendering layer, and the handoff is a shape, not a package.
 */
export type ObservationProvenance =
  | "FIRST_PARTY_PUBLISHER"
  | "THIRD_PARTY"
  | "INFERRED";

/** What the surface said about THIS sitting's agenda. */
export type AgendaReport = "NOT_AVAILABLE" | "AVAILABLE";

/**
 * One reading of one publisher surface about ONE sitting's agenda.
 *
 * Every field is required because every one is load-bearing for the question
 * *may this become a sentence about a government?* Satisfies
 * `PublisherAgendaObservation` in `lib/ask/agenda-publication.ts` field for
 * field, so the integration owner can hand it straight to
 * `classifyAgendaPublication`.
 */
export interface AgendaPublicationObservation {
  /** `legistar:pima:1825`. Scoping to ONE sitting is the whole rule. */
  readonly meetingId: string;
  readonly provenance: ObservationProvenance;
  readonly report: AgendaReport;
  /** ISO instant the surface was read. Minted by the code that read it. */
  readonly observedAt: string;
  /** The surface that was read. Observed, never constructed. */
  readonly observedUrl: string;
  /** The publisher, as they name themselves. Never "Granicus". */
  readonly sourceOrg: string;
  /**
   * **What the surface ACTUALLY SAID**, verbatim and trimmed. A report with no
   * quoted basis is an assertion, and this product does not carry those.
   */
  readonly evidenceQuote: string;
  /** Which route in `lib/sources/legistar/routes.ts` produced this reading. */
  readonly routeId: string;
  /** Hours this reading may stand as current. Omitted takes the consumer's default. */
  readonly freshnessHours?: number;
}

/**
 * The portal grid's agenda cell, as an observation.
 *
 * `status` is the cell's verbatim text and becomes the evidence quote unchanged
 * — including its capitalisation and any trailing punctuation the template
 * emitted. Normalising it would destroy the only thing that makes this a
 * quotation rather than our summary of one.
 *
 * The report is decided by the SAME predicate the adapter uses to decide whether
 * to emit a URL, so the observation and the `agendaUrl` can never disagree with
 * each other about what the cell said.
 */
export function observationFromGridCell(input: {
  readonly meetingId: string;
  readonly status: string;
  readonly href: string | null;
  readonly calendarUrl: string;
  readonly sourceOrg: string;
  readonly observedAt: string;
}): AgendaPublicationObservation {
  const status = input.status.trim();
  const available = input.href !== null && !/not available/i.test(status);
  return {
    meetingId: input.meetingId,
    // See this file's header: a tenant-branded Legistar portal renders the
    // clerk's own record, and that is what first-party means here.
    provenance: "FIRST_PARTY_PUBLISHER",
    report: available ? "AVAILABLE" : "NOT_AVAILABLE",
    observedAt: input.observedAt,
    observedUrl: input.calendarUrl,
    sourceOrg: input.sourceOrg,
    /*
     * An EMPTY cell is not a quotation. The grid renders no text at all for some
     * rows, and "" as an evidence quote would be a report with no basis wearing
     * the shape of one — so the absence is described instead, in words that say
     * it is a description.
     */
    evidenceQuote:
      status.length > 0
        ? status
        : "(the portal rendered an empty agenda cell for this sitting)",
    routeId: "INSITE_CALENDAR",
  };
}

/**
 * The Web API's structured publication record, as an observation.
 *
 * `EventAgendaStatusName` alone is NOT the fact. Pima returns "Final" on every
 * sitting including ones with no document, so reading the status string as
 * availability would report 20 of 20 agendas published where the portal grid
 * says otherwise. **The document pointer is what says a document exists**, and
 * the status string is quoted beside it as what the publisher called its state.
 */
export function observationFromEvent(input: {
  readonly meetingId: string;
  readonly event: LegistarEvent;
  readonly sourceOrg: string;
  readonly observedAt: string;
}): AgendaPublicationObservation {
  const { event } = input;
  const file = event.EventAgendaFile?.trim() || null;
  const status = event.EventAgendaStatusName?.trim() || null;
  const published = event.EventAgendaLastPublishedUTC?.trim() || null;

  return {
    meetingId: input.meetingId,
    provenance: "FIRST_PARTY_PUBLISHER",
    report: file !== null ? "AVAILABLE" : "NOT_AVAILABLE",
    observedAt: input.observedAt,
    /*
     * The sitting's own public permalink when the publisher gives one, because
     * that is the surface a reader can go and check. The API path is the
     * fallback and it is still a URL this run actually read.
     */
    observedUrl:
      event.EventInSiteURL?.trim() ||
      `https://webapi.legistar.com/v1/events/${event.EventId}`,
    sourceOrg: input.sourceOrg,
    evidenceQuote:
      `EventAgendaStatusName=${status ?? "null"}; ` +
      `EventAgendaFile=${file ?? "null"}; ` +
      `EventAgendaLastPublishedUTC=${published ?? "null"}`,
    routeId: "WEBAPI_EVENT",
  };
}

/** How two or more readings of one sitting relate. Named, never resolved away. */
export type PublicationAgreement =
  /** Only one route reported. Nothing to reconcile, and nothing corroborated. */
  | "SINGLE_ROUTE"
  /** Every route that reported agrees an agenda is posted. */
  | "AGREE_AVAILABLE"
  /** Every route that reported agrees none is posted. The strongest negative. */
  | "AGREE_NOT_AVAILABLE"
  /**
   * The routes DISAGREE. Neither wins here.
   *
   * A real and expected state, not a bug: a document published between two reads
   * appears in one representation first, and the Web API omits sittings whose
   * detail page is not publicly viewable while the grid still lists them. The
   * disagreement is information about the surfaces and is reported as such.
   */
  | "DISAGREE";

export interface ReconciledPublication {
  readonly meetingId: string;
  readonly agreement: PublicationAgreement;
  /** Every reading, kept. The input, never a filtered version of it. */
  readonly observations: readonly AgendaPublicationObservation[];
  /**
   * The reading a consumer may act on, or NULL on `DISAGREE`.
   *
   * Null is the whole point. A disagreement that produced a "best" reading would
   * be this function picking a winner in a field a caller would then treat as
   * settled — so on a conflict there is nothing to pick up, and the caller has
   * to look at `observations` and say that the surfaces disagree.
   */
  readonly actionable: AgendaPublicationObservation | null;
  /** Always a sentence, including when everything agreed. */
  readonly note: string;
}

/**
 * Reconcile every reading held for one sitting WITHOUT resolving a conflict.
 *
 * The most recent reading of each route is kept — a route re-read is a newer
 * measurement of the same surface and there is no value in holding both — and
 * then the routes are compared to each other, which is the comparison that
 * cannot be collapsed.
 */
export function reconcilePublicationObservations(
  meetingId: string,
  observations: readonly AgendaPublicationObservation[],
): ReconciledPublication {
  const scoped = observations.filter((o) => o.meetingId === meetingId);

  if (scoped.length === 0) {
    return {
      meetingId,
      agreement: "SINGLE_ROUTE",
      observations: [],
      actionable: null,
      note:
        "No publisher surface has been read for this sitting. Nothing may be said " +
        "about whether its agenda is posted — that is the absence of a reading, " +
        "not a reading of an absence.",
    };
  }

  const latestByRoute = new Map<string, AgendaPublicationObservation>();
  for (const observation of scoped) {
    const held = latestByRoute.get(observation.routeId);
    if (held === undefined || observation.observedAt > held.observedAt) {
      latestByRoute.set(observation.routeId, observation);
    }
  }
  const latest = [...latestByRoute.values()].sort((a, b) =>
    b.observedAt.localeCompare(a.observedAt),
  );

  if (latest.length === 1) {
    const only = latest[0]!;
    return {
      meetingId,
      agreement: "SINGLE_ROUTE",
      observations: latest,
      actionable: only,
      note:
        `Read on one surface only (${only.routeId}). The reading stands and it is ` +
        "uncorroborated — no second representation of this sitting has been read.",
    };
  }

  const reports = new Set(latest.map((o) => o.report));
  if (reports.size > 1) {
    return {
      meetingId,
      agreement: "DISAGREE",
      observations: latest,
      actionable: null,
      note:
        "The publisher's own surfaces disagree about whether this sitting's agenda " +
        "is posted: " +
        latest.map((o) => `${o.routeId} says ${o.report}`).join("; ") +
        ". Neither reading is preferred here. One route succeeding never retires " +
        "another (RULING 207), and a document published between two reads appears " +
        "on one surface before the other — so the disagreement is reported rather " +
        "than resolved.",
    };
  }

  const agreed = latest[0]!;
  return {
    meetingId,
    agreement: agreed.report === "AVAILABLE" ? "AGREE_AVAILABLE" : "AGREE_NOT_AVAILABLE",
    observations: latest,
    actionable: agreed,
    note:
      `${latest.length} independent publisher surfaces agree (${latest
        .map((o) => o.routeId)
        .join(", ")}) that the agenda is ${agreed.report}.`,
  };
}
