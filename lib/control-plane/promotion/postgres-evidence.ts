import type { Attempt } from "../attempt.ts";
import { CorruptPersistedState, type ArtifactRecord } from "../repository/types.ts";

/** River supplies its existing bounded, instrumented PAGE runner. */
export type PromotionPageReader = (operation: string, text: string, params: readonly unknown[]) => Promise<unknown>;
export const PROMOTION_READ_PAGE = 100;
function parseValue<T>(raw: unknown, where: string): T {
  try { return (typeof raw === "string" ? JSON.parse(raw) : raw) as T; }
  catch (error) { throw new CorruptPersistedState(where, error instanceof Error ? error.message : String(error)); }
}

/** Exact evidence selection using the existing artifact-id and URL indexes.
 * Pages bound each response, not the history: every matching observation is
 * retained, in the same order as readAll, including repeated artifact ids.
 */
export async function pgArtifactsForPromotion(readPage: PromotionPageReader, artifactIds: readonly string[], canonicalUrls: readonly string[]): Promise<readonly ArtifactRecord[]> {
  if (!artifactIds.length && !canonicalUrls.length) return [];
  const out: ArtifactRecord[] = [];
  let cursor: [string, number] | null = null;
  for (;;) {
    const rows = await readPage("artifactsForPromotion",
      `SELECT log_key, position, record FROM cp_log_artifacts
       WHERE ((record #>> '{artifactId}') = ANY($1::text[]) OR
         (md5(record->>'canonicalUrl') = ANY(ARRAY(SELECT md5(url) FROM unnest($2::text[]) AS url))
          AND record->>'canonicalUrl' = ANY($2::text[])))
       ${cursor === null ? "" : "AND (log_key, position) > ($3, $4::bigint)"}
       ORDER BY log_key ASC, position ASC LIMIT ${PROMOTION_READ_PAGE}`,
      [[...new Set(artifactIds)], [...new Set(canonicalUrls)], ...(cursor ?? [])]) as Record<string, unknown>[];
    for (const row of rows) out.push(parseValue<ArtifactRecord>(row.record, "cp_log_artifacts promotion evidence"));
    if (rows.length < PROMOTION_READ_PAGE) return out;
    const last = rows[rows.length - 1];
    cursor = [String(last.log_key), Number(last.position)];
  }
}

export async function pgAcquisitionAttemptsForArtifacts(readPage: PromotionPageReader, artifactIds: readonly string[]): Promise<readonly Attempt[]> {
  if (!artifactIds.length) return [];
  const out: Attempt[] = [];
  let after: string | null = null;
  for (;;) {
    const rows = await readPage("acquisitionAttemptsForArtifacts",
      `SELECT id, value FROM cp_attempts WHERE value #>> '{worker,role}' = 'ACQUIRER'
       AND value->>'outcome' = 'COMPLETED' AND (value->'artifactIds') ?| $1::text[]
       ${after === null ? "" : "AND id > $2"}
       ORDER BY id ASC LIMIT ${PROMOTION_READ_PAGE}`,
      [[...new Set(artifactIds)], ...(after === null ? [] : [after])]) as Record<string, unknown>[];
    for (const row of rows) out.push(parseValue<Attempt>(row.value, "cp_attempts artifact reobservation"));
    if (rows.length < PROMOTION_READ_PAGE) return out;
    after = String(rows[rows.length - 1].id);
  }
}

