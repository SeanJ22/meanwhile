import type { Sql } from "../pg-store.ts";

/**
 * Official pages that print a key-like string are now saved with it blanked and published. The removed
 * hold suspended each such page's door with this exact note (Cochise County's drop-box page among them),
 * so those doors are opened again and read at the next scheduled pass. Doors suspended for any other
 * reason are left as they are.
 */
export const REOPEN_HELD_DOORS_SQL = `UPDATE cp_doors
   SET value = value || jsonb_build_object('status', 'OPEN', 'readNow', true,
         'notes', 'Reopened: this official page is saved with its key-like strings blanked and published',
         'updatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
       revision = revision + 1, updated_at = now()
 WHERE value->>'status' = 'SUSPENDED'
   AND value->>'notes' = 'This document requires encrypted restricted evidence storage. Other official files remain active.'
RETURNING id`;

export function reopenHeldDoorsMigrationDefinition(): string {
  return JSON.stringify({ statements: [REOPEN_HELD_DOORS_SQL] });
}

export async function reopenHeldDoors(sql: Sql): Promise<number> {
  return ((await sql.query(REOPEN_HELD_DOORS_SQL)) as unknown[]).length;
}
