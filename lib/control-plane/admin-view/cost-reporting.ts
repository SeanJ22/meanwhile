/** Runner-side reporting. Admin receives these small measured summaries only. */
import { yesterdayWindow } from "./cost-reporting-view.ts";
export { dayInEastern, yesterdayWindow } from "./cost-reporting-view.ts";
import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { readFlow, type FlowRead } from "./flow-read.ts";

export interface FlowSummary { readonly week: FlowRead | null; readonly yesterday: FlowRead | null }
export interface BatchRoleSpend { readonly role: string; readonly mode: "batch" | "standard" | "unreported"; readonly usd: number | null; readonly charges: number; readonly unpriced: number }
export interface BatchSpend { readonly from: string; readonly through: string; readonly rows: readonly BatchRoleSpend[] }
/** The actual instrumentation start clips the window; pre-release days are unknown. */
export async function buildFlowSummary(sql: Sql, now: string, recordingSince: string | null): Promise<FlowSummary> {
  if (!recordingSince || !Number.isFinite(Date.parse(recordingSince))) return { week: null, yesterday: null };
  const week = { from: new Date(Date.parse(now) - 7 * 86_400_000).toISOString(), through: now };
  const read = (window: { from: string; through: string }) => readFlow({ control: sql, ...window, recordingSince }).catch(() => null);
  const [weekly, yesterday] = await Promise.all([read(week), read(yesterdayWindow(now))]);
  return { week: weekly, yesterday };
}

/** No absent batch flag is silently assigned to full-price requests. */
export const BATCH_SPEND_SQL = `SELECT record->>'role' AS role,
 CASE record->'cost'->>'batch' WHEN 'true' THEN 'batch' WHEN 'false' THEN 'standard' ELSE 'unreported' END AS mode,
 sum((record->'cost'->>'usd')::float8)::float8 AS usd, count(*)::int AS charges,
 count(*) FILTER (WHERE record->'cost'->>'usd' IS NULL)::int AS unpriced
 FROM cp_log_costs WHERE recorded_at >= $1::timestamptz AND recorded_at < $2::timestamptz
 AND record->>'role' <> 'DISCOVERY_SEARCH' AND (record->>'role' <> 'ACQUIRER' OR record->'cost'->>'usd' IS NOT NULL)
 GROUP BY 1, 2`;

export async function readBatchSpend(sql: Sql, now: string): Promise<BatchSpend> {
  const from = new Date(Date.parse(now) - 86_400_000).toISOString();
  const raw = await boundedQuery(sql, { operation: "costs.batch_summary", callClass: "PAGE" }, BATCH_SPEND_SQL, [from, now]);
  if (!Array.isArray(raw)) throw Error("BATCH_SPEND_UNREAD");
  const rows = (raw as readonly {role?: unknown;mode?:unknown;usd:unknown;charges:unknown;unpriced:unknown}[]).map(r => {
    const charges = Number(r.charges), unpriced = Number(r.unpriced), usd = r.usd === null ? null : Number(r.usd);
    if (!Number.isSafeInteger(charges) || charges < 0 || !Number.isSafeInteger(unpriced) || unpriced < 0 || unpriced > charges || (usd !== null && (!Number.isFinite(usd) || usd < 0))) throw Error("BATCH_SPEND_INVALID");
    return { role: String(r.role ?? ""), mode: r.mode === "batch" ? "batch" as const : r.mode === "standard" ? "standard" as const : "unreported" as const, usd: unpriced ? null : usd, charges, unpriced };
  });
  return { from, through: now, rows };
}
