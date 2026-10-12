/** Never touches the candidate JSON column, not even through a path operator: unpacking it row by row takes minutes. */
import { Pool } from "@neondatabase/serverless";
import { and, inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../db/schema.ts";
import { civicDataCandidateEvents, civicDataPromotions } from "../db/schema.ts";
import { ROUTINE_OBSERVABILITY_SNAPSHOT_OPTIONS } from "./observability-store.ts";
import type { PublicationStatusRows } from "./publication-status.ts";
import { READER_PROJECTION_READBACK_PREFIX } from "./reader-readback.ts";
import { UNCHANGED_CONFIRMATION_PREFIX } from "./unchanged-confirmation.ts";

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function rowsOf(result: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

export async function readPublicationStatusRows(
  connection: string,
  statementTimeoutMs: number,
): Promise<PublicationStatusRows> {
  if (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs <= 0) {
    throw new Error(`PUBLICATION_STATUS_STATEMENT_TIMEOUT_INVALID:${statementTimeoutMs}`);
  }
  const pool = new Pool({ connectionString: connection, max: 1, connectionTimeoutMillis: 15000 });
  try {
    return await drizzle(pool, { schema }).transaction(async (db) => {
      await db.execute(sql.raw(`SET LOCAL statement_timeout = ${statementTimeoutMs}`));
      const promotions = await db.select({
        key: civicDataPromotions.key,
        sourceId: civicDataPromotions.sourceId,
        recordClass: civicDataPromotions.recordClass,
        scope: civicDataPromotions.scope,
        currentVersionId: civicDataPromotions.currentVersionId,
        promotedAt: civicDataPromotions.promotedAt,
      }).from(civicDataPromotions);
      // A confirmation names its actual provider check; replaying held bytes cannot hide a later source failure.
      const latest = rowsOf(await db.execute(sql`
        SELECT DISTINCT ON (c.source_id, c.record_class, c.scope)
               c.id AS candidate_id, c.source_id, c.record_class, c.scope, c.state, c.failure_code,
               CASE WHEN e.state = 'PROMOTED' AND left(e.detail, ${UNCHANGED_CONFIRMATION_PREFIX.length}) = ${UNCHANGED_CONFIRMATION_PREFIX}
                 THEN COALESCE((substring(e.detail from ${UNCHANGED_CONFIRMATION_PREFIX.length + 1})::jsonb #>> '{retrieval,sourceCheck,checkedAt}')::timestamptz, e.at)
                 ELSE e.at END AS attempted_at
          FROM civic_data_candidates c
          JOIN civic_data_candidate_events e ON e.candidate_id = c.id
         WHERE e.sequence = 1 OR (e.state = 'PROMOTED'
           AND left(e.detail, ${UNCHANGED_CONFIRMATION_PREFIX.length}) = ${UNCHANGED_CONFIRMATION_PREFIX}
           AND EXISTS (SELECT 1 FROM civic_data_promotions p WHERE p.current_version_id = c.id))
         ORDER BY c.source_id, c.record_class, c.scope, attempted_at DESC, c.id DESC`));
      const currentIds = [...new Set(promotions.map((p) => p.currentVersionId))];
      const readbacks = currentIds.length === 0
        ? []
        : await db.select({
            candidateId: civicDataCandidateEvents.candidateId,
            at: civicDataCandidateEvents.at,
            detail: civicDataCandidateEvents.detail,
          }).from(civicDataCandidateEvents).where(and(
            inArray(civicDataCandidateEvents.candidateId, currentIds),
            like(civicDataCandidateEvents.detail, `${READER_PROJECTION_READBACK_PREFIX}%`),
          ));
      return {
        promotions: promotions.map((p) => ({ ...p, promotedAt: iso(p.promotedAt) })),
        latestAttempts: latest.map((r) => ({
          candidateId: String(r.candidate_id),
          sourceId: String(r.source_id),
          recordClass: String(r.record_class),
          scope: String(r.scope),
          state: String(r.state),
          attemptedAt: iso(r.attempted_at),
          failureCode: r.failure_code === null || r.failure_code === undefined ? null : String(r.failure_code),
        })),
        readbacks: readbacks.map((r) => ({ candidateId: r.candidateId, at: iso(r.at), detail: r.detail ?? "" })),
      };
    }, ROUTINE_OBSERVABILITY_SNAPSHOT_OPTIONS);
  } finally {
    await pool.end();
  }
}
