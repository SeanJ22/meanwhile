import { createFileRepositories } from "../repository/file-store.ts";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { RepositoryLockHeld } from "../repository/types.ts";
import type { ModelResponse, ScoutEscalationAdmission } from "../scheduler/scout-executor.ts";
import { FleetSafetyController } from "../fleet-safety.ts";
import { websiteSizeForObligation, type WebsiteSizeForUrl } from "../scheduler/host-supervision.ts";
import { autonomousStandingRuntime } from "./standing-runtime.ts";
import { observeCyclePhases } from "../scheduler/cycle-phases.ts";
import { dispatchAutonomousTask } from "./coordinator.ts";
import { browseWithPlaywright } from "../../../scripts/scout-browse.mts";
import { workerBroker } from "./worker-broker.ts";
import { workerDispatchFailure, type LeaseWorkerConfig } from "./process-pool.ts";
import { join } from "node:path";

const broker = workerBroker<LeaseWorkerConfig>(work);

async function work(config: LeaseWorkerConfig): Promise<void> {
  const url = config.postgres ? controlPlaneUrlFromEnv() : null;
  if (config.postgres && !url) throw new Error("CONTROL_PLANE_DATABASE_UNCONFIGURED");
  const stores = url ? await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true })
    : await createFileRepositories(config.fileStoreRoot ?? join(config.root, ".runtime/control-plane/freshness-shadow"));
  // CH-26: each result carries the repository calls its task made, so the round can show them per task.
  const observer = observeCyclePhases(stores);
  const repos = observer.repos;
  let websiteSize: WebsiteSizeForUrl = () => null;
  const safety = new FleetSafetyController({ now: new Date().toISOString(), costs: [], rollingCeilingUsd: config.ceilingUsd,
    websiteSize: url => websiteSize(url) });
  // The per-task guards read `current`, so one runtime built once per process serves every task it runs
  // (a process runs one lease at a time). `subject` is only set on the old per-task path.
  let current = "";
  const perTask = process.env.WTP_LEASE_RUNTIME_PER_TASK === "1";
  // CH-26: each task reads only its own history. On by default since 2026-10-06 (Sean: the whole-table reads are
  // most of the control plane's Neon transfer); WTP_SCOPED_TASK_READS=0 is the way back to the whole-table path.
  const scopedReads = process.env.WTP_SCOPED_TASK_READS !== "0";
  let shared: Awaited<ReturnType<typeof autonomousStandingRuntime>> | undefined;
  const buildRuntime = (subject: string | null) => autonomousStandingRuntime({ root: config.root, repos, environment: process.env,
    browse: browseWithPlaywright,
    ...(subject === null ? { openBytesFor: s => safety.guardedOpenBytes("public-web", s) } : { openBytes: safety.guardedOpenBytes("public-web", subject) }),
    ...(config.modelEnabled ? { transport: request => broker.call<ModelResponse>("model", request),
      transportFor: jurisdiction => { broker.assignment(current, jurisdiction); return request => broker.call<ModelResponse>("model", request); },
      reserveScoutEscalation: async request => {
        const response = await broker.call<(Omit<Extract<ScoutEscalationAdmission, { admit: true }>, "draw" | "release"> & { reservationId: string }) |
          Extract<ScoutEscalationAdmission, { admit: false }>>("escalation", request);
        return response.admit ? { ...response, draw: usd => broker.send("draw", response.reservationId, usd), release: () => broker.send("release", response.reservationId, null) } : response;
      } } : {}),
    ...(config.searchEnabled ? { search: request => broker.call("search", request) } : {}),
    auditCeilingUsd: config.ceilingUsd, lifetimeHuntSubject: subject => config.fundedSubjects.includes(subject), scopedReads });
  const pending = new Set(config.taskIds);
  // Each process runs one live lease at a time, always pulling current task state.
  // The first process to claim wins in the existing repository dispatcher.
  while (pending.size) {
    let ran = false;
    let ordered: readonly string[];
    try { ordered = await broker.call<readonly string[]>("pending-order", [...pending]); }
    catch (error) {
      console.warn(`Worker priority read failed; keeping pending order: ${error instanceof Error ? error.message : String(error)}`);
      ordered = [...pending];
    }
    for (const id of ordered) {
      pending.delete(id);
      try {
        const task = (await repos.routeTasks.read(id))?.value;
        if (!task || !["PENDING", "RECLAIMABLE"].includes(task.state)) continue;
        const item = (await repos.workItems.mustRead(task.workItemId)).value;
        websiteSize = websiteSizeForObligation({ id: item.id, subjectId: item.subject, autonomousPlan: item.autonomousPlan }, config.root);
        broker.assignment(id, { subjectId: item.subject, state: item.autonomousPlan?.jurisdiction ?? null });
        current = id;
        // The lane's per-job clock: which task this worker is on (process-pool.ts StandingPoolOptions).
        broker.send("task-start", "", id);
        // Old path (one runtime per task) stays behind WTP_LEASE_RUNTIME_PER_TASK=1 until the shared runtime is checked live.
        const runtime = perTask ? await buildRuntime(item.subject)
          : (shared ??= await buildRuntime(null));
        observer.finish("runtime");
        await runtime.beginTask?.(task);
        const result = await dispatchAutonomousTask(runtime, task);
        broker.send("result", "", { ...result, repositoryCalls: observer.finish("task").repositoryCalls });
        ran = true;
      } catch (error) {
        if (!(error instanceof RepositoryLockHeld) && !(error instanceof Error && error.message === "WORKER_TASK_NOT_DISPATCHABLE")) {
          broker.send("result", "", workerDispatchFailure(id, error));
        }
      }
      if (ran) break;
    }
    if (!ran) break;
  }
  broker.send("finished", "", config.taskIds);
  process.disconnect();
}
