import type { Sql } from "./pg-store.ts";
import type { AggregateRepository, AppendOnlyRepository } from "./types.ts";
import type { PricedCharge } from "../fleet-safety.ts";
import { summarizeCharges, type SpendQuery, type SpendRepository, type SpendSummary } from "../spend-window.ts";
import { cacheHitRateByRole, cacheReadingsFromTotals, type CacheRoleTotals } from "../research-metrics.ts";
import { SCOUT_PREWARM_ROUTE_ID } from "../scheduler/research-policy.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import { boundedQuery, type ControlPlaneRequestBounds, CONTROL_PLANE_REQUEST_BOUNDS_MS } from "./request-bounds.ts";

export const MODEL_CHARGES_DDL = [
  `CREATE TABLE IF NOT EXISTS cp_model_charges (
    id text PRIMARY KEY, charged_at timestamptz NOT NULL, job_id text NOT NULL,
    route_task_id text, obligation_id text, jurisdiction text, attempt_id text NOT NULL,
    usd double precision NOT NULL, known_usd double precision NOT NULL, measured boolean NOT NULL,
    bounded boolean NOT NULL, assignment_refs jsonb, is_scout boolean NOT NULL, scout_usd double precision, cache jsonb
  )`,
  `CREATE INDEX IF NOT EXISTS cp_model_charges_time ON cp_model_charges (charged_at) INCLUDE (usd, known_usd, measured, bounded, job_id, obligation_id)`,
  `CREATE INDEX IF NOT EXISTS cp_model_charges_place_time ON cp_model_charges (jurisdiction, charged_at)`,
  `CREATE INDEX IF NOT EXISTS cp_model_charges_obligation_time ON cp_model_charges (obligation_id, charged_at)`,
  `CREATE INDEX IF NOT EXISTS cp_model_charges_task_time ON cp_model_charges (route_task_id, charged_at)`,
  `CREATE INDEX IF NOT EXISTS cp_model_charges_attempt_time ON cp_model_charges (attempt_id, charged_at)`,
] as const;

export function storedSpendRepository(rows: AggregateRepository<PricedCharge>, results: Pick<AppendOnlyRepository<ScoutResult>, "readAll">): SpendRepository {
  return {
    async record(charge) { await rows.put(charge.id, charge, charge.at); },
    async aggregate(query) { return summarizeCharges((await rows.list()).map(row => row.value), query); },
    async metrics(query) {
      const charges = (await rows.list()).map(row => row.value).filter(charge => Date.parse(charge.at) >= Date.parse(query.since) && Date.parse(charge.at) <= Date.parse(query.until));
      const scout = { usd: 0, measured: 0, unmeasured: 0 };
      for (const charge of charges) {
        const m = charge.metered;
        if (m.role !== "SCOUT" || m.routeId === SCOUT_PREWARM_ROUTE_ID) continue;
        if (m.cost.usd == null || Number.isNaN(m.cost.usd)) scout.unmeasured++;
        else { scout.usd += m.cost.usd; scout.measured++; }
      }
      return { scout, cache: cacheHitRateByRole({ costs: charges.map(charge => charge.metered), results: await results.readAll(), sinceIso: query.since, untilIso: query.until }) };
    },
  };
}

export function cacheTotals(charge: PricedCharge): Record<string, unknown> | null {
  const row = cacheHitRateByRole({ costs: [charge.metered], results: [] })[0];
  if (!row) return null;
  const requests = row.measuredRows ? charge.metered.cost.requestCount ?? 1 : 0;
  return { role: row.role, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite, uncachedInput: row.uncachedInput,
    attempts: row.attempts, measuredRows: row.measuredRows, predatingRows: row.predatingRows, unreportedRows: row.unreportedRows,
    uncachedMax: row.uncachedPerAttempt?.max ?? 0, requests, batched: row.batchShare === 1 ? requests : 0,
    savedUsd: row.savedUsd, aggregatePricedRows: row.aggregatePricedRows };
}

export function modelChargeParams(charge: PricedCharge): readonly unknown[] {
  return [charge.id, charge.at, charge.jobId, charge.routeTaskId, charge.obligationId, charge.jurisdiction,
    charge.metered.attemptId, charge.usd, charge.knownUsd, charge.measured, charge.bounded,
    charge.assignmentRefs === undefined ? null : JSON.stringify(charge.assignmentRefs),
    charge.metered.role === "SCOUT" && charge.metered.routeId !== SCOUT_PREWARM_ROUTE_ID,
    Number.isNaN(charge.metered.cost.usd) ? null : charge.metered.cost.usd ?? null, JSON.stringify(cacheTotals(charge))];
}

const INSERT_CHARGE = `INSERT INTO cp_model_charges
  (id, charged_at, job_id, route_task_id, obligation_id, jurisdiction, attempt_id, usd, known_usd, measured, bounded, assignment_refs, is_scout, scout_usd, cache)
  VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15::jsonb)
  ON CONFLICT (id) DO NOTHING`;

export function spendWhere(query: SpendQuery): { sql: string; params: unknown[] } {
  const params: unknown[] = [query.since, query.until];
  const at = (value: unknown): string => `$${params.push(value)}`;
  const conditions = ["c.charged_at >= $1::timestamptz", "c.charged_at <= $2::timestamptz"];
  if (query.jurisdictions) conditions.push(`c.jurisdiction = ANY(${at(query.jurisdictions)}::text[])`);
  if (query.excludeTasks?.length) conditions.push(`NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(${at(JSON.stringify(query.excludeTasks))}::jsonb)
    AS excluded(id text, since timestamptz) WHERE excluded.id = c.route_task_id AND c.charged_at >= excluded.since)`);
  if (query.assignment) {
    const a = query.assignment;
    conditions.push(`(c.assignment_refs IS NULL OR c.assignment_refs @> ${at(JSON.stringify([{ key: a.key, ref: a.ref }]))}::jsonb)`);
    const obligations = at(JSON.stringify(a.obligations)), subjects = at(JSON.stringify(a.subjects));
    conditions.push(`((c.obligation_id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_to_recordset(${obligations}::jsonb)
      AS members(id text, since timestamptz) WHERE members.id = c.obligation_id AND c.charged_at >= members.since))
      OR (c.obligation_id IS NULL AND EXISTS (SELECT 1 FROM jsonb_to_recordset(${subjects}::jsonb)
      AS members(id text, since timestamptz) WHERE members.id = c.jurisdiction AND c.charged_at >= members.since)))`);
  }
  return { sql: conditions.join(" AND "), params };
}

function readSummary(row: Record<string, unknown>): SpendSummary {
  return { usd: Number(row.usd), knownUsd: Number(row.known_usd), measured: Number(row.measured),
    unmeasured: Number(row.unmeasured), worstCaseCharges: Number(row.worst_case_charges), bySubject: Number(row.by_subject) };
}

export function pgSpendRepository(sql: Sql, bounds: ControlPlaneRequestBounds = CONTROL_PLANE_REQUEST_BOUNDS_MS): SpendRepository {
  const run = (operation: string, query: string, params: readonly unknown[]) => boundedQuery(sql,
    { operation: `cp_model_charges.${operation}`, callClass: "POINT" }, query, params, { bounds });
  return {
    async record(charge) { await run("record", INSERT_CHARGE, modelChargeParams(charge)); },
    async aggregate(query) {
      const where = spendWhere(query);
      const fields = `coalesce(sum(c.known_usd), 0) AS known_usd,
        count(*) FILTER (WHERE c.measured) AS measured, count(*) FILTER (WHERE NOT c.measured) AS unmeasured,
        count(*) FILTER (WHERE c.bounded) AS worst_case_charges, count(*) FILTER (WHERE c.obligation_id IS NULL) AS by_subject`;
      if (!query.holds?.length) {
        const rows = await run("aggregate", `SELECT coalesce(sum(c.usd), 0) AS usd, ${fields}
          FROM cp_model_charges c WHERE ${where.sql}`, where.params) as Record<string, unknown>[];
        return readSummary(rows[0]);
      }
      const valid = new Map<string, NonNullable<SpendQuery["holds"]>[number]>();
      for (const hold of query.holds) {
        if (!valid.has(hold.holdId) && Date.parse(hold.heldAt) >= Date.parse(query.since)
          && Date.parse(hold.heldAt) <= Date.parse(query.until) && Number.isFinite(hold.usd) && hold.usd >= 0) valid.set(hold.holdId, hold);
      }
      const holds = `$${where.params.push(JSON.stringify([...valid.values()]))}`;
      const rows = await run("aggregateWithHolds", `WITH selected AS MATERIALIZED (
        SELECT c.usd, c.known_usd, c.measured, c.bounded, c.obligation_id, c.job_id FROM cp_model_charges c WHERE ${where.sql}
      ), jobs AS (SELECT job_id, sum(usd) AS usd, coalesce(sum(usd) FILTER (WHERE bounded), 0) AS worst FROM selected GROUP BY job_id),
      holds AS (SELECT h."jobId" AS job_id, sum(h.usd) AS worst, coalesce(sum(h.usd) FILTER (WHERE h.settled IS NULL OR h.settled = 'null'::jsonb), 0) AS held
        FROM jsonb_to_recordset(${holds}::jsonb) AS h("jobId" text, usd double precision, settled jsonb) GROUP BY h."jobId")
      SELECT (SELECT coalesce(sum(CASE WHEN j.worst > 0 AND h.worst >= j.usd - j.worst THEN least(h.worst, j.usd)
        ELSE greatest(j.usd, coalesce(h.held, 0)) END), 0) FROM jobs j LEFT JOIN holds h USING(job_id)) AS usd,
        ${fields} FROM selected c`, where.params) as Record<string, unknown>[];
      return readSummary(rows[0]);
    },
    async metrics(query) {
      const params = [query.since, query.until];
      const scoutRows = await run("capacity", `SELECT coalesce(sum(scout_usd),0) AS usd,
        count(*) FILTER (WHERE scout_usd IS NOT NULL) AS measured, count(*) FILTER (WHERE scout_usd IS NULL) AS unmeasured
        FROM cp_model_charges WHERE charged_at >= $1::timestamptz AND charged_at <= $2::timestamptz AND is_scout`, params) as Record<string, unknown>[];
      const sum = (key: string) => `coalesce(sum((cache->>'${key}')::double precision),0)`;
      const rows = await run("cache", `SELECT cache->>'role' AS role,
        ${sum("cacheRead")} AS read, ${sum("cacheWrite")} AS write, ${sum("uncachedInput")} AS uncached,
        ${sum("attempts")} AS attempts, ${sum("measuredRows")} AS measured,
        ${sum("predatingRows")} AS predating, ${sum("unreportedRows")} AS unreported,
        coalesce(max((cache->>'uncachedMax')::double precision),0) AS uncached_max,
        ${sum("requests")} AS requests, ${sum("batched")} AS batched,
        CASE WHEN bool_or(cache->>'savedUsd' IS NULL) THEN NULL ELSE sum((cache->>'savedUsd')::double precision) END AS saved,
        ${sum("aggregatePricedRows")} AS aggregate_priced
        FROM cp_model_charges WHERE charged_at >= $1::timestamptz AND charged_at <= $2::timestamptz
          AND cache IS NOT NULL AND cache <> 'null'::jsonb GROUP BY cache->>'role'`, params.slice(0, 2)) as Record<string, unknown>[];
      const totals = new Map(rows.map(row => [String(row.role), { role: String(row.role), read: Number(row.read), write: Number(row.write), uncached: Number(row.uncached),
        attempts: Number(row.attempts), measured: Number(row.measured), predating: Number(row.predating), unreported: Number(row.unreported),
        uncachedMax: Number(row.uncached_max), requests: Number(row.requests), batched: Number(row.batched), saved: row.saved === null ? null : Number(row.saved),
        aggregatePriced: Number(row.aggregate_priced), turns: null, misses: null, stationary: null } as CacheRoleTotals]));
      const turns = await run("cacheTurns", `WITH candidates AS MATERIALIZED (
        SELECT DISTINCT attempt_id FROM cp_model_charges WHERE charged_at >= $1::timestamptz AND charged_at <= $2::timestamptz
          AND cache IS NOT NULL AND cache <> 'null'::jsonb), per_result AS (
        SELECT r.log_key, r.position, CASE WHEN step->>'step' = 'scout-research-loop' THEN 'SCOUT' ELSE 'SUB_STEP' END AS role,
          count(*) FILTER (WHERE coalesce((step->>'turn')::integer,0) >= 2) AS turns,
          count(*) FILTER (WHERE coalesce((step->>'turn')::integer,0) >= 2 AND (step->'tokens'->>'cacheRead')::double precision = 0) AS misses,
          coalesce(jsonb_array_length(r.record->'cacheDefect'->'stationaryTurns'),0) AS stationary
        FROM candidates a JOIN cp_log_scout_results r ON r.record->>'attemptId' = a.attempt_id CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.record->'steps','[]'::jsonb)) step
        WHERE step->>'kind' = 'MODEL'
        GROUP BY r.log_key, r.position, role, r.record->'cacheDefect'->'stationaryTurns')
        SELECT role, sum(turns) AS turns, sum(misses) AS misses, sum(stationary) AS stationary FROM per_result GROUP BY role`, params.slice(0,2)) as Record<string, unknown>[];
      for (const row of turns) {
        const role = String(row.role);
        const total = totals.get(role) ?? { role, read: 0, write: 0, uncached: 0, attempts: 0, measured: 0, predating: 0, unreported: 0,
          uncachedMax: 0, requests: 0, batched: 0, saved: 0, aggregatePriced: 0, turns: null, misses: null, stationary: null };
        totals.set(role, { ...total, turns: Number(row.turns), misses: Number(row.misses), stationary: Number(row.stationary) });
      }
      return { scout: { usd: Number(scoutRows[0].usd), measured: Number(scoutRows[0].measured), unmeasured: Number(scoutRows[0].unmeasured) },
        cache: cacheReadingsFromTotals([...totals.values()]) };
    },
  };
}
