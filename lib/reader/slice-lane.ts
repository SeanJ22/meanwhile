import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import type { WorkList } from "../core/work.ts";
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import { buildSlices, SLICE_CARDS, writeSlices, type SliceCard } from "./slices.ts";

/** The lane's name on the read meter. Its bytes per hour are metered under it, so the breaker slows it alone if it ever reads far more than its own normal. */
export const SLICE_JOB = { id: "slices", databaseBytesPerRun: 32_000_000 } as const;
/** Slice rows taken in one go. A place's marked cards are built together, from one read of that place. */
const CLAIM_LIMIT = 100;
/** Places given their first slices in one go, and the least it rests after one. */
const BACKFILL_PLACES = 100;
const BACKFILL_PAUSE_MS = 20_000;
/** What the lane may read an hour, marked rebuilds included. Each look puts the time its bytes take on a tab (the wire carries a fifth more than the rows' JSON); places nobody asked for are built only while the tab is clear, so marked slices never wait. */
export const SLICE_BYTES_PER_HOUR = 27_000_000;
export const owedMs = (bytes: number): number => Math.ceil(bytes * 1.2 / SLICE_BYTES_PER_HOUR * 3_600_000);
const tab = { owed: 0, at: 0 };
/** With nothing marked the lane looks again this soon. */
const IDLE_MS = 10_000;
/** Once every place has slices, new places are looked for this often. */
const SWEEP_EVERY_MS = 24 * 60 * 60_000;
const BACKFILL_CURSOR = "slices:backfill";

export function slicesLane(run: (deadlineMs: number) => Promise<void>): IndependentRuntimeLane {
  return { id: SLICE_JOB.id, everyMs: 60_000, budgetMs: 55 * 60_000, run };
}

export interface SliceTurn { readonly claimed: number; readonly built: number; readonly written: number; readonly backfilled: number; readonly read?: number }
const NOTHING: SliceTurn = { claimed: 0, built: 0, written: 0, backfilled: 0 };

/** Work that ignores the turn's end cannot hold the turn open past it. */
const untilEnd = <T,>(end: AbortSignal | undefined, work: Promise<T>): Promise<T> => end ? Promise.race([work, new Promise<never>((_, reject) => {
  if (end.aborted) reject(end.reason); else end.addEventListener("abort", () => reject(end.reason), { once: true }); })]) : work;

/** Rebuilds the slices the Slide marked. A slice that reads the same as the one held is not written. At the turn's end the marked slices go back to waiting. */
async function rebuildMarked(list: WorkList, facts: Query, end?: AbortSignal): Promise<SliceTurn> {
  const claims = await list.claim("slice", CLAIM_LIMIT);
  if (!claims.length) return NOTHING;
  const wanted = new Map<string, Set<SliceCard>>();
  for (const claim of claims) wanted.set(claim.subjectId!, (wanted.get(claim.subjectId!) ?? new Set<SliceCard>()).add(claim.field as SliceCard));
  try {
    const written = await untilEnd(end, (async () => writeSlices(facts, await buildSlices(facts, wanted)))());
    for (const claim of claims) await list.finish(claim);
    return { claimed: claims.length, built: wanted.size, written, backfilled: 0 };
  } catch (error) {
    for (const claim of claims) await (end?.aborted ? list.release(claim) : list.later(claim, error instanceof Error ? error.message : String(error)));
    throw error;
  }
}

/** Gives every place that has no slices its first, a hundred at a time, in place order. When all have them, new places are looked for once a day. */
async function backfill(facts: Query, now: Date): Promise<SliceTurn & { readonly done: boolean }> {
  const held = JSON.parse(await readPassCursor(facts, BACKFILL_CURSOR) ?? "{}") as { after?: string; doneAt?: string };
  if (held.doneAt && now.getTime() - Date.parse(held.doneAt) < SWEEP_EVERY_MS) return { ...NOTHING, done: true };
  const places = (await facts(`SELECT e.id FROM entity e WHERE e.kind='place' AND e.id>$1 AND NOT EXISTS(SELECT 1 FROM place_slice s WHERE s.place_id=e.id AND s.card='governs') ORDER BY e.id LIMIT $2`, [held.after ?? "", BACKFILL_PLACES])).map(row => String(row.id));
  if (!places.length) { await writePassCursor(facts, BACKFILL_CURSOR, JSON.stringify({ doneAt: now.toISOString() })); return { ...NOTHING, done: true }; }
  const written = await writeSlices(facts, await buildSlices(facts, new Map(places.map(place => [place, new Set(SLICE_CARDS)]))));
  await writePassCursor(facts, BACKFILL_CURSOR, JSON.stringify({ after: places.at(-1) }));
  return { claimed: 0, built: places.length, written, backfilled: places.length, done: false };
}

/** One look: marked slices first, then, when none are marked and `backfill` is not held back, the next places without slices. `read` is what it took from the database. */
export async function sliceTurn(input: { readonly list: WorkList; readonly facts: Query; readonly now?: Date; readonly turnEnd?: AbortSignal; readonly backfill?: boolean }): Promise<SliceTurn & { readonly idle: boolean }> {
  let read = 0;
  const facts: Query = async (text, params) => { const rows = await input.facts(text, params); read += JSON.stringify(rows).length; return rows; };
  const marked = await rebuildMarked(input.list, facts, input.turnEnd);
  if (marked.claimed || input.backfill === false) return { ...marked, read, idle: false };
  const first = await untilEnd(input.turnEnd, backfill(facts, input.now ?? new Date()));
  return { claimed: 0, built: first.built, written: first.written, backfilled: first.backfilled, read, idle: first.done };
}

/** The lane's turn: keeps looking until it is asked to stop, resting between looks so building every place stays within its pace. */
export async function runSliceLane(input: { readonly list: WorkList; readonly facts: Query; readonly stopRequested: () => boolean; readonly turnEnd?: AbortSignal;
  readonly log: (line: string) => void; readonly sleep?: (ms: number) => Promise<void>; readonly clock?: () => number;
  /** Counts as they happen, for the turn's minute line. */ readonly total?: { built: number; written: number; backfilled: number } }): Promise<{ readonly built: number; readonly written: number; readonly backfilled: number }> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const total = input.total ?? { built: 0, written: 0, backfilled: 0 };
  const clock = input.clock ?? Date.now;
  tab.at ||= clock();
  while (!input.stopRequested()) {
    let turn: Awaited<ReturnType<typeof sliceTurn>>;
    tab.owed = Math.max(0, tab.owed - (clock() - tab.at)); tab.at = clock();
    try { turn = await sliceTurn({ list: input.list, facts: input.facts, turnEnd: input.turnEnd, backfill: tab.owed === 0 }); }
    catch (error) {
      if (input.turnEnd?.aborted) break;
      // The rows it held go back to waiting with a growing pause; the lane looks again after its own.
      input.log(`Slices: a look failed (${error instanceof Error ? error.message : String(error)}); the slices stay marked`);
      await sleep(IDLE_MS); continue;
    }
    total.built += turn.built; total.written += turn.written; total.backfilled += turn.backfilled; tab.owed += owedMs(turn.read ?? 0);
    if (turn.backfilled) input.log(`Slices: ${turn.backfilled} places given their first slices (${turn.written} written)`);
    else if (turn.claimed) input.log(`Slices: ${turn.claimed} marked slices rebuilt for ${turn.built} places (${turn.written} had changed)`);
    if (turn.claimed) continue;
    await sleep(turn.backfilled ? BACKFILL_PAUSE_MS : IDLE_MS);
  }
  return total;
}
