/**
 * The research cycle admits paid model work only while a delivery path is open
 * (owner directive, 2026-09-22), and names every other reason it is closed in
 * a fixed order. Pure: facts in, closure out.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { deliveryPathOpen, modelLaneClosure, type DeliveryGate, type ModelLaneFacts } from "../lib/control-plane/scheduler/model-lane.ts";

const OPEN_GATE: DeliveryGate = { promotionEnabled: true, openRecordClasses: ["candidate-enrichment"] };
const CLOSED_GATE: DeliveryGate = { promotionEnabled: false, openRecordClasses: [] };

function facts(over: Partial<ModelLaneFacts> = {}): ModelLaneFacts {
  return {
    scheduledBlackout: false,
    dry: false,
    noModel: false,
    credentialConfigured: true,
    credentialVar: "ANTHROPIC_API_KEY",
    activation: OPEN_GATE,
    paused: false,
    pauseIntentId: null,
    runnerPaused: false,
    runnerPauseIntentId: null,
    unreadableControls: [],
    ...over,
  };
}

test("the lane is open only when nothing closes it and a delivery path is open", () => {
  assert.equal(modelLaneClosure(facts()), null);
});

test("with promotion off, the lane closes and says why, and what keeps running", () => {
  const closed = modelLaneClosure(facts({ activation: CLOSED_GATE }));
  assert.equal(closed?.code, "LANE_DISABLED");
  assert.match(closed!.reason, /no delivery path is open/);
  assert.match(closed!.reason, /promotion OFF with 0 record class\(es\) open/);
  assert.match(closed!.reason, /plain-code work and routine publication continue/);
});

test("promotion on with no record class open is still no delivery path", () => {
  assert.equal(deliveryPathOpen({ promotionEnabled: true, openRecordClasses: [] }), false);
  assert.equal(deliveryPathOpen({ promotionEnabled: false, openRecordClasses: ["agendas"] }), false);
  assert.equal(deliveryPathOpen(OPEN_GATE), true);
});

test("the real activation gate decides: the lane is open exactly when a delivery path is", () => {
  const gate = readActivationGate(".");
  assert.equal(modelLaneClosure(facts({ activation: gate })) === null, deliveryPathOpen(gate));
});

test("reasons are ordered: blackout, dry, no-model, owner pause, runner pause, unreadable control, credential, delivery", () => {
  const all = facts({
    scheduledBlackout: true, dry: true, noModel: true, credentialConfigured: false, activation: CLOSED_GATE,
    paused: true, pauseIntentId: "ri-1", runnerPaused: true, runnerPauseIntentId: "PAUSE_RUNNER:x", unreadableControls: ["the log could not be read"],
  });
  assert.equal(modelLaneClosure(all)?.code, "SCHEDULED_BLACKOUT");
  assert.match(modelLaneClosure({ ...all, scheduledBlackout: false })!.reason, /^--dry/);
  assert.match(modelLaneClosure({ ...all, scheduledBlackout: false, dry: false })!.reason, /^--no-model/);
  const invocation = { scheduledBlackout: false, dry: false, noModel: false };
  assert.deepEqual(modelLaneClosure({ ...all, ...invocation }), { code: "PAUSED", reason: "paused by owner intent ri-1" });
  assert.match(modelLaneClosure({ ...all, ...invocation, paused: false })!.reason, /^the owner paused the runner \(intent PAUSE_RUNNER:x\)/);
  assert.match(modelLaneClosure({ ...all, ...invocation, paused: false, runnerPaused: false })!.reason, /^held closed as if paused.*the log could not be read/);
  const noOwnerFact = { ...all, ...invocation, paused: false, runnerPaused: false, unreadableControls: [] };
  assert.match(modelLaneClosure(noOwnerFact)!.reason, /ANTHROPIC_API_KEY is not set/);
  assert.match(modelLaneClosure({ ...noOwnerFact, credentialConfigured: true })!.reason, /no delivery path is open/);
  assert.equal(modelLaneClosure({ ...noOwnerFact, credentialConfigured: true, activation: OPEN_GATE }), null);
});

/*
 * 2026-09-25: the owner's controls fail closed. Each case below left the lane
 * OPEN before (the old rule read only the research-lane PAUSE).
 */
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

test("the owner pause stops paid work with delivery enabled", () => {
  const paused = modelLaneClosure(facts({ activation: OPEN_GATE, paused: true, pauseIntentId: "PAUSE:2026-09-22" }));
  assert.deepEqual(paused, { code: "PAUSED", reason: "paused by owner intent PAUSE:2026-09-22" });
  assert.notEqual(modelLaneClosure(facts({ activation: readActivationGate("."), paused: true, pauseIntentId: "p" })), null);
});

/*
 * WIRING TRIPWIRE, deliberately strict: the rule only matters if the research
 * cycle derives its lane from it, with the real activation gate.
 */
test("freshness-shadow derives modelLaneEnabled from modelLaneClosure and the activation gate", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const src = readFileSync(join(root, "scripts/freshness-shadow.mts"), "utf8");
  assert.match(src, /const laneClosure = modelLaneClosure\(\{[\s\S]{0,600}?activation: readActivationGate\(ROOT\)/);
  assert.match(src, /const modelLaneEnabled = laneClosure === null;/);
});
