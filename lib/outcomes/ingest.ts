/**
 * **TURNING ONE WALKED SITTING INTO ONE DURABLE ROW — and deciding whether to
 * walk it again at all.**
 * (WS-LEGI, 2026-08-29.)
 *
 * Pure. Nothing here fetches; `scripts/legistar-outcomes-ingest.mts` does the
 * fetching and hands the results in. That split is what lets the acquisition
 * POLICY — the part that decides how many requests a tenant is asked for — be
 * tested against fixtures instead of against a county's web server.
 *
 * ## The source cost is real, and it is designed for rather than refused
 *
 * One request per acted item is what a per-person roll call costs on this API.
 * On Pima that is **545 vote requests across 20 sittings** (measured 2026-08-29:
 * 525 acted items plus the 20 attendance roll-call items, which are asked about
 * because a per-person record could be there and asking only one of the two
 * places is how the other becomes an asserted absence). At the adapter's
 * 350 ms spacing that is a little over three minutes of one tenant's time for
 * four months of its history.
 *
 * That is an ENGINEERING PARAMETER, not a reason to decline the source. What
 * makes it sustainable is that it is paid ONCE:
 *
 * 1. **Bounded historical backfill.** A window and a per-run sitting budget, so
 *    a first run on a new tenant is bounded and resumable rather than an
 *    open-ended crawl.
 * 2. **Incremental refresh afterwards**, keyed on the publisher's own
 *    `EventLastModifiedUtc` — see {@link refreshDecision}. A sitting the
 *    publisher has not touched costs ONE request to confirm, not 58.
 * 3. **Durable resume.** Every completed sitting is written before the next is
 *    started, so an interrupted run resumes at the cursor rather than restarting.
 * 4. **Retryable failures stay open.** A votes request that threw is persisted
 *    as a failure and re-asked next run. It is never converted into an absence,
 *    which is the one outcome that would make the saving permanent.
 *
 * The steady-state cost after the first backfill is one `events` request per
 * tenant per refresh, plus the items and votes for only those sittings whose
 * own modification stamp moved.
 */

import { legistarMeetingId } from "../sources/legistar/index.ts";
import { minutesPointerFor } from "../sources/legistar/outcomes.ts";
import type { EventOutcomes } from "../sources/legistar/outcomes.ts";
import type { LegistarEvent } from "../sources/legistar/types.ts";
import type { LegistarClient } from "../sources/legistar/clients.ts";

import { observationFromEvent } from "./publication.ts";
import type { AgendaPublicationObservation } from "./publication.ts";
import type {
  OutcomeSnapshot,
  PersistedPublicationStatus,
  PersistedSittingOutcomes,
} from "./types.ts";

/**
 * The publisher's state for one sitting, plus the instant we observed it.
 *
 * Every field is carried across verbatim. Nothing is normalised, nothing is
 * ranked, and no verdict is computed — "is the agenda published" is a question
 * the *consuming* vocabulary answers from these fields, and a boolean minted
 * here would be this module quietly deciding what "published" means for every
 * tenant in the country.
 */
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
  /**
   * Set when the items route itself threw rather than returning rows. A request
   * failure and a zero-row reply are different states and are kept apart here
   * because only one of them is retryable for a different reason.
   */
  readonly requestError?: string | null;
  /**
   * Readings of OTHER publisher surfaces for this same sitting — in practice the
   * InSite portal grid's agenda cell, which `normalizeWithDrops` now keeps
   * rather than discarding. Appended beside the Web API's own reading, never
   * merged with it.
   */
  readonly publicationObservations?: readonly AgendaPublicationObservation[];
}

/**
 * One walked sitting as one durable row.
 *
 * **The zero-row branch is the RULING 100 branch.** A sitting whose items route
 * returned an empty array is persisted with `extraction: "ZERO_ROWS_FAILED"` and
 * a sentence saying so. It is never written as a sitting whose agenda was empty,
 * because those two states are indistinguishable in a row count and only one of
 * them is a fact about the body.
 */
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
      "extraction is a FAILED extraction, never an agenda with nothing on it " +
      "(RULING 100), so no claim is made about what was noticed or decided here.";
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
    /*
     * The Web API's structured publication record, as an observation. Any
     * reading of the PORTAL grid for the same sitting is a second, independent
     * representation and is appended by the caller that read it — never merged
     * into this one, because two surfaces agreeing is evidence and one surface
     * overwriting the other is the loss of it (RULING 207).
     */
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

/**
 * Why a sitting is being walked, or why it is being skipped.
 *
 * A skip needs a reason as much as a walk does: an unexplained skip in a
 * refresh is how a sitting silently stops being collected.
 */
export type RefreshReason =
  /** Never seen. The backfill case. */
  | "NEW"
  /** The publisher's own modification stamp moved since we read it. */
  | "PUBLISHER_MODIFIED"
  /** We hold it, and our last extraction failed. Retryable, so retried. */
  | "PRIOR_EXTRACTION_FAILED"
  /** We hold it, and some votes requests are still open. */
  | "OPEN_VOTE_FAILURES"
  /**
   * The publisher gives us no modification stamp, so we cannot tell whether it
   * changed. `CANNOT_TELL` fails safe toward WALKING (RULING 182): the cost of
   * re-reading a sitting that did not change is a few requests, and the cost of
   * skipping one that did is a stale record served as current.
   */
  | "NO_MODIFICATION_STAMP"
  /** Held, unchanged, complete. The steady state, and the point of all this. */
  | "UNCHANGED_SKIP"
  /**
   * An operator asked for a rewalk regardless of the publisher's stamp — for a
   * change in OUR transform, which the publisher's stamp cannot see.
   *
   * Its own reason rather than borrowing `PUBLISHER_MODIFIED`, because the log
   * line is the only record of why a sitting was re-read and writing "the
   * publisher modified it" when nobody did is a false statement about a
   * government in a place nobody would ever check.
   */
  | "FORCED";

export interface RefreshDecision {
  readonly walk: boolean;
  readonly reason: RefreshReason;
}

/**
 * **INCREMENTAL REFRESH — should this sitting be walked again?**
 *
 * `EventLastModifiedUtc` is the publisher's own statement that the row changed,
 * and it is the correct key precisely because it is theirs: a cadence of ours
 * ("re-walk every 14 days") re-reads sittings nobody touched and misses the one
 * amended an hour ago.
 *
 * It fails toward walking in every ambiguous case. An absent stamp, a stamp we
 * never recorded, or an unreadable one all walk. The only skip is the
 * affirmative one: we hold this sitting, its extraction succeeded, no vote
 * request is still open, and the publisher's stamp is byte-identical to the one
 * we stored.
 */
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

/**
 * Fold newly walked sittings into the held store.
 *
 * Keyed on `meetingId`, incoming wins, and everything else is preserved — which
 * is what makes an interrupted run resumable and what makes a single-tenant
 * refresh safe to run against a store holding several tenants. A run that
 * walked Mesa must not be able to drop Pima, and a merge that rebuilt the array
 * from only what this run saw would do exactly that.
 *
 * Sorted by meeting id so the committed artefact has a stable diff.
 */
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
