/** One observation per reusable method and place. */
export type FixMapState = "WORKS" | "FAILS" | "UNTRIED";
export interface FixMapRow {
  readonly methodId: string; readonly placeId: string; readonly state: FixMapState;
  readonly triedAt: string | null; readonly attemptId: string | null; readonly cause: string | null;
  readonly updatedAt: string; readonly supersededAttemptId?: string | null;
}

/** Expand-only DDL for the existing control-plane bootstrap; never applied from this module. */
export const FIX_MAP_EXPAND_SQL = `CREATE TABLE IF NOT EXISTS cp_fix_map (
  method_id text NOT NULL, place_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('WORKS', 'FAILS', 'UNTRIED')),
  tried_at timestamptz, attempt_id text, cause text, updated_at timestamptz NOT NULL,
  superseded_attempt_id text, PRIMARY KEY (method_id, place_id)
);
CREATE INDEX IF NOT EXISTS cp_fix_map_place ON cp_fix_map (place_id, method_id);`;

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
