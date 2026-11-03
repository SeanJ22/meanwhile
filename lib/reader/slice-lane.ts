import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import type { WorkList } from "../core/work.ts";
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import { invalidateReaderCache, type ReaderCachePurger } from "./cache.ts";
import { cardInputs } from "./slice-meetings.ts";
import { boardsToBuild, buildSlices, LAST_CARD, MEETING_CARDS, SLICE_CARDS, writeSlices, type SliceCard } from "./slices.ts";

/** The lane's name on the read meter. Its bytes per hour are metered under it, so the breaker slows it alone if it ever reads far more than its own normal. */
export const SLICE_JOB = { id: "slices", databaseBytesPerRun: 32_000_000 } as const;
/** Slice rows taken in one go. A place's marked cards are built together, from one read of that place. */
const CLAIM_LIMIT = 10;
/** Places given their first slices in one go, taken from the most populated ZIPs down, and the least it rests after one. */
const BACKFILL_PLACES = 100;
const BACKFILL_ZIPS = 25;
/** ZIP groups looked through in one go when their places already have slices. */
const ZIP_LOOKS = 40;
const BACKFILL_PAUSE_MS = 3_000;
/** What the lane may move an hour, over both databases and everything it does: marked slices, calendars confirmed again, first slices, purges, claiming and finishing. Each go puts the time its bytes take to come due on a tab, kept across the lane's starts; nothing goes while the tab is owed, marked slices go before first slices, and marks the allowance cannot reach wait their turn. */
export const SLICE_BYTES_PER_HOUR = 27_000_000;
/** The wire carries about 2% more than the text, parameters and rows' JSON the lane counts; 5% is kept in hand. */
const WIRE_FACTOR = 1.05;
/** With nothing marked the lane looks again this soon. */
const IDLE_MS = 10_000;
/** Once every place has slices, new places are looked for this often. */
const SWEEP_EVERY_MS = 24 * 60 * 60_000;
const BACKFILL_CURSOR = "slices:backfill";
const TAB_CURSOR = "slices:tab";

export function slicesLane(run: (deadlineMs: number) => Promise<void>): IndependentRuntimeLane {
  return { id: SLICE_JOB.id, everyMs: 60_000, budgetMs: 55 * 60_000, run };
}

export interface SliceTurn { readonly claimed: number; readonly built: number; readonly written: number; readonly backfilled: number }
const NOTHING: SliceTurn = { claimed: 0, built: 0, written: 0, backfilled: 0 };

let sent = 0;
/** A query that adds up what it sent and what came back. Everything the lane asks of either database goes through one. */
export const metered = (query: Query): Query => async (text, params = []) => {
  sent += text.length + JSON.stringify(params).length;
  const rows = await query(text, params);
  sent += JSON.stringify(rows).length;
  return rows;
};
/** When the allowance has room again, as a time. */
const tab = { until: 0, loaded: false };
export const owedMs = (bytes: number): number => Math.ceil(bytes * WIRE_FACTOR / SLICE_BYTES_PER_HOUR * 3_600_000);

/** Work that ignores the turn's end cannot hold the turn open past it. */
const untilEnd = <T,>(end: AbortSignal | undefined, work: Promise<T>): Promise<T> => end ? Promise.race([work, new Promise<never>((_, reject) => {
  if (end.aborted) reject(end.reason); else end.addEventListener("abort", () => reject(end.reason), { once: true }); })]) : work;

/** Builds the cards asked for, leaving those whose inputs, as the database fingerprints them, are those the held card was built from. Writes what differs, then purges once the cached answers of the places written (a board's: of every place it is filed on). */
async function make(facts: Query, wanted: Map<string, Set<SliceCard>>, purge?: ReaderCachePurger): Promise<number> {
  const subjects = [...wanted].filter(([, cards]) => MEETING_CARDS.some(card => cards.has(card))).map(([subject]) => subject), inputs = new Map<string, string>();
  const [now, held] = await Promise.all([cardInputs(facts, subjects), facts("SELECT place_id||E'\\t'||card AS k,fingerprint FROM place_slice WHERE place_id=ANY($1::text[]) AND card=ANY($2::text[])", [subjects, MEETING_CARDS])]);
  const same = new Map(held.map(row => [String(row.k), row.fingerprint]));
  for (const subject of subjects) {
    const cards = wanted.get(subject)!;
    for (const card of MEETING_CARDS) if (cards.has(card)) { const key = `${subject}\t${card}`; if (same.get(key) === now.get(key)) cards.delete(card); else inputs.set(key, now.get(key)!); }
    if (!cards.size) wanted.delete(subject);
  }
  const built = await buildSlices(facts, wanted);
  const changed = new Set<string>(), written = await writeSlices(facts, built, inputs, changed);
  if (changed.size) await invalidateReaderCache({ places: [...changed, ...(await facts("SELECT DISTINCT place_id FROM entity_place WHERE entity_id=ANY($1::text[])", [[...changed]])).map(row => String(row.place_id))] }, purge, null);
  return written;
}

/** Rebuilds the slices the Slide marked. The rows taken are finished together. */
async function rebuildMarked(list: WorkList, facts: Query, end?: AbortSignal, purge?: ReaderCachePurger): Promise<SliceTurn> {
  const { owner, rows } = await list.take("slice", CLAIM_LIMIT);
  if (!rows.length) return NOTHING;
  const wanted = new Map<string, Set<SliceCard>>();
  for (const { subjectId, field } of rows) wanted.set(subjectId, (wanted.get(subjectId) ?? new Set<SliceCard>()).add(field as SliceCard));
  const built = wanted.size;
  try { const written = await untilEnd(end, make(facts, wanted, purge)); await list.finishTaken(owner); return { claimed: rows.length, built, written, backfilled: 0 }; }
  catch (error) { if (!end?.aborted) await list.laterTaken(owner, error instanceof Error ? error.message || "failed" : String(error)); throw error; }
}

/** Where the backfill is: the ZIP it has reached (most residents first), then, once every ZIP's places have slices, the rest of the places in id order. */
interface BackfillCursor { zip?: readonly [number, string]; zipsDone?: true; after?: string; doneAt?: string }

/** The next places without all their slices: those a published ZIP lays over, from the most populated ZIP down, then every other place. */
async function nextPlaces(facts: Query, held: BackfillCursor): Promise<{ readonly places: string[]; readonly cursor: BackfillCursor; readonly finished: boolean }> {
  let cursor = held;
  for (let looks = 0; !cursor.zipsDone && looks < ZIP_LOOKS; looks++) {
    const zips = await facts(`SELECT id,page_priority FROM entity WHERE page_priority>0 AND (page_priority,id)<($1::int,$2::text) ORDER BY page_priority DESC,id DESC LIMIT $3`,
      [cursor.zip?.[0] ?? 2_147_483_647, cursor.zip?.[1] ?? "", BACKFILL_ZIPS]);
    if (!zips.length) { cursor = { ...cursor, zipsDone: true }; break; }
    const places = await facts(`SELECT m.place_id FROM zip_place m JOIN entity z ON z.id='zip:'||m.zip JOIN entity e ON e.id=m.place_id AND e.kind='place'
      WHERE z.id=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM place_slice s WHERE s.place_id=m.place_id AND s.card=$2)
      GROUP BY m.place_id ORDER BY max(z.page_priority) DESC,m.place_id LIMIT $3`, [zips.map(row => String(row.id)), LAST_CARD, BACKFILL_PLACES]);
    // A group stays the cursor until every place it lays over has its slices; the ones built drop out of the next look.
    if (places.length) return { places: places.map(row => String(row.place_id)), cursor, finished: false };
    cursor = { ...cursor, zip: [Number(zips.at(-1)!.page_priority), String(zips.at(-1)!.id)] };
  }
  if (!cursor.zipsDone) return { places: [], cursor, finished: false };
  const rest = (await facts(`SELECT e.id FROM entity e WHERE e.kind='place' AND e.id>$1 AND NOT EXISTS(SELECT 1 FROM place_slice s WHERE s.place_id=e.id AND s.card=$3) ORDER BY e.id LIMIT $2`,
    [cursor.after ?? "", BACKFILL_PLACES, LAST_CARD])).map(row => String(row.id));
  return { places: rest, cursor: rest.length ? { ...cursor, after: rest.at(-1) } : cursor, finished: !rest.length };
}

/** Gives every place that lacks any of its slices its first, from the places most readers see to the rest. When all have them, new places are looked for once a day. */
async function backfill(facts: Query, now: Date, purge?: ReaderCachePurger): Promise<SliceTurn & { readonly done: boolean }> {
  const held = JSON.parse(await readPassCursor(facts, BACKFILL_CURSOR) ?? "{}") as BackfillCursor;
  if (held.doneAt && now.getTime() - Date.parse(held.doneAt) < SWEEP_EVERY_MS) return { ...NOTHING, done: true };
  const { places, cursor, finished } = await nextPlaces(facts, held.doneAt ? { zipsDone: true } : held);
  if (!places.length) {
    await writePassCursor(facts, BACKFILL_CURSOR, JSON.stringify(finished ? { doneAt: now.toISOString() } : cursor));
    return { ...NOTHING, done: finished };
  }
  const wanted = new Map<string, Set<SliceCard>>(places.map(place => [place, new Set<SliceCard>(SLICE_CARDS)]));
  for (const board of await boardsToBuild(facts, places)) wanted.set(board, new Set<SliceCard>(MEETING_CARDS));
  const built = wanted.size, written = await make(facts, wanted, purge);
  await writePassCursor(facts, BACKFILL_CURSOR, JSON.stringify(cursor));
  return { claimed: 0, built, written, backfilled: places.length, done: false };
}

/** One look: marked slices first, then, when none are marked, the next places without slices. */
export async function sliceTurn(input: { readonly list: WorkList; readonly facts: Query; readonly now?: Date; readonly turnEnd?: AbortSignal; readonly purge?: ReaderCachePurger }): Promise<SliceTurn & { readonly idle: boolean }> {
  const marked = await rebuildMarked(input.list, input.facts, input.turnEnd, input.purge);
  if (marked.claimed) return { ...marked, idle: false };
  const first = await untilEnd(input.turnEnd, backfill(input.facts, input.now ?? new Date(), input.purge));
  return { ...first, claimed: 0, idle: first.done };
}

/** The lane's turn: keeps looking until it is asked to stop, resting while the tab is owed so everything it does stays within its pace. `total.behind` is the marked slices still waiting after a go. */
export async function runSliceLane(input: { readonly list: WorkList; readonly facts: Query; readonly stopRequested: () => boolean; readonly turnEnd?: AbortSignal;
  readonly log: (line: string) => void; readonly sleep?: (ms: number) => Promise<void>; readonly clock?: () => number;
  /** Counts as they happen, for the turn's minute line. */ readonly total?: { built: number; written: number; backfilled: number; behind?: number } }): Promise<{ readonly built: number; readonly written: number; readonly backfilled: number }> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const total = input.total ?? { built: 0, written: 0, backfilled: 0 };
  const clock = input.clock ?? Date.now;
  if (!tab.loaded) { tab.until = Number(await readPassCursor(input.facts, TAB_CURSOR) ?? 0); tab.loaded = true; }
  while (!input.stopRequested()) {
    const start = clock();
    if (start < tab.until) { await sleep(Math.min(tab.until - start, IDLE_MS)); continue; }
    const before = sent;
    let turn: Awaited<ReturnType<typeof sliceTurn>> | undefined;
    try { turn = await sliceTurn({ list: input.list, facts: input.facts, turnEnd: input.turnEnd }); }
    catch (error) {
      // The rows it held come back when their lease runs out; the lane looks again after its own pause.
      if (!input.turnEnd?.aborted) input.log(`Slices: a look failed (${error instanceof Error ? error.message : String(error)}); the slices stay marked`);
    }
    tab.until = start + owedMs(sent - before);
    if (turn) {
      total.built += turn.built; total.written += turn.written; total.backfilled += turn.backfilled;
      if (turn.claimed) total.behind = await input.list.due("slice");
      if (turn.claimed || turn.backfilled) input.log(turn.backfilled ? `Slices: ${turn.backfilled} places given their first slices (${turn.written} written)` : `Slices: ${turn.claimed} marked slices rebuilt for ${turn.built} places (${turn.written} had changed), ${total.behind ?? 0} still waiting`);
    }
    if (!turn || turn.claimed || turn.backfilled) await writePassCursor(input.facts, TAB_CURSOR, String(tab.until)).catch(() => undefined);
    if (input.turnEnd?.aborted) break;
    if (!turn?.claimed) await sleep(turn?.backfilled ? BACKFILL_PAUSE_MS : IDLE_MS);
  }
  return total;
}
