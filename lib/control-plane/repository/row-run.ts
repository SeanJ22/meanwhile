import { saveRun, type RunPart } from "../../core/work.ts";
import type { Query } from "../../facts/publish.ts";
import type { AggregateRepository, ControlPlaneRepositories } from "./types.ts";

const ROW = /^work-/;

/** A write to this repository is also kept on the work row the record belongs to; a record that belongs to no row is written as before. */
function onRow<T>(repo: AggregateRepository<T>, query: Query, part: RunPart, rowOf: (id: string, value: T) => string): AggregateRepository<T> {
  const keep = async (id: string, value: T): Promise<void> => {
    const row = rowOf(id, value);
    if (ROW.test(row)) await saveRun(query, row, part, id, value);
  };
  return { ...repo,
    async put(id, value, now) { const outcome = await repo.put(id, value, now); await keep(id, outcome.persisted.value); return outcome; },
    async compareAndSet(id, revision, next, now) { const saved = await repo.compareAndSet(id, revision, next, now); await keep(id, saved.value); return saved; } };
}

/**
 * A hunt that ran from a work row has its work item, route task, lease and attempts saved on that row as well, so the row
 * says everything about its hunt. The old records are still written; Admin and publication switch to the row before they go.
 */
export function keepRunsOnRows(repos: ControlPlaneRepositories, query: Query): ControlPlaneRepositories {
  return { ...repos,
    workItems: onRow(repos.workItems, query, "item", id => id),
    routeTasks: onRow(repos.routeTasks, query, "task", id => id),
    leases: onRow(repos.leases, query, "lease", id => id),
    attempts: onRow(repos.attempts, query, "attempt", (_id, attempt) => attempt.routeTaskId) };
}
