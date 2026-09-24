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

/**
 * **The prepared reader snapshot (PDC-8b, 2026-09-15).**
 *
 * PDC moved the meetings composition ONTO the visitor's request: `/api/meetings`
 * hauled and composed 124 partitions per visit (~1.4-2.3 s, measured). This
 * module moves that work to promote time. The standing runner composes the
 * partitions once when they change and publishes one durable serving row in
 * `civic_data_reader_projections`; the reader reads that single row (~0.3 s).
 *
 * The partitions stay the sole authoritative civic truth (RULING 282). The
 * prepared row is a SERVING COPY coupled to them by the exact versionIds it was
 * composed from — RULING 283's "final projection coupled to the final promoted
 * set … when a measured dependency proves the coupling." The scope lives in the
 * reader-projections table, never as an aggregate `MEETING` promotion pointer:
 * that door stays removed (lib/civic-data/meeting-partitions.ts).
 */
export const MEETINGS_PREPARED_SCOPE = "composed-reader-snapshot";

function couplingFingerprint(coupling: readonly PreparedProjectionCoupling[]): string {
  return [...coupling]
    .map((entry) => `${entry.contractId}=${entry.versionId}`)
    .sort()
    .join("|");
}

/** The outcome of one prepare pass — surfaced to admin so failure and lag are never silent. */
export type PrepareMeetingSnapshotResult =
  | { readonly status: "CURRENT"; readonly sequence: number; readonly coupledPartitions: number; readonly generatedAt: string | null }
  | { readonly status: "PUBLISHED"; readonly sequence: number; readonly coupledPartitions: number; readonly generatedAt: string }
  | { readonly status: "RACED"; readonly sequence: number; readonly coupledPartitions: number }
  | { readonly status: "FAILED"; readonly error: string; readonly lastValidGeneratedAt: string | null }
  | { readonly status: "NOT_COMPOSABLE"; readonly detail: string; readonly lastValidGeneratedAt: string | null };

/**
 * Compose the promoted meeting partitions ONCE and publish them as the durable
 * prepared reader snapshot — but only when the promoted partition set changed.
 * Idempotent, monotonic and last-valid-safe:
 *
 *  - It first reads only the cheap promotion POINTERS (versionIds) and compares
 *    their fingerprint to what the current prepared snapshot was composed from.
 *    Unchanged → CURRENT, without the expensive 124-partition haul. So a normal
 *    runner tick over unchanged data costs one small read and never a recompose,
 *    and the reader never pays the compose either.
 *  - Changed → it runs the exact reader composition once and publishes with a
 *    monotonic CAS, so two overlapping runner passes cannot put an older
 *    composition over a newer one (the loser sees RACED and re-reads next tick).
 *  - A composition failure returns FAILED and writes nothing, so the last valid
 *    prepared snapshot keeps serving; the caller records the failure and the
 *    publication lag in admin so staleness is never silent.
 */
export async function preparePublishedMeetingSnapshot(
  store: RoutineDataStore,
  now: string = new Date().toISOString(),
): Promise<PrepareMeetingSnapshotResult> {
  const scopes = MEETING_PARTITION_CONTRACTS.map((partition) => partition.scope);
  const versionByScope = new Map<string, string>();
  try {
    // Every pass asks only which versions are current: identity, not the
    // partitions' payloads (7.8 MB per pass on 2026-09-23).
    for (const promotion of await store.readPromotionIdentities(MEETINGS_RECORD_CLASS, scopes)) {
      versionByScope.set(promotion.scope, promotion.versionId);
    }
    // A retired route's held pointer is asked for only while its successor
    // has none (HELD_MEETING_PARTITIONS); once superseded it costs nothing.
    // Identity only, like the pass above.
    const awaiting = HELD_MEETING_PARTITIONS.filter((held) => !versionByScope.has(held.successorScope));
    if (awaiting.length > 0) {
      for (const promotion of await store.readPromotionIdentities(MEETINGS_RECORD_CLASS, awaiting.map((held) => held.scope))) {
        versionByScope.set(promotion.scope, promotion.versionId);
      }
    }
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error), lastValidGeneratedAt: null };
  }
  // A successor with no pointer of its own is composed from its retired
  // predecessor's held version, so the coupling names that version: the
  // successor's first promotion then changes the fingerprint and recomposes.
  const currentCoupling: PreparedProjectionCoupling[] = MEETING_PARTITION_CONTRACTS.flatMap((partition) => {
    const versionId = versionByScope.get(partition.scope);
    if (typeof versionId === "string") return [{ contractId: partition.id, versionId }];
    const held = heldMeetingPartitionFor(partition.id);
    const heldVersionId = held ? versionByScope.get(held.scope) : undefined;
    return held && typeof heldVersionId === "string" ? [{ contractId: held.id, versionId: heldVersionId }] : [];
  });
  const currentFingerprint = couplingFingerprint(currentCoupling);

  // The serving copy's coupling, sequence and generation time: never its
  // composed payload (7.5 MB), which this decision does not read.
  const prepared = await store.readPreparedReaderProjectionCoupling(MEETINGS_RECORD_CLASS, MEETINGS_PREPARED_SCOPE);
  if (prepared && couplingFingerprint(prepared.composedFrom) === currentFingerprint) {
    return { status: "CURRENT", sequence: prepared.sequence, coupledPartitions: currentCoupling.length, generatedAt: prepared.generatedAt };
  }

  let aggregate: MeetingsProjectionReadResult;
  try {
    aggregate = await readMeetingsProjection({ store, now, bypassCache: true, allowUnconfiguredBootstrap: false });
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

  const composedFrom: PreparedProjectionCoupling[] = aggregate.partitions.flatMap((partition) =>
    partition.kind === "PROMOTED" && typeof partition.versionId === "string"
      ? [{ contractId: partition.contractId, versionId: partition.versionId }]
      : partition.heldFrom
        ? [{ contractId: partition.heldFrom.contractId, versionId: partition.heldFrom.versionId }]
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
    ? { status: "PUBLISHED", sequence: result.sequence, coupledPartitions: composedFrom.length, generatedAt: aggregate.value.generatedAt }
    : { status: "RACED", sequence: result.sequence, coupledPartitions: composedFrom.length };
}

/**
 * Reconstruct the per-partition readback array from the stored coupling, so the
 * prepared fast-path returns the exact `partitions` shape the composing reader
 * does (the closure proof and the freshness meta both read it).
 */
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

/**
 * The reader's fast path: read the single prepared reader snapshot and serve it
 * — one query, no 124-partition haul or re-compose. It NEVER recomposes on
 * routine staleness; the last valid prepared snapshot keeps serving (with its
 * own honest `generatedAt`) until the runner publishes a replacement. The only
 * fallback to the composing reader is when NO prepared snapshot exists yet
 * (initial rollout, bootstrapped before activation) or the store is unreachable
 * — a safety backstop, not the routine path.
 */
export async function readPreparedMeetingsProjection(
  options: { readonly store?: RoutineDataStore; readonly now?: string } = {},
): Promise<MeetingsProjectionReadResult> {
  let prepared: PreparedReaderProjectionRow | null;
  try {
    // Construct the store INSIDE the try: PostgresRoutineDataStore binds getDb()
    // in a field initializer, which throws when DATABASE_URL is unset. That must
    // fall through to the composing reader — which first-seeds under a test
    // fixture and returns STORE_UNREACHABLE in a misconfigured prod — never
    // escape as an unhandled throw the route turns into a 503.
    const store = options.store ?? new PostgresRoutineDataStore();
    prepared = await store.readPreparedReaderProjection(MEETINGS_RECORD_CLASS, MEETINGS_PREPARED_SCOPE);
  } catch {
    prepared = null;
  }
  if (prepared === null) {
    return readMeetingsProjection(options);
  }
  const partitions = partitionsFromCoupling(prepared.composedFrom);
  // Every registered partition composed from its OWN pointer; a held version
  // in the coupling is a retired route's, not a registered partition's.
  const ownComposed = new Set(prepared.composedFrom.map((entry) => entry.contractId));
  const allComposed = MEETING_PARTITION_CONTRACTS.every((partition) => ownComposed.has(partition.id));
  return {
    kind: "PROMOTED",
    value: prepared.payload as MeetingsSnapshot,
    metadata: {
      recordClass: MEETINGS_RECORD_CLASS,
      scope: MEETINGS_SCOPE,
      sourceId: MEETINGS_SOURCE_ID,
      version: null,
      versionId: null,
      lastKnownGoodVersionId: null,
      sourceThrough: prepared.sourceThrough,
      retrievedAt: prepared.retrievedAt,
      promotedAt: prepared.promotedThrough,
      stale: allComposed ? "CURRENT" : "UNKNOWN",
      staleAt: null,
    },
    partitions,
    detail: `Served from the prepared reader snapshot (sequence ${prepared.sequence}, composed from ${prepared.composedFrom.length}/${MEETING_PARTITION_CONTRACTS.length} partitions).`,
  };
}
