/** Never touches the candidate JSON column, not even through a path operator: unpacking it row by row takes minutes. */
import { Pool } from "../db/client.ts";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../db/schema.ts";
import { civicDataPromotions } from "../db/schema.ts";
import { ROUTINE_OBSERVABILITY_SNAPSHOT_OPTIONS } from "./observability-store.ts";
import type { PublicationContract, PublicationStatusRows } from "./publication-status.ts";
import type { Sql } from "../control-plane/repository/pg-store.ts";
import { boundedQuery } from "../control-plane/repository/request-bounds.ts";

export const publicationContractInputs = (contracts: readonly PublicationContract[]) =>
  contracts.map(c => [c.id, c.sourceId, c.recordClass, c.scope, c.readerProjection !== null]);

/** A typed readback of the exact current version; no attempt history or receipt body crosses the connection. */
const PUBLICATION_STATUSES_CTE = `WITH contracts AS (
  SELECT c->>0 AS id,c->>1 AS source_id,c->>2 AS record_class,c->>3 AS scope,(c->>4)::boolean AS has_reader
  FROM jsonb_array_elements($1::jsonb) c
), statuses AS (
  SELECT c.id,p.current_version_id,r.contract_id,r.status,r.at
  FROM contracts c LEFT JOIN civic_data_promotions p
    ON p.source_id=c.source_id AND p.record_class=c.record_class AND p.scope=c.scope
  LEFT JOIN civic_data_current_readbacks r ON c.has_reader AND r.pointer_key=p.key
    AND r.contract_id=c.id AND r.candidate_id=p.current_version_id
)`;

export const PUBLICATION_COUNTS_SQL = `${PUBLICATION_STATUSES_CTE}
SELECT count(*)::int AS total,count(*) FILTER (WHERE status='PASS')::int AS read_back FROM statuses`;

/** The detailed panel uses one valid receipt per current contract, with only the fields its parser consumes. */
export const PUBLICATION_READBACK_ROWS_SQL = `${PUBLICATION_STATUSES_CTE}
SELECT current_version_id AS candidate_id,at,contract_id,status FROM statuses WHERE status IS NOT NULL ORDER BY id`;

export async function readPublicationCounts(sql: Sql, contracts: readonly PublicationContract[]): Promise<{ readonly total: number; readonly readBack: number }> {
  const inputs = publicationContractInputs(contracts);
  const [row] = await boundedQuery(sql, { operation: "publication.counts", callClass: "PAGE" },
    PUBLICATION_COUNTS_SQL, [JSON.stringify(inputs)]) as { total: number; read_back: number }[];
  if (!row) throw new Error("Publication counts were not returned");
  return { total: Number(row.total), readBack: Number(row.read_back) };
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function rowsOf(result: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** Each source's last attempt is maintained when its events or publication pointer change. */
export const PUBLICATION_LATEST_ATTEMPTS_SQL = `WITH contracts AS (
  SELECT DISTINCT s->>1 AS source_id,s->>2 AS record_class,s->>3 AS scope FROM jsonb_array_elements($1::jsonb) s
) SELECT a.candidate_id,a.source_id,a.record_class,a.scope,a.state,a.failure_code,a.attempted_at
  FROM contracts c JOIN civic_data_source_status a USING(source_id,record_class,scope)`;

export async function readPublicationStatusRows(
  connection: string,
  statementTimeoutMs: number,
  contracts: readonly PublicationContract[],
): Promise<PublicationStatusRows> {
  if (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs <= 0) {
    throw new Error(`PUBLICATION_STATUS_STATEMENT_TIMEOUT_INVALID:${statementTimeoutMs}`);
  }
  const pool = new Pool({ connectionString: connection, max: 1, connectionTimeoutMillis: 15000 });
  const inputs = JSON.stringify(publicationContractInputs(contracts));
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
      }).from(civicDataPromotions).where(sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${inputs}::jsonb) c
        WHERE c->>1=${civicDataPromotions.sourceId} AND c->>2=${civicDataPromotions.recordClass} AND c->>3=${civicDataPromotions.scope})`);
      const [latestBefore,latestAfter] = PUBLICATION_LATEST_ATTEMPTS_SQL.split("$1::jsonb");
      const latest = rowsOf(await db.execute(sql`${sql.raw(latestBefore)}${inputs}::jsonb${sql.raw(latestAfter)}`));
      const [before, after] = PUBLICATION_READBACK_ROWS_SQL.split("$1::jsonb");
      const readbacks = rowsOf(await db.execute(sql`${sql.raw(before)}${inputs}::jsonb${sql.raw(after)}`));
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
        readbacks: readbacks.map((r) => ({ candidateId: String(r.candidate_id), at: iso(r.at),
          summary: { contractId: String(r.contract_id), versionId: String(r.candidate_id), status: r.status as "PASS" | "FAIL" } })),
      };
    }, ROUTINE_OBSERVABILITY_SNAPSHOT_OPTIONS);
  } finally {
    await pool.end();
  }
}
