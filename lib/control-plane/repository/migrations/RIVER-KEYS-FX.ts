import type { Sql } from "../pg-store.ts";

/**
 * RIVER-KEYS_expand matched the hold's door note, but production recorded the hold in each door's
 * lastFailureReason and later rewrote the note, so it reopened nothing. This opens every door suspended
 * for that reason, and Cochise County's drop-box page, which Sean named as suspended only by the hold.
 * Doors suspended for any other reason are left as they are.
 */
export const REOPEN_KEY_HELD_DOORS_SQL = `UPDATE cp_doors
   SET value = (value - 'lastFailureReason') || jsonb_build_object('status', 'OPEN', 'readNow', true,
         'updatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
       revision = revision + 1, updated_at = now()
 WHERE value->>'status' = 'SUSPENDED'
   AND (value->>'lastFailureReason' ILIKE '%requires encrypted restricted evidence storage%'
     OR value->>'notes' ILIKE '%requires encrypted restricted evidence storage%'
     OR id = 'cochise:ballot-box-table')
RETURNING id`;

export function reopenKeyHeldDoorsMigrationDefinition(): string {
  return JSON.stringify({ statements: [REOPEN_KEY_HELD_DOORS_SQL] });
}

export async function reopenKeyHeldDoors(sql: Sql): Promise<number> {
  return ((await sql.query(REOPEN_KEY_HELD_DOORS_SQL)) as unknown[]).length;
}
