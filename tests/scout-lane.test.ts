/**
 * **THE SCOUT LANE'S SEEDED FAILURES.** (Level 1 activation, 2026-09-01.)
 *
 * Every test here plants a way the model lane could be wrong and asserts the
 * exact refusal. A fake transport stands in for the provider; a fake toolkit
 * stands in for the network. Nothing here reaches a model or a host.
 *
 *   1  a deterministic route never spends a model
 *   2  no tool used → refused; prose is not scouting
 *   3  a candidate citing an artifact nobody vaulted → refused
 *   4  an early NO_PROGRESS below the rung minimum → refused, and the Attempt
 *      ABORTS with its measured cost on the ledger
 *   5  the bound reached → the typed result carries rungs walked and next rungs
 *   6  the rolling ceiling defers, by name, and never disposes
 *   7  the derived Level 1 verdict ignores a stored ACTIVE flag
 *   8  provider identity, usage and cost land on the persisted Attempt
 */

import assert from "node:assert/strict";
import test from "node:test";

import { isArguedAbsence } from "../lib/control-plane/scheduler/absence.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { DurableSpendHolds, JobSpend, SendBudgetRefusal, budgetGuardedTransport } from "../lib/control-plane/expansion/spend-holds.ts";
import { aggregateModelSpend, FleetSafetyController, FleetPreSendRefusal } from "../lib/control-plane/fleet-safety.ts";
import {
  attemptsForRouteTask,
  registerRouteTask,
  registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { decideExecutor, dispatchOne, type DeclaredExecutor } from "../lib/control-plane/scheduler/dispatch.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { scheduledFixture } from "./control-plane-fixtures.ts";
import { runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { failureResponderExecutor } from "../lib/control-plane/workers/detective.ts";
import { scoutProcessExecutor } from "../lib/control-plane/workers/scout-process.ts";
import { routeProcessExecutor } from "../lib/control-plane/workers/route-process.ts";
import { workerProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import {
  cacheTtlOrderProblems,
  withCacheBreakpoints,
  scoutExecutor,
  OUTAGE_TIER_AFTER,
  ModelTransportError,
  dispositionForScout,
  type ModelRequest,
  type ModelResponse,
  type ModelTransport,
} from "../lib/control-plane/scheduler/scout-executor.ts";
import type { ArtifactProvenance, InheritedEvidence, ScoutToolkit, ScoutToolContext } from "../lib/control-plane/scheduler/scout-contract.ts";
import { MIN_DISTINCT_RUNGS, classifyPriorRung, consecutiveTransportFailures, validateScoutFinish, type ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import {
  RESEARCH_BOUNDS,
  researchWorkerCapacity,
  ceilingPermits,
  deriveLevel1,
  scoutSpendInWindow,
  type HostSupervision,
  type ResearchState,
} from "../lib/control-plane/scheduler/research-policy.ts";
import {
  DeterministicStepInvokedModel,
  REPRESENTATION_BUDGETS,
  UnknownStepInvokedModel,
  assertStepMayInvokeModel,
  fitRepresentation,
} from "../lib/control-plane/scheduler/model-routing.ts";
import type { InProcessSpendHoldStore } from "../lib/control-plane/expansion/spend-holds.ts";
/** The holds table's rows (schema v24), live or not yet deleted: the memory store's view of `cp_spend_holds`. */
const heldRows = (r: { readonly spendHolds?: unknown }) => (r.spendHolds as InProcessSpendHoldStore).rows();

const NOW = "2026-09-01T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

test("one funded geography can staff every ready job; shared slots follow budget and provider limits", () => {
  const funded = { availableUsd: 100, requestUsd: 0.04096 };
  assert.equal(researchWorkerCapacity({ ...funded, readyWork: 158 }), 158);
  assert.equal(researchWorkerCapacity({ ...funded, requestsPerMinute: 100 }), 100,
    "shared slots do not apply the geography count as a process cap");
  assert.equal(researchWorkerCapacity({ ...funded, readyWork: 158, requestsPerMinute: 20 }), 20);
  assert.equal(researchWorkerCapacity({ ...funded, readyWork: 158, inputTokensPerMinute: 65536,
    inputTokensPerRequest: 8192 }), 8);
  assert.equal(researchWorkerCapacity({ ...funded, readyWork: 158, outputTokensPerMinute: 32768,
    outputTokensPerRequest: 8192 }), 4);
  assert.equal(researchWorkerCapacity({ ...funded, readyWork: 158, availableUsd: 0.1 }), 2);
  assert.equal(researchWorkerCapacity({ ...funded, readyWork: 0 }), 0);
  assert.equal(researchWorkerCapacity({ ...funded, readyWork: 158, availableUsd: 0 }), 0);
  assert.equal(researchWorkerCapacity({ ...funded, readyWork: Number.NaN }), 0);
});

test('a solved held route bypasses paid admission and prewarming and counts as deterministic',async()=>{
  const {repos,task}=await registered();let requests=0,admissions=0,warms=0;
  const solved={refusal:null,outcome:'EVIDENCE_FOUND',subjectId:OBLIGATION.subjectId,recordClass:OBLIGATION.recordClass,
    attemptId:'held-attempt',recordedAt:NOW,candidates:[],findings:[{kind:'RECORD',field:'holder',value:'Ada',exactQuote:'Clerk Ada',
      sourceUrl:'https://county.gov/clerk',artifactIds:['held']}]} as unknown as ScoutResult;
  const held=failureResponderExecutor({solved,transport:async()=>{requests++;throw Error('No model');},
    toolkitFor:()=>{throw Error('No tools');},contextFor:()=>{throw Error('No new research');},now:()=>NOW});
  const cycle=await runCycle({repos,obligations:[OBLIGATION],debts:[],routeTaskFor:()=>task.id,maturity:()=> 'UNGRADUATED',
    holder:'held-cycle',now:NOW,leaseTtlMs:60_000,executor:{lane:'DETERMINISTIC',run:async()=>{throw Error('Use the held executor');}},
    reader:{contract:'READER',state:'NOT_READY',reason:'fixture'},truth:{contract:'TRUTH',state:'NOT_READY',reason:'fixture'},
    research:{decide:()=>({kind:'BOUNDED_MODEL_WORKER',why:'old route classification',disagreement:null}),
      admitScout:()=>{admissions++;return {admit:false,code:'PAUSED',why:'Paid work paused'};},
      prewarm:async()=>{warms++;throw Error('No prewarm');},modelExecutor:()=>held,workerCapacity:1,scoutLeaseTtlMs:420_000}});
  assert.equal(requests,0);assert.equal(admissions,0);assert.equal(warms,0);
  assert.equal(cycle.lanes?.model.dispatched,0);assert.equal(cycle.lanes?.deterministic.dispatched,1);
  assert.equal(cycle.dispatched[0].executor,'DETERMINISTIC');assert.equal(cycle.dispatched[0].cost?.usd,0);
  assert.equal(cycle.dispatched[0].cost?.requestCount,0);assert.equal(cycle.dispatched[0].executorMismatch,false);
});

test("full-size due queue dispatches an opened Scout before its deadline and never charges unopened rows", async () => {
  const { repos, task } = await registered();
  const obligations = [
    ...Array.from({ length: 614 }, (_, i) => ({ ...OBLIGATION, id: `det-${i}` })),
    OBLIGATION,
    ...Array.from({ length: 1839 }, (_, i) => ({ ...OBLIGATION, id: `scout-${i}` })),
  ];
  let admissions = 0;
  let executions = 0;
  const cycle = await runCycle({
    repos, obligations, debts: [], requireOpenOccurrence: true,
    routeTaskFor: id => id === OBLIGATION.id ? task.id : null,
    maturity: () => "UNGRADUATED", holder: "scaled-cycle", now: NOW, leaseTtlMs: 60_000,
    executor: { lane: "DETERMINISTIC", run: async () => { throw new Error("unopened deterministic dispatched"); } },
    reader: { contract: "READER", state: "NOT_READY", reason: "fixture" },
    truth: { contract: "TRUTH", state: "NOT_READY", reason: "fixture" },
    research: {
      decide: row => ({ kind: row.obligation.id.startsWith("det-") ? "DETERMINISTIC" : "BOUNDED_MODEL_WORKER", why: "fixture", disagreement: null }),
      admitScout: () => { admissions += 1; return { admit: true }; },
      modelExecutor: { lane: "BOUNDED_MODEL_WORKER", run: async () => {
        executions += 1;
        return { ranAs: "BOUNDED_MODEL_WORKER", kind: "ABORTED", detail: "bounded recorded fixture attempt" };
      } },
      workerCapacity: 2, scoutLeaseTtlMs: 420_000,
    },
  });
  assert.equal(executions, 1);
  assert.equal(admissions, 1);
  assert.equal(cycle.lanes?.model.due, 1840);
  assert.equal(cycle.lanes?.model.deferredBy.NO_OPEN_OCCURRENCE, 1839);
  assert.equal(cycle.deferred.length, 2453);
  assert.equal(cycle.debts.length, 1, "unopened rows are still due, never manufactured failed attempts");
});

const OBLIGATION: FreshnessObligation = {
  id: "freshness:test:scout#novel-route",
  recordClass: "meetings",
  subjectId: "ocd-division/country:us/state:az/place:test",
  routeId: "novel-route",
  active: true,
  readerImpactAt: null,
  observedChangeRateHours: null,
  lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString(),
};

async function registered(repos = createMemoryRepositories(), o: FreshnessObligation = OBLIGATION) {
  const item = createWorkItem({
    project: "freshness",
    subject: o.subjectId,
    obligation: `refresh:${o.recordClass}`,
    why: "test",
    now: NOW,
  });
  const task = createRouteTask({
    workItemId: item.id,
    routeId: o.routeId ?? "none",
    routeLabel: "test route",
    target: "example.invalid",
    inherited: false,
    now: NOW,
  });
  await registerWorkItem(repos, item, NOW);
  await registerRouteTask(repos, task, NOW);
  return { repos, item, task };
}

test("twenty ready Scouts for one place enter shared worker slots together", { timeout: 10_000 }, async () => {
  const repos = createMemoryRepositories();
  const obligations = Array.from({ length: 20 }, (_, index) => ({ ...OBLIGATION,
    id: `${OBLIGATION.id}-${index}`, routeId: `novel-route-${index}` }));
  const tasks = new Map<string, string>();
  for (const obligation of obligations) tasks.set(obligation.id, (await registered(repos, obligation)).task.id);
  const funded = { availableUsd: 100, requestUsd: 0.04096, requestsPerMinute: 20 };
  const slots = workerProcessSlots(() => researchWorkerCapacity(funded), {
    availableBytes: () => 8192 * 1024 * 1024, peakBytes: () => 248 * 1024 * 1024,
  });
  let starts = 0;
  let finish!: () => void;
  const everyoneStarted = new Promise<void>(resolve => { finish = resolve; });
  const cycle = await runCycle({ repos, obligations, debts: [], routeTaskFor: id => tasks.get(id) ?? null,
    maturity: () => "UNGRADUATED", holder: "one-place-parallel", now: NOW, leaseTtlMs: 60_000,
    executor: { lane: "DETERMINISTIC", run: async () => { throw new Error("model job reached plain-code lane"); } },
    reader: { contract: "READER", state: "NOT_READY", reason: "fixture" },
    truth: { contract: "TRUTH", state: "NOT_READY", reason: "fixture" },
    research: { decide: () => ({ kind: "BOUNDED_MODEL_WORKER", why: "ready work in one place", disagreement: null }),
      admitScout: () => ({ admit: true }), workerCapacity: researchWorkerCapacity({ ...funded, readyWork: obligations.length }),
      scoutLeaseTtlMs: 420_000, modelExecutor: { lane: "BOUNDED_MODEL_WORKER", run: async () => {
        const release = await slots.acquire("scout-worker.ts");
        try {
          if (++starts === obligations.length) finish();
          await everyoneStarted;
          return { ranAs: "BOUNDED_MODEL_WORKER", kind: "ABORTED", detail: "recorded offline fixture" };
        } finally { release(); }
      } },
    },
  });
  assert.equal(starts, 20);
  assert.equal(cycle.lanes?.model.dispatched, 20);
});

async function ordinaryWorkerProcesses() {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, dirname, resolve } = await import("node:path");
  const { createFileRepositories } = await import("../lib/control-plane/repository/file-store.ts");
  for (const scenario of ['SCOUT', 'DETECTIVE', 'CONTEXT_FAILURE']) {
    const contextFailure = scenario === 'CONTEXT_FAILURE';
    const root = await mkdtemp(join(tmpdir(), "s7-ordinary-scout-"));
    try {
      const repos = await createFileRepositories(root);
      const { task } = await registered(repos);
      const job = new JobSpend(new DurableSpendHolds({ budget: repos.budget, table: repos.spendHolds, now: () => NOW }),
        `ordinary-held:${scenario}`, OBLIGATION.id, { sends: [], areas: [{ key: "area:ordinary", label: "ordinary budget",
          budgetUsd: 20, historicalUsd: 0, historyReadAt: NOW }] });
      assert.equal((await job.admit(2, "ordinary Scout maximum")).admit, true);
      const pids: number[] = [];
      let modelCalls = 0;
      let starts = 0, results = 0;
      const executor = failureResponderExecutor({
        executorFactory: deps => scoutProcessExecutor({ root: process.cwd(), postgres: false, fileStoreRoot: root,
          onStarted: pid => pids.push(pid), deps }),
          toolkitFor: () => { throw new Error('toolkit belongs to the child'); },
          now: () => NOW,
          onStart: async ({ attemptId }) => {
            assert.equal((await repos.attempts.mustRead(attemptId)).value.outcome, null);
            starts++;
          },
          onResult: async result => {
            assert.equal((await repos.attempts.mustRead(result.attemptId)).value.outcome, null);
            if (scenario === 'DETECTIVE') assert.equal(result.researchRole, 'DETECTIVE');
            results++;
            return { ...result, spendHoldJobId: job.jobId };
          },
          transport: async () => { modelCalls++; throw new ModelTransportError("HTTP 400: fixture unchanged request", 400); },
          contextFor: () => {
            if (contextFailure) throw new Error("fixture context unavailable");
            return { route: null, providerId: "fixture", reason: "ordinary ungraduated route", decision: "BOUNDED_MODEL_WORKER",
              inherited: { artifactIds: [], summary: scenario === 'DETECTIVE' ? 'REFUSED: failed parse' : '' }, tools: { vault: async () => ({ stored: true, where: "fixture", why: "fixture" }), spaceOut: async () => {} } };
          },
        });
      const cycle = await runCycle({ repos, obligations: [OBLIGATION], debts: [],
        routeTaskFor: () => task.id, maturity: () => "UNGRADUATED", holder: "ordinary-process-test",
        now: NOW, leaseTtlMs: 60_000, executor: { lane: "DETERMINISTIC", run: async () => { throw new Error("wrong lane"); } },
        reader: { contract: "READER", state: "NOT_READY", reason: "fixture" }, truth: { contract: "TRUTH", state: "NOT_READY", reason: "fixture" },
        research: { decide: () => ({ kind: "BOUNDED_MODEL_WORKER", why: "fixture", disagreement: null }),
          admitScout: () => ({ admit: true }), modelExecutor: executor, workerCapacity: 2, scoutLeaseTtlMs: 60_000 } });
      assert.equal(pids.length, 1);
      assert.notEqual(pids[0], process.pid);
      const attempts = (await repos.attempts.list()).map(row => row.value);
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0]!.worker.role, scenario === 'DETECTIVE' ? 'DETECTIVE' : 'SCOUT');
      assert.ok(attempts[0]!.worker.instance.endsWith(`:worker:${pids[0]}`));
      assert.equal(cycle.dispatched.length, 1);
      assert.equal(modelCalls, contextFailure ? 0 : 1);
      assert.equal(starts, contextFailure ? 0 : 1);
      assert.equal(results, contextFailure ? 0 : 1);
      assert.notEqual(attempts[0]!.outcome, null);
      const costs = await repos.costs.readAll();
      assert.equal(costs.length, 1);
      assert.equal(costs[0].spendHoldJobId, contextFailure ? undefined : job.jobId,
        "the actual child cost writer retains the parent callback's exact hold identity");
      if (contextFailure) assert.equal(attempts[0]!.cost.usd, 0);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  const root = await mkdtemp(join(tmpdir(), "s7-ordinary-route-"));
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  try {
    const repos = await createFileRepositories(root);
    const { task } = await registered(repos);
    const pids: number[] = [];
    let opened = 0, vaulted = 0;
    const body = "<html><p>Observed official fixture record</p></html>";
    const executor = routeProcessExecutor({ root: process.cwd(), postgres: false, fileStoreRoot: root,
      route: { routeId: task.routeId, label: "fixture GET", executorClass: "DETERMINISTIC",
        executorReason: "The request is held plain code", citation: "offline fixture",
        open: { kind: "HTTP_GET", url: "https://fixture.example.gov/record" } },
      onStarted: pid => pids.push(pid), spaceOut: async () => {},
      openOne: async () => { opened++; return { status: 200, bytes: Buffer.byteLength(body),
        body, contentType: "text/html", durationMs: 1, transportError: null }; },
      vault: async (_artifact, text) => { assert.equal(text, body); vaulted++;
        return { stored: true, where: "fixture", why: "offline capture" }; },
    });
    const cycle = await runCycle({ repos, obligations: [OBLIGATION], debts: [], routeTaskFor: () => task.id,
      maturity: () => "GRADUATED", holder: "ordinary-route-process-test", now: NOW, leaseTtlMs: 60_000,
      executor, workerCapacity: 2,
      reader: { contract: "READER", state: "NOT_READY", reason: "fixture" },
      truth: { contract: "TRUTH", state: "NOT_READY", reason: "fixture" } });
    assert.equal(pids.length, 1);
    assert.notEqual(pids[0], process.pid);
    assert.equal(opened, 1);
    assert.equal(vaulted, 1);
    assert.equal(cycle.dispatched[0]!.outcome, "WORKED");
    assert.equal(cycle.dispatched[0]!.cost?.requestCount, 1);
    const attempts = (await repos.attempts.list()).map(row => row.value);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.outcome, "COMPLETED");
    assert.ok(attempts[0]!.worker.instance.endsWith(`:worker:${pids[0]}`));
  } finally { await rm(root, { recursive: true, force: true }); }
}

/** A toolkit whose fetch_public vaults one artifact per call and returns a rung. */
function fakeToolkit(): ScoutToolkit & { calls: string[] } {
  const vaulted = new Set<string>();
  const calls: string[] = [];
  let toolCalls = 0;
  return {
    calls,
    specs: [
      { name: "fetch_public", description: "fake", input_schema: { type: "object", properties: { url: { type: "string" }, rung: { type: "string" }, why: { type: "string" } }, required: ["url", "rung", "why"] } },
      { name: "read_permission", description: "fake", input_schema: { type: "object", properties: { url: { type: "string" }, rung: { type: "string" }, why: { type: "string" } }, required: ["url", "rung", "why"] } },
    ],
    get vaultedArtifactIds() {
      return vaulted;
    },
    get toolCalls() {
      return toolCalls;
    },
    requestCount: 0,
    bytesFetched: 0,
    async call(name, input, rungLabel) {
      toolCalls += 1;
      calls.push(name);
      const url = String((input as { url?: string }).url ?? "");
      const id = `art-${toolCalls}`;
      vaulted.add(id);
      return {
        ok: true,
        forModel: `[artifact ${id}] fetched ${url}`,
        artifacts: [
          {
            artifactId: id,
            tier: "RAW",
            contentHash: `sha256-${id}`,
            byteLength: 10,
            contentType: "text/html",
            canonicalUrl: url,
            partial: false,
            recordedAt: NOW,
          },
        ],
        /* RULING 243: the machine's record of what was vaulted, from which provenance is derived. */
        provenance: [
          {
            artifactId: id,
            canonicalUrl: url,
            retrievedAt: NOW,
            permission: "ALLOWED",
            methodRouteId: name === "read_permission" ? "scout:read_permission" : "scout:fetch_public",
            httpStatus: 200,
          },
        ],
        rung: { rung: rungLabel ?? "other:unlabelled", tool: name, target: url, observed: "HTTP 200, 10 bytes", artifactIds: [id], ok: true },
        requestCount: 1,
        bytesFetched: 10,
      };
    },
  };
}

/** A fresh, RELAUNCHED supervision reading: what a proven host carries on its research state (RULING 246). */
function provenSupervision(over: Partial<HostSupervision> = {}): HostSupervision {
  return {
    host: "test",
    checkedAt: NOW,
    measurable: true,
    notMeasurableReason: null,
    relaunchTrigger: { present: true, detail: "Repetition trigger present on the live task" },
    proof: {
      measuredAt: "2026-09-01T11:00:00.000Z",
      killedPid: 20240,
      relaunchedPid: 12900,
      secondsToRelaunch: 274,
      relaunchTriggerPresent: true,
      taskStateAfter: "Running",
      lastTaskResult: "0x00000000",
      verdict: "RELAUNCHED",
    },
    proofPath: "data/ops/runner-relaunch-proof.json",
    ...over,
  };
}

/** A scripted model: each entry is the content the model returns on that turn. */
function scriptedTransport(turns: readonly ModelResponse["content"][]): ModelTransport & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let i = 0;
  const t = (async (request: ModelRequest) => {
    requests.push(request);
    const content = turns[i] ?? [{ type: "text" as const, text: "script complete" }];
    i += 1;
    return {
      /* The provider reports the model it served: the one the request named. */
      model: request.model,
      stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      content,
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
    } satisfies ModelResponse;
  }) as ModelTransport & { requests: ModelRequest[] };
  t.requests = requests;
  return t;
}

const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use" as const, id, name, input });
const finish = (id: string, outcome: string, extra: Record<string, unknown> = {}) =>
  toolUse(id, "finish", {
    outcome,
    rungsWalked: [],
    candidates: [],
    findings: [],
    nextRungs: [],
    unverified: [],
    narrative: "test",
    ...extra,
  });

function executorWith(
  transport: ModelTransport,
  toolkit: ScoutToolkit,
  opts: {
    onResult?: (r: ScoutResult) => Promise<ScoutResult | void>;
    bound?: Partial<typeof RESEARCH_BOUNDS.perDispatch>;
    inherited?: InheritedEvidence;
    decision?: "DETERMINISTIC" | "BOUNDED_MODEL_WORKER";
    minRungs?: number;
    refusedBeforeSending?: (error: unknown) => boolean;
  } = {},
) {
  const results: ScoutResult[] = [];
  const exec = scoutExecutor({
    transport,
    refusedBeforeSending: opts.refusedBeforeSending,
    ...(opts.minRungs !== undefined ? { minRungs: opts.minRungs } : {}),
    toolkitFor: (_ctx: ScoutToolContext) => toolkit,
    contextFor: () => ({
      route: null,
      providerId: "test",
      reason: "test novelty",
      inherited: opts.inherited ?? { artifactIds: ["inherited-1"], summary: "none" },
      tools: { vault: async () => ({ stored: true, where: "x", why: "written" }), spaceOut: async () => undefined },
      ...(opts.decision ? { decision: opts.decision } : {}),
    }),
    now: () => NOW,
    bound: { ...RESEARCH_BOUNDS.perDispatch, ...(opts.bound ?? {}) },
    onResult: async (r) => {
      results.push(r);
      if (opts.onResult) return opts.onResult(r);
    },
  });
  return { exec, results };
}

/* ---------------------------------------------------------------------- 1 */

test("the runner's exact Scout hold reaches disposed and aborted cost rows without changing unknown dollars", async () => {
  for (const mode of ["disposed", "aborted", "unmetered", "no-hold"] as const) {
    const { repos, task } = await registered();
    const holds = new DurableSpendHolds({ budget: repos.budget, table: repos.spendHolds, now: () => NOW });
    const job = new JobSpend(holds, `actual-scout-job:${mode}`, OBLIGATION.id, { sends: [], areas: [{
      key: "area:existing", label: "existing budget", budgetUsd: 20, historicalUsd: 0, historyReadAt: NOW,
    }] });
    if (mode !== "no-hold") assert.equal((await job.admit(2, "Scout maximum")).admit, true);
    const scripted = scriptedTransport([
      [toolUse("fetch", "fetch_public", { url: "https://a.gov/meetings", rung: "primary-site-navigation", why: "source" })],
      [finish("finish", "EVIDENCE_FOUND", { spendHoldJobId: "model-invented-job",
        rungsWalked: [{ index: 0, note: "saved record" }],
        findings: [{ summary: "published meeting", artifactIds: ["art-1"], kind: "RECORD" }] })],
    ]);
    const transport: ModelTransport = mode === "unmetered"
      ? async () => { throw new Error("HTTP 529: response lost"); }
      : mode === "aborted" ? scriptedTransport([[finish("refused", "NO_PROGRESS")]]) : scripted;
    const { exec } = executorWith(transport, fakeToolkit(), { onResult: async result => {
      assert.equal(result.spendHoldJobId, undefined, "the model's finish cannot supply a budget identity");
      const amended = mode === "no-hold" ? result : { ...result, spendHoldJobId: job.jobId };
      await repos.scoutResults.append(result.obligationId, result.attemptId, amended, NOW);
      return amended;
    } });
    const result = await dispatchOne(repos, { obligation: scheduledFixture(OBLIGATION, NOW_MS),
      routeTaskId: task.id, holder: `held-${mode}`, now: NOW, leaseTtlMs: 60_000,
      maturity: () => "UNGRADUATED", executor: exec });
    assert.equal(result.outcome, mode === "disposed" || mode === "no-hold" ? "WORKED" : "FAILED", result.detail);
    const costs = await repos.costs.readAll();
    const saved = await repos.scoutResults.readAll();
    assert.equal(costs.length, 1, "the ordinary dispatch still writes exactly one cost row");
    assert.equal(saved.length, 1);
    assert.equal(costs[0].spendHoldJobId, mode === "no-hold" ? undefined : job.jobId);
    assert.equal(saved[0].spendHoldJobId, costs[0].spendHoldJobId);
    assert.notEqual(costs[0].attemptId, job.jobId, "the persisted link joins two distinct real identities");
    if (mode === "unmetered") {
      assert.equal(result.cost?.usd, null);
      assert.equal(costs[0].cost.usd, null, "the hold never becomes an invented measured charge");
      assert.equal(aggregateModelSpend(costs, NOW, NOW, Object.values(heldRows(repos))).usd, 2);
    }
  }
});

test("context assembly failure records a durable zero before any toolkit or provider request", async () => {
  const { repos, task } = await registered();
  let toolkitCalls = 0, providerCalls = 0, startCalls = 0;
  const exec = scoutExecutor({
    now: () => NOW,
    contextFor: () => { throw new TypeError("r.nextRungs.join is not a function"); },
    toolkitFor: () => { toolkitCalls++; return fakeToolkit(); },
    transport: async () => { providerCalls++; throw new Error("must not request"); },
    onStart: async () => { startCalls++; },
  });
  const result = await dispatchOne(repos, { obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: task.id, holder: "context-failure", now: NOW, leaseTtlMs: 60_000,
    maturity: () => "UNGRADUATED", executor: exec });
  assert.equal(result.outcome, "FAILED");
  assert.equal(result.dispositionCommitted, false);
  assert.equal(result.cost?.usd, 0);
  assert.equal(result.cost?.requestCount, 0);
  assert.equal(toolkitCalls + providerCalls + startCalls, 0);
  const attempt = (await attemptsForRouteTask(repos, task.id)).at(-1)!.value;
  assert.equal(attempt.outcome, "ABORTED");
  assert.equal(attempt.cost.usd, 0);
  assert.equal(attempt.cost.requestCount, 0);
  assert.match(result.detail, /SCOUT_CONTEXT_FAILED_BEFORE_REQUEST/);
  const costs = (await repos.costs.readAll()).filter(row => row.attemptId === attempt.id);
  assert.equal(costs.length, 1);
  assert.equal(costs[0].cost.usd, 0);
  assert.equal(costs[0].cost.requestCount, 0);
  await ordinaryWorkerProcesses();
});

test("a later toolkit construction failure remains unpriced and cannot release an unknown hold", async () => {
  const { repos, task } = await registered();
  const exec = scoutExecutor({ now: () => NOW,
    contextFor: () => ({ route: null, providerId: "test", reason: "test", inherited: { artifactIds: [], summary: "" },
      tools: { vault: async () => ({ stored: true, where: "x", why: "test" }), spaceOut: async () => undefined } }),
    toolkitFor: () => { throw new Error("unknown toolkit construction failure"); },
    transport: async () => { throw new Error("must not request"); },
  });
  const result = await dispatchOne(repos, { obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: task.id, holder: "toolkit-failure", now: NOW, leaseTtlMs: 60_000,
    maturity: () => "UNGRADUATED", executor: exec });
  assert.equal(result.outcome, "FAILED");
  assert.equal(result.cost, null);
  const attempt = (await attemptsForRouteTask(repos, task.id)).at(-1)!.value;
  assert.equal(attempt.cost.usd, null);
  assert.equal((await repos.costs.readAll()).filter(row => row.attemptId === attempt.id).length, 0);
});

test("a recorded Admin Send carries its selected questions into the actual Scout request without claiming publication", async () => {
  const transport = scriptedTransport([[finish("f", "NO_PROGRESS")]]);
  const { exec } = executorWith(transport, fakeToolkit(), { bound: {} });
  const obligation = { ...OBLIGATION, assignments: [{ assignmentKey: "zcta:2020/85635", ref: "isolated-send", relation: "REORDERED" as const, at: NOW, questions: ["ANYTHING_MISSING", "READER_CAN_SEE"] as const }] };
  const { repos, task } = await registered(createMemoryRepositories(), obligation);
  await dispatchOne(repos, { obligation: scheduledFixture(obligation, NOW_MS), routeTaskId: task.id, holder: "test", now: NOW, leaseTtlMs: 60_000, maturity: () => "UNGRADUATED", executor: exec, decision: { kind: "BOUNDED_MODEL_WORKER", why: "source investigation", disagreement: null } });
  const sent = JSON.stringify(transport.requests[0]?.messages);
  assert.match(sent, /OWNER'S QUESTION ANYTHING_MISSING/);
  assert.match(sent, /OWNER'S QUESTION READER_CAN_SEE/);
  assert.match(sent, /real reader link and public readback/);
  assert.doesNotMatch(sent, /OWNER'S QUESTION CONSISTENT/);
});

test("1. SEEDED: a route declared DETERMINISTIC never consumes a model", async () => {
  const det = decideExecutor({
    routeId: "known-get",
    descriptor: { executorClass: "DETERMINISTIC", open: { kind: "HTTP_GET" } },
    maturity: () => "UNGRADUATED",
  });
  assert.equal(det.kind, "DETERMINISTIC");
  assert.equal(det.disagreement, null);

  const contradiction = decideExecutor({
    routeId: "declared-det-no-opening",
    descriptor: { executorClass: "DETERMINISTIC", open: { kind: "NOT_MACHINE_EXECUTABLE" } },
    maturity: () => "UNGRADUATED",
  });
  assert.equal(contradiction.kind, "DETERMINISTIC", "declared deterministic stays deterministic");
  assert.match(contradiction.disagreement ?? "", /CONTRADICTION/);

  const novel = decideExecutor({
    routeId: "novel",
    descriptor: { executorClass: "BOUNDED_MODEL_WORKER", open: { kind: "NOT_MACHINE_EXECUTABLE" } },
    maturity: () => "UNGRADUATED",
  });
  assert.equal(novel.kind, "BOUNDED_MODEL_WORKER");

  const graduated = decideExecutor({
    routeId: "learned-since",
    descriptor: { executorClass: "BOUNDED_MODEL_WORKER", open: { kind: "HTTP_GET" } },
    maturity: () => "GRADUATED",
  });
  assert.equal(graduated.kind, "DETERMINISTIC", "graduated with an opening runs deterministically");
  assert.match(graduated.disagreement ?? "", /GRADUATED_SINCE_DECLARED/);

  /* And through the cycle: the model executor is never invoked for a deterministic row. */
  const { repos, task } = await registered();
  const transport = scriptedTransport([[finish("f", "NO_PROGRESS")]]);
  const { exec } = executorWith(transport, fakeToolkit());
  const deterministic: DeclaredExecutor = {
    lane: "DETERMINISTIC",
    run: async () => ({ ranAs: "DETERMINISTIC", kind: "ABORTED", detail: "deterministic walker ran" }),
  };
  const cycle = await runCycle({
    repos,
    obligations: [OBLIGATION],
    debts: [],
    routeTaskFor: () => task.id,
    maturity: () => "UNGRADUATED",
    executor: deterministic,
    holder: "t",
    now: NOW,
    leaseTtlMs: 60_000,
    reader: { contract: "READER", state: "NOT_READY", reason: "test" },
    truth: { contract: "TRUTH", state: "NOT_READY", reason: "test" },
    research: {
      decide: () => ({ kind: "DETERMINISTIC", why: "declared", disagreement: null }),
      admitScout: () => ({ admit: true }),
      modelExecutor: exec,
      workerCapacity: 2,
      scoutLeaseTtlMs: 60_000,
    },
  });
  assert.equal(transport.requests.length, 0, "no model request may be made for a deterministic route");
  assert.equal(cycle.lanes?.deterministic.dispatched, 1);
  assert.equal(cycle.lanes?.model.dispatched, 0);
});

/* ---------------------------------------------------------------------- 2 */

test("2. SEEDED: a model that called no tool and wrote prose is REFUSED", async () => {
  const { repos, task } = await registered();
  const transport = scriptedTransport([
    [{ type: "text", text: "I recall the county publishes agendas at example.gov/agendas." }, finish("f", "ROUTE_CANDIDATE", {
      candidates: [{ routeId: "recalled", title: "t", url: "https://example.gov/agendas", procedure: "GET", relevance: "r", permission: "CANNOT_TELL", permissionReading: "", evidenceArtifactIds: [], observedOn: NOW, recordClass: "meetings", deterministic: true, unverified: [] }],
    })],
  ]);
  const { exec, results } = executorWith(transport, fakeToolkit());
  const result = await dispatchOne(repos, {
    obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: task.id,
    holder: "t",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "UNGRADUATED",
    executor: exec,
  });
  assert.equal(result.outcome, "FAILED");
  assert.match(result.detail, /SCOUT_NO_TOOL_USED/);
  assert.match(result.detail, /SCOUT_CANDIDATE_WITHOUT_EVIDENCE/);
  assert.equal(results.length, 1, "the refused result is still persisted through onResult");
  assert.notEqual(results[0].refusal, null);
  const attempts = await attemptsForRouteTask(repos, task.id);
  assert.equal(attempts.at(-1)?.value.outcome, "ABORTED");
});

/* ---------------------------------------------------------------------- 3 */

test("3. SEEDED: a candidate citing an artifact nobody vaulted is refused; a vaulted one is accepted", () => {
  const rungs = [
    { index: 0, rung: "primary-site-navigation", tool: "fetch_public", target: "https://a.gov/", observed: "200", artifactIds: ["art-1"], note: null, at: NOW },
  ];
  const base = { rungsWalked: [{ index: 0, note: "ok" }], findings: [], nextRungs: [], unverified: [], narrative: "n" };
  const candidate = (ids: string[]) => ({ routeId: "r", title: "t", url: "https://a.gov/api", procedure: "GET", relevance: "r", permission: "ALLOWED" as const, permissionReading: "", evidenceArtifactIds: ids, observedOn: NOW, recordClass: "meetings", deterministic: true, unverified: [] });
  const refused = validateScoutFinish({
    finish: { ...base, outcome: "ROUTE_CANDIDATE", candidates: [candidate(["art-memory"])] },
    rungs,
    toolCalls: 1,
    stoppedBy: "MODEL",
    vaulted: new Set(["art-1"]),
    inherited: new Set(),
  });
  assert.ok(refused.some((i) => i.code === "SCOUT_CANDIDATE_WITHOUT_EVIDENCE"));
  const accepted = validateScoutFinish({
    finish: { ...base, outcome: "ROUTE_CANDIDATE", candidates: [candidate(["art-1"])] },
    rungs,
    toolCalls: 1,
    stoppedBy: "MODEL",
    vaulted: new Set(["art-1"]),
    inherited: new Set(),
  });
  assert.deepEqual(accepted, [], "POSITIVE CONTROL: the same candidate citing the vaulted artifact passes");
  const missingList = validateScoutFinish({
    finish: { ...base, rungsWalked: [], outcome: "ROUTE_CANDIDATE", candidates: [candidate(["art-1"])] },
    rungs,
    toolCalls: 1,
    stoppedBy: "MODEL",
    vaulted: new Set(["art-1"]),
    inherited: new Set(),
  });
  assert.ok(missingList.some((i) => i.code === "SCOUT_RUNG_LIST_MISSING"), "a walked rung not accounted for is refused");
});

/* ---------------------------------------------------------------------- 4 */

test("4. SEEDED: an early NO_PROGRESS below the rung minimum is refused, ABORTS, and its cost reaches the ledger", async () => {
  const { repos, task } = await registered();
  const toolkit = fakeToolkit();
  const transport = scriptedTransport([
    [toolUse("u1", "fetch_public", { url: "https://a.gov/", rung: "primary-site-navigation", why: "start" })],
    [finish("f", "NO_PROGRESS", { rungsWalked: [{ index: 0, note: "nothing" }], nextRungs: ["site-search-or-sitemap"] })],
    /* the model repeats the refused finish until the grace runs out */
    [finish("f2", "NO_PROGRESS", { rungsWalked: [{ index: 0, note: "nothing" }], nextRungs: ["site-search-or-sitemap"] })],
  ]);
  const { exec, results } = executorWith(transport, toolkit, { bound: {} });
  const result = await dispatchOne(repos, {
    obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: task.id,
    holder: "t",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "UNGRADUATED",
    executor: exec,
  });
  assert.equal(result.outcome, "FAILED");
  assert.match(result.detail, /SCOUT_EARLY_ABSENCE|SCOUT_NO_FINISH/);
  assert.equal(results[0].distinctEvidenceRungs, 1);
  assert.ok(MIN_DISTINCT_RUNGS > 1);
  const attempt = (await attemptsForRouteTask(repos, task.id)).at(-1)!.value;
  assert.equal(attempt.outcome, "ABORTED");
  assert.equal(attempt.worker.role, "SCOUT");
  assert.equal(attempt.worker.provider, "anthropic");
  assert.notEqual(attempt.cost.usd, null, "the aborted Attempt carries its measured cost");
  const ledger = (await repos.costs.readAll()).filter((c) => c.attemptId === attempt.id);
  assert.equal(ledger.length, 1, "the ledger holds the aborted Attempt's cost");
  assert.equal(ledger[0].role, "SCOUT");
});

/* ---------------------------------------------------------------------- 5 */

test("5. a deliberate stop preserves next rungs without an artificial tool cap", async () => {
  const { repos, task } = await registered();
  const toolkit = fakeToolkit();
  const transport = scriptedTransport([
    [toolUse("u1", "fetch_public", { url: "https://a.gov/", rung: "primary-site-navigation", why: "start" })],
    [toolUse("u2", "fetch_public", { url: "https://a.gov/sitemap.xml", rung: "site-search-or-sitemap", why: "map" })],
    [finish("f", "NO_PROGRESS", { rungsWalked: [{ index: 0, note: "home" }, { index: 1, note: "sitemap" }], nextRungs: ["open-data-portal", "alternate-official-host-or-mirror"] })],
  ]);
  const { exec, results } = executorWith(transport, toolkit, { minRungs: 2 });
  const result = await dispatchOne(repos, {
    obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: task.id,
    holder: "t",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "UNGRADUATED",
    executor: exec,
  });
  assert.equal(result.outcome, "FAILED", "NO_PROGRESS aborts the Attempt; the obligation stays owed");
  assert.match(result.detail, /SCOUT_NO_PROGRESS \(MODEL\)/);
  const r = results[0];
  assert.equal(r.refusal, null, "a result after the actual rung floor is legitimate");
  assert.equal(r.stoppedBy, "MODEL");
  assert.equal(r.rungs.length, 2);
  assert.deepEqual(r.nextRungs, ["open-data-portal", "alternate-official-host-or-mirror"]);
  assert.equal(r.rungs[1].note, "sitemap");
  const last = transport.requests.at(-1)!;
  assert.deepEqual(last.tool_choice, { type: "auto" }, "the finish stays auto without a cache-invalidating forced-tool rewrite");
});

/* -------------------------------------------------------------- 5a (CH-07 wall clock) */

test("CH-07: a hunter past its wall clock stops, saves the steps walked as a NO_PROGRESS case file, and is never an argued absence", async () => {
  const { repos, task } = await registered();
  const toolkit = fakeToolkit();
  const scripted = scriptedTransport([
    [toolUse("u1", "fetch_public", { url: "https://a.gov/", rung: "primary-site-navigation", why: "start" })],
    [finish("f", "NO_PROGRESS", { rungsWalked: [{ index: 0, note: "home" }], nextRungs: ["never-reached"] })],
  ]);
  const slow: ModelTransport & { requests: ModelRequest[] } = Object.assign(
    async (request: ModelRequest) => { await new Promise((resolve) => setTimeout(resolve, 60)); return scripted(request); },
    { requests: scripted.requests },
  );
  const { exec, results } = executorWith(slow, toolkit, { minRungs: 1 });
  const result = await dispatchOne(repos, {
    obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: task.id,
    holder: "t",
    now: NOW,
    leaseTtlMs: 60_000,
    bound: { maxAttempts: 3, maxWallMs: 30 },
    maturity: () => "UNGRADUATED",
    executor: exec,
  });
  const r = results[0];
  assert.equal(r.stoppedBy, "TIMEOUT");
  assert.equal(r.outcome, "NO_PROGRESS");
  assert.equal(r.refusal, null, "a timeout is a result, not a refusal");
  assert.equal(r.rungs.length, 1, "the step walked before the clock ran out is kept");
  assert.match(r.nextRungs[0], /fetch_public.*a\.gov/);
  assert.equal(slow.requests.length, 1, "no further model request is sent after the limit");
  assert.match(result.detail, /\(TIMEOUT\)/);
  assert.equal(isArguedAbsence({ ...r, researchRole: "DETECTIVE" }, 1), false, "a timeout is never filed as a 30-day absence");
});

/* -------------------------------------------------------------- 5a-2 (CH-30 AI service outage) */

test("CH-30: when the AI service stops answering mid-walk, the steps walked are kept as the case file", async () => {
  const { repos, task } = await registered();
  const scripted = scriptedTransport([
    [toolUse("u1", "fetch_public", { url: "https://a.gov/", rung: "primary-site-navigation", why: "start" })],
  ]);
  let calls = 0;
  const outage: ModelTransport & { requests: ModelRequest[] } = Object.assign(
    async (request: ModelRequest) => {
      calls += 1;
      if (calls === 1) return scripted(request);
      throw new Error('HTTP 529: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
    },
    { requests: scripted.requests },
  );
  const { exec, results } = executorWith(outage, fakeToolkit(), { minRungs: 1 });
  await dispatchOne(repos, {
    obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: task.id,
    holder: "t",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "UNGRADUATED",
    executor: exec,
  });
  const r = results[0];
  assert.equal(r.refusal?.[0].code, "SCOUT_TRANSPORT_FAILED", "the cause is still named");
  assert.equal(r.rungs.length, 1, "the step walked before the outage is kept");
  assert.match(r.nextRungs[0], /fetch_public.*a\.gov/, "the next agent resumes from it");
  assert.match(r.narrative, /kept/);
  assert.equal(consecutiveTransportFailures([r]), 1);
  assert.equal(consecutiveTransportFailures([{ refusal: null }, r, r]), 2);
  assert.equal(consecutiveTransportFailures([r, { refusal: null }]), 0, "any other ending stops the count");
});

test("CH-30: after repeated AI service failures the next attempt starts a tier up, and a healthy history stays put", async () => {
  const startModel = async (transportFailures: number | undefined) => {
    const { repos, task } = await registered();
    const scripted = scriptedTransport([[finish("f", "NO_PROGRESS", { rungsWalked: [], nextRungs: ["x"] })]]);
    const { exec, results } = executorWith(scripted, fakeToolkit(), {
      minRungs: 0,
      inherited: { artifactIds: [], summary: "none", ...(transportFailures === undefined ? {} : { transportFailures }) },
    });
    await dispatchOne(repos, { obligation: scheduledFixture(OBLIGATION, NOW_MS), routeTaskId: task.id, holder: "t", now: NOW, leaseTtlMs: 60_000, maturity: () => "UNGRADUATED", executor: exec });
    return { model: scripted.requests[0]?.model, klass: results[0]?.modelClass };
  };
  const steady = await startModel(1);
  const moved = await startModel(OUTAGE_TIER_AFTER);
  assert.notEqual(moved.klass, steady.klass, "two failures in a row move the start");
  assert.notEqual(moved.model, steady.model);
  assert.equal((await startModel(undefined)).klass, steady.klass);
});

/* -------------------------------------------------------------- 5b (early stop) */

test("EARLY STOP: a walk that stalls past minRungs finishes early instead of running to the turn bound", async () => {
  const { repos, task } = await registered();
  const toolkit = fakeToolkit();
  /*
   * Two distinct evidence rungs, then the model keeps re-reading a walked URL
   * (guard-refused, no new evidence). The transport finishes only once it is told
   * to (BOUND/EARLY STOP), so the turn count reveals whether early-stop fired:
   * a handful of turns with it, the full 20-turn bound without.
   */
  let call = 0;
  const transport = Object.assign(
    async (request: ModelRequest): Promise<ModelResponse> => {
      transport.requests.push(request);
      call += 1;
      const told = /EARLY STOP|BOUND REACHED/.test(JSON.stringify(request.messages));
      const content = told
        ? [finish("f", "NO_PROGRESS", { rungsWalked: [{ index: 0, note: "home" }, { index: 1, note: "sitemap" }], nextRungs: ["open-data-portal"] })]
        : call === 1
          ? [toolUse("u1", "fetch_public", { url: "https://a.gov/", rung: "primary-site-navigation", why: "start" })]
          : call === 2
            ? [toolUse("u2", "fetch_public", { url: "https://a.gov/sitemap.xml", rung: "site-search-or-sitemap", why: "map" })]
            : [toolUse(`re${call}`, "fetch_public", { url: "https://a.gov/", rung: "primary-site-navigation", why: "recheck" })];
      return {
        model: "claude-opus-5-5",
        stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
        content,
        usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
      } satisfies ModelResponse;
    },
    { requests: [] as ModelRequest[] },
  ) as ModelTransport & { requests: ModelRequest[] };
  const { exec, results } = executorWith(transport, toolkit, { minRungs: 2 });
  await dispatchOne(repos, {
    obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: task.id,
    holder: "t",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "UNGRADUATED",
    executor: exec,
  });
  assert.equal(results[0].distinctEvidenceRungs, 2);
  assert.equal(results[0].stoppedBy, "BOUND", "the stall bounds the walk");
  assert.ok(
    transport.requests.length <= 7,
    `early-stop ended the walk in ${transport.requests.length} turns rather than the 20-turn bound`,
  );
  assert.deepEqual(transport.requests.at(-1)!.tool_choice, { type: "auto" }, "the finish turn is offered auto, not a forced-finish rewrite");
});

/* ---------------------------------------------------------------------- 6 */

test("6. SEEDED: the rolling ceiling DEFERS model work by name and disposes nothing", async () => {
  const { repos, task } = await registered();
  const transport = scriptedTransport([[finish("f", "NO_PROGRESS")]]);
  const { exec } = executorWith(transport, fakeToolkit());
  const cycle = await runCycle({
    repos,
    obligations: [OBLIGATION],
    debts: [],
    routeTaskFor: () => task.id,
    maturity: () => "UNGRADUATED",
    executor: { lane: "DETERMINISTIC", run: async () => ({ ranAs: "DETERMINISTIC", kind: "ABORTED", detail: "unused" }) },
    holder: "t",
    now: NOW,
    leaseTtlMs: 60_000,
    reader: { contract: "READER", state: "NOT_READY", reason: "test" },
    truth: { contract: "TRUTH", state: "NOT_READY", reason: "test" },
    research: {
      decide: () => ({ kind: "BOUNDED_MODEL_WORKER", why: "novel", disagreement: null }),
      admitScout: () => ({ admit: false, code: "CEILING", why: "the rolling daily research ceiling is reached: $25.0000 of $25" }),
      modelExecutor: exec,
      workerCapacity: 2,
      scoutLeaseTtlMs: 60_000,
    },
  });
  assert.equal(transport.requests.length, 0);
  assert.equal(cycle.dispatched.length, 0);
  assert.equal(cycle.lanes?.model.deferred, 1);
  assert.equal(cycle.lanes?.model.deferredBy.CEILING, 1);
  assert.match(cycle.deferred[0].why, /CEILING/);
  assert.match(cycle.deferred[0].why, /never dropped/);
  assert.equal((await repos.dispositions.readAll()).length, 0);

  const cap = ceilingPermits(25, 25);
  assert.equal(cap.permits, false, "the cap fires AT the cap");
  assert.equal(ceilingPermits(24.99, 25).permits, true);
  assert.equal(ceilingPermits(null, 25).permits, false, "an unmeasured spend cannot be enforced against and defers");

  const spend = scoutSpendInWindow(
    [
      { attemptId: "a", workItemId: "w", routeTaskId: null, routeId: null, source: null, jurisdiction: null, project: "freshness", role: "SCOUT", cost: { inputTokens: 1, outputTokens: 1, usd: 2, durationMs: 1, bytesFetched: null, requestCount: 1, cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false }, recordedAt: NOW },
      { attemptId: "b", workItemId: "w", routeTaskId: null, routeId: null, source: null, jurisdiction: null, project: "freshness", role: "ACQUIRER", cost: { inputTokens: null, outputTokens: null, usd: 5, durationMs: 1, bytesFetched: null, requestCount: 1, cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false }, recordedAt: NOW },
      { attemptId: "c", workItemId: "w", routeTaskId: null, routeId: null, source: null, jurisdiction: null, project: "freshness", role: "SCOUT", cost: { inputTokens: 1, outputTokens: 1, usd: 3, durationMs: 1, bytesFetched: null, requestCount: 1, cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false }, recordedAt: "2026-08-30T00:00:00.000Z" },
    ],
    NOW,
  );
  assert.equal(spend.windowUsd, 2, "only SCOUT entries inside the window count");
});

/* ---------------------------------------------------------------------- 7 */

test("7. SEEDED: a manually asserted ACTIVE flag is ignored — the verdict is DERIVED", () => {
  const state = {
    formatVersion: 1,
    beatAt: NOW,
    cycleStartedAt: NOW,
    cycleFinishedAt: NOW,
    testedSha: "abc",
    host: "test",
    modelLaneEnabled: true,
    modelLaneDisabledReason: null,
    pausedByOwner: false,
    pauseIntentId: null,
    workerCredential: { name: "WTP_WORKERS_ANTHROPIC_API_KEY", configured: true, provider: "anthropic", context: "test" },
    model: "claude-opus-5-5",
    bounds: RESEARCH_BOUNDS,
    spend: { windowUsd: 1, measuredAttempts: 1, unmeasuredAttempts: 0, asOf: NOW },
    queue: { registeredUnits: 1, modelClassUnits: 1, modelClassDue: 1, modelClassDispatchedThisCycle: 1, modelClassDeferredForCeiling: 0, modelClassDeferredForCycleMax: 0, modelClassDeferredForLane: 0, deterministicDue: 0, deterministicDispatchedThisCycle: 0 },
    running: [],
    runtimeConditions: [],
    methodCandidates: null,
    hostSupervision: provenSupervision(),
    /* the seeded lie */
    active: true,
    verdict: "ACTIVE",
  } as unknown as ResearchState;
  const staleBeat = { formatVersion: 1, beatAt: "2026-09-01T00:00:00.000Z", lastCycleStartedAt: null, lastCycleFinishedAt: null, nextCycleDueAt: null, lastCycleOk: true, testedSha: null, host: "test" };
  const dead = deriveLevel1({ nowIso: NOW, heartbeat: staleBeat, state, intents: [], spendWindowUsd: 1, spendUnmeasuredAttempts: 0 });
  assert.equal(dead.verdict, "INACTIVE");
  assert.ok(dead.reasons.some((r) => /heartbeat/.test(r)), "the heartbeat reason is named");

  const alive = deriveLevel1({ nowIso: NOW, heartbeat: { ...staleBeat, beatAt: NOW }, state, intents: [], spendWindowUsd: 1, spendUnmeasuredAttempts: 0 });
  assert.equal(alive.verdict, "ACTIVE", "POSITIVE CONTROL: with every condition met the verdict is ACTIVE");

  const paused = deriveLevel1({
    nowIso: NOW,
    heartbeat: { ...staleBeat, beatAt: NOW },
    state,
    intents: [{ formatVersion: 1, kind: "INTENT", intentId: "PAUSE:1", action: "PAUSE", requestedAt: NOW, actor: "owner", adminSessionRef: "adm_x", note: null }],
    spendWindowUsd: 1,
    spendUnmeasuredAttempts: 0,
  });
  assert.equal(paused.verdict, "INACTIVE");
  assert.ok(paused.reasons.some((r) => /paused/.test(r)));

  const capped = deriveLevel1({ nowIso: NOW, heartbeat: { ...staleBeat, beatAt: NOW }, state, intents: [], spendWindowUsd: 100, spendUnmeasuredAttempts: 0 });
  assert.equal(capped.verdict, "ACTIVE", "cap-deferred is a legitimate ACTIVE state");
  assert.equal(capped.capDeferred, true);
});

/* ---------------------------------------------------------------------- 8 */

test("8. a ROUTE_CANDIDATE grounded in vaulted evidence disposes DISCOVERED with identity, usage and cost on the Attempt", async () => {
  const { repos, task } = await registered();
  const toolkit = fakeToolkit();
  const transport = scriptedTransport([
    [toolUse("u1", "read_permission", { url: "https://a.gov/", rung: "primary-site-navigation", why: "permission" })],
    [toolUse("u2", "fetch_public", { url: "https://a.gov/meetings", rung: "primary-site-navigation", why: "navigate" })],
    [
      toolUse("u3", "record_rung", { index: 1, note: "the meetings page links an .ics feed" }),
      finish("f", "ROUTE_CANDIDATE", {
        rungsWalked: [{ index: 0, note: "allowed" }, { index: 1, note: "meetings page" }],
        candidates: [{ routeId: "a-gov-meetings-ics", title: "ics feed", url: "https://a.gov/meetings.ics", procedure: "GET", relevance: "linked from the meetings page", permission: "ALLOWED", permissionReading: "robots allows /", evidenceArtifactIds: ["art-2"], observedOn: NOW, recordClass: "meetings", deterministic: true, unverified: ["the feed itself was not opened"] }],
      }),
    ],
  ]);
  const { exec, results } = executorWith(transport, toolkit);
  const result = await dispatchOne(repos, {
    obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: task.id,
    holder: "t",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "UNGRADUATED",
    executor: exec,
    decision: { kind: "BOUNDED_MODEL_WORKER", why: "novel", disagreement: null },
  });
  assert.equal(result.outcome, "WORKED");
  assert.equal(result.disposition, "DISCOVERED");
  assert.equal(result.executor, "BOUNDED_MODEL_WORKER");
  assert.equal(result.executorMismatch, false);
  assert.equal(result.artifactIds.length, 2);
  const attempt = (await attemptsForRouteTask(repos, task.id)).at(-1)!.value;
  assert.equal(attempt.outcome, "COMPLETED");
  assert.equal(attempt.worker.role, "SCOUT");
  assert.equal(attempt.worker.provider, "anthropic");
  assert.equal(attempt.worker.version, "claude-haiku-4-5", "MW-033: the Scout loop starts on the cheapest suitable class, Sonnet 5");
  assert.equal(attempt.cost.inputTokens, 3 * 1500, "input tokens include cache reads, summed over turns");
  assert.equal(attempt.cost.outputTokens, 300);
  assert.ok((attempt.cost.usd ?? 0) > 0);
  /* PC-9 (2026-09-06): the six metering fields land on the persisted Attempt and on the ledger row, read back. */
  assert.equal(attempt.cost.cacheReadInputTokens, 3 * 500);
  assert.equal(attempt.cost.cacheCreationInputTokens, 0);
  assert.equal(attempt.cost.uncachedInputTokens, 3 * 1000);
  assert.equal(attempt.cost.cacheCreation5mInputTokens, null, "the scripted response carries no cache_creation split: null, never zero");
  assert.equal(attempt.cost.cacheCreation1hInputTokens, null);
  assert.equal(attempt.cost.batch, false);
  const ledgerRow = (await repos.costs.readAll()).find((c) => c.attemptId === attempt.id);
  assert.ok(ledgerRow, "the Attempt's cost reached the ledger");
  assert.deepEqual(
    { read: ledgerRow.cost.cacheReadInputTokens, write: ledgerRow.cost.cacheCreationInputTokens, uncached: ledgerRow.cost.uncachedInputTokens, batch: ledgerRow.cost.batch },
    { read: 1500, write: 0, uncached: 3000, batch: false },
  );
  const r = results[0];
  assert.equal(r.outcome, "ROUTE_CANDIDATE");
  assert.equal(r.rungs[1].note, "meetings page", "the model's per-rung note travels; the rung itself is machine-derived");
  assert.equal(r.worker.modelReported, "claude-haiku-4-5");
  assert.equal(r.modelClass, "haiku");
  assert.equal(r.escalatedFrom, null, "a Sonnet attempt that finished never moved up");
  assert.equal(r.usage.turns, 3);
  assert.equal(r.usage.toolCalls, 2);
  const commit = (await repos.dispositions.readAll()).at(-1)!;
  assert.equal(commit.disposition.disposition, "DISCOVERED");
  assert.match(commit.disposition.note, /a-gov-meetings-ics/);
  assert.match(commit.disposition.note, /nothing is promoted to reader truth/);

  const evidence = dispositionForScout({ ...r, outcome: "EVIDENCE_FOUND", findings: [{ summary: "the agenda PDF", artifactIds: ["art-2"], kind: "RECORD" }] });
  assert.equal(evidence?.disposition, "INGESTED");
  assert.equal(dispositionForScout({ ...r, outcome: "NO_PROGRESS" }), null);
});

/* ---------------------------------------------------------------------- 9 */

test("9. SEEDED (measured live): an artifact the log refuses does not leave the Attempt open", async () => {
  const { repos, task } = await registered();
  /* Two hosts serve byte-identical robots.txt: one content id, two canonical URLs. */
  const vaulted = new Set<string>();
  let calls = 0;
  const colliding: ScoutToolkit = {
    specs: [{ name: "read_permission", description: "fake", input_schema: { type: "object", properties: { url: { type: "string" }, rung: { type: "string" }, why: { type: "string" } }, required: ["url", "rung", "why"] } }],
    get vaultedArtifactIds() {
      return vaulted;
    },
    get toolCalls() {
      return calls;
    },
    requestCount: 0,
    bytesFetched: 0,
    async call(name, input, rungLabel) {
      calls += 1;
      const url = String((input as { url?: string }).url ?? "");
      vaulted.add("ar-same-bytes");
      return {
        ok: true,
        forModel: `[artifact ar-same-bytes] ${url}`,
        artifacts: [{ artifactId: "ar-same-bytes", tier: "RAW", contentHash: "sha256-same", byteLength: 10, contentType: "text/plain", canonicalUrl: url, partial: false, recordedAt: NOW }],
        rung: { rung: rungLabel ?? "other:x", tool: name, target: url, observed: "robots.txt HTTP 200", artifactIds: ["ar-same-bytes"] },
        requestCount: 1,
        bytesFetched: 10,
      };
    },
  };
  const transport = scriptedTransport([
    [toolUse("u1", "read_permission", { url: "https://a.gov/robots.txt", rung: "primary-site-navigation", why: "p" })],
    [toolUse("u2", "read_permission", { url: "https://www.a.gov/robots.txt", rung: "alternate-official-host-or-mirror", why: "p" })],
    [
      finish("f", "EVIDENCE_FOUND", {
        rungsWalked: [{ index: 0, note: "a" }, { index: 1, note: "b" }],
        findings: [{ summary: "the robots document", artifactIds: ["ar-same-bytes"], kind: "POINTER" }],
      }),
    ],
  ]);
  const { exec } = executorWith(transport, colliding);
  const result = await dispatchOne(repos, {
    obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: task.id,
    holder: "t",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "UNGRADUATED",
    executor: exec,
  });
  assert.equal(result.outcome, "WORKED", result.detail);
  assert.equal(result.disposition, "POINTER_ONLY");
  const attempt = (await attemptsForRouteTask(repos, task.id)).at(-1)!.value;
  assert.equal(attempt.outcome, "COMPLETED", "the Attempt closed; a second URL for one content id is not a reason to leave it open");
  assert.equal(result.artifactIds.length, 1, "one content id is attributed once");
  const lease = await repos.leases.read(task.id);
  assert.equal(lease?.value.released, true, "the lease is released");
});

/* --------------------------------------------------------------------- 10 */

test("10. a lost or server-error response keeps unknown spending reserved, including after metered turns", async () => {
  const { repos, task } = await registered();
  const overloaded: ModelTransport = async () => {
    throw new Error('HTTP 529: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
  };
  const { exec, results } = executorWith(overloaded, fakeToolkit());
  const result = await dispatchOne(repos, {
    obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: task.id,
    holder: "t",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "UNGRADUATED",
    executor: exec,
  });
  assert.equal(result.outcome, "FAILED");
  assert.match(result.detail, /SCOUT_TRANSPORT_FAILED/);
  assert.match(result.detail, /529/);
  assert.equal(results[0].refusal?.[0].code, "SCOUT_TRANSPORT_FAILED");
  const attempt = (await attemptsForRouteTask(repos, task.id)).at(-1)!.value;
  assert.equal(attempt.outcome, "ABORTED");
  assert.equal(attempt.cost.usd, null, "a server failure does not prove zero provider spending");
  assert.equal(attempt.cost.inputTokens, null);
  assert.equal(attempt.cost.requestCount, null, "no completed response cannot establish zero sent requests");
  const ledger = (await repos.costs.readAll()).filter((c) => c.attemptId === attempt.id);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].cost.usd, null);
  /* Prior metered steps survive, but do not price the unknown later request. */
  let n = 0;
  const failsSecond: ModelTransport = async () => {
    n += 1;
    if (n === 2) throw new Error("HTTP 529: overloaded");
    return { model: "claude-opus-5-5", stop_reason: "tool_use", content: [toolUse("u1", "fetch_public", { url: "https://a.gov/", rung: "primary-site-navigation", why: "w" })], usage: { input_tokens: 100, output_tokens: 10 } };
  };
  const second = await registered();
  const { exec: exec2, results: results2 } = executorWith(failsSecond, fakeToolkit());
  await dispatchOne(second.repos, { obligation: scheduledFixture(OBLIGATION, NOW_MS), routeTaskId: second.task.id, holder: "t", now: NOW, leaseTtlMs: 60_000, maturity: () => "UNGRADUATED", executor: exec2 });
  assert.equal(results2[0].usage.turns, 1);
  assert.equal(results2[0].usd, null);
  assert.ok(results2[0].steps?.some(step => step.kind === "MODEL" && (step.usd ?? 0) > 0));
  assert.equal(results2[0].modelAttempts?.[0].usd, null);
});

test("only recognized request rejections establish zero, not timeout or arbitrary HTTP statuses", async () => {
  for (const status of [400, 401, 429, 408, 499, 500, 504, 529]) {
    const { repos, task } = await registered();
    const { exec } = executorWith(async () => { throw new ModelTransportError(`HTTP ${status}`, status); }, fakeToolkit());
    const result = await dispatchOne(repos, { obligation: scheduledFixture(OBLIGATION, NOW_MS),
      routeTaskId: task.id, holder: `status-${status}`, now: NOW, leaseTtlMs: 60_000,
      maturity: () => "UNGRADUATED", executor: exec });
    const rejected = [400, 401, 429].includes(status);
    assert.equal(result.cost?.usd, rejected ? 0 : null, `status ${status}`);
    assert.equal(result.cost?.requestCount, rejected ? 1 : null, `request count for status ${status}`);
  }
});

test("proven pre-send Scout refusals settle unused holds without erasing earlier measured turns", async () => {
  for (const mode of ["fleet-before-first", "budget-before-first", "fleet-after-metered", "unpriced-after-response"] as const) {
    const { repos, task } = await registered();
    const holds = new DurableSpendHolds({ budget: repos.budget, table: repos.spendHolds, now: () => NOW, sleep: async () => undefined });
    const line = { key: "area:zcta:2020/85635@2026-09-27T22:17:50.236Z", label: "original", budgetUsd: 50, historicalUsd: 0, historyReadAt: new Date(NOW_MS - 1_000).toISOString() };
    const job = new JobSpend(holds, mode, OBLIGATION.id, { sends: [], areas: [line] });
    assert.equal((await job.admit(2, "Scout")).admit, true);
    const heldFleet = new FleetSafetyController({ now: NOW, costs: [], modelHold: "lane closed", clock: () => NOW_MS });
    const openFleet = new FleetSafetyController({ now: NOW, costs: [], rollingCeilingUsd: 50, clock: () => NOW_MS });
    let sent = 0;
    const provider: ModelTransport = async request => {
      sent++;
      return { model: request.model, stop_reason: "tool_use", content: [toolUse("u1", "fetch_public", { url: "https://a.gov/", rung: "primary-site-navigation", why: "w" })],
        usage: mode === "unpriced-after-response" ? { input_tokens: 100 } : { input_tokens: 100, output_tokens: 10 } } as ModelResponse;
    };
    const guarded: ModelTransport = request => (mode === "fleet-before-first" || mode === "fleet-after-metered" && sent > 0 ? heldFleet : openFleet)
      .guardedModelTransport("anthropic", OBLIGATION.id, provider)(request);
    const transport = budgetGuardedTransport({ job: () => job,
      worstCaseOf: () => mode === "budget-before-first" ? 51 : 1, priceOf: () => null, transport: guarded });
    const { exec } = executorWith(transport, fakeToolkit(), {
      refusedBeforeSending: error => error instanceof FleetPreSendRefusal || error instanceof SendBudgetRefusal,
    });
    const result = await dispatchOne(repos, { obligation: scheduledFixture(OBLIGATION, NOW_MS), routeTaskId: task.id,
      holder: mode, now: NOW, leaseTtlMs: 60_000, maturity: () => "UNGRADUATED", executor: exec });
    const expectedSent = mode === "fleet-after-metered" || mode === "unpriced-after-response" ? 1 : 0;
    if (mode !== "unpriced-after-response") {
      assert.equal((await repos.attempts.mustRead(result.attemptId!)).value.outcome, "DENIED_BY_POLICY", mode);
      assert.match(result.detail, /SCOUT_POLICY_DENIED/);
      assert.doesNotMatch(result.detail, /SCOUT_TRANSPORT_FAILED/);
    }
    assert.equal(sent, expectedSent, mode);
    assert.equal(result.cost?.requestCount, mode === "unpriced-after-response" ? null : expectedSent, mode);
    if (mode === "unpriced-after-response") assert.equal(result.cost?.usd, null);
    else if (mode === "fleet-after-metered") assert.ok((result.cost?.usd ?? 0) > 0);
    else assert.equal(result.cost?.usd, 0);
    await holds.settle(job.jobId, result.cost?.usd ?? null, NOW);
    const left = (await holds.left([line]))?.[0].leftUsd;
    assert.equal(left, 50 - (result.cost?.usd ?? 2), mode);
  }
});

test("an unknown sent Scout request cannot settle away its original lifetime reservation", async () => {
  const { repos, task } = await registered();
  const holds = new DurableSpendHolds({ budget: repos.budget, table: repos.spendHolds, now: () => NOW, sleep: async () => undefined });
  const line = { key: "area:zcta:2020/85635@2026-09-27T22:17:50.236Z", label: "original lifetime hunt", budgetUsd: 50, historicalUsd: 0, historyReadAt: NOW };
  const job = new JobSpend(holds, "unknown-response-job", OBLIGATION.id, { sends: [], areas: [line] });
  assert.equal((await job.admit(2, "Scout attempt")).admit, true);
  let sent = 0;
  const transport = budgetGuardedTransport({ job: () => job, worstCaseOf: () => 1, priceOf: () => null,
    transport: async () => { sent++; throw new Error("connection lost after request was sent"); } });
  const { exec } = executorWith(transport, fakeToolkit());
  const result = await dispatchOne(repos, { obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: task.id, holder: "unknown-response", now: NOW, leaseTtlMs: 60_000,
    maturity: () => "UNGRADUATED", executor: exec });
  assert.equal(sent, 1);
  assert.equal(result.cost?.usd, null);
  await holds.settle(job.jobId, result.cost?.usd ?? null, NOW);
  assert.equal((await holds.left([line]))?.[0].leftUsd, 48);
  const contender = new JobSpend(holds, "retry", OBLIGATION.id, { sends: [], areas: [line] });
  assert.equal((await contender.admit(49, "retry cannot consume unknown exposure")).admit, false);
});

/* ================================================================== *
 * RULING 243 — provenance is the machine's
 * ================================================================== */

const candidateWith = (over: Record<string, unknown> = {}) => ({
  routeId: "a-gov-meetings",
  title: "meetings page",
  url: "https://a.gov/meetings",
  procedure: "GET",
  relevance: "the meetings page",
  permission: "ALLOWED",
  permissionReading: "robots allows /",
  evidenceArtifactIds: ["art-1"],
  observedOn: "2026-09-01",
  recordClass: "meetings",
  deterministic: true,
  unverified: [],
  ...over,
});

async function dispatchScout(exec: DeclaredExecutor) {
  const { repos, task } = await registered();
  const result = await dispatchOne(repos, { obligation: scheduledFixture(OBLIGATION, NOW_MS), routeTaskId: task.id, holder: "t", now: NOW, leaseTtlMs: 60_000, maturity: () => "UNGRADUATED", executor: exec });
  return { repos, task, result };
}

test("11. SEEDED (RULING 243): a finish whose observedOn disagrees with the artifact record is REFUSED; the corrected claim is accepted and the candidate carries machine-owned provenance", async () => {
  const toolkit = fakeToolkit();
  const transport = scriptedTransport([
    [toolUse("u1", "fetch_public", { url: "https://a.gov/meetings", rung: "primary-site-navigation", why: "w" })],
    [finish("f1", "ROUTE_CANDIDATE", { rungsWalked: [{ index: 0, note: "n" }], candidates: [candidateWith({ observedOn: "2026-01-01" })] })],
    [finish("f2", "ROUTE_CANDIDATE", { rungsWalked: [{ index: 0, note: "n" }], candidates: [candidateWith({ observedOn: "2026-09-01" })] })],
  ]);
  const { exec, results } = executorWith(transport, toolkit);
  const { result } = await dispatchScout(exec);
  assert.equal(result.outcome, "WORKED", result.detail);
  assert.equal(transport.requests.length, 3, "the wrong claim cost one refused turn, then the corrected one was accepted");
  const afterRefusal = JSON.stringify(transport.requests[2].messages.at(-1)?.content);
  assert.match(afterRefusal, /SCOUT_PROVENANCE_DISAGREES/);
  assert.match(afterRefusal, /the model says 2026-01-01/);
  const c = results[0].candidates[0];
  assert.equal(c.observedOn, "2026-09-01", "observedOn is the artifact's retrieval date, machine-written");
  assert.equal(c.permission, "ALLOWED");
  assert.equal(c.recordClass, "meetings");
  assert.deepEqual(c.evidenceArtifactIds, ["art-1"]);
  assert.deepEqual(c.claims, { observedOn: "2026-09-01", permission: "ALLOWED", recordClass: "meetings" }, "the model's statements are recorded as claims");
  assert.deepEqual(c.provenance?.derivedFrom, ["art-1"]);
  assert.match(c.provenance?.rule ?? "", /earliest retrievedAt/);
});

test("12. SEEDED (RULING 243): a permission claim the record contradicts, a citation of robots documents only, and an absent claim are each refused by name", () => {
  const prov = new Map<string, ArtifactProvenance>([
    ["art-1", { artifactId: "art-1", canonicalUrl: "https://a.gov/meetings", retrievedAt: NOW, permission: "NOT_APPLICABLE", methodRouteId: "scout:fetch_public", httpStatus: 200 }],
    ["rob-1", { artifactId: "rob-1", canonicalUrl: "https://a.gov/robots.txt", retrievedAt: NOW, permission: "ALLOWED", methodRouteId: "scout:read_permission", httpStatus: 404 }],
    ["art-2", { artifactId: "art-2", canonicalUrl: "https://b.gov/x", retrievedAt: "2026-08-30T00:00:00.000Z", permission: "ALLOWED", methodRouteId: "scout:fetch_public", httpStatus: 200 }],
  ]);
  const rungs = [{ index: 0, rung: "primary-site-navigation", tool: "fetch_public", target: "https://a.gov/meetings", observed: "200", artifactIds: ["art-1"], note: null, at: NOW }];
  const base = { rungs, toolCalls: 1, stoppedBy: "MODEL" as const, vaulted: new Set(["art-1", "rob-1", "art-2"]), inherited: new Set<string>(), machine: { provenance: prov, recordClass: "meetings" } };
  const fin = (candidates: unknown[]) => ({ outcome: "ROUTE_CANDIDATE", rungsWalked: [{ index: 0, note: "n" }], candidates: candidates as never, findings: [], nextRungs: [], unverified: [], narrative: "n" });

  const disagrees = validateScoutFinish({ ...base, finish: fin([candidateWith({ permission: "ALLOWED" })]) });
  assert.ok(disagrees.some((i) => i.code === "SCOUT_PROVENANCE_DISAGREES" && /retrieved under NOT_APPLICABLE/.test(i.detail)), JSON.stringify(disagrees));

  const agrees = validateScoutFinish({ ...base, finish: fin([candidateWith({ permission: "NOT_APPLICABLE" })]) });
  assert.deepEqual(agrees, [], "POSITIVE CONTROL: the claim that matches the record passes");

  const robotsOnly = validateScoutFinish({ ...base, finish: fin([candidateWith({ evidenceArtifactIds: ["rob-1"] })]) });
  assert.ok(robotsOnly.some((i) => i.code === "SCOUT_PROVENANCE_UNDERIVABLE" && /only robots documents/.test(i.detail)));

  const absent = validateScoutFinish({ ...base, finish: fin([candidateWith({ observedOn: "", permission: "NOT_APPLICABLE" })]) });
  assert.ok(absent.some((i) => i.code === "SCOUT_PROVENANCE_ABSENT" && /observedOn/.test(i.detail)));

  const wrongClass = validateScoutFinish({ ...base, finish: fin([candidateWith({ permission: "NOT_APPLICABLE", recordClass: "roster" })]) });
  assert.ok(wrongClass.some((i) => i.code === "SCOUT_PROVENANCE_DISAGREES" && /recordClass/.test(i.detail)));

  /* Two hosts, two verdicts, neither at the candidate URL: no single verdict follows. */
  const conflict = validateScoutFinish({ ...base, finish: fin([candidateWith({ url: "https://c.gov/api", evidenceArtifactIds: ["art-1", "art-2"], permission: "ALLOWED" })]) });
  assert.ok(conflict.some((i) => i.code === "SCOUT_PROVENANCE_UNDERIVABLE" && /disagree on permission/.test(i.detail)));

  /* The earliest retrieval date wins; the claim may name any cited artifact's date. */
  const earliest = validateScoutFinish({ ...base, finish: fin([candidateWith({ url: "https://b.gov/x", evidenceArtifactIds: ["art-2", "art-1"], observedOn: "2026-09-01", permission: "ALLOWED" })]) });
  assert.deepEqual(earliest, []);
});

test("12b. robots.txt is RECORDED, never a refusal (owner decision 2026-09-25): a candidate citing a page retrieved under DISALLOWED or CANNOT_TELL is accepted, and the verdict is its machine-owned permission", () => {
  const prov = new Map<string, ArtifactProvenance>([
    ["art-d", { artifactId: "art-d", canonicalUrl: "https://a.gov/meetings", retrievedAt: NOW, permission: "DISALLOWED", methodRouteId: "scout:fetch_public", httpStatus: 200 }],
    ["art-c", { artifactId: "art-c", canonicalUrl: "https://c.gov/agendas", retrievedAt: NOW, permission: "CANNOT_TELL", methodRouteId: "scout:fetch_public", httpStatus: 200 }],
  ]);
  const rungs = [{ index: 0, rung: "primary-site-navigation", tool: "fetch_public", target: "https://a.gov/meetings", observed: "HTTP 200", artifactIds: ["art-d"], note: null, at: NOW }];
  const base = { rungs, toolCalls: 1, stoppedBy: "MODEL" as const, vaulted: new Set(["art-d", "art-c"]), inherited: new Set<string>(), machine: { provenance: prov, recordClass: "meetings" } };
  const fin = (candidates: unknown[]) => ({ outcome: "ROUTE_CANDIDATE", rungsWalked: [{ index: 0, note: "n" }], candidates: candidates as never, findings: [], nextRungs: [], unverified: [], narrative: "n" });

  const disallowed = validateScoutFinish({ ...base, finish: fin([candidateWith({ evidenceArtifactIds: ["art-d"], permission: "DISALLOWED" })]) });
  assert.deepEqual(disallowed, [], "a public page read over a robots.txt disallow substantiates its route");
  const cannotTell = validateScoutFinish({ ...base, finish: fin([candidateWith({ url: "https://c.gov/agendas", evidenceArtifactIds: ["art-c"], permission: "CANNOT_TELL" })]) });
  assert.deepEqual(cannotTell, [], "an unread robots.txt does not disqualify a route either");
  /* The verdict is still the machine's record: a claim that hides the disallow is refused as a disagreement, not for robots. */
  const hidden = validateScoutFinish({ ...base, finish: fin([candidateWith({ evidenceArtifactIds: ["art-d"], permission: "ALLOWED" })]) });
  assert.ok(hidden.some((i) => i.code === "SCOUT_PROVENANCE_DISAGREES" && /retrieved under DISALLOWED/.test(i.detail)), JSON.stringify(hidden));
  assert.ok(!hidden.some((i) => i.code === "SCOUT_PROVENANCE_UNDERIVABLE"), "a DISALLOWED retrieval is never itself a refusal");
});

/* ================================================================== *
 * RULING 244 — the Worker Efficiency Law's five seeded failures
 * ================================================================== */

test("13. SEEDED (v): a route the decision rule sent DETERMINISTIC reaching the model executor makes NO request and aborts by name; decideExecutor names the graduation", async () => {
  const transport = scriptedTransport([[finish("f", "NO_PROGRESS")]]);
  const { exec, results } = executorWith(transport, fakeToolkit(), { decision: "DETERMINISTIC" });
  const { result, repos, task } = await dispatchScout(exec);
  assert.equal(transport.requests.length, 0, "a graduated route never spends a model");
  assert.equal(result.outcome, "FAILED");
  assert.match(result.detail, /SCOUT_GRADUATED_ROUTE/);
  assert.equal(results[0].refusal?.[0].code, "SCOUT_GRADUATED_ROUTE");
  const attempt = (await attemptsForRouteTask(repos, task.id)).at(-1)!.value;
  assert.equal(attempt.outcome, "ABORTED");
  assert.equal(attempt.cost.usd, 0, "nothing was served and nothing billed: a measured zero");

  const graduated = decideExecutor({ routeId: "learned", descriptor: { executorClass: "BOUNDED_MODEL_WORKER", open: { kind: "HTTP_GET" } }, maturity: () => "GRADUATED" });
  assert.equal(graduated.kind, "DETERMINISTIC");
  assert.match(graduated.disagreement ?? "", /GRADUATED_SINCE_DECLARED/);
  const noDescriptor = decideExecutor({ routeId: "learned", descriptor: null, maturity: () => "GRADUATED" });
  assert.equal(noDescriptor.kind, "DETERMINISTIC");
});

test("14. SEEDED (i): a repeated-prefix turn with zero cache-read tokens is recorded as a cacheDefect; the request carries the static markers and the top-level moving breakpoint", async () => {
  const toolkit = fakeToolkit();
  const turns = [
    [toolUse("u1", "read_permission", { url: "https://a.gov/", rung: "primary-site-navigation", why: "p" })],
    [toolUse("u2", "fetch_public", { url: "https://a.gov/meetings", rung: "primary-site-navigation", why: "n" })],
    [finish("f", "ROUTE_CANDIDATE", { rungsWalked: [{ index: 0, note: "a" }, { index: 1, note: "b" }], candidates: [candidateWith({ evidenceArtifactIds: ["art-2"] })] })],
  ];
  let i = 0;
  const requests: ModelRequest[] = [];
  /* A growing loop whose turn 2 finds nothing in the cache and re-writes the prefix plus what it appended; the uncached tail stays tiny. */
  const coldOnTurnTwo: ModelTransport = async (request) => {
    requests.push(request);
    const content = turns[i] ?? [{ type: "text" as const, text: "script complete" }];
    i += 1;
    const usage = [
      { input_tokens: 2, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 4000 },
      { input_tokens: 2, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 5000 },
      { input_tokens: 2, output_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 1000 },
    ][i - 1];
    return { model: "claude-opus-5-5", stop_reason: "tool_use", content, usage };
  };
  const { exec, results } = executorWith(coldOnTurnTwo, toolkit);
  const { result } = await dispatchScout(exec);
  assert.equal(result.outcome, "WORKED", result.detail);
  assert.deepEqual(results[0].cacheDefect?.turns, [2], "turn 2 re-sent an identical prefix and read nothing from the cache");
  assert.deepEqual(results[0].cacheDefect?.zeroReadTurns, [2]);
  assert.deepEqual(results[0].cacheDefect?.stationaryTurns, [], "a zero read whose uncached input did not grow past what it appended is not the stationary signature");
  assert.match(results[0].cacheDefect?.detail ?? "", /RULING 244/);
  assert.match(result.detail, /CACHE DEFECT on turn\(s\) 2/);

  /* POSITIVE CONTROL: a healthy loop — reads grow, writes are the appended turn, the uncached tail is two tokens — records no defect. */
  let w = 0;
  const warm: ModelTransport = async () => {
    const content = turns[Math.min(w, turns.length - 1)];
    w += 1;
    return { model: "claude-opus-5-5", stop_reason: "tool_use", content, usage: { input_tokens: 2, output_tokens: 100, cache_read_input_tokens: w === 1 ? 0 : 4000 + 1500 * (w - 2), cache_creation_input_tokens: w === 1 ? 4000 : 1500 } };
  };
  const { exec: exec2, results: results2 } = executorWith(warm, fakeToolkit());
  await dispatchScout(exec2);
  assert.equal(results2[0].cacheDefect, null);

  /*
   * THE STATIONARY SIGNATURE (2026-09-06): reads flat at the static prefix,
   * uncached input growing by the whole conversation every turn — the shape
   * every 2026-09-02 Attempt showed while the old detector reported clean.
   */
  let k = 0;
  const stationary: ModelTransport = async () => {
    const content = turns[Math.min(k, turns.length - 1)];
    k += 1;
    return { model: "claude-opus-5-5", stop_reason: "tool_use", content, usage: { input_tokens: [6000, 14000, 25000][k - 1], output_tokens: 300, cache_read_input_tokens: k === 1 ? 0 : 4082, cache_creation_input_tokens: k === 1 ? 4082 : 0 } };
  };
  const { exec: exec3, results: results3 } = executorWith(stationary, fakeToolkit());
  await dispatchScout(exec3);
  assert.deepEqual(results3[0].cacheDefect?.stationaryTurns, [2, 3], "turns 2 and 3 paid for the whole conversation uncached");
  assert.deepEqual(results3[0].cacheDefect?.zeroReadTurns, [], "the static prefix was read every turn, which is exactly what hid the defect from the old detector");
  assert.match(results3[0].cacheDefect?.detail ?? "", /STATIONARY-BREAKPOINT/);

  /* The request shape: tools-last, system, NO message-level marker, and the top-level moving breakpoint. */
  const third = requests[2];
  assert.deepEqual(third.tools.at(-1)?.cache_control, { type: "ephemeral" }, "the last tool definition is a breakpoint");
  assert.equal(third.tools[0].cache_control, undefined, "only the last tool carries the marker");
  assert.deepEqual(third.system[0].cache_control, { type: "ephemeral" });
  const markers = third.messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as { cache_control?: unknown }[]).filter((b) => b.cache_control !== undefined) : []));
  assert.equal(markers.length, 0, "no message-level marker: the API places and moves the breakpoint from the top-level field");
  assert.deepEqual(third.cache_control, { type: "ephemeral" }, "the top-level moving breakpoint is on every turn's request");
  assert.deepEqual(requests[0].cache_control, { type: "ephemeral" });
  assert.equal(cacheTtlOrderProblems(third).length, 0, "the request's markers are in the order the API requires");
  assert.equal(third.output_config?.effort, undefined, "effort is the SCOUT role's, recorded per request");
  assert.equal(results[0].effort, null);

  /* The LAST_BLOCK fallback (a platform that rejects the top-level field) marks only the newest user turn's last block. */
  const fallback = withCacheBreakpoints(third.messages, "LAST_BLOCK");
  const fallbackMarkers = fallback.flatMap((m, idx) => (Array.isArray(m.content) ? (m.content as { cache_control?: unknown }[]).map((b, j) => (b.cache_control ? `${idx}.${j}` : null)).filter((x) => x !== null) : []));
  const lastUser = fallback.reduce((at, m, idx) => (m.role === "user" ? idx : at), -1);
  const lastLen = (fallback[lastUser].content as unknown[]).length;
  assert.deepEqual(fallbackMarkers, [`${lastUser}.${lastLen - 1}`], "exactly one message marker, on the last block of the newest user turn");

  /* The per-turn steps carry the cache-write split and the pricing basis (2026-09-06). */
  const step = (results[0].steps ?? []).find((s) => s.kind === "MODEL" && s.turn === 2);
  assert.deepEqual(step?.cacheWriteSplit, { ephemeral5m: null, ephemeral1h: null }, "a response with no cache_creation split records null, never zero");
  assert.equal(step?.cacheWritePricedFrom, "AGGREGATE", "the aggregate write was priced at the requested TTL because the response carried no split");
  assert.equal(results[0].usage.cacheCreation5mInputTokens, null);
});

test("15. SEEDED (ii): a deterministic-capable step routed to a model is REFUSED by the step registry; model steps route to the cheapest class and escalate on record", () => {
  assert.throws(() => assertStepMayInvokeModel("page-to-representation"), DeterministicStepInvokedModel);
  assert.throws(() => assertStepMayInvokeModel("permission-reading"), DeterministicStepInvokedModel);
  assert.throws(() => assertStepMayInvokeModel("date-parsing"), DeterministicStepInvokedModel);
  assert.throws(() => assertStepMayInvokeModel("made-up-step"), UnknownStepInvokedModel);
  const loop = assertStepMayInvokeModel("scout-research-loop");
  assert.deepEqual(loop, { model: "claude-haiku-4-5", modelClass: "haiku", effort: "medium", role: "SCOUT" }, "the loop starts on Haiku");
  assert.equal(assertStepMayInvokeModel("scout-research-loop", true).modelClass, "sonnet", "and escalates to Sonnet");
  const extraction = assertStepMayInvokeModel("extraction");
  assert.deepEqual(extraction, { model: "claude-haiku-4-5", modelClass: "haiku", effort: "low", role: "SUB_STEP" });
  const escalated = assertStepMayInvokeModel("extraction", true);
  assert.equal(escalated.modelClass, "sonnet", "a cheaper model that fails the standard escalates one class");
  assert.equal(assertStepMayInvokeModel("summarization", true).modelClass, "frontier");
});

test("16. SEEDED (iii): a representation past its step budget is truncated with a stated notice naming the artifact, and the overrun is recorded", async () => {
  const big = "x".repeat(REPRESENTATION_BUDGETS.fetch_public + 5_000);
  const fit = fitRepresentation("fetch_public", big, ["art-9"]);
  assert.equal(fit.truncated, true);
  assert.ok(Buffer.byteLength(fit.text, "utf8") <= fit.budget, "the truncated text fits the budget");
  assert.match(fit.text, /REPRESENTATION TRUNCATED: \d+ bytes exceeds the fetch_public budget/);
  assert.match(fit.text, /art-9/);
  assert.equal(fitRepresentation("fetch_public", "small", ["a"]).truncated, false, "POSITIVE CONTROL: within budget nothing is touched");
  assert.equal(fitRepresentation("unknown-tool", "x".repeat(20_000), []).truncated, true, "an unnamed tool gets the smallest budget, never an unbounded one");

  const toolkit = fakeToolkit();
  const original = toolkit.call.bind(toolkit);
  toolkit.call = async (name, input, rung) => {
    const r = await original(name, input, rung);
    return { ...r, forModel: big };
  };
  const transport = scriptedTransport([
    [toolUse("u1", "fetch_public", { url: "https://a.gov/huge", rung: "primary-site-navigation", why: "w" })],
    [finish("f", "ROUTE_CANDIDATE", { rungsWalked: [{ index: 0, note: "n" }], candidates: [candidateWith({ url: "https://a.gov/huge" })] })],
  ]);
  const { exec, results } = executorWith(transport, toolkit);
  await dispatchScout(exec);
  assert.equal(results[0].representationOverruns?.length, 1);
  assert.equal(results[0].representationOverruns?.[0].tool, "fetch_public");
  assert.ok((results[0].representationOverruns?.[0].bytes ?? 0) > REPRESENTATION_BUDGETS.fetch_public);
  const shown = JSON.stringify(transport.requests[1].messages.at(-1)?.content);
  assert.match(shown, /REPRESENTATION TRUNCATED/);
  assert.match(shown, /art-1/);
});

test("17. SEEDED (iv): a rung a prior Attempt recorded as durably FAILED is not re-walked — refused with the prior observation quoted; a transient failure and a different client are not refused", async () => {
  const toolkit = fakeToolkit();
  const inherited: InheritedEvidence = {
    artifactIds: [],
    summary: "prior",
    priorRungs: [
      { rung: "primary-site-navigation", tool: "fetch_public", target: "https://a.gov/walled", observed: "HTTP 403 (wall)", ok: false, at: "2026-08-31T12:00:00.000Z", attemptId: "at-prior" },
      { rung: "site-search-or-sitemap", tool: "fetch_public", target: "https://a.gov/flaky", observed: "transport failure: fetch failed", ok: false, at: "2026-08-31T12:00:00.000Z", attemptId: "at-prior" },
    ],
    nextRungs: ["open-data-portal"],
  };
  const transport = scriptedTransport([
    [toolUse("u1", "fetch_public", { url: "https://a.gov/walled", rung: "primary-site-navigation", why: "again" })],
    [toolUse("u2", "fetch_public", { url: "https://a.gov/flaky", rung: "site-search-or-sitemap", why: "retry a transient" })],
    [toolUse("u3", "browse", { url: "https://a.gov/walled", rung: "in-browser-network-observation", why: "vary the client" })],
    [finish("f", "ROUTE_CANDIDATE", { rungsWalked: [{ index: 0, note: "a" }, { index: 1, note: "b" }], candidates: [candidateWith({ url: "https://a.gov/flaky", evidenceArtifactIds: ["art-1"] })] })],
  ]);
  const { exec, results } = executorWith(transport, toolkit, { inherited });
  const { result } = await dispatchScout(exec);
  assert.equal(result.outcome, "WORKED", result.detail);
  assert.deepEqual(toolkit.calls, ["fetch_public", "browse"], "the durable re-walk never reached the toolkit; the transient retry and the other client did");
  const refusal = JSON.stringify(transport.requests[1].messages.at(-1)?.content);
  assert.match(refusal, /RE-WALK REFUSED/);
  assert.match(refusal, /HTTP 403 \(wall\)/);
  assert.match(refusal, /at-prior/);
  assert.equal(results[0].guardRefusals?.length, 1);
  assert.equal(results[0].guardRefusals?.[0].kind, "RE_WALK");
  assert.equal(results[0].resumedFromRungs, 2);
  const brief = (transport.requests[0].messages[0].content as { text: string }[])[0].text;
  assert.match(brief, /^RUNGS ALREADY WALKED/, "a resumed Attempt lists the recorded rungs FIRST");
  assert.match(brief, /FAILED, durable/);
  assert.match(brief, /NEXT RUNGS THE PRIOR INVESTIGATION NAMED[\s\S]*open-data-portal/);
  assert.match(brief, /Continue the ladder/);
});

test("17b. a rung a prior Attempt refused for robots.txt alone (before 2026-09-25) is re-walkable: never durable, labelled walkable in the brief, and it reaches the toolkit; an access-control wall stays durable", async () => {
  assert.equal(classifyPriorRung({ observed: "permission DISALLOWED (Disallow: /w/); no request sent", ok: false }), "ROBOTS_ONLY");
  assert.equal(classifyPriorRung({ observed: "permission CANNOT_TELL; no request sent", ok: false }), "ROBOTS_ONLY");
  assert.equal(classifyPriorRung({ observed: "permission DISALLOWED; no request sent" }), "ROBOTS_ONLY", "a legacy rung with no `ok` is classified from its line");
  assert.equal(classifyPriorRung({ observed: "robots.txt HTTP 403; permission CANNOT_TELL", tool: "read_permission" }), "NOT_A_FAILURE", "the robots read is a record, never a failure");
  assert.equal(classifyPriorRung({ observed: "HTTP 403 (wall)", ok: false }), "DURABLE", "POSITIVE CONTROL: an access control stays durable");
  assert.equal(classifyPriorRung({ observed: "HTTP 200 (CHALLENGE)", ok: false }), "DURABLE", "a bot challenge is an access control");
  assert.equal(classifyPriorRung({ observed: "browser HTTP 429 (RATE_LIMIT)", ok: false }), "DURABLE");

  const toolkit = fakeToolkit();
  const inherited: InheritedEvidence = {
    artifactIds: [],
    summary: "prior",
    priorRungs: [
      { rung: "primary-site-navigation", tool: "fetch_public", target: "https://a.gov/w/meetings", observed: "permission DISALLOWED (Disallow: /w/); no request sent", ok: false, at: "2026-08-31T12:00:00.000Z", attemptId: "at-prior" },
      { rung: "site-search-or-sitemap", tool: "fetch_public", target: "https://a.gov/walled", observed: "HTTP 403 (wall)", ok: false, at: "2026-08-31T12:00:00.000Z", attemptId: "at-prior" },
    ],
    nextRungs: ["open-data-portal"],
  };
  const transport = scriptedTransport([
    [toolUse("u1", "fetch_public", { url: "https://a.gov/w/meetings", rung: "primary-site-navigation", why: "robots.txt no longer refuses a public page" })],
    [toolUse("u2", "fetch_public", { url: "https://a.gov/walled", rung: "site-search-or-sitemap", why: "again" })],
    [finish("f", "ROUTE_CANDIDATE", { rungsWalked: [{ index: 0, note: "a" }], candidates: [candidateWith({ url: "https://a.gov/w/meetings", evidenceArtifactIds: ["art-1"] })] })],
  ]);
  const { exec, results } = executorWith(transport, toolkit, { inherited });
  const { result } = await dispatchScout(exec);
  assert.equal(result.outcome, "WORKED", result.detail);
  assert.deepEqual(toolkit.calls, ["fetch_public"], "the robots-only rung was walked; the access-control wall was not");
  assert.deepEqual(results[0].guardRefusals?.map((g) => [g.kind, g.target]), [["RE_WALK", "https://a.gov/walled"]]);
  const brief = (transport.requests[0].messages[0].content as { text: string }[])[0].text;
  assert.match(brief, /a\.gov\/w\/meetings[^\n]*refused for robots\.txt alone before 2026-09-25; not a wall, walk it/);
  assert.match(brief, /a\.gov\/walled[^\n]*FAILED, durable/);
  const system = JSON.stringify(transport.requests[0].system);
  assert.match(system, /robots\.txt is different: the tools read and record it automatically, and it never refuses a public page \(an owner decision\)/);
  assert.match(system, /Never bypass an access control/);
  assert.doesNotMatch(system, /The tools refuse disallowed and cannot-tell hosts/);
});

test("17c. a BLOCKED Scout means an access control: its disposition's permission is the recorded robots verdict, never read off a DISALLOWED line", () => {
  const rungs = [
    { index: 0, rung: "primary-site-navigation", tool: "fetch_public", target: "https://a.gov/x", observed: "HTTP 403 (wall)", artifactIds: ["art-1"], note: null, at: NOW, ok: false, permission: "ALLOWED" as const },
    { index: 1, rung: "other:legacy", tool: "fetch_public", target: "https://a.gov/w/y", observed: "permission DISALLOWED (Disallow: /w/); no request sent", artifactIds: [], note: null, at: NOW, ok: false },
  ];
  const base = { candidates: [], findings: [], rungs, narrative: "n", methodCandidateIds: [] };
  const blocked = dispositionForScout({ ...base, outcome: "BLOCKED" });
  assert.equal(blocked?.disposition, "BLOCKED_CURRENTLY");
  assert.equal(blocked?.transport, "CHALLENGED");
  assert.equal(blocked?.permission, "ALLOWED", "the walled rung ran under ALLOWED; a legacy DISALLOWED line no longer decides the record");
  assert.match(blocked?.note ?? "", /ACCESS CONTROL/);
  assert.doesNotMatch(blocked?.note ?? "", /DISALLOW/);
  /* Evidence read over a disallow records DISALLOWED, never a blanket ALLOWED. */
  const evidence = dispositionForScout({
    ...base,
    rungs: [{ ...rungs[0], observed: "HTTP 200, 10 bytes", ok: true, permission: "DISALLOWED" as const }],
    outcome: "EVIDENCE_FOUND",
    findings: [{ summary: "the agenda", artifactIds: ["art-1"], kind: "RECORD" }],
  });
  assert.equal(evidence?.permission, "DISALLOWED");
});

test("18. no re-read: a second fetch of a URL this Attempt vaulted is refused and hands back the artifact id; a different representation is not refused", async () => {
  const toolkit = fakeToolkit();
  const transport = scriptedTransport([
    [toolUse("u1", "fetch_public", { url: "https://a.gov/meetings", rung: "primary-site-navigation", why: "w" })],
    [toolUse("u2", "fetch_public", { url: "https://a.gov/meetings#top", rung: "primary-site-navigation", why: "again" })],
    [toolUse("u3", "browse", { url: "https://a.gov/meetings", rung: "in-browser-network-observation", why: "the page's own API" })],
    [finish("f", "ROUTE_CANDIDATE", { rungsWalked: [{ index: 0, note: "a" }, { index: 1, note: "b" }], candidates: [candidateWith()] })],
  ]);
  const { exec, results } = executorWith(transport, toolkit);
  const { result } = await dispatchScout(exec);
  assert.equal(result.outcome, "WORKED", result.detail);
  assert.deepEqual(toolkit.calls, ["fetch_public", "browse"]);
  const refusal = JSON.stringify(transport.requests[2].messages.at(-1)?.content);
  assert.match(refusal, /RE-READ REFUSED/);
  assert.match(refusal, /ARTIFACT art-1/);
  assert.deepEqual(results[0].guardRefusals?.map((g) => g.kind), ["RE_READ"]);
});

test("19. every turn is a recorded step: model, effort, tokens by category and cost; the deterministic steps ran no model; the cost is the steps' sum", async () => {
  const toolkit = fakeToolkit();
  const transport = scriptedTransport([
    [toolUse("u1", "read_permission", { url: "https://a.gov/", rung: "primary-site-navigation", why: "p" })],
    [toolUse("u2", "fetch_public", { url: "https://a.gov/meetings", rung: "primary-site-navigation", why: "n" })],
    [finish("f", "ROUTE_CANDIDATE", { rungsWalked: [{ index: 0, note: "a" }, { index: 1, note: "b" }], candidates: [candidateWith({ evidenceArtifactIds: ["art-2"] })] })],
  ]);
  const { exec, results } = executorWith(transport, toolkit);
  await dispatchScout(exec);
  const r = results[0];
  const model = (r.steps ?? []).filter((s) => s.kind === "MODEL");
  assert.equal(model.length, 3);
  for (const [i, s] of model.entries()) {
    assert.equal(s.turn, i + 1);
    assert.equal(s.model, "claude-haiku-4-5", "MW-033: the loop's turns run on Sonnet 5 unless it escalates");
    assert.equal(s.effort, null);
    assert.deepEqual(s.tokens, { cacheRead: 500, cacheWrite: 0, uncachedInput: 1000, output: 100 });
    assert.ok((s.usd ?? 0) > 0);
  }
  const sum = model.reduce((n, s) => n + (s.usd ?? 0), 0);
  assert.ok(Math.abs(sum - (r.usd ?? 0)) < 1e-9, "the Attempt's cost is the sum of its steps");
  const det = Object.fromEntries((r.steps ?? []).filter((s) => s.kind === "DETERMINISTIC").map((s) => [s.step, s]));
  assert.equal(det["page-to-representation"].count, 1);
  assert.equal(det["permission-reading"].count, 1);
  assert.equal(det["date-parsing"].count, 1);
  for (const s of Object.values(det)) {
    assert.equal(s.model, null);
    assert.equal(s.usd, 0);
    assert.deepEqual(s.tokens, { cacheRead: 0, cacheWrite: 0, uncachedInput: 0, output: 0 });
  }
  assert.ok(model[1].representationBytes > 0, "the bytes the tools handed the model are counted on the turn that read them");
});
