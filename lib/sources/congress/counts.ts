import type { SourceChecksQuery } from "../../civic-data/source-checks.ts";
import type { FederalCounts, FederalProjection } from "./types.ts";

/** Native primary partitions count once; member fanouts and national summaries never count again. */
export function primaryFederalCounts(source: string, scope: string, payload: FederalProjection): boolean {
  const partition = scope.slice(source.length + 1);
  if (partition === "national") return false;
  if (typeof payload.countsPrimary === "boolean") return payload.countsPrimary;
  if (source === "senate-lda") return partition.startsWith("filing:") || partition.startsWith("unjoined:");
  if (source === "congress-api") return partition.startsWith("congress:") || partition.startsWith("unjoined:") ||
    partition.startsWith("bill:") && !payload.records.some(row => row.kind === "BILL" && row.bioguideId);
  return source === "govinfo" ? partition.startsWith("bill:") || partition.startsWith("unjoined:") : partition === "rules";
}

export function aggregateFederalCounts(rows: Iterable<{ readonly scope: string; readonly payload: FederalProjection }>, source: string) {
  const counts: FederalCounts = { loaded: 0, joined: 0, unjoined: 0, byState: {} };
  let complete = true;
  const add = (target: Record<string, number>, value: Record<string, number>) => {
    for (const [key, count] of Object.entries(value)) {
      if (!Number.isSafeInteger(count) || count < 0) { complete = false; continue; }
      target[key] = (target[key] ?? 0) + count;
    }
  };
  for (const row of rows) {
    if (!primaryFederalCounts(source, row.scope, row.payload)) continue;
    const value = row.payload.counts;
    if (!value || ![value.loaded, value.joined, value.unjoined].every(count => Number.isSafeInteger(count) && count >= 0)) { complete = false; continue; }
    for (const key of ["loaded", "joined", "unjoined"] as const) counts[key] += value[key];
    for (const [state, totals] of Object.entries(value.byState ?? {})) add(counts.byState[state] ??= { loaded: 0, joined: 0, unjoined: 0 }, totals);
    if (value.unjoinedReasons) add(counts.unjoinedReasons ??= {}, value.unjoinedReasons);
  }
  return { complete, counts };
}

/** Aggregate current canonical count fields inside Postgres; no fact or capture body leaves the database. */
export async function readFederalCounts(query: SourceChecksQuery, source: string): Promise<{ complete: boolean; counts: FederalCounts }> {
  const [result] = await query(`WITH current AS (
    SELECT p.scope,reader_payload_node(p.payload) AS payload
    FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE p.record_class='FEDERAL_CIVIC_RECORD' AND p.source_id=$1 AND c.source_id=p.source_id
      AND c.record_class=p.record_class AND c.scope=p.scope
      AND p.current_version_id=p.last_known_good_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
      AND NOT(c.candidate ? 'bootstrapImport')
      AND coalesce(c.candidate#>>'{stateRetirement,kind}','')<>'STATE_AUTHORITY_RETIREMENT'
  ), primary_rows AS (
    SELECT reader_payload_value(payload->'counts') AS counts FROM current
    WHERE CASE WHEN scope=$1||':national' THEN false
      WHEN jsonb_typeof(payload->'countsPrimary')='boolean' THEN (payload->>'countsPrimary')::boolean
      WHEN $1='senate-lda' THEN scope LIKE $1||':filing:%' OR scope LIKE $1||':unjoined:%'
      WHEN $1='congress-api' THEN scope LIKE $1||':congress:%' OR scope LIKE $1||':unjoined:%' OR
        (scope LIKE $1||':bill:%' AND NOT EXISTS(SELECT 1 FROM reader_payload_members(payload->'records') r
          WHERE reader_payload_node(r.item)->>'kind'='BILL' AND coalesce(reader_payload_node(r.item)->>'bioguideId','')<>''))
      WHEN $1='govinfo' THEN scope LIKE $1||':bill:%' OR scope LIKE $1||':unjoined:%'
      ELSE scope=$1||':rules' END
  ), checked AS (
    SELECT counts,coalesce(counts->>'loaded' ~ '^[0-9]+$' AND counts->>'joined' ~ '^[0-9]+$' AND counts->>'unjoined' ~ '^[0-9]+$'
      AND jsonb_typeof(counts->'byState')='object',false) AS ok FROM primary_rows
  ), valid AS (SELECT counts FROM checked WHERE ok), states AS (
    SELECT key,sum((value->>'loaded')::bigint) AS loaded,sum((value->>'joined')::bigint) AS joined,sum((value->>'unjoined')::bigint) AS unjoined
    FROM valid CROSS JOIN LATERAL jsonb_each(counts->'byState') GROUP BY key
  ), reasons AS (
    SELECT key,sum(value::bigint) AS total FROM valid CROSS JOIN LATERAL jsonb_each_text(coalesce(counts->'unjoinedReasons','{}'::jsonb)) GROUP BY key
  ) SELECT NOT EXISTS(SELECT 1 FROM checked WHERE NOT ok) AS complete,jsonb_build_object(
    'loaded',coalesce((SELECT sum((counts->>'loaded')::bigint) FROM valid),0),
    'joined',coalesce((SELECT sum((counts->>'joined')::bigint) FROM valid),0),
    'unjoined',coalesce((SELECT sum((counts->>'unjoined')::bigint) FROM valid),0),
    'byState',coalesce((SELECT jsonb_object_agg(key,jsonb_build_object('loaded',loaded,'joined',joined,'unjoined',unjoined)) FROM states),'{}'::jsonb))
    || CASE WHEN EXISTS(SELECT 1 FROM reasons) THEN jsonb_build_object('unjoinedReasons',(SELECT jsonb_object_agg(key,total) FROM reasons)) ELSE '{}'::jsonb END AS counts`, [source]);
  if (!result || typeof result.counts !== "object" || !result.counts) throw new Error("FEDERAL_COUNTS_UNAVAILABLE");
  return { complete: result.complete === true, counts: result.counts as FederalCounts };
}
