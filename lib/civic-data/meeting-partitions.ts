import {
  RETIRED_MEETING_ROUTES,
  SOURCE_WIRING,
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

/** The source authority a partition's durable history promotes under (`source-authority.ts`). */
export const MEETING_HISTORY_SOURCE_ID = "meetings-history" as const;

export interface MeetingPartitionContract extends RoutineSourceContract {
  readonly meetingSource: string;
  /** Shared network/upstream boundary used to keep one outage to one lane. */
  readonly acquisitionFailureDomain: string;
  readonly bodyId: string;
  readonly ocdId: string | null;
  /** The SOURCE_WIRING row this partition reads; null for a derived family, whose members are read at runtime. */
  readonly wiring: BodySourceWiring | null;
  /**
   * The covered state of a derived meeting family (C16): its members are the promoted meeting-source wiring's
   * ACTIVE rows for that state. Null for a SOURCE_WIRING partition.
   */
  readonly derivedFamily: DerivedMeetingFamilyState | null;
  /**
   * Set only on a history contract (DB-06): the id of the live partition whose concluded sittings it keeps. A history
   * contract is built from its partition (`meetingHistoryContract`), is never in `MEETING_PARTITION_CONTRACTS`, has no
   * clock or task of its own, and is written only by its partition's own child.
   */
  readonly historyOf?: string;
}

/** A derived family's meetings carry their members' own sources; the family itself is named by this one. */
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

/**
 * Identify the actual upstream host a partition contacts. Adapter names are
 * too broad (`ical` spans unrelated publishers), while body ids are too narrow
 * (many bodies intentionally share one feed). A host outage therefore gets
 * one bounded lane without serializing unrelated publishers on other hosts.
 * Every supported adapter is explicit so a new route cannot silently fall
 * back to the old all-meetings failure domain.
 */
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
      case "civicplus": return wiring.config.icalUrl;
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
  /*
   * Google Calendar serves every public calendar from one hostname, but each
   * calendar is its own publisher's feed: Bradford's and Warner's town
   * calendars share nothing but Google. So the calendar, not the hostname, is
   * the lane. Measured 2026-09-24: the two towns' 32 partitions put 19.2 reads
   * an hour of sitting-window demand on one 12-per-hour lane (one child per
   * lane per 5-minute pass), so neither town's in-window bodies could be read
   * hourly. Every small-town host keeps its single lane.
   */
  const host = url.hostname.toLowerCase();
  const googleCalendar = host === "calendar.google.com" ? /^\/calendar\/ical\/([^/]+)\//.exec(url.pathname)?.[1] : undefined;
  if (googleCalendar) return `meeting-upstream:${host}/${decodeURIComponent(googleCalendar).toLowerCase()}`;
  return `meeting-upstream:${host}`;
}

function buildMeetingPartitions(wirings: readonly BodySourceWiring[]): MeetingPartitionContract[] {
  const { readerConsumers, ...policy } = MEETING_PARTITION_POLICY;
  const partitions: MeetingPartitionContract[] = wirings.flatMap((wiring) =>
    meetingSourceNamesForWiring(wiring).map((meetingSource) => ({
      ...policy,
      id: meetingPartitionId(meetingSource, wiring.bodyId),
      scope: meetingPartitionScope(meetingSource, wiring.bodyId),
      acquisitionAdapter: {
        authorityMode: "REGISTERED_SOURCE_ROUTES" as const,
        command: ["scripts/ingest.ts", "composite", "--promote", `--only-partition=${meetingPartitionId(meetingSource, wiring.bodyId)}`],
      },
      readerProjection: {
        id: `meetings-partition:${meetingSource}:${wiring.bodyId}`,
        consumers: readerConsumers,
      },
      lkgBehavior:
        `Only ${meetingSource}/${wiring.bodyId} may move this pointer. A refusal leaves this partition's prior GOOD version live without delaying any other source/body.`,
      bootstrapFixturePaths: [],
      meetingSource,
      acquisitionFailureDomain: meetingAcquisitionFailureDomain(meetingSource, wiring),
      bodyId: wiring.bodyId,
      ocdId: wiring.ocdId,
      wiring,
      derivedFamily: null,
    })),
  );
  /*
   * **ONE DERIVED FAMILY PER REGISTERED STATE** (C16; every state since 2026-09-25). Its membership is data: the
   * promoted meeting-source wiring's ACTIVE rows, read by its own child at runtime, so a reviewed calendar publishes
   * with no code release, in a state no one has worked before as in Arizona.
   */
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
  const ids = new Set<string>();
  const scopes = new Set<string>();
  for (const partition of partitions) {
    if (ids.has(partition.id) || scopes.has(partition.scope)) {
      throw new Error(`MEETING_PARTITION_COLLISION:${partition.id}:${partition.scope}`);
    }
    ids.add(partition.id);
    scopes.add(partition.scope);
  }
  return partitions;
}

/**
 * One permanent contract and canonical pointer per registered route/body.
 *
 * Built from the code's list at load. With the door registry switched on
 * (lib/doors/install.ts) the runner calls `refreshMeetingPartitions()` at the
 * start of each pass, which replaces the contents of this array and the lists
 * built from it IN PLACE, so every importer sees the registry's doors on that
 * pass and no deploy is needed (DB-13).
 */
export const MEETING_PARTITION_CONTRACTS: MeetingPartitionContract[] = buildMeetingPartitions(SOURCE_WIRING);

/**
 * **A RETIRED ROUTE'S LAST PROMOTED VERSION, HELD UNTIL ITS SUCCESSOR PROMOTES.**
 * (2026-09-23, the Pima school-agenda routes session. RULING 283, RULING 254.)
 *
 * A cutover for permission (`RETIRED_MEETING_ROUTES`) moves a body from one
 * route to another, and the partition identity moves with it:
 * `meetings:<source>:<body>` names the route. The retired partition has no
 * contract, no clock and no writer from the moment the change lands — never two
 * authoritative writers. But its successor has no pointer until the standing
 * runner's first promotion of it, and a body whose sittings vanish in between
 * is the other unlawful state: none.
 *
 * So the retired partition's last promoted version is HELD — read-only, proved
 * like any pointer, composed in the successor's place — for exactly as long as
 * the successor has no pointer, and marked on the successor's readback
 * (`heldFrom`) so nothing downstream mistakes it for the successor's own
 * version. The successor's first promotion supersedes it; nothing writes,
 * moves or deletes the held pointer, which stays in the store as the record of
 * what the retired route acquired. Readers ask for the held pointer only
 * while its successor has none, so a superseded route costs no further reads.
 *
 * Every retired pair must name a REGISTERED successor for the same body and
 * must itself be unregistered; a registry that breaks either is refused here,
 * at load, rather than composed wrongly.
 */
export interface HeldMeetingPartition {
  /** The retired partition identity, `meetings:<retired source>:<body>`. */
  readonly id: string;
  readonly scope: string;
  readonly meetingSource: string;
  readonly bodyId: string;
  /** The registered partition that now carries the body. */
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
    if (!successor || successor.bodyId !== route.bodyId) {
      throw new Error(`MEETING_PARTITION_SUCCESSOR_NOT_REGISTERED:${id}->${successorId}`);
    }
    // A successor that was already a wired route for the body has its own
    // pointer from before the retirement: there is no gap to hold across.
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

/**
 * Retired partitions that hold nothing: the successor was already a wired,
 * promoting route for the body when the retired one stopped
 * (`successorAlreadyWired`), so the successor's own pointer is the body's
 * authority and the retired pointer is simply no longer composed. Validated
 * with the held rows above (retired unregistered, successor registered).
 */
export const RETIRED_MEETING_PARTITIONS_WITHOUT_HOLD: readonly { readonly id: string; readonly successorId: string }[] =
  RETIRED_MEETING_ROUTES.filter((route) => route.successorAlreadyWired).map((route) => ({
    id: meetingPartitionId(route.meetingSource, route.bodyId),
    successorId: meetingPartitionId(route.replacedBy, route.bodyId),
  }));

/** The retired partition a registered successor holds until its first promotion, if any. */
export function heldMeetingPartitionFor(successorId: string): HeldMeetingPartition | null {
  return HELD_MEETING_PARTITIONS.find((row) => row.successorId === successorId) ?? null;
}

/**
 * The meeting partitions whose sittings drive a sitting-window task: its own
 * id for a partition, the named partitions for a routine that `follows` them,
 * none for any other task. Refused at load, rather than silently cooled to the
 * base cadence, when a followed partition is not registered.
 */
function buildSittingWindowSources(contracts: readonly MeetingPartitionContract[]): Map<string, readonly string[]> {
  const registered = new Set(contracts.map((partition) => partition.id));
  const sources = new Map<string, readonly string[]>();
  for (const partition of contracts) {
    if (partition.schedule?.kind === "SITTING_WINDOW") sources.set(partition.id, [partition.id]);
  }
  for (const contract of ROUTINE_SOURCE_CONTRACTS) {
    if (contract.schedule?.kind !== "SITTING_WINDOW") continue;
    const follows = contract.schedule.follows;
    // Only a meeting partition carries sittings of its own.
    if (!follows) throw new Error(`SITTING_WINDOW_WITHOUT_SITTINGS:${contract.id}`);
    if (follows.length === 0) throw new Error(`SITTING_WINDOW_FOLLOWS_NOTHING:${contract.id}`);
    const ids = follows.map((row) => meetingPartitionId(row.meetingSource, row.bodyId));
    for (const id of ids) {
      if (!registered.has(id)) throw new Error(`SITTING_WINDOW_PARTITION_NOT_REGISTERED:${contract.id}->${id}`);
    }
    sources.set(contract.id, ids);
  }
  return sources;
}

const SITTING_WINDOW_SOURCES = buildSittingWindowSources(MEETING_PARTITION_CONTRACTS);

export interface MeetingPartitionRefresh {
  /** True when the lists now follow `wirings`; false when they were left as they were. */
  readonly refreshed: boolean;
  readonly partitions: number;
  /** Why the lists were left as they were, in a sentence; null when refreshed. */
  readonly reason: string | null;
}

/**
 * DB-13: rebuild the partition lists from the doors in use now (the registry's
 * rows when installed, else the code's). All three lists are built first and
 * swapped in only if every check passes, so a door that collides with another,
 * names a retired route's successor wrongly, or breaks a sitting window leaves
 * the last good lists in place (last-known-good isolation is unchanged).
 */
export function refreshMeetingPartitions(wirings: readonly BodySourceWiring[] = activeWiring()): MeetingPartitionRefresh {
  try {
    const contracts = buildMeetingPartitions(wirings);
    const held = buildHeldMeetingPartitions(contracts);
    const sources = buildSittingWindowSources(contracts);
    MEETING_PARTITION_CONTRACTS.splice(0, MEETING_PARTITION_CONTRACTS.length, ...contracts);
    HELD_MEETING_PARTITIONS.splice(0, HELD_MEETING_PARTITIONS.length, ...held);
    SITTING_WINDOW_SOURCES.clear();
    for (const [id, ids] of sources) SITTING_WINDOW_SOURCES.set(id, ids);
    return { refreshed: true, partitions: contracts.length, reason: null };
  } catch (error) {
    return {
      refreshed: false,
      partitions: MEETING_PARTITION_CONTRACTS.length,
      reason: `the registry's doors could not be built into meeting work (${error instanceof Error ? error.message : String(error)}), so the previous list stays in use`,
    };
  }
}

/** The partition ids whose sittings decide whether a task is hot; empty when the task has no sitting window. */
export function sittingWindowSourceIds(taskId: string): readonly string[] {
  return SITTING_WINDOW_SOURCES.get(taskId) ?? EXTRA_SITTING_WINDOW_SOURCES.get(taskId) ?? [];
}

/**
 * Sitting windows of tasks built at runtime from the door registry (DB-22's per-door outcomes): the task id mapped to
 * the meeting partitions whose sittings decide whether it is hot. Replaced whole on each registry read.
 */
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

/**
 * Admin and the standing runner observe actual partition authorities. There
 * is no aggregate meetings contract, pointer, task, or promotion door.
 */
export function observableRoutineContracts(): readonly RoutineSourceContract[] {
  return [
    ...ROUTINE_SOURCE_CONTRACTS,
    ...RUNTIME_ROUTINE_CONTRACTS,
    ...MEETING_PARTITION_CONTRACTS,
  ];
}

/** A partition's durable history scope: its own scope plus `:history`, under the same record class. */
export function meetingHistoryScope(partitionScope: string): string {
  return `${partitionScope}${MEETING_HISTORY_SCOPE_SUFFIX}`;
}

export function isMeetingHistoryScope(scope: string): boolean {
  return scope.endsWith(MEETING_HISTORY_SCOPE_SUFFIX);
}

const historyContracts = new WeakMap<MeetingPartitionContract, MeetingPartitionContract>();

/**
 * The contract a partition's durable history promotes under (DB-06). Derived from its partition, so it can never name
 * a partition that is not registered, and kept out of `MEETING_PARTITION_CONTRACTS` so no clock, task or reader
 * composition treats it as a partition of its own.
 */
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

/** The live partition a history scope belongs to, or null when the scope is no registered partition's history. */
export function meetingPartitionForHistoryScope(scope: string): MeetingPartitionContract | null {
  if (!isMeetingHistoryScope(scope)) return null;
  const partitionScope = scope.slice(0, -MEETING_HISTORY_SCOPE_SUFFIX.length);
  return MEETING_PARTITION_CONTRACTS.find((partition) => partition.scope === partitionScope) ?? null;
}

/** The request a history candidate names in place of a URL. */
export function meetingHistoryRequestedUrl(partition: MeetingPartitionContract): string {
  return derivedRequestedUrl(MEETING_HISTORY_SOURCE_ID, meetingHistoryScope(partition.scope));
}
