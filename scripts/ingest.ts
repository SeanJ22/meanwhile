import { preloadCanonicalMeetingDependencies } from "../lib/meetings/ingest-dependencies.ts";
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
import { recordFamilyReads } from "../lib/doors/outcome.ts";
import { evidenceFromFamilyRead } from "../lib/doors/ingest-evidence.ts";
import { recordDoorEvidence } from "../lib/doors/shut.ts";
import {
  attributionSummary,
  resolveMeetingBodies,
} from "../lib/meetings/attribution.ts";
import { agendaItems } from "../lib/routing/agenda-search.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { ROUTINE_SAME_DOMAIN_CHILD_GAP_MS } from "../lib/civic-data/bounded-child-pass.ts";
import { calendarReadOrder } from "../lib/civic-data/state-calendars.ts";
import { isAnotherBodysNoticePage, isWiredNoticePage } from "../lib/meetings/notice-pages.ts";
import { meetingFetchPass } from "../lib/meetings/shared-fetch.ts";
import { meetingCarriesRecords } from "../lib/meetings/carries-records.ts";
import { meetingHistoryRestoreEnabled, restoreRemovedMeetingHistory, withRestoredHistory } from "../lib/civic-data/meeting-history-restore.ts";
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
import { makeLegistarSource } from "../lib/sources/legistar/index.ts";
import { legistarClientsFromWiring } from "../lib/sources/legistar/client-registry.ts";
import { makeOnBaseSource } from "../lib/sources/onbase/index.ts";
import { activeWiring, isUnreadableRetiredMeetingHost, wiringForTypes } from "../lib/registry/source-wiring.ts";
import { ensureMeetingDoors } from "../lib/doors/meeting-doors.ts";
import { isLegistarDocumentHost } from "../lib/sources/legistar/routes.ts";
import { isLegistarMeetingDetailUrl, isPortalAgendaLinkFor, portalAgendaLinkFrom } from "../lib/sources/legistar/portal-agenda-link.ts";
import { sourceUserAgent } from "../lib/sources/http.ts";
import type { Registry } from "../lib/registry/types.ts";
import { getRegistryRuntimeReadModel, withRegistryRuntimeStates } from "../lib/registry/runtime-read-model.ts";
import { requireRegistryState, statesForRegistryDivisions } from "../lib/civic-data/state-scopes.ts";
import { readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import type { ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { publishVenueResolutions } from "../lib/meetings/venue-publication.ts";
import { normalizeFamilyMeetingCitations, placeMeetingsFromCensusVenues, placeMeetingsFromVerifiedVenues, retainPreviouslyVerifiedVenuePoints } from "../lib/meetings/automatic-venue-resolutions.ts";
import { currentVenueCache, resolveVenue, venueResolutionRecordId, type VenueEntry } from "../lib/meetings/venue-cache.ts";
import { placeUnplacedFromAgendas } from "./lib/agenda-meeting-location.ts";
import type { Meeting, MeetingSource, PublisherExclusion, RecurrenceReport } from "../lib/sources/types.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { derivedFamilyReadGroups, readDerivedFamilyMembers } from "../lib/civic-data/derived-meeting-acquisition.ts";
import { DERIVED_WIRING_RECORD_CLASS, DERIVED_WIRING_SCOPE } from "../lib/civic-data/derived-door.ts";
import {
  DERIVED_WIRING_SOURCE_NAMES,
  familyMembers,
  readDerivedMeetingWiring,
} from "../lib/civic-data/derived-meeting-wiring.ts";
import {
  buildDerivedFamily,
  derivedFamilyCandidate,
  derivedFamilyFailedCandidate,
  type FamilyMemberRead,
} from "../lib/civic-data/derived-meeting-family.ts";
import { retainingFetch, retainMeetingFetchBytes, retainMeetingCandidateEvidence, tracedResponses, type RetainedSourceResponse } from "../lib/civic-data/retained-meeting-bytes.ts";
import { publishReadMeetingFacts } from "../lib/civic-data/meeting-fact-publication.ts";
import { readerFactDb } from "../lib/facts/db.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { join } from "node:path";

let REGISTRY: Registry | null = null;

function stateWiring(state: string, types: Parameters<typeof wiringForTypes>[0]) {
  return wiringForTypes(types).filter(row => statesForRegistryDivisions([row.ocdId ?? row.bodyId]).includes(state));
}

const SOURCES: Record<string, (state: string) => MeetingSource<unknown>> = {
  // Everything below hits the network. Serialized and paced — see
  // lib/sources/http.ts and lib/sources/legistar/client.ts.
  legistar: state => makeLegistarSource(legistarClientsFromWiring(stateWiring(state, ["LEGISTAR"]))) as unknown as MeetingSource<unknown>,
  civicplus: state =>
    makeCivicPlusSource(stateWiring(state, ["CIVICPLUS"])) as unknown as MeetingSource<unknown>,
  onbase: state =>
    makeOnBaseSource(stateWiring(state, ["ONBASE"])) as unknown as MeetingSource<unknown>,
  apptegy: state =>
    makeApptegySource(stateWiring(state, ["APPTEGY"])) as unknown as MeetingSource<unknown>,
  diligent: state =>
    makeDiligentSource(stateWiring(state, ["DILIGENT", "CIVICWEB"])) as unknown as MeetingSource<unknown>,
  iqm2: state =>
    makeIqm2Source(stateWiring(state, ["IQM2"])) as unknown as MeetingSource<unknown>,
  revize: state =>
    makeRevizeSource(stateWiring(state, ["REVIZE"])) as unknown as MeetingSource<unknown>,

};

/** The boards one state's calendar program reads, in the order given; each named once, all registered. */
export function selectedMeetingPartitions(args: readonly string[]): readonly MeetingPartitionContract[] {
  if (args.some((arg) => arg.startsWith("--partitions="))) {
    throw new Error("MEETING_PARTITION_BATCH_ARGUMENT_RETIRED");
  }
  const requested = args
    .filter((arg) => arg.startsWith("--only-partition="))
    .map((arg) => arg.slice("--only-partition=".length));
  if (requested.length === 0 || requested.some((id) => !id)) throw new Error("MEETING_PARTITION_REQUIRED");
  if (new Set(requested).size !== requested.length) throw new Error("MEETING_PARTITION_NAMED_TWICE");
  return requested.map((id) => {
    const partition = meetingPartitionContract(id);
    if (!partition) throw new Error(`MEETING_PARTITION_NOT_REGISTERED:${id}`);
    return partition;
  });
}

export function documentUrlFor(meeting: Meeting): string | null {
  if (meeting.agendaUrl) return meeting.agendaUrl;
  if (meeting.status !== "SCHEDULED") return null;

  const onDivision = activeWiring().filter(
    (row) => row.noticeUrl && row.ocdId !== null && row.ocdId === meeting.ocdId,
  );
  if (onDivision.length === 0) return null;
  // The sitting's own body row answers first, by identity rather than name.
  const ownBody = onDivision.find((row) => row.bodyId === meeting.bodyId);
  if (ownBody) return ownBody.noticeUrl ?? null;

  const publisher = meeting.provenance?.sourceOrg ?? null;
  const own = onDivision.filter((row) => publisher !== null && row.publishingOrg === publisher);
  const forBody = own.find(
    (row) => (row.config.bodyName ?? row.publishingOrg) === meeting.bodyName,
  );
  if (forBody) return forBody.noticeUrl ?? null;
  const distinct = new Set(own.map((row) => row.noticeUrl));
  return distinct.size === 1 ? (own[0]!.noticeUrl ?? null) : null;
}

function readThroughNoticePage(meeting: Meeting): boolean {
  return !meeting.agendaUrl && documentUrlFor(meeting) !== null;
}

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

export function readOncePerRun(base: typeof fetch): typeof fetch & { readonly distinctReads: () => number } {
  type Held = { readonly status: number; readonly statusText: string; readonly headers: [string, string][]; readonly bytes: Uint8Array };
  const reads = new Map<string, Promise<Held>>();
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    let read = reads.get(url);
    if (!read) {
      read = (async () => {
        const response = await base(input, init);
        return {
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()],
          bytes: new Uint8Array(await response.arrayBuffer()),
        };
      })();
      reads.set(url, read);
    }
    const held = await read;
    const nullBody = held.status === 204 || held.status === 205 || held.status === 304;
    return new Response(nullBody ? null : held.bytes.slice(), {
      status: held.status,
      statusText: held.statusText,
      headers: held.headers,
    });
  }) as typeof fetch & { readonly distinctReads: () => number };
  Object.defineProperty(wrapped, "distinctReads", { value: () => reads.size });
  return wrapped;
}

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

function portalDetailPageFor(meeting: Meeting): string | null {
  const page = meeting.provenance?.sourceUrl ?? null;
  return isLegistarMeetingDetailUrl(page) && agendaRetrievalRefusal(page) === null ? page : null;
}

function readsThroughPortal(meeting: Meeting, url: string): boolean {
  return isLegistarDocumentHost(url) && portalDetailPageFor(meeting) !== null;
}

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

export function seedHeldAgendaDocuments(
  previous: Pick<MeetingsSnapshot, "meetings" | "agendaDocuments">,
  store: AgendaDocumentStore = agendaDocumentStore,
): {
  readonly carried: number;
  readonly refused: number;
  readonly refusedUrls: ReadonlySet<string>;
  /** Notice pages that are not their sitting's agenda, left out of this run's store. */
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
    // body's page, and one that states no agenda item is never held.
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
  // A link never read for its sitting goes first (`agendaRetrievalOrder`).
  const ordered = agendaRetrievalOrder(withAgenda);
  let stored = 0;
  let revised = 0;
  /* Documents refused as landing pages — stated, never silently dropped. */
  let landingPages = 0;
  let unchanged = 0;
  let failed = 0;
  /* Failed reads kept off a sitting that already holds a version. */
  let failedOverHeld = 0;
  /* Links that redirected into a refused host: held, never followed. */
  let redirectsRefused = 0;
  /* Vendor-host links read through the portal, and those read from the vendor's file instead. */
  let readViaPortal = 0;
  let readFromVendor = 0;
  /* Notice-page reads that stated no agenda item, so no sitting holds them. */
  let noticePagesRefused = 0;
  /* A notice page is one body's page: read once per run, however many sittings reach it. */
  const noticePageRefusedThisRun = new Set<string>();
  const fetchImpl = readOncePerRun(refusalCheckedFetch());

  for (const meeting of ordered) {
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

      const alreadyOnAnotherMeeting = agendaDocumentStore.isUrlOnAnotherMeeting(
        doc.documentUrl,
        doc.meetingId,
      );
      if (alreadyOnAnotherMeeting && agendaItems(doc.text).length === 0) {
        landingPages++;
        continue;
      }

      if (viaNoticePage && agendaItems(doc.text ?? "").length === 0) {
        noticePagesRefused++;
        if (url !== null) noticePageRefusedThisRun.add(url);
        continue;
      }

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
    `agenda documents: ${withAgenda.length} linked, ${ordered.length} fetched ` +
      `(${fetchImpl.distinctReads()} distinct URL(s) requested, each once), ` +
      `${stored} stored, ${revised} revisions, ` +
      `${unchanged} unchanged, ${landingPages} landing page(s) refused, ${failed} failed, ` +
      `${failedOverHeld} failed read(s) not stored over a held version, ` +
      `${redirectsRefused} redirect(s) into a refused host not followed, ` +
      `${readViaPortal} vendor-host link(s) read through the portal, ${readFromVendor} read from the vendor's file, ` +
      `${noticePagesRefused} notice-page read(s) stating no agenda item not held as a sitting's agenda`,
  );
}

async function recordFamilyMemberOutcomes(reads: readonly FamilyMemberRead[]): Promise<void> {
  const connection = controlPlaneUrlFromEnv();
  if (connection === null || reads.length === 0) return;
  try {
    const repos = await createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true });
    const at = new Date().toISOString();
    // A member's own read can shut its door (and open its fix item) or reopen it.
    const judged = reads.map((read) => ({ read, evidence: evidenceFromFamilyRead(read) }));
    const plain = reads.filter((read) => !judged.some((entry) => entry.read === read && entry.evidence !== null));
    let shut = 0;
    for (const { read, evidence } of judged) {
      if (evidence === null) continue;
      const result = await recordDoorEvidence(repos.doors, read.member.id, evidence, at, repos);
      if (result.change === "SHUT") shut += 1;
    }
    if (shut > 0) console.log(`  family doors: ${shut} member door(s) shut by their own read`);
    const recorded = await recordFamilyReads(repos.doors, plain, at);
    if (recorded !== null) console.log(`  family doors: ${recorded.recorded} member outcome(s) recorded, ${recorded.missing} not in the registry`);
  } catch (error) {
    console.warn(`  family doors: member outcomes not recorded — ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function promoteDerivedMeetingFamily(
  store: RoutineDataStore,
  partition: MeetingPartitionContract,
  /* The registry and venue preload, run only once the family has a member: a family with none reads nothing else. */
  prepare: () => Promise<void> = async () => {},
  facts?: Omit<MeetingFactsTarget, "responses">,
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
  const pass = meetingFetchPass();
  const retaining = retainingFetch(pass);
  const fetchImpl = retaining.fetch;
  for (const group of derivedFamilyReadGroups(members)) {
    const acquired = await readDerivedFamilyMembers(group, fetchImpl, resolveAttribution);
    for (const read of acquired) console.log(`  ${read.member.id}: ${read.ok ? `${read.freshMeetings.length} sitting(s) read` : `held: ${read.error}`}`);
    reads.push(...acquired);
    if (group[0].row.kind === "MUNICODE") pass.forgetGet(acquired.flatMap(read => read.acquisitions.map(row => row.requestedUrl)));
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
  // An unchanged family pass is receipted on the pointed version.
  const outcome = await processRegisteredMeetingPartitionCandidate(store, partition.id, candidate, new Date().toISOString(), undefined, { confirmUnchanged: true });
  printMeetingPartitionReceipt(partition, candidate, outcome, outcome.promoted ? null : outcome.candidate.failureDetail);
  if (outcome.promoted || outcome.confirmed) {
    await publishVenuePins(store, partition.id, census.package);
    for (const read of facts ? reads.filter(row => row.ok) : []) {
      await publishPartitionFacts({ ...facts!, responses: retaining.responses }, read.member.id, DERIVED_WIRING_SOURCE_NAMES[read.member.row.kind],
        read.freshMeetings, read.acquisitions, candidate.id, generatedAt);
    }
  }
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

  if (!name || (name !== "composite" && !(name in SOURCES))) {
    console.error(
      `Usage: pnpm ingest <source>\nKnown sources: ${[...Object.keys(SOURCES), "composite"].join(", ")}`,
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
      "composite is a production-capable meetings refresh and requires --promote",
    );
    process.exitCode = 1;
    return;
  }
  // The meeting doors are the door registry's, as the runner published them for this pass. There is no other list.
  const diagnosticState = name === "composite" ? null : requireRegistryState(
    process.argv.find(argument => argument.startsWith("--state="))?.slice("--state=".length) ?? (() => { throw new Error("INGEST_STATE_REQUIRED"); })(),
  );
  const doors = await ensureMeetingDoors();
  if (!doors.ready) console.error(`meeting doors: ${doors.reason}`);
  const partitions = name === "composite"
    ? selectedMeetingPartitions(process.argv.slice(3))
    : [];
  const selectedStates = name === "composite"
    ? statesForRegistryDivisions(partitions.flatMap(partition => [partition.derivedFamily ?? "", partition.ocdId ?? "", partition.bodyId]))
    : [diagnosticState!];
  if (selectedStates.length !== 1) throw new Error("INGEST_EXACT_STATE_REQUIRED");
  const state = selectedStates[0]!;
  return withRegistryRuntimeStates([state], async () => {
    if (name !== "composite") {
      await preloadCanonicalMeetingDependencies({ sourceName: name, state });
      REGISTRY = getRegistryRuntimeReadModel().registry;
      await readMeetingSource(SOURCES[name](state), [], null);
      return;
    }
    await readStateCalendars(partitions, state);
  });
}

/**
 * One state's calendar program: the state's data and door list load once, then each due board is read in turn, each
 * starting with only its own held agenda documents. A board that throws is named and the next board is still read.
 * Boards not started before the pass deadline are named as still owed.
 */
async function readStateCalendars(partitions: readonly MeetingPartitionContract[], state: string): Promise<void> {
  const store = new PostgresRoutineDataStore();
  let prepared = false;
  const prepare = async () => {
    if (prepared) return;
    await preloadCanonicalMeetingDependencies({ sourceName: "composite", state });
    REGISTRY = getRegistryRuntimeReadModel().registry;
    prepared = true;
  };
  const facts = { db: readerFactDb(), vault: new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR)) };
  // A read started later than this could not finish its acquisition before the runner ends the pass.
  const lastStartMs = passDeadlineFromEnv() - STANDING_PARTITION_ACQUISITION_TIMEOUT_MS;
  const lastEnded = new Map<string, number>();
  const ordered = calendarReadOrder(partitions);
  for (const [index, partition] of ordered.entries()) {
    const gapEndsMs = (lastEnded.get(partition.acquisitionFailureDomain) ?? Number.NEGATIVE_INFINITY) + ROUTINE_SAME_DOMAIN_CHILD_GAP_MS;
    if (Math.max(Date.now(), gapEndsMs) >= lastStartMs) {
      for (const owed of ordered.slice(index)) console.log(`RCD_MEETING_PARTITION_DEFERRED=${JSON.stringify({ partitionId: owed.id })}`);
      break;
    }
    if (gapEndsMs > Date.now()) await new Promise((resolve) => setTimeout(resolve, gapEndsMs - Date.now()));
    agendaDocumentStore.clear();
    try {
      if (partition.derivedFamily !== null) await promoteDerivedMeetingFamily(store, partition, prepare, facts);
      else {
        await prepare();
        await readMeetingPartition(partition, store);
      }
    } catch (error) {
      console.error(error);
      console.log(`RCD_MEETING_PARTITION_UNREAD=${JSON.stringify({ partitionId: partition.id,
        detail: (error instanceof Error ? error.stack ?? error.message : String(error)).split("\n").slice(0, 8).join(" | ") })}`);
    }
    lastEnded.set(partition.acquisitionFailureDomain, Date.now());
    console.log("RCD_PROGRESS=" + JSON.stringify({ key: partition.id, records: 1 }));
  }
}

async function readMeetingPartition(partition: MeetingPartitionContract, promotionStore: RoutineDataStore): Promise<void> {
  const source = buildCompositeSource({
    timeoutMs: STANDING_PARTITION_ACQUISITION_TIMEOUT_MS,
    captureAcquisitionEvidence: true,
    sourceNames: [partition.meetingSource],
    meetingPartitions: [{ sourceName: partition.meetingSource, bodyId: partition.bodyId, route: partition.wiring?.config.partitionRoute }],
  });
  await readMeetingSource(source, [partition], promotionStore);
}

async function readMeetingSource(source: MeetingSource<unknown>, partitions: readonly MeetingPartitionContract[], promotionStore: RoutineDataStore | null): Promise<void> {
  const previous = source instanceof CompositeSource && promotionStore
    ? await readPreviousMeetingPartition(promotionStore, partitions[0]!)
    : null;

  // Continental US, wide enough to sweep everything the adapter has. The window
  // is always stated: some upstreams default to upcoming-only when it is omitted.
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
  }));
  const workerResponses = retained.responses.filter(response => {
    const url = new URL(response.finalUrl);
    return url.hostname === "webapi.legistar.com" && partitions.some(partition =>
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
              // `placeless` is not a drop: those meetings are kept, with no place and no pin.
              `, kept online: ${d.placeless}`
          : // The two kinds of nothing, told apart. Each is recorded only for the selected source/body;
            // neither becomes an aggregate verdict over sibling partitions.
            `  ${child.source}: ${child.failure === "JOB" ? "JOB FAILURE" : "WALLED"} — ${child.error}`,
      );
    }

    if (previous) {

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
      workerResponses,
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

async function restoreRemovedHistoryForPartition(
  store: RoutineDataStore,
  partition: MeetingPartitionContract,
  previous: MeetingsSnapshot | null,
  generatedAt: string,
): Promise<MeetingsSnapshot | null> {
  if (previous === null || !meetingHistoryRestoreEnabled()) return previous;
  try {
    const history = await readMeetingHistory(partition, { store, now: generatedAt });
    const restored = await restoreRemovedMeetingHistory({
      store, partition, live: previous, history: history.kind === "PROMOTED" ? history.value : null, generatedAt,
    });
    if (restored.meetings.length > 0 || restored.versionsRead > 0) console.log(`  ${partition.id}: history restore: ${restored.detail}`);
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

export function reconcileSuccessfulMeetingPartition(input: {
  readonly sourceName: string;
  readonly generatedAt: string;
  readonly freshMeetings: readonly Meeting[];
  readonly freshAgendaDocuments: MeetingsSnapshot["agendaDocuments"];
  readonly previous: MeetingsSnapshot | null;

  readonly publisherExclusions?: readonly PublisherExclusion[];

  readonly reviewedVenues?: () => readonly VenueEntry[];

  readonly fetchedWindow?: { readonly lowerBound: string; readonly upperBound: string };

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

/** The canonical denominator is the meeting doors in use, never yesterday's rows. */
export function meetingsWiringCoverage(
  snapshot: MeetingsSnapshot,
): MeetingsWiringCoverage {
  const represented = new Set(
    snapshot.sources.flatMap((source) => wiringForSourceName(source.source)),
  );
  const doors = activeWiring();
  const missing = doors.filter((row) => !represented.has(row)).map(
    (row) => `${row.bodyId}:${row.agendaSourceType}`,
  );
  return {
    accounted: doors.length - missing.length,
    denominator: doors.length,
    missing,
  };
}

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
      query: `meeting door route/body ${partition.meetingSource}/${partition.bodyId}; ${snapshot.meetings.length} exact rows`,
      declaredTotal: null,
      paginationComplete: base.horizon.paginationComplete,
      claimsComplete: false,
    },
    dependentChecks: [
      ...base.dependentChecks,
      {
        consumer: `meeting door ${partition.meetingSource}/${partition.bodyId}`,
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
  // A second attempt on the same readings needs its own candidate id.
  const candidate = idSuffix === "" ? built : { ...built, id: `${built.id}${idSuffix}` };
  // An ordinary routine re-check that found nothing new is confirmed on the
  // pointed version, not republished.
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
    ...(failureKind ? { failureKind } : {}),
    // A confirmation names its observed instant, so the supervisor proves it
    // from the pointer's identity and newest confirmation, not the dataset.
    ...(outcome.confirmed ? { confirmedAt: outcome.confirmed.at } : {}),
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  }));
}

/** The fresh sittings a promoted partition read become facts; a failure here never holds the partition. */
async function publishPartitionFacts(facts: MeetingFactsTarget, label: string, source: string,
  meetings: readonly Meeting[], acquisitions: Parameters<typeof tracedResponses>[0][number]["acquisitions"], producedBy: string, at: string): Promise<void> {
  try {
    const responses = tracedResponses([{ source, acquisitions }], facts.responses);
    const report = await publishReadMeetingFacts({ facts: facts.db, vault: facts.vault, meetings, responses, producedBy, clocks: factClocks(null), now: new Date(at) });
    console.log(`  ${label}: facts ${report.live} new, ${report.confirmed} confirmed, ${report.blanks} blank${report.unsaved.length ? `; unsaved ${report.unsaved.join("; ")}` : ""}`);
  } catch (error) {
    console.error(`MEETING_FACTS_FAILED ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Where the sittings each door read become facts, on every response the read made. */
interface MeetingFactsTarget { readonly db: FactDb & { readonly query: Query }; readonly vault: EvidenceStore; readonly responses: readonly RetainedSourceResponse[] }

export interface MeetingPartitionPromotionResult {
  readonly partition: MeetingPartitionContract;
  readonly candidate: RoutineCandidate;
  readonly outcome: PromotionOutcome;
}

export async function promoteMeetingPartitions(input: {
  readonly store: RoutineDataStore;
  readonly partitions: readonly MeetingPartitionContract[];
  readonly meetings: readonly Meeting[];
  readonly agendaDocuments: MeetingsSnapshot["agendaDocuments"];
  readonly reports: NonNullable<CompositeSource["lastReport"]>["children"];
  readonly generatedAt: string;
  readonly previousByContract?: ReadonlyMap<string, MeetingsSnapshot | null>;
  readonly retainedResponses?: readonly RetainedSourceResponse[];
  readonly facts?: MeetingFactsTarget;
  /** Test seam for the Census geocoder; production uses the global fetch. */
  readonly venueFetch?: typeof fetch;
}): Promise<readonly MeetingPartitionPromotionResult[]> {
  const results: MeetingPartitionPromotionResult[] = [];
  for (const partition of input.partitions) {
    const report = input.reports.find((candidate) => candidate.source === partition.meetingSource);
    if (!report || !report.ok) {
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
      return { reconciled, candidate, outcome, census };
    };
    let attempted = await attempt(history.moved);
    // DB-06's safety net: a partition that is refused while sittings are moving to history must not stop its fresh
    // readings reaching readers, so it is promoted again with every sitting kept, exactly as DB-01 keeps them.
    if (!attempted.outcome.promoted && !attempted.outcome.confirmed &&
        attempted.reconciled.removalEvidence.some((row) => row.code === "MOVED_TO_HISTORY")) {
      console.warn(`  ${partition.id}: refused while sittings were moving to history (${attempted.outcome.candidate.failureDetail ?? attempted.outcome.candidate.state}); promoting again with every sitting kept`);
      attempted = await attempt(new Map(), "-kept");
    }
    const { candidate, outcome } = attempted;
    printMeetingPartitionReceipt(
      partition,
      candidate,
      outcome,
      outcome.promoted ? null : outcome.candidate.failureDetail,
    );
    if (outcome.promoted || outcome.confirmed) {
      await publishVenuePins(input.store, partition.id, attempted.census?.package ?? null);
      if (input.facts) await publishPartitionFacts(input.facts, partition.id, partition.meetingSource, freshRows, report.acquisitions ?? [], candidate.id, input.generatedAt);
    }
    results.push({ partition, candidate, outcome });
  }
  return results;
}

async function promoteSelectedMeetingPartitions(
  source: CompositeSource,
  meetings: readonly Meeting[],
  previous: MeetingsSnapshot | null,
  promotionStore: RoutineDataStore,
  partitions: readonly MeetingPartitionContract[],
  retainedResponses: readonly RetainedSourceResponse[],
  readResponses: readonly RetainedSourceResponse[],
): Promise<void> {
  const report = source.lastReport;
  if (!report) {
    throw new Error("MEETING_PARTITION_REPORT_MISSING");
  }

  const okCount = report.children.filter((c) => c.ok).length;
  const now = new Date();
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
      // that a later session has to go back and mark.
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
    facts: { db: readerFactDb(), vault: new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR)), responses: readResponses },
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
