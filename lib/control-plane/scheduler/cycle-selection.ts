import { projectAggregate, projectRecord, type AggregateRepository, type AppendOnlyRepository, type ControlPlaneRepositories, type Persisted } from "../repository/types.ts";

/** A filtered pass reads existing histories for its exact occurrences, never the whole fleet. */
export async function selectedCycleRepositories(repos: ControlPlaneRepositories, obligationIds: readonly string[]): Promise<ControlPlaneRepositories> {
  const occurrences = (await Promise.all(obligationIds.map(id => repos.occurrences.listWhere(["obligationId"], id)))).flat();
  const workIds = [...new Set(occurrences.map(row => row.value.workItemId))];
  const aggregate = <T>(repository: AggregateRepository<T>, load: () => Promise<readonly Persisted<T>[]>): AggregateRepository<T> => ({
    ...repository, list: load,
    listNarrowed: async projection => (await load()).map(row => ({ ...row, value: projectAggregate(row.value, projection) })),
  });
  const log = <T>(repository: AppendOnlyRepository<T>, keys: readonly string[]): AppendOnlyRepository<T> => {
    const readAll = async () => (await Promise.all(keys.map(key => repository.read(key)))).flat();
    return { ...repository, readAll, readAllNarrowed: async projection => (await readAll()).map(record => projectRecord(record, projection)) };
  };
  return { ...repos,
    occurrences: aggregate(repos.occurrences, async () => occurrences),
    workItems: aggregate(repos.workItems, async () => (await Promise.all(workIds.map(id => repos.workItems.read(id)))).filter((row): row is NonNullable<typeof row> => row !== null)),
    routeTasks: aggregate(repos.routeTasks, async () => (await Promise.all(workIds.map(id => repos.routeTasks.listWhere(["workItemId"], id)))).flat()),
    attempts: aggregate(repos.attempts, async () => (await Promise.all(workIds.map(id => repos.attempts.listWhere(["workItemId"], id)))).flat()),
    leases: aggregate(repos.leases, async () => {
      const tasks = (await Promise.all(workIds.map(id => repos.routeTasks.listWhere(["workItemId"], id)))).flat();
      return (await Promise.all(tasks.map(row => repos.leases.listWhere(["routeTaskId"], row.id)))).flat();
    }),
    workerResults: log(repos.workerResults, workIds),
    costs: log(repos.costs, workIds),
    dispositions: log(repos.dispositions, workIds),
    scoutResults: log(repos.scoutResults, obligationIds),
  };
}
