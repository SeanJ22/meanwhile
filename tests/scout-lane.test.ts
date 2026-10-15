import { playbookRows } from "./helpers/playbooks.ts";
import { fixtureRolePlaybook } from "./helpers/playbooks.ts";
/** The hunter's model lane: capacity, spend holds and cost rows, transport failures, caching and step accounting. */
import assert from "node:assert/strict";
import test from "node:test";

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
import { routeProcessExecutor } from "../lib/control-plane/workers/route-process.ts";
import {
  cacheTtlOrderProblems,
  withCacheBreakpoints,
  hunterExecutor,
  ModelRequestNotSent,
  ModelTransportError,
  dispositionForHunt,
  type ModelRequest,
  type ModelResponse,
  type ModelTransport,
} from "../lib/control-plane/scheduler/scout-executor.ts";
import type { ReportedFinding, ScoutToolkit } from "../lib/control-plane/scheduler/scout-contract.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
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

test("a graduated route runs in an ordinary worker process and records its Attempt", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, dirname, resolve } = await import("node:path");
  const { createFileRepositories } = await import("../lib/control-plane/repository/file-store.ts");
  const root = await mkdtemp(join(tmpdir(), "s7-ordinary-route-"));
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  try {
    const repos = await createFileRepositories(root);
      for (const row of playbookRows) await repos.fieldManual.put(row.id, row, NOW);
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
      });
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
});

/** A toolkit whose fetch_public and browse vault one artifact per call, and whose report_finding records the fact. */
function fakeToolkit(): ScoutToolkit & { calls: string[] } {
  const vaulted = new Set<string>();
  const calls: string[] = [];
  const reported: ReportedFinding[] = [];
  let toolCalls = 0;
  const spec = (name: string) => ({ name, description: "fake", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } });
  return {
    calls,
    specs: [spec("fetch_public"), spec("browse")],
    get vaultedArtifactIds() {
      return vaulted;
    },
    get toolCalls() {
      return toolCalls;
    },
    reported,
    requestCount: 0,
    bytesFetched: 0,
    async call(name, input) {
      toolCalls += 1;
      calls.push(name);
      if (name === "report_finding") {
        const o = input as { subjectId: string; field: string; value: string; sourceUrl: string; sentence: string };
        reported.push({ subjectId: o.subjectId, field: o.field, value: o.value, exactQuote: o.sentence, sourceUrl: o.sourceUrl,
          artifactIds: [`art-${toolCalls - 1}`], subjectHint: null, index: reported.length });
        return { ok: true, forModel: "IN THE BOX", artifacts: [], provenance: [], step: null, requestCount: 0, bytesFetched: 0 };
      }
      const url = String((input as { url?: string }).url ?? "");
      const id = `art-${toolCalls}`;
      vaulted.add(id);
      return {
        ok: true,
        forModel: `[artifact ${id}] fetched ${url}`,
        artifacts: [{ artifactId: id, tier: "RAW", contentHash: `sha256-${id}`, byteLength: 10, contentType: "text/html", canonicalUrl: url, partial: false, recordedAt: NOW }],
        provenance: [{ artifactId: id, canonicalUrl: url, retrievedAt: NOW, permission: "ALLOWED", methodRouteId: `scout:${name}`, httpStatus: 200 }],
        step: { tool: name, target: url, observed: "HTTP 200, 10 bytes", artifactIds: [id], ok: true },
        requestCount: 1,
        bytesFetched: 10,
      };
    },
  };
}

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
    proofPath: ".runtime/ops/runner-relaunch-proof.json",
    ...over,
  };
}

function scriptedTransport(turns: readonly ModelResponse["content"][]): ModelTransport & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let i = 0;
  const t = (async (request: ModelRequest) => {
    requests.push(request);
    const content = turns[i] ?? [{ type: "text" as const, text: "script complete" }];
    i += 1;
    return {
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
const fetchOf = (id: string, url: string) => toolUse(id, "fetch_public", { url });
const finish = (id: string, extra: Record<string, unknown> = {}) => toolUse(id, "finish", { summary: "test", unfilled: [], ...extra });

function executorWith(
  transport: ModelTransport,
  toolkit: ScoutToolkit,
  opts: {
    onResult?: (r: ScoutResult) => Promise<ScoutResult | void>;
    refusedBeforeSending?: (error: unknown) => boolean;
  } = {},
) {
  const results: ScoutResult[] = [];
  const exec = hunterExecutor({ role: "HUNTER", playbookFor: fixtureRolePlaybook,
    transport,
    refusedBeforeSending: opts.refusedBeforeSending,
    toolkitFor: () => toolkit,
    contextFor: async () => ({ brief: "Place: test", reason: "test hunt", blanks: 1, handed: { artifactIds: [] },
      tools: { vault: async () => ({ stored: true, where: "x", why: "written" }), spaceOut: async () => undefined } }),
    now: () => NOW,
    bound: RESEARCH_BOUNDS.perDispatch,
    onResult: async (r) => {
      results.push(r);
      if (opts.onResult) return opts.onResult(r);
    },
  });
  return { exec, results };
}

async function dispatchHunt(exec: DeclaredExecutor) {
  const { repos, task } = await registered();
  const result = await dispatchOne(repos, { obligation: scheduledFixture(OBLIGATION, NOW_MS), routeTaskId: task.id, holder: "t", now: NOW, leaseTtlMs: 60_000, maturity: () => "UNGRADUATED", executor: exec });
  return { repos, task, result };
}

test("the runner's exact hunt hold reaches disposed and aborted cost rows without changing unknown dollars", async () => {
  for (const mode of ["disposed", "aborted", "unmetered", "no-hold"] as const) {
    const { repos, task } = await registered();
    const holds = new DurableSpendHolds({ budget: repos.budget, table: repos.spendHolds, now: () => NOW });
    const job = new JobSpend(holds, `actual-hunt-job:${mode}`, OBLIGATION.id, { sends: [], areas: [{
      key: "area:existing", label: "existing budget", budgetUsd: 20, historicalUsd: 0, historyReadAt: NOW,
    }] });
    if (mode !== "no-hold") assert.equal((await job.admit(2, "hunt maximum")).admit, true);
    const scripted = scriptedTransport([
      [fetchOf("fetch", "https://a.gov/meetings")],
      [finish("finish", { spendHoldJobId: "model-invented-job" })],
    ]);
    const transport: ModelTransport = mode === "unmetered"
      ? async () => { throw new Error("HTTP 529: response lost"); }
      : mode === "aborted" ? async () => { throw new ModelTransportError("HTTP 400: fixture rejected request", 400); } : scripted;
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
      assert.equal(aggregateModelSpend(costs, NOW, NOW, Object.values(heldRows(repos))).usd, costs[0].modelRequestBound?.usd,
        "the lost request counts at its send limit, tighter than the job's hold");
    }
  }
});

test("context assembly failure records a durable zero before any toolkit or provider request", async () => {
  const { repos, task } = await registered();
  let toolkitCalls = 0, providerCalls = 0, startCalls = 0;
  const exec = hunterExecutor({ role: "HUNTER", playbookFor: fixtureRolePlaybook,
    now: () => NOW,
    contextFor: async () => { throw new TypeError("packet read failed"); },
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
  assert.match(result.detail, /HUNT_CONTEXT_FAILED_BEFORE_REQUEST/);
  const costs = (await repos.costs.readAll()).filter(row => row.attemptId === attempt.id);
  assert.equal(costs.length, 1);
  assert.equal(costs[0].cost.usd, 0);
  assert.equal(costs[0].cost.requestCount, 0);
});

test("a later toolkit construction failure remains unpriced and cannot release an unknown hold", async () => {
  const { repos, task } = await registered();
  const exec = hunterExecutor({ role: "HUNTER", playbookFor: fixtureRolePlaybook, now: () => NOW,
    contextFor: async () => ({ brief: "Place: test", reason: "test", blanks: 1, handed: { artifactIds: [] },
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

test("1. SEEDED: the decision rule keeps a declared DETERMINISTIC route deterministic and names a graduation", () => {
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
  const noDescriptor = decideExecutor({ routeId: "learned", descriptor: null, maturity: () => "GRADUATED" });
  assert.equal(noDescriptor.kind, "DETERMINISTIC");
});

test("4. SEEDED: a hunt that reports nothing is a walk with no yield, and its cost reaches the ledger", async () => {
  const transport = scriptedTransport([
    [fetchOf("u1", "https://a.gov/")],
    [finish("f")],
  ]);
  const { exec, results } = executorWith(transport, fakeToolkit());
  const { repos, task, result } = await dispatchHunt(exec);
  assert.equal(result.outcome, "WORKED", result.detail);
  assert.equal(result.disposition, "WALKED_NO_YIELD");
  assert.equal(results[0].refusal, null);
  assert.equal(results[0].outcome, "NO_PROGRESS");
  assert.equal(results[0].distinctEvidenceRungs, 1);
  const attempt = (await attemptsForRouteTask(repos, task.id)).at(-1)!.value;
  assert.equal(attempt.outcome, "COMPLETED");
  assert.equal(attempt.worker.role, "SCOUT");
  assert.equal(attempt.worker.provider, "anthropic");
  assert.notEqual(attempt.cost.usd, null, "the Attempt carries its measured cost");
  const ledger = (await repos.costs.readAll()).filter((c) => c.attemptId === attempt.id);
  assert.equal(ledger.length, 1, "the ledger holds the Attempt's cost");
  assert.equal(ledger[0].role, "SCOUT");
});

test("a hunter past its wall clock stops and keeps the steps walked as a NO_PROGRESS case file", async () => {
  const { repos, task } = await registered();
  const scripted = scriptedTransport([
    [fetchOf("u1", "https://a.gov/")],
    [finish("f")],
  ]);
  const slow: ModelTransport & { requests: ModelRequest[] } = Object.assign(
    async (request: ModelRequest) => { await new Promise((resolve) => setTimeout(resolve, 60)); return scripted(request); },
    { requests: scripted.requests },
  );
  const { exec, results } = executorWith(slow, fakeToolkit());
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
  assert.equal(slow.requests.length, 1, "no further model request is sent after the limit");
  assert.match(result.detail, /\(TIMEOUT\)/);
});

test("when the AI service stops answering mid-walk, the steps walked are kept as the case file", async () => {
  const scripted = scriptedTransport([[fetchOf("u1", "https://a.gov/")]]);
  let calls = 0;
  const outage: ModelTransport = async (request: ModelRequest) => {
    calls += 1;
    if (calls === 1) return scripted(request);
    throw new Error('HTTP 529: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
  };
  const { exec, results } = executorWith(outage, fakeToolkit());
  await dispatchHunt(exec);
  const r = results[0];
  assert.equal(r.refusal?.[0].code, "SCOUT_TRANSPORT_FAILED", "the cause is still named");
  assert.equal(r.rungs.length, 1, "the step walked before the outage is kept");
});

test("6. SEEDED: the rolling ceiling permits below the cap only, and counts only Scout spend in its window", () => {
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

test("8. a hunt that reports a fact disposes INGESTED with identity, usage and cost on the Attempt", async () => {
  const toolkit = fakeToolkit();
  const transport = scriptedTransport([
    [fetchOf("u1", "https://a.gov/")],
    [fetchOf("u2", "https://a.gov/meetings")],
    [toolUse("u3", "report_finding", { subjectId: OBLIGATION.subjectId, field: "MTG-01", value: "Every first Monday", sourceUrl: "https://a.gov/meetings", sentence: "The council meets every first Monday." }), finish("f")],
  ]);
  const { exec, results } = executorWith(transport, toolkit);
  const { repos, task, result } = await dispatchHunt(exec);
  assert.equal(result.outcome, "WORKED", result.detail);
  assert.equal(result.disposition, "INGESTED");
  assert.equal(result.executor, "BOUNDED_MODEL_WORKER");
  assert.equal(result.executorMismatch, false);
  assert.equal(result.artifactIds.length, 2);
  const attempt = (await attemptsForRouteTask(repos, task.id)).at(-1)!.value;
  assert.equal(attempt.outcome, "COMPLETED");
  assert.equal(attempt.worker.role, "SCOUT");
  assert.equal(attempt.worker.provider, "anthropic");
  assert.equal(attempt.worker.version, "claude-haiku-5-5", "the loop starts on the cheapest suitable class");
  assert.equal(attempt.cost.inputTokens, 3 * 1500, "input tokens include cache reads, summed over turns");
  assert.equal(attempt.cost.outputTokens, 300);
  assert.ok((attempt.cost.usd ?? 0) > 0);
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
  assert.equal(r.outcome, "EVIDENCE_FOUND");
  assert.deepEqual(r.findings.map(f => [f.field, f.value, f.sourceUrl]), [["MTG-01", "Every first Monday", "https://a.gov/meetings"]]);
  assert.equal(r.worker.modelReported, "claude-haiku-5-5");
  assert.equal(r.modelClass, "haiku");
  assert.equal(r.usage.turns, 3);
  const commit = (await repos.dispositions.readAll()).at(-1)!;
  assert.equal(commit.disposition.disposition, "INGESTED");
  assert.equal(dispositionForHunt({ ...r, findings: [] }).disposition, "WALKED_NO_YIELD");
});

test("9. SEEDED (measured live): an artifact the log refuses does not leave the Attempt open", async () => {
  const vaulted = new Set<string>();
  let calls = 0;
  const colliding: ScoutToolkit = {
    specs: [{ name: "fetch_public", description: "fake", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } }],
    get vaultedArtifactIds() {
      return vaulted;
    },
    get toolCalls() {
      return calls;
    },
    reported: [],
    requestCount: 0,
    bytesFetched: 0,
    async call(name, input) {
      calls += 1;
      const url = String((input as { url?: string }).url ?? "");
      vaulted.add("ar-same-bytes");
      return {
        ok: true,
        forModel: `[artifact ar-same-bytes] ${url}`,
        artifacts: [{ artifactId: "ar-same-bytes", tier: "RAW", contentHash: "sha256-same", byteLength: 10, contentType: "text/plain", canonicalUrl: url, partial: false, recordedAt: NOW }],
        step: { tool: name, target: url, observed: "HTTP 200", artifactIds: ["ar-same-bytes"] },
        requestCount: 1,
        bytesFetched: 10,
      };
    },
  };
  const transport = scriptedTransport([
    [fetchOf("u1", "https://a.gov/robots.txt")],
    [fetchOf("u2", "https://www.a.gov/robots.txt")],
    [finish("f")],
  ]);
  const { exec } = executorWith(transport, colliding);
  const { repos, task, result } = await dispatchHunt(exec);
  assert.equal(result.outcome, "WORKED", result.detail);
  const attempt = (await attemptsForRouteTask(repos, task.id)).at(-1)!.value;
  assert.equal(attempt.outcome, "COMPLETED", "the Attempt closed; a second URL for one content id is not a reason to leave it open");
  assert.equal(result.artifactIds.length, 1, "one content id is attributed once");
  const lease = await repos.leases.read(task.id);
  assert.equal(lease?.value.released, true, "the lease is released");
});

test("10. a lost or server-error response keeps unknown spending reserved, including after metered turns", async () => {
  const overloaded: ModelTransport = async () => {
    throw new Error('HTTP 529: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
  };
  const { exec, results } = executorWith(overloaded, fakeToolkit());
  const { repos, task, result } = await dispatchHunt(exec);
  assert.equal(result.outcome, "FAILED");
  assert.match(result.detail, /SCOUT_TRANSPORT_FAILED/);
  assert.match(result.detail, /529/);
  assert.equal(results[0].refusal?.[0].code, "SCOUT_TRANSPORT_FAILED");
  const attempt = (await attemptsForRouteTask(repos, task.id)).at(-1)!.value;
  assert.equal(attempt.outcome, "ABORTED");
  assert.equal(attempt.cost.usd, null, "a server failure does not prove zero provider spending");
  assert.equal(attempt.cost.inputTokens, null, "no answer came back, so its tokens are unknown like its cost");
  assert.equal(attempt.cost.requestCount, 1, "the lost request was sent");
  const ledger = (await repos.costs.readAll()).filter((c) => c.attemptId === attempt.id);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].cost.usd, null);
  assert.equal(ledger[0].modelRequestBound?.model, ledger[0].requestedModel, "the lost request counts at its own send limit");
  let n = 0;
  const failsSecond: ModelTransport = async () => {
    n += 1;
    if (n === 2) throw new Error("HTTP 529: overloaded");
    return { model: "claude-opus-5-5", stop_reason: "tool_use", content: [fetchOf("u1", "https://a.gov/")], usage: { input_tokens: 100, output_tokens: 10 } };
  };
  const { exec: exec2, results: results2 } = executorWith(failsSecond, fakeToolkit());
  await dispatchHunt(exec2);
  assert.equal(results2[0].usage.turns, 1);
  assert.equal(results2[0].usd, null);
  assert.ok(results2[0].steps?.some(step => step.kind === "MODEL" && (step.usd ?? 0) > 0));
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
    assert.equal(result.cost?.requestCount, 1, `request count for status ${status}`);
  }
});

test("a request the worker never handed to the provider costs nothing and carries no send limit", async () => {
  const { repos, task } = await registered();
  const { exec } = executorWith(async () => { throw new ModelRequestNotSent("LEASE_WORKER_BROKER_DISCONNECTED"); }, fakeToolkit());
  const result = await dispatchOne(repos, { obligation: scheduledFixture(OBLIGATION, NOW_MS), routeTaskId: task.id, holder: "not-sent",
    now: NOW, leaseTtlMs: 60_000, maturity: () => "UNGRADUATED", executor: exec });
  assert.equal(result.cost?.usd, 0);
  assert.equal(result.cost?.requestCount, 0);
  const [row] = (await repos.costs.readAll()).filter(c => c.attemptId === result.attemptId);
  assert.equal(row?.modelRequestBound, undefined);
});

test("proven pre-send refusals settle unused holds without erasing earlier measured turns", async () => {
  for (const mode of ["fleet-before-first", "budget-before-first", "fleet-after-metered", "unpriced-after-response"] as const) {
    const { repos, task } = await registered();
    const holds = new DurableSpendHolds({ budget: repos.budget, table: repos.spendHolds, now: () => NOW, sleep: async () => undefined });
    const line = { key: "area:zcta:2020/85635@2026-09-27T22:17:50.236Z", label: "original", budgetUsd: 50, historicalUsd: 0, historyReadAt: new Date(NOW_MS - 1_000).toISOString() };
    const job = new JobSpend(holds, mode, OBLIGATION.id, { sends: [], areas: [line] });
    assert.equal((await job.admit(2, "Scout")).admit, true);
    const heldFleet = new FleetSafetyController({ now: NOW, charges: [], modelHold: "lane closed", clock: () => NOW_MS });
    const openFleet = new FleetSafetyController({ now: NOW, charges: [], rollingCeilingUsd: 50, clock: () => NOW_MS });
    let sent = 0;
    const provider: ModelTransport = async request => {
      sent++;
      return { model: request.model, stop_reason: "tool_use", content: [fetchOf("u1", "https://a.gov/")],
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
    assert.equal(result.cost?.requestCount, expectedSent, mode);
    if (mode === "unpriced-after-response") assert.equal(result.cost?.usd, null);
    else if (mode === "fleet-after-metered") assert.ok((result.cost?.usd ?? 0) > 0);
    else assert.equal(result.cost?.usd, 0);
    await holds.settle(job.jobId, result.cost?.usd ?? null, NOW);
    const left = (await holds.left([line]))?.[0].leftUsd;
    assert.equal(left, 50 - (result.cost?.usd ?? 2), mode);
  }
});

test("an unknown sent model request cannot settle away its original lifetime reservation", async () => {
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

test("14. SEEDED (i): a repeated-prefix turn with zero cache-read tokens is recorded as a cacheDefect; the request carries the static markers and the top-level moving breakpoint", async () => {
  const turns = [
    [fetchOf("u1", "https://a.gov/")],
    [fetchOf("u2", "https://a.gov/meetings")],
    [finish("f")],
  ];
  let i = 0;
  const requests: ModelRequest[] = [];
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
  const { exec, results } = executorWith(coldOnTurnTwo, fakeToolkit());
  const { result } = await dispatchHunt(exec);
  assert.equal(result.outcome, "WORKED", result.detail);
  assert.deepEqual(results[0].cacheDefect?.turns, [2], "turn 2 re-sent an identical prefix and read nothing from the cache");
  assert.deepEqual(results[0].cacheDefect?.zeroReadTurns, [2]);
  assert.deepEqual(results[0].cacheDefect?.stationaryTurns, [], "a zero read whose uncached input did not grow past what it appended is not the stationary signature");
  assert.match(results[0].cacheDefect?.detail ?? "", /defect in our request assembly/);

  let w = 0;
  const warm: ModelTransport = async () => {
    const content = turns[Math.min(w, turns.length - 1)];
    w += 1;
    return { model: "claude-opus-5-5", stop_reason: "tool_use", content, usage: { input_tokens: 2, output_tokens: 100, cache_read_input_tokens: w === 1 ? 0 : 4000 + 1500 * (w - 2), cache_creation_input_tokens: w === 1 ? 4000 : 1500 } };
  };
  const { exec: exec2, results: results2 } = executorWith(warm, fakeToolkit());
  await dispatchHunt(exec2);
  assert.equal(results2[0].cacheDefect, null);

  let k = 0;
  const stationary: ModelTransport = async () => {
    const content = turns[Math.min(k, turns.length - 1)];
    k += 1;
    return { model: "claude-opus-5-5", stop_reason: "tool_use", content, usage: { input_tokens: [6000, 14000, 25000][k - 1], output_tokens: 300, cache_read_input_tokens: k === 1 ? 0 : 4082, cache_creation_input_tokens: k === 1 ? 4082 : 0 } };
  };
  const { exec: exec3, results: results3 } = executorWith(stationary, fakeToolkit());
  await dispatchHunt(exec3);
  assert.deepEqual(results3[0].cacheDefect?.stationaryTurns, [2, 3], "turns 2 and 3 paid for the whole conversation uncached");
  assert.deepEqual(results3[0].cacheDefect?.zeroReadTurns, [], "the static prefix was read every turn, which is exactly what hid the defect from the old detector");
  assert.match(results3[0].cacheDefect?.detail ?? "", /STATIONARY-BREAKPOINT/);

  const third = requests[2];
  assert.deepEqual(third.tools.at(-1)?.cache_control, { type: "ephemeral", ttl: "1h" }, "the last tool definition is a breakpoint");
  assert.equal(third.tools[0].cache_control, undefined, "only the last tool carries the marker");
  assert.deepEqual(third.system[0].cache_control, { type: "ephemeral", ttl: "1h" });
  const markers = third.messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as { cache_control?: unknown }[]).filter((b) => b.cache_control !== undefined) : []));
  assert.equal(markers.length, 0, "no message-level marker: the API places and moves the breakpoint from the top-level field");
  assert.deepEqual(third.cache_control, { type: "ephemeral" }, "the top-level moving breakpoint is on every turn's request");
  assert.deepEqual(requests[0].cache_control, { type: "ephemeral" });
  assert.equal(cacheTtlOrderProblems(third).length, 0, "the request's markers are in the order the API requires");
  assert.equal(third.output_config?.effort, "medium", "effort is the role's, recorded per request");
  assert.equal(results[0].effort, "medium");

  const fallback = withCacheBreakpoints(third.messages, "LAST_BLOCK");
  const fallbackMarkers = fallback.flatMap((m, idx) => (Array.isArray(m.content) ? (m.content as { cache_control?: unknown }[]).map((b, j) => (b.cache_control ? `${idx}.${j}` : null)).filter((x) => x !== null) : []));
  const lastUser = fallback.reduce((at, m, idx) => (m.role === "user" ? idx : at), -1);
  const lastLen = (fallback[lastUser].content as unknown[]).length;
  assert.deepEqual(fallbackMarkers, [`${lastUser}.${lastLen - 1}`], "exactly one message marker, on the last block of the newest user turn");

  const step = (results[0].steps ?? []).find((s) => s.kind === "MODEL" && s.turn === 2);
  assert.deepEqual(step?.cacheWriteSplit, { ephemeral5m: null, ephemeral1h: null }, "a response with no cache_creation split records null, never zero");
  assert.equal(step?.cacheWritePricedFrom, "AGGREGATE", "the aggregate write was priced at the requested TTL because the response carried no split");
  assert.equal(results[0].usage.cacheCreation5mInputTokens, null);
});

test("15. SEEDED (ii): a deterministic-capable step routed to a model is REFUSED by the step registry; model steps route to the cheapest class, and sub-steps escalate on record", () => {
  assert.throws(() => assertStepMayInvokeModel("page-to-representation"), DeterministicStepInvokedModel);
  assert.throws(() => assertStepMayInvokeModel("permission-reading"), DeterministicStepInvokedModel);
  assert.throws(() => assertStepMayInvokeModel("made-up-step"), UnknownStepInvokedModel);
  const loop = assertStepMayInvokeModel("scout-research-loop");
  assert.deepEqual(loop, { model: "claude-haiku-5-5", modelClass: "haiku", effort: "medium", role: "SCOUT" }, "the loop starts on Haiku");
  assert.equal(assertStepMayInvokeModel("scout-research-loop", true).modelClass, "haiku", "a hunter is never moved to a dearer model");
  const extraction = assertStepMayInvokeModel("extraction");
  assert.deepEqual(extraction, { model: "claude-haiku-5-5", modelClass: "haiku", effort: "low", role: "SUB_STEP" });
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
  toolkit.call = async (name, input) => {
    const r = await original(name, input);
    return { ...r, forModel: big };
  };
  const transport = scriptedTransport([
    [fetchOf("u1", "https://a.gov/huge")],
    [finish("f")],
  ]);
  const { exec, results } = executorWith(transport, toolkit);
  await dispatchHunt(exec);
  assert.equal(results[0].representationOverruns?.length, 1);
  assert.equal(results[0].representationOverruns?.[0].tool, "fetch_public");
  assert.ok((results[0].representationOverruns?.[0].bytes ?? 0) > REPRESENTATION_BUDGETS.fetch_public);
  const shown = JSON.stringify(transport.requests[1].messages.at(-1)?.content);
  assert.match(shown, /REPRESENTATION TRUNCATED/);
  assert.match(shown, /art-1/);
});

test("19. every turn is a recorded step: model, effort, tokens by category and cost; the cost is the steps' sum", async () => {
  const transport = scriptedTransport([
    [fetchOf("u1", "https://a.gov/")],
    [fetchOf("u2", "https://a.gov/meetings")],
    [finish("f")],
  ]);
  const { exec, results } = executorWith(transport, fakeToolkit());
  await dispatchHunt(exec);
  const r = results[0];
  const model = (r.steps ?? []).filter((s) => s.kind === "MODEL");
  assert.equal(model.length, 3);
  for (const [i, s] of model.entries()) {
    assert.equal(s.turn, i + 1);
    assert.equal(s.model, "claude-haiku-5-5", "the loop's turns run on the cheapest tier");
    assert.equal(s.effort, "medium");
    assert.deepEqual(s.tokens, { cacheRead: 500, cacheWrite: 0, uncachedInput: 1000, output: 100 });
    assert.ok((s.usd ?? 0) > 0);
  }
  const sum = model.reduce((n, s) => n + (s.usd ?? 0), 0);
  assert.ok(Math.abs(sum - (r.usd ?? 0)) < 1e-9, "the Attempt's cost is the sum of its steps");
  assert.ok(model[1].representationBytes > 0, "the bytes the tools handed the model are counted on the turn that read them");
});
