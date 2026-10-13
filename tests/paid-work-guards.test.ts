/**
 * The paid-work guards live in one module that the research round builds from the controllers it arms, so a
 * standing lease-worker lane builds the same ones. Each refusal is checked on the real holds, Fleet controller and
 * provider queue, with a fake model that counts what it was asked to send.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { DurableSpendHolds, SendBudgetRefusal, committedUsd, type BudgetLine } from "../lib/control-plane/expansion/spend-holds.ts";
import { FleetPreSendRefusal, FleetSafetyController } from "../lib/control-plane/fleet-safety.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { backgroundBatchTransport, batchRequestHash } from "../lib/control-plane/model-batch.ts";
import { paidWorkGuards, workerBatchRouting, type PaidWorkGuardDeps } from "../lib/control-plane/workers/paid-work-guards.ts";
import type { AssignmentBudgetGate } from "../lib/control-plane/expansion/assignment-budget.ts";
import type { ModelRequest, ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { MODELS } from "../lib/models.ts";
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
  workerTask?: Record<string, unknown>; batch?: PaidWorkGuardDeps["batch"];
} = {}) {
  const repos = createMemoryRepositories();
  const routeTask = createRouteTask({ workItemId: "wi-1", routeId: "autonomous:scout:x", routeLabel: "Discover", target: "https://x.example.gov/", inherited: false, now: NOW });
  const task = options.workerTask ? { ...routeTask, workerTask: options.workerTask as never } : routeTask;
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
  const deps: PaidWorkGuardDeps = { batchEnv: { WTP_BACKGROUND_WORKER_BATCH: options.batch ? "1" : "0" }, repos, now: () => NOW, armedAt: NOW, fleetSafety, providerQueue: new ModelProviderQueue(), spendHolds,
    assignmentBudget: { linesFor: () => options.sends ?? { lines: [] } } as unknown as AssignmentBudgetGate,
    expansionBudget: { gate: { linesFor: () => options.areas ?? { lines: [] } } } as never,
    messages, batch: options.batch ?? backgroundBatchTransport({ apiKey: "" }), modelLaneEnabled: options.modelLaneEnabled ?? true,
    ceilingUsd: () => options.ceilingUsd ?? 50, onCondition: sentence => { conditions.push(sentence); } };
  const guards = paidWorkGuards(deps);
  const ledger = async () => ({ spendHolds: heldRows(repos) });
  return { guards, sent, conditions, task, ledger, repos, jurisdiction: { subjectId: "ocd-division/country:us/state:nh/county:x", state: "NH" } };
}

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

/** A batch transport that records what it was handed instead of calling the service. */
function fakeBatch() {
  const batched: ModelRequest[] = [];
  const send = async (r: ModelRequest): Promise<ModelResponse> => {
    batched.push(r);
    return { id: "batch-msg", model: r.model, role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", batch: true,
      usage: { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as ModelResponse;
  };
  return { batched, batch: Object.assign(send, { withJournal: () => send }) as unknown as PaidWorkGuardDeps["batch"] };
}

test("BX-13: work routes by job: unattended extraction, audits, replays and blanks have batch lanes", () => {
  assert.deepEqual(workerBatchRouting({ workerTask: { role: "ADVERSARIAL_AUDITOR" } as never }), { lane: "background-worker-audit", job: "AUDIT_SAMPLE" });
  assert.deepEqual(workerBatchRouting({ workerTask: { role: "PARSER" } as never }), { lane: "background-worker-parse", job: "PAGE_READER" });
  assert.deepEqual(workerBatchRouting({ workerTask: { role: "PARSER", purpose: "DIAGNOSTIC_REPLAY" } as never }), { lane: "background-worker-parse", job: "BACKFILL" });
  assert.deepEqual(workerBatchRouting({ workerTask: { role: "PARSER", purpose: "OBLIGATION" } as never }), { lane: "background-worker-parse", job: "PAGE_READER" });
  assert.deepEqual(workerBatchRouting({}), { lane: "background-worker-research", job: "BLANK" });
});

test("BX-13: with the batch lane on, a parse a reader waits on is sent at once, and an audit sample takes the batch", async () => {
  const parse = fakeBatch();
  const p = await harness({ sends: { lines: [line("send:a", 5)] }, workerTask: { role: "PARSER", purpose: "OBLIGATION" }, batch: parse.batch });
  await p.repos.obligations.put("ob-1", { id: "ob-1", subjectId: p.jurisdiction.subjectId, recordClass: "MEETINGS", readerImpactAt: NOW, active: true } as never, NOW);
  await p.guards.workerTransportFor(p.jurisdiction, p.task.id)(request);
  assert.equal(p.sent.length, 1, "the parse went straight to the model");
  assert.equal(parse.batched.length, 0, "nothing waited on the batch service");

  const audit = fakeBatch();
  const a = await harness({ sends: { lines: [line("send:a", 5)] }, workerTask: { role: "ADVERSARIAL_AUDITOR" }, batch: audit.batch });
  await a.guards.workerTransportFor(a.jurisdiction, a.task.id)(request);
  assert.equal(a.sent.length, 0);
  assert.equal(audit.batched.length, 1, "the audit sample kept the discount");
});

test("BX-13: a parse already submitted to the batch service under the old routing is collected from it, never sent a second time", async () => {
  const recovery = fakeBatch();
  const h = await harness({ sends: { lines: [line("send:a", 5)] }, workerTask: { role: "PARSER" }, batch: recovery.batch });
  await h.repos.attempts.put("att-1", { id: "att-1", routeTaskId: h.task.id, outcome: null, leaseId: "lease-1",
    providerBatches: [{ requestHash: batchRequestHash(request), customId: "c-1", batchId: "msgbatch_1", submittedAt: NOW }] } as never, NOW);
  await h.guards.workerTransportFor(h.jurisdiction, h.task.id)(request);
  assert.equal(h.sent.length, 0, "no second paid request");
  assert.equal(recovery.batched.length, 1, "the outstanding batch answer was collected");
});

test("R7: a Scout rereads its place's meeting priority, and the request packet cannot erase a live deadline", async () => {
  const queued = fakeBatch();
  const h = await harness({ batch: queued.batch });
  await h.repos.obligations.put("meeting", { id: "meeting", subjectId: h.jurisdiction.subjectId,
    recordClass: "MEETINGS", readerImpactAt: NOW, active: true } as never, NOW);
  const send = h.guards.guardedJobTransportFor("scout-job", "BLANK", { now: NOW, subjectId: h.jurisdiction.subjectId });
  const packet = { ...request, batchContext: { job: "BLANK" as const, priority: { now: NOW } } };
  const urgent = await send(packet);
  assert.equal(urgent.batchEligible, false);
  assert.equal(h.sent.length, 1);
  assert.equal(queued.batched.length, 0);
  const meeting = await h.repos.obligations.mustRead("meeting");
  await h.repos.obligations.compareAndSet(meeting.id, meeting.revision, { ...meeting.value, readerImpactAt: null }, NOW);
  const background = await send(packet);
  assert.equal(background.batchEligible, true);
  assert.equal(background.batch, true);
  assert.equal(queued.batched.length, 1);
});
