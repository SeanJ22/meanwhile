import type { Query } from "../facts/publish.ts";
import type { RoutineRecordClass } from "./types.ts";
import { UNCHANGED_CONFIRMATION_PREFIX } from "./unchanged-confirmation.ts";

const CURSOR = "reader-edge";
const PROGRESS = "reader-edge:pieces";
// A promotion stamped just before the last publish read the clock may commit after it.
const OVERLAP = "1 minute";

// A first read takes every pointer; after it, index ranges over promotions and confirmations, so a quiet minute reads no pointer rows.
const CHANGES_SQL = `WITH since AS (SELECT (SELECT position::timestamptz - interval '${OVERLAP}' FROM pass_cursor WHERE name = $1) AS at)
  SELECT p.record_class, p.scope, NULL::text AS meta FROM civic_data_promotions p WHERE (SELECT at FROM since) IS NULL
  UNION SELECT p.record_class, p.scope, NULL FROM civic_data_promotions p WHERE p.promoted_at > (SELECT at FROM since)
  UNION SELECT p.record_class, p.scope, NULL FROM civic_data_candidate_events e
    JOIN civic_data_candidates c ON c.id = e.candidate_id
    JOIN civic_data_promotions p ON p.record_class = c.record_class AND p.scope = c.scope AND p.current_version_id = c.id
    WHERE left(e.detail, ${UNCHANGED_CONFIRMATION_PREFIX.length}) = '${UNCHANGED_CONFIRMATION_PREFIX}' AND e.at > (SELECT at FROM since)
  UNION ALL SELECT NULL, NULL, json_build_object('now', now(), 'cursor', (SELECT position FROM pass_cursor WHERE name = $1),
    'progress', (SELECT position FROM pass_cursor WHERE name = $2))::text`;

const PROGRESS_SQL = `INSERT INTO pass_cursor (name, position) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET position = EXCLUDED.position`;
const SAVE_SQL = `WITH finished AS (DELETE FROM pass_cursor WHERE name = $3)
  INSERT INTO pass_cursor (name, position) VALUES ($1, $2)
  ON CONFLICT (name) DO UPDATE SET position = GREATEST(pass_cursor.position::timestamptz, EXCLUDED.position::timestamptz)::text`;

export interface EdgePointer { readonly recordClass: RoutineRecordClass; readonly scope: string }

interface Progress { readonly since: string | null; readonly through: string; readonly done: readonly string[] }

export interface ReaderEdgeChanges {
  /** The pointers promoted or confirmed since the edge last published. */
  readonly pointers: readonly EdgePointer[];
  /** Pieces an earlier, unfinished publication of these same changes already published. */
  readonly done: ReadonlySet<string>;
  /** Records one piece as published, so a restart resumes after it. */
  readonly saveDone: (piece: string) => Promise<void>;
  /** Marks these changes published; run only once every piece took them. */
  readonly save: () => Promise<void>;
}

/** What moved since the reader edge last published, read by promotion and confirmation time. */
export async function readReaderEdgeChanges(query: Query): Promise<ReaderEdgeChanges> {
  const rows = await query(CHANGES_SQL, [CURSOR, PROGRESS]);
  const meta = JSON.parse(String(rows.find(row => row.meta !== null)!.meta)) as { now: string; cursor: string | null; progress: string | null };
  const held = meta.progress === null ? null : JSON.parse(meta.progress) as Progress;
  const resumed = held?.since === meta.cursor ? held : null;
  const through = resumed?.through ?? meta.now;
  const done = new Set(resumed?.done ?? []);
  const pointers = rows.flatMap((row): EdgePointer[] => row.meta !== null ? []
    : [{ recordClass: row.record_class as RoutineRecordClass, scope: String(row.scope) }]);
  return {
    pointers, done,
    saveDone: async piece => {
      done.add(piece);
      await query(PROGRESS_SQL, [PROGRESS, JSON.stringify({ since: meta.cursor, through, done: [...done] } satisfies Progress)]);
    },
    save: async () => { await query(SAVE_SQL, [CURSOR, through, PROGRESS]); },
  };
}
