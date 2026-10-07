/** A number nobody recorded is null ("—"); a missing table reads as not measured, never zero. The open hour is skipped. */
import type { ScoreboardVitalHour } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";

export const NEON_HOUR_TARGET_BYTES = 0.7e9;
const HOUR = 3_600_000;

export const VITAL_NOW_SQL = `SELECT hour, facts_live, spend_usd, cost_per_fact_usd, neon_bytes_read, rounds_finished, rounds_killed,
  paid_jobs_ended_empty, paid_jobs_ended FROM cp_vital_signs WHERE hour >= $1::timestamptz AND hour < $2::timestamptz ORDER BY hour DESC LIMIT 2`;

const num = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

export async function readVitalNow(control: Sql, nowIso: string): Promise<readonly ScoreboardVitalHour[] | null> {
  const end = Math.floor(Date.parse(nowIso) / HOUR) * HOUR;
  try {
    const rows = await boundedQuery(control, { operation: "cp_vital_signs.lastHours", callClass: "PAGE" }, VITAL_NOW_SQL,
      [new Date(end - 2 * HOUR).toISOString(), new Date(end).toISOString()]) as Record<string, unknown>[];
    return vitalHours(rows);
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return null;
    throw error;
  }
}

export function vitalHours(rows: readonly Record<string, unknown>[]): readonly ScoreboardVitalHour[] {
  return rows.map((r): ScoreboardVitalHour => {
    const bytes = num(r.neon_bytes_read);
    return {
      hour: new Date(r.hour as string | Date).toISOString(),
      factsLive: num(r.facts_live),
      costPerFactUsd: num(r.cost_per_fact_usd),
      neonGb: bytes === null ? null : bytes / 1e9,
      overNeonTarget: bytes === null ? null : bytes > NEON_HOUR_TARGET_BYTES,
      roundsFinished: num(r.rounds_finished),
      roundsKilled: num(r.rounds_killed),
      paidJobsEndedEmpty: num(r.paid_jobs_ended_empty),
      paidJobsEnded: num(r.paid_jobs_ended),
    };
  }).sort((a, b) => b.hour.localeCompare(a.hour));
}
