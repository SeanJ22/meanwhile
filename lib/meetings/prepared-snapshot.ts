import { createHash } from "node:crypto";

import {
  PostgresRoutineDataStore,
  pdcV2CanonicalMeetingFactEvidence,
  type PreparedProjectionCoupling,
  type PreparedReaderProjectionInput,
  type PreparedReaderProjectionRow,
  type RoutineDataStore,
} from "../civic-data/store.ts";
import {
  HELD_MEETING_PARTITIONS,
  MEETING_PARTITION_CONTRACTS,
  heldMeetingPartitionFor,
  meetingPartitionId,
  meetingPartitionOfId,
  meetingHistoryContract,
} from "../civic-data/meeting-partitions.ts";
import { RETIRED_MEETING_ROUTES } from "../registry/source-wiring.ts";
import {
  MEETINGS_RECORD_CLASS,
  MEETINGS_SCOPE,
  MEETINGS_SOURCE_ID,
  readMeetingsProjection,
  type MeetingPartitionReadback,
  type MeetingsProjectionReadResult,
  type MeetingsSnapshot,
} from "./snapshot.ts";
import {
  applyMeetingFreshChecks,
  confirmationCheckedAt,
  laterCheck,
  meetingCompositionId,
  meetingFreshChecks,
  type FreshCheckCoupling,
} from "./fresh-checks.ts";
import type { PromotedPointerIdentity } from "../civic-data/types.ts";
import { buildMeetingHistorySnapshot, mergeMeetingHistory } from "../civic-data/meeting-history.ts";
import { meetingCarriesRecords } from "./carries-records.ts";

export const MEETINGS_PREPARED_SCOPE = "composed-reader-snapshot";

function couplingFingerprint(coupling: readonly PreparedProjectionCoupling[]): string {
  return [...coupling]
    .map((entry) => `${entry.contractId}=${entry.versionId}`)
    .sort()
    .join("|");
}

/** A composed partition's scope, read from its id: the composition is checked whatever doors this process holds. */
const scopeOfContract = (contractId: string): string | undefined => meetingPartitionOfId(contractId)?.scope;

function withCurrentChecks(
  couplings: readonly FreshCheckCoupling[],
  identityByScope: ReadonlyMap<string, Pick<PromotedPointerIdentity, "versionId" | "latestConfirmation">>,
): FreshCheckCoupling[] {
  return couplings.map((coupling) => {
    if (coupling.routes === undefined) return coupling;
    const scope = scopeOfContract(coupling.contractId);
    const identity = scope === undefined ? undefined : identityByScope.get(scope);
    const checkedAt = laterCheck(coupling.checkedAt ?? null, confirmationCheckedAt(identity?.latestConfirmation, coupling.versionId, true));
    return checkedAt === (coupling.checkedAt ?? null) ? coupling : { ...coupling, checkedAt };
  });
}

export interface PreparedMeetingChecks {
  readonly servedGeneratedAt: string | null;
  readonly checkedAt: string | null;
  readonly freshChecks: Readonly<Record<string, string>>;
  readonly composition: string;
}

function preparedChecks(generatedAt: string | null, couplings: readonly FreshCheckCoupling[]): PreparedMeetingChecks {
  const checks = meetingFreshChecks(couplings);
  return {
    servedGeneratedAt: laterCheck(generatedAt, checks.checkedAt),
    checkedAt: checks.checkedAt,
    freshChecks: checks.routes,
    composition: meetingCompositionId(couplings),
  };
}

export type PrepareMeetingSnapshotResult =
  | ({ readonly status: "CURRENT"; readonly sequence: number; readonly coupledPartitions: number; readonly generatedAt: string | null } & PreparedMeetingChecks)
  | ({ readonly status: "PUBLISHED"; readonly sequence: number; readonly coupledPartitions: number; readonly generatedAt: string } & PreparedMeetingChecks)
  | { readonly status: "RACED"; readonly sequence: number; readonly coupledPartitions: number }
  | { readonly status: "FAILED"; readonly error: string; readonly lastValidGeneratedAt: string | null }
  | { readonly status: "NOT_COMPOSABLE"; readonly detail: string; readonly lastValidGeneratedAt: string | null };

export async function preparePublishedMeetingSnapshot(
  store: RoutineDataStore,
  now: string = new Date().toISOString(),
  options: {
    readonly aggregate?: () => Promise<MeetingsProjectionReadResult>;
  } = {},
): Promise<PrepareMeetingSnapshotResult> {
  const historyContracts = MEETING_PARTITION_CONTRACTS.map(meetingHistoryContract);
  const scopes = [...MEETING_PARTITION_CONTRACTS.map((partition) => partition.scope), ...historyContracts.map(contract => contract.scope)];
  const versionByScope = new Map<string, string>();
  const identityByScope = new Map<string, PromotedPointerIdentity>();
  try {
    for (const promotion of await store.readPromotionIdentities(MEETINGS_RECORD_CLASS, scopes)) {
      versionByScope.set(promotion.scope, promotion.versionId);
      identityByScope.set(promotion.scope, promotion);
    }
    const awaiting = HELD_MEETING_PARTITIONS.filter((held) => !versionByScope.has(held.successorScope));
    if (awaiting.length > 0) {
      for (const promotion of await store.readPromotionIdentities(MEETINGS_RECORD_CLASS, awaiting.map((held) => held.scope))) {
        versionByScope.set(promotion.scope, promotion.versionId);
        identityByScope.set(promotion.scope, promotion);
      }
    }
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error), lastValidGeneratedAt: null };
  }
  // A successor with no pointer of its own couples to its retired predecessor's held version, so the successor's
  // first promotion changes the fingerprint and recomposes.
  const currentCoupling: PreparedProjectionCoupling[] = MEETING_PARTITION_CONTRACTS.flatMap((partition) => {
    const versionId = versionByScope.get(partition.scope);
    if (typeof versionId === "string") return [{ contractId: partition.id, versionId }];
    const held = heldMeetingPartitionFor(partition.id);
    const heldVersionId = held ? versionByScope.get(held.scope) : undefined;
    return held && typeof heldVersionId === "string" ? [{ contractId: held.id, versionId: heldVersionId }] : [];
  });
  for (const contract of historyContracts) {
    const versionId = versionByScope.get(contract.scope);
    if (versionId) currentCoupling.push({ contractId: contract.id, versionId });
  }
  const currentFingerprint = couplingFingerprint(currentCoupling);

  const prepared = await store.readPreparedReaderProjectionCoupling(MEETINGS_RECORD_CLASS, MEETINGS_PREPARED_SCOPE);
  if (prepared && couplingFingerprint(prepared.composedFrom) === currentFingerprint) {
    return {
      status: "CURRENT",
      sequence: prepared.sequence,
      coupledPartitions: currentCoupling.length,
      generatedAt: prepared.generatedAt,
      ...preparedChecks(prepared.generatedAt, withCurrentChecks(prepared.composedFrom as readonly FreshCheckCoupling[], identityByScope)),
    };
  }

  let aggregate: MeetingsProjectionReadResult;
  try {
    aggregate = options.aggregate
      ? await options.aggregate()
      : await readMeetingsProjection({ store, now, bypassCache: true });
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error), lastValidGeneratedAt: prepared?.generatedAt ?? null };
  }
  if (aggregate.kind !== "PROMOTED") {
    return {
      status: "NOT_COMPOSABLE",
      detail: aggregate.detail,
      lastValidGeneratedAt: prepared?.generatedAt ?? null,
    };
  }

  const freshCheckOf = (partition: (typeof aggregate.partitions)[number]) => partition.freshCheck
    ? { routes: partition.freshCheck.routes, ...(partition.freshCheck.checkedAt ? { checkedAt: partition.freshCheck.checkedAt } : {}) }
    : {};
  const composedFrom: FreshCheckCoupling[] = aggregate.partitions.flatMap((partition) =>
    partition.kind === "PROMOTED" && typeof partition.versionId === "string"
      ? [{ contractId: partition.contractId, versionId: partition.versionId, ...freshCheckOf(partition) }]
      : partition.heldFrom
        ? [{ contractId: partition.heldFrom.contractId, versionId: partition.heldFrom.versionId, ...freshCheckOf(partition) }]
        : [],
  );
  for (const partition of aggregate.partitions) if (partition.history) composedFrom.push(partition.history);
  let value = aggregate.value;
  const missingHistory = aggregate.partitions.filter(partition => partition.historyIssue);
  if (prepared && missingHistory.length > 0) {
    // Retain accepted historical facts during a storage outage, without reviving future meetings.
    const prior = await store.readPreparedReaderProjection(MEETINGS_RECORD_CLASS, MEETINGS_PREPARED_SCOPE);
    if (prior) {
      const previous = prior.payload as MeetingsSnapshot;
      const documented = new Set(previous.agendaDocuments.map(document => document.meetingId));
      const meetings = previous.meetings.filter(meeting => Date.parse(meeting.startsAt) < Date.parse(now) &&
        meetingCarriesRecords(meeting, documented.has(meeting.id)) && missingHistory.some(partition =>
          meeting.bodyId === partition.bodyId || meeting.id.startsWith(`${partition.source}:`)));
      const ids = new Set(meetings.map(meeting => meeting.id));
      value = mergeMeetingHistory(value, buildMeetingHistorySnapshot({ history: null, moved: meetings,
        agendaDocuments: previous.agendaDocuments.filter(document => ids.has(document.meetingId)), generatedAt: previous.generatedAt }));
      for (const partition of missingHistory) {
        const contract = MEETING_PARTITION_CONTRACTS.find(candidate => candidate.id === partition.contractId);
        const held = contract && prior.composedFrom.find(coupling => coupling.contractId === meetingHistoryContract(contract).id);
        if (held) composedFrom.push(held);
      }
    }
  }
  let factSha256: string;
  try {
    factSha256 = pdcV2CanonicalMeetingFactEvidence([value]).sha256;
  } catch {
    factSha256 = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
  const input: PreparedReaderProjectionInput = {
    recordClass: MEETINGS_RECORD_CLASS,
    scope: MEETINGS_PREPARED_SCOPE,
    payload: value,
    composedFrom,
    factSha256,
    generatedAt: aggregate.value.generatedAt,
    composedAt: now,
    sourceThrough: aggregate.metadata.sourceThrough,
    retrievedAt: aggregate.metadata.retrievedAt,
    promotedThrough: aggregate.metadata.promotedAt,
  };
  const result = await store.writePreparedReaderProjection(input, prepared?.sequence ?? null);
  return result.published
    ? {
        status: "PUBLISHED",
        sequence: result.sequence,
        coupledPartitions: composedFrom.length,
        generatedAt: aggregate.value.generatedAt,
        ...preparedChecks(aggregate.value.generatedAt, withCurrentChecks(composedFrom, identityByScope)),
      }
    : { status: "RACED", sequence: result.sequence, coupledPartitions: composedFrom.length };
}

function partitionsFromCoupling(composedFrom: readonly PreparedProjectionCoupling[]): MeetingPartitionReadback[] {
  const versionByContract = new Map(composedFrom.map((entry) => [entry.contractId, entry.versionId]));
  return MEETING_PARTITION_CONTRACTS.map((partition) => {
    const versionId = versionByContract.get(partition.id);
    const held = heldMeetingPartitionFor(partition.id);
    const heldVersionId = versionId === undefined && held ? versionByContract.get(held.id) : undefined;
    const historyContract = meetingHistoryContract(partition);
    const historyVersion = versionByContract.get(historyContract.id);
    const history = historyVersion ? { history: { contractId: historyContract.id, versionId: historyVersion } } : {};
    return versionId !== undefined
      ? {
          contractId: partition.id,
          source: partition.meetingSource,
          bodyId: partition.bodyId,
          scope: partition.scope,
          kind: "PROMOTED" as const,
          versionId,
          detail: null,
          ...history,
        }
      : held && heldVersionId !== undefined
        ? {
            contractId: partition.id,
            source: partition.meetingSource,
            bodyId: partition.bodyId,
            scope: partition.scope,
            kind: "NOT_RECORDED" as const,
            versionId: null,
            detail: `the prepared reader snapshot composed the retired route's held version ${held.id}@${heldVersionId} in this partition's place`,
            heldFrom: { contractId: held.id, scope: held.scope, versionId: heldVersionId },
            ...history,
          }
        : {
            contractId: partition.id,
            source: partition.meetingSource,
            bodyId: partition.bodyId,
            scope: partition.scope,
            kind: "NOT_RECORDED" as const,
            versionId: null,
            detail: "partition is not part of the prepared reader snapshot",
            ...history,
          };
  });
}

const DEFAULT_PREPARED_STORE: object = {};
let preparedRows = new WeakMap<object, PreparedReaderProjectionRow>();

async function readPreparedRowOnceUnchanged(
  store: RoutineDataStore,
  scope: object,
): Promise<PreparedReaderProjectionRow | null> {
  const held = preparedRows.get(scope);
  if (held !== undefined) {
    const coupling = await store.readPreparedReaderProjectionCoupling(MEETINGS_RECORD_CLASS, MEETINGS_PREPARED_SCOPE);
    if (
      coupling !== null &&
      coupling.sequence === held.sequence &&
      coupling.generatedAt === held.generatedAt &&
      couplingFingerprint(coupling.composedFrom) === couplingFingerprint(held.composedFrom)
    ) {
      return held;
    }
  }
  const row = await store.readPreparedReaderProjection(MEETINGS_RECORD_CLASS, MEETINGS_PREPARED_SCOPE);
  if (row === null) preparedRows.delete(scope);
  else preparedRows.set(scope, row);
  return row;
}

/** How long a process keeps the composition's places before it reads them again. */
export const COMPOSED_PLACES_TTL_MS = 60_000;
let composedPlaces: { readonly at: number; readonly places: ReadonlyMap<string, readonly string[]> } | null = null;

/**
 * The places each source serves in the composition the publisher last prepared, read from its own partition ids, in
 * its order: a failed source is attributed to every place it serves whatever doors this process has installed. A
 * route held for a retired one is not a source of the composition, and a body with no division has no place. Null
 * when the composition cannot be read.
 */
export async function readComposedSourcePlaces(options: { readonly store?: RoutineDataStore; readonly clock?: () => number } = {}):
  Promise<ReadonlyMap<string, readonly string[]> | null> {
  const now = (options.clock ?? Date.now)();
  if (options.store === undefined && composedPlaces !== null && now - composedPlaces.at < COMPOSED_PLACES_TTL_MS) return composedPlaces.places;
  let coupling: Awaited<ReturnType<RoutineDataStore["readPreparedReaderProjectionCoupling"]>>;
  try {
    coupling = await (options.store ?? new PostgresRoutineDataStore()).readPreparedReaderProjectionCoupling(MEETINGS_RECORD_CLASS, MEETINGS_PREPARED_SCOPE);
  } catch {
    return null;
  }
  if (coupling === null) return null;
  const held = new Set(RETIRED_MEETING_ROUTES.map((route) => meetingPartitionId(route.meetingSource, route.bodyId)));
  const places = new Map<string, string[]>();
  for (const { contractId } of coupling.composedFrom) {
    const partition = held.has(contractId) ? null : meetingPartitionOfId(contractId);
    if (partition === null) continue;
    const division = partition.bodyId.split("#")[0]!;
    const list = places.get(partition.source) ?? [];
    if (division.startsWith("ocd-division/")) list.push(division);
    places.set(partition.source, list);
  }
  if (options.store === undefined) composedPlaces = { at: now, places };
  return places;
}

export function clearPreparedMeetingsProjectionCache(): void {
  composedPlaces = null;
  preparedRows = new WeakMap();
  servedChecks = new WeakMap();
}

/** Within this window the stated "Last checked" can only lag a newer check, never claim one that did not happen. */
export const PREPARED_CHECKS_TTL_MS = 60_000;
let servedChecks = new WeakMap<object, { readonly sequence: number; readonly readAtMs: number; readonly couplings: readonly FreshCheckCoupling[] }>();

async function servedPreparedChecks(
  store: RoutineDataStore,
  scope: object,
  prepared: PreparedReaderProjectionRow,
  nowMs: number,
): Promise<readonly FreshCheckCoupling[]> {
  const couplings = prepared.composedFrom as readonly FreshCheckCoupling[];
  const checkable = couplings.filter((coupling) => coupling.routes !== undefined);
  if (checkable.length === 0) return couplings;
  const held = servedChecks.get(scope);
  if (held !== undefined && held.sequence === prepared.sequence && nowMs >= held.readAtMs && nowMs < held.readAtMs + PREPARED_CHECKS_TTL_MS) return held.couplings;
  try {
    const identities = await store.readPromotionIdentities(
      MEETINGS_RECORD_CLASS,
      [...new Set(checkable.flatMap((coupling) => scopeOfContract(coupling.contractId) ?? []))],
    );
    const checked = withCurrentChecks(couplings, new Map(identities.map((identity) => [identity.scope, identity])));
    servedChecks.set(scope, { sequence: prepared.sequence, readAtMs: nowMs, couplings: checked });
    return checked;
  } catch {
    return couplings;
  }
}

export async function readPreparedMeetingsProjection(
  options: { readonly store?: RoutineDataStore; readonly now?: string; readonly expectedSequence?: number } = {},
): Promise<MeetingsProjectionReadResult> {
  // The meeting partitions read here are the published doors' partitions, installed in this module graph.
  await (await import("../doors/meeting-doors.ts")).ensureMeetingDoors();
  let prepared: PreparedReaderProjectionRow | null;
  let store: RoutineDataStore | null = null;
  try {
    // Constructed inside the try: the Postgres store throws when DATABASE_URL is unset, which must fall through to
    // the composing reader rather than escape.
    store = options.store ?? new PostgresRoutineDataStore();
    prepared = await readPreparedRowOnceUnchanged(store, options.store ?? DEFAULT_PREPARED_STORE);
  } catch {
    prepared = null;
  }
  if (options.expectedSequence !== undefined && prepared?.sequence !== options.expectedSequence) {
    throw new Error("PREPARED_MEETING_COPY_CHANGED_DURING_READ");
  }
  if (prepared === null || store === null) {
    return readMeetingsProjection(options);
  }
  const partitions = partitionsFromCoupling(prepared.composedFrom);
  const ownComposed = new Set(prepared.composedFrom.map((entry) => entry.contractId));
  const allComposed = MEETING_PARTITION_CONTRACTS.every((partition) => ownComposed.has(partition.id));
  const nowMs = options.now !== undefined && Number.isFinite(Date.parse(options.now)) ? Date.parse(options.now) : Date.now();
  const checks = meetingFreshChecks(await servedPreparedChecks(store, options.store ?? DEFAULT_PREPARED_STORE, prepared, nowMs));
  return {
    kind: "PROMOTED",
    value: applyMeetingFreshChecks(prepared.payload as MeetingsSnapshot, checks),
    metadata: {
      recordClass: MEETINGS_RECORD_CLASS,
      scope: MEETINGS_SCOPE,
      sourceId: MEETINGS_SOURCE_ID,
      version: null,
      versionId: null,
      lastKnownGoodVersionId: null,
      sourceThrough: prepared.sourceThrough,
      retrievedAt: laterCheck(prepared.retrievedAt, checks.checkedAt),
      promotedAt: prepared.promotedThrough,
      stale: allComposed ? "CURRENT" : "UNKNOWN",
      staleAt: null,
    },
    partitions,
    detail: `Served from the prepared reader snapshot (sequence ${prepared.sequence}, composed from ${prepared.composedFrom.length}/${MEETING_PARTITION_CONTRACTS.length} partitions).`,
  };
}
