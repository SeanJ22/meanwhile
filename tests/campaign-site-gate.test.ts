import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { modelLaneClosure } from "../lib/control-plane/scheduler/model-lane.ts";

const ROOT = process.cwd();

test("owner pause: the paid lane stays CLOSED (PAUSED); the pause is what holds it", () => {
  const base = { dry: false, noModel: false, credentialConfigured: true, credentialVar: "WTP_WORKERS_ANTHROPIC_API_KEY", runnerPaused: false, runnerPauseIntentId: null, unreadableControls: [] };
  assert.deepEqual(modelLaneClosure({ ...base, paused: true, pauseIntentId: "ri-owner-pause" }), { code: "PAUSED", reason: "paused by owner intent ri-owner-pause" });
  assert.equal(modelLaneClosure({ ...base, credentialConfigured: false, paused: true, pauseIntentId: "ri-owner-pause" })?.code, "PAUSED");
  assert.equal(modelLaneClosure({ ...base, credentialConfigured: false, paused: false, pauseIntentId: null })?.code, "LANE_DISABLED");
  assert.equal(modelLaneClosure({ ...base, paused: false, pauseIntentId: null }), null);
});

test("the campaign-site path is plain code: it never reaches the model lane, a Scout, a paid search or a model client", () => {
  for (const file of [
    "lib/candidates/campaign-site-verifier.ts",
    "lib/candidates/campaign-site-subjects.ts",
    "lib/control-plane/promotion/campaign-site-chain.ts",
    "lib/control-plane/promotion/campaign-site-reads.ts",
  ]) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /model-lane|scout-executor|scout-search|scout-tools|model-routing|@anthropic-ai|anthropic|BRAVE_SEARCH|EXA_API|freshness-shadow\.mts/i, file);
  }
});
