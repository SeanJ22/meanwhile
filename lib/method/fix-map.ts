import { createHash } from "node:crypto";
import type { AggregateRepository } from "../control-plane/repository/types.ts";

export type FixMapState = "WORKS" | "FAILS" | "UNTRIED";
export interface FixMapRow {
  readonly methodId: string; readonly placeId: string; readonly state: FixMapState;
  readonly triedAt: string | null; readonly attemptId: string | null; readonly cause: string | null;
  readonly updatedAt: string; readonly supersededAttemptId?: string | null;
}

export const FIX_MAP_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS cp_fix_map (
  method_id text NOT NULL, place_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('WORKS', 'FAILS', 'UNTRIED')),
  tried_at timestamptz, attempt_id text, cause text, updated_at timestamptz NOT NULL,
  superseded_attempt_id text, PRIMARY KEY (method_id, place_id)
);`,
  "CREATE INDEX IF NOT EXISTS cp_fix_map_place ON cp_fix_map (place_id, method_id);",
  "CREATE INDEX IF NOT EXISTS cp_fix_map_works ON cp_fix_map (tried_at) WHERE state = 'WORKS';",
  "CREATE INDEX IF NOT EXISTS cp_fix_map_method_works ON cp_fix_map (method_id, coalesce(tried_at, updated_at) DESC, place_id) WHERE state = 'WORKS';",

];

export interface MethodWorks {
  readonly places: readonly string[];
  readonly states: readonly string[];
}
export const WORKS_PLACES_SHOWN = 3;

export function stateOfPlace(placeId: string): string | null {
  return (/(?:^|\/)(?:state|district|territory):([a-z]{2})(?:\/|$|#)/i.exec(placeId)?.[1]
    ?? /(?:^|:)government:us-([a-z]{2})(?::|$)/i.exec(placeId)?.[1])?.toLowerCase() ?? null;
}

export function methodWorksOf(rows: readonly FixMapRow[], methodIds: readonly string[]): ReadonlyMap<string, MethodWorks> {
  const wanted = new Set(methodIds);
  const out = new Map<string, MethodWorks>();
  const working = rows.filter((r) => r.state === "WORKS" && wanted.has(r.methodId))
    .sort((a, b) => Date.parse(b.triedAt ?? b.updatedAt) - Date.parse(a.triedAt ?? a.updatedAt) || a.placeId.localeCompare(b.placeId));
  for (const row of working) {
    const held = out.get(row.methodId) ?? { places: [], states: [] };
    const state = stateOfPlace(row.placeId);
    out.set(row.methodId, {
      places: held.places.length < WORKS_PLACES_SHOWN ? [...held.places, row.placeId] : held.places,
      states: state === null || held.states.includes(state) ? held.states : [...held.states, state].sort(),
    });
  }
  return out;
}

const workedAt = (r: FixMapRow): number => Date.parse(r.triedAt ?? r.updatedAt);

export function latestWorking(rows: readonly FixMapRow[], limit: number): FixMapRow[] {
  const newest = new Map<string, FixMapRow>();
  for (const row of rows) {
    if (row.state !== "WORKS") continue;
    const held = newest.get(row.methodId);
    if (!held || workedAt(row) > workedAt(held) || (workedAt(row) === workedAt(held) && row.placeId < held.placeId)) newest.set(row.methodId, row);
  }
  return [...newest.values()].sort((a, b) => workedAt(b) - workedAt(a) || a.methodId.localeCompare(b.methodId)).slice(0, limit);
}

export function applyFixResult(prior: FixMapRow | null, incoming: FixMapRow): FixMapRow {
  if (!prior) return incoming;
  if (prior.methodId !== incoming.methodId || prior.placeId !== incoming.placeId) throw new Error("Fix-map row identities differ");
  if (prior.state !== "UNTRIED" && incoming.state === "UNTRIED") return prior;
  if (!(prior.state === "UNTRIED" && incoming.state !== "UNTRIED") &&
      Date.parse(incoming.triedAt ?? incoming.updatedAt) < Date.parse(prior.triedAt ?? prior.updatedAt)) return prior;
  return { ...incoming, supersededAttemptId: incoming.attemptId !== prior.attemptId ? prior.attemptId : prior.supersededAttemptId ?? null };
}

export interface MethodStatistics {
  readonly total: number; readonly works: number; readonly tried: number;
  readonly states: number; readonly districts: number;
  readonly recentWorks: number; readonly recentTried: number;
  readonly beforeWorks: number; readonly beforeFails: number; readonly since: number;
}

export function methodStatistics(observations: readonly FixMapRow[], recentSince?: string, before?: string): MethodStatistics {
  if (new Set(observations.map(row => row.methodId)).size > 1) throw new Error("Read one method's map before measuring proof");
  const latest = new Map<string, FixMapRow>();
  for (const row of observations) latest.set(row.placeId, applyFixResult(latest.get(row.placeId) ?? null, row));
  const rows = [...latest.values()];
  const works = rows.filter(row => row.state === "WORKS");
  const tried = rows.filter(row => row.state !== "UNTRIED");
  const recent = tried.filter(row => recentSince === undefined || workedAt(row) >= Date.parse(recentSince));
  const then = tried.filter(row => before === undefined || workedAt(row) <= Date.parse(before));
  return { total: rows.length, works: works.length, tried: tried.length,
    states: new Set(works.map(row => stateOfPlace(row.placeId)).filter(Boolean)).size,
    districts: new Set(works.map(row => /^(.+\/(?:county|congressional-district|sldu|sldl|school-district):[^/]+)/.exec(row.placeId)?.[1]).filter(Boolean)).size,
    recentWorks: recent.filter(row => row.state === "WORKS").length, recentTried: recent.length,
    beforeWorks: then.filter(row => row.state === "WORKS").length, beforeFails: then.filter(row => row.state === "FAILS").length,
    since: tried.length - then.length };
}

export const PLACE_STATE_SQL="lower(coalesce(substring(place_id from '(?:^|/)(?:state|district|territory):([a-zA-Z]{2})(?:/|$|#)'),substring(place_id from '(?i)(?:^|:)government:US-([a-zA-Z]{2})(?::|$)')))";

type Query = (text: string, parameters: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
export interface FixMapRepository {
  forPlace(placeId: string, limit?: number): Promise<readonly FixMapRow[]>;
  forPlaces(methodId: string, placeIds: readonly string[]): Promise<readonly FixMapRow[]>;
  statistics(methodId: string, recentSince?: string, before?: string): Promise<MethodStatistics>;

  worksFor(methodIds: readonly string[]): Promise<ReadonlyMap<string, MethodWorks>>;

  workingMethods(limit?: number): Promise<readonly FixMapRow[]>;
  put(row: FixMapRow): Promise<void>;
}

function decode(row: Record<string, unknown>): FixMapRow {
  const date = (value: unknown) => value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;
  return { methodId: String(row.method_id), placeId: String(row.place_id), state: row.state as FixMapState,
    triedAt: date(row.tried_at), attemptId: row.attempt_id as string | null, cause: row.cause as string | null,
    updatedAt: date(row.updated_at)!, supersededAttemptId: row.superseded_attempt_id as string | null };
}

export function createFixMapRepository(query: Query): FixMapRepository {
  const summaries = new Map<string, MethodWorks>();
  const bounded = (limit = 200) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid fix-map page size");
    return limit;
  };
  return {
    forPlace: async (placeId, limit) => (await query("SELECT * FROM cp_fix_map WHERE place_id = $1 ORDER BY method_id LIMIT $2", [placeId, bounded(limit)])).map(decode),
    forPlaces: async (methodId, placeIds) => placeIds.length === 0 ? [] : (await query(
      "SELECT * FROM cp_fix_map WHERE method_id = $1 AND place_id = ANY($2::text[]) ORDER BY place_id", [methodId, [...new Set(placeIds)]])).map(decode),
    statistics: async (methodId, recentSince, before) => {
      const [row] = await query(`SELECT count(*) AS total,
        count(*) FILTER (WHERE state = 'WORKS') AS works,
        count(*) FILTER (WHERE state != 'UNTRIED') AS tried,
        count(DISTINCT ${PLACE_STATE_SQL}) FILTER (WHERE state = 'WORKS') AS states,
        count(DISTINCT substring(place_id from '^(.+/(?:county|congressional-district|sldu|sldl|school-district):[^/]+)')) FILTER (WHERE state = 'WORKS') AS districts,
        count(*) FILTER (WHERE state = 'WORKS' AND ($2::timestamptz IS NULL OR coalesce(tried_at, updated_at) >= $2::timestamptz)) AS "recentWorks",
        count(*) FILTER (WHERE state != 'UNTRIED' AND ($2::timestamptz IS NULL OR coalesce(tried_at, updated_at) >= $2::timestamptz)) AS "recentTried",
        count(*) FILTER (WHERE state = 'WORKS' AND ($3::timestamptz IS NULL OR coalesce(tried_at, updated_at) <= $3::timestamptz)) AS "beforeWorks",
        count(*) FILTER (WHERE state = 'FAILS' AND ($3::timestamptz IS NULL OR coalesce(tried_at, updated_at) <= $3::timestamptz)) AS "beforeFails",
        count(*) FILTER (WHERE state != 'UNTRIED' AND coalesce(tried_at, updated_at) > $3::timestamptz) AS since
        FROM cp_fix_map WHERE method_id = $1`, [methodId, recentSince ?? null, before ?? null]);
      return Object.fromEntries(Object.entries(row!).map(([key, value]) => [key, Number(value)])) as unknown as MethodStatistics;
    },
    worksFor: async methodIds => {
      const ids = [...new Set(methodIds)], missing = ids.filter(id => !summaries.has(id));
      if (missing.length) {
        const rows = await query(`SELECT methods.method_id,
          ARRAY(SELECT place_id FROM cp_fix_map WHERE method_id=methods.method_id AND state='WORKS'
            ORDER BY coalesce(tried_at,updated_at) DESC,place_id LIMIT 3) AS places,
          ARRAY(SELECT DISTINCT ${PLACE_STATE_SQL} AS state
            FROM cp_fix_map WHERE method_id=methods.method_id AND state='WORKS'
            AND ${PLACE_STATE_SQL} IS NOT NULL ORDER BY state) AS states
          FROM unnest($1::text[]) AS methods(method_id)`,[missing]);
        for (const id of missing) summaries.set(id,{ places: [],states: [] });
        for (const row of rows) summaries.set(String(row.method_id),{ places: row.places as string[],states: row.states as string[] });
      }
      return new Map(ids.flatMap(id => summaries.get(id)!.places.length ? [[id,summaries.get(id)!] as const] : []));
    },
    workingMethods: async (limit) => (await query(
      `SELECT * FROM (SELECT DISTINCT ON (method_id) * FROM cp_fix_map WHERE state = 'WORKS'
        ORDER BY method_id, coalesce(tried_at, updated_at) DESC, place_id) newest
      ORDER BY coalesce(tried_at, updated_at) DESC, method_id LIMIT $1`, [bounded(limit)])).map(decode),
    put: async row => {
      summaries.delete(row.methodId);
      await query(`INSERT INTO cp_fix_map (method_id, place_id, state, tried_at, attempt_id, cause, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (method_id, place_id) DO UPDATE SET state = EXCLUDED.state, tried_at = EXCLUDED.tried_at,
          attempt_id = EXCLUDED.attempt_id, cause = EXCLUDED.cause, updated_at = EXCLUDED.updated_at,
          superseded_attempt_id = CASE WHEN EXCLUDED.attempt_id IS DISTINCT FROM cp_fix_map.attempt_id
            THEN cp_fix_map.attempt_id ELSE cp_fix_map.superseded_attempt_id END
        WHERE (cp_fix_map.state = 'UNTRIED' AND (EXCLUDED.state != 'UNTRIED' OR EXCLUDED.updated_at >= cp_fix_map.updated_at))
          OR (cp_fix_map.state != 'UNTRIED' AND EXCLUDED.state != 'UNTRIED' AND EXCLUDED.tried_at >= cp_fix_map.tried_at)`,
      [row.methodId, row.placeId, row.state, row.triedAt, row.attemptId, row.cause, row.updatedAt]);
    },
  };
}

export function aggregateFixMap(repo: AggregateRepository<FixMapRow>): FixMapRepository {
  const idOf = (r: Pick<FixMapRow, "methodId" | "placeId">): string => createHash("sha256").update(`${r.methodId}\u0000${r.placeId}`).digest("hex").slice(0, 32);
  const all = async () => (await repo.list()).map((row) => row.value);
  return {
    forPlace: async (placeId, limit = 200) => (await all()).filter((r) => r.placeId === placeId).sort((a, b) => a.methodId.localeCompare(b.methodId)).slice(0, limit),
    forPlaces: async (methodId, placeIds) => {
      const rows = await Promise.all([...new Set(placeIds)].sort().map(placeId => repo.read(idOf({ methodId, placeId }))));
      return rows.flatMap(row => row === null ? [] : [row.value]);
    },
    statistics: async (methodId, recentSince, before) => methodStatistics((await all()).filter(row => row.methodId === methodId), recentSince, before),
    worksFor: async (methodIds) => methodWorksOf(await all(), methodIds),
    workingMethods: async (limit = 200) => latestWorking(await all(), limit),
    put: async (row) => {
      for (let attempt = 0; ; attempt += 1) {
        const held = await repo.read(idOf(row));
        try {
          if (held === null) await repo.put(idOf(row), row, row.updatedAt);
          else {
            const next = applyFixResult(held.value, row);
            if (next !== held.value) await repo.compareAndSet(idOf(row), held.revision, next, row.updatedAt);
          }
          return;
        } catch (error) {
          if (attempt === 3) throw error;
        }
      }
    },
  };
}
