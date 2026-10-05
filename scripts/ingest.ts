/**
 * Run one source adapter locally.
 *
 * @freshness-reads-here — a derived family member's retrievedAt is the instant its own read returned, minted in
 * readDerivedFamilyMember, the function that performed that read (C16).
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
  type AgendaDocument,
  type AgendaDocumentStore,
} from "../lib/meetings/agenda-documents.ts";
import {
  MEETING_HELD_HORIZON_DAYS,
  MEETING_HELD_LOOKBACK_DAYS,
  meetingHeldWindowAt,
} from "../lib/meetings/constants.ts";
import { meetingFetchedWindowFor } from "../lib/meetings/fetch-window.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { doorReadModeFromEnv } from "../lib/doors/install.ts";
import { recordFamilyReads } from "../lib/doors/outcome.ts";
import {
  attributionSummary,
  resolveMeetingBodies,
} from "../lib/meetings/attribution.ts";
import { agendaItems } from "../lib/routing/agenda-search.ts";
import { isAnotherBodysNoticePage, isWiredNoticePage } from "../lib/meetings/notice-pages.ts";
import { meetingFetchPass } from "../lib/meetings/shared-fetch.ts";
import { meetingCarriesRecords } from "../lib/meetings/carries-records.ts";
import { markMeetingHistoryRestoreFinished, meetingHistoryRestoreEnabled, meetingHistoryRestoreFinished, restoreRemovedMeetingHistory, withRestoredHistory } from "../lib/civic-data/meeting-history-restore.ts";
import { meetingHistoryMoveEnabled, movedToHistoryEvidence, moveConcludedMeetingsToHistory, readMeetingHistory, type MeetingHistoryMove, type MeetingHistoryMoveRecord } from "../lib/civic-data/meeting-history.ts";
import {
  readMeetingPartitionProjection,
  snapshotCounts,
  validateSnapshot,
  MEETINGS_RECORD_CLASS,
  MEETINGS_SOURCE_ID,
  type MeetingsSnapshot,
} from "../lib/meetings/snapshot.ts";
import { failedAcquisitionCandidate, meetingsCandidate, sha256 } from "../lib/civic-data/candidate-builders.ts";
import { jobFailureDetail } from "../lib/sources/composite/failure-kind.ts";
import { agendaDocumentRecordKey } from "../lib/civic-data/changes.ts";
import {
  processRegisteredMeetingHistoryCandidate,
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
import { occurrenceStampFromInstant, reissuesSitting, supersedesSeriesRecord } from "../lib/sources/event-identity.ts";
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
import { SOURCE_WIRING, isUnreadableRetiredMeetingHost, wiringForTypes } from "../lib/registry/source-wiring.ts";
import { isLegistarDocumentHost } from "../lib/sources/legistar/routes.ts";
import { isLegistarMeetingDetailUrl, isPortalAgendaLinkFor, portalAgendaLinkFrom } from "../lib/sources/legistar/portal-agenda-link.ts";
import { sourceUserAgent } from "../lib/sources/http.ts";
import type { Registry } from "../lib/registry/types.ts";
import { getRegistryRuntimeReadModel, refreshRegistryRuntimeFromPromoted } from "../lib/registry/runtime-read-model.ts";
import { REGISTRY_RUNTIME_SCOPE } from "../lib/registry/runtime-data-plane.ts";
import {
  ATTESTED_PROMOTIONS_ENV,
  attestedPromotionFor,
  parseAttestedPromotions,
} from "../lib/civic-data/attested-promotion.ts";
import type { PromotedCivicDataReadOptions } from "../lib/civic-data/read-model.ts";
import { readCuratedReaderProjection, refreshVenueResolutionsFromPromoted } from "../lib/civic-data/curated-reader-read-model.ts";
import type { ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { publishVenueResolutions } from "../lib/meetings/venue-publication.ts";
import { normalizeFamilyMeetingCitations, placeMeetingsFromCensusVenues, placeMeetingsFromVerifiedVenues, retainPreviouslyVerifiedVenuePoints } from "../lib/meetings/automatic-venue-resolutions.ts";
import { currentVenueCache, resolveVenue, venueResolutionRecordId, type VenueEntry } from "../lib/meetings/venue-cache.ts";
import { placeUnplacedFromAgendas } from "./lib/agenda-meeting-location.ts";
import type { Meeting, MeetingSource, PublisherExclusion, RecurrenceReport } from "../lib/sources/types.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { DERIVED_WIRING_RECORD_CLASS, DERIVED_WIRING_SCOPE } from "../lib/civic-data/derived-door.ts";
import {
  bodySourceWiringFor,
  DERIVED_WIRING_SOURCE_NAMES,
  familyMembers,
  readDerivedMeetingWiring,
  type DerivedWiringRecord,
} from "../lib/civic-data/derived-meeting-wiring.ts";
import {
  buildDerivedFamily,
  derivedFamilyCandidate,
  derivedFamilyFailedCandidate,
  type FamilyMemberRead,
} from "../lib/civic-data/derived-meeting-family.ts";
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
  readonly refreshRegistry?: (options: PromotedCivicDataReadOptions) => Promise<unknown>;
  readonly refreshVenues?: () => Promise<unknown>;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<void> {
  const refreshRegistry = input.refreshRegistry ?? refreshRegistryRuntimeFromPromoted;
  const refreshVenues = input.refreshVenues ?? refreshVenueResolutionsFromPromoted;
  // The supervisor proved the registry once for this pass; a malformed or
  // absent attestation leaves this child's own full proof in place.
  const attested = attestedPromotionFor(
    parseAttestedPromotions((input.env ?? process.env)[ATTESTED_PROMOTIONS_ENV]),
    "REGISTRY_RUNTIME_BINDING",
    REGISTRY_RUNTIME_SCOPE,
  );
  await Promise.all([
    refreshRegistry(attested ? { attested } : {}),
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
export function documentUrlFor(meeting: Meeting): string | null {
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
  // The sitting's own body row answers first, by identity rather than name.
  const ownBody = onDivision.find((row) => row.bodyId === meeting.bodyId);
  if (ownBody) return ownBody.noticeUrl ?? null;
  /*
   * **A DIVISION'S ONLY NOTICE PAGE CAN BELONG TO ANOTHER GOVERNMENT.**
   * (2026-09-24.)
   *
   * "Every notice URL on the division agrees" was also true when the
   * division carried exactly one, and that one was another publisher's. The
   * Lake Todd Village District row is keyed on Newbury and publishes on the
   * Town of Bradford's calendar, so every unlinked Newbury sitting was lent
   * Bradford's calendar. The Central Arizona Water Conservation District is
   * the only notice page on Pima County's division, so Pima's Board of
   * Supervisors study session of 2026-10-13 was served CAP's board page as
   * its agenda, under "Pima County Clerk of the Board". Production held 27
   * such documents on 2026-09-24, every one served by /api/agenda.
   *
   * So only the sitting's own publisher's page is lent across bodies, and the
   * body-name match reads only that publisher's rows too: two publishers on
   * one division can each have a "Planning Board".
   */
  const publisher = meeting.provenance?.sourceOrg ?? null;
  const own = onDivision.filter((row) => publisher !== null && row.publishingOrg === publisher);
  const forBody = own.find(
    (row) => (row.config.bodyName ?? row.publishingOrg) === meeting.bodyName,
  );
  if (forBody) return forBody.noticeUrl ?? null;
  const distinct = new Set(own.map((row) => row.noticeUrl));
  return distinct.size === 1 ? (own[0]!.noticeUrl ?? null) : null;
}

/**
 * The sitting is reached only through its body's notice page: it carries no
 * agenda link of its own, so the page is the body's, never this sitting's.
 */
function readThroughNoticePage(meeting: Meeting): boolean {
  return !meeting.agendaUrl && documentUrlFor(meeting) !== null;
}

/**
 * A held document that is not this sitting's agenda (D1): a notice page that
 * is neither the sitting's body's nor its publisher's, or a wiring notice
 * page, not the sitting's own link, that states no agenda item. Production
 * held 70 notice-page documents on 2026-09-24 and not one yields an agenda
 * item.
 *
 * Ownership is the one rule every reader surface asks
 * (`isAnotherBodysNoticePage`, lib/meetings/notice-pages.ts), by body id or
 * publisher (R14, 2026-09-25). This file used to keep its own publisher-only
 * copy, under which Tucson Unified's own notice page was "another's" — its
 * sittings are published as "Tucson Unified School District", its wiring row
 * as "… Governing Board" — and was set aside whatever it said.
 */
export function heldNoticePageIsNotItsAgenda(
  meeting: Pick<Meeting, "agendaUrl" | "provenance" | "bodyId">,
  doc: Pick<AgendaDocument, "documentUrl" | "text">,
): boolean {
  // The sitting's own agenda link is never set aside.
  if (meeting.agendaUrl === doc.documentUrl) return false;
  if (isAnotherBodysNoticePage(doc.documentUrl, { bodyId: meeting.bodyId, publisher: meeting.provenance?.sourceOrg })) return true;
  if (!isWiredNoticePage(doc.documentUrl)) return false;
  return agendaItems(doc.text ?? "").length === 0;
}

/**
 * Why an agenda link is held as a link and not read, or null when the document
 * may be requested. The one reason is a retired route whose host nothing may
 * fetch (`isUnreadableRetiredMeetingHost`: a host that no longer resolves,
 * such as Newbury's CivicWeb portal).
 *
 * robots.txt is never a reason (owner decision 2026-09-25: "Robots.txt alone
 * must not block acquisition"). Until then this also refused the Legistar
 * vendor's document host (`RECORDED_DISALLOWED`, robots `Disallow: /`) and
 * Pima Community College's Diligent tenant, retired for robots.txt alone. Both
 * are read again; an access control met on the way (a 401, 403 or 429, a
 * challenge) is a failed read of that link, recorded, and never worked around.
 */
export type AgendaRetrievalRefusal = "RETIRED_ROUTE";

export function agendaRetrievalRefusal(url: string): AgendaRetrievalRefusal | null {
  return isUnreadableRetiredMeetingHost(url) ? "RETIRED_ROUTE" : null;
}

/** An agenda link redirected into a host agenda retrieval refuses. */
export class AgendaRedirectRefused extends Error {
  readonly refusal: AgendaRetrievalRefusal;
  readonly location: string;
  constructor(from: string, location: string, refusal: AgendaRetrievalRefusal) {
    super(`${from} redirects to ${location}, whose host is a retired route's that nothing may fetch; the redirect was not followed`);
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
 * only for the first hop: a link that redirects into a refused host would be
 * read. docs/sources.md already names the pattern — the host in a document URL
 * is frequently not the host of the portal that listed it. This follows each
 * redirect itself and refuses a hop into a refused host exactly as a refused
 * first hop is refused: the link is held and nothing is requested from that
 * host. The base fetch is read per call, so a stubbed global in a test is the
 * one used.
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

/**
 * The Legistar detail page a sitting's vendor-host agenda link can be read
 * through, or null when the row holds none.
 */
function portalDetailPageFor(meeting: Meeting): string | null {
  const page = meeting.provenance?.sourceUrl ?? null;
  return isLegistarMeetingDetailUrl(page) && agendaRetrievalRefusal(page) === null ? page : null;
}

/**
 * **A VENDOR-HOST AGENDA IS READ THROUGH THE SITTING'S PORTAL FIRST, AND FROM
 * THE VENDOR WHEN THE PORTAL FALLS SHORT.** (2026-09-24; the vendor file is
 * the fallback since 2026-09-25.)
 *
 * A Legistar sitting whose API agenda file sits on the vendor's document host
 * (`legistar.granicus.com`) has the same agenda on the tenant's own portal,
 * linked from the sitting's detail page, which the row already holds
 * (lib/sources/legistar/portal-agenda-link.ts). The portal route came in on
 * 2026-09-24, while the vendor host was refused for its robots.txt. Since the
 * owner decision of 2026-09-25 the vendor file is readable again, and the
 * portal stays first because every such sitting read since 2026-09-24 holds
 * its versions under the portal URL: reading the vendor copy instead would
 * store the same agenda again under a second address. When the portal page
 * links no agenda yet, or cannot be read, the vendor file is read — the other
 * public route to the same document.
 */
function readsThroughPortal(meeting: Meeting, url: string): boolean {
  return isLegistarDocumentHost(url) && portalDetailPageFor(meeting) !== null;
}

/**
 * The portal's own agenda link for a sitting, read off its detail page. A
 * portal link already held for the sitting is reused, because the portal keeps
 * one link per sitting and serves its current agenda there, so the page is
 * read once rather than on every pass.
 */
async function portalAgendaLinkFor(meeting: Meeting, fetchImpl: typeof fetch): Promise<string | null> {
  const page = portalDetailPageFor(meeting);
  if (!page) return null;
  const held = agendaDocumentStore.latestFor(meeting.id)?.documentUrl ?? null;
  // The link passes the same refusal rule as the page before its first byte;
  // `fetchImpl` asks it again at every redirect hop of both requests.
  if (held && isPortalAgendaLinkFor(held, page) && agendaRetrievalRefusal(held) === null) return held;
  const response = await fetchImpl(page, { headers: { "User-Agent": sourceUserAgent() } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${page}`);
  const link = portalAgendaLinkFrom(await response.text(), page);
  return link && agendaRetrievalRefusal(link) === null ? link : null;
}

/**
 * Held document versions in the order they were read: `retrievedAt`, then id.
 * (2026-09-24.)
 *
 * The store asks "is this read new?" of a sitting's LAST version by position.
 * The partition payload was written as the store's rows followed by the rows
 * the store had set aside as repeats, so a sitting's held rows drifted out of
 * order: Sunnyside 167 held its 2026-09-14 skip links interleaved with its
 * 09-24 reads. The last row by position was then an old one, an unchanged read
 * compared against it looked new, and Sunnyside 167 and 174 each stored the
 * same words again on every run from 03:25Z. Seeding and writing in read order
 * keeps "last" meaning latest. No row is added, dropped or changed.
 */
export function inRetrievalOrder<T extends Pick<AgendaDocument, "id" | "retrievedAt">>(
  documents: readonly T[],
): T[] {
  const readAt = (document: T): number => {
    const ms = Date.parse(document.retrievedAt);
    return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
  };
  return [...documents].sort((left, right) =>
    (readAt(left) - readAt(right)) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/**
 * Seed the store from the previous payload's held rows, in the order they were
 * read, so append-only semantics hold across refreshes: an unchanged agenda is
 * recognized, a revised one is appended beside its prior version.
 *
 * A document held for meetings of more than one government is refused here
 * (the rule is stated where `main` calls this).
 */
export function seedHeldAgendaDocuments(
  previous: Pick<MeetingsSnapshot, "meetings" | "agendaDocuments">,
  store: AgendaDocumentStore = agendaDocumentStore,
): {
  readonly carried: number;
  readonly refused: number;
  readonly refusedUrls: ReadonlySet<string>;
  /** Notice pages that are not their sitting's agenda (D1), left out of this run's store. */
  readonly noticePagesSetAside: number;
  readonly noticePageUrlsSetAside: ReadonlySet<string>;
} {
  const govOf = new Map(previous.meetings.map((m) => [m.id, m.ocdId ?? null]));
  const meetingOf = new Map(previous.meetings.map((m) => [m.id, m]));
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
  let noticePagesSetAside = 0;
  const noticePageUrlsSetAside = new Set<string>();
  for (const doc of inRetrievalOrder(previous.agendaDocuments)) {
    if ((govsByUrl.get(doc.documentUrl)?.size ?? 0) > 1) {
      refused++;
      refusedUrls.add(doc.documentUrl);
      continue;
    }
    const meeting = meetingOf.get(doc.meetingId);
    if (meeting && heldNoticePageIsNotItsAgenda(meeting, doc)) {
      noticePagesSetAside++;
      noticePageUrlsSetAside.add(doc.documentUrl);
      continue;
    }
    store.append(doc);
    carried++;
  }
  return { carried, refused, refusedUrls, noticePagesSetAside, noticePageUrlsSetAside };
}

/**
 * Which linked sittings one run reads first. (2026-09-24.)
 *
 * The cap is politeness per run, so this order decides what a reader can ever
 * be given. It was "holds nothing yet" first, registry order after, and two
 * kinds of sitting starved behind it:
 * - A sitting whose link CHANGED holds versions from its old link, so it
 *   ranked as held. Tucson Unified's Board Actions PDFs for sittings 498, 493,
 *   492, 491, 485 and 484, linked since 2026-09-24, were never read.
 * - A body's notice page, given to each unlinked scheduled sitting, is refused
 *   as a landing page on every read and so is never held by any of them, and
 *   all of them ranked first on every run. Seven Tucson Unified sittings spent
 *   seven of the eight reads on govboard.tusd1.org/ each hour.
 *
 * So the rank is the link, not the sitting: first a link never read for this
 * sitting; then a re-read of a link it holds; last a link another sitting
 * already holds (a landing page, or a shared agenda), read when a read is left
 * over. A vendor-host link read through the sitting's portal page counts as
 * read when the sitting holds the portal's own agenda link or the vendor file.
 * Within a rank, the sitting nearest `nowMs` goes first, so an upcoming agenda
 * is re-checked before one from July.
 */
export function agendaRetrievalOrder(
  meetings: readonly Meeting[],
  nowMs: number = Date.now(),
  store: AgendaDocumentStore = agendaDocumentStore,
): Meeting[] {
  const heldFromLink = (meeting: Meeting, url: string): boolean => {
    const versions = store.versionsFor(meeting.id);
    if (versions.some(({ documentUrl }) => documentUrl === url)) return true;
    const page = readsThroughPortal(meeting, url) ? portalDetailPageFor(meeting) : null;
    return page !== null && versions.some(({ documentUrl }) => isPortalAgendaLinkFor(documentUrl, page));
  };
  const rank = (meeting: Meeting): number => {
    const url = documentUrlFor(meeting);
    if (url === null) return 3;
    // A body's notice page is read after every sitting's own link: it is the
    // body's page, and one that states no agenda item is never held (D1).
    if (readThroughNoticePage(meeting)) return 2;
    if (heldFromLink(meeting, url)) return 1;
    return store.isUrlOnAnotherMeeting(url, meeting.id) ? 2 : 0;
  };
  const distance = (meeting: Meeting): number => {
    const ms = Date.parse(meeting.startsAt);
    return Number.isFinite(ms) ? Math.abs(ms - nowMs) : Number.POSITIVE_INFINITY;
  };
  return meetings
    .map((meeting, index) => ({ meeting, index, rank: rank(meeting), distance: distance(meeting) }))
    .sort((left, right) =>
      (left.rank - right.rank) || (left.distance - right.distance) || (left.index - right.index))
    .map(({ meeting }) => meeting);
}

export async function retrieveAgendas(meetings: Meeting[]) {
  /*
   * **A LINK INTO A DEAD RETIRED ROUTE'S HOST IS HELD AS A LINK, NEVER READ.**
   * (2026-09-23, RULING 283 / RULING 263; narrowed 2026-09-25.)
   *
   * A body whose old agenda platform is retired can still publish links into
   * it on its own pages, and a reader may follow one. When that host no
   * longer resolves (Newbury's CivicWeb portal) there is nothing to read, so
   * the link is kept on the meeting and nothing is requested. Counted, so a
   * held link never reads as a retrieval that failed or an agenda nobody
   * posted.
   *
   * robots.txt is never the reason (owner decision 2026-09-25). A route
   * retired for robots.txt alone keeps its clock off and its host readable
   * (`hostsReadable`, RETIRED_MEETING_ROUTES): Pima Community College's links
   * into its Diligent tenant are read like any public agenda link, and the
   * Legistar vendor's document host is read (below).
   */
  const heldAsLinks = meetings.filter((m) => {
    const url = documentUrlFor(m);
    return url !== null && agendaRetrievalRefusal(url) !== null;
  });
  // A vendor-host link is read through the sitting's portal first, the vendor
  // file being the fallback (`readsThroughPortal`).
  const viaPortal = meetings.filter((m) => {
    const url = documentUrlFor(m);
    return url !== null && readsThroughPortal(m, url);
  });
  if (heldAsLinks.length > 0) {
    console.log(
      `agenda documents: ${heldAsLinks.length} link(s) held as links only — their host is a retired ` +
        "route's that nothing may fetch, so nothing was requested from it",
    );
  }
  if (viaPortal.length > 0) {
    console.log(
      `agenda documents: ${viaPortal.length} vendor-host link(s) — read through the agenda link on the ` +
        "sitting's own portal detail page first, and from the vendor's file when the page links none or cannot be read",
    );
  }
  const withAgenda = meetings.filter((m) => {
    const url = documentUrlFor(m);
    return url !== null && agendaRetrievalRefusal(url) === null;
  });
  // A link never read for its sitting goes first (`agendaRetrievalOrder`):
  // the cap is politeness per run, so over repeated refreshes every agenda
  // gets retrieved before any gets re-checked.
  const capped = agendaRetrievalOrder(withAgenda).slice(0, AGENDA_RETRIEVAL_CAP);
  let stored = 0;
  let revised = 0;
  /* Documents refused as landing pages — stated, never silently dropped. */
  let landingPages = 0;
  let unchanged = 0;
  let failed = 0;
  /* Failed reads kept off a sitting that already holds a version (RULING 269). */
  let failedOverHeld = 0;
  /* Links that redirected into a refused host: held, never followed. */
  let redirectsRefused = 0;
  /* Vendor-host links read through the portal, and those read from the vendor's file instead. */
  let readViaPortal = 0;
  let readFromVendor = 0;
  /* Notice-page reads that stated no agenda item, so no sitting holds them (D1). */
  let noticePagesRefused = 0;
  /* A notice page is one body's page: read once per run, however many sittings reach it. */
  const noticePageRefusedThisRun = new Set<string>();
  const fetchImpl = refusalCheckedFetch();

  for (const meeting of capped) {
    try {
      const url = documentUrlFor(meeting);
      const viaNoticePage = readThroughNoticePage(meeting);
      if (viaNoticePage && url !== null && noticePageRefusedThisRun.has(url)) {
        noticePagesRefused++;
        continue;
      }
      let override = url && url !== meeting.agendaUrl ? url : null;
      let fromPortal = false;
      let fromVendor = false;
      if (url !== null && readsThroughPortal(meeting, url)) {
        let portalLink: string | null = null;
        let portalFailure: string | null = null;
        try {
          portalLink = await portalAgendaLinkFor(meeting, fetchImpl);
        } catch (error) {
          portalFailure = error instanceof Error ? error.message : String(error);
        }
        if (portalLink) {
          override = portalLink;
          fromPortal = true;
        } else {
          // The other public route to the same agenda: the vendor's own file.
          fromVendor = true;
          console.log(
            `  agenda for ${meeting.id} read from the vendor's file: its portal detail page ` +
              (portalFailure === null ? "links no agenda yet" : `could not be read (${portalFailure})`),
          );
        }
      }
      const doc = await retrieveAgendaDocument(
        meeting,
        override ? { fetchImpl, urlOverride: override } : { fetchImpl },
      );
      if (!doc) continue;
      if (fromPortal) readViaPortal++;
      if (fromVendor) readFromVendor++;
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
       * **A NOTICE PAGE THAT STATES NO AGENDA ITEM IS NOT THIS SITTING'S
       * AGENDA, FOR THE FIRST SITTING AS FOR EVERY OTHER.** (2026-09-24, D1.)
       * The rule above refuses a page only once another sitting holds it, so
       * the first unlinked sitting to reach a body's notice page kept it:
       * Mesa's council meetings page is held as sitting 1343183's agenda and a
       * reader is shown it as a read agenda with no items. Measured in
       * production the same day, 70 held documents came from notice pages and
       * not one yields an agenda item. A notice page that does state items (an
       * agenda posted on the notice) is still held.
       */
      if (viaNoticePage && agendaItems(doc.text ?? "").length === 0) {
        noticePagesRefused++;
        if (url !== null) noticePageRefusedThisRun.add(url);
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
      `${redirectsRefused} redirect(s) into a refused host not followed, ` +
      `${readViaPortal} vendor-host link(s) read through the portal, ${readFromVendor} read from the vendor's file, ` +
      `${noticePagesRefused} notice-page read(s) stating no agenda item not held as a sitting's agenda`,
  );
}

/** Read one ACTIVE member of a derived family on its own row, through the same composite adapters a partition uses. */
async function readDerivedFamilyMember(member: DerivedWiringRecord, fetchImpl: typeof fetch): Promise<FamilyMemberRead> {
  const sourceName = DERIVED_WIRING_SOURCE_NAMES[member.row.kind];
  try {
    const source = buildCompositeSource({
      timeoutMs: STANDING_PARTITION_ACQUISITION_TIMEOUT_MS,
      captureAcquisitionEvidence: true,
      sourceNames: [sourceName],
      derivedRows: [bodySourceWiringFor(member.row)],
      fetchImpl,
    });
    const now = Date.now();
    const raw = await source.fetch({
      lat: 39.5,
      lng: -98.35,
      radiusKm: 5000,
      startsAfter: new Date(now - MEETING_HELD_LOOKBACK_DAYS * 86_400_000).toISOString(),
      startsBefore: new Date(now + MEETING_HELD_HORIZON_DAYS * 86_400_000).toISOString(),
    });
    const meetings: Meeting[] = resolveAttribution((source as MeetingSource<unknown>).normalize(raw as unknown[]));
    const report = source.lastReport?.children.find((child) => child.source === sourceName);
    return {
      member,
      acquisitions: report?.acquisitions ?? [],
      ok: report?.ok === true,
      error: report?.ok === true ? null : report?.error ?? `the composite produced no report for ${sourceName}`,
      freshMeetings: meetings,
      freshAgendaDocuments: [],
      retrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      member,
      acquisitions: [],
      ok: false,
      error: jobFailureDetail(error instanceof Error ? error.message : String(error)),
      freshMeetings: [],
      freshAgendaDocuments: [],
      retrievedAt: new Date().toISOString(),
    };
  }
}

/**
 * DB-21: each member of a derived family records its own last success or failure on its own door (never the
 * family's, so one failing calendar does not mark its healthy neighbours). Only with the door registry in use; a
 * registry that cannot be written never changes the read's outcome.
 */
async function recordFamilyMemberOutcomes(reads: readonly FamilyMemberRead[]): Promise<void> {
  const connection = controlPlaneUrlFromEnv();
  if (connection === null || doorReadModeFromEnv() !== "registry" || reads.length === 0) return;
  try {
    const repos = await createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true });
    const recorded = await recordFamilyReads(repos.doors, reads, new Date().toISOString());
    if (recorded !== null) console.log(`  family doors: ${recorded.recorded} member outcome(s) recorded, ${recorded.missing} not in the registry`);
  } catch (error) {
    console.warn(`  family doors: member outcomes not recorded — ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * **ONE STATE'S DERIVED MEETING FAMILY, ONE CANDIDATE, EVERY MEMBER ON ITS OWN EVIDENCE** (C16).
 *
 * The members are the promoted meeting-source wiring's rows for the state. Each ACTIVE member is read on its own
 * row; a SUSPENDED or failed member keeps its last verified sittings (`lib/civic-data/derived-meeting-family.ts`).
 * An unreadable wiring store builds nothing: a refused candidate is recorded and the family's last known good stays.
 */
export async function promoteDerivedMeetingFamily(
  store: RoutineDataStore,
  partition: MeetingPartitionContract,
  /* The registry and venue preload, run only once the family has a member: a family with none reads nothing else. */
  prepare: () => Promise<void> = async () => {},
): Promise<void> {
  const generatedAt = new Date().toISOString();
  const refuse = async (detail: string, kind: "WALL" | "JOB"): Promise<void> => {
    const failed = derivedFamilyFailedCandidate(partition, generatedAt, detail);
    const outcome = await processRegisteredMeetingPartitionCandidate(store, partition.id, failed, generatedAt);
    printMeetingPartitionReceipt(partition, failed, outcome, detail, kind);
  };
  const wiring = await readDerivedMeetingWiring({ store, bypassCache: true, now: generatedAt });
  if (wiring.kind !== "PROMOTED") {
    await refuse(
      wiring.kind === "NOT_RECORDED"
        ? "No meeting-source wiring version is promoted yet, so this family has no member to read."
        : jobFailureDetail(`The meeting-source wiring could not be read (${wiring.kind}): ${"detail" in wiring ? wiring.detail : ""}`),
      "JOB",
    );
    return;
  }
  const members = familyMembers(wiring.value, partition.derivedFamily!);
  if (members.length === 0) {
    await refuse(`No reviewed calendar is connected in ${partition.derivedFamily} yet, so this family has no member to read.`, "JOB");
    return;
  }
  await prepare();
  const previous = await readPreviousMeetingPartition(store, partition);
  const reads: FamilyMemberRead[] = [];
  const fetchImpl = meetingFetchPass();
  for (const member of members) {
    if (member.status !== "ACTIVE") continue;
    const read = await readDerivedFamilyMember(member, fetchImpl);
    console.log(`  ${member.id}: ${read.ok ? `${read.freshMeetings.length} sitting(s) read` : `held: ${read.error}`}`);
    reads.push(read);
  }
  await recordFamilyMemberOutcomes(reads);
  const versionId = wiring.metadata.versionId;
  const promotedAt = wiring.metadata.promotedAt;
  if (versionId === null || promotedAt === null) {
    await refuse(jobFailureDetail("The promoted meeting-source wiring carries no version id or promotion time."), "JOB");
    return;
  }
  const history = await moveConcludedMeetingsForPartition(store, partition, previous, generatedAt);
  const restoredPrevious = await restoreRemovedHistoryForPartition(store, partition, previous, generatedAt);
  const build = buildDerivedFamily({
    wiringInput: {
      kind: "PROMOTED_VERSION",
      recordClass: DERIVED_WIRING_RECORD_CLASS,
      scope: DERIVED_WIRING_SCOPE,
      versionId,
      readModelSha256: sha256(canonicalCivicDataJson(wiring.value)),
      promotedAt,
    },
    members,
    reads,
    previous: restoredPrevious,
    generatedAt,
    reconcile: (read, previousSlice, windowAnchor) => {
      const reconciled = reconcileSuccessfulMeetingPartition({
        sourceName: DERIVED_WIRING_SOURCE_NAMES[read.member.row.kind],
        generatedAt: windowAnchor,
        freshMeetings: read.freshMeetings,
        freshAgendaDocuments: read.freshAgendaDocuments,
        previous: previousSlice,
        movedToHistory: history.moved,
      });
      return { meetings: reconciled.meetings, agendaDocuments: reconciled.agendaDocuments, removalEvidence: reconciled.removalEvidence };
    },
  });
  // The clocked family uses only its registered routine door. Existing reviewed
  // venues and exact prior points are reused; fresh Census matches become named
  // reference acquisitions on this same derived candidate, never a manual write.
  const venueRead = await readCuratedReaderProjection("venue-resolutions", { store, now: new Date().toISOString(), bypassCache: true });
  const reviewed = venueRead.kind === "PROMOTED" ? venueRead.value.records as unknown as VenueEntry[] : [];
  if (venueRead.kind !== "PROMOTED" && venueRead.kind !== "NOT_RECORDED") {
    console.warn(`AUTOMATIC_VENUE_REVIEWED_UNAVAILABLE:${venueRead.kind}:${venueRead.detail}`);
  }
  const memberRoutes = new Map(members.filter((member) => member.status === "ACTIVE").map((member) =>
    [`${DERIVED_WIRING_SOURCE_NAMES[member.row.kind]}:${member.row.bodyId}`, member.row.route] as const));
  const cited = normalizeFamilyMeetingCitations(build.snapshot.meetings, memberRoutes);
  const retained = retainPreviouslyVerifiedVenuePoints(cited, previous?.meetings ?? []);
  const fromReviewed = placeMeetingsFromVerifiedVenues(retained, reviewed);
  const existingIds = new Set(venueRead.kind === "PROMOTED" ? venueRead.value.records.map((row) => row.id) : []);
  const census = await placeMeetingsFromCensusVenues({
    snapshot: { ...build.snapshot, meetings: [...fromReviewed.meetings] }, existingIds, memberRoutes,
  });
  for (const hold of census.held) console.warn(`AUTOMATIC_VENUE_HELD ${hold}`);
  const placed = census;
  const venueReferenceEvidence = census.venueReferenceEvidence;
  const finalBuild = { ...build, snapshot: { ...build.snapshot, meetings: [...placed.meetings],
    ...(venueReferenceEvidence.length > 0 ? { venueReferenceEvidence } : {}) } };
  const candidate = derivedFamilyCandidate(partition, finalBuild);
  // An unchanged family pass is receipted on the pointed version (R23).
  const outcome = await processRegisteredMeetingPartitionCandidate(store, partition.id, candidate, new Date().toISOString(), undefined, { confirmUnchanged: true });
  printMeetingPartitionReceipt(partition, candidate, outcome, outcome.promoted ? null : outcome.candidate.failureDetail);
  if (outcome.promoted || outcome.confirmed) await publishVenuePins(store, partition.id, census.package);
  console.log(`AUTOMATIC_VENUE_MEETING_RECEIPT=${JSON.stringify({ candidateId: candidate.id,
    placedFromReviewed: fromReviewed.placedCount, placedFromCensus: placed.placedCount,
    retainedFromPrior: retained.filter((meeting, index) => meeting !== cited[index]).length,
    held: census.held.length, decision: outcome.candidate.receipt?.decision ?? null,
    promotedVersion: outcome.promoted?.versionId ?? null })}`);
}

/** BX-09: the pins this pass matched go into the venue-resolutions pointer on their own; a hold there never stops the pass. */
async function publishVenuePins(store: RoutineDataStore, partitionId: string, pkg: ManualProjectionPackage | null): Promise<void> {
  const published = await publishVenueResolutions({ store, package: pkg, now: new Date().toISOString() });
  if (published.records === 0) return;
  console.log(`VENUE_RESOLUTIONS_PUBLISHED=${JSON.stringify({ partition: partitionId, records: published.records,
    promoted: published.outcome?.promoted?.versionId ?? null, held: published.held })}`);
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

  /*
   * A derived family (C16) reads its members from the promoted wiring, never from SOURCE_WIRING. It reads the wiring
   * before anything else: every registered state has a family (2026-09-25), and one with no member yet refuses by
   * name without the registry and venue preload (about 24 MB) a member's read needs.
   */
  if (promote && partitions.length === 1 && partitions[0]!.derivedFamily !== null) {
    await promoteDerivedMeetingFamily(new PostgresRoutineDataStore(), partitions[0]!, async () => {
      await preloadCanonicalMeetingDependencies({ sourceName: name });
      REGISTRY = getRegistryRuntimeReadModel().registry;
    });
    return;
  }
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
      now - MEETING_HELD_LOOKBACK_DAYS * 86_400_000,
    ).toISOString(),
    startsBefore: new Date(
      now + MEETING_HELD_HORIZON_DAYS * 86_400_000,
    ).toISOString(),
  }), "legistar", value => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "webapi.legistar.com" && partitions.some(partition =>
      partition.meetingSource === "legistar" && url.pathname.toLowerCase() === `/v1/${partition.wiring?.config.slug}/events`);
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
       *
       * **WHAT THIS REACHES, STATED EXACTLY (2026-09-24, D1).** Only this run's
       * store: the retrieval order, the landing-page test and the agenda-stated
       * place matcher read it. The promoted payload is rebuilt from the previous
       * partition's own documents (reconcileSuccessfulMeetingPartition), and the
       * validator admits an agenda document's removal only with its meeting's,
       * so a document set aside here stays held there until its sitting leaves
       * the serving window. What a reader is shown is decided by the reader
       * projection (lib/ask/agenda-publication.ts).
       */
      const { carried, refused, refusedUrls, noticePagesSetAside, noticePageUrlsSetAside } = seedHeldAgendaDocuments(previous);
      console.log(
        `  agenda documents carried forward: ${carried} of ${previous.agendaDocuments.length}`,
      );
      if (refused > 0) {
        console.warn(
          `  ${refused} left out of this run's store — attached to meetings of more than one government, ` +
            `so they are nobody's agenda (the promoted payload still holds them): ${[...refusedUrls].join(", ")}`,
        );
      }
      if (noticePagesSetAside > 0) {
        console.warn(
          `  ${noticePagesSetAside} left out of this run's store — a notice page that is not its sitting's agenda ` +
            `(another publisher's, or stating no agenda item); the promoted payload still holds them: ` +
            `${[...noticePageUrlsSetAside].join(", ")}`,
        );
      }
    }

    await retrieveAgendas(meetings);
    /*
     * **A SITTING'S PLACE, AS ITS OWN AGENDA STATES IT.** (2026-09-24. The
     * owner: "use the address published by the official meeting source".) An
     * unplaced sitting whose held agenda states a street address that a
     * promoted reviewed venue of its division carries is placed with the
     * agenda's own words and the venue's coordinates. See
     * scripts/lib/agenda-meeting-location.ts.
     */
    const agendaPlaced = placeUnplacedFromAgendas(
      source.lastPartitionRows,
      (meetingId) => {
        const document = agendaDocumentStore.latestFor(meetingId);
        return document && document.extraction !== "failed" ? document.text : null;
      },
      currentVenueCache(),
    );
    const placedReport = agendaPlaced.report;
    if (placedReport.placed + placedReport.noReviewedVenue + placedReport.ambiguous > 0) {
      console.log(
        `agenda-stated places: ${placedReport.placed} sitting(s) placed from their own agenda, ` +
          `${placedReport.noReviewedVenue} stating an address no reviewed venue carries, ${placedReport.ambiguous} ambiguous`,
      );
      for (const line of placedReport.lines) console.log(line);
    }
    if (!promotionStore) throw new Error("composite promotion store was not initialized");
    await promoteSelectedMeetingPartitions(
      source,
      agendaPlaced.rows,
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

/**
 * DB-06: move this partition's concluded, record-carrying sittings older than the held window into its durable history
 * BEFORE the partition's own candidate is built, so a sitting leaves the partition only once history holds it. Never
 * blocks the partition: any failure moves nothing and the partition keeps every record as DB-01 does. The way back is
 * `WTP_MEETING_HISTORY_MOVE=off`.
 */
async function moveConcludedMeetingsForPartition(
  store: RoutineDataStore,
  partition: MeetingPartitionContract,
  previous: MeetingsSnapshot | null,
  generatedAt: string,
): Promise<MeetingHistoryMove> {
  const none = { outcome: "NONE", moved: new Map(), detail: "history move is off" } as const;
  if (!meetingHistoryMoveEnabled()) return none;
  try {
    const move = await moveConcludedMeetingsToHistory({
      store,
      partition,
      previous,
      generatedAt,
      door: (candidate, now) => processRegisteredMeetingHistoryCandidate(store, partition.id, candidate, now),
    });
    if (move.outcome !== "NONE") console.log(`  ${partition.id}: history ${move.outcome}: ${move.detail}`);
    return move;
  } catch (error) {
    console.warn(`  ${partition.id}: history move skipped: ${error instanceof Error ? error.message : String(error)}`);
    return { outcome: "UNAVAILABLE", moved: new Map(), detail: "the history move failed; every sitting stays in the partition" };
  }
}

/**
 * DB-55: add back the concluded sittings with records that the old 90-day rule
 * removed (`restoreRemovedMeetingHistory`), as carried rows of this partition's own candidate, until one walk of its whole chain finds nothing
 * more (a marker then ends it; `WTP_MEETING_HISTORY_RESTORE=off` stops it). Anything that goes
 * wrong leaves the partition exactly as it was.
 */
async function restoreRemovedHistoryForPartition(
  store: RoutineDataStore,
  partition: MeetingPartitionContract,
  previous: MeetingsSnapshot | null,
  generatedAt: string,
): Promise<MeetingsSnapshot | null> {
  if (previous === null || !meetingHistoryRestoreEnabled() || meetingHistoryRestoreFinished(partition.scope)) return previous;
  try {
    const history = await readMeetingHistory(partition, { store, now: generatedAt });
    const restored = await restoreRemovedMeetingHistory({
      store, partition, live: previous, history: history.kind === "PROMOTED" ? history.value : null, generatedAt,
    });
    if (restored.meetings.length > 0 || restored.versionsRead > 0) console.log(`  ${partition.id}: history restore: ${restored.detail}`);
    if (restored.meetings.length === 0 && restored.complete && restored.versionsRead > 0) markMeetingHistoryRestoreFinished(partition.scope, generatedAt);
    return withRestoredHistory(previous, restored, generatedAt);
  } catch (error) {
    console.warn(`  ${partition.id}: history restore skipped: ${error instanceof Error ? error.message : String(error)}`);
    return previous;
  }
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
 * **A CARRIED SITTING IS PLACED BY TODAY'S REVIEWED VENUES.** (C1, 2026-09-24.
 * The owner: "If an official meeting source publishes an address, use that
 * address and place the pin there.")
 *
 * A row is carried when its publisher's page stops listing it, which is what
 * happens to most sittings once they are held. The carry copies the last
 * fresh row, and that row's place was resolved against the reviewed venues of
 * THAT day. So a venue reviewed after the listing left never reached the
 * sitting: Tucson Unified's 23 September community-engagement session stated
 * "Cholla High School South Gym", the reviewed venue for exactly those words
 * was promoted on 24 September at 19:30Z, and the carried row still served
 * the words with no pin (measured read-only at 21:41Z, the only such row of
 * 13 carried).
 *
 * The sitting's facts are not touched: what the publisher last stated, and
 * when, stays as carried. Only our placement of its own stated words is
 * redone, through `resolveVenue`, the same lookup and scope the adapter would
 * apply to those words today. A row whose words match no reviewed venue, a
 * row with no stated words, an online or already placed row, and a row with
 * no division (whose scope needs the adapter's tenant, which a carried row
 * does not hold) are returned unchanged.
 */
export function placeCarriedFromReviewedVenue(
  prior: Meeting,
  sourceName: string,
  reviewedVenues: (() => readonly VenueEntry[]) | undefined,
): Meeting {
  const gap = prior.venueGap;
  if (!reviewedVenues || prior.location || prior.online || prior.ocdId === null) return prior;
  if (gap?.kind !== "STATED_NOT_PLACED" || !gap.publishedText?.trim()) return prior;
  const venue = resolveVenue(sourceName, prior.ocdId, gap.publishedText, null, reviewedVenues());
  if (!venue) return prior;
  const { venueGap: _gap, ...rest } = prior;
  return { ...rest, location: { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng } };
}

export { meetingCarriesRecords };

/**
 * Reconcile one authenticated source/body response against its exact LKG.
 *
 * A successful response is still an OPEN fact set. Omission therefore cannot
 * delete an in-window fact: the prior row remains, visibly marked as carried.
 * A prior row is removed on one of four authorities, and on nothing else: an
 * exact prior start outside the same registered serving window used for
 * acquisition and Reader delivery; a fresh occurrence record of the same
 * recurring series that now holds the prior row's exact fact (2026-09-23,
 * `supersedesSeriesRecord`); the publisher striking that sitting out of its
 * series (`EXCLUDED_BY_PUBLISHER`); or a fresh row of this partition that is
 * the same sitting, re-issued by its publisher under a new id (2026-09-24,
 * `reissuesSitting`). Agenda documents inherit an authority only from their
 * exact removed meeting.
 *
 * The series authority exists for one transition. Until 2026-09-23 every
 * sitting of an iCalendar series shared the series' `UID`-only id; each series
 * now yields one record per sitting. Without it, the first read under the new
 * identity would carry the old record forward beside the occurrence that
 * replaced it, and a reader would see that sitting twice until it aged out of
 * the window.
 *
 * The re-issue authority is the same failure from the publisher's side, and
 * it is permanent: Tucson Unified's portal listed one Audit Committee sitting
 * as meeting 495 and then as meeting 501, and the carried 495 stood beside the
 * fresh 501. It is tested only where a row would otherwise be carried, after
 * every other authority, so a row with no fresh twin is carried exactly as
 * before. Both successor authorities are recorded as
 * `SUPERSEDED_BY_OCCURRENCE_IDENTITY` naming the successor, and the promotion
 * door re-runs both tests on the stored records.
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
  /**
   * The promoted reviewed venues, read only if a carried row needs them
   * (`placeCarriedFromReviewedVenue`). Omitted, carried rows keep their place
   * exactly as before.
   */
  readonly reviewedVenues?: () => readonly VenueEntry[];
  /**
   * The dates this read actually fetched. Omitted, the held 120-day window each way for an adapter that fetches it
   * (`HELD_WINDOW_FETCH_SOURCES`), else the shown 90 days.
   */
  readonly fetchedWindow?: { readonly lowerBound: string; readonly upperBound: string };
  /**
   * Concluded sittings with a record that this partition's history now holds (DB-06), by meeting id: promoted
   * history FIRST (`moveConcludedMeetingsToHistory`), so these leave the partition under `MOVED_TO_HISTORY` and are
   * in no way carried. Omitted, nothing leaves and every record stays exactly as DB-01 keeps it.
   */
  readonly movedToHistory?: ReadonlyMap<string, MeetingHistoryMoveRecord>;
}): SuccessfulMeetingPartitionReconciliation {
  const window = meetingHeldWindowAt(input.generatedAt);
  const fetched = input.fetchedWindow ?? meetingFetchedWindowFor(input.sourceName, input.generatedAt);
  if (window === null || fetched === null) throw new Error(`MEETING_RECONCILIATION_CLOCK_INVALID:${input.generatedAt}`);
  const { lowerBound, upperBound } = window;
  const lower = Date.parse(lowerBound);
  const upper = Date.parse(upperBound);
  const fetchedLower = Date.parse(fetched.lowerBound);
  const fetchedUpper = Date.parse(fetched.upperBound);
  const documentedMeetingIds = new Set((input.previous?.agendaDocuments ?? []).map((document) => document.meetingId));
  const meetings = [...input.freshMeetings];
  const meetingIds = new Set(meetings.map(({ id }) => id));
  const carriedMeetingIds: string[] = [];
  const removalEvidence: RoutineRemovalEvidence[] = [];
  /** The prior row leaves because `successor`, fresh in this read, now holds its sitting. */
  const supersede = (prior: Meeting, successor: Meeting): void => {
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
  };

  for (const prior of input.previous?.meetings ?? []) {
    if (meetingIds.has(prior.id)) continue;
    const startsAt = Date.parse(prior.startsAt);
    const moved = input.movedToHistory?.get(prior.id);
    if (moved !== undefined && prior.status === "CONCLUDED" && Number.isFinite(startsAt) && startsAt < lower) {
      const meetingKey = `meeting:${prior.id}`;
      removalEvidence.push(movedToHistoryEvidence(prior, moved, lowerBound));
      // A sitting's held agenda is ONE civic record however many stored versions it has, so it is named once.
      if (documentedMeetingIds.has(prior.id)) {
        removalEvidence.push(movedToHistoryEvidence(prior, moved, lowerBound, meetingKey, agendaDocumentRecordKey({ meetingId: prior.id })));
      }
      continue;
    }
    // History is kept: a concluded sitting that carries a record is never removed
    // for its age (`meetingCarriesRecords`), so it falls through to the carry below.
    if (
      Number.isFinite(startsAt) && (startsAt < lower || startsAt > upper) &&
      !meetingCarriesRecords(prior, documentedMeetingIds.has(prior.id))
    ) {
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
      supersede(prior, successor);
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
    // The row would be carried. If a fresh row of this partition is the same
    // sitting, re-issued under a new id, that row holds it now: the listing
    // that left yields to it rather than standing beside it (`reissuesSitting`).
    const reissued = input.freshMeetings.find((fresh) => reissuesSitting(prior, fresh));
    if (reissued) {
      supersede(prior, reissued);
      continue;
    }
    const lastFreshAt = prior.carried?.lastFreshAt ?? (
      Number.isFinite(Date.parse(prior.provenance?.collectedAt ?? ""))
        ? prior.provenance.collectedAt
        : input.previous!.generatedAt
    );
    // A prior row this read never asked about (outside the dates it fetched) is
    // held as it was; only a row inside the fetched dates that the answer left
    // out is a disappearance.
    const outsideFetch = Number.isFinite(startsAt) && (startsAt < fetchedLower || startsAt > fetchedUpper);
    meetings.push({
      ...placeCarriedFromReviewedVenue(prior, input.sourceName, input.reviewedVenues),
      carried: {
        source: input.sourceName,
        lastFreshAt,
        reason: outsideFetch ? "OUTSIDE_FETCH_WINDOW" : "UNEXPLAINED_DISAPPEARANCE",
      },
    });
    meetingIds.add(prior.id);
    carriedMeetingIds.push(prior.id);
  }

  // Written in read order, so the next run's seeding compares a new read with
  // the sitting's latest version (`inRetrievalOrder`).
  const documents = inRetrievalOrder([...input.freshAgendaDocuments, ...(input.previous?.agendaDocuments ?? [])]
    .filter((document) => meetingIds.has(document.meetingId))
    .filter((document, index, all) => all.findIndex(({ id }) => id === document.id) === index));
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
  idSuffix = "",
): Promise<{
  readonly candidate: RoutineCandidate;
  readonly outcome: PromotionOutcome;
}> {
  validateSnapshot(snapshot);
  const built = retainMeetingCandidateEvidence(
    candidateForMeetingPartition(partition, snapshot, additionalViolations, removalEvidence, heldFacts),
    snapshot,
    retainedResponses,
  );
  // A second attempt on the same readings (DB-06's safety net) needs its own candidate id.
  const candidate = idSuffix === "" ? built : { ...built, id: `${built.id}${idSuffix}` };
  // An ordinary routine re-check that found nothing new is confirmed on the
  // pointed version, not republished (RULING 283's receipted no-change).
  const outcome = await processRegisteredMeetingPartitionCandidate(store, partition.id, candidate, snapshot.generatedAt, undefined, { confirmUnchanged: true });
  return { candidate, outcome };
}

export function printMeetingPartitionReceipt(
  partition: MeetingPartitionContract,
  candidate: RoutineCandidate,
  outcome: PromotionOutcome,
  failureDetail: string | null = null,
  failureKind: "WALL" | "JOB" | null = null,
): void {
  console.log("RCD_MEETING_PARTITION_RECEIPT=" + JSON.stringify({
    source: partition.id,
    partitionId: partition.id,
    meetingSource: partition.meetingSource,
    bodyId: partition.bodyId,
    scope: partition.scope,
    // The durable candidate: the new one, or the pointed version a no-change
    // re-check confirmed (then no new candidate exists).
    candidateId: outcome.candidate.candidate.id,
    acquisitionSucceeded: outcome.candidate.acquisitionSucceeded,
    state: outcome.candidate.state,
    decision: outcome.candidate.receipt?.decision ?? null,
    promotedVersion: outcome.promoted?.versionId ?? null,
    lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
    failureDetail,
    // WALL (the publisher's side stopped the read) or JOB (our code or
    // configuration failed first); absent on success. Additive: the durable
    // receipt contract reads the fields above and ignores this one.
    ...(failureKind ? { failureKind } : {}),
    // A confirmation names its observed instant, so the supervisor proves it
    // from the pointer's identity and newest confirmation, not the dataset.
    ...(outcome.confirmed ? { confirmedAt: outcome.confirmed.at } : {}),
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
  /** Test seam for the Census geocoder; production uses the global fetch. */
  readonly venueFetch?: typeof fetch;
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
      // A JOB failure says so in the durable detail, so no surface (Admin, a
      // report, a later session) can read our own exception as the publisher
      // walling us — the ten-day VENUE_RESOLUTIONS_MISSING freeze did exactly that.
      const failureKind = report ? (report.failure ?? "WALL") : "JOB";
      const failureDetail = report?.error
        ? failureKind === "JOB" ? jobFailureDetail(report.error) : report.error
        : jobFailureDetail(`The composite produced no report for ${partition.meetingSource}.`);
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
      printMeetingPartitionReceipt(partition, failed, outcome, failureDetail, failureKind);
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
    const history = await moveConcludedMeetingsForPartition(input.store, partition, previous, input.generatedAt);
    const restoredPrevious = await restoreRemovedHistoryForPartition(input.store, partition, previous, input.generatedAt);
    const attempt = async (moved: ReadonlyMap<string, MeetingHistoryMoveRecord>, idSuffix = "") => {
      const reconciled = reconcileSuccessfulMeetingPartition({
        sourceName: partition.meetingSource,
        generatedAt: input.generatedAt,
        freshMeetings: freshRows,
        freshAgendaDocuments: freshDocuments,
        previous: restoredPrevious,
        publisherExclusions: recurrence.exclusions,
        reviewedVenues: currentVenueCache,
        movedToHistory: moved,
      });
      // BX-08: a hand-wired body's newly published address gets its pin the same way a derived family's does.
      const acquired = (report.acquisitions ?? []).find((evidence) => evidence.httpStatus >= 200 && evidence.httpStatus < 300);
      let census: Awaited<ReturnType<typeof placeMeetingsFromCensusVenues>> | null = null;
      if (acquired) {
        try {
          census = await placeMeetingsFromCensusVenues({
            snapshot: { generatedAt: input.generatedAt, meetings: [...reconciled.meetings],
              sources: [{ source: partition.meetingSource, acquisitions: report.acquisitions }] } as unknown as MeetingsSnapshot,
            existingIds: new Set(currentVenueCache().map((venue) => venueResolutionRecordId(venue))),
            memberRoutes: new Map([[`${partition.meetingSource}:${partition.bodyId}`, acquired.finalUrl]]),
            fetchImpl: input.venueFetch,
          });
          for (const hold of census.held) console.warn(`AUTOMATIC_VENUE_HELD ${hold}`);
        } catch (error) {
          console.warn(`AUTOMATIC_VENUE_SKIPPED ${partition.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
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
        meetings: [...(census?.meetings ?? reconciled.meetings)],
        agendaDocuments: [...reconciled.agendaDocuments],
        ...(census && census.venueReferenceEvidence.length > 0 ? { venueReferenceEvidence: census.venueReferenceEvidence } : {}),
      } as MeetingsSnapshot;
      const { candidate, outcome } = await promoteMeetingPartition(
        input.store,
        partition,
        snapshot,
        scopeFailures,
        reconciled.removalEvidence,
        input.retainedResponses,
        recurrence.held,
        idSuffix,
      );
      return { reconciled, snapshot, candidate, outcome, census };
    };
    let attempted = await attempt(history.moved);
    // DB-06's safety net: a partition that is refused while sittings are moving to history must not stop its fresh
    // readings reaching readers, so it is promoted again with every sitting kept, exactly as DB-01 keeps them.
    if (!attempted.outcome.promoted && !attempted.outcome.confirmed &&
        attempted.reconciled.removalEvidence.some((row) => row.code === "MOVED_TO_HISTORY")) {
      console.warn(`  ${partition.id}: refused while sittings were moving to history (${attempted.outcome.candidate.failureDetail ?? attempted.outcome.candidate.state}); promoting again with every sitting kept`);
      attempted = await attempt(new Map(), "-kept");
    }
    const { snapshot, candidate, outcome } = attempted;
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
    if (outcome.promoted || outcome.confirmed) await publishVenuePins(input.store, partition.id, attempted.census?.package ?? null);
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
