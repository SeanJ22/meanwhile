/** Sean's hourly record: Now and the brief read cp_vital_signs only. */
import { neon } from "@neondatabase/serverless";
import { controlPlaneUrlFromEnv, type Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
export interface CallerBytes { readonly caller: string; readonly bytes: number }
export interface HourlyVitalSigns {
  readonly hour: string; readonly writtenAt: string;
  readonly factsLive: number | null; readonly factsConfirmed: number | null; readonly factsSampled: number | null;
  readonly settledSpendUsd: number | null; readonly unpricedCharges: number | null; readonly costPerFactUsd: number | null;
  readonly neonBytesRead: number | null; readonly neonBytesByCaller: readonly CallerBytes[] | null; readonly neonProjectBytes: number | null;
  readonly roundsFinished: number | null; readonly roundsKilled: number | null; readonly roundsDeferred: number | null;
  readonly paidJobsEndedEmpty: number | null; readonly paidJobsEnded: number | null; readonly releaseSha: string | null;
}
export interface HourSlot { readonly hour: string; readonly row: HourlyVitalSigns | null }
export interface VitalSignsReading { readonly hours: readonly HourSlot[] }
export const VITAL_SIGNS_SQL = `SELECT hour, written_at, facts_live, facts_confirmed, facts_sampled,
 spend_usd, unpriced_charges, cost_per_fact_usd, neon_bytes_read, neon_bytes_by_caller,
 neon_project_bytes, rounds_finished, rounds_killed, rounds_deferred, paid_jobs_ended_empty,
 paid_jobs_ended, release_sha FROM cp_vital_signs
 WHERE hour >= $1::timestamptz AND hour < $2::timestamptz
 AND written_at >= hour + interval '1 hour'
 ORDER BY hour DESC LIMIT $3`;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const instant = (v: unknown): string | null => {
  const n = v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};
/** Neon returns numeric/bigint columns as strings. Never turn absence or malformed values into zero. */
function number(v: unknown, integer = false): number | null | undefined {
  if (v === null) return null;
  if (typeof v !== "number" && (typeof v !== "string" || !/^\d+(?:\.\d+)?$/.test(v))) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && (!integer || Number.isSafeInteger(n)) ? n : undefined;
}
function callers(v: unknown): readonly CallerBytes[] | null | undefined {
  if (v === null) return null;
  // The writer's compact JSON map: caller tag -> measured response bytes.
  if (!object(v) || Object.keys(v).length > 21) return undefined;
  const rows: CallerBytes[] = [];
  for (const [caller, value] of Object.entries(v)) {
    const bytes = number(value, true);
    if (!caller.trim() || caller.length > 240 || bytes == null) return undefined;
    rows.push({caller, bytes});
  }
  return rows;
}
export function vitalSignsRow(v: unknown): HourlyVitalSigns | null {
  if (!object(v)) return null;
  const hour = instant(v.hour), writtenAt = instant(v.written_at);
  if (!hour || !writtenAt || Date.parse(hour) % 3_600_000 !== 0 || Date.parse(writtenAt) < Date.parse(hour) + 3_600_000) return null;
  const fields = {
    factsLive: number(v.facts_live, true), factsConfirmed: number(v.facts_confirmed, true), factsSampled: number(v.facts_sampled, true),
    settledSpendUsd: number(v.spend_usd), unpricedCharges: number(v.unpriced_charges, true), costPerFactUsd: number(v.cost_per_fact_usd),
    neonBytesRead: number(v.neon_bytes_read, true), neonProjectBytes: number(v.neon_project_bytes, true),
    roundsFinished: number(v.rounds_finished, true), roundsKilled: number(v.rounds_killed, true), roundsDeferred: number(v.rounds_deferred, true),
    paidJobsEndedEmpty: number(v.paid_jobs_ended_empty, true), paidJobsEnded: number(v.paid_jobs_ended, true),
  };
  const byCaller = callers(v.neon_bytes_by_caller);
  if (Object.values(fields).some(n => n === undefined) || byCaller === undefined || v.release_sha !== null && typeof v.release_sha !== "string") return null;
  const row = fields as Omit<HourlyVitalSigns, "hour"|"writtenAt"|"neonBytesByCaller"|"releaseSha">;
  if (row.factsConfirmed !== null && row.factsSampled !== null && row.factsConfirmed > row.factsSampled) return null;
  if (row.paidJobsEndedEmpty !== null && row.paidJobsEnded !== null && row.paidJobsEndedEmpty > row.paidJobsEnded) return null;
  const priced = row.unpricedCharges === 0 && row.settledSpendUsd !== null;
  const costKnown = priced && row.factsLive !== null && row.factsLive > 0;
  if (row.costPerFactUsd !== null && (!costKnown || Math.abs(row.costPerFactUsd - row.settledSpendUsd! / row.factsLive!) > .000001)) return null;
  return {...row, hour, writtenAt, neonBytesByCaller:byCaller, releaseSha:v.release_sha as string|null,
    settledSpendUsd:priced ? row.settledSpendUsd : null, costPerFactUsd:costKnown ? row.costPerFactUsd : null};
}
/** Exactly one indexed, bounded read. Excludes this running hour and crash-left partial rows. */
export async function readHourlyVitalSigns(sql: Sql, at: string, count: 2 | 24): Promise<VitalSignsReading> {
  const through = Math.floor(Date.parse(at) / 3_600_000) * 3_600_000;
  if (!Number.isFinite(through) || count !== 2 && count !== 24) throw new Error("Invalid hourly window");
  const from = through - count * 3_600_000;
  const saved = await boundedQuery(sql, {operation:"cp_vital_signs.admin_hours",callClass:"PAGE"}, VITAL_SIGNS_SQL,
    [new Date(from).toISOString(),new Date(through).toISOString(),count]) as unknown[];
  const rows = new Map(saved.map(vitalSignsRow).filter((r): r is HourlyVitalSigns => r !== null).map(row => [row.hour,row]));
  return {hours:Array.from({length:count},(_,i)=>{const hour=new Date(through-(i+1)*3_600_000).toISOString();return {hour,row:rows.get(hour)??null};})};
}
export async function readVitalSignsFromEnv(at: string, count: 2 | 24): Promise<VitalSignsReading | null> {
  const url = controlPlaneUrlFromEnv();
  return url ? readHourlyVitalSigns(neon(url) as Sql, at, count) : null;
}
