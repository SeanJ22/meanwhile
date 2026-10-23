import type { Attempt } from "../attempt.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../repository/types.ts";
import type { RouteTask } from "../route-task.ts";
import type { WorkItem } from "../work-item.ts";
import { enqueueHeldMeetingTask, isHeldMeetingTask } from "./held-meeting-followup.ts";
import { enqueueHeldSubjectDetails, isHeldSubjectDetailsTask } from "./held-subject-worker.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import { configuredHeldDiggerReads, HELD_DIGGER_GAP_ROUTES, type HeldDiggerReads, type HeldDiggerSourceChange } from "./held-digger-sources.ts";
export { HELD_DIGGER_SOURCE_FIELDS } from "./held-digger-sources.ts";

export const HELD_DIGGER_CURSOR = "held-digger-source-routes/1";
const preparedPlans = new WeakMap<HeldDiggerPlanRuntime, Promise<readonly RouteTask[]>>();
const OVERLAP_MS = 60_000;

export interface HeldDiggerPlanRuntime {
  readonly repos: ControlPlaneRepositories;
  readonly methodVersion: number;
  readonly now?: () => string;
  readonly diggerReads?: HeldDiggerReads;
}

export function isHeldDiggerTask(task: RouteTask): boolean {
  return isHeldMeetingTask(task) || isHeldSubjectDetailsTask(task);
}

function sourceKind(task: HeldDiggerSourceChange): "meeting" | "subject" | null {
  if (task.workerTask || task.state !== "DISPOSED" || task.disposition?.disposition !== "INGESTED" || !task.disposition.artifactIds.length) return null;
  if (task.routeId.startsWith("held-subject-details:")) return "subject";
  return (HELD_DIGGER_GAP_ROUTES as readonly string[]).includes(task.routeId) ? "meeting" : null;
}

/** The provider recorded this subject's jurisdiction before acquisition; an opaque person id never guesses a state. */
async function subjectState(repos: ControlPlaneRepositories, item: WorkItem): Promise<string> {
  const occurrence = /^(.*)#([1-9]\d*)$/.exec(item.obligation);
  const row = occurrence ? await repos.obligations.readNarrowed(occurrence[1]!, { subjectId: true, scopeDivisions: true }) : null;
  const obligation = row?.value as { readonly subjectId: string; readonly scopeDivisions?: readonly string[] } | undefined;
  if (!obligation || obligation.subjectId !== item.subject) throw new Error(`HELD_DIGGER_SUBJECT_SCOPE_UNAVAILABLE:${item.id}`);
  const states = new Set((obligation.scopeDivisions ?? []).flatMap(division => {
    const state = /^US-([a-z]{2})$/i.exec(division)?.[1] ?? /(?:^|\/)(?:state|district|territory):([a-z]{2})(?=[/#]|$)/i.exec(division)?.[1];
    return state ? [state.toUpperCase()] : [];
  }));
  if (states.size !== 1) throw new Error(`HELD_DIGGER_SUBJECT_SCOPE_AMBIGUOUS:${item.id}`);
  return [...states][0]!;
}

async function changedSources(runtime: HeldDiggerPlanRuntime, reads: HeldDiggerReads, visit: (task: RouteTask, item: WorkItem, artifact: ArtifactRecord,
  kind: "meeting" | "subject") => Promise<void>) {
  const { repos } = runtime;
  const cursor = await repos.passCursors.read(HELD_DIGGER_CURSOR);
  const since = cursor ? new Date(Date.parse(cursor.value.through) - OVERLAP_MS).toISOString() : null;
  const changed = await reads.sourceChanges(since, async rows => {
    for (const row of rows) {
      const kind = sourceKind(row.value);
      if (!kind) continue;
      // Closure is written after both the immutable capture and completed acquisition Attempt.
      // Reading the changed route, rather than only the capture append, also survives a planner racing acquisition.
      const [heldTask, heldItem] = await Promise.all([repos.routeTasks.read(row.id), repos.workItems.read(row.value.workItemId)]);
      if (!heldTask || !heldItem || heldTask.value.workItemId !== heldItem.id || sourceKind(heldTask.value) !== kind) continue;
      const task = heldTask.value;
      for (const artifactId of task.disposition!.artifactIds) {
        const artifacts = await repos.artifacts.readWhere(heldItem.id, ["artifactId"], artifactId);
        for (const artifact of artifacts) {
          if (artifact.partial || artifact.workItemId !== heldItem.id || artifact.routeTaskId !== task.id || artifact.artifactId !== artifactId) continue;
          const attempt = (await repos.attempts.read(artifact.attemptId))?.value;
          if (!attempt || attempt.outcome !== "COMPLETED" || attempt.workItemId !== heldItem.id || attempt.routeTaskId !== task.id ||
            !attempt.artifactIds.includes(artifactId)) continue;
          await visit(task, heldItem.value, artifact, kind);
        }
      }
    }
  });
  return { cursor, through: changed.through };
}

/** Only the two existing worker classes are queried; completed history contributes no input bytes or attempt reads. */
async function dueTasks(runtime: HeldDiggerPlanRuntime, reads: HeldDiggerReads): Promise<readonly RouteTask[]> {
  const { repos } = runtime, now = (runtime.now ?? (() => new Date().toISOString()))();
  const out: RouteTask[] = [];
  for (const id of await reads.pendingTaskIds()) {
    const task = (await repos.routeTasks.read(id))?.value;
    if (!task || !isHeldDiggerTask(task)) continue;
    if (task.state !== "PENDING" && task.state !== "RECLAIMABLE") continue;
    const attempts: Attempt[] = [];
    for (const id of task.attemptIds) {
      const attempt = await repos.attempts.read(id);
      if (attempt) attempts.push(attempt.value);
    }
    if (!workerTaskAdmission(task, attempts, now).due) continue;
    out.push(task);
  }
  return out;
}

/** Turns each already acquired source into one normal queued worker. No source or model is called here. */
async function prepareHeldDiggers(runtime: HeldDiggerPlanRuntime): Promise<readonly RouteTask[]> {
  const now = (runtime.now ?? (() => new Date().toISOString()))();
  const reads = runtime.diggerReads ?? configuredHeldDiggerReads();
  const { cursor, through } = await changedSources(runtime, reads, async (route, item, artifact, kind) => {
    if (kind === "meeting") await enqueueHeldMeetingTask(runtime.repos, { item, artifact, route, now });
    else await enqueueHeldSubjectDetails(runtime.repos, { workItemId: item.id, sourceRouteTaskId: route.id,
      artifactId: artifact.artifactId, state: await subjectState(runtime.repos, item), methodVersion: runtime.methodVersion, now });
  });
  const tasks = await dueTasks(runtime, reads);
  // Every enqueue is durable before advancing. A failed read/enqueue leaves the pass replayable; queue identities deduplicate it.
  if (through) {
    if (cursor) await runtime.repos.passCursors.compareAndSet(HELD_DIGGER_CURSOR, cursor.revision, { through }, now);
    else await runtime.repos.passCursors.put(HELD_DIGGER_CURSOR, { through }, now);
  }
  return tasks;
}

/** Turns each already acquired source into one normal queued worker. No source or model is called here. */
export async function planHeldDiggers(runtime: HeldDiggerPlanRuntime): Promise<readonly RouteTask[]> {
  const prepared = preparedPlans.get(runtime);
  if (prepared) { preparedPlans.delete(runtime); return prepared; }
  return prepareHeldDiggers(runtime);
}

/** Standing's signal prepares the durable queue once; its following plan call consumes the same result. */
export async function hasOwedHeldDiggers(runtime: HeldDiggerPlanRuntime): Promise<boolean> {
  const prepared = preparedPlans.get(runtime) ?? prepareHeldDiggers(runtime);
  preparedPlans.set(runtime, prepared);
  try {
    const owed = (await prepared).length > 0;
    if (!owed && preparedPlans.get(runtime) === prepared) preparedPlans.delete(runtime);
    return owed;
  } catch (error) {
    if (preparedPlans.get(runtime) === prepared) preparedPlans.delete(runtime);
    throw error;
  }
}
