import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { MODELS, canonicalModelId, modelTierFor } from "../../models.ts";
import type { DailyDatabaseTransferRead } from "../../db/transfer.ts";

/**
 * **admin-v6/spend@1 — WHAT THE AGENTS COST, BY MODEL TIER, BY DAY AND BY MONTH, AND WHAT THE DATABASE SENT.**
 *
 * One bounded aggregate over the last twelve Eastern months of the cost ledger: per month, and for the last 14 days
 * per Eastern day, per model, priced dollars. A second one ranks the costliest pieces of work. A charge split across
 * models (`byModel`) is counted at each model's own share; a row that names no model falls back to its attempt's
 * recorded model; a row with neither is "model not recorded", never guessed. Search is the ledger's DISCOVERY_SEARCH
 * rows, kept apart from model money. Nothing here invents a figure: a day with no rows is absent, and a price the
 * ledger never had is counted beside as unpriced.
 *
 * Database transfer is S6's daily counter (`readDailyDatabaseTransfer`), passed in. Until its migration is applied
 * it reads "not recorded yet", never zero.
 */
export const ADMIN_V6_SPEND_CONTRACT = "admin-v6/spend@1" as const;
export const SPEND_DAYS = 14;
export const SPEND_MONTHS = 12;
export const WORK_LIMIT = 15;

export type TierKey = "haiku" | "sonnet" | "opus" | "older" | "unrecorded";
export interface TierSpend { readonly key: string; readonly tier: TierKey; readonly name: string; readonly usd: number; readonly requests: number }
export interface DaySpend { readonly day: string; readonly anthropicUsd: number; readonly searchUsd: number; readonly byModel: readonly { readonly name: string; readonly usd: number }[]; readonly rows: number }
export interface MonthSpend { readonly month: string; readonly anthropicUsd: number; readonly searchUsd: number; readonly byTier: readonly { readonly name: string; readonly usd: number }[]; readonly rows: number }
/** One piece of work and what its paid tries cost. Structurally `WorkCost` in app/(admin)/_mw/admin-v6/model.ts. */
export interface WorkCost {
  readonly work: string;
  readonly models: string;
  readonly tries: number;
  readonly costUsd: number | null;
  readonly movedUpWhy: string;
  readonly benefit: string;
  /** The place keys this work serves, so a place view shows the work that covers it. */
  readonly applies: readonly string[];
}
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
  /** Newest first. The first row is the month in progress. */
  readonly byMonth: readonly MonthSpend[];
  /** The costliest work over the same days, costliest first. */
  readonly work: readonly WorkCost[];
  readonly anthropicUsd: number;
  readonly searchUsd: number;
  readonly unpricedRows: number;
  readonly neon: NeonTransfer;
}

/** `day` is null for a row older than the day window: it counts toward its month and nothing else. */
export interface SpendRowRaw { readonly month: string; readonly day: string | null; readonly role: string; readonly model: string | null; readonly usd: number | null; readonly n: number }

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

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function spendView(rows: readonly SpendRowRaw[], neon: NeonTransfer, work: readonly WorkCost[] = []): AdminV6SpendView {
  const tiers = new Map<string, { label: ReturnType<typeof modelLabel>; usd: number; n: number }>();
  const days = new Map<string, { anthropic: number; search: number; byModel: Map<string, number>; rows: number }>();
  const months = new Map<string, { anthropic: number; search: number; byTier: Map<string, { name: string; usd: number }>; rows: number }>();
  let unpriced = 0;
  for (const r of rows) {
    if (r.usd === null) { if (r.day !== null) unpriced += r.n; continue; }
    if (r.usd <= 0) continue;
    const label = modelLabel(r.model);
    const mo = months.get(r.month) ?? { anthropic: 0, search: 0, byTier: new Map(), rows: 0 };
    mo.rows += r.n;
    if (r.role === "DISCOVERY_SEARCH") mo.search += r.usd;
    else {
      mo.anthropic += r.usd;
      const t = mo.byTier.get(label.key) ?? { name: label.name, usd: 0 };
      t.usd += r.usd;
      mo.byTier.set(label.key, t);
    }
    months.set(r.month, mo);
    if (r.day === null) continue;
    const d = days.get(r.day) ?? { anthropic: 0, search: 0, byModel: new Map(), rows: 0 };
    d.rows += r.n;
    if (r.role === "DISCOVERY_SEARCH") d.search += r.usd;
    else {
      d.anthropic += r.usd;
      d.byModel.set(label.name, (d.byModel.get(label.name) ?? 0) + r.usd);
      const t = tiers.get(label.key) ?? { label, usd: 0, n: 0 };
      t.usd += r.usd; t.n += r.n;
      tiers.set(label.key, t);
    }
    days.set(r.day, d);
  }
  const order: Record<TierKey, number> = { haiku: 0, sonnet: 1, opus: 2, older: 3, unrecorded: 4 };
  const byTier = [...tiers.entries()].map(([key, t]): TierSpend => ({ key, tier: t.label.tier, name: t.label.name, usd: r4(t.usd), requests: t.n }))
    .sort((a, b) => order[a.tier] - order[b.tier] || b.usd - a.usd);
  const byDay = [...days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, d]): DaySpend => ({ day, anthropicUsd: r4(d.anthropic), searchUsd: r4(d.search), rows: d.rows,
    byModel: [...d.byModel.entries()].map(([name, usd]) => ({ name, usd: r4(usd) })).sort((a, b) => b.usd - a.usd) }));
  const byMonth = [...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, m]): MonthSpend => ({ month, anthropicUsd: r4(m.anthropic), searchUsd: r4(m.search), rows: m.rows,
    byTier: [...m.byTier.values()].map((t) => ({ name: t.name, usd: r4(t.usd) })).sort((a, b) => b.usd - a.usd) }));
  return { windowDays: SPEND_DAYS, byTier, byDay, byMonth, work, anthropicUsd: r4(byDay.reduce((n, d) => n + d.anthropicUsd, 0)), searchUsd: r4(byDay.reduce((n, d) => n + d.searchUsd, 0)),
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
  SELECT to_char(c.recorded_at AT TIME ZONE 'America/New_York', 'YYYY-MM') AS month,
    CASE WHEN c.recorded_at > now() - ($1::int * interval '1 day') THEN to_char((c.recorded_at AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') END AS day,
    c.record->>'role' AS role, c.record->'byModel' AS by_model, c.record->>'model' AS row_model, (c.record->'cost'->>'usd')::float8 AS usd, c.record->>'attemptId' AS attempt_id
  FROM cp_log_costs c
  WHERE c.recorded_at >= ((date_trunc('month', now() AT TIME ZONE 'America/New_York') - ($2::int - 1) * interval '1 month') AT TIME ZONE 'America/New_York')
) SELECT month, day, role, model, sum(usd) AS usd, count(*)::int AS n FROM (
  SELECT r.month, r.day, r.role, COALESCE(m->>'model', r.row_model, a.value->'worker'->>'version') AS model, COALESCE((m->>'usd')::float8, r.usd) AS usd
  FROM rows r LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.by_model) = 'array' THEN r.by_model END) m ON true
  LEFT JOIN cp_attempts a ON a.id = r.attempt_id
) x WHERE x.role <> 'ACQUIRER' OR x.usd IS NOT NULL GROUP BY 1, 2, 3, 4`;

/** The costliest pieces of work in the day window: paid model charges grouped by the obligation they served, with what their results said. */
export const WORK_SQL = `WITH rows AS (
  SELECT COALESCE(c.record->>'obligationId', c.record->>'workItemId', c.record->>'routeId') AS work, c.record->>'jurisdiction' AS jur,
    c.record->'byModel' AS by_model, c.record->>'model' AS row_model, (c.record->'cost'->>'usd')::float8 AS usd, c.record->>'attemptId' AS attempt_id
  FROM cp_log_costs c WHERE c.recorded_at > now() - ($1::int * interval '1 day') AND c.record->>'role' NOT IN ('DISCOVERY_SEARCH', 'ACQUIRER')
), exp AS (
  SELECT r.work, r.jur, r.attempt_id, COALESCE(m->>'model', r.row_model, a.value->'worker'->>'version') AS model, COALESCE((m->>'usd')::float8, r.usd) AS usd
  FROM rows r LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.by_model) = 'array' THEN r.by_model END) m ON true
  LEFT JOIN cp_attempts a ON a.id = r.attempt_id WHERE r.work IS NOT NULL
), top AS (
  SELECT work, max(jur) AS jur, sum(usd) AS usd, bool_or(usd IS NULL) AS unpriced, count(DISTINCT attempt_id)::int AS tries,
    array_agg(DISTINCT model) FILTER (WHERE model IS NOT NULL) AS models, array_agg(DISTINCT attempt_id) FILTER (WHERE attempt_id IS NOT NULL) AS attempts
  FROM exp GROUP BY work ORDER BY sum(usd) DESC NULLS LAST LIMIT $2::int
) SELECT t.work, t.jur, t.usd, t.unpriced, t.tries, t.models, o.outcomes, COALESCE(o.refused, 0) AS refused
FROM top t LEFT JOIN LATERAL (
  SELECT array_agg(DISTINCT s.record->>'outcome') AS outcomes,
    count(*) FILTER (WHERE jsonb_typeof(s.record->'refusal') = 'array' AND jsonb_array_length(s.record->'refusal') > 0)::int AS refused
  FROM cp_log_scout_results s WHERE s.record->>'attemptId' = ANY(t.attempts)
) o ON true ORDER BY t.usd DESC NULLS LAST`;

export interface WorkRowRaw {
  readonly work: string; readonly jurisdiction: string | null; readonly usd: number | null; readonly unpriced: boolean; readonly tries: number;
  readonly models: readonly string[]; readonly outcomes: readonly string[]; readonly refused: number;
}

const OUTCOME_WORDS: Readonly<Record<string, string>> = {
  EVIDENCE_FOUND: "Found the record", ROUTE_CANDIDATE: "Found a route in", NEEDS_ADAPTER: "Needs a software reader", BLOCKED: "Blocked by the source",
  HUMAN_REQUIRED: "Needs a person", NO_PROGRESS: "Nothing yet",
};
const TIER_ORDER: readonly TierKey[] = ["haiku", "sonnet", "opus", "older", "unrecorded"];
const titleCase = (slug: string) => slug.replace(/^(city|town|county|village|borough|township)-of-/, "$1 of ").replaceAll("-", " ").replaceAll("_", " ")
  .replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Of|And|The)\b/g, (m) => m.toLowerCase());

/** A readable name for work by its obligation: the jurisdiction's own name and the kind of record (`...:az:city:city-of-phoenix#campaign-finance-0`). */
export function workName(work: string, jurisdiction: string | null): string {
  if (/^scout-prewarm/.test(work) || /#?scout:prewarm/.test(work)) return "Hourly prompt-cache warm-up (no place)";
  const family = /#([a-z0-9:_-]+?)(?:-\d+)?$/.exec(work)?.[1];
  const jur = jurisdiction ?? /(?:^|:)([a-z]{2}:[a-z_]+:[a-z0-9-]+)/.exec(work)?.[1] ?? null;
  const parts = jur?.split(":") ?? [];
  const place = parts.length >= 3 ? `${titleCase(parts[2])}, ${parts[0].toUpperCase()}` : parts.length === 1 && parts[0] ? parts[0].toUpperCase() : null;
  const kind = family ? family.replaceAll("-", " ").replaceAll("_", " ").replaceAll(":", " · ") : null;
  return place && kind ? `${place} · ${kind}` : place ?? kind ?? work.slice(0, 80);
}

export function workCosts(rows: readonly WorkRowRaw[]): readonly WorkCost[] {
  return rows.map((r): WorkCost => {
    const tiers = [...new Map(r.models.map((m) => [modelLabel(m).key, modelLabel(m)] as const)).values()]
      .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.name.localeCompare(b.name));
    const outcomes = [...new Set(r.outcomes.map((o) => OUTCOME_WORDS[o]).filter((w): w is string => !!w))];
    const state = r.jurisdiction && /^[a-z]{2}:/.test(r.jurisdiction) ? r.jurisdiction.slice(0, 2) : null;
    return {
      work: workName(r.work, r.jurisdiction), models: tiers.map((t) => t.name).join(" → ") || "Model not recorded", tries: r.tries,
      costUsd: r.unpriced || r.usd === null ? null : r4(r.usd),
      movedUpWhy: tiers.length > 1 ? `Started on ${tiers[0].name} and moved up to ${tiers[tiers.length - 1].name}; the reason isn’t saved on the charge` : "Stayed on the same AI",
      benefit: outcomes.length ? outcomes.join(", ") : r.refused > 0 ? "Its finish was refused" : "No result recorded",
      applies: state ? [`st:${state}`] : [],
    };
  });
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];

export async function readSpend(sql: Sql, transfer: DailyDatabaseTransferRead | null): Promise<AdminV6SpendView> {
  const [raw, workRaw] = await Promise.all([
    boundedQuery(sql, { operation: "cp_log_costs.spend_by_month_day_and_model", callClass: "PAGE" }, SPEND_SQL, [SPEND_DAYS, SPEND_MONTHS]) as Promise<readonly Record<string, unknown>[]>,
    boundedQuery(sql, { operation: "cp_log_costs.costliest_work", callClass: "PAGE" }, WORK_SQL, [SPEND_DAYS, WORK_LIMIT]) as Promise<readonly Record<string, unknown>[]>,
  ]);
  const work = workCosts(workRaw.map((r): WorkRowRaw => ({ work: String(r.work), jurisdiction: typeof r.jur === "string" ? r.jur : null,
    usd: r.usd === null || r.usd === undefined ? null : Number(r.usd), unpriced: r.unpriced === true, tries: Number(r.tries) || 0,
    models: strings(r.models), outcomes: strings(r.outcomes), refused: Number(r.refused) || 0 })));
  return spendView(raw.map((r) => ({ month: String(r.month), day: typeof r.day === "string" ? r.day : null, role: String(r.role ?? ""), model: typeof r.model === "string" ? r.model : null,
    usd: r.usd === null || r.usd === undefined ? null : Number(r.usd), n: Number(r.n) || 0 })), neonTransferOf(transfer), work);
}
