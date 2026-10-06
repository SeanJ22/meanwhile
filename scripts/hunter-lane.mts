/**
 * The standing hunter lane's process (CH-24 part 2, Proposal A). The runner
 * starts it only with WTP_CONTINUOUS_HUNTERS=1; the design note is in
 * lib/control-plane/workers/hunter-lane.ts. It is the one process that admits
 * paid model requests while the switch is on: the research round plans,
 * queues, and holds its own model lane closed.
 *
 *   node --experimental-strip-types scripts/hunter-lane.mts [--provider=postgres]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { backgroundBatchTransport } from "../lib/control-plane/model-batch.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { runLeaseWorkerProcesses, workerProcessSlots } from "../lib/control-plane/workers/process-pool.ts";
import { RESEARCH_PARENT_PEAK_MIB, reportingWorkerSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { installNeonCircuitBreaker } from "../lib/control-plane/neon-circuit.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { WORKER_CREDENTIAL_VAR } from "../lib/control-plane/scheduler/research-policy.ts";
import { anthropicTransport } from "../lib/control-plane/scheduler/scout-executor.ts";
import { makeScoutSearch } from "../lib/control-plane/scheduler/scout-search.ts";
import { durableSearchBudget } from "../lib/control-plane/discovery/search-runtime.ts";
import { scoutEscalationReservation } from "../lib/control-plane/fleet-safety.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { LaneOwnSpend, armHunterLane, hunterLaneArmingPath, laneWorkerTransport, type ArmedHunterLane } from "../lib/control-plane/workers/hunter-lane-arming.ts";
import { hunterLane, hunterQueuePath, readHunterQueue } from "../lib/control-plane/workers/hunter-lane.ts";
import { RUNTIME_NO_PROGRESS_MS } from "./pilot-runtime-child.mts";

const ROOT = process.cwd();
const nowIso = (): string => new Date().toISOString();
const wantsPostgres = process.argv.includes("--provider=postgres");
let drain = false;
process.on("message", message => {
  if (message !== null && typeof message === "object" && "kind" in message && message.kind === "RUNTIME_RELEASE_DRAIN") {
    drain = true;
    console.log("hunter lane: runtime release requested; the current wave finishes and the lane ends");
  }
});
process.on("SIGTERM", () => { drain = true; });

let repos: ControlPlaneRepositories;
if (wantsPostgres) {
  installNeonCircuitBreaker(ROOT, nowIso);
  installNeonRequestDeadline();
  const url = controlPlaneUrlFromEnv();
  if (url === null) { console.error("hunter lane: --provider=postgres was asked for and the control-plane URL is not set"); process.exit(1); }
  repos = await createPgRepositories(url, nowIso(), { skipBootstrap: true });
} else {
  const store = join(ROOT, ".runtime", "control-plane", "freshness-shadow");
  mkdirSync(store, { recursive: true });
  repos = await createFileRepositories(store);
}

const armingPath = hunterLaneArmingPath(ROOT);
const queuePath = hunterQueuePath(armingPath);
const providerQueue = new ModelProviderQueue({
  ...(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE ? { requestsPerMinute: Number(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE) } : {}) });
const workerKey = (process.env[WORKER_CREDENTIAL_VAR] ?? "").trim();
const messages = anthropicTransport(workerKey, fetch, undefined, { onRateLimits: (limits, request) => { providerQueue.observe(request.model, limits); } });
const batch = backgroundBatchTransport({ apiKey: workerKey });
const ownSpend = new LaneOwnSpend();
/** The controller the last refresh built; its circuits carry into the next. */
let lastFleet: ArmedHunterLane["fleetSafety"] = null;

const lane = hunterLane({
  clock: Date.now,
  sleep: ms => new Promise(done => setTimeout(done, ms)),
  stopRequested: () => drain,
  log: line => console.log(line),
  readQueue: () => readHunterQueue(queuePath),
  arm: async () => {
    const armed = await armHunterLane({ repos, now: nowIso, armingPath, messages, batch, credentialConfigured: workerKey.length > 0,
      credentialVar: WORKER_CREDENTIAL_VAR, activation: () => readActivationGate(ROOT), providerQueue, ownSpend,
      /* The lane's own latches outlive a refresh: it is the one process sending paid requests. */
      circuits: lastFleet === null ? null : lastFleet.snapshot(nowIso()).providerCircuits,
      ...(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE ? { requestsPerMinute: Number(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE) } : {}),
      onCondition: sentence => console.log(`hunter lane: ${sentence}`) });
    if (armed.fleetSafety !== null) lastFleet = armed.fleetSafety;
    return armed;
  },
  runWave: async ({ queue, paidOpen, deadlineMs }) => {
    const armed = lane.current();
    const plain = new Set(queue.plainTaskIds);
    const funded = new Set(armed.arming?.lifetimeHuntSubjects ?? []);
    /* Paid search, under the owner's switch and the same durable budget the round uses; admitted by the lane's current Fleet controller. */
    const search = (() => {
      if (!paidOpen || !armed.discoverySearchOn || armed.fleetSafety === null) return null;
      const admitted = () => {
        try { lane.current().fleetSafety?.admitProviderRequest("discovery-search", "paid-search"); return null; }
        catch (error) { return error instanceof Error ? error.message : String(error); }
      };
      const budget = durableSearchBudget({ repos, perCycle: Number.MAX_SAFE_INTEGER, perDay: Number.MAX_SAFE_INTEGER, admit: admitted, admitLifetimeHunt: admitted, now: nowIso });
      const keys = { braveKey: process.env.BRAVE_SEARCH_API_KEY, exaKey: process.env.EXA_API_KEY };
      const normal = makeScoutSearch({ ...keys, budget });
      return normal === null ? null : { normal, lifetime: makeScoutSearch({ ...keys, budget: budget.lifetimeHunt }) ?? normal };
    })();
    const slots = reportingWorkerSlots(workerProcessSlots(() => Number.MAX_SAFE_INTEGER,
      { parentPeakBytes: RESEARCH_PARENT_PEAK_MIB * 1024 * 1024, admissionsOpen: () => !drain && Date.now() < deadlineMs }));
    const taskIds = paidOpen ? queue.taskIds : queue.taskIds.filter(id => plain.has(id));
    const order = new Map(queue.taskIds.map((id, index) => [id, index] as const));
    /* No dispatch deadline: a worker is never ended mid-task by the lane's life. At the end of its life, or on a release drain,
       the lane starts no worker and hands out no further task; each worker finishes the task it holds. */
    const handingOut = (): boolean => !drain && Date.now() < deadlineMs;
    return runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/lease-worker.ts",
      /* A hung worker is ended, and says so, before the runner's no-progress limit could end the lane. */
      childTimeoutMs: RUNTIME_NO_PROGRESS_MS - 60_000,
      slots,
      config: { root: ROOT, postgres: wantsPostgres, taskIds, modelEnabled: paidOpen, searchEnabled: search !== null,
        get ceilingUsd() { return lane.current().ceilingUsd; }, fundedSubjects: [...funded] },
      capacity: () => {
        const current = lane.current();
        const paid = current.guards === null ? 0 : current.guards.paidWorkerCapacity(taskIds.length);
        return Math.min(taskIds.length, taskIds.filter(id => plain.has(id)).length + paid);
      },
      transportFor: laneWorkerTransport(lane.current, ownSpend, nowIso),
      ...(search === null ? {} : { searchFor: (subject: string) => funded.has(subject) ? search.lifetime : search.normal }),
      reserveEscalation: request => {
        const fleet = lane.current().fleetSafety;
        return fleet === null ? { admit: false, code: "MODEL_LANE_CLOSED", why: "the hunter lane is not armed" } as never : scoutEscalationReservation(fleet)(request);
      },
      /* While paid work is held, only plain-code tasks are handed out; the round's order otherwise. */
      orderPending: async ids => !handingOut() ? [] : ids.filter(id => lane.current().closed === null || plain.has(id))
        .sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER)),
      onDispatched: result => {
        if (result.worker?.role !== "SCOUT") { console.log(`hunter lane: task done: ${result.routeTaskId ?? result.obligationId}; ${result.outcome ?? "NOT_RUN"}`); return; }
        const outcome = result.disposition === "INGESTED" ? "CAPTURED"
          : result.disposition === "WALKED_NO_YIELD" || result.disposition === "DISCOVERED" ? "NOTHING_FOUND" : "REFUSED";
        console.log(`hunter lane: Scout done: ${result.obligationId}; ${outcome}; code ${result.disposition ?? result.outcome ?? "NOT_RUN"}; usd ${result.cost?.usd === null || result.cost?.usd === undefined ? "unmeasured" : result.cost.usd.toFixed(6)}`);
      },
      onStarted: pid => console.log(`hunter lane: lease worker process: pid ${pid}; pulls queued RouteTasks`),
      onExited: (pid, why) => console.log(`hunter lane: lease worker process ended: pid ${pid}; ${why}`) });
  },
});

process.on("uncaughtException", error => {
  console.error(`hunter lane: crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  void lane.releaseAll(nowIso()).finally(() => process.exit(1));
});

const run = await lane.run();
process.exit(run.releaseFailures.length > 0 ? 1 : 0);
