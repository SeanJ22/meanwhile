/**
 * Run one source adapter locally.
 *
 *   pnpm ingest mock
 *   pnpm ingest composite -- --promote --only-partition=<contract-id>
 *
 * Adapters are looked up by directory name under lib/sources/. Adding a
 * source means adding a directory and wiring rows, never editing this file's
 * logic — only the map below gains an entry.
 *
 * `composite` additionally prints the per-child report (fetched, normalized,
 * drops split by reason, failures) and retrieves agenda documents for the
 * meetings that carry one — capped and serialized, with unchanged documents
 * skipped by content hash.
 */

import { pathToFileURL } from "node:url";

import {
  agendaDocumentStore,
  retrieveAgendaDocument,
} from "../lib/meetings/agenda-documents.ts";
import {
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
  meetingReaderServingWindowAt,
} from "../lib/meetings/constants.ts";
import {
  attributionSummary,
  resolveMeetingBodies,
} from "../lib/meetings/attribution.ts";
import { agendaItems } from "../lib/routing/agenda-search.ts";
import {
  readMeetingPartitionProjection,
  snapshotCounts,
  validateSnapshot,
  MEETINGS_RECORD_CLASS,
  MEETINGS_SOURCE_ID,
  type MeetingsSnapshot,
} from "../lib/meetings/snapshot.ts";
import { failedAcquisitionCandidate, meetingsCandidate, sha256 } from "../lib/civic-data/candidate-builders.ts";
import { agendaDocumentRecordKey } from "../lib/civic-data/changes.ts";
import {
  processRegisteredMeetingPartitionCandidate,
  type PromotionOutcome,
} from "../lib/civic-data/promotion.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import {
  PostgresRoutineDataStore,
  type RoutineDataStore,
} from "../lib/civic-data/store.ts";
import type { RoutineCandidate, RoutineRemovalEvidence } from "../lib/civic-data/types.ts";
import {
  meetingPartitionContract,
  type MeetingPartitionContract,
} from "../lib/civic-data/meeting-partitions.ts";
import { authorityFor } from "../lib/civic-data/source-authority.ts";
import { makeApptegySource } from "../lib/sources/apptegy/index.ts";
import { makeCivicPlusSource } from "../lib/sources/civicplus/index.ts";
import { CompositeSource } from "../lib/sources/composite/index.ts";
import { occurrenceStampFromInstant, supersedesSeriesRecord } from "../lib/sources/event-identity.ts";
import {
  STANDING_PARTITION_ACQUISITION_TIMEOUT_MS,
  buildCompositeSource,
  wiringForSourceName,
} from "../lib/sources/composite/wiring.ts";
import { makeDiligentSource } from "../lib/sources/diligent/index.ts";
import { makeIqm2Source } from "../lib/sources/iqm2/index.ts";
import { makeRevizeSource } from "../lib/sources/revize/index.ts";
import { legistarSource } from "../lib/sources/legistar/index.ts";
import { makeOnBaseSource } from "../lib/sources/onbase/index.ts";
import { mockSource } from "../lib/sources/mock/index.ts";
import { SOURCE_WIRING, isRetiredMeetingHost, wiringForTypes } from "../lib/registry/source-wiring.ts";
import { isDisallowedLegistarHost } from "../lib/sources/legistar/routes.ts";
import type { Registry } from "../lib/registry/types.ts";
import { getRegistryRuntimeReadModel, refreshRegistryRuntimeFromPromoted } from "../lib/registry/runtime-read-model.ts";
import { refreshVenueResolutionsFromPromoted } from "../lib/civic-data/curated-reader-read-model.ts";
import type { Meeting, MeetingSource, PublisherExclusion, RecurrenceReport } from "../lib/sources/types.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { retainMeetingFetchBytes, retainMeetingCandidateEvidence, readMeetingResearchWitness,
  type RetainedSourceResponse, type ApprovedResearchMeetingPartition } from "../lib/civic-data/meeting-research-evidence.ts";

/*
 * The committed registry, read the same way lib/registry/server.ts reads it:
 * a build output whose JSON widens to string where the type wants a union.
 * Cast once, here, rather than at each use.
 */
let REGISTRY: Registry | null = null;

const SOURCES: Record<string, () => MeetingSource<unknown>> = {
  mock: () => mockSource as unknown as MeetingSource<unknown>,
  // Everything below hits the network. Serialized and paced — see
  // lib/sources/http.ts and lib/sources/legistar/client.ts.
  legistar: () => legistarSource as unknown as MeetingSource<unknown>,
  civicplus: () =>
    makeCivicPlusSource(wiringForTypes(["CIVICPLUS"])) as unknown as MeetingSource<unknown>,
  onbase: () =>
    makeOnBaseSource(wiringForTypes(["ONBASE"])) as unknown as MeetingSource<unknown>,
  apptegy: () =>
    makeApptegySource(wiringForTypes(["APPTEGY"])) as unknown as MeetingSource<unknown>,
  diligent: () =>
    makeDiligentSource(wiringForTypes(["DILIGENT", "CIVICWEB"])) as unknown as MeetingSource<unknown>,
  iqm2: () =>
    makeIqm2Source(wiringForTypes(["IQM2"])) as unknown as MeetingSource<unknown>,
  revize: () =>
    makeRevizeSource(wiringForTypes(["REVIZE"])) as unknown as MeetingSource<unknown>,
  // F22: the standing partition budget, not the Reader's request budget.
  composite: () =>
    buildCompositeSource({
      timeoutMs: STANDING_PARTITION_ACQUISITION_TIMEOUT_MS,
      captureAcquisitionEvidence: true,
    }) as unknown as MeetingSource<unknown>,
};

/** How many agenda documents one ingest run will fetch. Politeness, not coverage. */
const AGENDA_RETRIEVAL_CAP = 8;

export function selectedMeetingPartitions(args: readonly string[]): readonly MeetingPartitionContract[] {
  if (args.some((arg) => arg.startsWith("--partitions="))) {
    throw new Error("MEETING_PARTITION_BATCH_ARGUMENT_RETIRED");
  }
  const requested = args
    .filter((arg) => arg.startsWith("--only-partition="))
    .map((arg) => arg.slice("--only-partition=".length));
  if (requested.length !== 1 || !requested[0]) {
    throw new Error("MEETING_PARTITION_EXACTLY_ONE_REQUIRED");
  }
  const partition = meetingPartitionContract(requested[0]);
  if (!partition) throw new Error(`MEETING_PARTITION_NOT_REGISTERED:${requested[0]}`);
  return [partition];
}

export async function preloadCanonicalMeetingDependencies(input: {
  readonly sourceName: string;
  readonly refreshRegistry?: () => Promise<unknown>;
  readonly refreshVenues?: () => Promise<unknown>;
}): Promise<void> {
  const refreshRegistry = input.refreshRegistry ?? refreshRegistryRuntimeFromPromoted;
  const refreshVenues = input.refreshVenues ?? refreshVenueResolutionsFromPromoted;
  await Promise.all([
    refreshRegistry(),
    ...(input.sourceName === "composite" || input.sourceName === "legistar"
      ? [refreshVenues()]
      : []),
  ]);
}

/**
 * A meeting's document URL: its own agenda link, or — for a scheduled
 * meeting with none — the body's curated notice page (4c). The notice a
 * board posts on its own site is the content a reader needs while the
 * vendor portal's agenda is still unpublished.
 */
function documentUrlFor(meeting: Meeting): string | null {
  if (meeting.agendaUrl) return meeting.agendaUrl;
  if (meeting.status !== "SCHEDULED") return null;
  /*
   * **THE NOTICE PAGE BELONGS TO A BODY, NOT TO A DIVISION** (NH Hunt 4,
   * 2026-08-21).
   *
   * This used to take the FIRST wiring row on the meeting's division that
   * carried a notice URL. That was harmless while one division had one wired
   * body and became a wrong document the moment a division had two: adding the
   * Lake Todd Village District to Newbury's division attached Lake Todd's
   * notice page to the Town of Newbury's own meetings, and the ingest went and
   * fetched it for them. A collapsing join, exactly the D40 shape — one key
   * standing in for many rows.
   *
   * So the body is matched first, by the name the wiring itself publishes. The
   * division-wide fallback survives, because a town whose boards all share one
   * calendar page is the common case and it is correct — but only when every
   * notice URL on that division AGREES. Where they disagree, there is no
   * single right answer and this returns nothing rather than picking one.
   */
  const onDivision = SOURCE_WIRING.filter(
    (row) => row.noticeUrl && row.ocdId !== null && row.ocdId === meeting.ocdId,
  );
  if (onDivision.length === 0) return null;
  const forBody = onDivision.find(
    (row) => (row.config.bodyName ?? row.publishingOrg) === meeting.bodyName,
  );
  if (forBody) return forBody.noticeUrl ?? null;
  const distinct = new Set(onDivision.map((row) => row.noticeUrl));
  return distinct.size === 1 ? (onDivision[0].noticeUrl ?? null) : null;
}

/**
 * Why an agenda link is held as a link and not read: its host is a retired
 * route's, or a route catalogue records the host as DISALLOWED (robots.txt
 * refuses this client). Null when the document may be requested.
 */
export function agendaRetrievalRefusal(url: string): "RETIRED_ROUTE" | "RECORDED_DISALLOWED" | null {
  if (isRetiredMeetingHost(url)) return "RETIRED_ROUTE";
  if (isDisallowedLegistarHost(url)) return "RECORDED_DISALLOWED";
  return null;
}

/** A permitted agenda link redirected into a host this client may not request. */
export class AgendaRedirectRefused extends Error {
  readonly refusal: "RETIRED_ROUTE" | "RECORDED_DISALLOWED";
  readonly location: string;
  constructor(from: string, location: string, refusal: "RETIRED_ROUTE" | "RECORDED_DISALLOWED") {
    super(`${from} redirects to ${location}, whose host ${refusal === "RETIRED_ROUTE" ? "is a retired route's" : "is recorded DISALLOWED"}; the redirect was not followed`);
    this.name = "AgendaRedirectRefused";
    this.refusal = refusal;
    this.location = location;
  }
}

const AGENDA_REDIRECT_LIMIT = 5;

/**
 * **EVERY REDIRECT HOP IS A NEW REQUEST, AND IS ASKED THE SAME QUESTION.**
 * (2026-09-24, RULING 263.)
 *
 * `fetch` follows redirects by itself, so {@link agendaRetrievalRefusal} held
 * only for the first hop: a permitted link that redirects into
 * `legistar.granicus.com` would be read. docs/sources.md already names the
 * pattern — the host in a document URL is frequently not the host of the
 * portal that listed it. This follows each redirect itself and refuses a hop
 * into a refused host exactly as a refused first hop is refused: the link is
 * held and nothing is requested from that host. The base fetch is read per
 * call, so a stubbed global in a test is the one used.
 */
export function refusalCheckedFetch(base?: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const impl = base ?? globalThis.fetch;
    let url = String(input instanceof Request ? input.url : input);
    for (let hop = 0; ; hop++) {
      const response = await impl(url, { ...init, redirect: "manual" });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (!location) return response;
      await response.body?.cancel().catch(() => undefined);
      if (hop >= AGENDA_REDIRECT_LIMIT) {
        throw new Error(`${url} redirected more than ${AGENDA_REDIRECT_LIMIT} times; the chain was not followed further`);
      }
      const next = new URL(location, url).toString();
      const refusal = agendaRetrievalRefusal(next);
      if (refusal) throw new AgendaRedirectRefused(url, next, refusal);
      url = next;
    }
  }) as typeof fetch;
}

export async function retrieveAgendas(meetings: Meeting[]) {
  /*
   * **A LINK INTO A RETIRED ROUTE'S HOST IS HELD AS A LINK, NEVER READ.**
   * (2026-09-23, RULING 283 / RULING 263.)
   *
   * A body whose agenda platform refuses this client in robots.txt still
   * publishes links into it on its own permitted pages, and a reader may
   * follow one. Retrieval is this client's act, and the retired route's
   * hosts are exactly the ones it may not request — so the link is kept on
   * the meeting and the document behind it is not fetched. Counted, so a
   * held link never reads as a retrieval that failed or an agenda nobody
   * posted.
   */
  const linkedOnly = meetings.filter((m) => {
    const url = documentUrlFor(m);
    return url !== null && agendaRetrievalRefusal(url) !== null;
  });
  if (linkedOnly.length > 0) {
    console.log(
      `agenda documents: ${linkedOnly.length} link(s) held as links only — their host is a retired ` +
        "route or recorded DISALLOWED (robots.txt refuses this client), so nothing was requested from it",
    );
  }
  const withAgenda = meetings.filter((m) => {
    const url = documentUrlFor(m);
    return url !== null && agendaRetrievalRefusal(url) === null;
  });
  // Meetings with no stored document yet go first: the cap is politeness per
  // run, and the store is seeded from the previous snapshot, so over repeated
  // refreshes every agenda gets retrieved before any gets re-checked.
  const prioritized = [...withAgenda].sort((a, b) => {
    const aHas = agendaDocumentStore.latestFor(a.id) ? 1 : 0;
    const bHas = agendaDocumentStore.latestFor(b.id) ? 1 : 0;
    return aHas - bHas;
  });
  const capped = prioritized.slice(0, AGENDA_RETRIEVAL_CAP);
  let stored = 0;
  let revised = 0;
  /* Documents refused as landing pages — stated, never silently dropped. */
  let landingPages = 0;
  let unchanged = 0;
  let failed = 0;
  /* Failed reads kept off a sitting that already holds a version (RULING 269). */
  let failedOverHeld = 0;
  /* Permitted links that redirected into a refused host: held, never followed. */
  let redirectsRefused = 0;
  const fetchImpl = refusalCheckedFetch();

  for (const meeting of capped) {
    try {
      const url = documentUrlFor(meeting);
      const doc = await retrieveAgendaDocument(
        meeting,
        url && url !== meeting.agendaUrl ? { fetchImpl, urlOverride: url } : { fetchImpl },
      );
      if (!doc) continue;
      if (doc.extraction === "failed") {
        console.warn(
          `  agenda extraction failed for ${meeting.id}: ${doc.extractionNote}`,
        );
      }
      /*
       * **A LANDING PAGE IS NOT AN AGENDA, AND THE CORPUS PROVES IT 56 TIMES
       * OUT OF 56.** (2026-08-27.)
       *
       * Measured across the committed snapshot: of 198 agenda documents, 56
       * share a URL with another meeting, and NOT ONE of those 56 yields a
       * single agenda item. Of the 142 documents on a URL of their own, 67
       * (47%) do. The shared class has never once given a reader an agenda —
       * it inflates `documentsHeld`, and it is what put the Town of
       * Bradford's calendar on fourteen Newbury meetings.
       *
       * The producers are two: an adapter setting `agendaUrl` to a portal
       * ROOT (Vail's Highbond, Tucson Unified's board page), and the
       * division-wide notice-URL fallback in `documentUrlFor` (Bradford's and
       * Warner's town calendars). Both end at the same place — the body's own
       * meetings page, stored as though it were one sitting's agenda.
       *
       * So the rule is drawn where the evidence is, and no wider: a document
       * is refused when it BOTH extracts no agenda item AND is already stored
       * against a different meeting. A genuine shared agenda — two bodies
       * meeting jointly under one document — yields items and is kept. The
       * meeting keeps its own `agendaUrl` either way, so the reader can still
       * follow the link; we simply stop calling it an agenda we hold.
       */
      const alreadyOnAnotherMeeting = agendaDocumentStore.isUrlOnAnotherMeeting(
        doc.documentUrl,
        doc.meetingId,
      );
      if (alreadyOnAnotherMeeting && agendaItems(doc.text).length === 0) {
        landingPages++;
        continue;
      }

      /*
       * **A FAILED READ IS NEVER A NEW VERSION OVER ONE WE HOLD.** (RULING 269,
       * 2026-09-23.) It is reported above and counted below, and nothing is
       * stored: the store compares a failed row by its bytes alone, so a page
       * whose bytes change on every request (Diligent's ViewState) would add a
       * "version" every hour, and a failed read stored newest would stand in
       * front of the text a reader was being shown. A sitting that holds
       * nothing yet still records the failed read, so the gap is named.
       */
      if (doc.extraction === "failed" && agendaDocumentStore.latestFor(doc.meetingId)) {
        failedOverHeld++;
        continue;
      }

      const result = agendaDocumentStore.append(doc);
      if (!result.stored) unchanged++;
      else {
        stored++;
        if (result.revised) revised++;
      }
    } catch (error) {
      if (error instanceof AgendaRedirectRefused) {
        redirectsRefused++;
        console.log(`  agenda link held as a link for ${meeting.id}: ${error.message}`);
        continue;
      }
      failed++;
      console.warn(`  agenda fetch failed for ${meeting.id}: ${error}`);
    }
  }

  console.log(
    `agenda documents: ${withAgenda.length} linked, ${capped.length} fetched ` +
      `(cap ${AGENDA_RETRIEVAL_CAP}), ${stored} stored, ${revised} revisions, ` +
      `${unchanged} unchanged, ${landingPages} landing page(s) refused, ${failed} failed, ` +
      `${failedOverHeld} failed read(s) not stored over a held version, ` +
      `${redirectsRefused} redirect(s) into a refused host not followed`,
  );
}

async function main() {
  installNeonRequestDeadline();
  const name = process.argv[2];
  const promote = process.argv.slice(3).includes("--promote");

  if (!name || !(name in SOURCES)) {
    console.error(
      `Usage: pnpm ingest <source>\nKnown sources: ${Object.keys(SOURCES).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  if (promote && name !== "composite") {
    console.error("--promote is defined only for the canonical composite meetings contract");
    process.exitCode = 1;
    return;
  }
  if (name === "composite" && !promote) {
    console.error(
      "composite is a production-capable meetings refresh and requires --promote; " +
        "tracked data/meetings-snapshot.json is a bootstrap fixture, not a promotion door",
    );
    process.exitCode = 1;
    return;
  }
  const partitions = name === "composite"
    ? selectedMeetingPartitions(process.argv.slice(3))
    : [];

  await preloadCanonicalMeetingDependencies({ sourceName: name });
  REGISTRY = getRegistryRuntimeReadModel().registry;
  const promotionStore = promote ? new PostgresRoutineDataStore() : null;

  const source = name === "composite"
    ? buildCompositeSource({
        timeoutMs: STANDING_PARTITION_ACQUISITION_TIMEOUT_MS,
        captureAcquisitionEvidence: true,
        sourceNames: [...new Set(partitions.map((partition) => partition.meetingSource))],
        meetingPartitions: partitions.map((partition) => ({
          sourceName: partition.meetingSource,
          bodyId: partition.bodyId,
        })),
      })
    : SOURCES[name]();
  const previous = source instanceof CompositeSource && promotionStore
    ? await readPreviousMeetingPartition(promotionStore, partitions[0]!)
    : null;

  // Continental US, wide enough to sweep everything the adapter has.
  //
  // The window is stated (M58, 2026-08-15). It used to be omitted, which read
  // as "give me everything" and meant something else entirely to any adapter
  // whose upstream defaults to upcoming-only: Apptegy quietly returned the
  // future alone, so Vail and Rockaway Township's school board could never
  // show a concluded meeting and nothing in the run said so. The window is
  // the app's own cascade window, so the snapshot holds exactly what a reader
  // can be shown and no more.
  const now = Date.now();
  const retained = await retainMeetingFetchBytes(() => source.fetch({
    lat: 39.5,
    lng: -98.35,
    radiusKm: 5000,
    startsAfter: new Date(
      now - CONCLUDED_LOOKBACK_DAYS * 86_400_000,
    ).toISOString(),
    startsBefore: new Date(
      now + UPCOMING_HORIZON_DAYS * 86_400_000,
    ).toISOString(),
  }), "legistar", value => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "webapi.legistar.com" && partitions.some(partition =>
      partition.meetingSource === "legistar" && url.pathname.toLowerCase() === `/v1/${partition.wiring.config.slug}/events`);
  });
  const raw = retained.value;

  const meetings: Meeting[] = resolveAttribution(
    (source as MeetingSource<unknown>).normalize(raw as unknown[]),
  );
  const result = await source.upsert(meetings);

  console.log(`${source.name}: ${raw.length} fetched, ${meetings.length} normalized`);
  console.log(`  inserted ${result.inserted}, updated ${result.updated}`);

  if (source instanceof CompositeSource && source.lastReport) {
    for (const child of source.lastReport.children) {
      const d = child.drops;
      console.log(
        child.ok
          ? `  ${child.source}: ${child.fetched} fetched, ${child.normalized} normalized, ` +
              `drops: ${d.unknownVenue} unknownVenue / ${d.unplaceableInTime} unplaceableInTime / ` +
              `${d.notConfigured} notConfigured` +
              // D18: `placeless` is no longer a drop — those meetings are KEPT,
              // with no place and no pin. Printing it under "drops" would say
              // the opposite of what the run did.
              `, kept online: ${d.placeless}`
          : // F22: the two kinds of nothing, told apart in the line a human
            // reads. Each is recorded only for the selected source/body;
            // neither becomes an aggregate verdict over sibling partitions.
            `  ${child.source}: ${child.failure === "JOB" ? "JOB FAILURE" : "WALLED"} — ${child.error}`,
      );
    }

    // Seed the document store from the previous snapshot before retrieving,
    // so append-only semantics hold *across* refreshes: an unchanged agenda
    // is recognized by hash, a revised one is appended beside its prior
    // version rather than replacing it.
    if (previous) {
      /*
       * **A CARRIED-FORWARD DOCUMENT IS RE-CHECKED, BECAUSE A WIRING ERROR
       * OTHERWISE BECOMES PERMANENT.** (2026-08-27.)
       *
       * Seeding the store from the previous snapshot is what makes append-only
       * semantics hold across refreshes, and it also means a document attached
       * under a wiring error survives every later run — the wiring is corrected,
       * the ingest never looks again, and the wrong document is carried forever.
       *
       * That is not hypothetical. On 2026-08-21 fourteen NEWBURY meetings were
       * given `bradfordnh.gov/pages/calendar` — the Town of BRADFORD's own
       * calendar, which names Bradford Town Hall and Bradford's boards and does
       * not mention Newbury anywhere — some carrying `sourceOrg: "Newbury
       * Conservation Commission"`. Newbury's wiring rows carry no notice URL at
       * all today, so the error is already fixed at the source and the data
       * still says otherwise.
       *
       * The test applied here is the one that cannot be wrong: **a document
       * attached to meetings of MORE THAN ONE GOVERNMENT is nobody's agenda.**
       * One page cannot be two governments' agenda under any circumstances, so
       * dropping it loses nothing true. A page shared across sittings of ONE
       * body is a landing page and is a separate question (NH255) — it is left
       * alone here, because it is at least that body's own page.
       *
       * Dropped rather than kept-and-flagged: the store is append-only, so a
       * row that stays gets re-appended by every later run.
       */
      const govOf = new Map(previous.meetings.map((m) => [m.id, m.ocdId ?? null]));
      const govsByUrl = new Map<string, Set<string>>();
      for (const doc of previous.agendaDocuments) {
        const gov = govOf.get(doc.meetingId);
        if (!gov) continue;
        const set = govsByUrl.get(doc.documentUrl) ?? new Set<string>();
        set.add(gov);
        govsByUrl.set(doc.documentUrl, set);
      }

      let carried = 0;
      let refused = 0;
      const refusedUrls = new Set<string>();
      for (const doc of previous.agendaDocuments) {
        if ((govsByUrl.get(doc.documentUrl)?.size ?? 0) > 1) {
          refused++;
          refusedUrls.add(doc.documentUrl);
          continue;
        }
        agendaDocumentStore.append(doc);
        carried++;
      }
      console.log(
        `  agenda documents carried forward: ${carried} of ${previous.agendaDocuments.length}`,
      );
      if (refused > 0) {
        console.warn(
          `  ${refused} REFUSED — attached to meetings of more than one government, ` +
            `so they are nobody's agenda: ${[...refusedUrls].join(", ")}`,
        );
      }
    }

    await retrieveAgendas(meetings);
    if (!promotionStore) throw new Error("composite promotion store was not initialized");
    await promoteSelectedMeetingPartitions(
      source,
      source.lastPartitionRows,
      previous,
      promotionStore,
      partitions,
      retained.responses,
    );
    for (const refusal of retained.refusals) console.error(refusal);
  } else {
    const dropped = raw.length - meetings.length;
    if (dropped > 0) {
      console.warn(`  ${dropped} record(s) dropped — unplaceable in time or space`);
    }
  }
}

/**
 * Name the bodies an adapter's agenda segmentation could only describe (D19).
 *
 * The adapters are pure and the registry is a file, so segmentation happens
 * where the agenda is and NAMING happens here, once, where the registry is
 * already loaded. Every row arrives UNRESOLVED with its published heading
 * intact; this upgrades the ones the registry can account for and leaves the
 * rest exactly as they are — `bodyId: null`, `ocdId: null`, never the host's.
 *
 * The counts are printed with their denominator, because an unresolved
 * segment is a WORK ITEM: it is usually a special district reachable through
 * a county feed that this repo holds no division for, which is the whole
 * reason D19 exists, and a number nobody prints is a number nobody chases.
 */
function resolveAttribution(meetings: Meeting[]): Meeting[] {
  const registry = REGISTRY;
  if (!registry) throw new Error("REGISTRY_RUNTIME_READ_NOT_INITIALIZED");
  const withAgenda = meetings.filter((m) => m.actingBodies !== undefined);
  if (withAgenda.length === 0) {
    console.log(
      `attribution: 0 of ${meetings.length} meetings had their agenda items read — ` +
        "no source in this run publishes them, so nothing is claimed about who acted",
    );
    return meetings;
  }

  const divisionLabels = new Map(
    registry.divisions.map((d) => [d.ocdId, d.label] as const),
  );
  const resolved = meetings.map((m) =>
    m.actingBodies === undefined
      ? m
      : {
          ...m,
          actingBodies: resolveMeetingBodies(
            m.actingBodies,
            registry.bodies,
            divisionLabels,
            m.ocdId,
          ),
        },
  );

  const rows = resolved.flatMap((m) => m.actingBodies ?? []);
  const summary = attributionSummary(rows);
  console.log(
    `attribution: ${withAgenda.length} of ${meetings.length} meetings had their agenda ` +
      `items read, producing ${rows.length} acting-body row(s) — ` +
      `${summary.host} host, ${summary.resolved} resolved, ${summary.unresolved} unresolved ` +
      `(${summary.itemsUnattributed} item(s) attributed to nobody, which is the honest answer ` +
      "and a work item, never the host)",
  );
  for (const row of rows.filter((r) => r.attribution === "UNRESOLVED")) {
    console.log(`  unresolved: "${row.evidence}" — ${row.itemCount} item(s)`);
  }
  return resolved;
}

/**
 * Load carry-forward state for exactly one source/body promotion run. The
 * writer opens only that partition's pointer and candidate; global meetings
 * composition is a Reader concern. Any DB exception propagates and stops the
 * child and no bundled snapshot is consulted.
 */
export async function readPreviousMeetingPartition(
  store: RoutineDataStore,
  partition: MeetingPartitionContract,
): Promise<MeetingsSnapshot | null> {
  const read = await readMeetingPartitionProjection(partition, {
    store,
    bypassCache: true,
  });
  if (read.kind === "PROMOTED") {
    console.log(`partition LKG base: ${partition.id} at ${read.metadata.versionId}`);
    return read.value;
  }
  if (read.kind === "STORE_UNREACHABLE") throw new Error(read.detail);
  console.warn(`partition LKG base: ${partition.id} has no promoted pointer yet`);
  return null;
}

export interface SuccessfulMeetingPartitionReconciliation {
  readonly meetings: readonly Meeting[];
  readonly agendaDocuments: MeetingsSnapshot["agendaDocuments"];
  readonly carriedMeetingIds: readonly string[];
  readonly removalEvidence: readonly RoutineRemovalEvidence[];
  readonly lowerBound: string;
  readonly upperBound: string;
}

/**
 * Reconcile one authenticated source/body response against its exact LKG.
 *
 * A successful response is still an OPEN fact set. Omission therefore cannot
 * delete an in-window fact: the prior row remains, visibly marked as carried.
 * A prior row is removed on one of two authorities, and on nothing else: an
 * exact prior start outside the same registered serving window used for
 * acquisition and Reader delivery, or a fresh occurrence record of the same
 * recurring series that now holds the prior row's exact fact (2026-09-23,
 * `supersedesSeriesRecord`). Agenda documents inherit either authority only
 * from their exact removed meeting.
 *
 * The second authority exists for one transition. Until 2026-09-23 every
 * sitting of an iCalendar series shared the series' `UID`-only id; each series
 * now yields one record per sitting. Without it, the first read under the new
 * identity would carry the old record forward beside the occurrence that
 * replaced it, and a reader would see that sitting twice until it aged out of
 * the window.
 */
export function reconcileSuccessfulMeetingPartition(input: {
  readonly sourceName: string;
  readonly generatedAt: string;
  readonly freshMeetings: readonly Meeting[];
  readonly freshAgendaDocuments: MeetingsSnapshot["agendaDocuments"];
  readonly previous: MeetingsSnapshot | null;
  /**
   * In-window sittings this read's publisher struck out of their series
   * (`EXDATE`), for this partition's body only. A prior row that is one of
   * them is removed under `EXCLUDED_BY_PUBLISHER`, never carried.
   */
  readonly publisherExclusions?: readonly PublisherExclusion[];
}): SuccessfulMeetingPartitionReconciliation {
  const window = meetingReaderServingWindowAt(input.generatedAt);
  if (window === null) throw new Error(`MEETING_RECONCILIATION_CLOCK_INVALID:${input.generatedAt}`);
  const { lowerBound, upperBound } = window;
  const lower = Date.parse(lowerBound);
  const upper = Date.parse(upperBound);
  const meetings = [...input.freshMeetings];
  const meetingIds = new Set(meetings.map(({ id }) => id));
  const carriedMeetingIds: string[] = [];
  const removalEvidence: RoutineRemovalEvidence[] = [];

  for (const prior of input.previous?.meetings ?? []) {
    if (meetingIds.has(prior.id)) continue;
    const startsAt = Date.parse(prior.startsAt);
    if (Number.isFinite(startsAt) && (startsAt < lower || startsAt > upper)) {
      const meetingKey = `meeting:${prior.id}`;
      removalEvidence.push({
        key: meetingKey,
        code: "OUTSIDE_REGISTERED_SERVING_WINDOW",
        windowContract: window.contract,
        lowerBound,
        upperBound,
        priorStartsAt: prior.startsAt,
      });
      // A sitting's held agenda is ONE civic record however many stored
      // versions it has (`agendaDocumentRecordKey`), so it is named once.
      if ((input.previous?.agendaDocuments ?? []).some((document) => document.meetingId === prior.id)) {
        removalEvidence.push({
          key: agendaDocumentRecordKey({ meetingId: prior.id }),
          code: "OUTSIDE_REGISTERED_SERVING_WINDOW",
          windowContract: window.contract,
          lowerBound,
          upperBound,
          priorStartsAt: prior.startsAt,
          parentMeetingKey: meetingKey,
        });
      }
      continue;
    }
    const successor = input.freshMeetings.find((fresh) => supersedesSeriesRecord(prior, fresh));
    if (successor) {
      const meetingKey = `meeting:${prior.id}`;
      const successorKey = `meeting:${successor.id}`;
      removalEvidence.push({
        key: meetingKey,
        code: "SUPERSEDED_BY_OCCURRENCE_IDENTITY",
        successorKey,
        priorStartsAt: prior.startsAt,
      });
      if ((input.previous?.agendaDocuments ?? []).some((document) => document.meetingId === prior.id)) {
        removalEvidence.push({
          key: agendaDocumentRecordKey({ meetingId: prior.id }),
          code: "SUPERSEDED_BY_OCCURRENCE_IDENTITY",
          successorKey,
          priorStartsAt: prior.startsAt,
          parentMeetingKey: meetingKey,
        });
      }
      continue;
    }
    const struck = (input.publisherExclusions ?? []).find((exclusion) =>
      exclusion.meetingId === prior.id ||
      (exclusion.seriesId === prior.id && occurrenceStampFromInstant(prior.startsAt) === exclusion.slot));
    if (struck) {
      const meetingKey = `meeting:${prior.id}`;
      removalEvidence.push({
        key: meetingKey,
        code: "EXCLUDED_BY_PUBLISHER",
        seriesId: struck.seriesId,
        slot: struck.slot,
        priorStartsAt: prior.startsAt,
      });
      if ((input.previous?.agendaDocuments ?? []).some((document) => document.meetingId === prior.id)) {
        removalEvidence.push({
          key: agendaDocumentRecordKey({ meetingId: prior.id }),
          code: "EXCLUDED_BY_PUBLISHER",
          seriesId: struck.seriesId,
          slot: struck.slot,
          priorStartsAt: prior.startsAt,
          parentMeetingKey: meetingKey,
        });
      }
      continue;
    }
    const lastFreshAt = prior.carried?.lastFreshAt ?? (
      Number.isFinite(Date.parse(prior.provenance?.collectedAt ?? ""))
        ? prior.provenance.collectedAt
        : input.previous!.generatedAt
    );
    meetings.push({
      ...prior,
      carried: {
        source: input.sourceName,
        lastFreshAt,
        reason: "UNEXPLAINED_DISAPPEARANCE",
      },
    });
    meetingIds.add(prior.id);
    carriedMeetingIds.push(prior.id);
  }

  const documents = [...input.freshAgendaDocuments, ...(input.previous?.agendaDocuments ?? [])]
    .filter((document) => meetingIds.has(document.meetingId))
    .filter((document, index, all) => all.findIndex(({ id }) => id === document.id) === index);
  return {
    meetings,
    agendaDocuments: documents,
    carriedMeetingIds,
    removalEvidence,
    lowerBound,
    upperBound,
  };
}

export interface MeetingsWiringCoverage {
  readonly accounted: number;
  readonly denominator: number;
  readonly missing: readonly string[];
}

/** The canonical denominator is registry wiring, never yesterday's rows. */
export function meetingsWiringCoverage(
  snapshot: MeetingsSnapshot,
): MeetingsWiringCoverage {
  const represented = new Set(
    snapshot.sources.flatMap((source) => wiringForSourceName(source.source)),
  );
  const missing = SOURCE_WIRING.filter((row) => !represented.has(row)).map(
    (row) => `${row.bodyId}:${row.agendaSourceType}`,
  );
  return {
    accounted: SOURCE_WIRING.length - missing.length,
    denominator: SOURCE_WIRING.length,
    missing,
  };
}

/**
 * **THE RECURRENCE RECORD ONE PARTITION CARRIES.** (2026-09-23.)
 *
 * Each in-window sitting this body's publisher struck out of a series
 * (`EXDATE`), and each series of this body whose rule was not expanded with
 * the reason, held as named facts on the candidate. The held exclusion is the
 * statement the validator reads back before it accepts an
 * `EXCLUDED_BY_PUBLISHER` removal, so the audit trail and the authority are one
 * record. A series that was not expanded is never a silent success: it is
 * named here on every read that meets it.
 */
export function recurrenceHeldFacts(
  recurrence: RecurrenceReport | undefined,
  bodyId: string,
): { readonly exclusions: readonly PublisherExclusion[]; readonly held: NonNullable<RoutineCandidate["excludedFacts"]> } {
  if (!recurrence) return { exclusions: [], held: [] };
  const exclusions = recurrence.exclusions.filter((exclusion) => exclusion.bodyId === bodyId);
  const held = [
    ...exclusions.map((exclusion) => ({
      key: `meeting:${exclusion.meetingId}`,
      code: "MEETING_EXCLUDED_BY_PUBLISHER",
      detail: `The publisher struck the ${exclusion.slot} sitting out of series ${exclusion.seriesId} (EXDATE${exclusion.statedBy}).`,
      record: { ...exclusion },
    })),
    ...recurrence.notExpanded
      .filter((refusal) => refusal.bodyId === bodyId)
      .map((refusal) => ({
        key: refusal.seriesId ? `meeting-series:${refusal.seriesId}` : `meeting-series-feed:${bodyId}`,
        code: refusal.reason === "UNSUPPORTED_RULE"
          ? "ICAL_SERIES_RULE_UNSUPPORTED"
          : "ICAL_RULE_RESTATED_ON_PUBLISHED_SITTINGS",
        detail: refusal.seriesId ? `${refusal.seriesId}: ${refusal.detail}` : refusal.detail,
        record: { ...refusal },
      })),
  ];
  return { exclusions, held };
}

export function candidateForMeetingPartition(
  partition: MeetingPartitionContract,
  snapshot: MeetingsSnapshot,
  additionalViolations: readonly string[] = [],
  removalEvidence: readonly RoutineRemovalEvidence[] = [],
  heldFacts: NonNullable<RoutineCandidate["excludedFacts"]> = [],
): RoutineCandidate {
  const successful = snapshot.sources.filter((source) => source.ok);
  const acquisitions = successful.flatMap((source) => source.acquisitions ?? []);
  const provenanceViolations: string[] = [];
  for (const source of successful) {
    if (!source.acquisitions?.length) {
      provenanceViolations.push(`${source.source} has no exact acquired-response evidence.`);
    }
  }
  for (const evidence of acquisitions) {
    const requested = authorityFor(MEETINGS_SOURCE_ID, MEETINGS_RECORD_CLASS, evidence.requestedUrl);
    const final = authorityFor(MEETINGS_SOURCE_ID, MEETINGS_RECORD_CLASS, evidence.finalUrl);
    if (!requested.ok) provenanceViolations.push(`${evidence.source} requested ${evidence.requestedUrl}: ${requested.code}.`);
    if (!final.ok) provenanceViolations.push(`${evidence.source} ended at ${evidence.finalUrl}: ${final.code}.`);
    if (!/^[a-f0-9]{64}$/.test(evidence.rawHash) || evidence.byteCount <= 0 || evidence.httpStatus < 200 || evidence.httpStatus >= 300) {
      provenanceViolations.push(`${evidence.source} carries invalid acquired-byte evidence for ${evidence.finalUrl}.`);
    }
  }
  const acquisitionRawHash = acquisitions.length > 0
    ? sha256(acquisitions
        .map((row) => `${row.source}\n${row.requestedUrl}\n${row.finalUrl}\n${row.httpStatus}\n${row.byteCount}\n${row.rawHash}`)
        .sort()
        .join("\n---\n"))
    : "";
  const base = meetingsCandidate({
    // The builder's structural input predates SnapshotSourceReport's explicit
    // `error: null` success state. Runtime data is the same validated object;
    // keep it intact so the promoted read model does not rewrite null to absent.
    snapshot: snapshot as unknown as Parameters<typeof meetingsCandidate>[0]["snapshot"],
    partition: {
      sourceName: partition.meetingSource,
      bodyId: partition.bodyId,
      scope: partition.scope,
    },
    requestedUrl: acquisitions[0]?.requestedUrl ?? "",
    finalUrl: acquisitions[0]?.finalUrl ?? "",
    retrievedAt: snapshot.generatedAt,
    acquisitionRawHash,
    additionalViolations,
    removalEvidence,
  });
  return {
    ...base,
    semantics: {
      ...base.semantics,
      violations: [...base.semantics.violations, ...provenanceViolations],
    },
    horizon: {
      ...base.horizon,
      kind: "OPEN_FACT_SET",
      query: `SOURCE_WIRING route/body ${partition.meetingSource}/${partition.bodyId}; ${snapshot.meetings.length} exact rows`,
      declaredTotal: null,
      paginationComplete: base.horizon.paginationComplete,
      claimsComplete: false,
    },
    dependentChecks: [
      ...base.dependentChecks,
      {
        consumer: `SOURCE_WIRING ${partition.meetingSource}/${partition.bodyId}`,
        passed: snapshot.sources.length === 1 && snapshot.sources[0]?.source === partition.meetingSource,
        detail: `This candidate contains exactly the registered ${partition.meetingSource}/${partition.bodyId} authority partition.`,
      },
    ],
    ...(heldFacts.length > 0 ? { excludedFacts: [...(base.excludedFacts ?? []), ...heldFacts] } : {}),
  };
}

export async function promoteMeetingPartition(
  store: RoutineDataStore,
  partition: MeetingPartitionContract,
  snapshot: MeetingsSnapshot,
  additionalViolations: readonly string[] = [],
  removalEvidence: readonly RoutineRemovalEvidence[] = [],
  retainedResponses: readonly RetainedSourceResponse[] = [],
  heldFacts: NonNullable<RoutineCandidate["excludedFacts"]> = [],
): Promise<{
  readonly candidate: RoutineCandidate;
  readonly outcome: PromotionOutcome;
}> {
  validateSnapshot(snapshot);
  const candidate = retainMeetingCandidateEvidence(
    candidateForMeetingPartition(partition, snapshot, additionalViolations, removalEvidence, heldFacts),
    snapshot,
    retainedResponses,
  );
  const outcome = await processRegisteredMeetingPartitionCandidate(store, partition.id, candidate, snapshot.generatedAt);
  return { candidate, outcome };
}

export function printMeetingPartitionReceipt(
  partition: MeetingPartitionContract,
  candidate: RoutineCandidate,
  outcome: PromotionOutcome,
  failureDetail: string | null = null,
): void {
  console.log("RCD_MEETING_PARTITION_RECEIPT=" + JSON.stringify({
    source: partition.id,
    partitionId: partition.id,
    meetingSource: partition.meetingSource,
    bodyId: partition.bodyId,
    scope: partition.scope,
    candidateId: candidate.id,
    acquisitionSucceeded: outcome.candidate.acquisitionSucceeded,
    state: outcome.candidate.state,
    decision: outcome.candidate.receipt?.decision ?? null,
    promotedVersion: outcome.promoted?.versionId ?? null,
    lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
    failureDetail,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  }));
}

export interface MeetingPartitionPromotionResult {
  readonly partition: MeetingPartitionContract;
  readonly candidate: RoutineCandidate;
  readonly outcome: PromotionOutcome;
}

/** The routine partition child reads research; only its existing production door writes. */
async function standingResearchMeetingIntake(partition: MeetingPartitionContract, previous: MeetingsSnapshot | null, now: string, observed: MeetingsSnapshot) {
  if (!previous || Date.parse(now) - Date.parse(previous.generatedAt) > 24 * 3_600_000) return null;
  const activationReceipt = await readMeetingResearchWitness(partition, observed);
  return activationReceipt ? { snapshot: previous, activationReceipt } : null;
}

export async function promoteMeetingPartitions(input: {
  readonly store: RoutineDataStore;
  readonly partitions: readonly MeetingPartitionContract[];
  readonly meetings: readonly Meeting[];
  readonly agendaDocuments: MeetingsSnapshot["agendaDocuments"];
  readonly reports: NonNullable<CompositeSource["lastReport"]>["children"];
  readonly generatedAt: string;
  readonly previousByContract?: ReadonlyMap<string, MeetingsSnapshot | null>;
  readonly researchIntake?: (partition: MeetingPartitionContract, current: MeetingsSnapshot | null, now: string, observed: MeetingsSnapshot) => Promise<ApprovedResearchMeetingPartition | null>;
  readonly retainedResponses?: readonly RetainedSourceResponse[];
}): Promise<readonly MeetingPartitionPromotionResult[]> {
  const results: MeetingPartitionPromotionResult[] = [];
  const intake = input.researchIntake ?? (input.store instanceof PostgresRoutineDataStore ? standingResearchMeetingIntake : undefined);
  const offerResearch = async (partition: MeetingPartitionContract, current: MeetingsSnapshot, observed: MeetingsSnapshot): Promise<MeetingPartitionPromotionResult | null> => {
    if (!intake) return null;
    try {
      const research = await intake(partition, current, input.generatedAt, observed);
      if (!research) return null;
      const covered = new Set(research.activationReceipt.coveredMeetingIds);
      if (research.activationReceipt.evidenceScope !== "CURRENT_CAPTURE_MEETING_FACTS" ||
          research.activationReceipt.partitionId !== partition.id || covered.size !== observed.meetings.length ||
          observed.meetings.some(meeting => !covered.has(meeting.id)) ||
          research.activationReceipt.approvedFactCount !== observed.meetings.reduce((count, meeting) => count + 1 + Number(Boolean(meeting.agendaUrl)), 0)) {
        throw new Error("RESEARCH_MEETING_CAPTURE_SCOPE_MISMATCH");
      }
      // Approval covers current acquired facts. Carried rows and richer routine
      // fields keep the authority of the just-validated complete partition.
      const base = candidateForMeetingPartition(partition, current);
      const receipt = JSON.stringify(research.activationReceipt);
      const candidate: RoutineCandidate = { ...base, id: `${base.id}-research-${sha256(receipt).slice(0, 16)}`,
        dependentChecks: [...base.dependentChecks, { consumer: research.activationReceipt.kind, passed: true, detail: receipt }] };
      const outcome = await processRegisteredMeetingPartitionCandidate(input.store, partition.id, candidate, input.generatedAt);
      printMeetingPartitionReceipt(partition, candidate, outcome, outcome.candidate.failureDetail);
      return { partition, candidate, outcome };
    } catch (error) {
      console.error(`Research meeting intake refused for ${partition.id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
  for (const partition of input.partitions) {
    const report = input.reports.find((candidate) => candidate.source === partition.meetingSource);
    if (!report || !report.ok) {
      // Current source failure is always receipted. A historical research
      // approval cannot relabel the failed fetch or its LKG as new progress.
      const failureDetail = report?.error ?? `The composite produced no report for ${partition.meetingSource}.`;
      const failed = failedAcquisitionCandidate({
        sourceId: MEETINGS_SOURCE_ID,
        recordClass: MEETINGS_RECORD_CLASS,
        scope: partition.scope,
        requestedUrl: report?.acquisitions?.[0]?.requestedUrl ?? "",
        attemptedAt: input.generatedAt,
        failureDetail,
        parserVersion: "meetings-composite/2",
      });
      const outcome = await processRegisteredMeetingPartitionCandidate(input.store, partition.id, failed, input.generatedAt);
      printMeetingPartitionReceipt(partition, failed, outcome, failureDetail);
      results.push({ partition, candidate: failed, outcome });
      continue;
    }

    const freshRows = input.meetings.filter((meeting) =>
      meeting.bodyId === partition.bodyId && meeting.id.startsWith(`${partition.meetingSource}:`),
    );
    const freshRowIds = new Set(freshRows.map((meeting) => meeting.id));
    const freshDocuments = input.agendaDocuments.filter((document) => freshRowIds.has(document.meetingId));
    const previous = input.previousByContract?.has(partition.id)
      ? input.previousByContract.get(partition.id) ?? null
      : await readPreviousMeetingPartition(input.store, partition);
    const recurrence = recurrenceHeldFacts(report.recurrence, partition.bodyId);
    for (const fact of recurrence.held) {
      if (fact.code !== "MEETING_EXCLUDED_BY_PUBLISHER") console.warn(`  ${partition.id}: ${fact.code}: ${fact.detail}`);
    }
    const reconciled = reconcileSuccessfulMeetingPartition({
      sourceName: partition.meetingSource,
      generatedAt: input.generatedAt,
      freshMeetings: freshRows,
      freshAgendaDocuments: freshDocuments,
      previous,
      publisherExclusions: recurrence.exclusions,
    });
    const scopeFailures = [
      ...(partition.ocdId !== null && report.unreachableOcdIds?.includes(partition.ocdId)
        ? [`${partition.meetingSource} reported ${partition.ocdId} unreachable.`]
        : []),
      ...(report.partialScopes ?? [])
        .filter((failure) => failure.ocdIds.includes(partition.ocdId))
        .map((failure) => `${failure.scope} incomplete: ${failure.cause}`),
    ];
    const snapshot: MeetingsSnapshot = {
      formatVersion: 1,
      generatedAt: input.generatedAt,
      counts: snapshotCounts(reconciled.meetings, 0),
      sources: [{
        source: partition.meetingSource,
        ok: true,
        error: null,
        fetched: freshRows.length,
        normalized: freshRows.length,
        ...(reconciled.carriedMeetingIds.length > 0
          ? { carriedForward: reconciled.carriedMeetingIds.length }
          : {}),
        drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
        ...(report.acquisitions ? { acquisitions: report.acquisitions } : {}),
      }],
      meetings: [...reconciled.meetings],
      agendaDocuments: [...reconciled.agendaDocuments],
    };
    const { candidate, outcome } = await promoteMeetingPartition(
      input.store,
      partition,
      snapshot,
      scopeFailures,
      reconciled.removalEvidence,
      input.retainedResponses,
      recurrence.held,
    );
    printMeetingPartitionReceipt(
      partition,
      candidate,
      outcome,
      outcome.promoted ? null : outcome.candidate.failureDetail,
    );
    // The exact-byte re-observation supplies current freshness to retained
    // independent reviews. Its separate durable witness may certify no change.
    const observed: MeetingsSnapshot = { ...snapshot, meetings: [...freshRows], agendaDocuments: [...freshDocuments],
      counts: snapshotCounts(freshRows, 0) };
    const research = outcome.promoted ? await offerResearch(partition, snapshot, observed) : null;
    results.push(research ?? { partition, candidate, outcome });
  }
  return results;
}

/**
 * Persist one candidate and outcome per selected source/body partition.
 *
 * No aggregate snapshot is promoted. Each failed partition leaves its own
 * pointer on LKG while independently valid partitions advance. Cross-source
 * sitting composition and duplicate collapse happen only in the Reader.
 */
async function promoteSelectedMeetingPartitions(
  source: CompositeSource,
  meetings: readonly Meeting[],
  previous: MeetingsSnapshot | null,
  promotionStore: RoutineDataStore,
  partitions: readonly MeetingPartitionContract[],
  retainedResponses: readonly RetainedSourceResponse[] = [],
): Promise<void> {
  const report = source.lastReport;
  if (!report) {
    throw new Error("MEETING_PARTITION_REPORT_MISSING");
  }

  const okCount = report.children.filter((c) => c.ok).length;
  const now = new Date();
  // `lastPartitionRows` deliberately bypasses the composite's presentation
  // merge. Removing a row here would let one route's duplicate determine the
  // payload of another route's authority partition.
  const finalRows = [...meetings];

  const meetingIds = new Set(finalRows.map((m) => m.id));
  const snapshot: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt: now.toISOString(),
    counts: snapshotCounts(finalRows, 0),
    sources: report.children.map((c) => ({
      source: c.source,
      ok: c.ok,
      error: c.error,
      ...(c.ok ? {} : { failure: c.failure ?? "WALL" }),
      // The rung travels with its ladder, or it travels as an unmarked number
      // that a later session has to go back and mark (RULING 17).
      ...(typeof c.walledAtRung === "number"
        ? {
            walledAtRung: c.walledAtRung,
            rungProvenance: c.rungProvenance ?? ("CANONICAL" as const),
          }
        : {}),
      fetched: c.fetched,
      normalized: c.normalized,
      drops: c.drops,
      ...(c.acquisitions ? { acquisitions: c.acquisitions } : {}),
      ...(c.unreachableOcdIds && c.unreachableOcdIds.length > 0
        ? { unreachableOcdIds: c.unreachableOcdIds }
        : {}),
    })),
    meetings: finalRows,
    // Preserve prior document versions only for meetings retrieved in this
    // acquisition. Failed partitions keep their documents through their own
    // unchanged LKG pointer rather than by copying rows into another payload.
    agendaDocuments: [
      ...finalRows.flatMap((m) => agendaDocumentStore.versionsFor(m.id)),
      ...(previous?.agendaDocuments ?? []),
    ].filter(
      (doc, i, all) =>
        meetingIds.has(doc.meetingId) &&
        all.findIndex((d) => d.id === doc.id) === i,
    ),
  };

  const partitionResults = await promoteMeetingPartitions({
    store: promotionStore,
    partitions,
    meetings,
    agendaDocuments: snapshot.agendaDocuments,
    reports: report.children,
    generatedAt: snapshot.generatedAt,
    previousByContract: new Map(partitions.map((partition) => [partition.id, previous])),
    retainedResponses,
  });
  const promotedCount = partitionResults.filter((result) => result.outcome.promoted !== null).length;
  const heldCount = partitionResults.length - promotedCount;
  const failedNames = snapshot.sources.filter((s) => !s.ok).map((s) => s.source);
  console.log(
    `${promotedCount}/${partitionResults.length} source/body partition(s) promoted; ${heldCount} held on their own LKG\n` +
      `  ${snapshot.meetings.length} meetings from ${okCount}/${snapshot.sources.length} sources, ` +
      `${snapshot.agendaDocuments.length} agenda document version(s)` +
      (failedNames.length > 0 ? `, failed: ${failedNames.join(", ")}` : ""),
  );
  console.log(
    `  current acquisition rows: ${snapshot.counts.total}; failed partitions copied 0 rows and retained their own LKG pointers`,
  );

  // One source/body outcome is the unit of authority. These aggregate counts
  // are diagnostic only; they never become a candidate, pointer, or exit-code
  // verdict for the independently persisted partitions above.
  const walled = snapshot.sources.filter((s) => !s.ok && s.failure !== "JOB");
  const jobFailed = snapshot.sources.filter((s) => !s.ok && s.failure === "JOB");
  console.log(
    `  RUN SUMMARY: ${snapshot.sources.length} source(s) attempted, ` +
      `${okCount} read, ${walled.length} walled, ${jobFailed.length} job-failed, ` +
      `${snapshot.meetings.length} row(s) written` +
      (walled.length > 0
        ? `\n  WALLED (named; each affected partition retains its LKG): ` +
          walled
            .map(
              (s) =>
                `${s.source} [stopped at ladder rung ` +
                `${typeof s.walledAtRung === "number" ? s.walledAtRung : "unrecorded"}] — ${s.error}`,
            )
            .join("; ")
        : ""),
  );

  if (jobFailed.length > 0) {
    console.error(
      `refresh FAILED: ${jobFailed.length} source(s) failed for a job reason, not a wall — ` +
        jobFailed.map((s) => `${s.source}: ${s.error}`).join("; "),
    );
    console.error(
      `  ${jobFailed.length} source failure(s) were persisted only against their selected ` +
        "source/body partitions; independently valid partitions remain promoted.",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
