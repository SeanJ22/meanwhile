import { PLANNING_STATES } from "../lib/control-plane/scheduler/state-planning.ts";
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
import { makeHuntSearch } from "../lib/hunt/search.ts";
import { durableSearchBudget } from "../lib/control-plane/discovery/search-runtime.ts";
import { LaneOwnSpend, armHunterLane, hunterLaneArmingPath, laneWorkerTransport, type ArmedHunterLane } from "../lib/control-plane/workers/hunter-lane-arming.ts";
import { HUNTER_JOB_QUIET_MS, HUNTER_WORKER_RETIRE_MS, HUNTER_WORKER_WALL_MS, hunterLane, hunterLaneProgress, hunterQueuePath, readHunterQueue,
  stuckWorkerLine } from "../lib/control-plane/workers/hunter-lane.ts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";

readFromHeldCopies();

const ROOT = process.cwd();

const say = (line: string): void => { console.log(line); };
const nowIso = (): string => new Date().toISOString();
const wantsPostgres = process.argv.includes("--provider=postgres");
let drain = false;
process.on("message", message => {
  if (message !== null && typeof message === "object" && "kind" in message && message.kind === "RUNTIME_RELEASE_DRAIN") {
    drain = true;
    say("hunter lane: runtime release requested; the current wave finishes and the lane ends");
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

let stateIndex=-1;
let state="system";
let armingPath=hunterLaneArmingPath(ROOT,state);
let queuePath=hunterQueuePath(armingPath);
const selectedVersions=new Map<string,string>();
const selectQueue=():string=>{
  for(let count=0;count<PLANNING_STATES.length;count++) {
    stateIndex=(stateIndex+1)%PLANNING_STATES.length;
    const next=PLANNING_STATES[stateIndex];
    const path=hunterLaneArmingPath(ROOT,next);
    const queue=readHunterQueue(hunterQueuePath(path));
    if("unread" in queue || queue.taskIds.length===0 || selectedVersions.get(next)===queue.writtenAt)continue;
    state=next;armingPath=path;queuePath=hunterQueuePath(path);
    selectedVersions.set(state,queue.writtenAt);
    break;
  }
  return state;
};
const providerQueue = new ModelProviderQueue({
  ...(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE ? { requestsPerMinute: Number(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE) } : {}) });
const workerKey = (process.env[WORKER_CREDENTIAL_VAR] ?? "").trim();
const messages = anthropicTransport(workerKey, fetch, undefined, { onRateLimits: (limits, request) => { providerQueue.observe(request.model, limits); } });
const batch = backgroundBatchTransport({ apiKey: workerKey });
const ownSpend = new LaneOwnSpend();

let lastFleet: ArmedHunterLane["fleetSafety"] = null;

const lane = hunterLane({
  clock: Date.now,
  sleep: ms => new Promise(done => setTimeout(done, ms)),
  stopRequested: () => drain,
  log: say,
  readQueue: () => readHunterQueue(queuePath),
  selectQueue,
  arm: async () => {
    const armed = await armHunterLane({ repos,state, now: nowIso, armingPath, messages, batch, credentialConfigured: workerKey.length > 0,
      credentialVar: WORKER_CREDENTIAL_VAR, providerQueue, ownSpend,

      circuits: lastFleet === null ? null : lastFleet.snapshot(nowIso()).providerCircuits,
      ...(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE ? { requestsPerMinute: Number(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE) } : {}),
      onCondition: sentence => say(`hunter lane: ${sentence}`) });
    if (armed.fleetSafety !== null) lastFleet = armed.fleetSafety;
    return armed;
  },
  runWave: async ({ queue, paidOpen, deadlineMs, absorb }) => {
    const armed = lane.current();
    const plain = new Set(queue.plainTaskIds);
    const funded = new Set(armed.arming?.lifetimeHuntSubjects ?? []);

    const search = (() => {
      if (!paidOpen || !armed.discoverySearchOn || armed.fleetSafety === null) return null;
      const admitted = () => {
        try { lane.current().fleetSafety?.admitProviderRequest("discovery-search", "paid-search"); return null; }
        catch (error) { return error instanceof Error ? error.message : String(error); }
      };
      const budget = durableSearchBudget({ repos, perCycle: Number.MAX_SAFE_INTEGER, perDay: Number.MAX_SAFE_INTEGER, admit: admitted, admitLifetimeHunt: admitted, now: nowIso });
      const keys = { braveKey: process.env.BRAVE_SEARCH_API_KEY, exaKey: process.env.EXA_API_KEY };
      const normal = makeHuntSearch({ ...keys, budget });
      return normal === null ? null : { budget, normal, lifetime: makeHuntSearch({ ...keys, budget: budget.lifetimeHunt }) ?? normal };
    })();
    const slots = reportingWorkerSlots(workerProcessSlots(() => Number.MAX_SAFE_INTEGER,
      { parentPeakBytes: RESEARCH_PARENT_PEAK_MIB * 1024 * 1024, admissionsOpen: () => !drain && Date.now() < deadlineMs }));
    const taskIds = paidOpen ? queue.taskIds : queue.taskIds.filter(id => plain.has(id));
    const order = new Map(queue.taskIds.map((id, index) => [id, index] as const));

    const moreTasks = (): readonly string[] => {
      const next = absorb();
      if (next === null) return [];
      for (const id of next.plainTaskIds) plain.add(id);
      order.clear();
      next.taskIds.forEach((id, index) => order.set(id, index));
      return paidOpen ? next.taskIds : next.taskIds.filter(id => plain.has(id));
    };
    const progress = hunterLaneProgress({ log: say });

    const handingOut = (): boolean => !drain && Date.now() < deadlineMs;
    return runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/lease-worker.ts",

      childTimeoutMs: HUNTER_WORKER_WALL_MS,
      standing: { moreTasks, quietMs: HUNTER_JOB_QUIET_MS, retireAfterMs: HUNTER_WORKER_RETIRE_MS, onMoved: progress.step,
        onStuck: worker => { progress.stuck(); say(stuckWorkerLine(worker)); } },
      slots,
      config: { root: ROOT, postgres: wantsPostgres, taskIds, modelEnabled: paidOpen, searchEnabled: search !== null,
        get ceilingUsd() { return lane.current().ceilingUsd; }, fundedSubjects: [...funded] },
      capacity: () => {
        const current = lane.current();
        const paid = current.guards === null ? 0 : current.guards.paidWorkerCapacity(taskIds.length);
        return Math.min(taskIds.length, taskIds.filter(id => plain.has(id)).length + paid);
      },
      transportFor: laneWorkerTransport(lane.current, ownSpend, nowIso),
      ...(search === null ? {} : { searchFor: (subject: string) => funded.has(subject) ? search.lifetime : search.normal, searchBudget: search.budget }),

      orderPending: async ids => !handingOut() ? [] : ids.filter(id => order.has(id) && (lane.current().closed === null || plain.has(id)))
        .sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER)),
      onDispatched: result => {
        progress.taskDone();
        if (result.worker?.role !== "SCOUT") { say(`hunter lane: task done: ${result.routeTaskId ?? result.obligationId}; ${result.outcome ?? "NOT_RUN"}`); return; }
        const outcome = result.disposition === "INGESTED" ? "CAPTURED"
          : result.disposition === "WALKED_NO_YIELD" || result.disposition === "DISCOVERED" ? "NOTHING_FOUND" : "REFUSED";
        say(`hunter lane: hunt done: ${result.obligationId}; ${outcome}; code ${result.disposition ?? result.outcome ?? "NOT_RUN"}; usd ${result.cost?.usd === null || result.cost?.usd === undefined ? "unmeasured" : result.cost.usd.toFixed(6)}`);
      },
      onStarted: pid => { progress.started(); say(`hunter lane: lease worker process: pid ${pid}; pulls queued RouteTasks`); },
      onExited: (pid, why) => { progress.ended(); say(`hunter lane: lease worker process ended: pid ${pid}; ${why}`); } })
      .finally(progress.stop);
  },
});

process.on("uncaughtException", error => {
  console.error(`hunter lane: crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  void lane.releaseAll(nowIso()).finally(() => process.exit(1));
});

const run = await lane.run();
process.exit(run.releaseFailures.length > 0 ? 1 : 0);
