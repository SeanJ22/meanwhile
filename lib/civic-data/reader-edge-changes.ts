import type { Query } from "../facts/publish.ts";
import type { RoutineRecordClass } from "./types.ts";

const CURSOR = "reader-edge";
// A promotion stamped just before the last publish read the clock may commit after it.
const OVERLAP = "1 minute";

// One branch for a first read and one index range after it, so a quiet minute reads no pointer rows.
const CHANGES_SQL = `WITH since AS (SELECT (SELECT position::timestamptz - interval '${OVERLAP}' FROM pass_cursor WHERE name = $1) AS at)
  SELECT p.record_class, p.scope, NULL::text AS through FROM civic_data_promotions p WHERE (SELECT at FROM since) IS NULL
  UNION ALL SELECT p.record_class, p.scope, NULL FROM civic_data_promotions p WHERE p.promoted_at > (SELECT at FROM since)
  UNION ALL SELECT NULL, NULL, now()::text
  UNION ALL SELECT 'FACTS', NULL, NULL WHERE EXISTS (SELECT 1 FROM rebuild_queue q WHERE (SELECT at FROM since) IS NULL OR q.queued_at > (SELECT at FROM since))`;

const SAVE_SQL = `INSERT INTO pass_cursor (name, position) VALUES ($1, $2)
  ON CONFLICT (name) DO UPDATE SET position = GREATEST(pass_cursor.position::timestamptz, EXCLUDED.position::timestamptz)::text`;

export interface EdgePointer { readonly recordClass: RoutineRecordClass; readonly scope: string }

interface ReaderEdgeChanges {
  /** The pointers promoted since the edge last published. */
  readonly pointers: readonly EdgePointer[];
  /** Facts were queued since then; every state's facts are planned on a full publish. */
  readonly facts: boolean;
  /** Marks these changes published; run only once the edge took them. */
  readonly save: () => Promise<void>;
}

/** What moved since the reader edge last published, read by promotion and queue time. */
export async function readReaderEdgeChanges(query: Query): Promise<ReaderEdgeChanges> {
  const rows = await query(CHANGES_SQL, [CURSOR]);
  const through = String(rows.find(row => row.through !== null)!.through);
  const pointers = rows.flatMap((row): EdgePointer[] => row.through !== null || row.record_class === "FACTS" ? []
    : [{ recordClass: row.record_class as RoutineRecordClass, scope: String(row.scope) }]);
  return { pointers, facts: rows.some(row => row.record_class === "FACTS"), save: async () => { await query(SAVE_SQL, [CURSOR, through]); } };
}
