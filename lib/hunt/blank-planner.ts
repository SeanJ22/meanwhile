import type { Query } from "../facts/publish.ts";
import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { WorkInput, WorkList } from "../core/work.ts";

export const BLANK_PLANNER_CURSOR = "planner-blanks";
export const BLANK_PAGE = 5_000;
export const PLANNER_PAGES_PER_RUN = 10;
/** The planner's standing lane: it looks every few minutes, and a run that finds nothing reads one small page. */
export const PLANNER_JOB = { id: "planner", everyMs: 5 * 60_000, budgetMs: 4 * 60_000, databaseBytesPerRun: 20_000_000 } as const;
/** A place's open blanks are counted only this far; the count orders places, it is not a report. */
const OPEN_COUNT_CAP = 1_000;

interface Position { readonly at: string; readonly entity: string; readonly field: string }

/**
 * The planner: the blanks that changed since its cursor are mapped to the places they sit in, and each place that has no hunt
 * waiting or taken gets one standing hunt row. A row is free work: it may spend only where money was pointed (see `ClaimWhere`).
 * The cursor moves only after the rows are saved, so a failed pass is read again.
 */
export async function planBlankChanges(deps: { readonly facts: Query; readonly list: WorkList; readonly now: () => string; readonly page?: number }) {
  const page = deps.page ?? BLANK_PAGE;
  const held = await readPassCursor(deps.facts, BLANK_PLANNER_CURSOR);
  const from: Position = held === null ? { at: "-infinity", entity: "", field: "" } : JSON.parse(held);
  const changed = await deps.facts(`SELECT entity_id, field, updated_at::text AS at FROM blank
    WHERE (updated_at, entity_id, field) > ($1::timestamptz, $2::text, $3::text) ORDER BY updated_at, entity_id, field LIMIT $4`,
  [from.at, from.entity, from.field, page]);
  if (changed.length === 0) return { changed: 0, places: 0, added: 0 };
  const placed = await deps.facts(`SELECT p.place_id, (SELECT count(*)::int FROM (SELECT 1 FROM entity_place q JOIN blank b ON b.entity_id = q.entity_id
      WHERE q.place_id = p.place_id LIMIT ${OPEN_COUNT_CAP}) c) AS open
    FROM (SELECT DISTINCT place_id FROM entity_place WHERE entity_id = ANY($1::text[])) p`, [[...new Set(changed.map(row => String(row.entity_id)))]]);
  const at = deps.now();
  const rows = placed.map((place): WorkInput => ({ kind: "hunt", tier: "coverage", placeId: String(place.place_id), subjectId: String(place.place_id),
    series: `blank:${place.place_id}`, claimKey: at, priority: Number(place.open), value: { plain: false, paid: false }, origin: { from: "planner" },
    source: { source: "Open blanks changed" } }));
  let added = 0;
  for (let start = 0; start < rows.length; start += 1_000) added += await deps.list.ensure(rows.slice(start, start + 1_000));
  const last = changed.at(-1)!;
  await writePassCursor(deps.facts, BLANK_PLANNER_CURSOR, JSON.stringify({ at: String(last.at), entity: String(last.entity_id), field: String(last.field) } satisfies Position));
  return { changed: changed.length, places: rows.length, added };
}

/** The finished hunts that come due again start their next rows, and old finished rows go. */
export async function keepPlannerList(list: WorkList, now: number): Promise<{ readonly spawned: number; readonly retired: number }> {
  const day = 86_400_000;
  return { spawned: await list.spawnDue(),
    retired: await list.retire({ rowsBefore: new Date(now - 7 * day).toISOString(), ordersBefore: new Date(now - 30 * day).toISOString() }) };
}
