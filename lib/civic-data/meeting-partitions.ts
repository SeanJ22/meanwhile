import {
  RETIRED_MEETING_ROUTES,
  activeWiring,
  meetingSourceNamesForWiring,
  type BodySourceWiring,
} from "../registry/source-wiring.ts";
import {
  DERIVED_MEETING_FAMILY_POLICY,
  DERIVED_MEETING_FAMILY_STATES,
  MEETING_PARTITION_POLICY,
  ROUTINE_SOURCE_CONTRACTS,
  type DerivedMeetingFamilyState,
  type RoutineSourceContract,
} from "./contracts.ts";

import { MEETING_HISTORY_SCOPE_SUFFIX } from "./meeting-history-scope.ts";
import { RUNTIME_ROUTINE_CONTRACTS } from "./runtime-routine-contracts.ts";
import { derivedRequestedUrl } from "./derived-door.ts";

export const LEGACY_MEETINGS_AGGREGATE_SCOPE = "supported-bodies";

export const MEETING_HISTORY_SOURCE_ID = "meetings-history" as const;

export interface MeetingPartitionContract extends RoutineSourceContract {
  readonly meetingSource: string;
  readonly acquisitionFailureDomain: string;
  readonly bodyId: string;
  readonly ocdId: string | null;
  readonly wiring: BodySourceWiring | null;
  readonly derivedFamily: DerivedMeetingFamilyState | null;
  readonly historyOf?: string;
}

export const DERIVED_FAMILY_SOURCE = "derived";

export function derivedMeetingFamilyId(state: DerivedMeetingFamilyState): string {
  return `meetings:${DERIVED_FAMILY_SOURCE}:${state}`;
}

export function derivedMeetingFamilyScope(state: DerivedMeetingFamilyState): string {
  return `source:${DERIVED_FAMILY_SOURCE}:family:${state}`;
}

export function meetingPartitionScope(sourceName: string, bodyId: string): string {
  if (!sourceName || !bodyId) throw new Error("MEETING_PARTITION_IDENTITY_MISSING");
  return `source:${encodeURIComponent(sourceName)}:body:${encodeURIComponent(bodyId)}`;
}

export function meetingPartitionId(sourceName: string, bodyId: string): string {
  return `meetings:${sourceName}:${encodeURIComponent(bodyId)}`;
}

export function meetingPartitionOfId(id: string): { readonly source: string; readonly bodyId: string; readonly scope: string } | null {
  const named = /^meetings:([^:]+):(.+)$/.exec(id);
  if (named === null) return null;
  const [, source, rest] = named as unknown as [string, string, string];
  if (source === DERIVED_FAMILY_SOURCE) {
    const state = rest as DerivedMeetingFamilyState;
    return { source, bodyId: `derived-family:${state}`, scope: derivedMeetingFamilyScope(state) };
  }
  let bodyId: string;
  try {
    bodyId = decodeURIComponent(rest);
  } catch {
    return null;
  }
  return { source, bodyId, scope: meetingPartitionScope(source, bodyId) };
}

/** Every supported adapter is explicit, so a new route cannot silently fall back to a shared failure domain. */
export function meetingAcquisitionFailureDomain(
  sourceName: string,
  wiring: BodySourceWiring,
): string {
  if (sourceName === "legistar") {
    const tenant = wiring.config.slug?.trim().toLowerCase();
    if (!tenant || !/^[a-z0-9_-]+$/.test(tenant)) throw new Error(`LEGISTAR_SOURCE_WIRING_INVALID:${wiring.bodyId}`);
    return `meeting-upstream:webapi.legistar.com/${tenant}`;
  }
  const endpoint = (() => {
    switch (sourceName) {
      case "legistar": return "https://webapi.legistar.com";
      case "legistar-insite": return wiring.config.insiteHost;
      case "onbase": return wiring.config.baseUrl;
      case "diligent": return wiring.config.serviceBase;
      case "clerksboards": return "https://clerksboards.tucsonaz.gov";
      case "boardbook": return "https://meetings.boardbook.org";
      case "municode": return wiring.config.portalUrl;
      case "escribe": return wiring.config.portalUrl;
      case "boarddocs": return wiring.config.portalUrl;
      case "granicus": return wiring.config.publisherUrl;
      case "novusagenda": return wiring.config.portalUrl;
      case "swagit": return wiring.config.portalUrl;
      case "primegov": return wiring.config.portalUrl;
      case "civicplus": return wiring.config.agendaCenterUrl ?? wiring.config.icalUrl;
      case "iqm2": return wiring.config.base;
      case "revize": return wiring.config.base;
      case "apptegy": return wiring.config.apiBase;
      case "schedulepage": return wiring.config.schedulePage;
      case "ical": return wiring.config.feedUrl;
      case "civicclerk": return wiring.config.apiBase;
      case "pima-edu": return wiring.config.documentsUrl;
      case "official-page-events": return wiring.config.pageUrl;
      case "document-listing": return wiring.config.pageTemplate;
      case "suiteone": return wiring.config.portalUrl;
      default: throw new Error(`MEETING_FAILURE_DOMAIN_ADAPTER_UNKNOWN:${sourceName}`);
    }
  })()?.trim();
  if (!endpoint) {
    throw new Error(`MEETING_FAILURE_DOMAIN_ENDPOINT_MISSING:${sourceName}:${wiring.bodyId}`);
  }
  let url: URL;
  try {
    url = new URL(endpoint.includes("://") ? endpoint : `https://${endpoint}`);
  } catch {
    throw new Error(`MEETING_FAILURE_DOMAIN_ENDPOINT_INVALID:${sourceName}:${wiring.bodyId}`);
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error(`MEETING_FAILURE_DOMAIN_ENDPOINT_INVALID:${sourceName}:${wiring.bodyId}`);
  }
  // Google Calendar serves many publishers from one host, so the calendar, not the hostname, is the lane.
  const host = url.hostname.toLowerCase();
  if (sourceName === "municode" && host === "meetings.municode.com") return `meeting-upstream:${host}/${url.searchParams.get("cid")?.toLowerCase()}`;
  if (sourceName === "boarddocs") {
    const tenant = /^(\/[^/]+\/[^/]+\/Board\.nsf)(?:\/|$)/i.exec(url.pathname)?.[1];
    if (!tenant) throw new Error(`MEETING_FAILURE_DOMAIN_ENDPOINT_INVALID:${sourceName}:${wiring.bodyId}`);
    return `meeting-upstream:${host}${tenant.toLowerCase()}`;
  }
  const googleCalendar = host === "calendar.google.com" ? /^\/calendar\/ical\/([^/]+)\//.exec(url.pathname)?.[1] : undefined;
  if (googleCalendar) return `meeting-upstream:${host}/${decodeURIComponent(googleCalendar).toLowerCase()}`;
  return `meeting-upstream:${host}`;
}

/** The partition contract one route of one body runs under; a door's own, or a route kind's for the release firewall. */
export function meetingRoutePartition(
  meetingSource: string,
  bodyId: string,
  door: { readonly wiring: BodySourceWiring | null; readonly ocdId: string | null; readonly acquisitionFailureDomain: string },
): MeetingPartitionContract {
  const { readerConsumers, ...policy } = MEETING_PARTITION_POLICY;
  return {
    ...policy,
    id: meetingPartitionId(meetingSource, bodyId),
    scope: meetingPartitionScope(meetingSource, bodyId),
    acquisitionAdapter: {
      authorityMode: "REGISTERED_SOURCE_ROUTES" as const,
      command: ["scripts/ingest.ts", "composite", "--promote", `--only-partition=${meetingPartitionId(meetingSource, bodyId)}`],
    },
    readerProjection: {
      id: `meetings-partition:${meetingSource}:${bodyId}`,
      consumers: readerConsumers,
    },
    lkgBehavior:
      `Only ${meetingSource}/${bodyId} may move this pointer. A refusal leaves this partition's prior GOOD version live without delaying any other source/body.`,
    bootstrapFixturePaths: [],
    meetingSource,
    acquisitionFailureDomain: door.acquisitionFailureDomain,
    bodyId,
    ocdId: door.ocdId,
    wiring: door.wiring,
    derivedFamily: null,
  };
}

/** A door that could not be built into work is left out with its reason; the other doors are not held back by it. */
function buildMeetingPartitions(wirings: readonly BodySourceWiring[], skipped: string[] = []): MeetingPartitionContract[] {
  const doorPartitions = (wiring: BodySourceWiring): MeetingPartitionContract[] =>
    meetingSourceNamesForWiring(wiring).map((meetingSource) => meetingRoutePartition(meetingSource, wiring.bodyId, {
      wiring,
      ocdId: wiring.ocdId,
      acquisitionFailureDomain: meetingAcquisitionFailureDomain(meetingSource, wiring),
    }));
  const partitions: MeetingPartitionContract[] = [];
  const ids = new Set<string>();
  const scopes = new Set<string>();
  for (const wiring of wirings) {
    try {
      const built = doorPartitions(wiring);
      const clash = built.find((partition) => ids.has(partition.id) || scopes.has(partition.scope));
      if (clash) throw new Error(`MEETING_PARTITION_COLLISION:${clash.id}:${clash.scope}`);
      for (const partition of built) {
        ids.add(partition.id);
        scopes.add(partition.scope);
      }
      partitions.push(...built);
    } catch (error) {
      skipped.push(`${wiring.bodyId} (${wiring.agendaSourceType}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const { readerConsumers: familyConsumers, ...familyPolicy } = DERIVED_MEETING_FAMILY_POLICY;
  for (const state of DERIVED_MEETING_FAMILY_STATES) {
    const id = derivedMeetingFamilyId(state);
    partitions.push({
      ...familyPolicy,
      id,
      scope: derivedMeetingFamilyScope(state),
      acquisitionAdapter: {
        authorityMode: "DERIVED" as const,
        command: ["scripts/ingest.ts", "composite", "--promote", `--only-partition=${id}`],
      },
      readerProjection: { id: `meetings-partition:${DERIVED_FAMILY_SOURCE}:${state}`, consumers: familyConsumers },
      lkgBehavior:
        `Only the ${state} derived family may move this pointer. A failed or suspended member keeps its own last verified sittings; ` +
        "an unreadable wiring store refuses the family's candidate and leaves its prior GOOD version live.",
      bootstrapFixturePaths: [],
      meetingSource: DERIVED_FAMILY_SOURCE,
      acquisitionFailureDomain: `derived-family:${state}`,
      bodyId: `derived-family:${state}`,
      ocdId: null,
      wiring: null,
      derivedFamily: state,
    });
  }
  for (const partition of partitions.filter((p) => p.derivedFamily !== null)) {
    if (ids.has(partition.id) || scopes.has(partition.scope)) throw new Error(`MEETING_PARTITION_COLLISION:${partition.id}:${partition.scope}`);
    ids.add(partition.id);
    scopes.add(partition.scope);
  }
  return partitions;
}

export const MEETING_PARTITION_CONTRACTS: MeetingPartitionContract[] = buildMeetingPartitions([]);

/** A retired partition's last promoted version is held read-only, in its successor's place, until the successor promotes. */
export interface HeldMeetingPartition {
  readonly id: string;
  readonly scope: string;
  readonly meetingSource: string;
  readonly bodyId: string;
  readonly successorId: string;
  readonly successorScope: string;
  readonly retiredOn: string;
}

function buildHeldMeetingPartitions(contracts: readonly MeetingPartitionContract[]): HeldMeetingPartition[] {
  const registered = new Map(contracts.map((partition) => [partition.id, partition]));
  const held = RETIRED_MEETING_ROUTES.flatMap((route) => {
    const id = meetingPartitionId(route.meetingSource, route.bodyId);
    const successorId = meetingPartitionId(route.replacedBy, route.bodyId);
    if (registered.has(id)) throw new Error(`MEETING_PARTITION_RETIRED_BUT_REGISTERED:${id}`);
    const successor = registered.get(successorId);
    // A successor that is not a door in use has no place for the retired route's rows to be held in.
    if (!successor || successor.bodyId !== route.bodyId) return [];
    // A successor already wired for the body has its own pointer: there is no gap to hold.
    if (route.successorAlreadyWired) return [];
    return [{
      id,
      scope: meetingPartitionScope(route.meetingSource, route.bodyId),
      meetingSource: route.meetingSource,
      bodyId: route.bodyId,
      successorId,
      successorScope: successor.scope,
      retiredOn: route.retiredOn,
    }];
  });
  const successors = new Set<string>();
  for (const row of held) {
    if (successors.has(row.successorId)) throw new Error(`MEETING_PARTITION_SUCCESSOR_HOLDS_TWO:${row.successorId}`);
    successors.add(row.successorId);
  }
  return held;
}

export const HELD_MEETING_PARTITIONS: HeldMeetingPartition[] = buildHeldMeetingPartitions(MEETING_PARTITION_CONTRACTS);

export const RETIRED_MEETING_PARTITIONS_WITHOUT_HOLD: readonly { readonly id: string; readonly successorId: string }[] =
  RETIRED_MEETING_ROUTES.filter((route) => route.successorAlreadyWired).map((route) => ({
    id: meetingPartitionId(route.meetingSource, route.bodyId),
    successorId: meetingPartitionId(route.replacedBy, route.bodyId),
  }));

export function heldMeetingPartitionFor(successorId: string): HeldMeetingPartition | null {
  return HELD_MEETING_PARTITIONS.find((row) => row.successorId === successorId) ?? null;
}

function buildSittingWindowSources(contracts: readonly MeetingPartitionContract[]): Map<string, readonly string[]> {
  const registered = new Set(contracts.map((partition) => partition.id));
  const sources = new Map<string, readonly string[]>();
  for (const partition of contracts) {
    if (partition.schedule?.kind === "SITTING_WINDOW") sources.set(partition.id, [partition.id]);
  }
  for (const contract of ROUTINE_SOURCE_CONTRACTS) {
    if (contract.schedule?.kind !== "SITTING_WINDOW") continue;
    const follows = contract.schedule.follows;
    if (!follows) throw new Error(`SITTING_WINDOW_WITHOUT_SITTINGS:${contract.id}`);
    if (follows.length === 0) throw new Error(`SITTING_WINDOW_FOLLOWS_NOTHING:${contract.id}`);
    // A followed door that is not in use (not imported yet, or suspended) gives the window nothing to follow.
    const ids = follows.map((row) => meetingPartitionId(row.meetingSource, row.bodyId)).filter((id) => registered.has(id));
    if (ids.length > 0) sources.set(contract.id, ids);
  }
  return sources;
}

const SITTING_WINDOW_SOURCES = buildSittingWindowSources(MEETING_PARTITION_CONTRACTS);

export interface MeetingPartitionRefresh {
  readonly refreshed: boolean;
  readonly partitions: number;
  readonly reason: string | null;
  /** Doors left out, each with why. */
  readonly skipped: readonly string[];
}

const refreshListeners: (() => void)[] = [];

/** Lists built from the meeting partitions (task lists, scope maps) register here and are rebuilt after every refresh. */
export function onMeetingPartitionsRefreshed(listener: () => void): void {
  refreshListeners.push(listener);
}

/** All lists are built first and swapped in only if every check passes; otherwise the last good lists stay. */
export function refreshMeetingPartitions(wirings: readonly BodySourceWiring[] = activeWiring()): MeetingPartitionRefresh {
  const skipped: string[] = [];
  try {
    const contracts = buildMeetingPartitions(wirings, skipped);
    const held = buildHeldMeetingPartitions(contracts);
    const sources = buildSittingWindowSources(contracts);
    MEETING_PARTITION_CONTRACTS.splice(0, MEETING_PARTITION_CONTRACTS.length, ...contracts);
    HELD_MEETING_PARTITIONS.splice(0, HELD_MEETING_PARTITIONS.length, ...held);
    SITTING_WINDOW_SOURCES.clear();
    for (const [id, ids] of sources) SITTING_WINDOW_SOURCES.set(id, ids);
    for (const listener of refreshListeners) listener();
    return { refreshed: true, partitions: contracts.length, reason: null, skipped };
  } catch (error) {
    return {
      refreshed: false,
      partitions: MEETING_PARTITION_CONTRACTS.length,
      reason: `the registry's doors could not be built into meeting work (${error instanceof Error ? error.message : String(error)}), so the previous list stays in use`,
      skipped,
    };
  }
}

export function sittingWindowSourceIds(taskId: string): readonly string[] {
  return SITTING_WINDOW_SOURCES.get(taskId) ?? EXTRA_SITTING_WINDOW_SOURCES.get(taskId) ?? [];
}

const EXTRA_SITTING_WINDOW_SOURCES = new Map<string, readonly string[]>();

export function setExtraSittingWindowSources(sources: ReadonlyMap<string, readonly string[]>): void {
  EXTRA_SITTING_WINDOW_SOURCES.clear();
  for (const [id, ids] of sources) EXTRA_SITTING_WINDOW_SOURCES.set(id, ids);
}

export function meetingPartitionContract(id: string): MeetingPartitionContract | null {
  return MEETING_PARTITION_CONTRACTS.find((partition) => partition.id === id) ?? null;
}

export function requiredMeetingPartitionContract(id: string): MeetingPartitionContract {
  const contract = meetingPartitionContract(id);
  if (!contract) throw new Error(`MEETING_PARTITION_CONTRACT_MISSING:${id}`);
  return contract;
}

export function meetingPartitionsForSource(sourceName: string): readonly MeetingPartitionContract[] {
  return MEETING_PARTITION_CONTRACTS.filter((partition) => partition.meetingSource === sourceName);
}

export function meetingPartitionForRow(sourceName: string, bodyId: string): MeetingPartitionContract {
  return requiredMeetingPartitionContract(meetingPartitionId(sourceName, bodyId));
}

export function observableRoutineContracts(): readonly RoutineSourceContract[] {
  return [
    ...ROUTINE_SOURCE_CONTRACTS,
    ...RUNTIME_ROUTINE_CONTRACTS,
    ...MEETING_PARTITION_CONTRACTS,
  ];
}

export function meetingHistoryScope(partitionScope: string): string {
  return `${partitionScope}${MEETING_HISTORY_SCOPE_SUFFIX}`;
}

export function isMeetingHistoryScope(scope: string): boolean {
  return scope.endsWith(MEETING_HISTORY_SCOPE_SUFFIX);
}

const historyContracts = new WeakMap<MeetingPartitionContract, MeetingPartitionContract>();

export function meetingHistoryContract(partition: MeetingPartitionContract): MeetingPartitionContract {
  const held = historyContracts.get(partition);
  if (held) return held;
  const scope = meetingHistoryScope(partition.scope);
  const contract: MeetingPartitionContract = {
    ...partition,
    id: `${partition.id}${MEETING_HISTORY_SCOPE_SUFFIX}`,
    sourceId: MEETING_HISTORY_SOURCE_ID,
    scope,
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: MEETING_HISTORY_SOURCE_ID },
    acquisitionAdapter: { authorityMode: "DERIVED", command: partition.acquisitionAdapter.command },
    readerProjection: {
      id: `meetings-history:${partition.id}`,
      consumers: ["Ask", "/api/agenda"],
    },
    lkgBehavior: `Only ${partition.id} may move this pointer, and only by adding sittings that left its live partition. History is never removed or replaced by an older version.`,
    derivedFamily: null,
    historyOf: partition.id,
  };
  historyContracts.set(partition, contract);
  return contract;
}

export function meetingPartitionForHistoryScope(scope: string): MeetingPartitionContract | null {
  if (!isMeetingHistoryScope(scope)) return null;
  const partitionScope = scope.slice(0, -MEETING_HISTORY_SCOPE_SUFFIX.length);
  return MEETING_PARTITION_CONTRACTS.find((partition) => partition.scope === partitionScope) ?? null;
}

export function meetingHistoryRequestedUrl(partition: MeetingPartitionContract): string {
  return derivedRequestedUrl(MEETING_HISTORY_SOURCE_ID, meetingHistoryScope(partition.scope));
}
