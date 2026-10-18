import type { Query } from "../facts/publish.ts";
import type { RoutineRecordClass } from "./types.ts";
import { UNCHANGED_CONFIRMATION_PREFIX } from "./unchanged-confirmation.ts";

const CURSOR = "reader-edge";
const PROGRESS = "reader-edge:pieces";
const OWED = "reader-edge:owed";
// A promotion stamped just before the last publish read the clock may commit after it.
const OVERLAP = "1 minute";
/** At most this many pointers are read at once, so a first publication of the whole country goes a page at a time. */
export const READER_EDGE_PAGE = 5_000;

// The cursor is a time (read again with the overlap), or, inside a long catch-up, the exact last pointer of a full page.
const SINCE = `(SELECT CASE WHEN position LIKE '{%' THEN (position::jsonb->>'at')::timestamptz ELSE position::timestamptz - interval '${OVERLAP}' END FROM pass_cursor WHERE name = $1)`;
const AFTER = `(SELECT CASE WHEN position LIKE '{%' THEN position::jsonb END FROM pass_cursor WHERE name = $1)`;
// Index ranges over promotions and confirmations, so a quiet minute reads no pointer rows.
const CHANGES_SQL = `WITH moved AS (
    SELECT p.record_class, p.scope, p.promoted_at AS at FROM civic_data_promotions p WHERE ${SINCE} IS NULL OR p.promoted_at >= ${SINCE}
    UNION ALL SELECT p.record_class, p.scope, e.at FROM civic_data_candidate_events e
      JOIN civic_data_candidates c ON c.id = e.candidate_id
      JOIN civic_data_promotions p ON p.record_class = c.record_class AND p.scope = c.scope AND p.current_version_id = c.id
      WHERE left(e.detail, ${UNCHANGED_CONFIRMATION_PREFIX.length}) = '${UNCHANGED_CONFIRMATION_PREFIX}' AND (${SINCE} IS NULL OR e.at >= ${SINCE})),
  latest AS (SELECT record_class, scope, max(at) AS at FROM moved GROUP BY record_class, scope)
  (SELECT record_class, scope, to_json(at)#>>'{}' AS at, NULL::text AS meta FROM latest
    WHERE ${AFTER} IS NULL OR (at, record_class, scope) > ((${AFTER}->>'at')::timestamptz, ${AFTER}->>'class', ${AFTER}->>'scope')
    ORDER BY at, record_class, scope LIMIT $4)
  UNION ALL SELECT NULL, NULL, NULL, json_build_object('now', now(), 'cursor', (SELECT position FROM pass_cursor WHERE name = $1),
    'progress', (SELECT position FROM pass_cursor WHERE name = $2), 'owed', (SELECT position FROM pass_cursor WHERE name = $3))::text`;

const PROGRESS_SQL = `INSERT INTO pass_cursor (name, position) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET position = EXCLUDED.position`;
const SAVE_SQL = `WITH finished AS (DELETE FROM pass_cursor WHERE name = $3),
    owed AS (INSERT INTO pass_cursor (name, position) SELECT $4, $5 WHERE $5::text IS NOT NULL ON CONFLICT (name) DO UPDATE SET position = EXCLUDED.position),
    cleared AS (DELETE FROM pass_cursor WHERE name = $4 AND $5::text IS NULL)
  INSERT INTO pass_cursor (name, position) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET position = EXCLUDED.position`;

export interface EdgePointer { readonly recordClass: RoutineRecordClass; readonly scope: string }

interface Progress { readonly since: string | null; readonly through: string; readonly done: readonly string[] }

export interface ReaderEdgeChanges {
  /** The pointers promoted or confirmed since the edge last published, a page at most. */
  readonly pointers: readonly EdgePointer[];
  /** More pages follow this one. */
  readonly more: boolean;
  /** Pieces an earlier, unfinished publication of these same changes already published. */
  readonly done: ReadonlySet<string>;
  /** Pieces that failed when last tried, with when, owed whatever moves next. */
  readonly owed: ReadonlyMap<string, string>;
  /** Records one piece as published, so a restart resumes after it. */
  readonly saveDone: (piece: string) => Promise<void>;
  /** Marks these changes published once every piece was tried, keeping the ones that failed owed. */
  readonly save: (owed: ReadonlyMap<string, string>) => Promise<void>;
}

/** What moved since the reader edge last published, read by promotion and confirmation time. */
export async function readReaderEdgeChanges(query: Query): Promise<ReaderEdgeChanges> {
  const rows = await query(CHANGES_SQL, [CURSOR, PROGRESS, OWED, READER_EDGE_PAGE]);
  const meta = JSON.parse(String(rows.find(row => row.meta !== null)!.meta)) as { now: string; cursor: string | null; progress: string | null; owed: string | null };
  const page = rows.filter(row => row.meta === null), more = page.length === READER_EDGE_PAGE, last = page.at(-1);
  const held = meta.progress === null ? null : JSON.parse(meta.progress) as Progress;
  const resumed = held?.since === meta.cursor ? held : null;
  const through = resumed?.through ?? (more ? JSON.stringify({ at: last!.at, class: last!.record_class, scope: last!.scope }) : meta.now);
  const done = new Set(resumed?.done ?? []);
  return {
    pointers: page.map(row => ({ recordClass: row.record_class as RoutineRecordClass, scope: String(row.scope) })),
    more, done, owed: new Map(Object.entries(meta.owed === null ? {} : JSON.parse(meta.owed) as Record<string, string>)),
    saveDone: async piece => {
      done.add(piece);
      await query(PROGRESS_SQL, [PROGRESS, JSON.stringify({ since: meta.cursor, through, done: [...done] } satisfies Progress)]);
    },
    save: async owed => { await query(SAVE_SQL, [CURSOR, through, PROGRESS, OWED, owed.size ? JSON.stringify(Object.fromEntries(owed)) : null]); },
  };
}
