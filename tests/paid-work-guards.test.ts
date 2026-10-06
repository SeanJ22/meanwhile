/**
 * CH-24: the paid-work guards live in one module (paid-work-guards.ts) that the
 * research round builds from the controllers it arms, so a standing lease-worker
 * lane builds exactly the same ones. Each refusal is checked on the real holds,
 * the real Fleet controller and the real provider queue, with a fake model that
 * counts what it was asked to send.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { DurableSpendHolds, SendBudgetRefusal, committedUsd, type BudgetLine } from "../lib/control-plane/expansion/spend-holds.ts";
import { FleetPreSendRefusal, FleetSafetyController } from "../lib/control-plane/fleet-safety.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { backgroundBatchTransport } from "../lib/control-plane/model-batch.ts";
import { paidWorkGuards, type PaidWorkGuardDeps } from "../lib/control-plane/workers/paid-work-guards.ts";
import type { AssignmentBudgetGate } from "../lib/control-plane/expansion/assignment-budget.ts";
import type { ModelRequest, ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { MODELS } from "../lib/models.ts";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import type { InProcessSpendHoldStore } from "../lib/control-plane/expansion/spend-holds.ts";
/** The holds table's rows (schema v24), live or not yet deleted: the memory store's view of `cp_spend_holds`. */
const heldRows = (r: { readonly spendHolds?: unknown }) => (r.spendHolds as InProcessSpendHoldStore).rows();

const NOW = "2026-10-05T18:00:00.000Z";
const line = (key: string, budgetUsd: number, historicalUsd = 0): BudgetLine => ({ key, label: key, budgetUsd, historicalUsd, historyReadAt: NOW });
const request = { model: MODELS.haiku.model, max_tokens: 1_024, system: [], tools: [], messages: [{ role: "user", content: "x" }] } as unknown as ModelRequest;

async function harness(options: {
  sends?: ReturnType<AssignmentBudgetGate["linesFor"]>;
  areas?: { lines: readonly BudgetLine[] } | { refusal: { code: string; why: string } };
  modelHold?: string | null; costs?: readonly CostEntry[]; ceilingUsd?: number; modelLaneEnabled?: boolean;
  batchFetch?: typeof fetch;
} = {}) {
  const repos = createMemoryRepositories();
  const task = createRouteTask({ workItemId: "wi-1", routeId: "autonomous:scout:x", routeLabel: "Discover", target: "https://x.example.gov/", inherited: false, now: NOW });
  await repos.routeTasks.put(task.id, task, NOW);
  await repos.occurrences.put("occ-1", { id: "occ-1", obligationId: "ob-1", sequence: 1, dueAt: NOW, workItemId: "wi-1", routeTaskId: task.id,
    openedAt: NOW, closedAt: null, disposition: null, unresolvedReason: null } as never, NOW);
  const sent: ModelRequest[] = [];
  const messages = async (r: ModelRequest): Promise<ModelResponse> => {
    sent.push(r);
    return { id: `msg-${sent.length}`, model: r.model, role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as ModelResponse;
  };
  const conditions: string[] = [];
  const spendHolds = new DurableSpendHolds({ budget: repos.budget, table: repos.spendHolds, now: () => NOW, sleep: async () => undefined });
  const fleetSafety = new FleetSafetyController({ now: NOW, costs: options.costs ?? [], modelHold: options.modelHold ?? null,
    rollingCeilingUsd: options.ceilingUsd ?? 50, clock: () => Date.parse(NOW) });
  const deps: PaidWorkGuardDeps = { repos, now: () => NOW, armedAt: NOW, fleetSafety, providerQueue: new ModelProviderQueue(), spendHolds,
    assignmentBudget: { linesFor: () => options.sends ?? { lines: [] } } as unknown as AssignmentBudgetGate,
    expansionBudget: { gate: { linesFor: () => options.areas ?? { lines: [] } } } as never,
    messages, batch: backgroundBatchTransport({ apiKey: "test", ...(options.batchFetch ? { fetchImpl: options.batchFetch } : {}) }), modelLaneEnabled: options.modelLaneEnabled ?? true,
    ceilingUsd: () => options.ceilingUsd ?? 50, onCondition: sentence => { conditions.push(sentence); } };
  const guards = paidWorkGuards(deps);
  const ledger = async () => ({ spendHolds: heldRows(repos) });
  return { guards, repos, sent, conditions, task, ledger, jurisdiction: { subjectId: "ocd-division/country:us/state:nh/county:x", state: "NH" } };
}

test("CA-25: unattended translation requests use the existing guarded batch and durable attempt, while ordinary work uses Messages", async () => {
  const before = process.env.WTP_TRANSLATION_BATCH;
  process.env.WTP_TRANSLATION_BATCH = "1";
  try {
    let posts = 0, customId = "";
    const batch = { id: "translation-batch", processing_status: "ended", results_url: "https://provider.test/results" };
    const h = await harness({ sends: { lines: [line("send:a", 5)] }, batchFetch: async (url, init) => {
      if (init?.method === "POST") {
        posts++;
        const items = JSON.parse(String(init.body)).requests;
        assert.equal(items.length, 1);
        customId = items[0].custom_id;
        return new Response(JSON.stringify(batch));
      }
      if (String(url).endsWith(batch.id)) return new Response(JSON.stringify(batch));
      return new Response(JSON.stringify({ custom_id: customId, result: { type: "succeeded", message: {
        model: request.model, content: [], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 },
      } } }));
    } });
    await h.repos.leases.put(h.task.id, { id: "lease-translation", routeTaskId: h.task.id, holder: "worker", claimedAt: NOW,
      heartbeatAt: NOW, expiresAt: "2026-10-05T19:00:00Z", released: false }, NOW);
    await h.repos.attempts.put("translation-attempt", { id: "translation-attempt", routeTaskId: h.task.id, workItemId: h.task.workItemId,
      worker: { role: "ACQUIRER", provider: "anthropic", version: request.model, instance: "worker" }, leaseId: "lease-translation",
      startedAt: NOW, endedAt: null, outcome: null, abortReason: null, artifactIds: [], cost: ZERO_COST,
      methodVersion: 1, policyVersion: "test" }, NOW);
    const send = h.guards.workerTransportFor(h.jurisdiction, h.task.id);
    const translation = { ...request, tools: [{ name: "write_measure_translation", description: "source-supported text", input_schema: { type: "object" } }] };
    assert.equal((await send(translation)).batch, true);
    assert.equal(posts, 1); assert.equal(h.sent.length, 0);
    const attempts = (await h.repos.attempts.mustRead("translation-attempt")).value.providerBatches;
    assert.equal(attempts?.[0].batchId, batch.id);
    const holds = (await h.ledger()).spendHolds ?? {};
    assert.equal(Object.keys(holds).length, 1);
    const charged = Object.values(holds)[0].settled!.usd;
    assert.ok(charged > 0);
    await send(translation); // Recovery retrieves the same request; no second POST or spend hold.
    assert.equal(posts, 1); assert.equal(Object.keys((await h.ledger()).spendHolds ?? {}).length, 1);
    assert.equal(Object.values((await h.ledger()).spendHolds!)[0].settled!.usd, charged);
    await send(request);
    assert.equal(h.sent.length, 1);
    assert.equal(Object.values((await h.ledger()).spendHolds!).find(row => row.jobId.startsWith("worker-request:") && row.settled?.usd !== charged)?.settled?.usd, charged * 2);
    process.env.WTP_TRANSLATION_BATCH = "0";
    await send({ ...translation, messages: [{ role: "user", content: "different source" }] });
    assert.equal(posts, 1); assert.equal(h.sent.length, 2);
  } finally {
    if (before === undefined) delete process.env.WTP_TRANSLATION_BATCH; else process.env.WTP_TRANSLATION_BATCH = before;
  }
});

test("CH-24: a request with room is sent once, held against its Send, and settled at what it measured", async () => {
  const h = await harness({ sends: { lines: [line("send:a", 5)] } });
  await h.guards.workerTransportFor(h.jurisdiction, h.task.id)(request);
  assert.equal(h.sent.length, 1);
  const holds = (await h.ledger()).spendHolds ?? {};
  assert.equal(Object.keys(holds).length, 1, "one hold for the request");
  assert.ok((Object.values(holds)[0]!.settled?.usd ?? 0) > 0, "settled at its measured cost");
});

test("CH-24: a Send whose budget cannot be checked refuses before any request", async () => {
  const h = await harness({ sends: { refusal: { code: "ASSIGNMENT_BUDGET_UNREADABLE", why: "the Send's budget could not be read" } } as never });
  await assert.rejects(h.guards.workerTransportFor(h.jurisdiction, h.task.id)(request),
    (error: unknown) => error instanceof SendBudgetRefusal && error.code === "ASSIGNMENT_BUDGET_UNREADABLE");
  assert.equal(h.sent.length, 0);
});

test("CH-24: the area guard refuses before any request", async () => {
  const h = await harness({ areas: { refusal: { code: "SCOPE_BUDGET", why: "the area's budget is spent" } } });
  await assert.rejects(h.guards.workerTransportFor(h.jurisdiction, h.task.id)(request),
    (error: unknown) => error instanceof SendBudgetRefusal && error.code === "SCOPE_BUDGET");
  assert.equal(h.sent.length, 0);
  await assert.rejects(h.guards.autonomousTransportFor(async () => { throw new Error("must not send"); })(h.jurisdiction)(request));
});

test("CH-24: a request past what the Send has left is refused before it is sent and holds nothing", async () => {
  const h = await harness({ sends: { lines: [line("send:a", 0.000001, 0)] } });
  await assert.rejects(h.guards.workerTransportFor(h.jurisdiction, h.task.id)(request), (error: unknown) => error instanceof SendBudgetRefusal);
  assert.equal(h.sent.length, 0);
  assert.equal(committedUsd((await h.ledger()).spendHolds ?? {}, line("send:a", 0.000001), NOW), 0, "a refused request leaves no committed spend");
});

test("CH-24: Fleet safety refuses before sending (a closed lane, a reached ceiling) and the hold is released", async () => {
  for (const options of [{ modelHold: "the owner paused the runner" },
    { costs: [{ attemptId: "spent", role: "SCOUT", source: "api.anthropic.com", recordedAt: "2026-10-05T17:00:00.000Z",
      cost: { usd: 60, inputTokens: 1, outputTokens: 1, requestCount: 1 } } as unknown as CostEntry], ceilingUsd: 50 }]) {
    const h = await harness({ ...options, sends: { lines: [line("send:a", 100)] } });
    await assert.rejects(h.guards.workerTransportFor(h.jurisdiction, h.task.id)(request), (error: unknown) => error instanceof FleetPreSendRefusal);
    assert.equal(h.sent.length, 0);
    assert.equal(committedUsd((await h.ledger()).spendHolds ?? {}, line("send:a", 100), NOW), 0, "the unsent request's hold is released");
  }
});

test("CH-24: paid capacity is zero while the lane is closed or the ceiling is reached, and says why once", async () => {
  assert.equal((await harness({ modelLaneEnabled: false })).guards.paidWorkerCapacity(10), 0);
  const spent = await harness({ costs: [{ attemptId: "spent", role: "SCOUT", source: "api.anthropic.com", recordedAt: "2026-10-05T17:00:00.000Z",
    cost: { usd: 60, inputTokens: 1, outputTokens: 1, requestCount: 1 } } as unknown as CostEntry], ceilingUsd: 50 });
  assert.equal(spent.guards.paidWorkerCapacity(10), 0);
  spent.guards.paidWorkerCapacity(10);
  assert.equal(spent.conditions.filter(sentence => /paid model capacity is closed/.test(sentence)).length, 1);
  spent.guards.capacityNoticeReset();
  spent.guards.paidWorkerCapacity(10);
  assert.equal(spent.conditions.filter(sentence => /paid model capacity is closed/.test(sentence)).length, 2, "a changed ceiling says it again");
  assert.ok((await harness()).guards.paidWorkerCapacity(10) > 0, "open with room");
});

test("CH-24: the round builds its guards from this module, with no inline copy left", () => {
  const round = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /const guards = paidWorkGuards\(\{/);
  assert.match(round, /transportFor: guards\.workerTransportFor,/);
  for (const inline of ["const budgetLinesFor = (", "const guardedMessagesFor = (", "const paidWorkerCapacity = (", "let autonomousHoldSeq", "new JobSpend(spendHolds, requestJobId"]) {
    assert.ok(!round.includes(inline), `no inline ${inline}`);
  }
});


test("CA-25: translation batching preserves Send and Fleet refusals before provider dispatch", async () => {
  let providerCalls = 0;
  const batchFetch: typeof fetch = async () => { providerCalls++; throw new Error("Refused work must not call provider"); };
  const translation = { ...request, tools: [{ name: "write_measure_translation", description: "held source", input_schema: { type: "object" } }] };
  for (const options of [
    { sends: { lines: [line("send:spent", 0.000001)] } },
    { sends: { refusal: { code: "ASSIGNMENT_BUDGET_UNREADABLE", why: "Unavailable Send budget" } } },
    { modelHold: "Owner pause" },
  ]) {
    const h = await harness({ ...options, batchFetch } as Parameters<typeof harness>[0]);
    await h.repos.budget.install({ hosts: {}, spendHolds: {} } as never, NOW);
    await assert.rejects(h.guards.workerTransportFor(h.jurisdiction, h.task.id)(translation), error => error instanceof SendBudgetRefusal || error instanceof FleetPreSendRefusal);
    assert.equal(h.sent.length, 0);
    assert.equal(Object.values((await h.ledger()).spendHolds ?? {}).reduce((sum, hold) => sum + (hold.settled?.usd ?? 0), 0), 0);
  }
  assert.equal(providerCalls, 0);
});
