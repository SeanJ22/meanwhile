import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { MODELS, canonicalModelId, modelTierFor } from "../../models.ts";
import type { DailyDatabaseTransferRead } from "../../db/transfer.ts";
import { MODEL_SPEND_SQL, MODEL_LIVE_FACTS_SQL, modelSpendView, type ModelSpendRaw, type ModelSpendView } from "./model-spend.ts";
import { HUNT_COST_DAYS, HUNT_COST_SQL, HUNT_FACTS_SQL, huntCostView, type HuntCostView } from "../../hunt/cost-per-fact.ts";

/** A row naming no model falls back to its attempt's model, else "model not recorded". A day with no rows is absent; unpriced charges are counted apart. */
export const ADMIN_V6_SPEND_CONTRACT = "admin-v6/spend@1" as const;
export const SPEND_DAYS = 31;
export const WORK_DAYS = 14;
export const SPEND_MONTHS = 12;
export const WORK_LIMIT = 15;

export type TierKey = "haiku" | "sonnet" | "opus" | "older" | "unrecorded";
export interface TierSpend { readonly key: string; readonly tier: TierKey; readonly name: string; readonly usd: number; readonly requests: number }
export interface DaySpend { readonly day: string; readonly anthropicUsd: number; readonly searchUsd: number; readonly byModel: readonly { readonly name: string; readonly usd: number }[]; readonly rows: number }
export interface MonthSpend { readonly month: string; readonly anthropicUsd: number; readonly searchUsd: number; readonly byTier: readonly { readonly name: string; readonly usd: number }[]; readonly rows: number }
export interface WorkCost {
  readonly work: string;
  readonly models: string;
  readonly tries: number;
  readonly costUsd: number | null;
  readonly movedUpWhy: string;
  readonly benefit: string;
  readonly applies: readonly string[];
}
export interface ScoutOutcomeLine { readonly recordClass: string; readonly found: number; readonly route: number; readonly total: number }
export interface NeonTransfer {
  readonly readerReads?: readonly { readonly day: string; readonly route: string; readonly read: string;
    readonly requests: number; readonly requestBytes: number; readonly responseBytes: number }[];
  readonly kind: "recorded" | "not-recorded";
  readonly detail: string | null;
  readonly days: readonly { readonly day: string; readonly responseBytes: number; readonly requestBytes: number; readonly requests: number }[];
}
/** Structurally `SpendView` in app/(admin)/_mw/admin-v6/model.ts. */
export interface AdminV6SpendView {
  readonly modelSpend?: ModelSpendView | null;
  readonly huntCost?: HuntCostView | null;
  readonly windowDays: number;
  readonly byTier: readonly TierSpend[];
  readonly byDay: readonly DaySpend[];
  readonly byMonth: readonly MonthSpend[];
  readonly work: readonly WorkCost[];
  readonly anthropicUsd: number;
  readonly searchUsd: number;
  readonly unpricedRows: number;
  readonly neon: NeonTransfer;
  readonly last24h?: { readonly modelUsd: number; readonly unpricedRows: number } | null;
  readonly readAt?: string;
  readonly scoutOutcomes?: readonly ScoutOutcomeLine[] | null;
  readonly setAsideUsd?: number | null;
  readonly dailyLimitUsd?: number | null;
  readonly huntersNow?: number | null;
  readonly worstCaseCharges?: number | null;
}

/** `day` is null for a row older than the day window: it counts toward its month and nothing else. */
export interface SpendRowRaw { readonly month: string; readonly day: string | null; readonly role: string; readonly model: string | null; readonly usd: number | null; readonly n: number }

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
  const readerReads = read.rows.filter(row => row.database === "reader" && row.client === "reader")
    .flatMap(row => Object.entries(row.reads ?? {}).map(([key, [requests, requestBytes, responseBytes]]) => {
      const [route, ...parts] = key.split("\t");
      return { day: row.day, route, read: parts.join("\t"), requests, requestBytes, responseBytes };
    })).sort((a, b) => b.day.localeCompare(a.day) || b.responseBytes - a.responseBytes);
  return { kind: "recorded", detail: null, readerReads,
    days: [...by.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, d]) => ({ day, ...d })) };
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

export const ROLLING_SQL = `SELECT coalesce(sum(usd) FILTER (WHERE role <> 'DISCOVERY_SEARCH'), 0)::float8 AS model_usd,
  count(*) FILTER (WHERE usd IS NULL AND role NOT IN ('DISCOVERY_SEARCH', 'ACQUIRER'))::int AS unpriced
FROM (SELECT c.record->>'role' AS role, (c.record->'cost'->>'usd')::float8 AS usd FROM cp_log_costs c WHERE c.recorded_at > now() - interval '24 hours') x`;

export const OUTCOMES_SQL = `SELECT s.record->>'recordClass' AS record_class, s.record->>'outcome' AS outcome, count(*)::int AS n
FROM cp_log_scout_results s WHERE s.recorded_at > now() - interval '24 hours' GROUP BY 1, 2`;

export function scoutOutcomeLines(rows: readonly { readonly recordClass: string | null; readonly outcome: string | null; readonly n: number }[]): readonly ScoutOutcomeLine[] {
  const by = new Map<string, { found: number; route: number; total: number }>();
  for (const r of rows) {
    const key = r.recordClass ?? "unrecorded";
    const line = by.get(key) ?? { found: 0, route: 0, total: 0 };
    line.total += r.n;
    if (r.outcome === "EVIDENCE_FOUND") line.found += r.n;
    else if (r.outcome === "ROUTE_CANDIDATE") line.route += r.n;
    by.set(key, line);
  }
  return [...by].map(([recordClass, l]) => ({ recordClass, ...l })).sort((a, b) => b.total - a.total || a.recordClass.localeCompare(b.recordClass));
}

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
  const [raw, workRaw, rolling, outcomes, modelRaw, factsRaw, huntCostRaw, huntFactsRaw] = await Promise.all([
    boundedQuery(sql, { operation: "cp_log_costs.spend_by_month_day_and_model", callClass: "PAGE" }, SPEND_SQL, [SPEND_DAYS, SPEND_MONTHS]) as Promise<readonly Record<string, unknown>[]>,
    boundedQuery(sql, { operation: "cp_log_costs.costliest_work", callClass: "PAGE" }, WORK_SQL, [WORK_DAYS, WORK_LIMIT]) as Promise<readonly Record<string, unknown>[]>,
    (boundedQuery(sql, { operation: "cp_log_costs.rolling_24h_model_spend", callClass: "PAGE" }, ROLLING_SQL, []) as Promise<readonly Record<string, unknown>[]>).catch(() => null),
    (boundedQuery(sql, { operation: "cp_log_scout_results.outcomes_24h", callClass: "PAGE" }, OUTCOMES_SQL, []) as Promise<readonly Record<string, unknown>[]>).catch(() => null),
    (boundedQuery(sql, { operation: "cp_log_costs.model_spend_by_day_role", callClass: "PAGE" }, MODEL_SPEND_SQL, [SPEND_DAYS]) as Promise<readonly Record<string, unknown>[]>).catch(() => null),
    (boundedQuery(sql, { operation: "cp_log_owner_digests.live_facts_by_day", callClass: "PAGE" }, MODEL_LIVE_FACTS_SQL, [SPEND_DAYS]) as Promise<readonly Record<string, unknown>[]>).catch(() => null),
    (boundedQuery(sql, { operation: "cp_log_costs.hunt_cost", callClass: "PAGE" }, HUNT_COST_SQL, [HUNT_COST_DAYS]) as Promise<readonly Record<string, unknown>[]>).catch(() => null),
    (boundedQuery(sql, { operation: "cp_box_findings.hunt_facts", callClass: "PAGE" }, HUNT_FACTS_SQL, [HUNT_COST_DAYS]) as Promise<readonly Record<string, unknown>[]>).catch(() => null),
  ]);
  const work = workCosts(workRaw.map((r): WorkRowRaw => ({ work: String(r.work), jurisdiction: typeof r.jur === "string" ? r.jur : null,
    usd: r.usd === null || r.usd === undefined ? null : Number(r.usd), unpriced: r.unpriced === true, tries: Number(r.tries) || 0,
    models: strings(r.models), outcomes: strings(r.outcomes), refused: Number(r.refused) || 0 })));
  const view = spendView(raw.map((r) => ({ month: String(r.month), day: typeof r.day === "string" ? r.day : null, role: String(r.role ?? ""), model: typeof r.model === "string" ? r.model : null,
    usd: r.usd === null || r.usd === undefined ? null : Number(r.usd), n: Number(r.n) || 0 })), neonTransferOf(transfer), work);
  const last = rolling?.[0];
  const number = (value: unknown) => value == null ? null : Number(value);
  const modelRows: ModelSpendRaw[] = (modelRaw ?? []).map(r => ({ day: String(r.day), role: String(r.role), model: typeof r.model === "string" ? r.model : null,
    job: typeof r.job === "string" ? r.job : null,
    listPrice: number(r.list_price),
    window: r.window as ModelSpendRaw["window"], jobs: Number(r.jobs), calls: number(r.calls), usd: number(r.usd), uncached: number(r.uncached),
    reads: number(r.reads), writes: number(r.writes), writes1h: number(r.writes1h), output: number(r.output), eligible: number(r.eligible),
    batched: number(r.batched), promptBand: Number(r.prompt_band) }));
  return { ...view, readAt: new Date().toISOString(),
    huntCost: huntCostRaw === null || huntFactsRaw === null ? null : huntCostView(huntCostRaw[0], huntFactsRaw[0]),
    modelSpend: modelRaw === null ? null : modelSpendView(modelRows, (factsRaw ?? []).map(r => ({ day: String(r.day), facts: Number(r.facts) })),
      modelRaw.find(r => r.changed_at != null)?.changed_at as string | null ?? null, new Date().toISOString()),
    last24h: last === undefined ? null : { modelUsd: Math.round(Number(last.model_usd) * 10_000) / 10_000, unpricedRows: Number(last.unpriced) || 0 },
    scoutOutcomes: outcomes === null ? null : scoutOutcomeLines(outcomes.map((r) => ({ recordClass: typeof r.record_class === "string" ? r.record_class : null, outcome: typeof r.outcome === "string" ? r.outcome : null, n: Number(r.n) || 0 }))) };
}
