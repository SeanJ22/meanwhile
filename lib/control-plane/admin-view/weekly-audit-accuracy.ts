import { weekDayKeys } from "../live-audit-log.ts";
import type { Sql } from "../repository/pg-store.ts";
import { auditAccuracyFromCounts, AUDIT_WEEK_DAYS, type FixedFact, type AuditAccuracyReading } from "./v6-audit-read.ts";
import type { PickReason } from "../workers/live-audit.ts";

export const WEEKLY_AUDIT_ACCURACY_SQL = `WITH results AS MATERIALIZED (
 SELECT key,position,record->'result' AS value FROM cp_log_live_audits
 WHERE key=ANY($1::text[]) AND record->>'kind'='RESULT'
), latest AS (
 SELECT DISTINCT ON(value->>'factId') value FROM results
 WHERE (value->>'checkedAt')::timestamptz>$2::timestamptz AND (value->>'checkedAt')::timestamptz<=$3::timestamptz
 ORDER BY value->>'factId',(value->>'checkedAt')::timestamptz DESC,position DESC
), known AS (
 SELECT DISTINCT ON(value->>'factId') value FROM results
 ORDER BY value->>'factId',array_position($1::text[],key) DESC,position DESC
), corrections AS (
 SELECT position,record->'correction' AS value FROM cp_log_live_audits WHERE key='corrections' AND record->>'kind'='CORRECTION'
 AND (record#>>'{correction,at}')::timestamptz>$2::timestamptz AND (record#>>'{correction,at}')::timestamptz<=$3::timestamptz
), counts AS (
 SELECT COUNT(*) FILTER(WHERE value->>'verdict'='GREEN') AS green,COUNT(*) FILTER(WHERE value->>'verdict'='RED') AS red,
  COUNT(*) FILTER(WHERE value->>'verdict'='INCONCLUSIVE') AS inconclusive FROM latest
)
SELECT counts.*,
 (SELECT COALESCE(jsonb_object_agg(reason,n),'{}'::jsonb) FROM (
  SELECT value->>'pickedBecause' AS reason,COUNT(*) AS n FROM latest GROUP BY value->>'pickedBecause') ranked) AS reasons,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('factId',c.value->>'factId','family',COALESCE(k.value->>'family','—'),
  'area',COALESCE(k.value->>'area','—'),'action',c.value->>'action','at',c.value->>'at','summary',c.value->>'summary')
  ORDER BY c.value->>'at',c.position),'[]'::jsonb) FROM corrections c LEFT JOIN known k ON k.value->>'factId'=c.value->>'factId') AS corrections
FROM counts`;

/** Source checks and the complete audit history stay in Postgres; the reader receives counts and this week's corrections. */
export async function readWeeklyAuditAccuracy(sql: Pick<Sql, "query">, now: string): Promise<AuditAccuracyReading> {
  const from = new Date(Date.parse(now) - AUDIT_WEEK_DAYS * 86_400_000).toISOString();
  const [row] = await sql.query(WEEKLY_AUDIT_ACCURACY_SQL, [weekDayKeys(now), from, now]) as Record<string, unknown>[];
  if (!row) throw new Error("AUDIT_ACCURACY_COUNTS_MISSING");
  const parse = <T>(value: unknown): T => typeof value === "string" ? JSON.parse(value) as T : value as T;
  const fixedFacts = parse<FixedFact[]>(row.corrections);
  const byReason: Record<PickReason, number> = {PAST_REFRESH: 0, DEMAND: 0, SINGLE_SOURCE: 0, ROUTINE: 0};
  const reasons = parse<Record<string, unknown>>(row.reasons);
  for (const key of Object.keys(byReason) as PickReason[]) byReason[key] = Number(reasons[key] ?? 0);
  return auditAccuracyFromCounts({now, stillRight: Number(row.green), wrong: Number(row.red), couldNotJudge: Number(row.inconclusive),
    audited: Number(row.green) + Number(row.red), fixedFacts, byReason,
    fixed: fixedFacts.filter(fact => fact.action === "FIXED").length, pulled: fixedFacts.filter(fact => fact.action === "PULLED").length});
}
