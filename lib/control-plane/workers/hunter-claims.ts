import { REOPEN_BATCH, reopenDeadEnds, type CapabilityLog, type Unlock } from "../../core/capability.ts";
import type { WorkList, WorkRow } from "../../core/work.ts";
import { plannedTaskOf, taskOfRow } from "../../hunt/work-hunt.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { DispatchResult } from "../scheduler/dispatch.ts";
import type { HunterQueue } from "./hunter-lane.ts";

/** The kinds of row the hunters take. */
export const HUNTER_KINDS = ["ask", "hunt"] as const;

/** A lease is renewed well inside its length, so a lane that dies frees its rows within minutes. */
export const HUNTER_CLAIM_LEASE_MS = 5 * 60_000;
export const HUNTER_CLAIM_RENEW_MS = 60_000;
/** How often the list's own clock looks for dead ends to put back. */
export const DEAD_END_CLOCK_MS = 5 * 60_000;

/** The hunters' arming and budget reading is kept per planning state; national rows use the system one. */
export const rowsOfPlanningState = (state: string): string => state === "system" ? "US" : state.toUpperCase();

/** A hunt the planner made for a place, as opposed to one a research round planned a task for. */
const standing = (row: WorkRow): boolean => row.origin.from === "planner" && plannedTaskOf(row) === null;

/**
 * The hunters' claims on the work list. A row is taken, turned into the task the workers run, kept leased while the
 * hunt runs, and finished, deferred or handed back by what the hunt actually did.
 */
export function hunterClaims(deps: {
  readonly list: WorkList;
  readonly repos: ControlPlaneRepositories;
  readonly now: () => string;
  /** How long a hunt that left blanks open waits before the same place is tried again. */
  readonly deadEndMs: () => Promise<number>;
  readonly capabilities: CapabilityLog;
  /** What the hunt's own record says would unlock the blanks it left open. */
  readonly deadEndOf: (result: DispatchResult) => Promise<Unlock | undefined>;
  /** The places money was pointed at: a standing hunt the planner made for any other place is not worked. */
  readonly funded: () => readonly string[];
  /** Whether a place's open blanks have changed since its last hunt, or its dead-end clock has run out. */
  readonly due: (governmentId: string) => Promise<boolean>;
  readonly log: (line: string) => void;
  readonly limit?: number;
}) {
  const held = new Map<string, WorkRow>();
  let state = "system", clockedAt = 0;
  /** The list's own clock: dead ends whose unlock appeared, or whose free try came due, go back on the list. */
  const clock = async (): Promise<void> => {
    const at = Date.parse(deps.now());
    if (at - clockedAt < DEAD_END_CLOCK_MS) return;
    clockedAt = at;
    try {
      const reopened = await reopenDeadEnds(deps.list, deps.capabilities, await deps.deadEndMs(), deps.now());
      if (reopened) deps.log(`hunter lane: ${reopened} dead end(s) went back on the work list`);
      if (reopened >= REOPEN_BATCH) clockedAt = 0;
    } catch (error) { deps.log(`hunter lane: dead ends could not be reopened this turn (${error instanceof Error ? error.message : String(error)})`); }
  };
  return {
    /** Moves the claims to another state's rows; a state with a row ready is chosen over the current one. */
    async select(states: readonly string[], plainOnly: boolean): Promise<string> {
      await clock();
      const start = Math.max(0, states.indexOf(state)) + 1;
      for (let step = 0; step < states.length; step += 1) {
        const next = states[(start + step) % states.length]!;
        if (await deps.list.ready(HUNTER_KINDS, { state: rowsOfPlanningState(next), plainOnly, fundedSubjects: deps.funded() })) return state = next;
      }
      return state;
    },
    async claim(paidOpen: boolean): Promise<HunterQueue | null> {
      const rows = await deps.list.claim(HUNTER_KINDS, deps.limit ?? 20, { state: rowsOfPlanningState(state), plainOnly: !paidOpen, fundedSubjects: deps.funded() });
      const taskIds: string[] = [], plainTaskIds: string[] = [];
      for (const row of rows) {
        try {
          // A standing hunt the planner made waits out its clock when the place's blanks are as the last hunt left them.
          if (standing(row) && !await deps.due(row.subjectId!)) { await deps.list.finish(row, await deps.deadEndMs()); continue; }
          const task = await taskOfRow(deps.repos, row, deps.now());
          // A task that has nothing left to run, or is already running for another row, finishes the row.
          if (task === null || held.has(task.routeTaskId)) { await deps.list.finish(row); continue; }
          held.set(task.routeTaskId, row);
          taskIds.push(task.routeTaskId);
          if (task.plain) plainTaskIds.push(task.routeTaskId);
        } catch (error) {
          await deps.list.later(row, error instanceof Error ? error.message : "The row could not be turned into a task");
        }
      }
      return taskIds.length ? { claimedAt: deps.now(), taskIds, plainTaskIds } : null;
    },
    /** What the hunt did decides the row: a hunt that ran finishes it; one that did not waits and is tried again. */
    async settle(result: DispatchResult): Promise<void> {
      const row = result.routeTaskId === null ? undefined : held.get(result.routeTaskId);
      if (row === undefined) return;
      held.delete(result.routeTaskId!);
      if (result.outcome !== "WORKED") { await deps.list.later(row, result.detail.slice(0, 300) || "The hunt did not finish"); return; }
      // A planner's hunt comes back when its dead-end clock runs out; every other row asked once.
      await deps.list.finish(row, standing(row) ? await deps.deadEndMs() : undefined, await deps.deadEndOf(result));
    },
    /** Keeps the leases of rows whose hunts are still running. */
    async keep(): Promise<void> {
      for (const [taskId, row] of [...held]) if (!await deps.list.renew(row)) { held.delete(taskId); deps.log(`hunter lane: the lease on ${row.id} was lost; another lane may run it`); }
    },
    /** Rows the wave never reached go back as if untouched. */
    async endWave(): Promise<void> {
      for (const row of held.values()) await deps.list.release(row);
      held.clear();
    },
  };
}
