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

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  attemptsForRouteTask,
  registerRouteTask,
  registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { decideExecutor, dispatchOne, type DeclaredExecutor } from "../lib/control-plane/scheduler/dispatch.ts";
import { scheduleObligation, isScheduled, type FreshnessObligation, type ScheduledObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";
import {
  scoutExecutor,
  dispositionForScout,
  type ModelRequest,
  type ModelResponse,
  type ModelTransport,
} from "../lib/control-plane/scheduler/scout-executor.ts";
import type { ScoutToolkit, ScoutToolContext } from "../lib/control-plane/scheduler/scout-contract.ts";
import { MIN_DISTINCT_RUNGS, validateScoutFinish, type ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import {
  RESEARCH_BOUNDS,
  ceilingPermits,
  deriveLevel1,
  scoutSpendInWindow,
  type ResearchState,
} from "../lib/control-plane/scheduler/research-policy.ts";

const NOW = "2026-09-01T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

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

function scheduled(o: FreshnessObligation = OBLIGATION): ScheduledObligation {
  const row = scheduleObligation(o, NOW_MS);
  if (!isScheduled(row)) throw new Error("fixture obligation did not schedule");
  return row;
}

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
        rung: { rung: rungLabel ?? "other:unlabelled", tool: name, target: url, observed: "HTTP 200, 10 bytes", artifactIds: [id] },
        requestCount: 1,
        bytesFetched: 10,
      };
    },
  };
}

/** A scripted model: each entry is the content the model returns on that turn. */
function scriptedTransport(turns: readonly ModelResponse["content"][]): ModelTransport & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let i = 0;
  const t = (async (request: ModelRequest) => {
    requests.push(request);
    const content = turns[Math.min(i, turns.length - 1)];
    i += 1;
    return {
      model: "claude-opus-5",
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

function executorWith(transport: ModelTransport, toolkit: ScoutToolkit, opts: { onResult?: (r: ScoutResult) => Promise<void>; bound?: Partial<typeof RESEARCH_BOUNDS.perDispatch> } = {}) {
  const results: ScoutResult[] = [];
  const exec = scoutExecutor({
    transport,
    toolkitFor: (_ctx: ScoutToolContext) => toolkit,
    contextFor: () => ({
      route: null,
      providerId: "test",
      reason: "test novelty",
      inherited: { artifactIds: ["inherited-1"], summary: "none" },
      tools: { vault: async () => ({ stored: true, where: "x", why: "written" }), spaceOut: async () => undefined },
    }),
    now: () => NOW,
    bound: { ...RESEARCH_BOUNDS.perDispatch, ...(opts.bound ?? {}) },
    onResult: async (r) => {
      results.push(r);
      if (opts.onResult) await opts.onResult(r);
    },
  });
  return { exec, results };
}

/* ---------------------------------------------------------------------- 1 */

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
      maxConcurrentScouts: 2,
      scoutLeaseTtlMs: 60_000,
      scoutWallMs: 1000,
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
    obligation: scheduled(),
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
  const { exec, results } = executorWith(transport, toolkit, { bound: { maxTurns: 3 } });
  const result = await dispatchOne(repos, {
    obligation: scheduled(),
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

test("5. the bound reached: the typed result carries rungs walked and next rungs, and stoppedBy is BOUND", async () => {
  const { repos, task } = await registered();
  const toolkit = fakeToolkit();
  const transport = scriptedTransport([
    [toolUse("u1", "fetch_public", { url: "https://a.gov/", rung: "primary-site-navigation", why: "start" })],
    [toolUse("u2", "fetch_public", { url: "https://a.gov/sitemap.xml", rung: "site-search-or-sitemap", why: "map" })],
    [finish("f", "NO_PROGRESS", { rungsWalked: [{ index: 0, note: "home" }, { index: 1, note: "sitemap" }], nextRungs: ["open-data-portal", "alternate-official-host-or-mirror"] })],
  ]);
  const { exec, results } = executorWith(transport, toolkit, { bound: { maxToolCalls: 2 } });
  const result = await dispatchOne(repos, {
    obligation: scheduled(),
    routeTaskId: task.id,
    holder: "t",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "UNGRADUATED",
    executor: exec,
  });
  assert.equal(result.outcome, "FAILED", "NO_PROGRESS aborts the Attempt; the obligation stays owed");
  assert.match(result.detail, /SCOUT_NO_PROGRESS \(BOUND\)/);
  const r = results[0];
  assert.equal(r.refusal, null, "a bound-ended result below the minimum is legitimate, not refused");
  assert.equal(r.stoppedBy, "BOUND");
  assert.equal(r.rungs.length, 2);
  assert.deepEqual(r.nextRungs, ["open-data-portal", "alternate-official-host-or-mirror"]);
  assert.equal(r.rungs[1].note, "sitemap");
  const last = transport.requests.at(-1)!;
  assert.deepEqual(last.tool_choice, { type: "tool", name: "finish" }, "after the bound only finish is offered");
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
      maxConcurrentScouts: 2,
      scoutLeaseTtlMs: 60_000,
      scoutWallMs: 1000,
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
      { attemptId: "a", workItemId: "w", routeTaskId: null, routeId: null, source: null, jurisdiction: null, project: "freshness", role: "SCOUT", cost: { inputTokens: 1, outputTokens: 1, usd: 2, durationMs: 1, bytesFetched: null, requestCount: 1 }, recordedAt: NOW },
      { attemptId: "b", workItemId: "w", routeTaskId: null, routeId: null, source: null, jurisdiction: null, project: "freshness", role: "ACQUIRER", cost: { inputTokens: null, outputTokens: null, usd: 5, durationMs: 1, bytesFetched: null, requestCount: 1 }, recordedAt: NOW },
      { attemptId: "c", workItemId: "w", routeTaskId: null, routeId: null, source: null, jurisdiction: null, project: "freshness", role: "SCOUT", cost: { inputTokens: 1, outputTokens: 1, usd: 3, durationMs: 1, bytesFetched: null, requestCount: 1 }, recordedAt: "2026-08-30T00:00:00.000Z" },
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
    model: "claude-opus-5",
    bounds: RESEARCH_BOUNDS,
    spend: { windowUsd: 1, measuredAttempts: 1, unmeasuredAttempts: 0, asOf: NOW },
    queue: { registeredUnits: 1, modelClassUnits: 1, modelClassDue: 1, modelClassDispatchedThisCycle: 1, modelClassDeferredForCeiling: 0, modelClassDeferredForCycleMax: 0, modelClassDeferredForLane: 0, deterministicDue: 0, deterministicDispatchedThisCycle: 0 },
    running: [],
    runtimeConditions: [],
    methodCandidates: null,
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

  const capped = deriveLevel1({ nowIso: NOW, heartbeat: { ...staleBeat, beatAt: NOW }, state, intents: [], spendWindowUsd: 25, spendUnmeasuredAttempts: 0 });
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
    obligation: scheduled(),
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
  assert.equal(attempt.worker.version, "claude-opus-5");
  assert.equal(attempt.cost.inputTokens, 3 * 1500, "input tokens include cache reads, summed over turns");
  assert.equal(attempt.cost.outputTokens, 300);
  assert.ok((attempt.cost.usd ?? 0) > 0);
  const r = results[0];
  assert.equal(r.outcome, "ROUTE_CANDIDATE");
  assert.equal(r.rungs[1].note, "meetings page", "the model's per-rung note travels; the rung itself is machine-derived");
  assert.equal(r.worker.modelReported, "claude-opus-5");
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
    obligation: scheduled(),
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

test("10. SEEDED (measured live): a provider refusal before any completion aborts with a MEASURED zero cost", async () => {
  const { repos, task } = await registered();
  const overloaded: ModelTransport = async () => {
    throw new Error('HTTP 529: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
  };
  const { exec, results } = executorWith(overloaded, fakeToolkit());
  const result = await dispatchOne(repos, {
    obligation: scheduled(),
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
  assert.equal(attempt.cost.usd, 0, "the provider served nothing and billed nothing: a measured zero");
  assert.equal(attempt.cost.inputTokens, 0);
  const ledger = (await repos.costs.readAll()).filter((c) => c.attemptId === attempt.id);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].cost.usd, 0);
  /* And a failure AFTER usage was reported keeps the reported usage. */
  let n = 0;
  const failsSecond: ModelTransport = async () => {
    n += 1;
    if (n === 2) throw new Error("HTTP 529: overloaded");
    return { model: "claude-opus-5", stop_reason: "tool_use", content: [toolUse("u1", "fetch_public", { url: "https://a.gov/", rung: "primary-site-navigation", why: "w" })], usage: { input_tokens: 100, output_tokens: 10 } };
  };
  const second = await registered();
  const { exec: exec2, results: results2 } = executorWith(failsSecond, fakeToolkit());
  await dispatchOne(second.repos, { obligation: scheduled(), routeTaskId: second.task.id, holder: "t", now: NOW, leaseTtlMs: 60_000, maturity: () => "UNGRADUATED", executor: exec2 });
  assert.equal(results2[0].usage.turns, 1);
  assert.ok((results2[0].usd ?? 0) > 0, "the one served turn is the charge");
});
