import { pipelineStatesOf } from "../../lib/control-plane/assignment-read.ts";
import type { AssignmentSources } from "../../lib/control-plane/assignment-view.ts";
import type { ControlPlaneRepositories } from "../../lib/control-plane/repository/types.ts";

/** The complete memory fixture, independent of the publisher's compact current-head read. */
export async function readEveryAssignmentSource(repos: ControlPlaneRepositories, nowIso: string): Promise<AssignmentSources> {
  const [obligations, occurrences, workItems, routeTasks, attempts, debts, leases, artifacts, costs, scoutResults, workerResults, pipeline] = await Promise.all([
    repos.obligations.list(), repos.occurrences.list(), repos.workItems.list(), repos.routeTasks.list(), repos.attempts.list(), repos.debts.list(), repos.leases.list(),
    repos.artifacts.readAll(), repos.costs.readAll(), repos.scoutResults.readAll(), repos.workerResults.readAll(), repos.promotionPipeline.readAll(),
  ]);
  const open=new Set(attempts.filter(row=>row.value.outcome===null).map(row=>row.value.routeTaskId));
  return { nowIso, obligations: obligations.map(row => row.value), occurrences: occurrences.map(row => row.value), workItems: workItems.map(row => row.value),
    routeTasks: routeTasks.map(row => row.value), attempts: attempts.map(row => row.value), debts: debts.map(row => row.value), leases: leases.map(row => row.value).filter(row=>open.has(row.routeTaskId)),
    artifacts, costs, scoutResults, workerResults, pipeline: pipelineStatesOf(pipeline), dispositions: null, activation: null, pilotZips: [], servedReader: null, askGapObservations: null };
}
