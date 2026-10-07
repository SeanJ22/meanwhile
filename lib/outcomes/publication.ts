/** What a publisher said about its own agenda, each surface's reading kept as an observation and never merged. */

import type { LegistarEvent } from "../sources/legistar/types.ts";

/** How the observation was come by; declared here rather than imported, so the source side never depends on `lib/ask/`. */
export type ObservationProvenance =
  | "FIRST_PARTY_PUBLISHER"
  | "THIRD_PARTY"
  | "INFERRED";

/** What the surface said about THIS sitting's agenda. */
export type AgendaReport = "NOT_AVAILABLE" | "AVAILABLE";

/** One reading of one publisher surface about one sitting's agenda; satisfies `PublisherAgendaObservation` field for field. */
export interface AgendaPublicationObservation {
  /** Scoped to exactly one sitting. */
  readonly meetingId: string;
  readonly provenance: ObservationProvenance;
  readonly report: AgendaReport;
  /** ISO instant the surface was read. Minted by the code that read it. */
  readonly observedAt: string;
  /** The surface that was read. Observed, never constructed. */
  readonly observedUrl: string;
  /** The publisher, as they name themselves; never the vendor. */
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
 * The portal grid's agenda cell as an observation: `status` is the verbatim quote. Decided by the same predicate the
 * adapter uses to emit a URL, so the two never disagree.
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
    // An empty cell is not a quotation, so the absence is described instead.
    evidenceQuote:
      status.length > 0
        ? status
        : "(the portal rendered an empty agenda cell for this sitting)",
    routeId: "INSITE_CALENDAR",
  };
}

/** The Web API's publication record as an observation. The document pointer says a document exists; the status string is only quoted. */
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
    // The sitting's own public permalink when given, else the API path this run read.
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
  /** The routes disagree, and neither wins: a document can appear on one surface first. */
  | "DISAGREE";

export interface ReconciledPublication {
  readonly meetingId: string;
  readonly agreement: PublicationAgreement;
  /** Every reading, kept. The input, never a filtered version of it. */
  readonly observations: readonly AgendaPublicationObservation[];
  /** The reading a consumer may act on, or null on `DISAGREE`, so no winner is ever picked. */
  readonly actionable: AgendaPublicationObservation | null;
  /** Always a sentence, including when everything agreed. */
  readonly note: string;
}

/** Reconcile every reading for one sitting without resolving a conflict; the most recent reading of each route is kept. */
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
