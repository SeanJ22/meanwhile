import { ZERO_COST, type Attempt } from "../control-plane/attempt.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { TranslationAttempt } from "./standing.ts";
import { measureTranslationRoutineId } from "./routine-contract.ts";

type SavedTranslationAttempt = Attempt & { readonly translation: TranslationAttempt };

/** The existing durable attempts retain retry clocks and held reasons. Model
 * charges are recorded separately by the writer/checker, once per request. */
export function routineTranslationAttempts(repos: Pick<ControlPlaneRepositories, "attempts">, state: string) {
  const instance = measureTranslationRoutineId(state);
  return {
    read: async (): Promise<readonly TranslationAttempt[]> => {
      const rows = await repos.attempts.listWhere(["worker", "instance"], instance);
      return rows.flatMap(row => {
        const saved = row.value as SavedTranslationAttempt;
        if (!saved.translation) throw new Error("A translation attempt has lost its retry state.");
        return [saved.translation];
      });
    },
    save: async (translation: TranslationAttempt): Promise<void> => {
      const prior = await repos.attempts.read(translation.id);
      const running = translation.status === "RUNNING";
      const record: SavedTranslationAttempt = {
        id: translation.id, workItemId: translation.subjectId, routeTaskId: instance,
        worker: { role: "PARSER", provider: "we-the-people", version: "measure-translations/1", instance },
        leaseId: translation.id, startedAt: translation.at, endedAt: running ? null : translation.at,
        outcome: running ? null : translation.status === "HELD" ? "ABORTED" : "COMPLETED",
        abortReason: translation.status === "HELD" ? translation.detail ?? "The checked explainer remains open." : null,
        artifactIds: [], cost: ZERO_COST, methodVersion: 1, policyVersion: "R7", translation,
      };
      if (prior) await repos.attempts.compareAndSet(record.id, prior.revision, record, translation.at);
      else await repos.attempts.put(record.id, record, translation.at);
    },
  };
}
