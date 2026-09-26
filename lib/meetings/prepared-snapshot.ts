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
import { activeReaderProofMeetingPin, readerProofPinnedCheckedAt, type ReaderProofMeetingPin } from "./proof-pin.ts";
import {
  applyMeetingFreshChecks,
  confirmationCheckedAt,
  laterCheck,
  meetingCompositionId,
  meetingFreshChecks,
  type FreshCheckCoupling,
} from "./fresh-checks.ts";
import type { PromotedPointerIdentity } from "../civic-data/types.ts";

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

/** Each coupled version's scope: a registered partition's own, or a retired route's held one. */
const SCOPE_BY_CONTRACT: ReadonlyMap<string, string> = new Map([
  ...MEETING_PARTITION_CONTRACTS.map((partition) => [partition.id, partition.scope] as const),
  ...HELD_MEETING_PARTITIONS.map((held) => [held.id, held.scope] as const),
]);

/**
 * The coupled versions with each one's newest successful fresh check brought up
 * to date from the pointer identities (their newest confirmation detail, one
 * narrow read): only a version that reads a source (`routes`), and only a
 * confirmation of the version the entry names (lib/meetings/fresh-checks.ts).
 */
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

/**
 * What the serving copy's readers are told about its checks this pass:
 * `servedGeneratedAt` is "Last checked" (the composition's own generation or a
 * later successful fresh check of any coupled version), `freshChecks` the newest
 * check of each route, and `composition` the version set the rows came from.
 * The edge republishes its manifest when these move, and nothing else.
 */
export interface PreparedMeetingChecks {
  readonly servedGeneratedAt: string | null;
  /** The newest successful fresh check of any coupled version that found nothing new; null when none. */
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

/** The outcome of one prepare pass — surfaced to admin so failure and lag are never silent. */
export type PrepareMeetingSnapshotResult =
  | ({ readonly status: "CURRENT"; readonly sequence: number; readonly coupledPartitions: number; readonly generatedAt: string | null } & PreparedMeetingChecks)
  | ({ readonly status: "PUBLISHED"; readonly sequence: number; readonly coupledPartitions: number; readonly generatedAt: string } & PreparedMeetingChecks)
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
  options: {
    /**
     * The pass's one aggregate composition, when the caller already runs the
     * same `readMeetingsProjection({ store, now, bypassCache: true,
     * allowUnconfiguredBootstrap: false })`. Called only when the coupling
     * changed; a caller that composes once serves both this and its Reader
     * readback from one read of every partition.
     */
    readonly aggregate?: () => Promise<MeetingsProjectionReadResult>;
  } = {},
): Promise<PrepareMeetingSnapshotResult> {
  const scopes = MEETING_PARTITION_CONTRACTS.map((partition) => partition.scope);
  const versionByScope = new Map<string, string>();
  const identityByScope = new Map<string, PromotedPointerIdentity>();
  try {
    // Every pass asks only which versions are current: identity, not the
    // partitions' payloads (7.8 MB per pass on 2026-09-23). Each identity
    // carries its version's newest confirmation detail, the pass's checks.
    for (const promotion of await store.readPromotionIdentities(MEETINGS_RECORD_CLASS, scopes)) {
      versionByScope.set(promotion.scope, promotion.versionId);
      identityByScope.set(promotion.scope, promotion);
    }
    // A retired route's held pointer is asked for only while its successor
    // has none (HELD_MEETING_PARTITIONS); once superseded it costs nothing.
    // Identity only, like the pass above.
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
    // The same versions: nothing is recomposed or rewritten. A quiet re-check
    // (a confirmation) moves only what readers are told about checks, which the
    // edge carries in its manifest (lib/meetings/fresh-checks.ts).
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
      : await readMeetingsProjection({ store, now, bypassCache: true, allowUnconfiguredBootstrap: false });
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

  // Each coupled version records the routes of its fresh rows and its newest
  // check, so a later quiet re-check is applied by route without a recompose.
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
 * The prepared row each store last served, by the store it was read from (the
 * process's own production store is `DEFAULT_PREPARED_STORE`). Every write of
 * the row advances its `sequence` (`writePreparedReaderProjection` is a
 * monotonic compare-and-set), so a row read at a sequence is that sequence's
 * row for good. A process that already holds the current sequence asks only
 * for the coupling (sequence, generation time and versions, never the 7.5 MB
 * composed payload) before serving it again. Without it, every request that
 * reached this fallback read the whole row: each pinned reader-proof request
 * does (the edge path is bypassed while a proof pin is active).
 */
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

/** Forget every held prepared row (tests; a store swap). */
export function clearPreparedMeetingsProjectionCache(): void {
  preparedRows = new WeakMap();
  servedChecks = new WeakMap();
}

/**
 * How long a serving process reuses the checks it last read for a prepared row.
 * The edge manifest the reader normally reads is held at the CDN for the same
 * minute; within it the stated "Last checked" can only lag a newer check, never
 * claim one that did not happen.
 */
export const PREPARED_CHECKS_TTL_MS = 60_000;
let servedChecks = new WeakMap<object, { readonly sequence: number; readonly readAtMs: number; readonly couplings: readonly FreshCheckCoupling[] }>();

/**
 * The prepared row's coupled versions with their newest checks: its recorded
 * ones, brought up to date from the pointer identities (one narrow read, reused
 * for a minute). A failed read keeps the recorded checks: the served time is
 * then older than the newest check, never newer.
 */
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

/** The serving copy's coupled versions with the Reader proof pin's checks in place of any recorded or live one. */
function pinnedPreparedChecks(couplings: readonly FreshCheckCoupling[], pin: ReaderProofMeetingPin): readonly FreshCheckCoupling[] {
  return couplings.map((coupling) => coupling.routes === undefined
    ? coupling
    : { ...coupling, checkedAt: readerProofPinnedCheckedAt(pin, coupling.contractId, coupling.versionId) });
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
  let store: RoutineDataStore | null = null;
  try {
    // Construct the store INSIDE the try: PostgresRoutineDataStore binds getDb()
    // in a field initializer, which throws when DATABASE_URL is unset. That must
    // fall through to the composing reader — which first-seeds under a test
    // fixture and returns STORE_UNREACHABLE in a misconfigured prod — never
    // escape as an unhandled throw the route turns into a 503.
    store = options.store ?? new PostgresRoutineDataStore();
    prepared = await readPreparedRowOnceUnchanged(store, options.store ?? DEFAULT_PREPARED_STORE);
  } catch {
    prepared = null;
  }
  if (prepared === null || store === null) {
    return readMeetingsProjection(options);
  }
  // Proof-only (lib/meetings/proof-pin.ts; null in every deployed build): the
  // serving copy is served only when it was composed from exactly the pinned
  // versions. Otherwise the composing reader serves the pinned versions.
  const pin = activeReaderProofMeetingPin();
  if (
    pin !== null &&
    couplingFingerprint(prepared.composedFrom) !== couplingFingerprint(
      pin.partitions.flatMap(({ contractId, kind, versionId }) =>
        kind === "PROMOTED" && versionId !== null ? [{ contractId, versionId }] : []
      ),
    )
  ) {
    return readMeetingsProjection(options);
  }
  const partitions = partitionsFromCoupling(prepared.composedFrom);
  // Every registered partition composed from its OWN pointer; a held version
  // in the coupling is a retired route's, not a registered partition's.
  const ownComposed = new Set(prepared.composedFrom.map((entry) => entry.contractId));
  const allComposed = MEETING_PARTITION_CONTRACTS.every((partition) => ownComposed.has(partition.id));
  // A quiet re-check since the composition confirmed a version without
  // rewriting this row: "Last checked" and the re-read rows say so
  // (lib/meetings/fresh-checks.ts). No check: the payload is served verbatim.
  // Under a Reader proof pin the checks are the capture's, exactly as the
  // composing reader applies them, and nothing is read live.
  const nowMs = options.now !== undefined && Number.isFinite(Date.parse(options.now)) ? Date.parse(options.now) : Date.now();
  const checks = meetingFreshChecks(pin === null
    ? await servedPreparedChecks(store, options.store ?? DEFAULT_PREPARED_STORE, prepared, nowMs)
    : pinnedPreparedChecks(prepared.composedFrom as readonly FreshCheckCoupling[], pin));
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
