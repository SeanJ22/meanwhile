import { sql } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { sanitizedErrorDiagnostic } from "../../ops/error-diagnostic.ts";
import { PUBLICATION_HISTORY_PAGE_SIZE, publicationHistoryRow, type PublishedHistoryRead } from "./publication-history.ts";

if (typeof window !== "undefined") throw new Error("Publication history is a server-only read.");

export function publicationHistoryPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, value => `\\${value}`)}%`;
}

/** Search the complete, transactionally derived publication index before paging.
 * Immutable candidates and their first PROMOTED events remain the authority.
 * This index neither attributes records to a hunt nor confirms current Reader delivery. */
export async function readPublicationHistory(input: {
  query: string; page?: number; asOf?: string; version?: string; recordKey?: string; now?: string;
}): Promise<PublishedHistoryRead> {
  const now = input.now ?? new Date().toISOString();
  const asOf = input.asOf && Number.isFinite(Date.parse(input.asOf)) && Date.parse(input.asOf) <= Date.parse(now)
    ? new Date(input.asOf).toISOString() : now;
  const page = Number.isSafeInteger(input.page) && input.page! > 0 && input.page! <= 1_000_000 ? input.page! : 1;
  const query = input.query.trim().slice(0, 100).replace(/[\uD800-\uDBFF]$/, "");
  const exact = Boolean(input.version && input.recordKey);
  const base = { rows: [], total: null, page, asOf };
  if (!exact && query.length < 3) return { ...base, state: "NOT_ASKED", reason: "Enter at least three characters from a name, meeting, place or record reference." };
  if (!process.env.DATABASE_URL) return { ...base, state: "UNAVAILABLE", reason: "Publication history is not connected. Its records and counts are unknown." };
  try {
    const result = await getDb().execute(sql`
      WITH readiness AS MATERIALIZED (
        SELECT EXISTS (SELECT 1 FROM civic_data_publication_search_readiness
          WHERE id = 'publication-history' AND schema_version = 2 AND status = 'READY') AS ready
      ), matching_keys AS MATERIALIZED (
        SELECT DISTINCT version_id, record_key
        FROM civic_data_publication_search_chunks
        WHERE (SELECT ready FROM readiness) AND ${!exact} AND search_chunk ILIKE ${publicationHistoryPattern(query)}
        UNION ALL
        SELECT version_id, record_key FROM civic_data_publication_search
        WHERE (SELECT ready FROM readiness) AND ${exact} AND version_id = ${input.version ?? ""} AND record_key = ${input.recordKey ?? ""}
      ), matches AS MATERIALIZED (
        SELECT h.version_id, h.record_key, h.promoted_at
        FROM matching_keys k JOIN civic_data_publication_search h USING (version_id, record_key)
        WHERE h.promoted_at <= ${asOf}::timestamptz
      ), selected AS (
        SELECT * FROM matches ORDER BY promoted_at DESC, version_id, record_key
        LIMIT ${exact ? 1 : PUBLICATION_HISTORY_PAGE_SIZE}
        OFFSET ${exact ? 0 : (page - 1) * PUBLICATION_HISTORY_PAGE_SIZE}
      )
      SELECT (SELECT ready FROM readiness) AS index_ready, (SELECT count(*) FROM matches)::text AS total,
        coalesce((SELECT jsonb_agg(row_to_json(r) ORDER BY r.published_at DESC, r.version, r.record_key) FROM (
          SELECT h.version_id AS version, h.record_key, h.record_class, h.scope,
            h.captured_at AS recorded_at, h.promoted_at AS published_at, h.label, h.source_url,
            EXISTS (SELECT 1 FROM civic_data_promotions p WHERE p.current_version_id = h.version_id) AS current_version
          FROM selected s JOIN civic_data_publication_search h
            ON h.version_id = s.version_id AND h.record_key = s.record_key
        ) r), '[]'::jsonb) AS results
    `);
    const row = result.rows[0] as { index_ready?: unknown; total?: unknown; results?: unknown } | undefined;
    if (row?.index_ready !== true) return { ...base, state: "UNAVAILABLE", reason: "Publication history is still being prepared. Its records and counts are unknown until the complete index is ready." };
    const total = Number(row?.total);
    if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(row?.results)) throw Error("Unusable history response");
    return { state: "READ", total, page, asOf, reason: null, rows: row.results.map(value => publicationHistoryRow({ ...value, query })) };
  } catch (error) {
    console.error("ADMIN_PUBLICATION_HISTORY_UNAVAILABLE", sanitizedErrorDiagnostic(error instanceof Error && error.cause ? error.cause : error));
    return { ...base, state: "UNAVAILABLE", reason: "Publication history could not be read. No empty-result or complete-coverage claim can be made." };
  }
}
