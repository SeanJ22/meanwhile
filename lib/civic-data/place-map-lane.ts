import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";
import type { RoutineSourceTask, RoutineTaskClock } from "./runner.ts";
import { placeMapReservationMiB } from "../place-map/memory.ts";

/** Each state's map child. Its own lane runs them, so the routine pass's time and memory never starve a state's map. */
const PLACE_MAP_SCRIPT = "scripts/place-map-refresh.mts";
/** The lane looks for owed maps this often; a run in flight is never doubled. */
const PLACE_MAP_LANE_INTERVAL_MS = 30 * 60_000;
/** One run of the lane ends within this, as a routine pass does, so a release restart never waits longer for it; a map
 * it did not finish stays owed to the next run. */
export const PLACE_MAP_PASS_BUDGET_MS = 30 * 60_000;
/** A running map is ended this long before the run's deadline, so its receipt and the run's outcome are saved. */
export const PLACE_MAP_SETTLEMENT_MS = 2 * 60_000;
/** A map starts only while this much of the run remains, leaving it at least 15 minutes: complete Texas and California
 * refreshes each took about six. */
export const PLACE_MAP_RUN_RESERVE_MS = PLACE_MAP_SETTLEMENT_MS + 15 * 60_000;
export const PLACE_MAP_SINGLETON_PORT = 49_374;

export function placeMapsLane(run: (deadlineMs: number) => Promise<void>): IndependentRuntimeLane {
  return { id: "place-maps", everyMs: PLACE_MAP_LANE_INTERVAL_MS, budgetMs: PLACE_MAP_PASS_BUDGET_MS, run };
}

export function isPlaceMapTask(task: Pick<RoutineSourceTask, "command">): boolean {
  return task.command[0] === PLACE_MAP_SCRIPT;
}

/**
 * The place-map lane offers only state maps. The routine pass offers every other task, and a state map only when the
 * owner names it with --only (an owner refresh of that one contract).
 */
export function laneSourceTasks<T extends Pick<RoutineSourceTask, "command">>(tasks: readonly T[], placeMaps: boolean, args: readonly string[]): T[] {
  const named = args.some(arg => arg === "--only" || arg.startsWith("--only="));
  return tasks.filter(task => placeMaps ? isPlaceMapTask(task) : named || !isPlaceMapTask(task));
}

/**
 * A state whose production map holds no ZIPs is owed now, whatever its monthly clock says, but no more often than its
 * failure retry: an empty map is treated as a failed read. `heldZips` is the small Admin count table (place_map_counts);
 * null when it could not be read, which changes nothing.
 */
export function placeMapRowsOwed(
  task: Pick<RoutineSourceTask, "command" | "scope" | "retryMs">,
  heldZips: ReadonlyMap<string, number> | null,
  clock: Pick<RoutineTaskClock, "lastAttemptedAt"> | undefined,
  nowMs: number,
): boolean {
  if (!isPlaceMapTask(task) || heldZips === null) return false;
  const state = /^US-([A-Z]{2}):place-map$/.exec(task.scope)?.[1];
  if (!state || (heldZips.get(state) ?? 0) > 0) return false;
  const attempted = Date.parse(clock?.lastAttemptedAt ?? "");
  return !Number.isFinite(attempted) || attempted > nowMs || attempted + task.retryMs <= nowMs;
}

/** Smallest reservation first, so a small state never waits behind a large one for memory or the lane's one turn. */
export function placeMapLaunchOrder<T extends { readonly task: Pick<RoutineSourceTask, "scope"> }>(jobs: readonly T[]): T[] {
  const reservation = (job: T) => placeMapReservationMiB(/^US-([A-Z]{2}):place-map$/.exec(job.task.scope)?.[1] ?? "");
  return [...jobs].sort((left, right) => reservation(left) - reservation(right));
}
