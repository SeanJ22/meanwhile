/**
 * Read adapter for the canonical permanent routine civic-data tables.
 *
 * Both Admin and the standing control-plane runner use this exact adapter and
 * the same pure projection. It creates no second ledger, performs no write,
 * and never turns a failed read into an empty production-data observation.
 */
import { refreshDoorsForPass } from "../doors/install.ts";
import type { DoorRepository } from "../doors/registry.ts";
import { Pool } from "@neondatabase/serverless";
import { and, eq, gte, inArray, lte, notExists, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { alias } from "drizzle-orm/pg-core";

import * as schema from "../db/schema.ts";
import {
  civicDataCandidateEvents,
  civicDataCandidates,
  civicDataPromotions,
  civicDataReaderProjections,
} from "../db/schema.ts";
import {
  projectRoutineDataObservabilityRead,
  type CurrentReaderBuildIdentity,
  type RoutineObservabilityRead,
  type RoutineObservabilityRows,
} from "./observability.ts";

/** One MVCC snapshot: Admin must never combine pre- and post-promotion facts. */
export const ROUTINE_OBSERVABILITY_SNAPSHOT_OPTIONS = {
  isolationLevel: "repeatable read",
  accessMode: "read only",
} as const;

/**
 * A read that runs past its caller's statement limit ends with a named error.
 * (2026-09-23.) The unbounded selection below takes minutes of correlated
 * scans and returns 3.8 GB, which no request-scoped caller can wait for. The
 * projection reports the named error as a store that could not be read, never
 * as an empty or zero outcome.
 */
export class RoutineObservabilityReadTimedOut extends Error {
  constructor(limitMs: number, cause: unknown) {
    super(`the routine civic-data read did not finish within its ${limitMs} ms statement limit`, { cause });
    this.name = "RoutineObservabilityReadTimedOut";
  }
}

function isStatementTimeout(error: unknown): boolean {
  for (let current: unknown = error; current !== null && current !== undefined; ) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "57014") return true;
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

async function readRowsFromCanonicalTables(
  connection: string,
  since: string,
  now: string,
  statementTimeoutMs: number | null,
): Promise<RoutineObservabilityRows> {
  // HTTP batches cap responses at 64 MiB. Keep the complete evidence over
  // one connection and one read-only MVCC snapshot, closing it on every exit.
  const pool = new Pool({ connectionString: connection, max: 1, connectionTimeoutMillis: 15000 });
  try { return await drizzle(pool, { schema }).transaction(async (db) => {
  // A caller's statement limit binds every statement in this snapshot.
  if (statementTimeoutMs !== null) await db.execute(sql.raw(`SET LOCAL statement_timeout = ${statementTimeoutMs}`));
  const candidateSelection = {
    id: civicDataCandidates.id,
    sourceId: civicDataCandidates.sourceId,
    recordClass: civicDataCandidates.recordClass,
    scope: civicDataCandidates.scope,
    state: civicDataCandidates.state,
    acquisitionSucceeded: civicDataCandidates.acquisitionSucceeded,
    retrievedAt: civicDataCandidates.retrievedAt,
    sourceThrough: civicDataCandidates.sourceThrough,
    candidate: civicDataCandidates.candidate,
    validationReceipt: civicDataCandidates.validationReceipt,
    promotedVersionId: civicDataCandidates.promotedVersionId,
    lastKnownGoodVersionId: civicDataCandidates.lastKnownGoodVersionId,
    failureCode: civicDataCandidates.failureCode,
    failureDetail: civicDataCandidates.failureDetail,
  };
  const eventSelection = {
    id: civicDataCandidateEvents.id,
    candidateId: civicDataCandidateEvents.candidateId,
    sequence: civicDataCandidateEvents.sequence,
    state: civicDataCandidateEvents.state,
    at: civicDataCandidateEvents.at,
    detail: civicDataCandidateEvents.detail,
  };
  const currentPromotionIds = db.select({ id: civicDataPromotions.currentVersionId }).from(civicDataPromotions);
  const lkgPromotionIds = db.select({ id: civicDataPromotions.lastKnownGoodVersionId }).from(civicDataPromotions);
  const recentEventCandidateIds = db.select({ id: civicDataCandidateEvents.candidateId })
    .from(civicDataCandidateEvents)
    .where(gte(civicDataCandidateEvents.at, since));
  const currentAuthorityCandidate = alias(civicDataCandidates, "current_civic_data_authority_candidate");
  const currentReattestationPredecessorIds = db.select({
    id: sql<string>`${currentAuthorityCandidate.candidate}->'bootstrapImport'->>'predecessorVersionId'`,
  })
    .from(currentAuthorityCandidate)
    .where(inArray(currentAuthorityCandidate.id, currentPromotionIds));

  // Admin needs more than the rolling 30-day window: the exact latest
  // disposition, latest live-source success and latest validation can each be
  // an older, different candidate. Use correlated maxima so every causal tie
  // is returned; a UUID ordering must never silently choose a winner.
  const laterCandidate = alias(civicDataCandidates, "later_civic_data_candidate");
  const laterSourceCandidate = alias(civicDataCandidates, "later_source_civic_data_candidate");
  const laterSuccessfulCandidate = alias(civicDataCandidates, "later_successful_civic_data_candidate");
  const laterValidatedCandidate = alias(civicDataCandidates, "later_validated_civic_data_candidate");
  const candidateAttemptEvent = alias(civicDataCandidateEvents, "candidate_attempt_event");
  const laterCandidateAttemptEvent = alias(civicDataCandidateEvents, "later_candidate_attempt_event");
  const laterSourceAttemptEvent = alias(civicDataCandidateEvents, "later_source_attempt_event");
  const laterSuccessfulAttemptEvent = alias(civicDataCandidateEvents, "later_successful_attempt_event");
  const candidateAttemptAt = db.select({ at: candidateAttemptEvent.at })
    .from(candidateAttemptEvent)
    .where(and(
      eq(candidateAttemptEvent.candidateId, civicDataCandidates.id),
      eq(candidateAttemptEvent.sequence, 1),
    ));
  const latestCandidate = notExists(
    db.select({ id: laterCandidate.id })
      .from(laterCandidate)
      .innerJoin(laterCandidateAttemptEvent, and(
        eq(laterCandidateAttemptEvent.candidateId, laterCandidate.id),
        eq(laterCandidateAttemptEvent.sequence, 1),
      ))
      .where(and(
        eq(laterCandidate.sourceId, civicDataCandidates.sourceId),
        eq(laterCandidate.recordClass, civicDataCandidates.recordClass),
        eq(laterCandidate.scope, civicDataCandidates.scope),
        sql`${laterCandidateAttemptEvent.at} > (${candidateAttemptAt})`,
      )),
  );
  const sourceOrUnknownAuthority = sql`coalesce(${civicDataCandidates.candidate}#>>'{bootstrapImport,kind}', '') not in ('TRUSTED_LKG_IMPORT', 'TRUSTED_LKG_REATTESTATION')`;
  const latestSourceAttempt = and(
    sourceOrUnknownAuthority,
    notExists(
      db.select({ id: laterSourceCandidate.id })
        .from(laterSourceCandidate)
        .innerJoin(laterSourceAttemptEvent, and(
          eq(laterSourceAttemptEvent.candidateId, laterSourceCandidate.id),
          eq(laterSourceAttemptEvent.sequence, 1),
        ))
        .where(and(
          eq(laterSourceCandidate.sourceId, civicDataCandidates.sourceId),
          eq(laterSourceCandidate.recordClass, civicDataCandidates.recordClass),
          eq(laterSourceCandidate.scope, civicDataCandidates.scope),
          sql`coalesce(${laterSourceCandidate.candidate}#>>'{bootstrapImport,kind}', '') not in ('TRUSTED_LKG_IMPORT', 'TRUSTED_LKG_REATTESTATION')`,
          sql`${laterSourceAttemptEvent.at} > (${candidateAttemptAt})`,
        )),
    ),
  )!;
  const sourceSuccess = and(
    eq(civicDataCandidates.acquisitionSucceeded, true),
    // A future claimed acquisition is durable refusal evidence, never a
    // success clock capable of hiding the prior real source acquisition.
    lte(civicDataCandidates.retrievedAt, now),
    sourceOrUnknownAuthority,
  )!;
  const latestSourceSuccess = and(
    sourceSuccess,
    notExists(
      db.select({ id: laterSuccessfulCandidate.id })
        .from(laterSuccessfulCandidate)
        .innerJoin(laterSuccessfulAttemptEvent, and(
          eq(laterSuccessfulAttemptEvent.candidateId, laterSuccessfulCandidate.id),
          eq(laterSuccessfulAttemptEvent.sequence, 1),
        ))
        .where(and(
          eq(laterSuccessfulCandidate.sourceId, civicDataCandidates.sourceId),
          eq(laterSuccessfulCandidate.recordClass, civicDataCandidates.recordClass),
          eq(laterSuccessfulCandidate.scope, civicDataCandidates.scope),
          eq(laterSuccessfulCandidate.acquisitionSucceeded, true),
          lte(laterSuccessfulCandidate.retrievedAt, now),
          sql`coalesce(${laterSuccessfulCandidate.candidate}#>>'{bootstrapImport,kind}', '') not in ('TRUSTED_LKG_IMPORT', 'TRUSTED_LKG_REATTESTATION')`,
          sql`${laterSuccessfulAttemptEvent.at} > (${candidateAttemptAt})`,
        )),
    ),
  )!;
  const hasValidation = sql`${civicDataCandidates.validationReceipt} is not null`;
  // Compare canonical UTC receipt instants lexically so a malformed JSON value
  // cannot throw a timestamptz cast and blank every contract in the shared
  // Admin snapshot. Every non-canonical value is selected unconditionally;
  // the projector then reports UNKNOWN because its causal position cannot be
  // proven. February 29 is deliberately treated as non-canonical here (and
  // therefore retained) so leap-year validation never requires a risky cast.
  const canonicalValidationTimePattern = "^(?:[0-9]{4}-(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12][0-9]|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8])))T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$";
  const currentValidationIsCanonical = sql`coalesce((${civicDataCandidates.validationReceipt}->>'validatedAt') ~ ${canonicalValidationTimePattern}, false)`;
  const laterValidationIsCanonical = sql`coalesce((${laterValidatedCandidate.validationReceipt}->>'validatedAt') ~ ${canonicalValidationTimePattern}, false)`;
  const latestValidation = and(
    hasValidation,
    or(
      sql`not (${currentValidationIsCanonical})`,
      and(
        currentValidationIsCanonical,
        notExists(
          db.select({ id: laterValidatedCandidate.id }).from(laterValidatedCandidate).where(and(
            eq(laterValidatedCandidate.sourceId, civicDataCandidates.sourceId),
            eq(laterValidatedCandidate.recordClass, civicDataCandidates.recordClass),
            eq(laterValidatedCandidate.scope, civicDataCandidates.scope),
            sql`${laterValidatedCandidate.validationReceipt} is not null`,
            laterValidationIsCanonical,
            sql`(${laterValidatedCandidate.validationReceipt}->>'validatedAt') > (${civicDataCandidates.validationReceipt}->>'validatedAt')`,
          )),
        ),
      ),
    ),
  )!;
  const selectedCandidate = or(
    inArray(civicDataCandidates.id, currentPromotionIds),
    inArray(civicDataCandidates.id, lkgPromotionIds),
    // A re-attested pointer is permanently proved against its exact immutable
    // predecessor, even when that source row is older than the history window.
    inArray(civicDataCandidates.id, currentReattestationPredecessorIds),
    inArray(civicDataCandidates.id, recentEventCandidateIds),
    latestCandidate,
    latestSourceAttempt,
    latestSourceSuccess,
    latestValidation,
  )!;
  const selectedCandidateIds = db.select({ id: civicDataCandidates.id })
    .from(civicDataCandidates)
    .where(selectedCandidate);
  const selectedEvent = or(
    gte(civicDataCandidateEvents.at, since),
    inArray(civicDataCandidateEvents.candidateId, selectedCandidateIds),
  )!;
  const promotions = await db.select({
      key: civicDataPromotions.key,
      sourceId: civicDataPromotions.sourceId,
      recordClass: civicDataPromotions.recordClass,
      scope: civicDataPromotions.scope,
      currentVersionId: civicDataPromotions.currentVersionId,
      lastKnownGoodVersionId: civicDataPromotions.lastKnownGoodVersionId,
      promotedAt: civicDataPromotions.promotedAt,
      payload: civicDataPromotions.payload,
      validationReceipt: civicDataPromotions.validationReceipt,
    }).from(civicDataPromotions);
  const candidates = await db.select(candidateSelection).from(civicDataCandidates).where(selectedCandidate);
  const events = await db.select(eventSelection).from(civicDataCandidateEvents).where(selectedEvent);
  // The reader-serving copies (RULING 283), read in the SAME snapshot as the
  // promotions above so publication lag compares two facts from one instant.
  const preparedProjections = await db.select({
      key: civicDataReaderProjections.key,
      recordClass: civicDataReaderProjections.recordClass,
      scope: civicDataReaderProjections.scope,
      sequence: civicDataReaderProjections.sequence,
      composedFrom: civicDataReaderProjections.composedFrom,
      generatedAt: civicDataReaderProjections.generatedAt,
      composedAt: civicDataReaderProjections.composedAt,
      promotedThrough: civicDataReaderProjections.promotedThrough,
    }).from(civicDataReaderProjections);
  return { candidates, events, promotions, preparedProjections };
  }, ROUTINE_OBSERVABILITY_SNAPSHOT_OPTIONS);
  } catch (error) {
    if (statementTimeoutMs !== null && isStatementTimeout(error)) throw new RoutineObservabilityReadTimedOut(statementTimeoutMs, error);
    throw error;
  } finally { await pool.end(); }
}

/**
 * Read the canonical outcome projection through an explicitly selected
 * connection. The standing runner passes the production read-only handle;
 * Admin passes its own runtime connection. No environment fallback exists.
 */
export async function readRoutineDataObservabilityFromConnection(
  connection: string | null | undefined,
  options: {
    readonly now?: string;
    readonly currentReaderBuild?: CurrentReaderBuildIdentity;
    /** A request-scoped caller's server-side limit; absent means none. */
    readonly statementTimeoutMs?: number;
    /** DB-14: the door registry, so a door added as data is listed FRESH, DUE or STALE. */
    readonly doors?: DoorRepository;
  } = {},
): Promise<RoutineObservabilityRead> {
  const now = options.now ?? new Date().toISOString();
  const selected = connection?.trim() ?? "";
  const limit = options.statementTimeoutMs;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new Error(`ROUTINE_OBSERVABILITY_STATEMENT_TIMEOUT_INVALID:${limit}`);
  }
  return projectRoutineDataObservabilityRead({
    now,
    connected: selected !== "",
    currentReaderBuild: options.currentReaderBuild,
    ...(options.doors ? { adoptDoors: () => refreshDoorsForPass(options.doors!) } : {}),
    ...(selected !== "" ? { readRows: (since: string) => readRowsFromCanonicalTables(selected, since, now, limit ?? null) } : {}),
  });
}
