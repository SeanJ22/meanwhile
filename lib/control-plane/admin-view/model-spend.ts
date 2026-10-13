import { rateFor, ratesForPrompt } from "../model-cost.ts";

export interface ModelSpendRaw {
  readonly listPrice?: number | null;
  readonly day: string;
  readonly role: string;
  readonly model: string | null;
  readonly window: "day" | "before" | "after";
  readonly jobs: number;
  readonly calls: number | null;
  readonly usd: number | null;
  readonly uncached: number | null;
  readonly reads: number | null;
  readonly writes: number | null;
  readonly writes1h: number | null;
  readonly output: number | null;
  readonly eligible: number | null;
  readonly batched: number | null;
  readonly promptBand: number;
}

export interface ModelSpendLine {
  readonly day: string;
  readonly role: string;
  readonly dollars: number | null;
  readonly calls: number | null;
  readonly cacheHitShare: number | null;
  readonly cacheWriteShare: number | null;
  readonly hourCacheTokens: number | null;
  readonly cacheWritesPerJob: number | null;
  readonly batchShare: number | null;
  readonly eligibleCalls: number | null;
  readonly batchedCalls: number | null;
  readonly savedDollars: number | null;
  readonly costPerLiveFact: number | null;
}

export interface ModelSpendView {
  readonly days: readonly ModelSpendLine[];
  readonly before: readonly ModelSpendLine[];
  readonly after: readonly ModelSpendLine[];
  readonly changedAt: string | null;
  readonly afterThrough: string | null;
  readonly comparison: "not-started" | "collecting" | "complete";
}

const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
const sum = (rows: readonly ModelSpendRaw[], key: keyof ModelSpendRaw): number | null =>
  rows.some(row => typeof row[key] !== "number") ? null : rows.reduce((n, row) => n + (row[key] as number), 0);

function line(rows: readonly ModelSpendRaw[], liveFacts: number | null): ModelSpendLine {
  const jobs = Math.max(...rows.map(row => row.jobs));
  const dollars = sum(rows, "usd"), uncached = sum(rows, "uncached"), reads = sum(rows, "reads"), writes = sum(rows, "writes");
  const input = uncached === null || reads === null || writes === null ? null : uncached + reads + writes;
  const eligible = sum(rows, "eligible"), batched = sum(rows, "batched");
  let listPrice: number | null = 0;
  for (const row of rows) {
    if (typeof row.listPrice === "number") { listPrice += row.listPrice; continue; }
    const rate = row.model ? rateFor(row.model) : null;
    if (!rate || row.uncached === null || row.reads === null || row.writes === null || row.output === null) { listPrice = null; break; }
    if (row.listPrice === null && rate.longPrompt) { listPrice = null; break; }
    const card = ratesForPrompt(rate, row.promptBand);
    listPrice += ((row.uncached + row.reads + row.writes) * card.inputUsdPerMillion + row.output * card.outputUsdPerMillion) / 1_000_000;
  }
  return { day: rows[0].day, role: rows[0].role, dollars: dollars === null ? null : round(dollars), calls: sum(rows, "calls"),
    cacheHitShare: input && reads !== null ? reads / input : null,
    cacheWriteShare: input && writes !== null ? writes / input : null,
    hourCacheTokens: sum(rows, "writes1h"), cacheWritesPerJob: writes === null || !jobs ? null : writes / jobs,
    batchShare: eligible && batched !== null ? batched / eligible : null,
    eligibleCalls: eligible, batchedCalls: batched,
    savedDollars: listPrice === null || dollars === null ? null : round(listPrice - dollars),
    costPerLiveFact: dollars === null || !liveFacts ? null : round(dollars / liveFacts) };
}

/** Missing historical metering stays unknown. Daily fact counts are new or updated reader records, shared by every contributing role. */
export function modelSpendView(rows: readonly ModelSpendRaw[], facts: readonly { day: string; facts: number }[], changedAt: string | null, now: string): ModelSpendView {
  const groups = new Map<string, ModelSpendRaw[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.window, row.window === "day" ? row.day : "", row.role]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const project = (window: ModelSpendRaw["window"]) => [...groups.values()].filter(group => group[0].window === window)
    .map(group => line(group, window === "day" ? facts.find(f => f.day === group[0].day)?.facts ?? null : null))
    .sort((a, b) => b.day.localeCompare(a.day) || a.role.localeCompare(b.role));
  const afterThrough = changedAt ? new Date(Date.parse(changedAt) + 86_400_000).toISOString() : null;
  return { days: project("day"), before: project("before"), after: project("after"), changedAt, afterThrough,
    comparison: changedAt === null ? "not-started" : Date.parse(now) < Date.parse(afterThrough!) ? "collecting" : "complete" };
}

/** Aggregate in Postgres: neither prompts nor a month of raw cost rows are sent to Admin. */
export const MODEL_SPEND_SQL = `WITH changed AS (
 SELECT recorded_at AS at FROM cp_log_costs
 WHERE recorded_at >= '2026-10-13T00:00:00Z'::timestamptz AND record->>'costPolicy' = 'R7'
 AND coalesce(record->>'nonProduction', 'false') <> 'true'
 AND coalesce((record->'cost'->>'modelRequestCount')::int, 0) > 0
 ORDER BY recorded_at ASC LIMIT 1
), recent AS MATERIALIZED (
 SELECT recorded_at, record FROM cp_log_costs WHERE (recorded_at >= now() - ($1::int * interval '1 day')
 OR (recorded_at >= (SELECT at FROM changed) - interval '24 hours' AND recorded_at < (SELECT at FROM changed) + interval '24 hours'))
 AND coalesce(record->>'nonProduction', 'false') <> 'true'
 AND coalesce((record->'cost'->>'modelRequestCount')::int, (record->'cost'->>'requestCount')::int, 1) > 0
 AND record->>'role' <> 'DISCOVERY_SEARCH'
 AND (record->>'model' LIKE 'claude-%' OR record->'byModel' IS NOT NULL OR record->>'source' = 'api.anthropic.com'
   OR (record->>'role' IN ('SCOUT', 'DETECTIVE', 'PARSER', 'ADVERSARIAL_AUDITOR', 'ASK')
     AND coalesce((record->'cost'->>'requestCount')::int, 0) > 0
     AND (record->'cost'->>'usd' IS NULL OR (record->'cost'->>'usd')::float8 > 0)))
), portions AS (
 SELECT c.recorded_at, c.record->>'role' AS role, c.record->>'attemptId' AS job,
 coalesce(m->>'model', c.record->>'model') AS model, coalesce(m, c.record->'cost') AS cost,
 CASE WHEN m IS NOT NULL THEN (m->>'requestCount')::int ELSE (c.record->'cost'->>'modelRequestCount')::int END AS calls
 FROM recent c LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.record->'byModel') = 'array'
   AND jsonb_array_length(c.record->'byModel') > 0 THEN c.record->'byModel' END) m ON true
), spans AS (
 SELECT p.*, 'day' AS span FROM portions p WHERE recorded_at >= now() - ($1::int * interval '1 day')
 UNION ALL SELECT p.*, 'before' FROM portions p, changed WHERE p.recorded_at >= changed.at - interval '24 hours' AND p.recorded_at < changed.at
 UNION ALL SELECT p.*, 'after' FROM portions p, changed WHERE p.recorded_at >= changed.at AND p.recorded_at < changed.at + interval '24 hours'
), labeled AS (
 SELECT *, CASE WHEN span = 'day' THEN to_char(recorded_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') ELSE span END AS day FROM spans
), jobs AS (SELECT day, role, span, count(distinct job)::int AS jobs FROM labeled GROUP BY 1, 2, 3)
 SELECT p.day, p.role, model, p.span AS "window",
 CASE WHEN coalesce((cost->>'inputTokens')::bigint, 0) > 100000 THEN 100001 ELSE 0 END AS prompt_band,
 max(j.jobs)::int AS jobs,
 CASE WHEN count(calls) = count(*) THEN sum(calls)::int END AS calls,
 CASE WHEN count(cost->>'usd') = count(*) THEN sum((cost->>'usd')::float8) END AS usd,
 CASE WHEN count(cost->>'listPriceUsd') = count(*) THEN sum((cost->>'listPriceUsd')::float8) END AS list_price,
 CASE WHEN count(cost->>'uncachedInputTokens') = count(*) THEN sum((cost->>'uncachedInputTokens')::bigint)::float8 END AS uncached,
 CASE WHEN count(cost->>'cacheReadInputTokens') = count(*) THEN sum((cost->>'cacheReadInputTokens')::bigint)::float8 END AS reads,
 CASE WHEN count(cost->>'cacheCreationInputTokens') = count(*) THEN sum((cost->>'cacheCreationInputTokens')::bigint)::float8 END AS writes,
 CASE WHEN count(cost->>'cacheCreation1hInputTokens') = count(*) THEN sum((cost->>'cacheCreation1hInputTokens')::bigint)::float8 END AS writes1h,
 CASE WHEN count(cost->>'outputTokens') = count(*) THEN sum((cost->>'outputTokens')::bigint)::float8 END AS output,
 CASE WHEN count(cost->>'batchEligibleRequestCount') = count(*) THEN sum((cost->>'batchEligibleRequestCount')::int)::int END AS eligible,
 CASE WHEN count(cost->>'batchRequestCount') = count(*) THEN sum((cost->>'batchRequestCount')::int)::int END AS batched,
 (SELECT at FROM changed) AS changed_at
 FROM labeled p JOIN jobs j ON j.day = p.day AND j.role = p.role AND j.span = p.span GROUP BY 1, 2, 3, 4, 5`;

export const MODEL_LIVE_FACTS_SQL = `SELECT to_char(recorded_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day,
 sum((record->'publicationFlow'->>'changedRecords')::int)::int AS facts
 FROM cp_log_owner_digests WHERE log_key = 'publication-flow' AND record->'publicationFlow'->>'stage' = 'LIVE'
 AND recorded_at >= now() - ($1::int * interval '1 day') GROUP BY 1`;
