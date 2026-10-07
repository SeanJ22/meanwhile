/** Turning one walked sitting into one durable row, and deciding whether to walk it again. Pure: the caller fetches. */

import { legistarMeetingId } from "../sources/legistar/index.ts";
import { minutesPointerFor } from "../sources/legistar/outcomes.ts";
import type { EventOutcomes } from "../sources/legistar/outcomes.ts";
import type { LegistarEvent } from "../sources/legistar/types.ts";
import type { LegistarClient } from "../sources/legistar/client-registry.ts";

import { observationFromEvent } from "./publication.ts";
import type { AgendaPublicationObservation } from "./publication.ts";
import type {
  OutcomeSnapshot,
  PersistedPublicationStatus,
  PersistedSittingOutcomes,
} from "./types.ts";

/** The publisher's state for one sitting plus the instant observed, carried verbatim; no verdict is computed here. */
export function publicationStatusFor(
  event: LegistarEvent,
  observedAt: string,
): PersistedPublicationStatus {
  return {
    agendaStatusName: event.EventAgendaStatusName?.trim() || null,
    agendaStatusId: event.EventAgendaStatusId ?? null,
    agendaFile: event.EventAgendaFile?.trim() || null,
    agendaLastPublishedUtc: event.EventAgendaLastPublishedUTC?.trim() || null,
    minutesStatusName: event.EventMinutesStatusName?.trim() || null,
    minutesStatusId: event.EventMinutesStatusId ?? null,
    minutesFile: event.EventMinutesFile?.trim() || null,
    minutesLastPublishedUtc: event.EventMinutesLastPublishedUTC?.trim() || null,
    inSiteUrl: event.EventInSiteURL?.trim() || null,
    lastModifiedUtc: event.EventLastModifiedUtc?.trim() || null,
    videoStatus: event.EventVideoStatus?.trim() || null,
    observedAt,
  };
}

export interface PersistInput {
  readonly event: LegistarEvent;
  readonly client: LegistarClient;
  readonly collected: EventOutcomes;
  /** ISO instant of the observation. From the run, never invented per row. */
  readonly observedAt: string;
  /** ISO instant of the sitting's start, as `normalize()` computed it. */
  readonly startsAt: string | null;
  /** Route ids from `lib/sources/legistar/routes.ts` that actually succeeded. */
  readonly routesWalked: readonly string[];
  /** Set when the items route threw rather than returning rows; a request failure is not a zero-row reply. */
  readonly requestError?: string | null;
  /** Readings of other publisher surfaces for this sitting, appended beside the Web API's reading, never merged. */
  readonly publicationObservations?: readonly AgendaPublicationObservation[];
}

/** One walked sitting as one durable row. A zero-row items reply is `ZERO_ROWS_FAILED`, never an empty agenda. */
export function toPersistedSitting(input: PersistInput): PersistedSittingOutcomes {
  const { event, client, collected } = input;

  let extraction: PersistedSittingOutcomes["extraction"] = "RETRIEVED";
  let extractionNote: string | null = null;

  if (input.requestError) {
    extraction = "REQUEST_FAILED";
    extractionNote =
      `The agenda-items request for this sitting failed: ${input.requestError}. ` +
      "Nothing is claimed about what this sitting contained; the route is retryable " +
      "and stays open.";
  } else if (collected.agenda.length === 0) {
    extraction = "ZERO_ROWS_FAILED";
    extractionNote =
      "The eventitems route returned ZERO rows for this sitting. A zero-row " +
      "extraction is a FAILED extraction, never an agenda with nothing on it, " +
      "so no claim is made about what was noticed or decided here.";
  }

  return {
    meetingId: legistarMeetingId(client.slug, event.EventId),
    bodyId: client.bodyId,
    ocdId: client.ocdId,
    slug: client.slug,
    eventId: event.EventId,
    bodyName: event.EventBodyName,
    jurisdiction: client.jurisdiction,
    startsAt: input.startsAt,
    sourceOrg: client.publishingOrg,
    sourceUrl: event.EventInSiteURL?.trim() || null,
    extraction,
    extractionNote,
    publication: publicationStatusFor(event, input.observedAt),
    minutesPointer: minutesPointerFor(event),
    agenda: collected.agenda,
    outcomes: collected.outcomes,
    rollCalls: collected.rollCalls,
    failedRollCallExtractions: collected.failedRollCallExtractions,
    voteRequestFailures: collected.voteRequestFailures,
    routesWalked: input.routesWalked,
    // The Web API's publication record as one observation; a portal reading is appended separately, never merged.
    publicationObservations: [
      observationFromEvent({
        meetingId: legistarMeetingId(client.slug, event.EventId),
        event,
        sourceOrg: client.publishingOrg,
        observedAt: input.observedAt,
      }),
      ...(input.publicationObservations ?? []),
    ],
  };
}

/** Why a sitting is being walked, or why it is skipped; a skip needs a reason too. */
export type RefreshReason =
  /** Never seen. The backfill case. */
  | "NEW"
  /** The publisher's own modification stamp moved since we read it. */
  | "PUBLISHER_MODIFIED"
  /** We hold it, and our last extraction failed. Retryable, so retried. */
  | "PRIOR_EXTRACTION_FAILED"
  /** We hold it, and some votes requests are still open. */
  | "OPEN_VOTE_FAILURES"
  /** No modification stamp, so a change cannot be ruled out: fails toward walking. */
  | "NO_MODIFICATION_STAMP"
  /** Held, unchanged, complete. The steady state, and the point of all this. */
  | "UNCHANGED_SKIP"
  /** An operator asked for a rewalk for a change in our transform, which the publisher's stamp cannot see. */
  | "FORCED";

export interface RefreshDecision {
  readonly walk: boolean;
  readonly reason: RefreshReason;
}

/** Whether to walk a sitting again, keyed on the publisher's own `EventLastModifiedUtc`; every ambiguous case walks. */
export function refreshDecision(
  event: LegistarEvent,
  held: PersistedSittingOutcomes | undefined,
): RefreshDecision {
  if (held === undefined) return { walk: true, reason: "NEW" };
  if (held.extraction !== "RETRIEVED") {
    return { walk: true, reason: "PRIOR_EXTRACTION_FAILED" };
  }
  if (held.voteRequestFailures.length > 0) {
    return { walk: true, reason: "OPEN_VOTE_FAILURES" };
  }

  const now = event.EventLastModifiedUtc?.trim() || null;
  const then = held.publication.lastModifiedUtc?.trim() || null;
  if (now === null || then === null) {
    return { walk: true, reason: "NO_MODIFICATION_STAMP" };
  }
  if (now !== then) return { walk: true, reason: "PUBLISHER_MODIFIED" };
  return { walk: false, reason: "UNCHANGED_SKIP" };
}

/** Fold newly walked sittings into the held store, keyed on `meetingId`, incoming wins, everything else preserved. Sorted by id. */
export function mergeSnapshot(
  held: OutcomeSnapshot,
  incoming: readonly PersistedSittingOutcomes[],
  stamped: { readonly generatedOn: string; readonly generatedAt: string },
): OutcomeSnapshot {
  const byId = new Map<string, PersistedSittingOutcomes>();
  for (const sitting of held.sittings) byId.set(sitting.meetingId, sitting);
  for (const sitting of incoming) byId.set(sitting.meetingId, sitting);

  const sittings = [...byId.values()].sort((a, b) =>
    a.meetingId.localeCompare(b.meetingId),
  );

  return {
    generatedOn: stamped.generatedOn,
    generatedAt: stamped.generatedAt,
    tenants: [...new Set(sittings.map((s) => s.slug))].sort(),
    sittings,
  };
}

/** What one ingest run actually did. Reported, never estimated. */
export interface IngestTally {
  sittingsSeen: number;
  walked: number;
  skippedUnchanged: number;
  items: number;
  actedItems: number;
  rollCalls: number;
  voteRows: number;
  failedRollCallExtractions: number;
  voteRequestFailures: number;
  zeroRowSittings: number;
}

/** A fresh tally. Written as a factory so a run cannot share one by accident. */
export function emptyTally(): IngestTally {
  return {
    sittingsSeen: 0,
    walked: 0,
    skippedUnchanged: 0,
    items: 0,
    actedItems: 0,
    rollCalls: 0,
    voteRows: 0,
    failedRollCallExtractions: 0,
    voteRequestFailures: 0,
    zeroRowSittings: 0,
  };
}

/** Add one persisted sitting's measurements to a run tally. */
export function countSitting(tally: IngestTally, sitting: PersistedSittingOutcomes): void {
  tally.walked += 1;
  tally.items += sitting.agenda.length;
  tally.actedItems += sitting.outcomes.length;
  tally.rollCalls += sitting.rollCalls.length;
  tally.voteRows += sitting.rollCalls.reduce((sum, roll) => sum + roll.votes.length, 0);
  tally.failedRollCallExtractions += sitting.failedRollCallExtractions.length;
  tally.voteRequestFailures += sitting.voteRequestFailures.length;
  if (sitting.extraction === "ZERO_ROWS_FAILED") tally.zeroRowSittings += 1;
}
