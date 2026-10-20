import type { RouteTask } from "../route-task.ts";

/** A queue carries routing metadata. Its lease owner loads the complete task for the place it claims. */
export type TaskIdentity = Pick<RouteTask,"id"|"workItemId"|"state"|"createdAt"|"routeId"> & {readonly workerTask?: {
  readonly role: NonNullable<RouteTask["workerTask"]>["role"];
  readonly artifactId: NonNullable<RouteTask["workerTask"]>["artifactId"];
  readonly contract: Pick<NonNullable<RouteTask["workerTask"]>["contract"],"subjectId"|"schemaVersion">;
}};
export function taskIdentity(task: RouteTask): TaskIdentity {
  return {id:task.id,workItemId:task.workItemId,state:task.state,createdAt:task.createdAt,routeId:task.routeId,
    ...(task.workerTask ? {workerTask:{role:task.workerTask.role,artifactId:task.workerTask.artifactId,
      contract:{subjectId:task.workerTask.contract.subjectId,schemaVersion:task.workerTask.contract.schemaVersion}}} : {})};
}
