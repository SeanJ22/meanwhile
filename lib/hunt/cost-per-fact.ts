/** What hunting cost for each fact it got published: every hunt job's model and search spend over the facts its reports put live. */

export const HUNT_COST_DAYS = 30;

export const HUNT_COST_SQL = `SELECT coalesce(sum((record->'cost'->>'usd')::float8), 0)::float8 AS usd,
 count(*) FILTER (WHERE record->'cost'->>'usd' IS NULL)::int AS unpriced,
 coalesce(sum((record->'cost'->>'usd')::float8) FILTER (WHERE record->>'role' = 'DISCOVERY_SEARCH'), 0)::float8 AS search_usd,
 count(DISTINCT record->>'attemptId') FILTER (WHERE record->>'role' <> 'DISCOVERY_SEARCH')::int AS jobs
 FROM cp_log_costs WHERE recorded_at >= now() - ($1::int * interval '1 day')
 AND coalesce(record->>'nonProduction', 'false') <> 'true'
 AND (record->>'obligationId' LIKE 'hunt:packet:%' OR record->>'recordClass' = 'HUNT_PACKET')`;

export const HUNT_FACTS_SQL = `SELECT count(*)::int AS reported,
 count(*) FILTER (WHERE value->>'state' = 'built' AND value->>'publicationId' IS NOT NULL)::int AS published
 FROM cp_box_findings WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(value->'origins') o
   WHERE o->>'resultKey' LIKE 'hunt:packet:%' AND (o->>'recordedAt')::timestamptz >= now() - ($1::int * interval '1 day'))`;

export interface HuntCostView {
  readonly days: number;
  readonly usd: number;
  readonly searchUsd: number;
  readonly unpricedRows: number;
  readonly jobs: number;
  readonly factsReported: number;
  readonly factsPublished: number;
  /** Null until a fact is published, or while any charge is unpriced. */
  readonly usdPerPublishedFact: number | null;
}

export function huntCostView(cost: Readonly<Record<string, unknown>> | undefined, facts: Readonly<Record<string, unknown>> | undefined): HuntCostView {
  const n = (value: unknown) => Number(value) || 0;
  const usd = n(cost?.usd), unpricedRows = n(cost?.unpriced), factsPublished = n(facts?.published);
  return { days: HUNT_COST_DAYS, usd, searchUsd: n(cost?.search_usd), unpricedRows, jobs: n(cost?.jobs), factsReported: n(facts?.reported), factsPublished,
    usdPerPublishedFact: factsPublished > 0 && unpricedRows === 0 ? usd / factsPublished : null };
}
