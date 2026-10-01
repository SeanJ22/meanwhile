import { createFileRepositories } from "../repository/file-store.ts";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { RepositoryLockHeld } from "../repository/types.ts";
import type { ModelResponse, ScoutEscalationAdmission } from "../scheduler/scout-executor.ts";
import { FleetSafetyController } from "../fleet-safety.ts";
import { autonomousStandingRuntime } from "./standing-runtime.ts";
import { dispatchAutonomousTask } from "./coordinator.ts";
import { browseWithPlaywright } from "../../../scripts/scout-browse.mts";
import { workerBroker } from "./worker-broker.ts";
import type { LeaseWorkerConfig } from "./process-pool.ts";
import { join } from "node:path";

const broker = workerBroker<LeaseWorkerConfig>(work);

async function work(config: LeaseWorkerConfig): Promise<void> {
  const url = config.postgres ? controlPlaneUrlFromEnv() : null;
  if (config.postgres && !url) throw new Error("CONTROL_PLANE_DATABASE_UNCONFIGURED");
  const repos = url ? await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true })
    : await createFileRepositories(config.fileStoreRoot ?? join(config.root, ".runtime/control-plane/freshness-shadow"));
  const safety = new FleetSafetyController({ now: new Date().toISOString(), costs: [], rollingCeilingUsd: config.ceilingUsd });
  const pending = new Set(config.taskIds);
  // Each process runs one live lease at a time, always pulling current task state.
  // The first process to claim wins in the existing repository dispatcher.
  while (pending.size) {
    let ran = false;
    for (const id of await broker.call<readonly string[]>("pending-order", [...pending])) {
      pending.delete(id);
      const task = (await repos.routeTasks.read(id))?.value;
      if (!task || !["PENDING", "RECLAIMABLE"].includes(task.state)) continue;
      const item = (await repos.workItems.mustRead(task.workItemId)).value;
      broker.assignment(id, { subjectId: item.subject, state: item.autonomousPlan?.jurisdiction ?? null });
      const runtime = await autonomousStandingRuntime({ root: config.root, repos, environment: process.env,
        browse: browseWithPlaywright, openBytes: safety.guardedOpenBytes("public-web", item.subject),
        ...(config.modelEnabled ? { transport: request => broker.call<ModelResponse>("model", request),
          transportFor: current => { broker.assignment(id, current); return request => broker.call<ModelResponse>("model", request); },
          reserveScoutEscalation: async request => {
            const response = await broker.call<(Omit<Extract<ScoutEscalationAdmission, { admit: true }>, "draw" | "release"> & { reservationId: string }) |
              Extract<ScoutEscalationAdmission, { admit: false }>>("escalation", request);
            return response.admit ? { ...response, draw: usd => broker.send("draw", response.reservationId, usd), release: () => broker.send("release", response.reservationId, null) } : response;
          } } : {}),
        ...(config.searchEnabled ? { search: request => broker.call("search", request) } : {}),
        auditCeilingUsd: config.ceilingUsd, lifetimeHuntSubject: subject => config.fundedSubjects.includes(subject) });
      try {
        const result = await dispatchAutonomousTask(runtime, task);
        broker.send("result", "", result);
        ran = true;
      } catch (error) {
        if (!(error instanceof RepositoryLockHeld) && !(error instanceof Error && error.message === "WORKER_TASK_NOT_DISPATCHABLE")) throw error;
      }
      if (ran) break;
    }
    if (!ran) break;
  }
  broker.send("finished", "", config.taskIds);
  process.disconnect();
}
