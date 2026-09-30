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

function fundedController(input: ConstructorParameters<typeof FleetSafetyController>[0]) {
  return new FleetSafetyController({ rollingCeilingUsd: 100, ...input });
}
const NIGHT = "2026-09-05T03:00:00.000Z"; // Friday 20:00 Phoenix.
const REQUEST: ModelRequest = {
  model: "claude-opus-5-5",
  max_tokens: 40_000,
  system: [{ type: "text", text: "bounded" }],
  tools: [],
  messages: [{ role: "user", content: "one bounded task" }],
};
const RESPONSE: ModelResponse = {
  model: "claude-opus-5-5",
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

test("model admission accumulates cycle spend with no per-cycle cap; only the rolling ceiling stops it", () => {
  const cycle = fundedController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  // Three requests settle with no per-cycle or operational-night refusal — those
  // caps are retired, so cycle spend simply accumulates.
  for (const work of ["one", "two", "three"]) {
    const reservation = cycle.reserveModelRequest("anthropic", work, REQUEST);
    cycle.settleModelRequest(reservation, RESPONSE);
  }
  const cycleUsd = cycle.snapshot(NIGHT).cycle.modelUsd;
  assert.ok(cycleUsd !== null && cycleUsd > 2, `cycle spend ${cycleUsd} accumulates past the retired $2 per-cycle cap`);

  // The rolling 24-hour ceiling ($100) is the one spend limit that still fires.
  const rolling = fundedController({ now: NIGHT, costs: [cost(99.5, "2026-09-04T04:00:00.000Z")], clock: () => Date.parse(NIGHT) });
  assert.throws(() => rolling.reserveModelRequest("anthropic", "day-next", REQUEST), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING");
});

test("a funded lifetime hunt still obeys the Admin spend dial for requests and escalations", () => {
  const safety = fundedController({ now: NIGHT, costs: [cost(99.5, NIGHT)], clock: () => Date.parse(NIGHT),
    lifetimeHuntWork: () => true });
  assert.equal(safety.rollingCeilingReached(0.6, "funded-hunt").reached, true);
  assert.throws(() => safety.reserveModelRequest("anthropic", "funded-hunt", REQUEST),
    (error: unknown) => error instanceof FleetSafetyRefusal && error.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING");
  assert.throws(() => safety.holdModelBudget("funded-hunt", 0.6),
    (error: unknown) => error instanceof FleetSafetyRefusal && error.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING");
});

test("rollingCeilingReached is the PRE-admission read of the ceiling — so the lane pauses instead of busy-looping refusals", () => {
  const cap = 100;
  const recent = "2026-09-05T02:00:00.000Z"; // within 24h of NIGHT

  // Well under: not reached, even allowing a worst-case scout.
  const under = fundedController({ now: NIGHT, costs: [cost(cap - 10, recent)], clock: () => Date.parse(NIGHT) });
  assert.deepEqual(under.rollingCeilingReached(0.6), { reached: false, spentUsd: cap - 10, capUsd: cap });

  // Over the ceiling — the observed flood ($26 > $25): reached even with no worst-case margin.
  const over = fundedController({ now: NIGHT, costs: [cost(cap + 1, recent)], clock: () => Date.parse(NIGHT) });
  assert.equal(over.rollingCeilingReached(0).reached, true);
  assert.equal(over.rollingCeilingReached(0).spentUsd, cap + 1);
  // The per-request guard would refuse this same dispatch — the pre-read matches it.
  assert.throws(() => over.reserveModelRequest("anthropic", "would-refuse", REQUEST), (e: unknown) =>
    e instanceof FleetSafetyRefusal && e.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING");

  // Boundary: just under, but a worst-case scout would tip over — pause with the margin, fit without it.
  const boundary = fundedController({ now: NIGHT, costs: [cost(cap - 0.2, recent)], clock: () => Date.parse(NIGHT) });
  assert.equal(boundary.rollingCeilingReached(0.6).reached, true, "a scout that cannot afford its worst case is not admitted");
  assert.equal(boundary.rollingCeilingReached(0).reached, false, "the spent total itself is still under the ceiling");

  // Unmeasured spend: reached=false — the caller's ledger-unreadable check owns that case.
  const nullRow = cost(null, recent);
  const unmeasured = fundedController({
    now: NIGHT,
    costs: [{ ...nullRow, role: "SCOUT", cost: { ...nullRow.cost, inputTokens: null, outputTokens: null, usd: null } }],
    clock: () => Date.parse(NIGHT),
  });
  assert.deepEqual(unmeasured.rollingCeilingReached(0.6), { reached: false, spentUsd: null, capUsd: cap });
});

test("the rolling ceiling is the injected owner override when given, the fallback otherwise — one value moves both gates", () => {
  const recent = "2026-09-05T02:00:00.000Z";
  const fallback = FLEET_SAFETY_BOUNDS.rolling24HourModelUsd;

  // No override → the fallback governs the bounds, the snapshot, and both reads.
  const def = new FleetSafetyController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  assert.equal(def.bounds.rolling24HourModelUsd, fallback);
  assert.equal(def.snapshot(NIGHT).bounds.rolling24HourModelUsd, fallback);

  // An override of $300 governs. $200 already spent is OVER the $100 fallback but
  // UNDER the override — the dial, not the constant, is what admits it, and the
  // pre-admission read and the per-request reservation agree.
  const raised = fundedController({ now: NIGHT, costs: [cost(200, recent)], rollingCeilingUsd: 300, clock: () => Date.parse(NIGHT) });
  assert.equal(raised.bounds.rolling24HourModelUsd, 300);
  assert.equal(raised.rollingCeilingReached(0.6).reached, false, "under the raised ceiling the lane is not paused");
  assert.doesNotThrow(
    () => raised.reserveModelRequest("anthropic", "under-raised-ceiling", REQUEST),
    "the per-request guard agrees with the pre-admission read",
  );

  // Lowering the override below the spend pauses the lane at the dial, not the fallback.
  const lowered = fundedController({ now: NIGHT, costs: [cost(200, recent)], rollingCeilingUsd: 150, clock: () => Date.parse(NIGHT) });
  assert.equal(lowered.rollingCeilingReached(0).reached, true);
  assert.equal(lowered.rollingCeilingReached(0).capUsd, 150);
  assert.throws(
    () => lowered.reserveModelRequest("anthropic", "over-lowered-ceiling", REQUEST),
    (e: unknown) => e instanceof FleetSafetyRefusal && e.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING",
  );

  // A disappeared or malformed ceiling is never NO ceiling: it falls back.
  for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
    const c = fundedController({ now: NIGHT, costs: [], rollingCeilingUsd: bad, clock: () => Date.parse(NIGHT) });
    assert.equal(c.bounds.rolling24HourModelUsd, fallback, `an override of ${bad} falls back to the built-in ceiling`);
  }
});

/*
 * 2026-09-25: FleetSafety's `paused` flag was display-only — a model request
 * was reserved under the owner's runner pause. Both locks below refuse the PAID
 * request and leave the free fetch seam admitting.
 */
test("the owner's runner pause refuses every model request, while free fetches and dispatches are still admitted", () => {
  const paused = fundedController({ now: NIGHT, costs: [], paused: true, clock: () => Date.parse(NIGHT) });
  assert.throws(() => paused.reserveModelRequest("anthropic", "scout-under-pause", REQUEST), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "OWNER_PAUSED");
  assert.doesNotThrow(() => paused.admitProviderRequest("discovery-web", "free-walk"), "a free walk's fetch is not paid work");
  assert.deepEqual(paused.admitDispatch("deterministic-refresh"), { admit: true });
  assert.equal(paused.snapshot(NIGHT).status, "PAUSED");
});

test("a closed paid lane's reason refuses every model request by name, and never calls the transport", async () => {
  const why = "held closed as if paused, because an owner spending control could not be read: the owner's research intents could not be read (reset)";
  const held = fundedController({ now: NIGHT, costs: [], modelHold: why, clock: () => Date.parse(NIGHT) });
  assert.throws(() => held.reserveModelRequest("anthropic", "prewarm", REQUEST), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "MODEL_LANE_CLOSED" && error.message.includes("research intents could not be read"));
  let called = 0;
  const transport = held.guardedModelTransport("anthropic", "auditor", async () => { called += 1; return RESPONSE; });
  await assert.rejects(transport(REQUEST), (error: unknown) => error instanceof FleetSafetyRefusal && error.code === "MODEL_LANE_CLOSED");
  assert.equal(called, 0, "no paid request left the process");
  assert.doesNotThrow(() => held.admitProviderRequest("public-web", "plain-code refresh"));
  const snapshot = held.snapshot(NIGHT);
  assert.equal(snapshot.status, "ACTIVE", "a held lane is not the owner's runner pause, and the card must not say it is");
  assert.ok(snapshot.stoppedBecause.some((line) => line.startsWith("MODEL_LANE_CLOSED: held closed as if paused")));

  const open = fundedController({ now: NIGHT, costs: [], modelHold: null, clock: () => Date.parse(NIGHT) });
  assert.doesNotThrow(() => open.reserveModelRequest("anthropic", "open-lane", REQUEST), "an open lane reserves as before");
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
  const controller = fundedController({ now: NIGHT, costs: [unmeteredScout], clock: () => Date.parse(NIGHT) });
  assert.throws(() => controller.reserveModelRequest("anthropic", "after-unmetered-scout", REQUEST), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "UNMEASURED_MODEL_SPEND");
});

test("a provider response with incomplete usage makes cycle spend UNMEASURED and stops later model work", () => {
  const controller = fundedController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
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

test("requests and dispatches keep running across days without a cycle wall", () => {
  const nowMs = Date.parse(NIGHT);
  const requests = fundedController({ now: NIGHT, costs: [], clock: () => nowMs });
  // No per-cycle request cap: far more than the retired 24 are all admitted.
  for (let i = 0; i < 100; i += 1) requests.admitProviderRequest("public-web", `request-${i}`);
  assert.equal(requests.snapshot(NIGHT).cycle.requests, 100);

  // No per-cycle payload total: recording bytes past the retired 16 MiB never refuses.
  const bytes = fundedController({ now: NIGHT, costs: [], clock: () => nowMs });
  bytes.recordInboundBytes("large-response", 64 * 1024 * 1024);
  bytes.recordInboundBytes("more", 1);
  assert.equal(bytes.snapshot(NIGHT).cycle.payloadBytes, 64 * 1024 * 1024 + 1);

  const dispatch = fundedController({ now: NIGHT, costs: [], clock: () => nowMs });
  // No per-cycle dispatch cap: far more than the retired 10 are all admitted.
  for (let i = 0; i < 100; i += 1) assert.equal(dispatch.admitDispatch(`dispatch-${i}`).admit, true);
  assert.equal(dispatch.snapshot(NIGHT).cycle.dispatches, 100);

  let clock = nowMs;
  const wall = fundedController({ now: NIGHT, costs: [], clock: () => clock });
  clock += 24 * 60 * 60_000;
  assert.equal(wall.admitDispatch("wall-deferred").admit, true);
  assert.equal(wall.snapshot(new Date(clock).toISOString()).deferred.length, 0);
});

test("the guarded fetch fails loud on a truncated 206 rather than handing up a partial document", async () => {
  const controller = fundedController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  const cap = FLEET_SAFETY_BOUNDS.maxDownloadBytes;

  // A 206 whose Content-Range total exceeds the per-download cap is a truncation:
  // refuse it (PAYLOAD_BYTE_CEILING), never return the partial body.
  const truncated = controller.guardedOpenBytes("public-web", "bulk-csv", async () =>
    new Response(new Uint8Array(1024), {
      status: 206,
      headers: { "content-range": `bytes 0-1023/${cap * 4}`, "content-length": "1024" },
    }),
  );
  const truncatedResult = await truncated({ url: "https://example.test/huge.csv", headers: {}, timeoutMs: 1_000 });
  assert.equal(truncatedResult.status, null, "a truncating 206 must not be returned as a successful read");
  assert.equal(truncatedResult.bytes.byteLength, 0);
  assert.equal(controller.snapshot(NIGHT).deferred.at(-1)?.code, "PAYLOAD_BYTE_CEILING");

  // A 206 that delivered the whole (small) resource within the cap is accepted.
  const complete = controller.guardedOpenBytes("public-web", "small-page", async () =>
    new Response(new Uint8Array([1, 2, 3]), {
      status: 206,
      headers: { "content-range": "bytes 0-2/3", "content-length": "3" },
    }),
  );
  const completeResult = await complete({ url: "https://example.test/small", headers: {}, timeoutMs: 1_000 });
  assert.equal(completeResult.status, 206);
  assert.equal(completeResult.bytes.byteLength, 3);
});

test("the guarded byte fetch answers the first hop with its location when asked not to follow, and follows by default", async () => {
  const controller = fundedController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  const requested: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    requested.push(String(url));
    return String(url).endsWith("/start")
      ? new Response(null, { status: 302, headers: { location: "https://other.test/next" } })
      : new Response("arrived", { status: 200 });
  }) as typeof fetch;

  const oneHop = controller.guardedOpenBytes("discovery-web", "one-hop", fetchImpl, { followRedirects: false });
  const first = await oneHop({ url: "https://example.test/start", headers: {}, timeoutMs: 1_000 });
  assert.equal(first.status, 302);
  assert.equal(first.location, "https://other.test/next", "the caller gets the target to ask permission of");
  assert.deepEqual(requested, ["https://example.test/start"], "nothing on the new host was requested");

  requested.length = 0;
  const followed = await controller.guardedOpenBytes("public-web", "followed", fetchImpl)({ url: "https://example.test/start", headers: {}, timeoutMs: 1_000 });
  assert.equal(followed.status, 200);
  assert.equal("location" in followed, false, "the default opener is unchanged");
  assert.deepEqual(requested, ["https://example.test/start", "https://other.test/next"]);
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
  const controller = fundedController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
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
  const quotaController = fundedController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
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
  const controller = fundedController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
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

test("an in-flight public read reserves only a bounded slice, so a concurrent read still proceeds", async () => {
  const controller = fundedController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
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
  // While the first read is in flight it holds only its bounded reservation, not
  // the whole remaining budget, so the second read is admitted and runs to 200
  // instead of being refused PAYLOAD_BYTE_CEILING at turn 0.
  const secondResult = await second({ url: "https://example.test/two", method: "GET", headers: {}, timeoutMs: 1_000 });
  assert.equal(secondResult.status, 200);
  assert.equal(secondResult.body, "two");
  assert.equal(secondCalls, 1);
  release();
  assert.equal((await firstPending).status, 200);
  assert.equal(firstCalls, 1);
  assert.equal(controller.snapshot(NIGHT).cycle.payloadBytes, 6);
});

test("a Scout model request is admitted while a public read is in flight (the turn-0 abort, fixed)", async () => {
  const controller = fundedController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const read = controller.guardedOpenOne("public-web", "deterministic-read", async () => {
    await gate;
    return new Response("body", { status: 200 });
  });
  const pending = read({ url: "https://example.test/big", method: "GET", headers: {}, timeoutMs: 1_000 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  // The deterministic read holds its (now bounded) reservation. A concurrent
  // Scout model request must not be refused for payload bytes before its first
  // turn — this is the contention that darkened the Scout lane in 2026-09.
  const scoutRequest: ModelRequest = {
    model: "claude-opus-5-5",
    max_tokens: 8_192,
    system: [{ type: "text", text: "scout" }],
    tools: [],
    messages: [{ role: "user", content: "scout turn 0" }],
  };
  const reservation = controller.reserveModelRequest("anthropic", "scout-turn-0", scoutRequest);
  assert.ok(reservation.usd > 0);
  controller.settleModelRequest(reservation, {
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: 10, output_tokens: 20 },
  });
  release();
  assert.equal((await pending).status, 200);
});

test("the largest recurring record's stream budget clears ~9.2 MiB while a full Scout lane holds reservations", async () => {
  const controller = fundedController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  const scoutRequest: ModelRequest = {
    model: "claude-opus-5-5",
    max_tokens: 8_192,
    system: [{ type: "text", text: "scout" }],
    tools: [],
    messages: [{ role: "user", content: "scout" }],
  };
  // The two concurrent Scouts each hold a model reservation…
  controller.reserveModelRequest("anthropic", "scout-a", scoutRequest);
  controller.reserveModelRequest("anthropic", "scout-b", scoutRequest);
  // …and each is mid-fetch, holding a bounded payload reservation.
  const gates: Array<() => void> = [];
  const holdOpen = (work: string): Promise<unknown> => {
    const gate = new Promise<void>((resolve) => gates.push(resolve));
    const open = controller.guardedOpenOne("public-web", work, async () => {
      await gate;
      return new Response("x", { status: 200 });
    });
    return open({ url: "https://example.test/scout", method: "GET", headers: {}, timeoutMs: 1_000 });
  };
  const a = holdOpen("scout-read-a");
  const b = holdOpen("scout-read-b");
  await new Promise<void>((resolve) => setImmediate(resolve));
  // Now the serial deterministic lane opens the largest recurring record. Its
  // honest per-fetch stream budget (the Range ceiling) must still clear the
  // 9,396,218-byte record even with the whole Scout lane holding reservations.
  let rangeEnd = 0;
  const big = controller.guardedOpenOne("public-web", "nh-cfs-filing-entity-details", async (_input, init) => {
    const range = (init?.headers as Record<string, string> | undefined)?.range ?? "";
    rangeEnd = Number(/bytes=0-(\d+)/.exec(range)?.[1] ?? "-1") + 1;
    return new Response("record", { status: 200 });
  });
  await big({ url: "https://example.test/nh-cfs", method: "GET", headers: {}, timeoutMs: 1_000 });
  assert.ok(
    rangeEnd >= 9_396_218,
    `the stream budget (${rangeEnd} bytes) must clear the 9,396,218-byte recurring record`,
  );
  for (const releaseGate of gates) releaseGate();
  await Promise.all([a, b]);
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

test("transient 429/5xx/network failures make one call and back off", async () => {
  for (const error of [
    new ModelTransportError("HTTP 429: slow down", 429),
    new ModelTransportError("HTTP 429: Retry-After exceeds default backoff", 429, 1_200_000),
    new ModelTransportError("HTTP 503: unavailable", 503),
    new Error("network timeout"),
  ]) {
    let calls = 0;
    const controller = fundedController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
    const guarded = controller.guardedModelTransport("anthropic", "transient-work", async () => {
      calls += 1;
      throw error;
    });
    await assert.rejects(() => guarded(REQUEST));
    assert.equal(calls, 1, "the transport performs no implicit retry");
    assert.equal(controller.snapshot(NIGHT).providerCircuits.length, 1);
    if (error instanceof ModelTransportError && error.retryAfterMs) {
      assert.equal(controller.snapshot(NIGHT).providerCircuits[0].eligibleAt,
        new Date(Date.parse(NIGHT) + error.retryAfterMs).toISOString());
    }
  }
});

test("Saturday nights dispatch normally", () => {
  const before = "2026-09-06T00:59:59.000Z"; // Saturday 17:59:59 Phoenix.
  const during = "2026-09-06T01:00:00.000Z"; // Saturday 18:00 Phoenix.
  const sundayMorning = "2026-09-06T12:59:59.000Z"; // Sunday 05:59:59 Phoenix.
  const after = "2026-09-06T13:00:00.000Z";
  assert.equal(scheduledBlackoutAt(before), false);
  assert.equal(scheduledBlackoutAt(during), false);
  assert.equal(scheduledBlackoutAt(sundayMorning), false);
  assert.equal(scheduledBlackoutAt(after), false);

  const controller = fundedController({ now: during, costs: [], clock: () => Date.parse(during) });
  assert.equal(controller.snapshot(during).status, "ACTIVE");
  assert.equal(controller.admitDispatch("blackout-work").admit, true);
});

test("Admin standing projection exposes ACTIVE, PAUSED and CIRCUIT BROKEN", () => {
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
  const active = fundedController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  assert.equal(runnerStanding(beat, [], NIGHT, active.snapshot(NIGHT)).state, "ACTIVE");
  const blackoutAt = "2026-09-06T02:00:00.000Z";
  const blackout = fundedController({ now: blackoutAt, costs: [], clock: () => Date.parse(blackoutAt) });
  assert.equal(runnerStanding({ ...beat, beatAt: blackoutAt }, [], blackoutAt, blackout.snapshot(blackoutAt)).state, "ACTIVE");
  const broken = fundedController({ now: NIGHT, costs: [], clock: () => Date.parse(NIGHT) });
  broken.latchProvider("anthropic", "quota exhausted", "owed-work", NIGHT);
  assert.equal(runnerStanding(beat, [], NIGHT, broken.snapshot(NIGHT)).state, "CIRCUIT BROKEN");
  const paused = fundedController({ now: NIGHT, costs: [], paused: true, clock: () => Date.parse(NIGHT) });
  assert.equal(runnerStanding(beat, [], NIGHT, paused.snapshot(NIGHT)).state, "PAUSED");
});
