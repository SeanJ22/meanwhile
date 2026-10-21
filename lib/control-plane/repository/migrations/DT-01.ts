import type { Sql } from "../pg-store.ts";

/**
 * Debts saved before they carried a state are invisible to the planner that owns them, so that planner
 * tried to save them again and crashed with IdentityCollision. Each gets the state of its obligation, the
 * state that planner reads obligations by. A debt whose own id already names a different state is left
 * alone: the stamp could not change which state reads it.
 */
export const DEBT_STATE_STAMP_SQL = `WITH owner AS (
  SELECT d.id, cp_control_state(o.value) AS state
    FROM cp_debts d JOIN cp_obligations o ON o.id = d.id
)
UPDATE cp_debts d
   SET value = jsonb_set(d.value, '{state}', to_jsonb(owner.state)), revision = d.revision + 1, updated_at = now()
  FROM owner
 WHERE owner.id = d.id AND owner.state <> 'system'
   AND cp_control_state(d.value) <> owner.state
   AND cp_control_state(jsonb_set(d.value, '{state}', to_jsonb(owner.state))) = owner.state
RETURNING d.id`;

export function debtStateMigrationDefinition(): string {
  return JSON.stringify({ statements: [DEBT_STATE_STAMP_SQL] });
}

export async function stampDebtStates(sql: Sql): Promise<number> {
  return ((await sql.query(DEBT_STATE_STAMP_SQL)) as unknown[]).length;
}
