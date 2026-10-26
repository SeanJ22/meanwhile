import type { ScoreboardVitalHour } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import { boundedQuery, type BoundableSql } from "../repository/request-bounds.ts";
import { neon } from "@neondatabase/serverless";
import { costPerFact } from "../vital-signs.ts";

/** Database triggers count committed new and changed live facts, including writers outside the runner. */
export const LIVE_FACT_HOURS_SQL = `WITH coverage AS (
  SELECT min(hour) AS start FROM count_hour WHERE step='counter start'
), hours AS (
  SELECT generate_series($1::timestamptz - interval '2 hours', $1::timestamptz - interval '1 hour', interval '1 hour') AS hour
), live AS (
  SELECT hour,n,substring(step FROM 4)::jsonb AS dimension FROM count_hour
  WHERE hour >= $1::timestamptz - interval '2 hours' AND hour < $1::timestamptz AND step LIKE 'v1:%'
)
SELECT h.hour,CASE WHEN c.start < h.hour+interval '1 hour' THEN coalesce(sum(l.n) FILTER (
  WHERE l.dimension->>1='fact:live' AND l.dimension->>2 IN ('in','changed')),0)::bigint ELSE NULL END AS facts_live,
  c.start>h.hour AND c.start<h.hour+interval '1 hour' AS facts_at_least
FROM hours h CROSS JOIN coverage c LEFT JOIN live l ON l.hour>=h.hour AND l.hour<h.hour+interval '1 hour'
GROUP BY h.hour,c.start ORDER BY h.hour DESC`;

/** Reader triggers supply live facts; the runner supplies spending and its own activity. */
export async function readVitalSigns(sql: BoundableSql, at: string,
  reader:BoundableSql|null=process.env.DATABASE_URL?neon(process.env.DATABASE_URL,{readOnly:true}):null): Promise<readonly ScoreboardVitalHour[]> {
  const through = new Date(Math.floor(Date.parse(at) / 3_600_000) * 3_600_000).toISOString();
  const [rows,live] = await Promise.all([
    boundedQuery(sql, { operation: "vital-signs.admin", callClass: "PAGE" },
    `SELECT hour,spend_usd,neon_bytes_read,rounds_finished,rounds_killed,paid_jobs_ended_empty,paid_jobs_ended
     FROM cp_vital_signs WHERE hour >= $1::timestamptz - interval '2 hours' AND hour < $1::timestamptz ORDER BY hour DESC LIMIT 2`, [through]) as Promise<Record<string, unknown>[]>,
    reader?boundedQuery(reader,{operation:"vital-signs.live-facts",callClass:"PAGE"},LIVE_FACT_HOURS_SQL,[through])
      .catch(()=>[]) as Promise<Record<string,unknown>[]>:Promise.resolve([]),
  ]);
  const number = (value: unknown) => value === null || value === undefined ? null : Number(value);
  const timestamp=(value:unknown)=>new Date(value as string).toISOString();
  const runner=new Map(rows.map(row=>[timestamp(row.hour),row]));
  const facts=new Map(live.map(row=>[timestamp(row.hour),{value:number(row.facts_live),atLeast:row.facts_at_least===true}]));
  return [...new Set([...runner.keys(),...facts.keys()])].sort().reverse().map(hour => {
    const row=runner.get(hour)??{};
    const bytes = number(row.neon_bytes_read);
    const factsLive=facts.get(hour)?.value??null,factsLiveAtLeast=facts.get(hour)?.atLeast??false;
    return { hour, factsLive, factsLiveAtLeast, factsLiveConfirmed: false,
      costPerFactUsd: factsLiveAtLeast?null:costPerFact(number(row.spend_usd),factsLive), neonGb: bytes === null ? null : bytes / 1e9, neonAtLeast: true,
      overNeonTarget: bytes === null || bytes < 0.7e9 ? null : true,
      roundsFinished: number(row.rounds_finished), roundsKilled: number(row.rounds_killed),
      paidJobsEndedEmpty: number(row.paid_jobs_ended_empty), paidJobsEnded: number(row.paid_jobs_ended) };
  });
}
