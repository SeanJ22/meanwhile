import { boundedQuery, type BoundableSql, type ControlPlaneRequestBounds } from "./request-bounds.ts";
import type { QueryBytesCaller } from "../../db/query-bytes.ts";

/**
 * **THE HOURLY VITAL-SIGNS ROW.** (MW-VS-01, vital-signs.md.)
 *
 * One row per UTC hour in `cp_vital_signs`. The runner upserts it (a running
 * partial every ten minutes, the full row at the end of the hour); Admin Now
 * and the daily brief read only this table. Each writer owns its own columns:
 * an upsert sets the columns it names and leaves the rest as they were, so the
 * byte counter's writer and the publisher's writer never overwrite each other.
 * A column nobody has recorded is null, which Admin shows as "—".
 */
export interface VitalSignsRow {
  /** Start of the UTC hour, ISO. */
  readonly hour: string;
  readonly factsLive: number | null;
  readonly factsConfirmed: number | null;
  readonly factsSampled: number | null;
  readonly spendUsd: number | null;
  readonly unpricedCharges: number | null;
  readonly costPerFactUsd: number | null;
  readonly neonBytesRead: number | null;
  readonly neonBytesByCaller: readonly QueryBytesCaller[] | null;
  readonly roundsFinished: number | null;
  readonly roundsKilled: number | null;
  readonly roundsDeferred: number | null;
  readonly paidJobsEndedEmpty: number | null;
  readonly paidJobsEnded: number | null;
  readonly neonProjectBytes: number | null;
  readonly releaseSha: string | null;
  readonly writtenAt: string | null;
}

export type VitalSignsPatch = Partial<Omit<VitalSignsRow, "hour" | "writtenAt">>;

const COLUMNS: Record<keyof VitalSignsPatch, string> = {
  factsLive: "facts_live", factsConfirmed: "facts_confirmed", factsSampled: "facts_sampled",
  spendUsd: "spend_usd", unpricedCharges: "unpriced_charges", costPerFactUsd: "cost_per_fact_usd",
  neonBytesRead: "neon_bytes_read", neonBytesByCaller: "neon_bytes_by_caller",
  roundsFinished: "rounds_finished", roundsKilled: "rounds_killed", roundsDeferred: "rounds_deferred",
  paidJobsEndedEmpty: "paid_jobs_ended_empty", paidJobsEnded: "paid_jobs_ended",
  neonProjectBytes: "neon_project_bytes", releaseSha: "release_sha",
};

/** The start of the UTC hour containing `at`. */
export function vitalSignsHour(at: Date | string): string {
  const d = new Date(at);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/** Upsert the named columns of one hour's row: one statement, about 2 KB. */
export async function upsertVitalSigns(
  sql: BoundableSql, hour: string, patch: VitalSignsPatch,
  options: { readonly bounds?: ControlPlaneRequestBounds } = {},
): Promise<void> {
  const keys = (Object.keys(patch) as (keyof VitalSignsPatch)[]).filter(k => k in COLUMNS && patch[k] !== undefined);
  const columns = keys.map(k => COLUMNS[k]);
  const params: unknown[] = [vitalSignsHour(hour), ...keys.map(k => {
    const v = patch[k];
    return k === "neonBytesByCaller" && v !== null ? JSON.stringify(v) : v;
  })];
  const slots = keys.map((k, i) => k === "neonBytesByCaller" ? `$${i + 2}::jsonb` : `$${i + 2}`);
  const sets = columns.map(c => `${c} = EXCLUDED.${c}`);
  await boundedQuery(sql, { operation: "cp_vital_signs.upsert", callClass: "POINT" },
    `INSERT INTO cp_vital_signs (hour${columns.map(c => `, ${c}`).join("")})
     VALUES ($1::timestamptz${slots.map(s => `, ${s}`).join("")})
     ON CONFLICT (hour) DO UPDATE SET ${[...sets, "written_at = now()"].join(", ")}`,
    params, options);
}

function num(v: unknown): number | null { return v === null || v === undefined ? null : Number(v); }

/** The most recent hours, newest first. Bounded: Admin reads at most 48, the brief 24. */
export async function readVitalSigns(
  sql: BoundableSql, hours = 24, options: { readonly bounds?: ControlPlaneRequestBounds } = {},
): Promise<VitalSignsRow[]> {
  const limit = Math.max(1, Math.min(48, Math.trunc(hours)));
  const rows = await boundedQuery(sql, { operation: "cp_vital_signs.read", callClass: "POINT" },
    `SELECT hour, facts_live, facts_confirmed, facts_sampled, spend_usd, unpriced_charges, cost_per_fact_usd,
            neon_bytes_read, neon_bytes_by_caller, rounds_finished, rounds_killed, rounds_deferred,
            paid_jobs_ended_empty, paid_jobs_ended, neon_project_bytes, release_sha, written_at
     FROM cp_vital_signs ORDER BY hour DESC LIMIT $1`, [limit], options) as Record<string, unknown>[];
  const iso = (v: unknown) => v === null || v === undefined ? null : new Date(v as string).toISOString();
  return rows.map(r => ({
    hour: iso(r.hour)!,
    factsLive: num(r.facts_live), factsConfirmed: num(r.facts_confirmed), factsSampled: num(r.facts_sampled),
    spendUsd: num(r.spend_usd), unpricedCharges: num(r.unpriced_charges), costPerFactUsd: num(r.cost_per_fact_usd),
    neonBytesRead: num(r.neon_bytes_read),
    neonBytesByCaller: (typeof r.neon_bytes_by_caller === "string" ? JSON.parse(r.neon_bytes_by_caller) : r.neon_bytes_by_caller ?? null) as readonly QueryBytesCaller[] | null,
    roundsFinished: num(r.rounds_finished), roundsKilled: num(r.rounds_killed), roundsDeferred: num(r.rounds_deferred),
    paidJobsEndedEmpty: num(r.paid_jobs_ended_empty), paidJobsEnded: num(r.paid_jobs_ended),
    neonProjectBytes: num(r.neon_project_bytes), releaseSha: (r.release_sha as string | null) ?? null, writtenAt: iso(r.written_at),
  }));
}
