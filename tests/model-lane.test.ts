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

test("reasons are ordered: blackout, dry, no-model, credential, delivery, owner pause", () => {
  const all = facts({ scheduledBlackout: true, dry: true, noModel: true, credentialConfigured: false, activation: CLOSED_GATE, paused: true, pauseIntentId: "ri-1" });
  assert.equal(modelLaneClosure(all)?.code, "SCHEDULED_BLACKOUT");
  assert.match(modelLaneClosure({ ...all, scheduledBlackout: false })!.reason, /^--dry/);
  assert.match(modelLaneClosure({ ...all, scheduledBlackout: false, dry: false })!.reason, /^--no-model/);
  assert.match(
    modelLaneClosure({ ...all, scheduledBlackout: false, dry: false, noModel: false })!.reason,
    /ANTHROPIC_API_KEY is not set/,
  );
  assert.match(
    modelLaneClosure({ ...all, scheduledBlackout: false, dry: false, noModel: false, credentialConfigured: true })!.reason,
    /no delivery path is open/,
  );
  assert.deepEqual(
    modelLaneClosure({ ...all, scheduledBlackout: false, dry: false, noModel: false, credentialConfigured: true, activation: OPEN_GATE }),
    { code: "PAUSED", reason: "paused by owner intent ri-1" },
  );
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
