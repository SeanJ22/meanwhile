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
  onMeetingPartitionsRefreshed,
} from "../civic-data/meeting-partitions.ts";
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

export const MEETINGS_PREPARED_SCOPE = "composed-reader-snapshot";

function couplingFingerprint(coupling: readonly PreparedProjectionCoupling[]): string {
  return [...coupling]
    .map((entry) => `${entry.contractId}=${entry.versionId}`)
    .sort()
    .join("|");
}

const scopeByContract = (): ReadonlyMap<string, string> => new Map([
  ...MEETING_PARTITION_CONTRACTS.map((partition) => [partition.id, partition.scope] as const),
  ...HELD_MEETING_PARTITIONS.map((held) => [held.id, held.scope] as const),
]);
let SCOPE_BY_CONTRACT = scopeByContract();
onMeetingPartitionsRefreshed(() => { SCOPE_BY_CONTRACT = scopeByContract(); });

function withCurrentChecks(
  couplings: readonly FreshCheckCoupling[],
  identityByScope: ReadonlyMap<string, Pick<PromotedPointerIdentity, "versionId" | "latestConfirmation">>,
): FreshCheckCoupling[] {
  return couplings.map((coupling) => {
    if (coupling.routes === undefined) return coupling;
    const scope = SCOPE_BY_CONTRACT.get(coupling.contractId);
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
  const scopes = MEETING_PARTITION_CONTRACTS.map((partition) => partition.scope);
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
  let factSha256: string;
  try {
    factSha256 = pdcV2CanonicalMeetingFactEvidence([aggregate.value]).sha256;
  } catch {
    factSha256 = createHash("sha256").update(JSON.stringify(aggregate.value)).digest("hex");
  }
  const input: PreparedReaderProjectionInput = {
    recordClass: MEETINGS_RECORD_CLASS,
    scope: MEETINGS_PREPARED_SCOPE,
    payload: aggregate.value,
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
    return versionId !== undefined
      ? {
          contractId: partition.id,
          source: partition.meetingSource,
          bodyId: partition.bodyId,
          scope: partition.scope,
          kind: "PROMOTED" as const,
          versionId,
          detail: null,
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
          }
        : {
            contractId: partition.id,
            source: partition.meetingSource,
            bodyId: partition.bodyId,
            scope: partition.scope,
            kind: "NOT_RECORDED" as const,
            versionId: null,
            detail: "partition is not part of the prepared reader snapshot",
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

export function clearPreparedMeetingsProjectionCache(): void {
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
      [...new Set(checkable.flatMap((coupling) => SCOPE_BY_CONTRACT.get(coupling.contractId) ?? []))],
    );
    const checked = withCurrentChecks(couplings, new Map(identities.map((identity) => [identity.scope, identity])));
    servedChecks.set(scope, { sequence: prepared.sequence, readAtMs: nowMs, couplings: checked });
    return checked;
  } catch {
    return couplings;
  }
}

export async function readPreparedMeetingsProjection(
  options: { readonly store?: RoutineDataStore; readonly now?: string } = {},
): Promise<MeetingsProjectionReadResult> {
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
