import { createFileRepositories } from "../repository/file-store.ts";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { RepositoryLockHeld } from "../repository/types.ts";
import type { ModelResponse } from "../scheduler/scout-executor.ts";
import { FleetSafetyController } from "../fleet-safety.ts";
import { websiteSizeForObligation, type WebsiteSizeForUrl } from "../scheduler/host-supervision.ts";
import { autonomousStandingRuntime } from "./standing-runtime.ts";
import { observeCyclePhases } from "../scheduler/cycle-phases.ts";
import { dispatchAutonomousTask } from "./coordinator.ts";
import { browseWithPlaywright } from "../../../scripts/scout-browse.mts";
import { workerBroker } from "./worker-broker.ts";
import { workerDispatchFailure, type LeaseWorkerConfig } from "./process-pool.ts";
import { join } from "node:path";
import type { HuntSearchResult } from "../../hunt/search.ts";
import { readFromHeldCopies } from "../repository/incremental-reads.ts";

readFromHeldCopies();

const broker = workerBroker<LeaseWorkerConfig>(work);
/** A long job stops this far before the pool would end the process, so it can record what it has. */
const WALL_MARGIN_MS = 60_000;

async function work(config: LeaseWorkerConfig): Promise<void> {
  const endsAt = Date.now() + (config.wallMs ?? Number.POSITIVE_INFINITY) - WALL_MARGIN_MS;
  const url = config.postgres ? controlPlaneUrlFromEnv() : null;
  if (config.postgres && !url) throw new Error("CONTROL_PLANE_DATABASE_UNCONFIGURED");
  const stores = url ? await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true })
    : await createFileRepositories(config.fileStoreRoot ?? join(config.root, ".runtime/control-plane/freshness-shadow"));
  // Each result carries the repository calls its task made, so the round can show them per task.
  const observer = observeCyclePhases(stores);
  const repos = observer.repos;
  let websiteSize: WebsiteSizeForUrl = () => null;
  const safety = new FleetSafetyController({ now: new Date().toISOString(), charges: [], rollingCeilingUsd: config.ceilingUsd,
    websiteSize: url => websiteSize(url), websitePacing: repos.websitePacing,
    ...(config.hostConcurrency === undefined ? {} : { hostConcurrency: () => config.hostConcurrency! }) });
  // The guards read the current task; a process runs one place's lease at a time.
  let current = "";
  let fundedSubject: string | null = null;
  let shared: Awaited<ReturnType<typeof autonomousStandingRuntime>> | undefined;
  const buildRuntime = () => autonomousStandingRuntime({ root: config.root, repos, environment: process.env,
    browse: browseWithPlaywright,
    openBytesFor: s => safety.guardedOpenBytes("public-web", s),
    ...(config.modelEnabled ? { transport: request => broker.call<ModelResponse>("model", request),
      transportFor: jurisdiction => { broker.assignment(current, jurisdiction); return request => broker.call<ModelResponse>("model", request); } } : {}),
    ...(config.searchEnabled ? { search: request => broker.call<HuntSearchResult>("search", request),
      searchBudget: { take: host => broker.call<string | null>("search-take", host), done: async host => { await broker.call("search-done", host); } } } : {}),
    auditCeilingUsd: config.ceilingUsd, lifetimeHuntSubject: subject => subject === fundedSubject,
    endsAt, progress: () => broker.send("progress", "", null) });
  let id: string | null = config.taskIds[0] ?? null;
  try {
  while (id !== null) {
    if (!await broker.call<boolean>("accept-task", id)) break;
    try {
      const task = (await repos.routeTasks.read(id))?.value;
      if (!task || !["PENDING", "RECLAIMABLE"].includes(task.state)) broker.send("task-skipped", "", id);
      else {
        const item = (await repos.workItems.mustRead(task.workItemId)).value;
        websiteSize = websiteSizeForObligation({ id: item.id, subjectId: item.subject, autonomousPlan: item.autonomousPlan }, config.root);
        broker.assignment(id, { subjectId: item.subject, state: item.autonomousPlan?.jurisdiction ?? null });
        current = id;
        broker.send("task-start", "", id);
        fundedSubject = await broker.call<boolean>("funded-subject", item.subject) ? item.subject : null;
        const runtime = shared ??= await buildRuntime();
        observer.finish("runtime");
        await runtime.beginTask?.(task, item);
        const result = await dispatchAutonomousTask(runtime, task);
        broker.send("result", "", { ...result, repositoryCalls: observer.finish("task").repositoryCalls });
      }
    } catch (error) {
      if (!(error instanceof RepositoryLockHeld) && !(error instanceof Error && error.message === "WORKER_TASK_NOT_DISPATCHABLE")) {
        broker.send("result", "", workerDispatchFailure(id, error));
      } else broker.send("task-skipped", "", id);
    }
    id = Date.now() >= endsAt ? null : await broker.call<string | null>("next-task", null);
  }
  } finally { await shared?.close?.(); }
  broker.send("finished", "", []);
  process.disconnect();
}
