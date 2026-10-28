import type { Sql } from "../control-plane/repository/pg-store.ts";
import { boundedQuery } from "../control-plane/repository/request-bounds.ts";
import type { PublicationContract } from "./publication-status.ts";

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
