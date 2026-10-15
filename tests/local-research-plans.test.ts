/** The model lane names the hunter-lane closure only when nothing else holds paid work. */
import assert from "node:assert/strict";
import test from "node:test";
import { modelLaneClosure } from "../lib/control-plane/scheduler/model-lane.ts";

test("the model lane names the hunter-lane closure only when nothing else holds paid work", () => {
  const facts = { dry: false, noModel: false, credentialConfigured: true, credentialVar: "KEY",
    paused: false, pauseIntentId: null,
    runnerPaused: false, runnerPauseIntentId: null, spendHold: null, unreadableControls: [] } as unknown as Parameters<typeof modelLaneClosure>[0];
  assert.equal(modelLaneClosure(facts), null);
  assert.equal(modelLaneClosure({ ...facts, paidWorkInHunterLane: true })?.hunterLane, true);
  const paused = modelLaneClosure({ ...facts, paidWorkInHunterLane: true, paused: true, pauseIntentId: "intent-1" });
  assert.equal(paused?.code, "PAUSED");
  assert.equal(paused?.hunterLane, undefined, "an owner pause holds the row; nothing is queued");
  assert.equal(modelLaneClosure({ ...facts, paidWorkInHunterLane: true, spendHold: "the ledger is held" })?.hunterLane, undefined);
});
