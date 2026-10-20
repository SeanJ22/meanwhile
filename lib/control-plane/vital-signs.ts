import type { NeonBytesHour } from "../db/transfer-by-caller.ts";
import { boundedQuery, CONTROL_PLANE_REQUEST_BOUNDS_MS, type BoundableSql } from "./repository/request-bounds.ts";

export const VITAL_SIGNS_TABLE = "cp_vital_signs";

/** The names processes count under with `countVitalSign`. */
export const VITAL_COUNTERS = {
  roundsFinished: "rounds_finished",
  roundsKilled: "rounds_killed",
  roundsDeferred: "rounds_deferred",
  /** slide: a reader record going live. */
  factsLive: "facts_live",
  /** slide: the live-site sampler. */
  factsConfirmed: "facts_confirmed",
  factsSampled: "facts_sampled",
} as const;

export interface HourCosts {
  readonly spendUsd: number;
  readonly unpricedCharges: number;
  readonly paidJobsEnded: number;
  readonly paidJobsEndedEmpty: number;
}

export interface VitalSignsRow {
  readonly hour: string;
  readonly factsLive: number | null;
  readonly factsConfirmed: number | null;
  readonly factsSampled: number | null;
  readonly spendUsd: number | null;
  readonly unpricedCharges: number | null;
  readonly costPerFactUsd: number | null;
  readonly neonBytesRead: number;
  readonly neonBytesByCaller: Readonly<Record<string, number>>;
  readonly roundsFinished: number;
  readonly roundsKilled: number;
  readonly roundsDeferred: number;
  readonly paidJobsEndedEmpty: number | null;
  readonly paidJobsEnded: number | null;
  readonly releaseSha: string | null;
  readonly writtenAt: string;
}

/** Paid job: a model-priced or charged row of budgeted work (Ask answers and proof runs excluded; the pre-warm is its own kind). Ended empty: its ending says NOTHING, or on older rows it committed no disposition. */
const PAID = `(record->>'role' IS DISTINCT FROM 'ASK' AND record->'nonProduction' IS NULL
  AND coalesce(record->>'attemptId', '') NOT LIKE 'scout-prewarm:%'
  AND (coalesce(record->>'model', '') <> '' OR (jsonb_typeof(record->'cost'->'usd') = 'number' AND (record->'cost'->>'usd')::numeric > 0)))`;
const EMPTY = `(CASE WHEN record ? 'endingKind' THEN record->>'endingKind' = 'NOTHING'
  ELSE record->>'resultKind' IS NULL OR record->>'resultKind' IN ('NO_DISPOSITION', 'DISPOSITION_REFUSED', 'REQUIRES_NEW_ADAPTER') END)`;

export const HOUR_COSTS_SQL = `SELECT
  coalesce(sum((record->'cost'->>'usd')::numeric) FILTER (WHERE jsonb_typeof(record->'cost'->'usd') = 'number'), 0)::text AS spend_usd,
  count(*) FILTER (WHERE jsonb_typeof(record->'cost'->'usd') IS DISTINCT FROM 'number' AND coalesce(record->>'model', '') <> '')::int AS unpriced,
  count(DISTINCT record->>'attemptId') FILTER (WHERE ${PAID})::int AS paid_jobs_ended,
  count(DISTINCT record->>'attemptId') FILTER (WHERE ${PAID} AND ${EMPTY})::int AS paid_jobs_ended_empty
  FROM cp_log_costs WHERE recorded_at >= $1::timestamptz AND recorded_at < $2::timestamptz`;

/** One indexed aggregate over the hour's cost rows; one small row comes back. */
export async function readHourCosts(sql: BoundableSql, hour: string): Promise<HourCosts> {
  const end = new Date(Date.parse(hour) + 3_600_000).toISOString();
  const rows = await boundedQuery(sql, { operation: "cp_log_costs.hourAggregate", callClass: "PAGE" },
    HOUR_COSTS_SQL, [hour, end]) as Record<string, unknown>[];
  const row = rows[0] ?? {};
  return {
    spendUsd: Number(row.spend_usd ?? 0), unpricedCharges: Number(row.unpriced ?? 0),
    paidJobsEnded: Number(row.paid_jobs_ended ?? 0), paidJobsEndedEmpty: Number(row.paid_jobs_ended_empty ?? 0),
  };
}

/** Spend over facts; null when either is unknown or no fact went live. */
export function costPerFact(spendUsd: number | null, factsLive: number | null): number | null {
  if (spendUsd === null || factsLive === null || factsLive <= 0) return null;
  return Math.round((spendUsd / factsLive) * 1e6) / 1e6;
}

/** The control plane's callers, largest first, top `top` plus "other". Reader-database reads are not in this total. */
export function controlPlaneByCaller(hour: NeonBytesHour, top = 20): Record<string, number> {
  const ranked = Object.entries(hour.byCaller).filter(([caller]) => caller !== "other" && !caller.startsWith("reader: "))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out: Record<string, number> = Object.fromEntries(ranked.slice(0, top));
  // A child's truncated "other" mixes both databases; the database total preserves its control-plane share.
  const rest = hour.bytes["control-plane"] - Object.values(out).reduce((total, bytes) => total + bytes, 0);
  if (rest > 0) out.other = rest;
  return out;
}

export function composeVitalSignsRow(input: {
  readonly accounting: NeonBytesHour;
  readonly costs: HourCosts | null;
  readonly releaseSha: string | null;
  readonly writtenAt: string;
}): VitalSignsRow {
  const counters = input.accounting.counters ?? {};
  const counted = (name: string): number | null => (name in counters ? counters[name]! : null);
  const factsLive = counted(VITAL_COUNTERS.factsLive);
  const spendUsd = input.costs?.spendUsd ?? null;
  return {
    hour: input.accounting.hour,
    factsLive,
    factsConfirmed: counted(VITAL_COUNTERS.factsConfirmed),
    factsSampled: counted(VITAL_COUNTERS.factsSampled),
    spendUsd,
    unpricedCharges: input.costs?.unpricedCharges ?? null,
    costPerFactUsd: costPerFact(spendUsd, factsLive),
    neonBytesRead: input.accounting.bytes["control-plane"],
    neonBytesByCaller: controlPlaneByCaller(input.accounting),
    roundsFinished: counted(VITAL_COUNTERS.roundsFinished) ?? 0,
    roundsKilled: counted(VITAL_COUNTERS.roundsKilled) ?? 0,
    roundsDeferred: counted(VITAL_COUNTERS.roundsDeferred) ?? 0,
    paidJobsEndedEmpty: input.costs?.paidJobsEndedEmpty ?? null,
    paidJobsEnded: input.costs?.paidJobsEnded ?? null,
    releaseSha: input.releaseSha,
    writtenAt: input.writtenAt,
  };
}

/** Upsert by hour. `neon_project_bytes` is left to River. */
export const VITAL_SIGNS_UPSERT = `INSERT INTO ${VITAL_SIGNS_TABLE} (hour, facts_live, facts_confirmed, facts_sampled,
  spend_usd, unpriced_charges, cost_per_fact_usd, neon_bytes_read, neon_bytes_by_caller, rounds_finished, rounds_killed,
  rounds_deferred, paid_jobs_ended_empty, paid_jobs_ended, release_sha, written_at)
  VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16::timestamptz)
  ON CONFLICT (hour) DO UPDATE SET facts_live = EXCLUDED.facts_live, facts_confirmed = EXCLUDED.facts_confirmed,
  facts_sampled = EXCLUDED.facts_sampled, spend_usd = EXCLUDED.spend_usd, unpriced_charges = EXCLUDED.unpriced_charges,
  cost_per_fact_usd = EXCLUDED.cost_per_fact_usd, neon_bytes_read = EXCLUDED.neon_bytes_read,
  neon_bytes_by_caller = EXCLUDED.neon_bytes_by_caller, rounds_finished = EXCLUDED.rounds_finished,
  rounds_killed = EXCLUDED.rounds_killed, rounds_deferred = EXCLUDED.rounds_deferred,
  paid_jobs_ended_empty = EXCLUDED.paid_jobs_ended_empty, paid_jobs_ended = EXCLUDED.paid_jobs_ended,
  release_sha = EXCLUDED.release_sha, written_at = EXCLUDED.written_at`;

export type VitalSignsWrite = "WRITTEN" | "TABLE_NOT_INSTALLED";

/** One bounded upsert. Until River's schema creates the table, says so instead of failing the runner. */
export async function writeVitalSignsRow(sql: BoundableSql, row: VitalSignsRow): Promise<VitalSignsWrite> {
  try {
    await boundedQuery(sql, { operation: `${VITAL_SIGNS_TABLE}.upsert`, callClass: "POINT" }, VITAL_SIGNS_UPSERT, [
      row.hour, row.factsLive, row.factsConfirmed, row.factsSampled, row.spendUsd, row.unpricedCharges, row.costPerFactUsd,
      row.neonBytesRead, JSON.stringify(row.neonBytesByCaller), row.roundsFinished, row.roundsKilled, row.roundsDeferred,
      row.paidJobsEndedEmpty, row.paidJobsEnded, row.releaseSha, row.writtenAt,
    ], { bounds: CONTROL_PLANE_REQUEST_BOUNDS_MS });
    return "WRITTEN";
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return "TABLE_NOT_INSTALLED";
    throw error;
  }
}

function amount(value: number | null, format: (n: number) => string): string { return value === null ? "—" : format(value); }

/** The runner journal's line for one row. */
export function formatVitalSignsLine(row: VitalSignsRow, label: string): string {
  return `vital signs ${label} (hour from ${row.hour}): facts live ${amount(row.factsLive, String)}, ` +
    `spend ${amount(row.spendUsd, n => `$${n.toFixed(2)}`)} (${amount(row.unpricedCharges, String)} unpriced), ` +
    `cost per fact ${amount(row.costPerFactUsd, n => `$${n.toFixed(4)}`)}, ` +
    `control-plane bytes read ${(row.neonBytesRead / 1e9).toFixed(3)} GB, rounds ${row.roundsFinished} finished / ` +
    `${row.roundsKilled} killed / ${row.roundsDeferred} deferred, paid jobs ended empty ${amount(row.paidJobsEndedEmpty, String)} ` +
    `of ${amount(row.paidJobsEnded, String)}`;
}
