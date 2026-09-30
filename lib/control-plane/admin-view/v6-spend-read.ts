import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { MODELS, canonicalModelId, modelTierFor } from "../../models.ts";
import type { DailyDatabaseTransferRead } from "../../db/transfer.ts";

/**
 * **admin-v6/spend@1 — WHAT THE AGENTS COST, BY MODEL TIER AND BY DAY, AND WHAT THE DATABASE SENT.**
 *
 * One bounded aggregate over the last 14 days of the cost ledger: per Eastern day, per model, priced dollars.
 * A charge split across models (`byModel`) is counted at each model's own share; a row that names no model falls
 * back to its attempt's recorded model; a row with neither is "model not recorded", never guessed. Search is the
 * ledger's DISCOVERY_SEARCH rows, kept apart from model money. Nothing here invents a figure: a day with no rows is
 * absent, and a price the ledger never had is counted beside as unpriced.
 *
 * Database transfer is S6's daily counter (`readDailyDatabaseTransfer`), passed in. Until its migration is applied
 * it reads "not recorded yet", never zero.
 */
export const ADMIN_V6_SPEND_CONTRACT = "admin-v6/spend@1" as const;
export const SPEND_DAYS = 14;

export type TierKey = "haiku" | "sonnet" | "opus" | "older" | "unrecorded";
export interface TierSpend { readonly key: string; readonly tier: TierKey; readonly name: string; readonly usd: number; readonly requests: number }
export interface DaySpend { readonly day: string; readonly anthropicUsd: number; readonly searchUsd: number; readonly byModel: readonly { readonly name: string; readonly usd: number }[]; readonly rows: number }
export interface NeonTransfer {
  readonly kind: "recorded" | "not-recorded";
  readonly detail: string | null;
  readonly days: readonly { readonly day: string; readonly responseBytes: number; readonly requestBytes: number; readonly requests: number }[];
}
/** Structurally `SpendView` in app/(admin)/_mw/admin-v6/model.ts. */
export interface AdminV6SpendView {
  readonly windowDays: number;
  readonly byTier: readonly TierSpend[];
  readonly byDay: readonly DaySpend[];
  readonly anthropicUsd: number;
  readonly searchUsd: number;
  readonly unpricedRows: number;
  readonly neon: NeonTransfer;
}

export interface SpendRowRaw { readonly day: string; readonly role: string; readonly model: string | null; readonly usd: number | null; readonly n: number }

/** The model as Admin names it: a current tier by its catalog name, an older one by its family with "(older)", else unrecorded. */
export function modelLabel(id: string | null): { readonly key: string; readonly tier: TierKey; readonly name: string } {
  if (id === null || !/claude/i.test(id)) return { key: "unrecorded", tier: "unrecorded", name: "Model not recorded" };
  const current = modelTierFor(canonicalModelId(id));
  if (current) return { key: current, tier: current, name: MODELS[current].name };
  const family = /haiku/i.test(id) ? "Haiku" : /sonnet/i.test(id) ? "Sonnet" : /opus/i.test(id) ? "Opus" : null;
  const version = /(\d+(?:-\d+)?)/.exec(id.replace(/-\d{8}$/, ""))?.[1]?.replace("-", ".") ?? "";
  return family ? { key: `older:${family.toLowerCase()}:${version}`, tier: "older", name: `${family} ${version} (older, no longer used)`.replace("  ", " ") }
    : { key: "unrecorded", tier: "unrecorded", name: "Model not recorded" };
}

export function spendView(rows: readonly SpendRowRaw[], neon: NeonTransfer): AdminV6SpendView {
  const tiers = new Map<string, { label: ReturnType<typeof modelLabel>; usd: number; n: number }>();
  const days = new Map<string, { anthropic: number; search: number; byModel: Map<string, number>; rows: number }>();
  let unpriced = 0;
  for (const r of rows) {
    if (r.usd === null) { unpriced += r.n; continue; }
    if (r.usd <= 0) continue;
    const d = days.get(r.day) ?? { anthropic: 0, search: 0, byModel: new Map(), rows: 0 };
    d.rows += r.n;
    if (r.role === "DISCOVERY_SEARCH") d.search += r.usd;
    else {
      const label = modelLabel(r.model);
      d.anthropic += r.usd;
      d.byModel.set(label.name, (d.byModel.get(label.name) ?? 0) + r.usd);
      const t = tiers.get(label.key) ?? { label, usd: 0, n: 0 };
      t.usd += r.usd; t.n += r.n;
      tiers.set(label.key, t);
    }
    days.set(r.day, d);
  }
  const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
  const order: Record<TierKey, number> = { haiku: 0, sonnet: 1, opus: 2, older: 3, unrecorded: 4 };
  const byTier = [...tiers.entries()].map(([key, t]): TierSpend => ({ key, tier: t.label.tier, name: t.label.name, usd: r4(t.usd), requests: t.n }))
    .sort((a, b) => order[a.tier] - order[b.tier] || b.usd - a.usd);
  const byDay = [...days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, d]): DaySpend => ({ day, anthropicUsd: r4(d.anthropic), searchUsd: r4(d.search), rows: d.rows,
    byModel: [...d.byModel.entries()].map(([name, usd]) => ({ name, usd: r4(usd) })).sort((a, b) => b.usd - a.usd) }));
  return { windowDays: SPEND_DAYS, byTier, byDay, anthropicUsd: r4(byDay.reduce((n, d) => n + d.anthropicUsd, 0)), searchUsd: r4(byDay.reduce((n, d) => n + d.searchUsd, 0)),
    unpricedRows: unpriced, neon };
}

export function neonTransferOf(read: DailyDatabaseTransferRead | null): NeonTransfer {
  if (read === null) return { kind: "not-recorded", detail: "The daily database transfer could not be read just now, so it is unknown, not zero.", days: [] };
  if (read.kind === "NOT_INSTALLED") return { kind: "not-recorded", detail: read.detail, days: [] };
  const by = new Map<string, { responseBytes: number; requestBytes: number; requests: number }>();
  for (const row of read.rows) {
    const d = by.get(row.day) ?? { responseBytes: 0, requestBytes: 0, requests: 0 };
    d.responseBytes += row.responseBytes; d.requestBytes += row.requestBytes; d.requests += row.requests;
    by.set(row.day, d);
  }
  return { kind: "recorded", detail: null, days: [...by.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, d]) => ({ day, ...d })) };
}

export const SPEND_SQL = `WITH rows AS (
  SELECT to_char((c.recorded_at AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') AS day, c.record->>'role' AS role,
    c.record->'byModel' AS by_model, (c.record->'cost'->>'usd')::float8 AS usd, c.record->>'attemptId' AS attempt_id
  FROM cp_log_costs c WHERE c.recorded_at > now() - ($1::int * interval '1 day')
) SELECT day, role, model, sum(usd) AS usd, count(*)::int AS n FROM (
  SELECT r.day, r.role, COALESCE(m->>'model', a.value->'worker'->>'version') AS model, COALESCE((m->>'usd')::float8, r.usd) AS usd
  FROM rows r LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.by_model) = 'array' THEN r.by_model END) m ON true
  LEFT JOIN cp_attempts a ON a.id = r.attempt_id
) x WHERE x.role <> 'ACQUIRER' OR x.usd IS NOT NULL GROUP BY 1, 2, 3`;

export async function readSpend(sql: Sql, transfer: DailyDatabaseTransferRead | null): Promise<AdminV6SpendView> {
  const raw = await boundedQuery(sql, { operation: "cp_log_costs.spend_by_day_and_model", callClass: "PAGE" }, SPEND_SQL, [SPEND_DAYS]) as readonly Record<string, unknown>[];
  return spendView(raw.map((r) => ({ day: String(r.day), role: String(r.role ?? ""), model: typeof r.model === "string" ? r.model : null,
    usd: r.usd === null || r.usd === undefined ? null : Number(r.usd), n: Number(r.n) || 0 })), neonTransferOf(transfer));
}
