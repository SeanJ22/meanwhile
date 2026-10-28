import type { FactDb } from "../facts/publish.ts";
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import { rebuildPlacePages, type RebuildOptions } from "./place-builder.ts";

/** One turn claims pages for at most this long, so a pending restart waits for no more than one turn. */
export const PLACE_PAGE_TURN_MS = 240_000;
/** A page claimed just before the turn ends still finishes; past this the turn's process is ended and its lease expires. */
export const PLACE_PAGE_TURN_GRACE_MS = 60_000;
/** With nothing queued, the standing clock looks again this long after the last run began. */
const PLACE_PAGE_IDLE_MS = 60_000;
/** One run keeps taking turns while pages are owed; the standing clock starts the next run after this. */
const PLACE_PAGE_RUN_MS = 60 * 60_000;
/** Four builds at once, the queue's four lease slots. */
const PLACE_PAGE_CONCURRENCY = 4;
/** The line a turn's process prints its result on. */
export const PLACE_PAGE_TURN_LINE = "PLACE_PAGES_TURN ";

/** `unchanged` counts rebuilt pages confirmed current from their prints, without reading or rewriting them. */
export interface PlacePageTurn { readonly rebuilt: number; readonly failed: number; readonly remaining: number; readonly unchanged?: number }

/** One turn of the rebuild queue, as the runner's turn process runs it. */
export function rebuildPlacePageTurn(db: FactDb, deadlineMs: number, purge?: RebuildOptions["purge"]): Promise<PlacePageTurn> {
  return rebuildPlacePages({ db, ...(purge ? { purge } : {}), limit: Number.MAX_SAFE_INTEGER, concurrency: PLACE_PAGE_CONCURRENCY,
    timeBudgetMs: Math.max(0, Math.min(PLACE_PAGE_TURN_MS, deadlineMs - Date.now())) });
}

export function placePagesLane(run: (deadlineMs: number) => Promise<void>): IndependentRuntimeLane {
  return { id: "place-pages", everyMs: PLACE_PAGE_IDLE_MS, budgetMs: PLACE_PAGE_RUN_MS, run };
}

/** Reads the result line a turn's process printed; null when it printed none. */
export function placePageTurnResult(output: string): PlacePageTurn | null {
  const line = output.split("\n").findLast(row => row.startsWith(PLACE_PAGE_TURN_LINE));
  if (!line) return null;
  const parsed = JSON.parse(line.slice(PLACE_PAGE_TURN_LINE.length)) as Partial<PlacePageTurn>;
  return { rebuilt: Number(parsed.rebuilt ?? 0), failed: Number(parsed.failed ?? 0), remaining: Number(parsed.remaining ?? 0),
    ...(parsed.unchanged ? { unchanged: Number(parsed.unchanged) } : {}) };
}

/**
 * Takes turns while pages are owed and work is admitted. Admission is asked before every turn, so a pending restart or
 * the owner's pause stops new turns at once. The run ends when the queue is empty, when a turn moved nothing, when a
 * turn fails (its pages stay queued) or at the run's deadline; the standing clock starts the next run.
 */
export async function drainPlacePageQueue(input: {
  readonly deadlineMs: number;
  readonly admitted: () => Promise<boolean>;
  readonly turn: (deadlineMs: number) => Promise<PlacePageTurn>;
  readonly log: (line: string) => void;
}): Promise<{ readonly turns: number; readonly rebuilt: number; readonly failed: number; readonly remaining: number | null }> {
  let turns = 0, rebuilt = 0, failed = 0, remaining: number | null = null;
  while (Date.now() < input.deadlineMs && await input.admitted()) {
    let result: PlacePageTurn;
    try { result = await input.turn(Math.min(input.deadlineMs, Date.now() + PLACE_PAGE_TURN_MS)); }
    catch (error) {
      input.log(`  place pages: turn ended without a result (${error instanceof Error ? error.message : String(error)}); its pages stay queued`);
      break;
    }
    turns++; rebuilt += result.rebuilt; failed += result.failed;
    const before = remaining;
    remaining = result.remaining;
    input.log(`  place pages: ${result.rebuilt} rebuilt${result.unchanged ? ` (${result.unchanged} unchanged)` : ""}, ${result.failed} failed and still queued, ${result.remaining} waiting`);
    if (!result.remaining || (!result.rebuilt && (before === null || result.remaining >= before))) break;
  }
  return { turns, rebuilt, failed, remaining };
}
