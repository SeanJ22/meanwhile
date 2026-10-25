import type { ScoreboardVitalHour } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import { boundedQuery, type BoundableSql } from "../repository/request-bounds.ts";

/** Preserve the runner's native hour readings without involving the line keeper. */
export async function readVitalSigns(sql: BoundableSql, at: string): Promise<readonly ScoreboardVitalHour[]> {
  const through = new Date(Math.floor(Date.parse(at) / 3_600_000) * 3_600_000).toISOString();
  const rows = await boundedQuery(sql, { operation: "vital-signs.admin", callClass: "PAGE" },
    `SELECT hour,facts_live,cost_per_fact_usd,neon_bytes_read,rounds_finished,rounds_killed,paid_jobs_ended_empty,paid_jobs_ended
     FROM cp_vital_signs WHERE hour >= $1::timestamptz - interval '2 hours' AND hour < $1::timestamptz ORDER BY hour DESC LIMIT 2`, [through]) as Record<string, unknown>[];
  const number = (value: unknown) => value === null || value === undefined ? null : Number(value);
  return rows.map(row => {
    const bytes = number(row.neon_bytes_read);
    return { hour: new Date(row.hour as string).toISOString(), factsLive: number(row.facts_live), factsLiveConfirmed: false,
      costPerFactUsd: number(row.cost_per_fact_usd), neonGb: bytes === null ? null : bytes / 1e9, neonAtLeast: true,
      overNeonTarget: bytes === null || bytes < 0.7e9 ? null : true,
      roundsFinished: number(row.rounds_finished), roundsKilled: number(row.rounds_killed),
      paidJobsEndedEmpty: number(row.paid_jobs_ended_empty), paidJobsEnded: number(row.paid_jobs_ended) };
  });
}
