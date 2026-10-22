import { ZERO_COST, type Attempt } from "../control-plane/attempt.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { measureTranslationRoutineId } from "./routine-contract.ts";

/** A page found for a measure whose ballot data cites no readable official text, or a search that came up empty. */
export interface MeasureFind {
  readonly kind: "FOUND" | "SEARCHED";
  readonly contestId: string;
  readonly url: string | null;
  readonly at: string;
}

type SavedFind = Attempt & { readonly measureFind: MeasureFind };

/** Finds ride the state's existing durable attempts, so the next pass starts from them instead of searching again. */
export function routineMeasureFinds(repos: Pick<ControlPlaneRepositories, "attempts">, state: string) {
  const instance = `${measureTranslationRoutineId(state)}:finds`;
  return {
    read: async (): Promise<readonly MeasureFind[]> =>
      (await repos.attempts.listWhere(["worker", "instance"], instance)).flatMap(row => (row.value as SavedFind).measureFind ?? []),
    save: async (find: MeasureFind): Promise<void> => {
      const id = `measure-find:${state}:${find.kind}:${find.contestId}`;
      const record: SavedFind = { id, workItemId: find.contestId, routeTaskId: instance,
        worker: { role: "ACQUIRER", provider: "we-the-people", version: "measure-find/1", instance },
        leaseId: id, startedAt: find.at, endedAt: find.at, outcome: "COMPLETED", abortReason: null,
        artifactIds: [], cost: ZERO_COST, methodVersion: 1, policyVersion: "R7", measureFind: find };
      const prior = await repos.attempts.read(id);
      if (prior) await repos.attempts.compareAndSet(id, prior.revision, record, find.at);
      else await repos.attempts.put(id, record, find.at);
    },
  };
}
