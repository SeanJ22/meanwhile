import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import type { WorkList } from "../core/work.ts";
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import { agendaInputs, confirmedMeetings } from "./slice-meetings.ts";
import { boardsToBuild, buildSlices, CONFIRMED, LAST_CARD, MEETING_CARDS, SLICE_CARDS, writeSlices, type SliceCard } from "./slices.ts";

/** The lane's name on the read meter. Its bytes per hour are metered under it, so the breaker slows it alone if it ever reads far more than its own normal. */
export const SLICE_JOB = { id: "slices", databaseBytesPerRun: 32_000_000 } as const;
/** Slice rows taken in one go. A place's marked cards are built together, from one read of that place. */
const CLAIM_LIMIT = 100;
/** Places given their first slices in one go, taken from the most populated ZIPs down, and the least it rests after one. */
const BACKFILL_PLACES = 100;
const BACKFILL_ZIPS = 25;
/** ZIP groups looked through in one go when their places already have slices. */
const ZIP_LOOKS = 40;
const BACKFILL_PAUSE_MS = 3_000;
/** What the lane may move an hour, over both databases and everything it does. Each go puts the time its bytes take to come due on a tab; places nobody has asked for are built only while the tab is clear, and marked slices never wait. */
export const SLICE_BYTES_PER_HOUR = 27_000_000;
/** The wire carries a little more than the statements and rows' JSON the lane counts. */
const WIRE_FACTOR = 1.2;
/** With nothing marked the lane looks again this soon. */
const IDLE_MS = 10_000;
/** Once every place has slices, new places are looked for this often. */
const SWEEP_EVERY_MS = 24 * 60 * 60_000;
const BACKFILL_CURSOR = "slices:backfill";
/** When the time owed runs out, kept so a lane that starts again does not begin with a clear tab. */
const TAB_CURSOR = "slices:tab";

export function slicesLane(run: (deadlineMs: number) => Promise<void>): IndependentRuntimeLane {
  return { id: SLICE_JOB.id, everyMs: 60_000, budgetMs: 55 * 60_000, run };
}

export interface SliceTurn { readonly claimed: number; readonly built: number; readonly written: number; readonly backfilled: number; readonly read?: number }
const NOTHING: SliceTurn = { claimed: 0, built: 0, written: 0, backfilled: 0 };

let sent = 0;
/** A query that adds up what it sent and what came back, as the production meter does. Everything the lane asks of either database goes through one. */
export const metered = (query: Query): Query => async (text, params = []) => {
  sent += text.length + JSON.stringify(params).length;
  const rows = await query(text, params);
  sent += JSON.stringify(rows).length;
  return rows;
};
/** The time moving this many bytes takes up of the hour's allowance. */
export const owedMs = (bytes: number): number => Math.ceil(bytes * WIRE_FACTOR / SLICE_BYTES_PER_HOUR * 3_600_000);
/** What the lane still owes, kept across its turns (and, by `TAB_CURSOR`, across its starts) so each new turn does not begin with a clear tab. */
const tab = { owed: 0, at: 0 };

/** Work that ignores the turn's end cannot hold the turn open past it. */
const untilEnd = <T,>(end: AbortSignal | undefined, work: Promise<T>): Promise<T> => end ? Promise.race([work, new Promise<never>((_, reject) => {
  if (end.aborted) reject(end.reason); else end.addEventListener("abort", () => reject(end.reason), { once: true }); })]) : work;

/** Rows the lane holds are looked over for leases that ran out (a turn that died) this often; taking rows does not look. */
const RECOVER_EVERY_MS = 60_000;
let recoveredAt = 0;

/**
 * Takes out of `wanted` the agenda cards whose inputs, fingerprinted by the database, are those the held card was built from: their papers are not read. Returns
 * the fingerprints of the cards that stay, to be kept with them.
 */
async function leaveUnchangedAgendas(facts: Query, wanted: Map<string, Set<SliceCard>>): Promise<Map<string, string>> {
  const boards = [...wanted].filter(([, cards]) => cards.has("agenda")).map(([board]) => board), kept = new Map<string, string>();
  if (!boards.length) return kept;
  const [now, held] = await Promise.all([agendaInputs(facts, boards), facts("SELECT place_id,inputs FROM place_slice WHERE card='agenda' AND place_id=ANY($1::text[])", [boards])]);
  const heldBy = new Map(held.map(row => [String(row.place_id), row.inputs]));
  for (const [board, inputs] of now) {
    if (heldBy.get(board) === inputs) { wanted.get(board)!.delete("agenda"); if (!wanted.get(board)!.size) wanted.delete(board); } else kept.set(`${board}\tagenda`, inputs);
  }
  return kept;
}

/**
 * Rebuilds the slices the Slide marked. A slice that reads the same as the one held is not written; a calendar only confirmed again is brought up to date in
 * the card held, with no rows read. The rows taken are finished together, or at the turn's end go back to waiting.
 */
async function rebuildMarked(list: WorkList, facts: Query, end?: AbortSignal): Promise<SliceTurn> {
  if (Date.now() - recoveredAt >= RECOVER_EVERY_MS) { await list.recover(); recoveredAt = Date.now(); }
  const { owner, rows } = await list.take("slice", CLAIM_LIMIT);
  if (!rows.length) return NOTHING;
  const wanted = new Map<string, Set<SliceCard>>(), confirmed = new Set<string>();
  for (const { subjectId, field } of rows) if (field === CONFIRMED) confirmed.add(subjectId); else wanted.set(subjectId, (wanted.get(subjectId) ?? new Set<SliceCard>()).add(field as SliceCard));
  try {
    const written = await untilEnd(end, (async () => {
      const inputs = await leaveUnchangedAgendas(facts, wanted), built = await buildSlices(facts, wanted);
      for (const [board, cards] of await confirmedMeetings(facts, [...confirmed].filter(board => !wanted.get(board)?.has("meetings")))) built.set(board, new Map([...built.get(board) ?? [], ...cards]));
      return writeSlices(facts, built, inputs);
    })());
    await list.finishTaken(owner);
    return { claimed: rows.length, built: wanted.size + confirmed.size, written, backfilled: 0 };
  } catch (error) {
    await (end?.aborted ? list.releaseTaken(owner) : list.laterTaken(owner, error instanceof Error ? error.message : String(error)));
    throw error;
  }
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
async function backfill(facts: Query, now: Date): Promise<SliceTurn & { readonly done: boolean }> {
  const held = JSON.parse(await readPassCursor(facts, BACKFILL_CURSOR) ?? "{}") as BackfillCursor;
  if (held.doneAt && now.getTime() - Date.parse(held.doneAt) < SWEEP_EVERY_MS) return { ...NOTHING, done: true };
  const { places, cursor, finished } = await nextPlaces(facts, held.doneAt ? { zipsDone: true } : held);
  if (!places.length) {
    await writePassCursor(facts, BACKFILL_CURSOR, JSON.stringify(finished ? { doneAt: now.toISOString() } : cursor));
    return { ...NOTHING, done: finished };
  }
  const wanted = new Map<string, Set<SliceCard>>(places.map(place => [place, new Set<SliceCard>(SLICE_CARDS)]));
  for (const board of await boardsToBuild(facts, places)) wanted.set(board, new Set<SliceCard>(MEETING_CARDS));
  const written = await writeSlices(facts, await buildSlices(facts, wanted));
  await writePassCursor(facts, BACKFILL_CURSOR, JSON.stringify(cursor));
  return { claimed: 0, built: wanted.size, written, backfilled: places.length, done: false };
}

/** One look: marked slices first, then, when none are marked and `backfill` is not held back, the next places without slices. `read` is what it moved over the metered queries. */
export async function sliceTurn(input: { readonly list: WorkList; readonly facts: Query; readonly now?: Date; readonly turnEnd?: AbortSignal; readonly backfill?: boolean }): Promise<SliceTurn & { readonly idle: boolean }> {
  const before = sent, read = () => sent - before;
  const marked = await rebuildMarked(input.list, input.facts, input.turnEnd);
  if (marked.claimed) return { ...marked, read: read(), idle: false };
  if (input.backfill === false) return { ...NOTHING, read: read(), idle: false };
  const first = await untilEnd(input.turnEnd, backfill(input.facts, input.now ?? new Date()));
  return { claimed: 0, built: first.built, written: first.written, backfilled: first.backfilled, read: read(), idle: first.done };
}

/** The lane's turn: keeps looking until it is asked to stop, resting between looks so building every place stays within its pace. */
export async function runSliceLane(input: { readonly list: WorkList; readonly facts: Query; readonly stopRequested: () => boolean; readonly turnEnd?: AbortSignal;
  readonly log: (line: string) => void; readonly sleep?: (ms: number) => Promise<void>; readonly clock?: () => number;
  /** Counts as they happen, for the turn's minute line. */ readonly total?: { built: number; written: number; backfilled: number } }): Promise<{ readonly built: number; readonly written: number; readonly backfilled: number }> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const total = input.total ?? { built: 0, written: 0, backfilled: 0 };
  const clock = input.clock ?? Date.now;
  if (!tab.at) tab.owed = Math.max(0, Number(await readPassCursor(input.facts, TAB_CURSOR) ?? 0) - clock());
  tab.at ||= clock();
  while (!input.stopRequested()) {
    let turn: Awaited<ReturnType<typeof sliceTurn>>;
    tab.owed = Math.max(0, tab.owed - (clock() - tab.at)); tab.at = clock();
    const before = sent;
    try { turn = await sliceTurn({ list: input.list, facts: input.facts, turnEnd: input.turnEnd, backfill: tab.owed === 0 }); }
    catch (error) {
      tab.owed += owedMs(sent - before);
      if (input.turnEnd?.aborted) break;
      // The rows it held go back to waiting with a growing pause; the lane looks again after its own.
      input.log(`Slices: a look failed (${error instanceof Error ? error.message : String(error)}); the slices stay marked`);
      await sleep(IDLE_MS); continue;
    }
    total.built += turn.built; total.written += turn.written; total.backfilled += turn.backfilled; tab.owed += owedMs(turn.read ?? 0);
    if (turn.claimed || turn.backfilled) await writePassCursor(input.facts, TAB_CURSOR, String(clock() + tab.owed));
    if (turn.backfilled) input.log(`Slices: ${turn.backfilled} places given their first slices (${turn.written} written)`);
    else if (turn.claimed) input.log(`Slices: ${turn.claimed} marked slices rebuilt for ${turn.built} places (${turn.written} had changed)`);
    if (turn.claimed) continue;
    await sleep(turn.backfilled ? BACKFILL_PAUSE_MS : IDLE_MS);
  }
  return total;
}
