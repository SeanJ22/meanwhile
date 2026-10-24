import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";
import { MODELS, MODEL_TIERS, modelRequestFields } from "../lib/models.ts";
import { ASK_EFFORT_LEVELS, ASK_EFFORT_SETTING, ASK_SYNTHESIS_EFFORT, askModelStartupLine, resolveAskEffort } from "../lib/ask/model.ts";
import { synthesisLadder } from "../lib/ask/synthesize.ts";

test("saved model choices cannot skip a cheaper writer", () => {
  for (const settings of [{}, { "ask.fastWriterModel": "off", "ask.escalationWriterModel": MODELS.opus.model }]) {
    assert.deepEqual(synthesisLadder(settings).map(rung => rung.model), MODEL_TIERS.map(tier => MODELS[tier].model));
  }
});

test("the owner's effort still applies and invalid efforts fall back to a supported value", () => {
  for (const effort of ASK_EFFORT_LEVELS) assert.equal(resolveAskEffort({ [ASK_EFFORT_SETTING]: effort }), effort);
  assert.equal(resolveAskEffort({ [ASK_EFFORT_SETTING]: "extreme" }), ASK_SYNTHESIS_EFFORT);
  assert.ok(!/sk-|api[_-]?key/i.test(askModelStartupLine({})));
});

test("each model receives the thinking and effort fields its API accepts", () => {
  for (const tier of MODEL_TIERS) {
    const fields = modelRequestFields(MODELS[tier].model, { thinking: "OFF", effort: "low" });
    assert.equal(fields.effort, "low");
    assert.equal(fields.thinking?.type, tier === "haiku" ? "disabled" : tier === "sonnet" ? "between_tools" : undefined);
    assert.ok(fields.minMaxTokens >= 1024);
  }
});
