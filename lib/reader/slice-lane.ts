import { processNeonBytes } from "../db/transfer-by-caller.ts";
import { readPassCursor, writePassCursor } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import type { WorkList, WorkRow } from "../core/work.ts";
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import { invalidateReaderCache, type ReaderCachePurger } from "./cache.ts";
import { cardsAsBuilt } from "./slice-meetings.ts";
import { boardsToBuild, buildSlices, ENTITY_CARDS, LAST_CARD, MEETING_CARDS, writeSlices, type SliceCard } from "./slices.ts";

/** The lane's name on the read meter. Its bytes per hour are metered under it, so the breaker slows it alone if it ever reads far more than its own normal. */
export const SLICE_JOB = { id: "slices", databaseBytesPerRun: 32_000_000 } as const;
/** Slice rows taken in one go. A place's marked cards are built together, from one read of that place. */
const CLAIM_LIMIT = 20;
/** Places given their first slices in one go, taken from the most populated ZIPs down, and the least it rests after one. */
const BACKFILL_PLACES = 100;
const BACKFILL_ZIPS = 25;
/** ZIP groups looked through in one go when their places already have slices. */
const ZIP_LOOKS = 40;
/** Subjects whose meetings cards are first built together. A board's older calendars took 2-7 seconds each to read alone (production, 8 Nov), against a 30 second limit, so three boards stay near 20 seconds at worst; a place's meetings read only its state's one family calendar, so twenty go together. */
const BOARD_MEETINGS_GROUP = 3;
const PLACE_MEETINGS_GROUP = 20;
const BACKFILL_PAUSE_MS = 3_000;
/** What the lane may move an hour, over both databases and everything it does: marked slices, first slices, purges, claiming and finishing. Each go puts the time its bytes take to come due on a tab, kept across the lane's starts; nothing goes while the tab is owed, marked slices go before first slices, and marks the allowance cannot reach wait their turn. */
export const SLICE_BYTES_PER_HOUR = 27_000_000;
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

/** Everything the database meter has counted in this process, requests and responses of both databases: the lane owes the time exactly these bytes take. */
const spent = (): number => processNeonBytes().reduce((sum, hour) => sum + hour.bytes.reader + hour.bytes["control-plane"] + (hour.sent?.reader.bytes ?? 0) + (hour.sent?.["control-plane"].bytes ?? 0), 0);
/** When the allowance has room again, as a time; 5% over what the meter counts is owed, for the hour's edges and a go that runs past it. */
const tab = { until: 0, loaded: false };
export const owedMs = (bytes: number): number => Math.ceil(bytes * 1.05 / SLICE_BYTES_PER_HOUR * 3_600_000);

const chunks = <T,>(list: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Work that ignores the turn's end cannot hold the turn open past it. */
const untilEnd = <T,>(end: AbortSignal | undefined, work: Promise<T>): Promise<T> => end ? Promise.race([work, new Promise<never>((_, reject) => {
  if (end.aborted) reject(end.reason); else end.addEventListener("abort", () => reject(end.reason), { once: true }); })]) : work;

/** Builds the cards asked for, leaving those whose inputs, as the database fingerprints them, are those the held card was built from. Writes what differs, then purges once the cached answers of the places written (a board's: of every place it is filed on). */
async function make(facts: Query, wanted: Map<string, Set<SliceCard>>, purge?: ReaderCachePurger): Promise<number> {
  const { now, asBuilt } = await cardsAsBuilt(facts, [...wanted].filter(([, cards]) => MEETING_CARDS.some(card => cards.has(card))).map(([subject]) => subject)), inputs = new Map<string, string>();
  for (const [subject, cards] of wanted) {
    for (const card of MEETING_CARDS) if (cards.has(card)) { const key = `${subject}\t${card}`; if (asBuilt.has(key)) cards.delete(card); else inputs.set(key, now.get(key)!); }
    if (!cards.size) wanted.delete(subject);
  }
  const changed = new Set<string>(), written = await writeSlices(facts, await buildSlices(facts, wanted), inputs, changed);
  if (changed.size) await invalidateReaderCache({ places: [...changed, ...(await facts("SELECT DISTINCT place_id FROM entity_place WHERE entity_id=ANY($1::text[])", [[...changed]])).map(row => String(row.place_id))] }, purge, null);
  return written;
}

/** Rebuilds the slices the Slide marked, each subject on its own: a board's older calendars take seconds to read, and twenty read together run past the database's statement limit. A slice that reads the same as the one held is not written. A subject that builds is finished; one that fails alone goes back (waiting longer after each failure) with its name and reason on a turn line, and the rest go on. */
async function rebuildMarked(list: WorkList, facts: Query, end?: AbortSignal, purge?: ReaderCachePurger, log: (line: string) => void = () => undefined): Promise<SliceTurn> {
  const claims = await list.claim("slice", CLAIM_LIMIT);
  if (!claims.length) return NOTHING;
  const bySubject = new Map<string, WorkRow[]>();
  for (const claim of claims) bySubject.set(claim.subjectId!, [...bySubject.get(claim.subjectId!) ?? [], claim]);
  let written = 0;
  for (const [subject, mine] of bySubject) {
    try {
      written += await untilEnd(end, make(facts, new Map([[subject, new Set(mine.map(claim => claim.field as SliceCard))]]), purge));
      for (const claim of mine) await list.finish(claim);
    } catch (error) {
      if (end?.aborted) { for (const claim of claims) await list.release(claim).catch(() => false); throw end.reason; }
      const reason = error instanceof Error ? error.message || "failed" : String(error);
      for (const claim of mine) await list.later(claim, reason);
      log(`Slices: ${subject} (${mine.map(claim => claim.field).join(", ")}) failed, try ${mine[0]!.attempts}: ${reason}; the rest of the batch went on`);
    }
  }
  return { claimed: claims.length, built: bySubject.size, written, backfilled: 0 };
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
async function backfill(facts: Query, now: Date, purge?: ReaderCachePurger, end?: AbortSignal, log: (line: string) => void = () => undefined): Promise<SliceTurn & { readonly done: boolean }> {
  const held = JSON.parse(await readPassCursor(facts, BACKFILL_CURSOR) ?? "{}") as BackfillCursor;
  if (held.doneAt && now.getTime() - Date.parse(held.doneAt) < SWEEP_EVERY_MS) return { ...NOTHING, done: true };
  const { places, cursor, finished } = await nextPlaces(facts, held.doneAt ? { zipsDone: true } : held);
  if (!places.length) {
    await writePassCursor(facts, BACKFILL_CURSOR, JSON.stringify(finished ? { doneAt: now.toISOString() } : cursor));
    return { ...NOTHING, done: finished };
  }
  // The places' entity cards are quick to read and go together. A meetings card also reads the board's older calendars, seconds each, so those go in small groups.
  const boards = await boardsToBuild(facts, places);
  let written = await make(facts, new Map<string, Set<SliceCard>>(places.map(place => [place, new Set<SliceCard>(ENTITY_CARDS)])), purge);
  const meetings = (subjects: readonly string[]) => new Map<string, Set<SliceCard>>(subjects.map(subject => [subject, new Set<SliceCard>(MEETING_CARDS)]));
  for (const group of [...chunks(places, PLACE_MEETINGS_GROUP), ...chunks(boards, BOARD_MEETINGS_GROUP)]) {
    try { written += await untilEnd(end, make(facts, meetings(group), purge)); continue; }
    catch (error) { if (end?.aborted) throw end.reason; if (group.length === 1) { log(`Slices: ${group[0]} failed its first meetings slices: ${error instanceof Error ? error.message : String(error)}; the rest went on`); continue; } }
    for (const subject of group) {
      try { written += await untilEnd(end, make(facts, meetings([subject]), purge)); }
      catch (error) { if (end?.aborted) throw end.reason; log(`Slices: ${subject} failed its first meetings slices: ${error instanceof Error ? error.message : String(error)}; the rest went on`); }
    }
  }
  const built = places.length + boards.length;
  await writePassCursor(facts, BACKFILL_CURSOR, JSON.stringify(cursor));
  return { claimed: 0, built, written, backfilled: places.length, done: false };
}

/** One look: marked slices first, then, when none are marked, the next places without slices. While the marks fill whole batches, every other look is the backfill's, so a standing backlog cannot keep places from their first slices; a small backlog is cleared first. */
export async function sliceTurn(input: { readonly list: WorkList; readonly facts: Query; readonly now?: Date; readonly turnEnd?: AbortSignal; readonly purge?: ReaderCachePurger; readonly log?: (line: string) => void;
  /** Kept by the caller across looks: set when the marks last filled a whole batch. */ readonly owed?: { backfill: boolean } }): Promise<SliceTurn & { readonly idle: boolean }> {
  const owed = input.owed ?? { backfill: false };
  const first = async () => { const turn = await untilEnd(input.turnEnd, backfill(input.facts, input.now ?? new Date(), input.purge, input.turnEnd, input.log)); return { ...turn, claimed: 0, idle: turn.done }; };
  if (owed.backfill) {
    owed.backfill = false;
    const turn = await first();
    if (turn.backfilled) return turn;
  }
  const marked = await rebuildMarked(input.list, input.facts, input.turnEnd, input.purge, input.log);
  if (marked.claimed) { owed.backfill = marked.claimed >= CLAIM_LIMIT; return { ...marked, idle: false }; }
  return first();
}

/** The lane's turn: keeps looking until it is asked to stop, resting while the tab is owed so everything it does stays within its pace. */
export async function runSliceLane(input: { readonly list: WorkList; readonly facts: Query; readonly stopRequested: () => boolean; readonly turnEnd?: AbortSignal;
  readonly log: (line: string) => void; readonly sleep?: (ms: number) => Promise<void>; readonly clock?: () => number;
  /** Counts as they happen, for the turn's minute line. */ readonly total?: { built: number; written: number; backfilled: number } }): Promise<{ readonly built: number; readonly written: number; readonly backfilled: number }> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const total = input.total ?? { built: 0, written: 0, backfilled: 0 };
  const clock = input.clock ?? Date.now;
  if (!tab.loaded) { tab.until = Number(await readPassCursor(input.facts, TAB_CURSOR) ?? 0); tab.loaded = true; }
  const owed = { backfill: false };
  while (!input.stopRequested()) {
    const start = clock();
    if (start < tab.until) { await sleep(Math.min(tab.until - start, IDLE_MS)); continue; }
    const before = spent();
    let turn: Awaited<ReturnType<typeof sliceTurn>> | undefined;
    try { turn = await sliceTurn({ list: input.list, facts: input.facts, turnEnd: input.turnEnd, log: input.log, owed }); }
    catch (error) {
      // The rows it held come back when their lease runs out; the lane looks again after its own pause.
      if (!input.turnEnd?.aborted) input.log(`Slices: a look failed (${error instanceof Error ? error.message : String(error)}); the slices stay marked`);
    }
    tab.until = start + owedMs(Math.max(0, spent() - before));
    if (turn) {
      total.built += turn.built; total.written += turn.written; total.backfilled += turn.backfilled;
      if (turn.claimed || turn.backfilled) input.log(turn.backfilled ? `Slices: ${turn.backfilled} places given their first slices (${turn.written} written)` : `Slices: ${turn.claimed} marked slices rebuilt for ${turn.built} places (${turn.written} had changed)`);
    }
    if (!turn || turn.claimed || turn.backfilled) await writePassCursor(input.facts, TAB_CURSOR, String(tab.until)).catch(() => undefined);
    if (input.turnEnd?.aborted) break;
    if (!turn?.claimed) await sleep(turn?.backfilled ? BACKFILL_PAUSE_MS : IDLE_MS);
  }
  return total;
}
