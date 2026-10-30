import type { Query } from "../facts/publish.ts";
import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { WorkInput, WorkList } from "../core/work.ts";
import { FREE_TRY_MS, freeTry } from "./free-try.ts";

export const BLANK_PLANNER_CURSOR = "planner-blanks";
export const BLANK_PAGE = 5_000;
export const PLANNER_PAGES_PER_RUN = 10;
export const FREE_TRIES_PER_RUN = 25;
/** The planner's standing lane: it looks every few minutes, and a run that finds nothing reads one small page. */
export const PLANNER_JOB = { id: "planner", everyMs: 5 * 60_000, budgetMs: 4 * 60_000, databaseBytesPerRun: 40_000_000 } as const;
interface Position { readonly at: string; readonly entity: string; readonly field: string }

/**
 * The planner: the blanks that changed since its cursor are mapped to the places they sit in, and each place that has no hunt
 * waiting or taken gets one standing hunt row. A row is free work (`value.paid` false): only the free try works it, and it turns into
 * paid work when Sean's money points at the place or a reader asks. A place whose last free try is waiting out its day starts the next
 * one now, because something changed. The cursor moves only after the rows are saved, so a failed pass is read again.
 */
export async function planBlankChanges(deps: { readonly facts: Query; readonly list: WorkList; readonly now: () => string; readonly page?: number }) {
  const page = deps.page ?? BLANK_PAGE;
  const held = await readPassCursor(deps.facts, BLANK_PLANNER_CURSOR);
  const from: Position = held === null ? { at: "-infinity", entity: "", field: "" } : JSON.parse(held);
  const changed = await deps.facts(`SELECT entity_id, field, updated_at::text AS at FROM blank
    WHERE (updated_at, entity_id, field) > ($1::timestamptz, $2::text, $3::text) ORDER BY updated_at, entity_id, field LIMIT $4`,
  [from.at, from.entity, from.field, page]);
  if (changed.length === 0) return { changed: 0, places: 0, added: 0, again: 0 };
  // A place with more changed blanks is less complete, so it is served first within the coverage tier.
  const placed = await deps.facts(`SELECT p.place_id, count(*)::int AS open FROM unnest($1::text[], $2::text[]) AS c(entity_id, field)
    JOIN entity_place p ON p.entity_id = c.entity_id GROUP BY p.place_id`, [changed.map(row => String(row.entity_id)), changed.map(row => String(row.field))]);
  const at = deps.now();
  const rows = placed.map((place): WorkInput => ({ kind: "hunt", tier: "coverage", placeId: String(place.place_id), subjectId: String(place.place_id),
    series: `blank:${place.place_id}`, claimKey: at, priority: Number(place.open), value: { plain: false, paid: false }, origin: { from: "planner" },
    source: { source: "Open blanks changed" } }));
  let added = 0;
  for (let start = 0; start < rows.length; start += 1_000) added += await deps.list.ensure(rows.slice(start, start + 1_000));
  let again = 0;
  for (let start = 0; start < rows.length; start += 1_000) again += await deps.list.again(rows.slice(start, start + 1_000).map(row => row.series!));
  const last = changed.at(-1)!;
  await writePassCursor(deps.facts, BLANK_PLANNER_CURSOR, JSON.stringify({ at: String(last.at), entity: String(last.entity_id), field: String(last.field) } satisfies Position));
  return { changed: changed.length, places: rows.length, added, again };
}

/** The free tries the lane works this turn: each claimed place is looked at once and comes back on its day, or sooner when a blank changes. */
export async function runFreeTries(deps: { readonly facts: Query; readonly list: WorkList; readonly now: () => string }, limit: number): Promise<{ readonly tried: number; readonly pages: number }> {
  let tried = 0, pages = 0;
  for (const row of await deps.list.claim("hunt", limit, { unpaid: true })) {
    try {
      const result = await freeTry(deps, row);
      await deps.list.finish(row, FREE_TRY_MS, result.unlock);
      tried += 1;
      pages += result.pages;
    } catch (error) { await deps.list.later(row, error instanceof Error ? error.message.slice(0, 300) : "The free try did not finish"); }
  }
  return { tried, pages };
}

/** The finished hunts that come due again start their next rows, and old finished rows go. */
export async function keepPlannerList(list: WorkList, now: number): Promise<{ readonly spawned: number; readonly retired: number }> {
  const day = 86_400_000;
  return { spawned: await list.spawnDue(),
    retired: await list.retire({ rowsBefore: new Date(now - 7 * day).toISOString(), ordersBefore: new Date(now - 30 * day).toISOString() }) };
}
