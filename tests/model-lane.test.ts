/**
 * The research cycle's paid model lane names every reason it is closed in a fixed order. Pure: facts in, closure out.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { modelLaneClosure, type ModelLaneFacts } from "../lib/control-plane/scheduler/model-lane.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { anthropicRateLimits, ModelTransportError, type ModelRequest } from "../lib/control-plane/scheduler/scout-executor.ts";
import { MODELS } from "../lib/models.ts";

test("concurrent calls share request capacity while each named tier can proceed", async () => {
  let now = 0;
  let resume!: () => void;
  let sleeping!: () => void;
  const waiting = new Promise<void>(resolve => { sleeping = resolve; });
  const queue = new ModelProviderQueue({ now: () => now, sleep: async ms => {
    sleeping();
    await new Promise<void>(resolve => { resume = () => { now += ms; resolve(); }; });
  } });
  for (const model of [MODELS.haiku.model, MODELS.sonnet.model]) queue.observe(model, {
    requestsPerMinute: 1, inputTokensPerMinute: 10000, outputTokensPerMinute: 10000, retryAfterMs: null });
  const starts: string[] = [];
  const send = queue.transport(async request => {
    starts.push(request.model);
    return { model: request.model, content: [], stop_reason: "end_turn", usage: { input_tokens: 1, cache_creation_input_tokens: 0, output_tokens: 1 } };
  });
  const request = (model: string): ModelRequest => ({ model, max_tokens: 10, system: [], tools: [], messages: [] });
  const first = send(request(MODELS.haiku.model));
  const second = send(request(MODELS.haiku.model));
  const other = send(request(MODELS.sonnet.model));
  await waiting;
  await Promise.all([first, other]);
  assert.deepEqual(starts.sort(), [MODELS.haiku.model, MODELS.sonnet.model].sort());
  resume();
  await second;
  assert.equal(starts.length, 3);
  assert.equal(now, 60000);
});

test("provider errors are returned once; subsequent admission honors Retry-After", async () => {
  let now = 0;
  const sleeps: number[] = [];
  const queue = new ModelProviderQueue({ now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; }, requestsPerMinute: 100 });
  let calls = 0;
  const send = queue.transport(async () => { calls++; throw new ModelTransportError("rate limited", 429, 2500); });
  const request: ModelRequest = { model: MODELS.haiku.model, max_tokens: 1, system: [], tools: [], messages: [] };
  await assert.rejects(send(request), /rate limited/);
  assert.equal(calls, 1);
  await assert.rejects(send(request), /rate limited/);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2500]);
});

test("provider errors without Retry-After back off once per failure and reset after recovery", async () => {
  let now = 0, calls = 0;
  const sleeps: number[] = [];
  const queue = new ModelProviderQueue({ now: () => now, requestsPerMinute: 100,
    sleep: async ms => { sleeps.push(ms); now += ms; } });
  const send = queue.transport(async request => {
    calls++;
    if (calls <= 2 || calls === 4) throw new ModelTransportError("provider unavailable", 503);
    return { model: request.model, content: [], stop_reason: "end_turn", usage: { input_tokens: 1, cache_creation_input_tokens: 0, output_tokens: 1 } };
  });
  const request: ModelRequest = { model: MODELS.haiku.model, max_tokens: 1, system: [], tools: [], messages: [] };
  await assert.rejects(send(request), /provider unavailable/);
  await assert.rejects(send(request), /provider unavailable/);
  await send(request);
  await assert.rejects(send(request), /provider unavailable/);
  await send(request);
  assert.equal(calls, 5);
  assert.deepEqual(sleeps, [2000, 4000, 2000]);
});

test("a consumed provider bucket waits for the returned reset, including usage from other sessions", async () => {
  let now = 0;
  const sleeps: number[] = [];
  const queue = new ModelProviderQueue({ now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; } });
  queue.observe(MODELS.haiku.model, anthropicRateLimits(new Headers({
    "anthropic-ratelimit-requests-limit": "100", "anthropic-ratelimit-requests-remaining": "0",
    "anthropic-ratelimit-requests-reset": new Date(10000).toISOString(),
  })));
  const send = queue.transport(async request => ({ model: request.model, content: [], stop_reason: "end_turn",
    usage: { input_tokens: 1, cache_creation_input_tokens: 0, output_tokens: 1 } }));
  await send({ model: MODELS.haiku.model, max_tokens: 1, system: [], tools: [], messages: [] });
  assert.deepEqual(sleeps, [10000]);
});

function facts(over: Partial<ModelLaneFacts> = {}): ModelLaneFacts {
  return {
    dry: false,
    noModel: false,
    credentialConfigured: true,
    credentialVar: "ANTHROPIC_API_KEY",
    paused: false,
    pauseIntentId: null,
    runnerPaused: false,
    runnerPauseIntentId: null,
    unreadableControls: [],
    ...over,
  };
}

test("the lane is open only when nothing closes it", () => {
  assert.equal(modelLaneClosure(facts()), null);
});

test("reasons are ordered: dry, no-model, owner pause, runner pause, unreadable control, credential", () => {
  const all = facts({
    dry: true, noModel: true, credentialConfigured: false,
    paused: true, pauseIntentId: "ri-1", runnerPaused: true, runnerPauseIntentId: "PAUSE_RUNNER:x", unreadableControls: ["the log could not be read"],
  });
  assert.equal(modelLaneClosure(all)?.code, "LANE_DISABLED");
  assert.match(modelLaneClosure(all)!.reason, /^--dry/);
  assert.match(modelLaneClosure({ ...all, dry: false })!.reason, /^--no-model/);
  const invocation = { dry: false, noModel: false };
  assert.deepEqual(modelLaneClosure({ ...all, ...invocation }), { code: "PAUSED", reason: "paused by owner intent ri-1" });
  assert.match(modelLaneClosure({ ...all, ...invocation, paused: false })!.reason, /^the owner paused the runner \(intent PAUSE_RUNNER:x\)/);
  assert.match(modelLaneClosure({ ...all, ...invocation, paused: false, runnerPaused: false })!.reason, /^held closed as if paused.*the log could not be read/);
  const noOwnerFact = { ...all, ...invocation, paused: false, runnerPaused: false, unreadableControls: [] };
  assert.match(modelLaneClosure(noOwnerFact)!.reason, /ANTHROPIC_API_KEY is not set/);
  assert.equal(modelLaneClosure({ ...noOwnerFact, credentialConfigured: true }), null);
});

/* The owner's controls fail closed. */
test("the runner-level PAUSE_RUNNER closes the paid lane, not only the research-lane PAUSE", () => {
  const closed = modelLaneClosure(facts({ runnerPaused: true, runnerPauseIntentId: "PAUSE_RUNNER:2026-09-25T15:00:00.000Z" }));
  assert.equal(closed?.code, "PAUSED");
  assert.match(closed!.reason, /the owner paused the runner \(intent PAUSE_RUNNER:2026-09-25T15:00:00\.000Z\); no paid model work runs under it/);
});

test("an owner control that could not be read holds the lane closed as if paused, names it, and says free work continues", () => {
  const closed = modelLaneClosure(facts({
    unreadableControls: ["the owner's research intents could not be read (connection reset)", "the owner's spend ceiling on the config row is malformed (0 is not a positive dollar amount)"],
  }));
  assert.equal(closed?.code, "PAUSED", "counted with the pauses (modelClassDeferredForLane), never as a spent ceiling");
  assert.match(closed!.reason, /research intents could not be read \(connection reset\); the owner's spend ceiling on the config row is malformed/);
  assert.match(closed!.reason, /Plain-code work, routine publication and free discovery walks continue/);
});

test("the owner pause stops paid work", () => {
  const paused = modelLaneClosure(facts({ paused: true, pauseIntentId: "PAUSE:2026-09-22" }));
  assert.deepEqual(paused, { code: "PAUSED", reason: "paused by owner intent PAUSE:2026-09-22" });
});

/* The rule only matters if the research cycle derives its lane from it. */
test("freshness-shadow derives modelLaneEnabled from modelLaneClosure", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const src = readFileSync(join(root, "scripts/freshness-shadow.mts"), "utf8");
  assert.match(src, /const laneClosure = modelLaneClosure\(\{/);
  assert.match(src, /const modelLaneEnabled = laneClosure === null;/);
});
