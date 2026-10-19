import { readAssignmentSubset } from "../../lib/control-plane/assignment-read.ts";
import type { AssignmentSources } from "../../lib/control-plane/assignment-view.ts";
import type { ControlPlaneRepositories } from "../../lib/control-plane/repository/types.ts";

/** The publisher's read of every standing obligation and work item the store holds, as one batch. */
export async function readEveryAssignmentSource(repos: ControlPlaneRepositories, nowIso: string): Promise<AssignmentSources> {
  const [scoutKeys, pipelineItems] = await Promise.all([repos.scoutResults.keys(), repos.promotionPipeline.keys()]);
  return readAssignmentSubset(repos, { nowIso, activation: null, pilotZips: [], servedReader: null, askGapObservations: null, pipeline: true }, {
    obligations: (await repos.obligations.list()).map((row) => row.id),
    workItems: (await repos.workItems.list()).map((row) => row.id),
    context: () => [],
    scoutKeys: () => scoutKeys,
    pipelineItems: () => pipelineItems,
  });
}
