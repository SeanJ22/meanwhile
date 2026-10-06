/**
 * **THE LAST FULL HOURS (Admin Now, from `cp_vital_signs`).** The hourly row the runner writes, read for Now: the last two full
 * hours, each with the numbers Sean watches. The read is one indexed lookup of at most three rows (the open hour is skipped).
 * A number nobody recorded is null and shows "—"; a row written before the table exists reads as not measured, never as zero.
 * Target: under 0.7 GB read an hour (board/river vital-signs.md); a paid job that ended with nothing is red above 0.
 */
import type { ScoreboardVitalHour } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";

export const NEON_HOUR_TARGET_BYTES = 0.7e9;
const HOUR = 3_600_000;

export const VITAL_NOW_SQL = `SELECT hour, facts_live, spend_usd, cost_per_fact_usd, neon_bytes_read, rounds_finished, rounds_killed,
  paid_jobs_ended_empty, paid_jobs_ended FROM cp_vital_signs WHERE hour >= $1::timestamptz AND hour < $2::timestamptz ORDER BY hour DESC LIMIT 2`;

const num = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/** The last two complete UTC hours before `nowIso`, newest first. Null when the table is not installed or could not be read. */
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

/** PURE: rows in, Now's hours out. An hour with no row is simply absent; the screen says so. */
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
