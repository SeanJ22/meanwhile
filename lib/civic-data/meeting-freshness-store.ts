import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { MeetingPartitionContract } from "./meeting-partitions.ts";
import type { RoutineObservabilityRows } from "./observability.ts";

export async function readMeetingFreshnessRows(connection: string, contract: MeetingPartitionContract): Promise<RoutineObservabilityRows> {
  const pool = new Pool({ connectionString: connection, max: 1, connectionTimeoutMillis: 5_000 });
  let db: PoolClient | undefined;
  try {
    db = await pool.connect();
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await db.query("SET LOCAL statement_timeout = 5000");
    const identity = [contract.sourceId, contract.recordClass, contract.scope];
    // Keep all latest-time ties and rows without a local attempt receipt.
    const selected = await db.query<{ id: string }>(`
      WITH attempts AS (
        SELECT c.id, e.at, max(e.at) OVER () AS newest
        FROM civic_data_candidates c LEFT JOIN civic_data_candidate_events e
          ON e.candidate_id = c.id AND e.sequence = 1
        WHERE c.source_id=$1 AND c.record_class=$2 AND c.scope=$3
      ), authority AS (
        SELECT current_version_id AS id FROM civic_data_promotions
          WHERE source_id=$1 AND record_class=$2 AND scope=$3
        UNION SELECT last_known_good_version_id FROM civic_data_promotions
          WHERE source_id=$1 AND record_class=$2 AND scope=$3
      )
      SELECT id FROM attempts WHERE at=newest OR at IS NULL
      UNION SELECT id FROM authority
      UNION SELECT c.candidate#>>'{bootstrapImport,predecessorVersionId}'
        FROM civic_data_candidates c JOIN authority a ON c.id=a.id
        WHERE c.candidate#>>'{bootstrapImport,predecessorVersionId}' IS NOT NULL`, identity);
    const ids = selected.rows.map(row => row.id);
    if (ids.length > 64) throw new Error("MEETING_FRESHNESS_AMBIGUOUS_AUTHORITY");
    // A memory bound, not a coverage cap: overflow holds the partition instead of truncating its evidence.
    const size = await db.query<{ bytes: string }>(`
      SELECT coalesce(sum(bytes),0)::text AS bytes FROM (
        SELECT octet_length(row_to_json(c)::text) AS bytes FROM civic_data_candidates c WHERE id=ANY($1::text[])
        UNION ALL SELECT octet_length(row_to_json(e)::text) FROM civic_data_candidate_events e WHERE candidate_id=ANY($1::text[])
        UNION ALL SELECT octet_length(row_to_json(p)::text) FROM civic_data_promotions p
          WHERE source_id=$2 AND record_class=$3 AND scope=$4
      ) evidence`, [ids, ...identity]);
    const bytes = Number(size.rows[0]?.bytes ?? Infinity);
    if (!Number.isSafeInteger(bytes) || bytes > 32 * 1024 * 1024) throw new Error("MEETING_FRESHNESS_EVIDENCE_TOO_LARGE");
    const candidates = await db.query(`SELECT id, source_id AS "sourceId", record_class AS "recordClass", scope, state,
      acquisition_succeeded AS "acquisitionSucceeded", retrieved_at AS "retrievedAt", source_through AS "sourceThrough",
      candidate, validation_receipt AS "validationReceipt", promoted_version_id AS "promotedVersionId",
      last_known_good_version_id AS "lastKnownGoodVersionId", failure_code AS "failureCode", failure_detail AS "failureDetail"
      FROM civic_data_candidates WHERE id=ANY($1::text[])`, [ids]);
    const events = await db.query(`SELECT id, candidate_id AS "candidateId", sequence, state, at, detail
      FROM civic_data_candidate_events WHERE candidate_id=ANY($1::text[])`, [ids]);
    const promotions = await db.query(`SELECT key, source_id AS "sourceId", record_class AS "recordClass", scope,
      current_version_id AS "currentVersionId", last_known_good_version_id AS "lastKnownGoodVersionId",
      promoted_at AS "promotedAt", payload, validation_receipt AS "validationReceipt"
      FROM civic_data_promotions WHERE source_id=$1 AND record_class=$2 AND scope=$3`, identity);
    await db.query("COMMIT");
    const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : value;
    return {
      candidates: candidates.rows.map(row => ({ ...row, retrievedAt: iso(row.retrievedAt) })),
      events: events.rows.map(row => ({ ...row, at: iso(row.at) })),
      promotions: promotions.rows.map(row => ({ ...row, promotedAt: iso(row.promotedAt) })),
    };
  } finally {
    db?.release(true);
    await pool.end();
  }
}
