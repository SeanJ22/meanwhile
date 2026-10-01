import assert from "node:assert/strict";
import test from "node:test";
import { researchProgressHealth } from "../lib/control-plane/research-progress-health.ts";
import { RESEARCH_BOUNDS, type ResearchState } from "../lib/control-plane/scheduler/research-policy.ts";
import { modelShareTrend, type ResearchMetrics } from "../lib/control-plane/research-metrics.ts";

const NOW = "2026-09-15T16:00:00.000Z";
function state(over: Partial<ResearchState> = {}): ResearchState {
  return {
    formatVersion: 1, beatAt: NOW, cycleStartedAt: NOW, cycleFinishedAt: NOW,
    testedSha: null, host: "fixture", modelLaneEnabled: true, modelLaneDisabledReason: null,
    pausedByOwner: false, pauseIntentId: null,
    workerCredential: { name: "fixture", configured: true, provider: "fixture", context: "test" },
    model: "fixture", bounds: RESEARCH_BOUNDS,
    spend: { windowUsd: 0, measuredAttempts: 0, unmeasuredAttempts: 0, asOf: NOW },
    queue: { registeredUnits: 2454, modelClassUnits: 1840, modelClassDue: 1840,
      deterministicDue: 614, modelClassDispatchedThisCycle: 0, deterministicDispatchedThisCycle: 0,
      modelClassDeferredForCeiling: 0, modelClassDeferredForLane: 0, modelClassDeferredForCycleMax: 0 },
    running: [], runtimeConditions: [], methodCandidates: null,
    metrics: { share: modelShareTrend({ thisCycle: { model: 0, deterministic: 0 }, windowCycles:
      Array.from({ length: 8 }, () => ({ startedAt: NOW, deterministic: 0, model: 0 })) }) } as ResearchMetrics,
    ...over,
  };
}

test("repeated empty cycles with owed work are stalled despite a fresh heartbeat and enabled lane", () => {
  const reading = researchProgressHealth(state(), NOW);
  assert.equal(reading.state, "STALLED");
  assert.equal(reading.level, "RED");
  assert.match(reading.detail, /8 recorded cycles/);
  assert.match(reading.detail, /2454 route units are due/);
});

test("a downstream dispatch prevents a false zero-work stall even if the Scout queue did not dispatch", () => {
  const held = state();
  const reading = researchProgressHealth(state({ queue: { ...held.queue, autonomousDispatchedThisCycle: 1 } }), NOW);
  assert.equal(reading.state, "WORKING");
  assert.notEqual(reading.level, "GREEN", "worker activity cannot certify publication");
  assert.match(reading.publication, /No research publication reading/);
});

test("old, future and absent observations cannot claim current progress", () => {
  assert.equal(researchProgressHealth(null, NOW).state, "UNKNOWN");
  for (const beatAt of ["2026-09-14T16:00:00.000Z", "2026-09-16T16:00:00.000Z", "invalid"]) {
    assert.equal(researchProgressHealth(state({ beatAt }), NOW).state, "STALE");
  }
});

test("owner pause, disabled lane and no due work are distinguished from scheduler starvation", () => {
  assert.equal(researchProgressHealth(state({ pausedByOwner: true }), NOW).state, "PAUSED");
  assert.equal(researchProgressHealth(state({ modelLaneEnabled: false }), NOW).state, "DISABLED");
  const held = state();
  assert.equal(researchProgressHealth(state({ queue: { ...held.queue, modelClassDue: 0, deterministicDue: 0 } }), NOW).state, "WAITING");
  assert.equal(researchProgressHealth(state({ metrics: null }), NOW).state, "WAITING", "one empty cycle is not evidence of repeated stalling");
});

test("unknown model costs remain unknown and mixed costs are marked partial", () => {
  const unmeasured = { windowUsd: null, measuredAttempts: 0, unmeasuredAttempts: 3, asOf: NOW };
  const unknown = researchProgressHealth(state({ spend: unmeasured }), NOW).spend;
  assert.match(unknown, /unknown/);
  assert.doesNotMatch(unknown, /\$0/);
  assert.match(researchProgressHealth(state({ spend: { ...unmeasured, windowUsd: 0, measuredAttempts: 1 } }), NOW).spend, /partial total/);
});
