import { createFileRepositories } from "../repository/file-store.ts";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { RepositoryLockHeld } from "../repository/types.ts";
import type { ModelResponse } from "../scheduler/scout-executor.ts";
import { fleetSpendAt, FleetSafetyController } from "../fleet-safety.ts";
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
  const observed = observer.repos;
  const repos: typeof observed = { ...observed, costs: { ...observed.costs, async append(key, id, entry, now) {
    const saved = await observed.costs.append(key, id, entry, now);
    await broker.call("cost-recorded", saved.record);
    return saved;
  } } };
  let websiteSize: WebsiteSizeForUrl = () => null;
  const safetyStartedAt = new Date().toISOString();
  const safety = new FleetSafetyController({ now: safetyStartedAt, spend: fleetSpendAt([], safetyStartedAt), rollingCeilingUsd: config.ceilingUsd,
    websiteSize: url => websiteSize(url), websitePacing: repos.websitePacing,
    ...(config.hostConcurrency === undefined ? {} : { hostConcurrency: () => config.hostConcurrency! }) });
  // The process runs one task at a time; shared guards follow its current assignment.
  let current = "";
  let fundedSubject: string | null = null;
  let shared: Awaited<ReturnType<typeof autonomousStandingRuntime>> | undefined;
  const buildRuntime = () => autonomousStandingRuntime({ root: config.root, repos, environment: process.env,
    browse: browseWithPlaywright,
    openBytesFor: subject => safety.guardedOpenBytes("public-web", subject),
    ...(config.modelEnabled ? { transport: request => broker.call<ModelResponse>("model", request),
      transportFor: jurisdiction => { broker.assignment(current, jurisdiction); return request => broker.call<ModelResponse>("model", request); } } : {}),
    ...(config.searchEnabled ? { search: request => broker.call<HuntSearchResult>("search", request),
      searchBudget: { take: host => broker.call<string | null>("search-take", host), done: async host => { await broker.call("search-done", host); } } } : {}),
    auditCeilingUsd: config.ceilingUsd, lifetimeHuntSubject: subject => subject === fundedSubject, scopedReads: true,
    endsAt, progress: () => broker.send("progress", "", null) });
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
        fundedSubject = await broker.call<boolean>("lifetime-hunt", null) ? item.subject : null;
        // The lane's per-job clock: which task this worker is on (process-pool.ts StandingPoolOptions).
        broker.send("task-start", "", id);
        const runtime = shared ??= await buildRuntime();
        observer.finish("runtime");
        await runtime.beginTask?.(task, item);
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
