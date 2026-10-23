import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { RoutineSourceTask } from "./runner.ts";

export const ROUTINE_DECISIONS_LOG_KEY = "routine-launch-decisions";
export interface RoutineLaunchDecision {
  readonly taskId: string;
  readonly sourceId: string;
  readonly scope: string;
  readonly state: string;
  readonly at: string;
  readonly action: "SKIP" | "DEFER";
  readonly reason: string;
  readonly detail: string;
}

export function routineLaunchDecision(task: Pick<RoutineSourceTask, "id" | "sourceId" | "scope">, action: RoutineLaunchDecision["action"], reason: string, detail: string, at: string): RoutineLaunchDecision {
  let scope = task.scope;
  try { scope = decodeURIComponent(scope); } catch { /* Keep the original scope in the decision. */ }
  const state = /(?:^|[:/+-])US-([A-Z]{2})(?:[:/+#-]|$)/i.exec(scope)?.[1]
    ?? /\/(?:state|district|territory):([a-z]{2})(?:\/|#|$)/i.exec(scope)?.[1]
    ?? /(?:^|:)([A-Z]{2})$/.exec(task.id)?.[1];
  return { taskId: task.id, sourceId: task.sourceId, scope: task.scope, state: state?.toLowerCase() ?? "system", action, reason, detail, at };
}

/** Save every decision in small batches before work starts, then after each settlement wave. */
export async function appendRoutineLaunchDecisions(repos: Pick<ControlPlaneRepositories, "ownerDigests">, decisions: readonly RoutineLaunchDecision[], cycleId: string, sha: string | null, batch: number): Promise<void> {
  const states = [...new Set(decisions.map(row => row.state))];
  for (const state of states) {
    const rows = decisions.filter(row => row.state === state);
    for (let offset = 0; offset < rows.length; offset += 50) {
      const entries = rows.slice(offset, offset + 50), at = entries.at(-1)!.at;
      const digestId = `${cycleId}:decisions:${batch}:${state}:${offset}`;
      await repos.ownerDigests.append(ROUTINE_DECISIONS_LOG_KEY, digestId, {
        formatVersion: 1, digestId, writtenAt: at, testedSha: sha, cycleOk: null,
        headline: `${entries.length} source launch decisions`, lines: [], routineDecisionState: state, routineDecisions: entries,
      }, at);
    }
  }
}
