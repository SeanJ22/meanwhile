// @freshness-reads-here
import { fetchSource, runWithSourceFetch, runWithSourceRequestPlan, SourceFetchDeferred } from "../lib/sources/fetch-source.ts";
import { sittingWindowObligation } from "../lib/civic-data/sitting-window-admission.ts";
import { MEETING_SITTING_WINDOW, type SittingWindowSchedule } from "../lib/civic-data/contracts.ts";
import { MEETING_DOCUMENT_TURN_URLS, meetingDocumentInterval, meetingDocumentCheckClock, type MeetingDocumentChecks, type MeetingDocumentTarget } from "../lib/meetings/document-checks.ts";
import { meetingDocumentTargets, retrievePublishedMeetingDocument } from "../lib/outcomes/minutes-ingest.ts";
import { pathToFileURL } from "node:url";
import { routineScopeState } from "../lib/civic-data/state-scope.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import type { DoorRepository } from "../lib/doors/registry.ts";

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
import {
  attributionSummary,
  resolveMeetingBodies,
} from "../lib/meetings/attribution.ts";
import { agendaItems } from "../lib/routing/agenda-search.ts";
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
import type { RoutineCandidate, RoutineRemovalEvidence, SourceCheckEvidence } from "../lib/civic-data/types.ts";
import {
  meetingPartitionContract,
  meetingPartitionOfId,
  type MeetingPartitionContract,
} from "../lib/civic-data/meeting-partitions.ts";
import { authorityFor } from "../lib/civic-data/source-authority.ts";
import type { CompositeSource } from "../lib/sources/composite/index.ts";
import { occurrenceStampFromInstant, reissuesSitting, supersedesSeriesRecord } from "../lib/sources/event-identity.ts";
import {
  STANDING_PARTITION_ACQUISITION_TIMEOUT_MS,
  buildCompositeSource,
  wiringForSourceName,
} from "../lib/sources/composite/wiring.ts";
import { activeWiring, isUnreadableRetiredMeetingHost } from "../lib/registry/source-wiring.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { installMeetingBodyDoors } from "../lib/doors/meeting-doors.ts";
import { isLegistarDocumentHost } from "../lib/sources/legistar/routes.ts";
import { isLegistarMeetingDetailUrl, isPortalAgendaLinkFor, portalAgendaLinkFrom } from "../lib/sources/legistar/portal-agenda-link.ts";
import { sourceUserAgent } from "../lib/sources/http.ts";
import type { Registry } from "../lib/registry/types.ts";
import { getRegistryRuntimeReadModel } from "../lib/registry/runtime-read-model.ts";
import { preloadMeetingDependencies, type MeetingDependencyScope } from "../lib/civic-data/meeting-dependencies.ts";
import type { ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { publishVenueResolutions } from "../lib/meetings/venue-publication.ts";
import { placeMeetingsFromCensusVenues } from "../lib/meetings/automatic-venue-resolutions.ts";
import { currentVenueCache, resolveVenue, venueResolutionRecordId, type VenueEntry } from "../lib/meetings/venue-cache.ts";
import { placeUnplacedFromAgendas } from "./lib/agenda-meeting-location.ts";
import type { Meeting, PublisherExclusion, RecurrenceReport } from "../lib/sources/types.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { retainMeetingFetchBytes, retainMeetingCandidateEvidence, tracedResponses, type RetainedSourceResponse } from "../lib/civic-data/retained-meeting-bytes.ts";
import { publishReadMeetingFacts } from "../lib/civic-data/meeting-fact-publication.ts";
import { readerFactDb } from "../lib/facts/db.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { join } from "node:path";

let REGISTRY: Registry | null = null;

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

export async function preloadCanonicalMeetingDependencies(input: MeetingDependencyScope & { readonly query?: Query }): Promise<void> {
  await preloadMeetingDependencies(input, input.query);
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

function readDocumentUrl(base: typeof fetch): typeof fetch & { readonly clear: () => void } {
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
  }) as typeof fetch & { readonly clear: () => void };
  Object.defineProperty(wrapped, "clear", { value: () => reads.clear() });
  return wrapped;
}

export function refusalCheckedFetch(base?: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const impl = base ?? fetchSource;
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
  schedule: SittingWindowSchedule = MEETING_SITTING_WINDOW,
): Meeting[] {
  const distance = (meeting: Meeting) => Math.abs(Date.parse(meeting.startsAt) - nowMs);
  return [...meetings].sort((left, right) =>
    (meetingDocumentInterval(left, schedule, nowMs) - meetingDocumentInterval(right, schedule, nowMs)) ||
    (Number(readThroughNoticePage(left)) - Number(readThroughNoticePage(right))) ||
    (distance(left) - distance(right)) || left.id.localeCompare(right.id));
}

export interface MeetingDocumentWorkOptions {
  readonly previous?: MeetingDocumentChecks;
  readonly schedule?: SittingWindowSchedule;
  readonly now?: () => number;
  readonly budgetMs?: number;
  readonly maxUrls?: number;
  readonly retryEveryMs?: number;
  readonly fetchImpl?: typeof fetch;
}

function documentTargets(meetings: readonly Meeting[]): MeetingDocumentTarget[] {
  return [...meetings.flatMap(meeting => {
    const url = documentUrlFor(meeting);
    return url === null ? [] : [{ url, meeting, kind: "AGENDA" as const }];
  }), ...meetingDocumentTargets(meetings)];
}

function orderedDocumentTargets(meetings: readonly Meeting[], now: number, schedule: SittingWindowSchedule): MeetingDocumentTarget[] {
  const order = new Map(agendaRetrievalOrder(meetings, now, schedule).map((meeting, index) => [meeting.id, index]));
  return documentTargets(meetings).sort((left, right) => order.get(left.meeting.id)! - order.get(right.meeting.id)!);
}

function documentDueAt(checkedAt: string, interval: number, schedule: SittingWindowSchedule): string {
  const checked = Date.parse(checkedAt);
  return new Date(sittingWindowObligation(schedule, interval,
    { attemptedMs: checked, succeededMs: checked, published: true }, interval === schedule.hotEveryMs).eligibleAtMs).toISOString();
}

export function plannedMeetingDocumentChecks(meetings: readonly Meeting[], options: MeetingDocumentWorkOptions = {}): MeetingDocumentChecks {
  const now = (options.now ?? Date.now)(), schedule = options.schedule ?? MEETING_SITTING_WINDOW;
  const previous = new Map(options.previous?.documents.map(check => [check.url, check]));
  const intervals = new Map<string, number>();
  for (const { meeting, url } of orderedDocumentTargets(meetings, now, schedule)) {
    if (agendaRetrievalRefusal(url) !== null) continue;
    intervals.set(url, Math.min(intervals.get(url) ?? Infinity, meetingDocumentInterval(meeting, schedule, now)));
  }
  return { documents: [...intervals].map(([url, interval]) => {
    const prior = previous.get(url);
    if (!prior) return { url, checkedAt: null, attemptedAt: null, nextDueAt: new Date(now).toISOString(), outcome: "DEFERRED" };
    if (prior.outcome === "FAILED" && prior.attemptedAt !== null) return { ...prior,
      nextDueAt: new Date(Date.parse(prior.attemptedAt) + Math.min(interval, options.retryEveryMs ?? interval)).toISOString() };
    if (prior.outcome !== "CHECKED" || prior.checkedAt === null) return prior;
    const nextDueAt = documentDueAt(prior.checkedAt, interval, schedule);
    return { ...prior, nextDueAt, outcome: Date.parse(nextDueAt) <= now ? "DEFERRED" as const : "CHECKED" as const };
  }) };
}

export async function retrieveMeetingDocuments(meetings: readonly Meeting[], options: MeetingDocumentWorkOptions = {}): Promise<MeetingDocumentChecks> {
  const now = options.now ?? Date.now, started = now(), schedule = options.schedule ?? MEETING_SITTING_WINDOW;
  const budgetMs = options.budgetMs ?? 15_000, maxUrls = options.maxUrls ?? MEETING_DOCUMENT_TURN_URLS;
  const checks = new Map(plannedMeetingDocumentChecks(meetings, options).documents.map(check => [check.url, check]));
  const groups = new Map<string, MeetingDocumentTarget[]>();
  for (const target of orderedDocumentTargets(meetings, started, schedule)) {
    if (agendaRetrievalRefusal(target.url) !== null || !checks.has(target.url)) continue;
    groups.set(target.url, [...(groups.get(target.url) ?? []), target]);
  }
  let attempted = 0;
  for (const [url, members] of groups) {
    const prior = checks.get(url)!;
    if (Date.parse(prior.nextDueAt) > now()) continue;
    if (attempted >= maxUrls || now() - started >= budgetMs) break;
    attempted++;
    const attemptedAt = new Date(now()).toISOString();
    const interval = Math.min(...members.map(({ meeting }) => meetingDocumentInterval(meeting, schedule, now())));
    const signal = AbortSignal.timeout(Math.max(1, budgetMs - (now() - started)));
    const base = refusalCheckedFetch(options.fetchImpl);
    const fetchImpl = readDocumentUrl(((input, init) => base(input, { ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal })) as typeof fetch);
    let checkedAt = prior.checkedAt;
    let contentHash = prior.contentHash;
    try {
      await runWithSourceFetch({ dueAt: prior.nextDueAt, nextDueAt: new Date(now() + interval).toISOString() }, () =>
        runWithSourceRequestPlan({ kind: "DOCUMENT", targetUrl: url }, async () => {
        for (const target of members) {
          const meeting = target.meeting;
          if (target.kind !== "AGENDA") {
            const doc = await retrievePublishedMeetingDocument(target, fetchImpl, meeting.publishedDocuments);
            const held = meeting.publishedDocuments ?? [];
            if (doc.extraction === "TEXT_EXTRACTED" || !held.some(row => row.url === doc.url && row.kind === doc.kind && row.extraction === "TEXT_EXTRACTED")) {
              meeting.publishedDocuments = [...held.filter(row => row.url !== doc.url || row.kind !== doc.kind), doc];
            }
            if (doc.extraction === "UNREADABLE") throw new Error(doc.extractionNote ?? "The document has no readable text.");
            checkedAt = doc.checkedAt;
            contentHash = doc.contentHash;
            continue;
          }
          let override = url;
          if (readsThroughPortal(meeting, url)) {
            try { override = await portalAgendaLinkFor(meeting, fetchImpl) ?? url; }
            catch (error) { if (signal.aborted) throw error; }
          }
          const doc = await retrieveAgendaDocument(meeting, { fetchImpl, urlOverride: override });
          if (!doc) continue;
          checkedAt = doc.retrievedAt;
          contentHash = doc.contentHash;
          if (agendaDocumentStore.isUrlOnAnotherMeeting(doc.documentUrl, doc.meetingId) && agendaItems(doc.text).length === 0) continue;
          if (readThroughNoticePage(meeting) && agendaItems(doc.text ?? "").length === 0) continue;
          if (doc.extraction === "failed") {
            if (!agendaDocumentStore.latestFor(doc.meetingId)) agendaDocumentStore.append(doc);
            throw new Error(doc.extractionNote ?? "The document has no readable text.");
          }
          agendaDocumentStore.append(doc);
        }
      }));
      checks.set(url, { url, checkedAt, contentHash, attemptedAt, outcome: "CHECKED", nextDueAt: documentDueAt(checkedAt ?? attemptedAt, interval, schedule) });
    } catch (error) {
      const deferred = error instanceof SourceFetchDeferred;
      checks.set(url, { url, checkedAt: prior.checkedAt, ...(prior.contentHash ? { contentHash: prior.contentHash } : {}), attemptedAt, outcome: deferred ? "DEFERRED" : "FAILED",
        nextDueAt: new Date(deferred ? error.until : now() + Math.min(interval, options.retryEveryMs ?? interval)).toISOString() });
      console.warn(`DOCUMENT_CHECK_PENDING ${url}: ${error instanceof Error ? error.message : String(error)}`);
    } finally { fetchImpl.clear(); }
  }
  console.log(`meeting documents: ${checks.size} URLs, ${attempted} attempted, ${[...checks.values()].filter(check => check.outcome !== "CHECKED").length} pending`);
  return { documents: [...checks.values()], ...(options.previous?.calendarRetryAt ? { calendarRetryAt: options.previous.calendarRetryAt } : {}) };
}

async function publishVenuePins(store: RoutineDataStore, partitionId: string, pkg: ManualProjectionPackage | null): Promise<void> {
  const published = await publishVenueResolutions({ store, package: pkg, now: new Date().toISOString() });
  if (published.records === 0) return;
  console.log(`VENUE_RESOLUTIONS_PUBLISHED=${JSON.stringify({ partition: partitionId, records: published.records,
    promoted: published.outcome?.promoted?.versionId ?? null, held: published.held })}`);
}

export interface MeetingPartitionRunOptions {
  readonly onReceipt?: (line: string) => void;
  readonly dueAt?: string;
  readonly nextDueAt?: string;
  readonly documentRetryEveryMs?: number;
  readonly calendarDueAt?: string;
  readonly meetingSchedule?: SittingWindowSchedule;
  readonly doors?: DoorRepository;
  readonly store?: RoutineDataStore;
  readonly dependencyQuery?: Query;
  readonly facts?: { readonly db: (FactDb & { readonly query: Query }) | null; readonly vault: EvidenceStore };
}

let workerDoors: Promise<DoorRepository> | undefined;

export async function runMeetingPartition(id: string, options: MeetingPartitionRunOptions = {}): Promise<void> {
  try {
    await runMeetingIngest(["composite", "--promote", `--only-partition=${id}`], options);
  } finally {
    agendaDocumentStore.clear();
    clearPromotedReadModelCache();
    REGISTRY = null;
  }
}

async function runMeetingIngest(args: readonly string[], options: MeetingPartitionRunOptions = {}) {
  installNeonRequestDeadline();
  if (args[0] !== "composite" || !args.slice(1).includes("--promote")) {
    throw new Error("Usage: pnpm ingest composite --promote --only-partition=<source/body partition>");
  }
  const requested = args.slice(1).find(arg => arg.startsWith("--only-partition="))?.slice("--only-partition=".length);
  const body = requested ? meetingPartitionOfId(requested)?.bodyId : undefined;
  if (body) {
    if (!options.doors && !workerDoors) {
      const connection = controlPlaneUrlFromEnv();
      if (!connection) throw new Error("MEETING_BODY_DOOR_STORE_UNAVAILABLE");
      workerDoors = createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true }).then(repos => repos.doors);
    }
    await installMeetingBodyDoors(options.doors ?? await workerDoors!, body);
  } else {
    throw new Error("MEETING_DEPENDENCY_BODY_REQUIRED");
  }
  const partitions = selectedMeetingPartitions(args.slice(1));

  const partition = requested ? meetingPartitionContract(requested) : null;
  if (!partition) throw new Error("MEETING_DEPENDENCY_BODY_REQUIRED");
  await preloadCanonicalMeetingDependencies({ bodyId: partition.bodyId, ocdId: partition.ocdId,
    tenant: partition.wiring?.config.slug, query: options.dependencyQuery });
  REGISTRY = getRegistryRuntimeReadModel().registry;
  const promotionStore = options.store ?? new PostgresRoutineDataStore();

  const scopeState = routineScopeState(body ?? "US");
  const state = scopeState === "US" ? undefined : scopeState.slice(3).toLowerCase();
  const websiteSize = websiteSizeFromHoldings(state ? [state] : []);
  const memberFetch = meetingFetchPass({ websiteSize });
  let latestReceipt: string | undefined;
  const onReceipt = (line: string) => { latestReceipt = line; options.onReceipt?.(line); };
  return runWithSourceFetch({ sourceId: partition.id, state, websiteSize, dueAt: options.dueAt ?? process.env.WTP_SOURCE_DUE_AT, nextDueAt: options.nextDueAt ?? process.env.WTP_SOURCE_NEXT_DUE_AT }, async () => {
    const source = buildCompositeSource({
      timeoutMs: STANDING_PARTITION_ACQUISITION_TIMEOUT_MS,
      captureAcquisitionEvidence: true,
      fetchImpl: memberFetch,
      sourceNames: [...new Set(partitions.map(partition => partition.meetingSource))],
      meetingPartitions: partitions.map(partition => ({ sourceName: partition.meetingSource, bodyId: partition.bodyId })),
    });
    const previous = await readPreviousMeetingPartition(promotionStore, partition);
    const heldChecks = await promotionStore.meetingCheckState(MEETINGS_SOURCE_ID, partition.scope);
    const now = Date.now();
    const documentOnly = previous !== null && heldChecks.sourceCheck !== undefined &&
      options.calendarDueAt !== undefined && Date.parse(options.calendarDueAt) > now;
    let calendarRetryAt: string | undefined = documentOnly ? heldChecks.meetingChecks?.calendarRetryAt : undefined;
    const retained = documentOnly ? { value: [], responses: [] as RetainedSourceResponse[] } :
      await runWithSourceFetch({ dueAt: options.calendarDueAt ?? options.dueAt,
        onDeferred: deferred => { calendarRetryAt = new Date(Math.max(Date.parse(calendarRetryAt ?? "") || 0, deferred.until)).toISOString(); },
      }, () => runWithSourceRequestPlan({ kind: "CALENDAR" }, () => retainMeetingFetchBytes(() => source.fetch({
        lat: 39.5, lng: -98.35, radiusKm: 5000,
        startsAfter: new Date(now - MEETING_HELD_LOOKBACK_DAYS * 86_400_000).toISOString(),
        startsBefore: new Date(now + MEETING_HELD_HORIZON_DAYS * 86_400_000).toISOString(),
      }))));
    const workerResponses = retained.responses.filter(response => {
      const url = new URL(response.finalUrl);
      return url.hostname === "webapi.legistar.com" && partition.meetingSource === "legistar" &&
        url.pathname.toLowerCase() === `/v1/${partition.wiring?.config.slug}/events`;
    });
    let meetings: Meeting[];
    if (documentOnly) {
      meetings = previous.meetings.map(meeting => ({ ...meeting }));
      source.lastPartitionRows = meetings;
      source.lastReport = { at: previous.generatedAt, fromCache: true, duplicateSittingsCollapsed: 0,
        children: previous.sources.map(report => ({ ...report, drops: { ...report.drops } })) };
    } else {
      meetings = resolveAttribution(source.normalize(retained.value));
    }
    if (previous) {
      seedHeldAgendaDocuments(previous);
      const heldDocuments = new Map(previous.meetings.map(meeting => [meeting.id, meeting.publishedDocuments]));
      for (const meeting of [...meetings, ...source.lastPartitionRows]) {
        const documents = heldDocuments.get(meeting.id);
        if (documents?.length) meeting.publishedDocuments = [...documents];
      }
    }
    if (!source.lastReport) throw new Error("MEETING_PARTITION_REPORT_MISSING");
    const workOptions = { previous: heldChecks.meetingChecks, schedule: options.meetingSchedule,
      retryEveryMs: options.documentRetryEveryMs };
    const plannedChecks = { ...plannedMeetingDocumentChecks(source.lastReport.children.every(report => report.ok) ? meetings : previous?.meetings ?? [], workOptions),
      ...(calendarRetryAt ? { calendarRetryAt } : {}) };
    if (!documentOnly) {
      await promoteSelectedMeetingPartitions(source, source.lastPartitionRows, previous, promotionStore,
        partitions, workerResponses, retained.responses, options.facts, onReceipt, plannedChecks);
    }
    if (!source.lastReport.children.every(report => report.ok)) return;
    const checks = await retrieveMeetingDocuments(meetings, { ...workOptions, previous: plannedChecks });
    if (!documentOnly && !checks.documents.some(check => check.attemptedAt !== null && Date.parse(check.attemptedAt) >= now)) return;
    const current = documentOnly ? previous : await readPreviousMeetingPartition(promotionStore, partition);
    const calendarCheck = documentOnly ? heldChecks.sourceCheck : undefined;
    const documentsByMeeting = new Map(meetings.map(meeting => [meeting.id, meeting.publishedDocuments]));
    for (const meeting of source.lastPartitionRows) {
      const documents = documentsByMeeting.get(meeting.id);
      if (documents?.length) meeting.publishedDocuments = documents;
    }
    const agendaPlaced = placeUnplacedFromAgendas(source.lastPartitionRows, meetingId => {
      const document = agendaDocumentStore.latestFor(meetingId);
      return document && document.extraction !== "failed" ? document.text : null;
    }, currentVenueCache());
    await promoteSelectedMeetingPartitions(source, agendaPlaced.rows, current, promotionStore,
      partitions, workerResponses, retained.responses, options.facts, onReceipt, checks, calendarCheck, false);
  }).finally(() => {
    memberFetch.clear();
    if (latestReceipt) console.log(latestReceipt);
  });
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
        passed: snapshot.sources.length > 0 && snapshot.sources.every(source => source.source === partition.meetingSource),
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
  checkedResponses: readonly RetainedSourceResponse[] = retainedResponses,
  meetingChecks?: MeetingDocumentChecks,
  preservedSourceCheck?: SourceCheckEvidence,
): Promise<{
  readonly candidate: RoutineCandidate;
  readonly outcome: PromotionOutcome;
}> {
  validateSnapshot(snapshot);
  const checked = tracedResponses(snapshot.sources, checkedResponses)
    .filter(response => Number.isFinite(Date.parse(response.retrievedAt)) && response.httpStatus === 200)
    .sort((left, right) => Date.parse(left.retrievedAt) - Date.parse(right.retrievedAt))[0];
  const sourceCandidate = candidateForMeetingPartition(partition, snapshot, additionalViolations, removalEvidence, heldFacts);
  const observedSourceCheck = checked ? {
    requestedUrl: checked.requestedUrl, finalUrl: checked.finalUrl, httpStatus: checked.checkStatus === 304 ? 304 as const : 200 as const,
    rawHash: checked.rawHash, checkedAt: checked.retrievedAt,
  } : preservedSourceCheck;
  const built = retainMeetingCandidateEvidence(
    { ...sourceCandidate, retrieval: { ...sourceCandidate.retrieval,
      ...(observedSourceCheck ? { sourceCheck: observedSourceCheck } : {}),
      ...(meetingChecks ? { meetingChecks } : {}),
    } },
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
  onReceipt?: (line: string) => void,
): void {
  const line = "RCD_MEETING_PARTITION_RECEIPT=" + JSON.stringify({
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
    ...meetingDocumentCheckClock(candidate.retrieval.meetingChecks),

    ...(failureKind ? { failureKind } : {}),
    // A confirmation names its observed instant, so the supervisor proves it
    // from the pointer's identity and newest confirmation, not the dataset.
    ...(outcome.confirmed ? { confirmedAt: outcome.confirmed.at } : {}),
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  });
  if (onReceipt) onReceipt(line);
  else console.log(line);
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
  readonly onReceipt?: (line: string) => void;
  readonly store: RoutineDataStore;
  readonly partitions: readonly MeetingPartitionContract[];
  readonly meetings: readonly Meeting[];
  readonly agendaDocuments: MeetingsSnapshot["agendaDocuments"];
  readonly reports: NonNullable<CompositeSource["lastReport"]>["children"];
  readonly generatedAt: string;
  readonly previousByContract?: ReadonlyMap<string, MeetingsSnapshot | null>;
  readonly retainedResponses?: readonly RetainedSourceResponse[];
  readonly checkedResponses?: readonly RetainedSourceResponse[];
  readonly meetingChecks?: MeetingDocumentChecks;
  readonly preservedSourceCheck?: SourceCheckEvidence;
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
      const failedBase = failedAcquisitionCandidate({
        sourceId: MEETINGS_SOURCE_ID,
        recordClass: MEETINGS_RECORD_CLASS,
        scope: partition.scope,
        requestedUrl: report?.acquisitions?.[0]?.requestedUrl ?? "",
        attemptedAt: input.generatedAt,
        failureDetail,
        parserVersion: "meetings-composite/2",
      });
      const failed = { ...failedBase, retrieval: { ...failedBase.retrieval, ...(input.meetingChecks ? { meetingChecks: input.meetingChecks } : {}) } };
      const outcome = await processRegisteredMeetingPartitionCandidate(input.store, partition.id, failed, input.generatedAt);
      printMeetingPartitionReceipt(partition, failed, outcome, failureDetail, failureKind, input.onReceipt);
      results.push({ partition, candidate: failed, outcome });
      continue;
    }

    const heldRows: { key: string; code: string; detail: string; record: unknown }[] = [];
    const freshRows = input.meetings.filter((meeting) => {
      if (meeting.bodyId !== partition.bodyId || !meeting.id.startsWith(`${partition.meetingSource}:`)) return false;
      if (Number.isFinite(Date.parse(meeting.startsAt)) && meeting.provenance?.sourceUrl) return true;
      heldRows.push({ key: `meeting:${meeting.id}`, code: "MEETING_ROW_UNVERIFIED",
        detail: "The meeting lacks a confirmed date and time or its source page.", record: meeting });
      return false;
    });
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
        [...recurrence.held, ...heldRows],
        idSuffix,
        input.checkedResponses,
        input.meetingChecks,
        input.preservedSourceCheck,
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
      null, input.onReceipt,
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
  facts?: MeetingPartitionRunOptions["facts"],
  onReceipt?: (line: string) => void,
  meetingChecks?: MeetingDocumentChecks,
  preservedSourceCheck?: SourceCheckEvidence,
  publishFacts = true,
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
    onReceipt,
    store: promotionStore,
    partitions,
    meetings,
    agendaDocuments: snapshot.agendaDocuments,
    reports: report.children,
    generatedAt: snapshot.generatedAt,
    previousByContract: new Map(partitions.map((partition) => [partition.id, previous])),
    retainedResponses,
    checkedResponses: readResponses,
    meetingChecks,
    preservedSourceCheck,
    ...(!publishFacts || facts?.db === null ? {} : { facts: { db: facts?.db ?? readerFactDb(),
      vault: facts?.vault ?? new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR)), responses: readResponses } }),
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
  runMeetingIngest(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
