import type { Query } from "../facts/publish.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
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
  /** What the edge covers that moved since it last published: promoted pointers, and the registry when facts are queued. */
  readonly pointers: readonly EdgePointer[];
  /** Marks these changes published; run only once the edge took them. */
  readonly save: () => Promise<void>;
}

const registry = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(contract => contract.id === "registry-runtime-bindings")!;

/** The pointers promoted since the reader edge last published, read by promotion time. */
export async function readReaderEdgeChanges(query: Query): Promise<ReaderEdgeChanges> {
  const rows = await query(CHANGES_SQL, [CURSOR]);
  const through = String(rows.find(row => row.through !== null)!.through);
  const pointers = rows.flatMap((row): EdgePointer[] => row.through !== null ? []
    : row.record_class === "FACTS" ? [{ recordClass: registry.recordClass, scope: registry.scope }]
      : [{ recordClass: row.record_class as RoutineRecordClass, scope: String(row.scope) }]);
  const unique = [...new Map(pointers.map(pointer => [`${pointer.recordClass}:${pointer.scope}`, pointer])).values()];
  return { pointers: unique, save: async () => { await query(SAVE_SQL, [CURSOR, through]); } };
}
