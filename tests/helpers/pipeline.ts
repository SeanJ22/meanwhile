import { contextFromRecords, deriveItemState, isPipelineRecord, type PipelineContext } from "../../lib/control-plane/promotion/pipeline.ts";
import type { PipelineItemState } from "../../lib/control-plane/promotion/types.ts";
import type { ControlPlaneRepositories } from "../../lib/control-plane/repository/types.ts";

/** A test's complete fixture, never a live runner history. */
export async function readPipelineStates(repos: ControlPlaneRepositories): Promise<PipelineItemState[]> {
  const out: PipelineItemState[] = [];
  for (const key of await repos.promotionPipeline.keys()) {
    const records = (await repos.promotionPipeline.read(key)).filter(isPipelineRecord);
    if (records.length) out.push(deriveItemState(key, records));
  }
  return out;
}

export async function contextFromRepositories(repos: ControlPlaneRepositories): Promise<PipelineContext> {
  const [artifacts, attempts, results] = await Promise.all([repos.artifacts.readAll(), repos.attempts.list(), repos.workerResults.readAll()]);
  return contextFromRecords(artifacts, attempts.map(row => row.value), results);
}
