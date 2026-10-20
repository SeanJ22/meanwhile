import { createHash } from "node:crypto";
import type { AggregateRepository } from "../control-plane/repository/types.ts";
import { forEachAggregate, withHistoryIndex } from "../control-plane/workers/streamed-history.ts";

/** One observation per reusable method and place. */
export type FixMapState = "WORKS" | "FAILS" | "UNTRIED";
export interface FixMapRow {
  readonly methodId: string; readonly placeId: string; readonly state: FixMapState;
  readonly triedAt: string | null; readonly attemptId: string | null; readonly cause: string | null;
  readonly updatedAt: string; readonly supersededAttemptId?: string | null;
}

/** The control-plane bootstrap's statements for the table, one statement each. */
export const FIX_MAP_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS cp_fix_map (
  method_id text NOT NULL, place_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('WORKS', 'FAILS', 'UNTRIED')),
  tried_at timestamptz, attempt_id text, cause text, updated_at timestamptz NOT NULL,
  superseded_attempt_id text, PRIMARY KEY (method_id, place_id)
);`,
  "CREATE INDEX IF NOT EXISTS cp_fix_map_place ON cp_fix_map (place_id, method_id);",
  "CREATE INDEX IF NOT EXISTS cp_fix_map_works ON cp_fix_map (tried_at) WHERE state = 'WORKS';",
];

/** Where one method works: up to `WORKS_PLACES_SHOWN` places, newest first, and every state it works in. */
export interface MethodWorks {
  readonly places: readonly string[];
  readonly states: readonly string[];
}
export const WORKS_PLACES_SHOWN = 3;

/** The two-letter state a place id names, or null. */
export function stateOfPlace(placeId: string): string | null {
  return /(?:^|\/)state:([a-z]{2})(?:\/|$|#)/i.exec(placeId)?.[1]?.toLowerCase() ?? null;
}

/** Pure: the `worksFor` answer from rows already held. */
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

/** Pure: the `workingMethods` answer from rows already held. */
export function latestWorking(rows: readonly FixMapRow[], limit: number): FixMapRow[] {
  const newest = new Map<string, FixMapRow>();
  for (const row of rows) {
    if (row.state !== "WORKS") continue;
    const held = newest.get(row.methodId);
    if (!held || workedAt(row) > workedAt(held) || (workedAt(row) === workedAt(held) && row.placeId < held.placeId)) newest.set(row.methodId, row);
  }
  return [...newest.values()].sort((a, b) => workedAt(b) - workedAt(a) || a.methodId.localeCompare(b.methodId)).slice(0, limit);
}

/** An old replay or a newly scheduled trial cannot erase a known result. */
export function applyFixResult(prior: FixMapRow | null, incoming: FixMapRow): FixMapRow {
  if (!prior) return incoming;
  if (prior.methodId !== incoming.methodId || prior.placeId !== incoming.placeId) throw new Error("Fix-map row identities differ");
  if (prior.state !== "UNTRIED" && incoming.state === "UNTRIED") return prior;
  if (!(prior.state === "UNTRIED" && incoming.state !== "UNTRIED") &&
      Date.parse(incoming.triedAt ?? incoming.updatedAt) < Date.parse(prior.triedAt ?? prior.updatedAt)) return prior;
  return { ...incoming, supersededAttemptId: incoming.attemptId !== prior.attemptId ? prior.attemptId : prior.supersededAttemptId ?? null };
}

type Query = (text: string, parameters: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
export interface FixMapRepository {
  forPlace(placeId: string, limit?: number): Promise<readonly FixMapRow[]>;
  forMethod(methodId: string, limit?: number): Promise<readonly FixMapRow[]>;
  /** Stable place keyset for a system pass; a page never truncates the rest of the method's history. */
  forMethodPage(methodId: string, after: string | null, limit?: number): Promise<readonly FixMapRow[]>;
  /** For each named method, where it works. */
  worksFor(methodIds: readonly string[]): Promise<ReadonlyMap<string, MethodWorks>>;
  /** Each method that works somewhere: its newest working row, newest first. */
  workingMethods(limit?: number): Promise<readonly FixMapRow[]>;
  put(row: FixMapRow): Promise<void>;
}

function decode(row: Record<string, unknown>): FixMapRow {
  const date = (value: unknown) => value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;
  return { methodId: String(row.method_id), placeId: String(row.place_id), state: row.state as FixMapState,
    triedAt: date(row.tried_at), attemptId: row.attempt_id as string | null, cause: row.cause as string | null,
    updatedAt: date(row.updated_at)!, supersededAttemptId: row.superseded_attempt_id as string | null };
}

/** Both reads require a scope; no whole-map loading in a place worker. */
export function createFixMapRepository(query: Query): FixMapRepository {
  const bounded = (limit = 200) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid fix-map page size");
    return limit;
  };
  return {
    forPlace: async (placeId, limit) => (await query("SELECT * FROM cp_fix_map WHERE place_id = $1 ORDER BY method_id LIMIT $2", [placeId, bounded(limit)])).map(decode),
    forMethod: async (methodId, limit) => (await query("SELECT * FROM cp_fix_map WHERE method_id = $1 ORDER BY place_id LIMIT $2", [methodId, bounded(limit)])).map(decode),
    forMethodPage: async (methodId, after, limit) => (await query("SELECT * FROM cp_fix_map WHERE method_id = $1 AND ($2::text IS NULL OR place_id COLLATE \"C\">$2::text COLLATE \"C\") ORDER BY place_id COLLATE \"C\" LIMIT $3", [methodId, after, bounded(limit)])).map(decode),
    worksFor: async (methodIds) => {
      if (methodIds.length === 0) return new Map();
      const rows = await query(`SELECT method_id,
          (array_agg(place_id ORDER BY coalesce(tried_at, updated_at) DESC, place_id))[1:${WORKS_PLACES_SHOWN}] AS places,
          array_remove(array_agg(DISTINCT lower(substring(place_id from '(?:^|/)state:([a-zA-Z]{2})(?:/|$|#)'))), NULL) AS states
        FROM cp_fix_map WHERE method_id = ANY($1::text[]) AND state = 'WORKS' GROUP BY method_id`, [[...new Set(methodIds)]]);
      return new Map(rows.map((row) => [String(row.method_id),
        { places: (row.places as string[] | null) ?? [], states: [...((row.states as string[] | null) ?? [])].sort() }] as const));
    },
    workingMethods: async (limit) => (await query(
      `SELECT * FROM (SELECT DISTINCT ON (method_id) * FROM cp_fix_map WHERE state = 'WORKS'
        ORDER BY method_id, coalesce(tried_at, updated_at) DESC, place_id) newest
      ORDER BY coalesce(tried_at, updated_at) DESC, method_id LIMIT $1`, [bounded(limit)])).map(decode),
    put: async row => {
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

/** The fix map over any aggregate store (one aggregate per method and place), with the table's replace rules. */
export function aggregateFixMap(repo: AggregateRepository<FixMapRow>): FixMapRepository {
  const idOf = (r: Pick<FixMapRow, "methodId" | "placeId">): string => createHash("sha256").update(`${r.methodId}\u0000${r.placeId}`).digest("hex").slice(0, 32);
  const forMethodPage: FixMapRepository["forMethodPage"] = async (methodId, after, limit = 200) => {
      const page: FixMapRow[] = [];
      await forEachAggregate(repo, ({ value: row }) => {
        if (row.methodId !== methodId || (after !== null && row.placeId <= after)) return;
        page.push(row); page.sort((a, b) => a.placeId < b.placeId ? -1 : a.placeId > b.placeId ? 1 : 0); if (page.length > limit) page.pop();
      });
      return page;
  };
  return {
    forPlace: async (placeId, limit = 200) => (await repo.listWhere(["placeId"], placeId)).map(row => row.value).sort((a, b) => a.methodId.localeCompare(b.methodId)).slice(0, limit),
    forMethod: (methodId, limit) => forMethodPage(methodId, null, limit),
    forMethodPage,
    worksFor: async methodIds => {
      const wanted = new Set(methodIds), out = new Map<string, { places: { id: string; at: number }[]; states: Set<string> }>();
      await forEachAggregate(repo, ({ value: row }) => {
        if (row.state !== "WORKS" || !wanted.has(row.methodId)) return;
        const held = out.get(row.methodId) ?? { places: [], states: new Set<string>() };
        held.places.push({ id: row.placeId, at: workedAt(row) });
        held.places.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)); if (held.places.length > WORKS_PLACES_SHOWN) held.places.pop();
        const state = stateOfPlace(row.placeId); if (state) held.states.add(state);
        out.set(row.methodId, held);
      });
      return new Map([...out].map(([id, held]) => [id, { places: held.places.map(place => place.id), states: [...held.states].sort() }]));
    },
    workingMethods: (limit = 200) => withHistoryIndex(async db => {
      db.exec("CREATE TABLE working(method TEXT PRIMARY KEY,at REAL NOT NULL,place TEXT NOT NULL,body TEXT NOT NULL)");
      const put = db.prepare("INSERT INTO working VALUES(?,?,?,?) ON CONFLICT(method) DO UPDATE SET at=excluded.at,place=excluded.place,body=excluded.body WHERE excluded.at>working.at OR (excluded.at=working.at AND excluded.place<working.place)");
      await forEachAggregate(repo, ({ value: row }) => { if (row.state === "WORKS") put.run(row.methodId, workedAt(row), row.placeId, JSON.stringify(row)); });
      return Array.from(db.prepare("SELECT body FROM working ORDER BY at DESC,method LIMIT ?").iterate(limit), row => JSON.parse(row.body) as FixMapRow);
    }),
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
