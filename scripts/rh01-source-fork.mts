/** A saved completed execution may replace only an untouched task in the disposable measurement fork. */
import type { Attempt } from "../lib/control-plane/attempt.ts";
import type { RouteTask } from "../lib/control-plane/route-task.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";

/** Content identity is shared across acquisitions; an existing first observation keeps its original Attempt. */
export function savedArtifactFirstObservation(saved: ArtifactRecord, original: ArtifactRecord, canonicalJson: (value: unknown) => string): ArtifactRecord {
  const { attemptId: _savedAttempt, ...savedCapture } = saved;
  const { attemptId: _originalAttempt, ...originalCapture } = original;
  if (saved.partial || original.partial || canonicalJson(savedCapture) !== canonicalJson(originalCapture))
    throw Error("RH01_SAVED_SOURCE_FIRST_OBSERVATION_DIFFERS");
  return original;
}

export function savedSourceTaskFork(input: {
  existing: RouteTask;
  source: RouteTask;
  attempt: Attempt;
  artifacts: readonly ArtifactRecord[];
  canonicalJson(value: unknown): string;
  routeTaskId(workItemId: string, routeId: string, target: string): string;
  disposeRoute(task: RouteTask, attempt: Attempt, disposition: NonNullable<RouteTask["disposition"]>): RouteTask;
}): { taskId: string; sourceAttemptId: string; sourceCreatedAt: string; productionCreatedAt: string; productionState: "PENDING"; restoredState: "DISPOSED" } {
  const { source, existing, attempt, artifacts, canonicalJson, routeTaskId, disposeRoute } = input;
  const identity = (task: RouteTask) => ({ id: task.id, workItemId: task.workItemId, routeId: task.routeId,
    routeLabel: task.routeLabel, target: task.target, inherited: task.inherited, workerTask: task.workerTask });
  if (source.id !== routeTaskId(source.workItemId, source.routeId, source.target) ||
      canonicalJson(identity(source)) !== canonicalJson(identity(existing))) throw Error("RH01_SAVED_SOURCE_JOB_IDENTITY_DIFFERS");
  if (existing.state !== "PENDING" || existing.attemptIds.length || existing.disposition !== null || existing.policyDenial || existing.policyReauthorizations?.length)
    throw Error("RH01_SAVED_SOURCE_CANNOT_REPLACE_ATTEMPTED_TASK");
  if (source.state !== "DISPOSED" || !source.disposition || source.disposition.disposition !== "INGESTED" || source.policyDenial ||
      source.policyReauthorizations?.length || !source.attemptIds.includes(attempt.id) || source.disposition.attemptId !== attempt.id ||
      attempt.workItemId !== source.workItemId || attempt.routeTaskId !== source.id || attempt.outcome !== "COMPLETED" ||
      !attempt.endedAt || attempt.abortReason !== null || !["ACQUIRER", "SCOUT"].includes(attempt.worker.role))
    throw Error("RH01_SAVED_SOURCE_COMPLETION_MISSING");
  if (!artifacts.length || artifacts.some(row => row.partial || row.workItemId !== source.workItemId || row.routeTaskId !== source.id ||
      row.attemptId !== attempt.id || !attempt.artifactIds.includes(row.artifactId) || !source.disposition!.artifactIds.includes(row.artifactId)))
    throw Error("RH01_SAVED_SOURCE_ARTIFACT_LINEAGE_DIFFERS");
  const reconstructed = disposeRoute({ ...source, state: "PENDING", disposition: null }, attempt, source.disposition);
  if (canonicalJson(reconstructed) !== canonicalJson(source)) throw Error("RH01_SAVED_SOURCE_NATIVE_DISPOSITION_DIFFERS");
  return { taskId: source.id, sourceAttemptId: attempt.id, sourceCreatedAt: source.createdAt, productionCreatedAt: existing.createdAt,
    productionState: "PENDING", restoredState: "DISPOSED" };
}
