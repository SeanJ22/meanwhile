import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { RoutineDataStore } from "./store.ts";
import { workerPublicationContext } from "./worker-publication-context.ts";
import { publishWorkerReaderResults } from "./worker-reader-publication.ts";
import { publishWorkerRosterResults } from "./worker-roster-publication.ts";
import type { WorkerReaderContract } from "./worker-reader-contracts.ts";
import { workerPublicationReceipt } from "./worker-publication-tasks.ts";

/** Evidence is scoped to this invocation; do not retain a context across publication jobs. */
export async function runWorkerPublicationJob(input: {
  readonly repos: ControlPlaneRepositories;
  readonly store: RoutineDataStore;
  readonly contractId: "registry-runtime-bindings" | WorkerReaderContract;
  readonly workItemIds: readonly string[];
  readonly now: string;
  readonly context?: Pick<Parameters<typeof publishWorkerRosterResults>[0], "repos" | "readCapture">;
}) {
  const context = input.context ?? await workerPublicationContext(input.now, input.repos);
  if (context.repos !== input.repos) throw new Error("WORKER_PUBLICATION_REPOSITORY_MISMATCH");
  const args = { ...context, store: input.store, workItemIds: input.workItemIds, now: input.now };
  const report = input.contractId === "registry-runtime-bindings"
    ? await publishWorkerRosterResults(args)
    : await publishWorkerReaderResults({ ...args, contractId: input.contractId });
  const receipt = await workerPublicationReceipt(input.store, input.contractId, report, null, input.now);
  return { report, receipt, exitCode: receipt ? 0 : 2 } as const;
}
