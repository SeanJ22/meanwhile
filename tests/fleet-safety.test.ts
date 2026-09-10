import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { neonConfig } from "@neondatabase/serverless";

import type { CostEntry } from "../lib/control-plane/cost.ts";
import {
  FLEET_SAFETY_BOUNDS,
  FleetSafetyController,
  FleetSafetyRefusal,
  aggregateModelSpend,
  classifyProviderFailure,
  operationalNightAt,
  scheduledBlackoutAt,
} from "../lib/control-plane/fleet-safety.ts";
import { runnerStanding } from "../lib/control-plane/runner-standing.ts";
import { installNeonCircuitBreaker, readNeonCircuit } from "../lib/control-plane/neon-circuit.ts";
import { ModelTransportError, type ModelRequest, type ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";

const NIGHT = "2026-09-05T03:00:00.000Z"; // Friday 20:00 Phoenix.
const REQUEST: ModelRequest = {
  model: "claude-opus-5",
  max_tokens: 40_000,
  system: [{ type: "text", text: "bounded" }],
  tools: [],
  messages: [{ role: "user", content: "one bounded task" }],
};
const RESPONSE: ModelResponse = {
  model: "claude-opus-5",
  stop_reason: "end_turn",
  content: [{ type: "text", text: "done" }],
  usage: { input_tokens: 100, output_tokens: 39_000 },
};

function cost(usd: number | null, recordedAt: string): CostEntry {
  return {
    attemptId: `a-${recordedAt}-${usd}`,
    workItemId: "work",
    routeTaskId: null,
    routeId: null,
    source: null,
    jurisdiction: null,
    project: "fleet",
    role: "ADVERSARIAL_AUDITOR",
    cost: { inputTokens: 1, outputTokens: 1, usd, durationMs: 1, bytesFetched: null, requestCount: 1, cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false },
    recordedAt,
  };
}

test("aggregate model admission stops at cycle, operational-night, and rolling-24-hour ceilings", () => {
  const cycle = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  for (const work of ["one", "two"]) {
    const reservation = cycle.reserveModelRequest("anthropic", work, REQUEST);
    cycle.settleModelRequest(reservation, RESPONSE);
  }
  const cycleUsd = cycle.snapshot(NIGHT).cycle.modelUsd;
  assert.ok(cycleUsd !== null && Math.abs(cycleUsd - 1.951) < 1e-9);
  assert.throws(() => cycle.reserveModelRequest("anthropic", "cycle-third", REQUEST), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "CYCLE_MODEL_SPEND_CEILING");
  assert.equal(cycle.snapshot(NIGHT).deferred.at(-1)?.work, "cycle-third");

  const overnight = new FleetSafetyController({ now: NIGHT, costs: [cost(9.5, "2026-09-05T02:00:00.000Z")], clock: () => Date.parse(NIGHT) });
  assert.throws(() => overnight.reserveModelRequest("anthropic", "night-next", REQUEST), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "OPERATIONAL_NIGHT_MODEL_SPEND_CEILING");

  const rolling = new FleetSafetyController({ now: NIGHT, costs: [cost(24.5, "2026-09-04T04:00:00.000Z")], clock: () => Date.parse(NIGHT) });
  assert.throws(() => rolling.reserveModelRequest("anthropic", "day-next", REQUEST), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING");
});

test("an unmetered Scout cost row fails closed instead of disappearing from aggregate spend", () => {
  const row = cost(null, "2026-09-05T02:00:00.000Z");
  const unmeteredScout: CostEntry = {
    ...row,
    role: "SCOUT",
    cost: { ...row.cost, inputTokens: null, outputTokens: null, usd: null },
  };
  assert.deepEqual(
    aggregateModelSpend([unmeteredScout], "2026-09-05T01:00:00.000Z", NIGHT),
    { usd: null, measured: 0, unmeasured: 1 },
  );
  const controller = new FleetSafetyController({ now: NIGHT, costs: [unmeteredScout], clock: () => Date.parse(NIGHT) });
  assert.throws(() => controller.reserveModelRequest("anthropic", "after-unmetered-scout", REQUEST), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "UNMEASURED_MODEL_SPEND");
});

test("a provider response with incomplete usage makes cycle spend UNMEASURED and stops later model work", () => {
  const controller = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  const reservation = controller.reserveModelRequest("anthropic", "unmetered-response", REQUEST);
  assert.throws(
    () => controller.settleModelRequest(reservation, { ...RESPONSE, usage: { input_tokens: 100 } }),
    (error: unknown) => error instanceof FleetSafetyRefusal && error.code === "UNMEASURED_MODEL_SPEND",
  );
  assert.equal(controller.snapshot(NIGHT).cycle.modelUsd, null);
  assert.throws(
    () => controller.reserveModelRequest("anthropic", "after-unmetered-response", REQUEST),
    (error: unknown) => error instanceof FleetSafetyRefusal && error.code === "UNMEASURED_MODEL_SPEND",
  );
});

test("request, payload-byte, dispatch, and wall ceilings fail closed with named deferral", () => {
  const nowMs = Date.parse(NIGHT);
  const requests = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => nowMs });
  for (let i = 0; i < FLEET_SAFETY_BOUNDS.maxProviderRequestsPerCycle; i += 1) requests.admitProviderRequest("public-web", `request-${i}`);
  assert.throws(() => requests.admitProviderRequest("public-web", "request-over"), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "PROVIDER_REQUEST_CEILING");

  const bytes = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => nowMs });
  bytes.recordInboundBytes("large-response", FLEET_SAFETY_BOUNDS.maxPayloadBytesPerCycle);
  assert.throws(() => bytes.recordInboundBytes("byte-over", 1), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "PAYLOAD_BYTE_CEILING");

  const dispatch = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => nowMs });
  for (let i = 0; i < FLEET_SAFETY_BOUNDS.maxDispatchesPerCycle; i += 1) assert.equal(dispatch.admitDispatch(`dispatch-${i}`).admit, true);
  assert.deepEqual(dispatch.admitDispatch("dispatch-over"), {
    admit: false,
    code: "DISPATCH_CEILING",
    why: `cycle reached ${FLEET_SAFETY_BOUNDS.maxDispatchesPerCycle} dispatches`,
  });
  assert.equal(dispatch.snapshot(NIGHT).deferred.at(-1)?.work, "dispatch-over");

  let clock = nowMs;
  const wall = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => clock });
  clock += FLEET_SAFETY_BOUNDS.maxWallMsPerCycle;
  assert.equal(wall.admitDispatch("wall-deferred").admit, false);
  assert.equal(wall.snapshot(new Date(clock).toISOString()).deferred[0]?.code, "WALL_CLOCK_CEILING");
});

test("scheduler aggregate refusal leaves the exact registered obligation durably owed", async () => {
  const repos = createMemoryRepositories();
  const obligation = {
    id: "fleet:safety:named-debt",
    recordClass: "meetings",
    subjectId: "ocd-division/country:us/state:az/place:test",
    routeId: "fixture-route",
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: "2026-09-01T00:00:00.000Z",
  } as const;
  const item = createWorkItem({ project: "fleet", subject: obligation.subjectId, obligation: obligation.id, why: "fixture", now: NIGHT });
  await registerWorkItem(repos, item, NIGHT);
  const task = createRouteTask({ workItemId: item.id, routeId: obligation.routeId, routeLabel: "fixture", target: "https://example.invalid", inherited: false, now: NIGHT });
  await registerRouteTask(repos, task, NIGHT);
  let executorCalls = 0;
  const cycle = await runCycle({
    repos,
    obligations: [obligation],
    debts: [],
    routeTaskFor: () => task.id,
    maturity: () => "GRADUATED",
    executor: { lane: "DETERMINISTIC", run: async () => { executorCalls += 1; return { ranAs: "DETERMINISTIC", kind: "SIMULATED", detail: "must not run" }; } },
    holder: "fixture",
    now: NIGHT,
    leaseTtlMs: 1_000,
    reader: { contract: "READER", state: "NOT_READY", reason: "fixture" },
    truth: { contract: "TRUTH", state: "NOT_READY", reason: "fixture" },
    admitDispatch: (row) => ({ admit: false, code: "DISPATCH_CEILING", why: `${row.obligation.id} is beyond the aggregate ceiling` }),
  });
  assert.equal(executorCalls, 0);
  assert.deepEqual(cycle.dispatched, []);
  assert.deepEqual(cycle.worked, []);
  assert.equal(cycle.deferred[0]?.obligationId, obligation.id);
  assert.equal((await repos.routeTasks.mustRead(task.id)).value.state, "PENDING");
});

test("402 and quota refusals hard-latch one provider without probing or substitution", async () => {
  let providerCalls = 0;
  const substituteCalls = 0;
  const controller = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  const guarded = controller.guardedModelTransport("anthropic", "named-model-work", async () => {
    providerCalls += 1;
    throw new ModelTransportError("HTTP 402: payment required", 402);
  });
  await assert.rejects(() => guarded(REQUEST), /payment required/);
  await assert.rejects(() => guarded(REQUEST), /PROVIDER_CIRCUIT_BROKEN/);
  assert.equal(providerCalls, 1);
  assert.equal(substituteCalls, 0);
  const circuit = controller.snapshot(NIGHT).providerCircuits[0];
  assert.equal(circuit.provider, "anthropic");
  assert.equal(circuit.workDeferred[0], "named-model-work");
  assert.equal(circuit.firstObservedAt, NIGHT);
  assert.equal(circuit.eligibleAt, operationalNightAt(NIGHT).end);

  assert.equal(classifyProviderFailure(new Error("quota exhausted for account")).class, "HARD");
  assert.equal(classifyProviderFailure(new Error("transfer allowance exhausted")).class, "HARD");

  let quotaCalls = 0;
  const quotaController = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  const quotaGuard = quotaController.guardedModelTransport("anthropic", "quota-work", async () => {
    quotaCalls += 1;
    throw new Error("account quota exhausted");
  });
  await assert.rejects(() => quotaGuard(REQUEST), /quota exhausted/);
  await assert.rejects(() => quotaGuard(REQUEST), /PROVIDER_CIRCUIT_BROKEN/);
  assert.equal(quotaCalls, 1);
  assert.deepEqual(quotaController.snapshot(NIGHT).providerCircuits[0]?.workDeferred, ["quota-work"]);
});

test("public redirects are counted as separate provider requests under one byte ceiling", async () => {
  let calls = 0;
  const controller = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  const open = controller.guardedOpenOne("public-web", "redirected-work", async (input, init) => {
    calls += 1;
    assert.equal(init?.redirect, "manual");
    return calls === 1
      ? new Response("move", { status: 302, headers: { location: "/final", "content-length": "4" } })
      : new Response("done", { status: 200, headers: { "content-length": "4" } });
  });
  const result = await open({ url: "https://example.test/start", method: "GET", headers: {}, timeoutMs: 1_000 });
  assert.equal(result.status, 200);
  assert.equal(result.body, "done");
  assert.equal(calls, 2);
  assert.equal(controller.snapshot(NIGHT).cycle.requests, 2);
  assert.equal(controller.snapshot(NIGHT).cycle.payloadBytes, 8);
});

test("concurrent public reads cannot both reserve the same remaining byte allowance", async () => {
  const controller = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let firstCalls = 0;
  let secondCalls = 0;
  const first = controller.guardedOpenOne("public-web", "first-public-read", async () => {
    firstCalls += 1;
    await gate;
    return new Response("one", { status: 200 });
  });
  const second = controller.guardedOpenOne("public-web", "second-public-read", async () => {
    secondCalls += 1;
    return new Response("two", { status: 200 });
  });
  const firstPending = first({ url: "https://example.test/one", method: "GET", headers: {}, timeoutMs: 1_000 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const secondResult = await second({ url: "https://example.test/two", method: "GET", headers: {}, timeoutMs: 1_000 });
  assert.match(secondResult.transportError ?? "", /PAYLOAD_BYTE_CEILING/);
  assert.equal(secondCalls, 0);
  release();
  assert.equal((await firstPending).status, 200);
  assert.equal(firstCalls, 1);
});

test("a hard Neon response is host-latched before any second database probe", async () => {
  const root = mkdtempSync(join(tmpdir(), "fleet-neon-circuit-"));
  const original = neonConfig.fetchFunction;
  let calls = 0;
  try {
    neonConfig.fetchFunction = async () => {
      calls += 1;
      return new Response("payment required", { status: 402 });
    };
    installNeonCircuitBreaker(root, () => NIGHT);
    const guarded = neonConfig.fetchFunction as typeof fetch;
    await assert.rejects(() => guarded("https://neon.example/sql"), /PROVIDER_CIRCUIT_BROKEN/);
    await assert.rejects(() => guarded("https://neon.example/sql"), /PROVIDER_CIRCUIT_BROKEN/);
    assert.equal(calls, 1);
    const circuit = readNeonCircuit(root, NIGHT);
    assert.equal(circuit?.provider, "neon");
    assert.match(circuit?.condition ?? "", /402.*payment required/i);
  } finally {
    neonConfig.fetchFunction = original;
    rmSync(root, { recursive: true, force: true });
  }
});

test("transient 429/5xx/network failures do not spin and do not hard-latch", async () => {
  for (const error of [
    new ModelTransportError("HTTP 429: slow down", 429),
    new ModelTransportError("HTTP 503: unavailable", 503),
    new Error("network timeout"),
  ]) {
    let calls = 0;
    const controller = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
    const guarded = controller.guardedModelTransport("anthropic", "transient-work", async () => {
      calls += 1;
      throw error;
    });
    await assert.rejects(() => guarded(REQUEST));
    assert.equal(calls, 1, "the transport performs no implicit retry");
    assert.equal(controller.snapshot(NIGHT).providerCircuits.length, 0);
  }
});

test("Saturday operational night is an explicit SCHEDULED BLACKOUT", () => {
  const before = "2026-09-06T00:59:59.000Z"; // Saturday 17:59:59 Phoenix.
  const during = "2026-09-06T01:00:00.000Z"; // Saturday 18:00 Phoenix.
  const sundayMorning = "2026-09-06T12:59:59.000Z"; // Sunday 05:59:59 Phoenix.
  const after = "2026-09-06T13:00:00.000Z";
  assert.equal(scheduledBlackoutAt(before), false);
  assert.equal(scheduledBlackoutAt(during), true);
  assert.equal(scheduledBlackoutAt(sundayMorning), true);
  assert.equal(scheduledBlackoutAt(after), false);

  const controller = new FleetSafetyController({ now: during, costs: [], clock: () => Date.parse(during) });
  assert.equal(controller.snapshot(during).status, "SCHEDULED BLACKOUT");
  assert.equal(controller.admitDispatch("blackout-work").admit, false);
});

test("Admin standing projection exposes ACTIVE, PAUSED, SCHEDULED BLACKOUT, and CIRCUIT BROKEN", () => {
  const beat = {
    formatVersion: 1 as const,
    beatAt: NIGHT,
    lastCycleStartedAt: NIGHT,
    lastCycleFinishedAt: NIGHT,
    nextCycleDueAt: null,
    lastCycleOk: true,
    testedSha: "abc",
    host: "test",
    pause: null,
  };
  const active = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  assert.equal(runnerStanding(beat, [], NIGHT, active.snapshot(NIGHT)).state, "ACTIVE");
  const blackoutAt = "2026-09-06T02:00:00.000Z";
  const blackout = new FleetSafetyController({ now: blackoutAt, costs: [], clock: () => Date.parse(blackoutAt) });
  assert.equal(runnerStanding({ ...beat, beatAt: blackoutAt }, [], blackoutAt, blackout.snapshot(blackoutAt)).state, "SCHEDULED BLACKOUT");
  const broken = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  broken.latchProvider("anthropic", "quota exhausted", "owed-work", NIGHT);
  assert.equal(runnerStanding(beat, [], NIGHT, broken.snapshot(NIGHT)).state, "CIRCUIT BROKEN");
  const paused = new FleetSafetyController({ now: NIGHT, costs: [], paused: true, clock: () => Date.parse(NIGHT) });
  assert.equal(runnerStanding(beat, [], NIGHT, paused.snapshot(NIGHT)).state, "PAUSED");
});
