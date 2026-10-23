import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, withFleetSpendCeiling } from "../lib/control-plane/gateway/admin-config.ts";
import { buildResearchIntent } from "../lib/control-plane/research-view.ts";
import { recordCost } from "../lib/control-plane/repository/coordinator.ts";
import { backgroundBatchTransport } from "../lib/control-plane/model-batch.ts";
import { planExpansion, type TerritoryIndex } from "../lib/control-plane/expansion/membership.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import { anthropicTransport, ModelTransportError, type ModelRequest } from "../lib/control-plane/scheduler/scout-executor.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { modelRequestWorstCaseUsd } from "../lib/control-plane/fleet-safety.ts";
import type { InProcessSpendHoldStore } from "../lib/control-plane/expansion/spend-holds.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { routineTaskDue } from "../lib/civic-data/runner.ts";
import { measureTranslationRoutineReceipt } from "../lib/translate/routine-receipt.ts";
import { measureTranslationRoutineTask } from "../lib/translate/routine-contract.ts";
import { MODELS } from "../lib/models.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { armRoutineTranslationPaidWork, ROUTINE_TRANSLATION_FLEET_BUDGET_KEY } from "../lib/translate/routine-paid-work.ts";

const now = "2026-10-20T18:00:00.000Z", ocdId = "ocd-division/country:us/state:oh";
const subject = { subjectId: "oh:measure:12", state: "OH" };
const request = { model: MODELS.haiku.model, max_tokens: 1024, system: [], tools: [],
  messages: [{ role: "user", content: "Explain the supplied measure." }] } as unknown as ModelRequest;

async function fixture() {
  const repos = createMemoryRepositories(), sent: ModelRequest[] = [];
  await repos.adminConfig.put(ADMIN_CONFIG_ID, withFleetSpendCeiling(defaultAdminConfig(now), {
    rollingCeilingUsd: 50, previousUsd: 50, decidedAt: now, decidedBy: "Sean", receiptId: "ceiling",
  }), now);
  const input = { repos, state: "OH", subjects: [{ subjectId: subject.subjectId, ocdId }], root: "/unused",
    now: () => now, credentialConfigured: true, credentialVar: "TEST_KEY", batch: backgroundBatchTransport({ apiKey: "" }),
    batchEnv: { WTP_BACKGROUND_WORKER_BATCH: "0" },
    loadExpansion: async () => ({ plan: null, conditions: [] as string[] }),
    messages: async (req: ModelRequest) => {
      sent.push(req);
      return { model: req.model, stop_reason: "end_turn", content: [],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
    },
  };
  return { input, repos, sent };
}

test("the routine admits through the existing guards without a research-round budget file", async () => {
  const f = await fixture(), gate = await armRoutineTranslationPaidWork(f.input);
  assert.equal(gate.closed, null);
  assert.ok(gate.paidWorkerCapacity(2) > 0);
  await gate.guardedTransportFor(subject)(request);
  assert.equal(f.sent.length, 1);
});

test("an Admin pause between writer and checker blocks the next call", async () => {
  const f = await fixture(), gate = await armRoutineTranslationPaidWork(f.input);
  const send = gate.guardedTransportFor(subject);
  await send(request);
  const pause = buildResearchIntent("PAUSE", now, "test", null, "pause");
  await f.repos.researchIntents.append("level-1", pause.intentId, pause, now);
  await assert.rejects(send(request), /paused by owner intent/);
  assert.equal(f.sent.length, 1);
  assert.equal(gate.paidWorkerCapacity(2), 0);
});

test("runner pause and unreadable Admin controls stop before any paid call", async () => {
  for (const kind of ["runner", "config", "intents", "spend"]) {
    const f = await fixture();
    if (kind === "runner") {
      const pause = buildResearchIntent("PAUSE_RUNNER", now, "test", null, "pause");
      await f.repos.researchIntents.append("level-1", pause.intentId, pause, now);
    }
    if (kind === "config") f.repos.adminConfig.read = async () => { throw new Error("config unavailable"); };
    if (kind === "intents") f.repos.researchIntents.read = async () => { throw new Error("intents unavailable"); };
    if (kind === "spend") f.repos.spend.aggregate = async () => { throw new Error("spend unavailable"); };
    const gate = await armRoutineTranslationPaidWork(f.input);
    assert.ok(gate.closed, kind);
    await assert.rejects(gate.guardedTransportFor(subject)(request));
    assert.equal(f.sent.length, 0, kind);
  }
});

test("a lower live model ceiling blocks the next call", async () => {
  const f = await fixture(), gate = await armRoutineTranslationPaidWork(f.input);
  await gate.guardedTransportFor(subject)(request);
  await recordCost(f.repos, { attemptId: "spent", workItemId: subject.subjectId, project: "freshness", role: "SCOUT",
    recordedAt: now, model: MODELS.haiku.model, source: "api.anthropic.com", jurisdiction: subject.subjectId,
    cost: { usd: 2, inputTokens: 100, outputTokens: 50, requestCount: 1 } } as unknown as CostEntry, now);
  const config = await f.repos.adminConfig.mustRead(ADMIN_CONFIG_ID);
  await f.repos.adminConfig.save(config, withFleetSpendCeiling(config.value, {
    rollingCeilingUsd: 1, previousUsd: 50, decidedAt: now, decidedBy: "Sean", receiptId: "lower",
  }), now);
  await assert.rejects(gate.guardedTransportFor(subject)(request), /\$1.00 model ceiling is reached/);
  assert.equal(f.sent.length, 1);
});

test("the same area budget holds the request's worst case before sending", async () => {
  const f = await fixture();
  const decision: ExpansionScopeDecision = { key: "state:2020/39", geography: { type: "state", geoid: "39", version: "state:2020", label: "Ohio", stateAbbr: "OH" },
    priority: 1, budgetUsd: 0.000001, note: null, decidedAt: now, decidedBy: "Sean", receiptId: "oh", previous: null };
  const territory: TerritoryIndex = { bySubject: new Map(), unplaced: new Map(), statewide: new Set(), unregisteredUnitsByState: new Map() };
  const plan = planExpansion({ now, scopes: [{ kind: "RESOLVED", decision, zctas: new Set(["43001"]), whole: new Set(["43001"]), fractions: new Map(), states: ["OH"] }],
    malformedScopes: 0, lookup: { source: "published", versionId: "official-geography", detail: null }, territory, territoryDetail: null,
    obligations: [{ id: "translation", subjectId: subject.subjectId }],
    declaredMembers: new Map([[decision.key, new Set([subject.subjectId])]]) });
  const gate = await armRoutineTranslationPaidWork({ ...f.input, loadExpansion: async () => ({ plan, conditions: [] }) });
  await assert.rejects(gate.guardedTransportFor(subject)(request), /budget|left/i);
  assert.equal(f.sent.length, 0);
});

test("a routine never admits another state's measure or an undeclared subject", async () => {
  const f = await fixture();
  await assert.rejects(armRoutineTranslationPaidWork({ ...f.input, subjects: [{ subjectId: "other", ocdId: "ocd-division/country:us/state:mi" }] }), /one state/);
  const gate = await armRoutineTranslationPaidWork(f.input);
  await assert.rejects(gate.guardedTransportFor({ subjectId: "unadmitted", state: "OH" })(request), /outside/);
  assert.equal(f.sent.length, 0);
});

test("a provider's hard refusal holds later calls in the same routine", async () => {
  const f = await fixture();
  let calls = 0;
  const gate = await armRoutineTranslationPaidWork({ ...f.input, messages: async () => {
    calls++; throw new ModelTransportError("payment required", 402);
  } });
  await assert.rejects(gate.guardedTransportFor(subject)(request), /payment required/);
  await assert.rejects(gate.guardedTransportFor(subject)(request), /latched|payment required|circuit/i);
  assert.equal(calls, 1);
  const rows = (f.repos.spendHolds as InProcessSpendHoldStore).rows();
  assert.equal(Object.values(rows).filter(hold => hold.settled === null && hold.keys.includes(ROUTINE_TRANSLATION_FLEET_BUDGET_KEY)).length, 1,
    "the sent request with no usage keeps its worst-case hold");
});

test("concurrent routine children reserve the same remaining Admin model allowance once", async () => {
  const f = await fixture(), worst = modelRequestWorstCaseUsd(request)!;
  const config = await f.repos.adminConfig.mustRead(ADMIN_CONFIG_ID);
  await f.repos.adminConfig.save(config, withFleetSpendCeiling(config.value, {
    rollingCeilingUsd: worst * 1.5, previousUsd: 50, decidedAt: now, decidedBy: "Sean", receiptId: "last-room",
  }), now);
  let started!: () => void, release!: () => void;
  const began = new Promise<void>(done => { started = done; });
  const finish = new Promise<void>(done => { release = done; });
  const input = { ...f.input, messages: async (req: ModelRequest) => {
    started(); await finish; return f.input.messages(req);
  } };
  const [firstGate, secondGate] = await Promise.all([armRoutineTranslationPaidWork(input), armRoutineTranslationPaidWork(input)]);
  const first = firstGate.guardedTransportFor(subject)(request);
  await began;
  try {
    await assert.rejects(secondGate.guardedTransportFor(subject)(request), /All paid model work.*budget|budget.*All paid model work/i);
  } finally { release(); }
  await first;
  assert.equal(f.sent.length, 1, "the other child's hold prevented a second paid request");
});


test("the workspace API usage-limit response closes the lane with its exact reason and removes paid capacity", async () => {
  const f = await fixture(), reason = "You have reached your specified workspace API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.";
  const conditions: string[] = [];
  let calls = 0;
  const gate = await armRoutineTranslationPaidWork({ ...f.input, onCondition: reason => conditions.push(reason), messages: anthropicTransport("test-key", async () => {
    calls++;
    return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: reason } }), { status: 400 });
  }) });
  await assert.rejects(gate.guardedTransportFor(subject)(request), /specified workspace API usage limits/);
  assert.equal(gate.closed?.reason, reason);
  assert.equal(gate.paidWorkerCapacity(2), 0);
  assert.ok(conditions.includes(reason));
  await assert.rejects(gate.guardedTransportFor(subject)(request), /specified workspace API usage limits/);
  assert.equal(calls, 1);
  const store = new MemoryRoutineDataStore(), task = measureTranslationRoutineTask("OH");
  const result = await measureTranslationRoutineReceipt({ store, ballots: [], state: "OH", now, holdReason: gate.closed!.reason });
  const held = await store.readCandidate(result.receipt.candidateId);
  assert.match(held!.failureDetail!, /You have reached your specified workspace API usage limits/);
  const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(routineTaskDue(task, clock, Date.parse(now) + 1), false, "the held state releases the pass slot until its normal retry");
});


test("an in-flight success cannot reopen the lane after another request hits the workspace limit", async () => {
  const f = await fixture();
  let began!: () => void, fail!: () => void, succeed!: () => void;
  const both = new Promise<void>(resolve => { began = resolve; });
  const failure = new Promise<void>(resolve => { fail = resolve; });
  const success = new Promise<void>(resolve => { succeed = resolve; });
  let calls = 0;
  const reason = "You have reached your specified workspace API usage limits.";
  const gate = await armRoutineTranslationPaidWork({ ...f.input, providerQueue: new ModelProviderQueue({ requestsPerMinute: 1000 }), messages: async request => {
    if (++calls === 1) { await failure; throw new ModelTransportError(reason, 400); }
    began(); await success; return f.input.messages(request);
  } });
  const first = gate.guardedTransportFor(subject)(request), second = gate.guardedTransportFor(subject)(request);
  await both;
  fail();
  await assert.rejects(first, /specified workspace/);
  assert.equal(gate.closed?.reason, reason);
  assert.equal(gate.paidWorkerCapacity(), 0);
  succeed();
  await second;
  assert.equal(gate.closed?.reason, reason);
  assert.equal(gate.paidWorkerCapacity(), 0);
});


test("a request already waiting for provider capacity stops when the workspace limit closes the lane", async () => {
  const f = await fixture();
  let calls = 0;
  const gate = await armRoutineTranslationPaidWork({ ...f.input, messages: async () => {
    calls++; throw new ModelTransportError("You have reached your specified workspace API usage limits.", 400);
  } });
  const results = await Promise.allSettled([gate.guardedTransportFor(subject)(request), gate.guardedTransportFor(subject)(request)]);
  assert.ok(results.every(result => result.status === "rejected"));
  assert.equal(calls, 1);
  assert.equal(gate.paidWorkerCapacity(), 0);
});
