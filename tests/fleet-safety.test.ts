import { fetchSource, runWithSourceFetch } from "../lib/sources/fetch-source.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { memoryWebsitePacing } from "../lib/control-plane/website-pacing.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import test from "node:test";

import { neonConfig } from "@neondatabase/serverless";

import { costEntryWorstCaseUsd, type CostEntry } from "../lib/control-plane/cost.ts";
import type { SpendHold } from "../lib/control-plane/budget.ts";
import { researchPaidWorkerCapacity, researchSpendInWindow } from "../lib/control-plane/scheduler/research-policy.ts";
import {
  FLEET_SAFETY_BOUNDS,
  FleetSafetyController,
  FleetSafetyRefusal,
  aggregateModelSpend,
  classifyProviderFailure,
  operationalNightAt,
  scheduledBlackoutAt,
  modelRequestWorstCaseUsd,
  pricedModelCharge,
} from "../lib/control-plane/fleet-safety.ts";
import { runnerStanding } from "../lib/control-plane/runner-standing.ts";
import { installNeonCircuitBreaker, readNeonCircuit } from "../lib/control-plane/neon-circuit.ts";
import { anthropicTransport, ModelTransportError, type ModelRequest, type ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";

const priced = (rows: readonly CostEntry[]) => rows.flatMap(row => pricedModelCharge(row, row.attemptId) ?? []);

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
  const cycle = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
  for (const work of ["one", "two", "three"]) {
    const reservation = cycle.reserveModelRequest("anthropic", work, REQUEST);
    cycle.settleModelRequest(reservation, RESPONSE);
  }
  const cycleUsd = cycle.snapshot(NIGHT).cycle.modelUsd;
  assert.ok(cycleUsd !== null && cycleUsd > 2, `cycle spend ${cycleUsd} accumulates past the retired $2 per-cycle cap`);

  // The rolling 24-hour ceiling ($100) is the one spend limit that still fires.
  const rolling = fundedController({ now: NIGHT, charges: priced([cost(99.5, "2026-09-04T04:00:00.000Z")]), clock: () => Date.parse(NIGHT) });
  assert.throws(() => rolling.reserveModelRequest("anthropic", "day-next", REQUEST), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING");
});

test("a funded lifetime hunt still obeys the Admin spend dial for requests", () => {
  const safety = fundedController({ now: NIGHT, charges: priced([cost(99.5, NIGHT)]), clock: () => Date.parse(NIGHT),
    lifetimeHuntWork: () => true });
  assert.equal(safety.rollingCeilingReached(0.6, "funded-hunt").reached, true);
  assert.throws(() => safety.reserveModelRequest("anthropic", "funded-hunt", REQUEST),
    (error: unknown) => error instanceof FleetSafetyRefusal && error.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING");
});

test("rollingCeilingReached is the PRE-admission read of the ceiling — so the lane pauses instead of busy-looping refusals", () => {
  const cap = 100;
  const recent = "2026-09-05T02:00:00.000Z";

  const under = fundedController({ now: NIGHT, charges: priced([cost(cap - 10, recent)]), clock: () => Date.parse(NIGHT) });
  assert.deepEqual(under.rollingCeilingReached(0.6), { reached: false, spentUsd: cap - 10, capUsd: cap });

  // Over the ceiling — the observed flood ($26 > $25): reached even with no worst-case margin.
  const over = fundedController({ now: NIGHT, charges: priced([cost(cap + 1, recent)]), clock: () => Date.parse(NIGHT) });
  assert.equal(over.rollingCeilingReached(0).reached, true);
  assert.equal(over.rollingCeilingReached(0).spentUsd, cap + 1);
  // The per-request guard would refuse this same dispatch — the pre-read matches it.
  assert.throws(() => over.reserveModelRequest("anthropic", "would-refuse", REQUEST), (e: unknown) =>
    e instanceof FleetSafetyRefusal && e.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING");

  // Boundary: just under, but a worst-case scout would tip over — pause with the margin, fit without it.
  const boundary = fundedController({ now: NIGHT, charges: priced([cost(cap - 0.2, recent)]), clock: () => Date.parse(NIGHT) });
  assert.equal(boundary.rollingCeilingReached(0.6).reached, true, "a scout that cannot afford its worst case is not admitted");
  assert.equal(boundary.rollingCeilingReached(0).reached, false, "the spent total itself is still under the ceiling");

  // An unpriced charge is counted at its worst case, so the ceiling stays in force.
  const nullRow = cost(null, recent);
  const tokenless: CostEntry = { ...nullRow, role: "SCOUT", cost: { ...nullRow.cost, inputTokens: null, outputTokens: null, usd: null } };
  const unmeasured = fundedController({
    now: NIGHT,
    charges: priced([tokenless]),
    clock: () => Date.parse(NIGHT),
  });
  assert.deepEqual(unmeasured.rollingCeilingReached(0.6),
    { reached: false, spentUsd: costEntryWorstCaseUsd(tokenless), capUsd: cap });
});

test("the rolling ceiling is the injected owner override when given, the fallback otherwise — one value moves both gates", () => {
  const recent = "2026-09-05T02:00:00.000Z";
  const fallback = FLEET_SAFETY_BOUNDS.rolling24HourModelUsd;

  // No override → the fallback governs the bounds, the snapshot, and both reads.
  const def = new FleetSafetyController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
  assert.equal(def.bounds.rolling24HourModelUsd, fallback);
  assert.equal(def.snapshot(NIGHT).bounds.rolling24HourModelUsd, fallback);

  const raised = fundedController({ now: NIGHT, charges: priced([cost(200, recent)]), rollingCeilingUsd: 300, clock: () => Date.parse(NIGHT) });
  assert.equal(raised.bounds.rolling24HourModelUsd, 300);
  assert.equal(raised.rollingCeilingReached(0.6).reached, false, "under the raised ceiling the lane is not paused");
  assert.doesNotThrow(
    () => raised.reserveModelRequest("anthropic", "under-raised-ceiling", REQUEST),
    "the per-request guard agrees with the pre-admission read",
  );

  // Lowering the override below the spend pauses the lane at the dial, not the fallback.
  const lowered = fundedController({ now: NIGHT, charges: priced([cost(200, recent)]), rollingCeilingUsd: 150, clock: () => Date.parse(NIGHT) });
  assert.equal(lowered.rollingCeilingReached(0).reached, true);
  assert.equal(lowered.rollingCeilingReached(0).capUsd, 150);
  assert.throws(
    () => lowered.reserveModelRequest("anthropic", "over-lowered-ceiling", REQUEST),
    (e: unknown) => e instanceof FleetSafetyRefusal && e.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING",
  );

  // A disappeared or malformed ceiling is never NO ceiling: it falls back.
  for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
    const c = fundedController({ now: NIGHT, charges: [], rollingCeilingUsd: bad, clock: () => Date.parse(NIGHT) });
    assert.equal(c.bounds.rolling24HourModelUsd, fallback, `an override of ${bad} falls back to the built-in ceiling`);
  }
});

/* Both locks below refuse the PAID request under a pause and leave the free fetch seam admitting. */
test("the owner's runner pause refuses every model request, while free fetches and dispatches are still admitted", () => {
  const paused = fundedController({ now: NIGHT, charges: [], paused: true, clock: () => Date.parse(NIGHT) });
  assert.throws(() => paused.reserveModelRequest("anthropic", "scout-under-pause", REQUEST), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "OWNER_PAUSED");
  assert.doesNotThrow(() => paused.admitProviderRequest("discovery-web", "free-walk"), "a free walk's fetch is not paid work");
  assert.deepEqual(paused.admitDispatch("deterministic-refresh"), { admit: true });
  assert.equal(paused.snapshot(NIGHT).status, "PAUSED");
});

test("a closed paid lane's reason refuses every model request by name, and never calls the transport", async () => {
  const why = "held closed as if paused, because an owner spending control could not be read: the owner's research intents could not be read (reset)";
  const held = fundedController({ now: NIGHT, charges: [], modelHold: why, clock: () => Date.parse(NIGHT) });
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

  const open = fundedController({ now: NIGHT, charges: [], modelHold: null, clock: () => Date.parse(NIGHT) });
  assert.doesNotThrow(() => open.reserveModelRequest("anthropic", "open-lane", REQUEST), "an open lane reserves as before");
});

test("an unmetered Scout cost row is counted at its worst case instead of shutting off paid work", () => {
  const row = cost(null, "2026-09-05T02:00:00.000Z");
  const unmeteredScout: CostEntry = {
    ...row,
    role: "SCOUT",
    cost: { ...row.cost, inputTokens: null, outputTokens: null, usd: null },
  };
  assert.deepEqual(
    aggregateModelSpend([unmeteredScout], "2026-09-05T01:00:00.000Z", NIGHT),
    { usd: costEntryWorstCaseUsd(unmeteredScout), knownUsd: 0, measured: 0, unmeasured: 1, worstCaseCharges: 1 },
  );
  const controller = fundedController({ now: NIGHT, charges: priced([unmeteredScout]), clock: () => Date.parse(NIGHT) });
  assert.equal(controller.admissionSpendUsd(), costEntryWorstCaseUsd(unmeteredScout));
  assert.equal(controller.snapshot(NIGHT).rolling24Hours.worstCaseCharges, 1);
  assert.doesNotThrow(() => controller.reserveModelRequest("anthropic", "after-unmetered-scout", REQUEST));
});

test("incomplete usage consumes the actual request bound while measurement stays unknown", () => {
  const controller = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
  const reservation = controller.reserveModelRequest("anthropic", "unmetered-response", REQUEST);
  assert.throws(
    () => controller.settleModelRequest(reservation, { ...RESPONSE, usage: { input_tokens: 100 } }),
    (error: unknown) => error instanceof FleetSafetyRefusal && error.code === "UNMEASURED_MODEL_SPEND",
  );
  assert.equal(controller.snapshot(NIGHT).cycle.modelUsd, null);
  assert.equal(controller.admissionSpendUsd(), modelRequestWorstCaseUsd(REQUEST));
  assert.doesNotThrow(() => controller.reserveModelRequest("anthropic", "after-unmetered-response", REQUEST));
});

test("Fleet and research recover each recorded tier's cache and batch price", () => {
  const row: CostEntry = { ...cost(null, NIGHT), role: "ASK", source: "api.anthropic.com", model: "claude-haiku-4-5",
    cost: { ...cost(null, NIGHT).cost, inputTokens: 1_000, outputTokens: 20, uncachedInputTokens: 100,
      cacheReadInputTokens: 800, cacheCreationInputTokens: 100, cacheCreation5mInputTokens: 100, cacheCreation1hInputTokens: 0 } };
  const rows = [row, { ...row, attemptId: "batch", model: "claude-opus-5-5", cost: { ...row.cost, batch: true } }];
  // Haiku: .000405; Opus batch: (.0004 + .00016 + .0005 + .0004) / 2.
  const expected = .000405 + .00073;
  const fleet = aggregateModelSpend(rows, NIGHT, NIGHT);
  assert.ok(Math.abs(fleet.usd! - expected) < 1e-12);
  assert.equal(fleet.knownUsd, fleet.usd);
  assert.equal(fleet.measured, 2);
  assert.equal(researchSpendInWindow(priced(rows), NIGHT).windowUsd, fleet.usd, "ASK is paid model work in both readers");
  assert.equal(aggregateModelSpend([{ ...row, cost: { ...row.cost, inputTokens: null } }], NIGHT, NIGHT).usd,
    aggregateModelSpend([row], NIGHT, NIGHT).usd, "complete billed cache quantities do not need a redundant total");
});

test("legacy tokens without cache detail consume the model's dearest cache-write bound", () => {
  const row = { ...cost(null, NIGHT), model: "sonnet", cost: { ...cost(null, NIGHT).cost, inputTokens: 1_000, outputTokens: 100 } };
  const fleet = aggregateModelSpend([row], NIGHT, NIGHT);
  assert.equal(fleet.usd, .005, "1000 inputs at $4/MTok and 100 outputs at $10/MTok");
  assert.equal(fleet.knownUsd, 0, "cache behaviour is bounded, not measured");
  assert.equal(fleet.unmeasured, 1);
  assert.equal(researchSpendInWindow(priced([row]), NIGHT).windowUsd, fleet.usd);
});

test("mixed-tier shares are recovered once and an incomplete split is counted at worst case", () => {
  const base = cost(null, NIGHT);
  const share = (model: string) => ({ model, ...base.cost, requestCount: 1,
    uncachedInputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0 });
  const row: CostEntry = { ...base, cost: { ...base.cost, inputTokens: 2, outputTokens: 2, requestCount: 2 },
    byModel: [share("haiku"), share("opus")] };
  assert.ok(Math.abs(aggregateModelSpend([row], NIGHT, NIGHT).usd! - .0000246) < 1e-12);
  const half = { ...row, byModel: row.byModel!.slice(0, 1) };
  assert.equal(aggregateModelSpend([half], NIGHT, NIGHT).usd, costEntryWorstCaseUsd(half));
  const partialRow = { ...row, byModel: [share("haiku"), share("unknown-served")] };
  const partial = aggregateModelSpend([partialRow], NIGHT, NIGHT);
  assert.equal(partial.usd, costEntryWorstCaseUsd(partialRow));
  assert.equal(partial.worstCaseCharges, 1);
  assert.ok(Math.abs(partial.knownUsd - .0000006) < 1e-12, "an unknown second tier cannot erase the first tier's recorded price");
});

test("unknown ASK, Scout and error bills retain measured dollars and are counted at worst case", () => {
  for (const row of [
    { ...cost(null, NIGHT), role: "ASK" as const, source: "api.anthropic.com", model: "haiku", cost: { ...cost(null, NIGHT).cost, inputTokens: null, outputTokens: null } },
    { ...cost(null, NIGHT), role: "SCOUT" as const, cost: { ...cost(null, NIGHT).cost, inputTokens: null, outputTokens: null } },
    { ...cost(null, NIGHT), role: "ASK" as const, model: "unknown-served", resultKind: "NO_DISPOSITION" },
  ]) {
    const rows = [cost(3, NIGHT), row];
    const fleet = aggregateModelSpend(rows, NIGHT, NIGHT);
    assert.equal(fleet.usd, 3 + costEntryWorstCaseUsd(row));
    assert.equal(fleet.knownUsd, 3);
    assert.equal(fleet.worstCaseCharges, 1);
    const research = researchSpendInWindow(priced(rows), NIGHT);
    assert.equal(research.windowUsd, fleet.usd);
    assert.equal(research.knownUsd, 3);
    assert.equal(fundedController({ now: NIGHT, charges: priced(rows) }).admissionSpendUsd(), fleet.usd);
    assert.ok(researchPaidWorkerCapacity({ modelEnabled: true, spentUsd: research.windowUsd, ceilingUsd: 100, requestUsd: .1 }) > 0,
      "one unpriced charge no longer closes paid capacity: the dial keeps control");
  }
  assert.equal(researchPaidWorkerCapacity({ modelEnabled: true, spentUsd: Infinity, ceilingUsd: 100, requestUsd: .1 }), 0);
  assert.equal(researchPaidWorkerCapacity({ modelEnabled: false, spentUsd: 0, ceilingUsd: 100, requestUsd: .1 }), 0);
  assert.equal(researchPaidWorkerCapacity({ modelEnabled: true, spentUsd: 1, ceilingUsd: 100, requestUsd: .1, readyWork: 20, requestsPerMinute: 50 }), 20);
});

test("historical Ask provider maxima bound missing usage and unknown served ids without inventing measured dollars", () => {
  const base: CostEntry = { ...cost(null, NIGHT), role: "ASK", source: "api.anthropic.com", routeId: "ask:grounded", model: "haiku" };
  const missing = Array.from({ length: 4 }, (_, index) => ({ ...base, attemptId: `missing-${index}`,
    cost: { ...base.cost, inputTokens: null, outputTokens: null, requestCount: 1 } }));
  const served = Array.from({ length: 12 }, (_, index) => ({ ...base, attemptId: `served-${index}`, model: "unknown-served",
    cost: { ...base.cost, inputTokens: 1, outputTokens: 1, requestCount: 1 } }));
  const rows = [cost(3, NIGHT), ...missing, ...served];
  const before = JSON.stringify(rows);
  const aggregate = aggregateModelSpend(rows, NIGHT, NIGHT);
  assert.ok(Math.abs(aggregate.usd! - 45.240336) < 1e-9);
  assert.equal(aggregate.knownUsd, 3);
  assert.equal(aggregate.measured, 1);
  assert.equal(aggregate.unmeasured, 16);
  const research = researchSpendInWindow(priced(rows), NIGHT);
  assert.equal(research.windowUsd, aggregate.usd);
  assert.equal(fundedController({ now: NIGHT, charges: priced(rows) }).admissionSpendUsd(), aggregate.usd);
  assert.equal(researchPaidWorkerCapacity({ modelEnabled: true, spentUsd: research.windowUsd,
    ceilingUsd: 100, requestUsd: .1, readyWork: 20, requestsPerMinute: 50 }), 20);
  assert.equal(JSON.stringify(rows), before, "a scheduling bound never rewrites the historical bill");
  const noMaximum = { ...base, model: "unknown-served", cost: missing[0]!.cost };
  assert.equal(aggregateModelSpend([noMaximum], NIGHT, NIGHT).usd, costEntryWorstCaseUsd(noMaximum),
    "missing usage and an unknown requested tier have no provider maximum, so the worst case is counted");
});

test("an actual request maximum bounds an unmetered bill and rejects incomplete maximum metadata", () => {
  const row: CostEntry = { ...cost(null, NIGHT), role: "ASK", source: "api.anthropic.com", model: "unknown-served",
    requestedModel: "haiku", cost: { ...cost(null, NIGHT).cost, inputTokens: null, outputTokens: null, requestCount: 1 },
    modelRequestBound: { model: "haiku", inputTokens: 5000, outputTokens: 1024, usd: 0,
      basis: "REQUEST_UTF8_BYTES", measured: false } };
  const priced = aggregateModelSpend([row], NIGHT, NIGHT);
  assert.ok(Math.abs(priced.usd! - .001512) < 1e-15, "counts and central rates determine the maximum, not a supplied dollar value");
  assert.equal(priced.knownUsd, 0);
  assert.equal(priced.unmeasured, 1);
  assert.equal(aggregateModelSpend([{ ...row, role: "PARSER", source: null, model: null }], NIGHT, NIGHT).usd, priced.usd,
    "recorded requested identity and send bounds keep an otherwise tokenless model bill in the total");
  for (const bad of [
    { ...row, modelRequestBound: { ...row.modelRequestBound!, inputTokens: -1 } },
    { ...row, requestedModel: "opus" },
    { ...row, cost: { ...row.cost, requestCount: 2 } }, // one request maximum cannot cover an additional unmetered send
  ]) {
    const out = aggregateModelSpend([bad], NIGHT, NIGHT);
    assert.equal(out.usd, costEntryWorstCaseUsd(bad), "incomplete maximum metadata is counted at worst case");
    assert.equal(out.worstCaseCharges, 1);
  }
});

test("an explicit hold identity covers mixed tiers and different attempt ids once", () => {
  const base = cost(null, NIGHT);
  const row: CostEntry = { ...base, role: "SCOUT", attemptId: "different-attempt", spendHoldJobId: "actual-job",
    cost: { ...base.cost, inputTokens: 2, outputTokens: 2, requestCount: 2 }, byModel: [
      { ...base.cost, model: "haiku", inputTokens: 1, outputTokens: 1, requestCount: 1, usd: 2 },
      { ...base.cost, model: "unknown-served", inputTokens: 1, outputTokens: 1, requestCount: 1, usd: null },
    ] };
  const hold: SpendHold = { holdId: "actual-job#0", jobId: "actual-job", obligationId: "ob", keys: [], usd: 6,
    heldAt: NIGHT, what: "actual multi-tier job maximum", settled: null };
  const out = aggregateModelSpend([row, { ...row, attemptId: "another-attempt", byModel: undefined,
    cost: { ...base.cost, inputTokens: null, outputTokens: null } }], NIGHT, NIGHT, [hold, hold]);
  assert.equal(out.usd, 6);
  assert.equal(out.knownUsd, 2);
  assert.equal(out.unmeasured, 2);
  const unheld = { ...row, spendHoldJobId: undefined };
  assert.equal(aggregateModelSpend([unheld], NIGHT, NIGHT, [hold]).usd, Math.max(2, costEntryWorstCaseUsd(unheld)));
  assert.equal(aggregateModelSpend([row], NIGHT, NIGHT, [{ ...hold, jobId: "another-job" }]).usd, Math.max(2, costEntryWorstCaseUsd(row)));
});

test("an exact standing job hold covers tokenless rows once without charging measured dollars twice", () => {
  const hold: SpendHold = { holdId: "job#0", jobId: "job", obligationId: "ob", keys: [], usd: 5, heldAt: NIGHT, what: "actual job maximum", settled: null };
  const unknown = { ...cost(null, NIGHT), attemptId: "job", role: "SCOUT" as const,
    cost: { ...cost(null, NIGHT).cost, inputTokens: null, outputTokens: null } };
  const rows = [{ ...cost(2, NIGHT), attemptId: "job" }, unknown, unknown];
  const fleet = aggregateModelSpend(rows, NIGHT, NIGHT, [hold, hold]);
  assert.equal(fleet.usd, 5);
  assert.equal(fleet.knownUsd, 2);
  assert.equal(researchSpendInWindow(priced(rows), NIGHT, 24, [hold]).windowUsd, 5);
  const uncovered = 2 + 2 * costEntryWorstCaseUsd(unknown);
  assert.equal(aggregateModelSpend(rows, NIGHT, NIGHT, [{ ...hold, jobId: "same-obligation-other-attempt" }]).usd, uncovered);
  assert.equal(aggregateModelSpend(rows, NIGHT, NIGHT, [{ ...hold, settled: { usd: 0, costRecordedAt: NIGHT } }]).usd, 5);
  assert.equal(aggregateModelSpend([{ ...cost(2, NIGHT), attemptId: "job" }], NIGHT, NIGHT,
    [{ ...hold, settled: { usd: 2, costRecordedAt: NIGHT } }]).usd, 2, "a priced job uses its actual spend after settlement");
  assert.equal(aggregateModelSpend(rows, NIGHT, NIGHT, [{ ...hold, heldAt: "2026-09-04T00:00:00Z" }]).usd, uncovered);
  assert.equal(aggregateModelSpend(rows, NIGHT, NIGHT, [{ ...hold, usd: 1 }]).usd, uncovered, "a hold smaller than known job spend cannot cover another unknown bill");
  assert.equal(aggregateModelSpend([cost(2, NIGHT)], NIGHT, NIGHT, [hold]).usd, 2, "an unrelated hold has no recorded model identity");
});

test("failed provider sends keep their maximum committed and settlement cannot charge it twice", () => {
  const controller = fundedController({ now: NIGHT, charges: [], rollingCeilingUsd: 1, clock: () => Date.parse(NIGHT) });
  const reservation = controller.reserveModelRequest("anthropic", "provider-error", REQUEST);
  controller.failModelRequest(reservation, new ModelTransportError("bad request", 400), NIGHT);
  controller.failModelRequest(reservation, new ModelTransportError("bad request", 400), NIGHT);
  assert.equal(controller.admissionSpendUsd(), modelRequestWorstCaseUsd(REQUEST));
  assert.equal(controller.snapshot(NIGHT).cycle.modelUsd, null);
  assert.throws(() => controller.reserveModelRequest("anthropic", "another", REQUEST), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING");
});

test("the reserved request maximum covers one-hour cache writes and refuses an unreadable maximum", () => {
  const request: ModelRequest = { ...REQUEST, max_tokens: 0, cache_control: { type: "ephemeral", ttl: "1h" } };
  assert.equal(modelRequestWorstCaseUsd(request), Buffer.byteLength(JSON.stringify(request)) * 4 * 2 / 1_000_000);
  assert.equal(modelRequestWorstCaseUsd({ ...REQUEST, max_tokens: NaN }), null);
});

test("paid capacity observes a provider backoff expiry during the same cycle", async () => {
  let time = Date.parse(NIGHT), calls = 0;
  const safety = fundedController({ now: NIGHT, charges: [], clock: () => time });
  const transport = safety.guardedModelTransport("anthropic", "held-obligation", async () => {
    calls++;
    if (calls === 1) throw new ModelTransportError("rate limited", 429, 20 * 60_000);
    return RESPONSE;
  });
  await assert.rejects(transport(REQUEST), ModelTransportError);
  time += 20 * 60_000 - 1;
  assert.equal(safety.snapshot().providerCircuits.length, 1);
  await assert.rejects(transport(REQUEST), error => error instanceof FleetSafetyRefusal && error.code === "PROVIDER_CIRCUIT_BROKEN");
  assert.equal(calls, 1);
  time++;
  assert.equal(safety.snapshot().providerCircuits.length, 0, "the capacity reader sees the existing cooldown expire");
  await transport(REQUEST);
  assert.equal(calls, 2);
  assert.ok(safety.admissionSpendUsd() >= modelRequestWorstCaseUsd(REQUEST)!, "the first send's conservative charge survives recovery");
});

test("requests and dispatches keep running across days without a cycle wall", () => {
  const nowMs = Date.parse(NIGHT);
  const requests = fundedController({ now: NIGHT, charges: [], clock: () => nowMs });
  // No per-cycle request cap.
  for (let i = 0; i < 100; i += 1) requests.admitProviderRequest("public-web", `request-${i}`);
  assert.equal(requests.snapshot(NIGHT).cycle.requests, 100);

  // No per-cycle payload total.
  const bytes = fundedController({ now: NIGHT, charges: [], clock: () => nowMs });
  bytes.recordInboundBytes("large-response", 64 * 1024 * 1024);
  bytes.recordInboundBytes("more", 1);
  assert.equal(bytes.snapshot(NIGHT).cycle.payloadBytes, 64 * 1024 * 1024 + 1);

  const dispatch = fundedController({ now: NIGHT, charges: [], clock: () => nowMs });
  // No per-cycle dispatch cap.
  for (let i = 0; i < 100; i += 1) assert.equal(dispatch.admitDispatch(`dispatch-${i}`).admit, true);
  assert.equal(dispatch.snapshot(NIGHT).cycle.dispatches, 100);

  let clock = nowMs;
  const wall = fundedController({ now: NIGHT, charges: [], clock: () => clock });
  clock += 24 * 60 * 60_000;
  assert.equal(wall.admitDispatch("wall-deferred").admit, true);
  assert.equal(wall.snapshot(new Date(clock).toISOString()).deferred.length, 0);
});

test("the guarded fetch fails loud on a truncated 206 rather than handing up a partial document", async () => {
  const cap = FLEET_SAFETY_BOUNDS.maxDownloadBytes;
  for (const kind of ["text", "bytes"] as const) {
    const controller = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
    const open = async (work: string, fetcher: typeof fetch) => {
      const input = { url: `https://${work}.test/document`, headers: { accept: "text/html", "user-agent": "Meanwhile" }, timeoutMs: 1_000 };
      if (kind === "text") return controller.guardedOpenOne("public-web", work, fetcher)({ ...input, method: "GET" });
      const result = await controller.guardedOpenBytes("public-web", work, fetcher)(input);
      return { ...result, bytes: result.bytes.byteLength };
    };
    const ordinary = await open("ordinary", async (_url, init) => {
      const headers = new Headers(init?.headers);
      assert.deepEqual([...headers.entries()], [["accept", "text/html"], ["user-agent", "Meanwhile"]],
        `${kind}: the shared transport preserves the caller's exact headers`);
      // Some publishers answer an unsolicited range with an unusable 206.
      return headers.has("range") ? new Response("part", { status: 206 }) : new Response("whole", { status: 200 });
    });
    assert.equal(ordinary.status, 200, `${kind}: the ordinary request receives the complete document`);
    assert.equal(ordinary.bytes, 5);

    for (const total of [null, cap * 4]) {
      const truncated = await open(`truncated-${total}`, async () => new Response(new Uint8Array(1024), {
        status: 206,
        headers: { ...(total === null ? {} : { "content-range": `bytes 0-1023/${total}` }), "content-length": "1024" },
      }));
      assert.equal(truncated.status, null, `${kind}: an unsolicited incomplete 206 remains refused`);
      assert.equal(truncated.bytes, 0);
      assert.equal(controller.snapshot(NIGHT).deferred.at(-1)?.code, "PAYLOAD_BYTE_CEILING");
    }
    const complete = await open("complete", async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 206, headers: { "content-range": "bytes 0-2/3", "content-length": "3" },
    }));
    assert.equal(complete.status, 206);
    assert.equal(complete.bytes, 3);

    let declaredCancelled = false;
    const declared = await open("declared-overflow", async () => new Response(new ReadableStream<Uint8Array>({
      cancel() { declaredCancelled = true; },
    }), { headers: { "content-length": String(cap + 1) } }));
    assert.equal(declared.status, null);
    assert.equal(declared.bytes, 0);
    assert.equal(declaredCancelled, true, `${kind}: oversized declared bodies are cancelled before reading`);

    let streamedCancelled = false;
    let chunks = 0;
    const streamed = await open("stream-overflow", async () => new Response(new ReadableStream<Uint8Array>({
      pull(stream) { stream.enqueue(new Uint8Array(chunks++ === 0 ? cap : 1)); },
      cancel() { streamedCancelled = true; },
    })));
    assert.equal(streamed.status, null);
    assert.equal(streamed.bytes, 0);
    assert.match(streamed.transportError ?? "", /streamed response exceeded/);
    assert.equal(streamedCancelled, true, `${kind}: the streaming cap still cancels and discards an overflow without Content-Length`);
  }
});

test("the guarded byte fetch answers the first hop with its location when asked not to follow, and follows by default", async () => {
  const controller = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
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
  const controller = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
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
  const quotaController = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
  const quotaGuard = quotaController.guardedModelTransport("anthropic", "quota-work", async () => {
    quotaCalls += 1;
    throw new Error("account quota exhausted");
  });
  await assert.rejects(() => quotaGuard(REQUEST), /quota exhausted/);
  await assert.rejects(() => quotaGuard(REQUEST), /PROVIDER_CIRCUIT_BROKEN/);
  assert.equal(quotaCalls, 1);
  assert.deepEqual(quotaController.snapshot(NIGHT).providerCircuits[0]?.workDeferred, ["quota-work"]);

  // generic 402 history survives eligibility and restart, doubles to six hours, and respects Retry-After
  await (async () => {
  let time = Date.parse(NIGHT), calls = 0;
  let controller = fundedController({ now: NIGHT, charges: [], clock: () => time });
  for (let attempt = 1; attempt <= 8; attempt++) {
    const started = time;
    const retryAfter = attempt === 8 ? 8 * 3_600_000 : null;
    await assert.rejects(controller.guardedModelTransport("anthropic", "work", async () => {
      calls++;
      throw new ModelTransportError("Denied", 402, retryAfter);
    })(REQUEST), /Denied/);
    const circuit = controller.snapshot().providerCircuits[0];
    assert.equal(circuit.failureClass, "HARD", "the actual status carries HARD even without billing words");
    assert.equal(circuit.consecutiveFailures, attempt);
    assert.equal(circuit.firstObservedAt, NIGHT);
    assert.equal(circuit.lastObservedAt, new Date(started).toISOString());
    const minutes = Math.min(360, 15 * 2 ** (attempt - 1));
    assert.equal(Date.parse(circuit.eligibleAt) - started, Math.max(minutes * 60_000, retryAfter ?? 0));
    time = Date.parse(circuit.eligibleAt);
    const saved = JSON.parse(JSON.stringify(controller.snapshot().providerCircuits));
    assert.equal(saved.length, 1, "eligibility retains failure history");
    assert.equal(controller.snapshot().status, "ACTIVE");
    controller = fundedController({ now: new Date(time).toISOString(), charges: [], clock: () => time, circuits: saved });
    assert.equal(controller.snapshot().providerCircuits[0].consecutiveFailures, attempt);
  }
  assert.equal(calls, 8);
  for (const status of [503, 402]) {
    await assert.rejects(controller.guardedModelTransport("anthropic", "changed-provider-error", async () => {
      calls++; throw new ModelTransportError("Denied", status);
    })(REQUEST));
    const retained = controller.snapshot().providerCircuits[0];
    assert.equal(retained.failureClass, "HARD", "a transient recovery failure cannot discard billing history");
    assert.equal(retained.consecutiveFailures, calls);
    assert.equal(Date.parse(retained.eligibleAt) - time, 6 * 3_600_000);
    time = Date.parse(retained.eligibleAt);
    controller = fundedController({ now: new Date(time).toISOString(), charges: [], clock: () => time,
      circuits: JSON.parse(JSON.stringify(controller.snapshot().providerCircuits)) });
  }
})();

  // one eligible HARD recovery settles before its siblings; successful recovery restores healthy concurrency
  await (async () => {
  let time = Date.parse(NIGHT), calls = 0;
  const controller = fundedController({ now: NIGHT, charges: [], clock: () => time });
  controller.latchProvider("anthropic", "billing disabled", "earlier-work", NIGHT);
  time += 15 * 60_000;
  let release!: () => void, started!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const failed = controller.guardedModelTransport("anthropic", "recovery", async () => {
    calls++; started(); await barrier;
    throw new ModelTransportError("Denied", 402);
  });
  const settled = Promise.allSettled(Array.from({ length: 20 }, () => failed(REQUEST)));
  await entered;
  assert.equal(calls, 1);
  release();
  assert.ok((await settled).every(value => value.status === "rejected"));
  assert.equal(calls, 1, "the other nineteen requests never reach the provider");
  assert.equal(controller.snapshot().providerCircuits[0].consecutiveFailures, 2);
  time += 30 * 60_000;
  let live = 0, peak = 0;
  const healthy = controller.guardedModelTransport("anthropic", "recovered", async () => {
    calls++; live++; peak = Math.max(peak, live);
    await new Promise<void>(resolve => setImmediate(resolve));
    live--; return RESPONSE;
  });
  await Promise.all(Array.from({ length: 20 }, () => healthy(REQUEST)));
  assert.equal(calls, 21);
  assert.ok(peak > 1, "the successful probe releases healthy workers to run concurrently");
  assert.equal(controller.snapshot().providerCircuits.length, 0);
  for (const responseKind of ["malformed", "unmetered"] as const) {
    const recovering = fundedController({ now: NIGHT, charges: [], clock: () => time });
    recovering.latchProvider("anthropic", "billing disabled", "prior", new Date(time).toISOString());
    time += 15 * 60_000;
    let sends = 0;
    const raw = anthropicTransport("mock-fixture-key", async () => {
      sends++;
      return new Response(responseKind === "malformed" ? "invalid JSON" : JSON.stringify({ ...RESPONSE, usage: {} }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    const actualGuard = recovering.guardedModelTransport("anthropic", "recovering", raw);
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => actualGuard(REQUEST)));
    assert.equal(sends, 1, `${responseKind}: the actual Messages decoder/settler fails one probe only`);
    assert.equal(outcomes.filter(outcome => outcome.status === "rejected" && outcome.reason instanceof FleetSafetyRefusal &&
      outcome.reason.code === "PROVIDER_CIRCUIT_BROKEN").length, 19);
    const history = recovering.snapshot().providerCircuits[0];
    assert.equal(history.failureClass, "HARD");
    assert.equal(history.consecutiveFailures, 2);
    assert.equal(Date.parse(history.eligibleAt) - time, 30 * 60_000);
    assert.equal(recovering.admissionSpendUsd(), modelRequestWorstCaseUsd(REQUEST));
    const healthyOther = fundedController({ now: NIGHT, charges: [], clock: () => time });
    await assert.rejects(healthyOther.guardedModelTransport("anthropic", "healthy-other", raw)(REQUEST));
    assert.equal(healthyOther.snapshot().providerCircuits.length, 0, "healthy OTHER handling is unchanged");
  }
})();

  // an older same-provider success cannot erase a newer HARD failure
  await (async () => {
  const controller = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
  let release!: () => void, started!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const earlier = controller.guardedModelTransport("anthropic", "earlier", async () => {
    started(); await barrier; return RESPONSE;
  })(REQUEST);
  await entered;
  await assert.rejects(controller.guardedModelTransport("anthropic", "later", async () => {
    throw new ModelTransportError("Denied", 402);
  })(REQUEST));
  release(); await earlier;
  controller.recordSuccessfulActivity(NIGHT);
  assert.equal(controller.snapshot().providerCircuits[0].failureClass, "HARD");
  let time = Date.parse(NIGHT);
  const retained = fundedController({ now: NIGHT, charges: [], clock: () => time });
  retained.latchProvider("anthropic", "billing disabled", "initial", NIGHT);
  time += 15 * 60_000;
  let releaseProbe!: () => void, enteredProbe!: () => void;
  const probeBarrier = new Promise<void>(resolve => { releaseProbe = resolve; });
  const probeEntered = new Promise<void>(resolve => { enteredProbe = resolve; });
  const probe = retained.guardedModelTransport("anthropic", "probe", async () => {
    enteredProbe(); await probeBarrier; return RESPONSE;
  })(REQUEST);
  await probeEntered;
  retained.latchProvider("anthropic", "a newer billing refusal", "newer-failure", new Date(time).toISOString(), null, "HARD");
  releaseProbe(); await probe;
  assert.equal(retained.snapshot().providerCircuits[0].consecutiveFailures, 2, "a successful older generation cannot erase a newer failure");
})();

  // a Messages request waiting in the actual rate queue rechecks the live Fleet circuit before sending
  await (async () => {
  let time = Date.parse(NIGHT), calls = 0;
  const controller = fundedController({ now: NIGHT, charges: [], clock: () => time });
  const queue = new ModelProviderQueue({ now: () => time, sleep: async ms => {
    time += ms; await new Promise<void>(resolve => setImmediate(resolve));
  } });
  const guarded = queue.transport(controller.guardedModelTransport("anthropic", "queued", async () => {
    calls++; throw new ModelTransportError("Denied", 402);
  }));
  const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => guarded(REQUEST)));
  assert.equal(calls, 1);
  assert.ok(outcomes.every(value => value.status === "rejected"));
  assert.equal(controller.admissionSpendUsd(), modelRequestWorstCaseUsd(REQUEST), "queued refusals reserve and consume no paid spend");
})();

  // byte recovery belongs to the actual source and clears only its accepted complete response
  await (async () => {
  let time = Date.parse(NIGHT), calls = 0;
  const controller = fundedController({ now: NIGHT, charges: [], clock: () => time });
  const fetcher: typeof fetch = async url => {
    calls++;
    return String(url).includes("broken.gov") ? new Response("Denied", { status: 402, headers: { "retry-after": "1200" } })
      : new Response("a complete public document");
  };
  const opened = controller.guardedOpenBytes("public-web", "byte-work", fetcher);
  assert.equal((await opened({ url: "https://broken.gov/page", headers: {}, timeoutMs: 1000 })).status, 402);
  const circuit = controller.snapshot().providerCircuits[0];
  assert.equal(circuit.provider, "https://broken.gov");
  assert.equal(circuit.failureClass, "HARD");
  assert.equal(Date.parse(circuit.eligibleAt) - time, 20 * 60_000);
  assert.equal((await opened({ url: "https://other.gov/page", headers: {}, timeoutMs: 1000 })).status, 200);
  assert.equal(controller.snapshot().providerCircuits.length, 1, "an unrelated host cannot clear the source refusal");
  assert.equal((await opened({ url: "https://broken.gov/page", headers: {}, timeoutMs: 1000 })).status, null);
  assert.equal(calls, 2);
  time += 20 * 60_000;
  const recovered = controller.guardedOpenBytes("public-web", "byte-recovery", async () => new Response("full document"));
  assert.equal((await recovered({ url: "https://broken.gov/page", headers: {}, timeoutMs: 1000 })).status, 200);
  assert.equal(controller.snapshot().providerCircuits.length, 0);
  for (const failure of ["503", "malformed", "network", "partial", "partial-transport"] as const) {
    const subject = "https://api.wikimedia.org";
    const retrying = fundedController({ now: NIGHT, charges: [], clock: () => time });
    retrying.latchProvider(subject, "billing disabled", "prior", new Date(time).toISOString());
    time += 15 * 60_000;
    let attempts = 0;
    const failedFetch: typeof fetch = async () => {
      attempts++;
      if (failure === "network") throw new Error("network timeout");
      if (failure === "partial-transport") return new Response(new ReadableStream({
        start(stream) { stream.error(new Error("network timeout")); },
      }), { status: 206, headers: { "content-range": "bytes 0-19/20" } });
      return new Response("not JSON", { status: failure === "503" ? 503 : failure === "partial" ? 206 : 200 });
    };
    const outcomes = await Promise.all(Array.from({ length: 20 }, (_, i) => retrying.guardedOpenBytes("public-web", `retry-${i}`, failedFetch)({
      url: `${subject}/core/v1/wikipedia/en/search/page?q=mock`, headers: {}, timeoutMs: 1000,
    })));
    assert.equal(attempts, 1, `${failure}: nineteen siblings send nothing after the actual failed probe`);
    assert.equal(outcomes.filter(outcome => /PROVIDER_CIRCUIT_BROKEN/.test(outcome.transportError ?? "")).length, 19);
    const history = retrying.snapshot().providerCircuits[0];
    assert.equal(history.failureClass, "HARD");
    assert.equal(history.consecutiveFailures, 2);
    assert.equal(Date.parse(history.eligibleAt) - time, 30 * 60_000);
    time += 30 * 60_000;
    assert.equal(retrying.snapshot().providerCircuits.length, 1, "failed recovery history survives the next eligibility");
  }
  const oversized = fundedController({ now: NIGHT, charges: [], clock: () => time });
  oversized.latchProvider("https://oversized.gov", "billing disabled", "prior", new Date(time).toISOString());
  time += 15 * 60_000;
  const tooLarge = oversized.guardedOpenBytes("public-web", "complete-oversized", async () => new Response("large document", {
    headers: { "content-length": String(FLEET_SAFETY_BOUNDS.maxDownloadBytes + 1) },
  }));
  assert.equal((await tooLarge({ url: "https://oversized.gov/large", headers: {}, timeoutMs: 1000 })).status, null);
  assert.equal(oversized.snapshot().providerCircuits[0].consecutiveFailures, 1, "a complete oversized response is a local cap refusal, not another provider failure");
  assert.equal(Date.parse(oversized.snapshot().providerCircuits[0].eligibleAt), time);
})();
});

test("public redirects are counted as separate provider requests under one byte ceiling", async () => {
  let calls = 0;
  const controller = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
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

  // eligible text and byte recovery release completed redirect sources before waiting on each other
  await (async () => {
  let time = Date.parse(NIGHT), calls = 0;
  const controller = fundedController({ now: NIGHT, charges: [], clock: () => time });
  for (const host of ["a.gov", "b.gov"]) controller.latchProvider(`https://${host}`, "billing disabled", "prior", NIGHT);
  time += 15 * 60_000;
  const fetcher: typeof fetch = async input => {
    calls++;
    const url = new URL(String(input));
    if (url.pathname === "/start") return new Response("redirect", { status: 302,
      headers: { location: `https://${url.hostname === "a.gov" ? "b.gov" : "a.gov"}/end` } });
    return new Response("a complete document");
  };
  const [text, bytes] = await Promise.all([
    controller.guardedOpenOne("public-web", "text", fetcher)({ url: "https://a.gov/start", method: "GET", headers: {}, timeoutMs: 1000 }),
    controller.guardedOpenBytes("public-web", "bytes", fetcher)({ url: "https://b.gov/start", headers: {}, timeoutMs: 1000 }),
  ]);
  assert.equal(text.status, 200);
  assert.equal(bytes.status, 200);
  assert.equal(calls, 4);
  assert.equal(controller.snapshot().providerCircuits.length, 0);
})();
});

test("an in-flight public read reserves only a bounded slice, so another source still proceeds", async () => {
  const controller = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
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
  const secondResult = await second({ url: "https://other.test/two", method: "GET", headers: {}, timeoutMs: 1_000 });
  assert.equal(secondResult.status, 200);
  assert.equal(secondResult.body, "two");
  assert.equal(secondCalls, 1);
  release();
  assert.equal((await firstPending).status, 200);
  assert.equal(firstCalls, 1);
  assert.equal(controller.snapshot(NIGHT).cycle.payloadBytes, 6);
});

test("a Scout model request is admitted while a public read is in flight (the turn-0 abort, fixed)", async () => {
  const controller = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const read = controller.guardedOpenOne("public-web", "deterministic-read", async () => {
    await gate;
    return new Response("body", { status: 200 });
  });
  const pending = read({ url: "https://example.test/big", method: "GET", headers: {}, timeoutMs: 1_000 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  // The deterministic read holds its bounded reservation; a concurrent Scout model request must not be refused for payload bytes before its first turn.
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
  const controller = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
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
    return open({ url: `https://${work}.test/scout`, method: "GET", headers: {}, timeoutMs: 1_000 });
  };
  const a = holdOpen("scout-read-a");
  const b = holdOpen("scout-read-b");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const big = controller.guardedOpenOne("public-web", "nh-cfs-filing-entity-details", async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('range'), null);
    return new Response(new Uint8Array(9_396_218), { status: 200 });
  });
  const large = await big({ url: "https://example.test/nh-cfs", method: "GET", headers: {}, timeoutMs: 1_000 });
  assert.equal(large.bytes, 9_396_218);
  assert.equal(large.transportError, null);
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
    const controller = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
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

  const controller = fundedController({ now: during, charges: [], clock: () => Date.parse(during) });
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
  const active = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
  assert.equal(runnerStanding(beat, [], NIGHT, active.snapshot(NIGHT)).state, "ACTIVE");
  const blackoutAt = "2026-09-06T02:00:00.000Z";
  const blackout = fundedController({ now: blackoutAt, charges: [], clock: () => Date.parse(blackoutAt) });
  assert.equal(runnerStanding({ ...beat, beatAt: blackoutAt }, [], blackoutAt, blackout.snapshot(blackoutAt)).state, "ACTIVE");
  const broken = fundedController({ now: NIGHT, charges: [], clock: () => Date.parse(NIGHT) });
  broken.latchProvider("anthropic", "quota exhausted", "owed-work", NIGHT);
  assert.equal(runnerStanding(beat, [], NIGHT, broken.snapshot(NIGHT)).state, "CIRCUIT BROKEN");
  const paused = fundedController({ now: NIGHT, charges: [], paused: true, clock: () => Date.parse(NIGHT) });
  assert.equal(runnerStanding(beat, [], NIGHT, paused.snapshot(NIGHT)).state, "PAUSED");
});

test('HTTP provider outage backs off concurrent subjects, survives restart and releases on expiry', async () => {
  let time = Date.parse(NIGHT), calls = 0;
  const controller = fundedController({now:NIGHT,charges: [],clock:()=>time});
  const input = (q: string) => ({url:'https://api.marginalia.nu/public/search/'+q,method:'GET' as const,headers:{},timeoutMs:1000});
  const failed: typeof fetch = async (_url, init) => { calls++; assert.equal(new Headers(init?.headers).get('range'),null);
    return new Response('gateway timeout',{status:504,headers:{'retry-after':'1200'}}); };
  const responses = await Promise.all(Array.from({length:20},(_,i)=>controller.guardedOpenOne('public-web','candidate-'+i,failed)(input(String(i)))));
  // A healthy source runs up to the in-flight cap (8); the first failure holds every request still queued.
  assert.equal(calls,8);
  assert.equal(responses.reduce((n,r)=>n+(r.requestCount??0),0),8);
  assert.ok(responses.slice(0,8).every(r=>r.status===504));
  assert.ok(responses.slice(8).every(r=>r.requestCount===0 && /latched/.test(r.transportError??'')));
  const circuits=controller.snapshot().providerCircuits;
  assert.equal(circuits.length,1);assert.equal(circuits[0].provider,'https://api.marginalia.nu');
  const restarted=fundedController({now:NIGHT,charges: [],clock:()=>time,circuits});
  const blocked=await restarted.guardedOpenOne('public-web','later',failed)(input('later'));
  assert.equal(blocked.requestCount,0);assert.equal(calls,8);
  const healthy: typeof fetch=async()=>new Response('{"pages":[{"id":1}]}',{status:200});
  const other=await restarted.guardedOpenOne('public-web','other',healthy)({...input('other'),url:'https://api.wikimedia.org/core/v1/wikipedia/en/search/page?q=other'});
  assert.equal(other.status,200);
  time+=20*60000;
  const recovered=await restarted.guardedOpenOne('public-web','recovered',async()=>new Response('{"license":"CC","results":[{"url":"https://example.gov"}]}'))(input('recovered'));
  assert.equal(recovered.status,200);assert.equal(restarted.snapshot().providerCircuits.length,0);
});

test('partial, malformed and transport failures latch the source without ingesting empty civic facts', async () => {
  for(const [url,fetcher] of [
    ['https://api.wikimedia.org/core/v1/wikipedia/en/search/page?q=x',async()=>new Response('{"pages":[]}',{status:206})],
    ['https://api.marginalia.nu/public/search/x',async()=>new Response('<html>Service unavailable</html>',{status:200})],
    ['https://api.marginalia.nu/public/search/y',async()=>{throw new Error('connection reset');}],
  ] as const){
    const controller=fundedController({now:NIGHT,charges: [],clock:()=>Date.parse(NIGHT)});
    const first=await controller.guardedOpenOne('public-web','first',fetcher)({url,method:'GET',headers:{},timeoutMs:1000});
    assert.equal(first.requestCount,1);
    assert.equal(controller.snapshot().providerCircuits.length,1,JSON.stringify({url,first}));
    const second=await controller.guardedOpenOne('public-web','second',fetcher)({url,method:'GET',headers:{},timeoutMs:1000});
    assert.equal(second.requestCount,0);
  }
});

test('a complete empty search is a query miss and does not disable the provider for other people', async()=>{
  const controller=fundedController({now:NIGHT,charges: [],clock:()=>Date.parse(NIGHT)});
  const result=await controller.guardedOpenOne('public-web','no-match',async()=>new Response('{"pages":[]}'))({url:'https://api.wikimedia.org/core/v1/wikipedia/en/search/page?q=unknown',method:'GET',headers:{},timeoutMs:1000});
  assert.equal(result.status,200);assert.equal(controller.snapshot().providerCircuits.length,0);
});

test('website size thresholds apply to the requested publisher, including unknown and invalid sizes', async () => {
  const { websiteRequestLimit } = await import('../lib/control-plane/scheduler/host-supervision.ts');
  assert.equal(websiteRequestLimit({kind:'local-government',population:9999}),10);
  assert.equal(websiteRequestLimit({kind:'school-district',students:4999}),10);
  for (const count of [10000, NaN, Infinity, -1, undefined, null])
    assert.equal(websiteRequestLimit({kind:'local-government',population:count}),null);
  for (const count of [5000, NaN, Infinity, -1, undefined, null])
    assert.equal(websiteRequestLimit({kind:'school-district',students:count}),null);
  for (const kind of ['state','federal','national'] as const)
    assert.equal(websiteRequestLimit({kind,population:1,students:1}),null);
  assert.equal(websiteRequestLimit(),null);
});

test('parent HTTP shares ten held small-publisher requests across text and byte tools; other websites keep going', async t => {
  const small='https://small.example.gov', census='https://tigerweb.geo.census.gov';
  const root=mkdtempSync(join(tmpdir(),'s8-parent-publisher-'));
  t.after(()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});});
  const path=join(root,'data/states/az/reference/publisher-sizes.jsonl');
  mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,JSON.stringify({state:'az',host:'small.example.gov',censusId:'000001',kind:'school-district',students:4999,
    source:{url:'https://census.gov/test-fixture',dataset:'TEST FIXTURE'}}));
  const websiteSize=websiteSizeFromHoldings(['AZ','az','nm'],root);
  const controller=fundedController({now:NIGHT,charges: [],websiteSize});
  let calls=0;
  const vault=new MemoryEvidenceStore();
  const store={pacing:memoryWebsitePacing(),withLease: async <T,>(_key: string, operation: () => Promise<T>) => operation(),read:async()=>null,readRequestPlan:async()=>({calendar:[],documents:{}}),saveRequestGroup:async()=>{},record:async()=>{}};
  const fetcher:typeof fetch=(input,init)=>runWithSourceFetch({vault,runtime:{store,transport:async()=>{calls++;return new Response('complete');}}},()=>fetchSource(input,init));
  const text=controller.guardedOpenOne('public-web','same-work',fetcher);
  const bytes=controller.guardedOpenBytes('public-web','same-work',fetcher);
  for(let i=0;i<5;i++)assert.equal((await bytes({url:small,headers:{},timeoutMs:1000})).status,200);
  const results=await Promise.all(Array.from({length:10},()=>text({url:small,method:'GET',headers:{},timeoutMs:1000})));
  assert.equal(results.filter(r=>r.status===200).length,5);
  assert.equal(results.filter(r=>r.requestCount===0 && /Source website may be checked again/.test(r.transportError??'')).length,5);
  assert.equal(calls,10);
  assert.equal(controller.snapshot().providerCircuits.length,0,'a cap is not a provider failure');
  for(let i=0;i<20;i++)assert.equal((await text({url:census,method:'GET',headers:{},timeoutMs:1000})).status,200);
  assert.equal(calls,30);
  const other=await controller.guardedOpenOne('public-web','different-work',fetcher)({url:`${small}/other`,method:'GET',headers:{},timeoutMs:1000});
  assert.match(other.transportError??'',/Source website may be checked again/,'the allowance is the website\'s, shared by every work item');
  assert.equal(calls,30);
});

test('redirects apply the destination website size and uncapped HTTP still honors 429 Retry-After', async () => {
  let now=Date.parse(NIGHT),calls=0;
  const controller=fundedController({now:NIGHT,charges: [],clock:()=>now,websiteSize:url=>new URL(url).hostname==='small.example.gov'
    ? {kind:'local-government',population:9000} : {kind:'federal'}});
  const open=controller.guardedOpenOne('public-web','redirect-work',async url=>{
    calls++;
    return String(url).includes('small.example.gov') ? new Response('go',{status:302,headers:{location:'https://api.census.gov/data'}})
      : new Response('slow down',{status:429,headers:{'retry-after':new Date(now+30*60000).toUTCString()}});
  });
  const input={url:'https://small.example.gov/start',method:'GET' as const,headers:{},timeoutMs:1000};
  assert.equal((await open(input)).status,429);assert.equal(calls,2);
  const direct={...input,url:'https://api.census.gov/data'};
  assert.equal((await open(direct)).requestCount,0);assert.equal(calls,2);
  now+=30*60000-1;assert.equal((await open(direct)).requestCount,0);
  now+=1;
  assert.equal((await controller.guardedOpenOne('public-web','redirect-work',async()=>new Response('ok'))(direct)).status,200);
});

test("CH-03: raising the owner's dial mid-round moves the very next reservation and pre-admission read", () => {
  const recent = "2026-09-05T02:00:00.000Z";
  const safety = fundedController({ now: NIGHT, charges: priced([cost(99.5, recent)]), clock: () => Date.parse(NIGHT) });
  assert.equal(safety.rollingCeilingReached(0.6).reached, true);
  assert.throws(() => safety.reserveModelRequest("anthropic", "before-raise", REQUEST), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING");
  safety.setRollingCeilingUsd(500);
  assert.equal(safety.rollingCeilingReached(0.6).reached, false);
  assert.equal(safety.rollingCeilingReached(0.6).capUsd, 500);
  assert.doesNotThrow(() => safety.reserveModelRequest("anthropic", "after-raise", REQUEST));
  // A disappeared or invalid value is never no ceiling: it falls back to the built-in, which spends nothing.
  safety.setRollingCeilingUsd(null);
  assert.equal(safety.rollingCeilingReached(0).capUsd, 0);
  safety.setRollingCeilingUsd(Number.NaN);
  assert.equal(safety.rollingCeilingReached(0).reached, true);
});
