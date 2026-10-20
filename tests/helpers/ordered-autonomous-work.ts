import type { WorkItem } from "../../lib/control-plane/work-item.ts";
import type { Attempt } from "../../lib/control-plane/attempt.ts";
import { createMemoryRepositories } from "../../lib/control-plane/repository/memory.ts";
import { runAutonomousCoordinator, type AutonomousCoordinatorRuntime } from "../../lib/control-plane/workers/coordinator.ts";
import { sendOf } from "../../lib/control-plane/workers/squad-weights.ts";

/** Fixture collection of the production disk coordinator's exact deferred queue. */
export async function orderedAutonomousWorkIds(items: readonly WorkItem[], lastServed: ReadonlyMap<string, string>,
  priorities: readonly { receiptId: string; priority: number }[] = [],
  squads?: { readonly partOf: (item: WorkItem) => string; readonly weightOf: (send: string, part: string) => number }): Promise<string[]> {
  const repos = createMemoryRepositories(), priority = new Map(priorities.map(row => [row.receiptId, row.priority]));
  const open = new Map<string, Map<string, number>>();
  const at = "2026-10-20T00:00:00.000Z";
  for (const item of items) {
    await repos.workItems.put(item.id, item, at);
    if (squads) {
      const send = sendOf(item, priority), part = squads.partOf(item), own = open.get(send) ?? new Map<string, number>();
      own.set(part, squads.weightOf(send, part)); open.set(send, own);
    }
  }
  for (const [workItemId, startedAt] of lastServed) {
    const id = `attempt:${workItemId}`;
    await repos.attempts.put(id, { id, workItemId, startedAt } as Attempt, at);
  }
  // maximum zero orders every registered place through the actual planner without acquiring or dispatching.
  const result = await runAutonomousCoordinator({ repos, now: () => at } as AutonomousCoordinatorRuntime,
    { maximum: 0, prioritizedInstructions: priorities, ...(squads ? { squads: { open } } : {}) });
  return result.deferred.map(row => row.workItemId);
}

/** The actual coordinator folds these recorded turns and debts into its disk inventory. */
export async function readCoordinatorWeights(input: {
  readonly items: readonly WorkItem[];
  readonly priority: ReadonlyMap<string, number>;
  readonly reading: import("../../lib/control-plane/workers/squad-weights.ts").SquadReading;
  readonly routeTasks: readonly import("../../lib/control-plane/route-task.ts").RouteTask[];
  readonly debts: readonly { readonly debt: import("../../lib/control-plane/scheduler/debt.ts").FreshnessDebt; readonly workItemId: string | null }[];
  readonly now: string;
}) {
  const repos = createMemoryRepositories();
  for (const item of input.items) await repos.workItems.put(item.id, item, input.now);
  for (let i = 0; i < input.routeTasks.length; i++) {
    const id = `task:${i}`;
    await repos.routeTasks.put(id, { ...input.routeTasks[i]!, id }, input.now);
  }
  for (let i = 0; i < input.debts.length; i++) {
    const { debt, workItemId } = input.debts[i]!;
    await repos.debts.put(`debt:${i}`, debt, input.now);
    if (workItemId) {
      const id = `occurrence:${i}`;
      await repos.occurrences.put(id, { id, obligationId: debt.obligationId, workItemId,
        dueAt: input.now, openedAt: input.now } as import("../../lib/control-plane/scheduler/durable.ts").FreshnessOccurrence, input.now);
    }
  }
  const result = await runAutonomousCoordinator({ repos, now: () => input.now } as AutonomousCoordinatorRuntime,
    { maximum: 0, squads: input.reading, prioritizedInstructions: [...input.priority].map(([receiptId, priority]) => ({ receiptId, priority })) });
  return new Map(result.squadWeights.map(row => [`${row.send}\0${row.part}`, row]));
}
