import { REOPEN_BATCH, reopenDeadEnds, type CapabilityLog, type Unlock } from "../../core/capability.ts";
import type { WorkList, WorkRow } from "../../core/work.ts";
import { workStateOf } from "../../core/work-kinds.ts";
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

/** How long a funded place waits between looks at its blanks; a changed blank or a new order brings the look forward. */
export const FUNDED_LOOK_MS = 24 * 3_600_000;

/** A hunt Sean's money pointed at a place, as opposed to one a research round planned a task for. */
const funded = (row: WorkRow): boolean => row.kind === "hunt" && row.origin.from === "order" && plannedTaskOf(row) === null;
/** The newest of the orders that reached the place. */
const orderedAtOf = (row: WorkRow): string | null => ((row.origin.marks ?? []) as readonly { readonly at: string }[]).reduce<string | null>((newest, mark) => newest === null || mark.at > newest ? mark.at : newest, null);

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
  /** Whether a funded place is due another hunt: its open blanks changed since the last one, a new order reached it, or its dead-end clock ran out. */
  readonly due: (governmentId: string, orderedAt: string | null) => Promise<boolean>;
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
        if (await deps.list.ready(HUNTER_KINDS, { state: workStateOf(next), plainOnly })) return state = next;
      }
      return state;
    },
    async claim(paidOpen: boolean): Promise<HunterQueue | null> {
      const rows = await deps.list.claim(HUNTER_KINDS, deps.limit ?? 20, { state: workStateOf(state), plainOnly: !paidOpen });
      const taskIds: string[] = [], plainTaskIds: string[] = [];
      for (const row of rows) {
        try {
          // A funded place whose blanks are as the last hunt left them waits for its next look.
          if (funded(row) && !await deps.due(row.subjectId!, orderedAtOf(row))) { await deps.list.finish(row, FUNDED_LOOK_MS); continue; }
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
      // A funded place is looked at again on its clock; every other row asked once.
      await deps.list.finish(row, funded(row) ? FUNDED_LOOK_MS : undefined, await deps.deadEndOf(result));
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
