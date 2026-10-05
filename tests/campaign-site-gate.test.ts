/**
 * The activation gate opens `candidate-enrichment` for campaign sites ONLY, on
 * Sean's 2026-09-21 authorization — and opening it does not open the paid
 * research lane while the owner's pause stands: the model lane checks the
 * pause after the delivery path, so gate open + pause = PAUSED. The
 * campaign-site path itself is plain code and never consults the lane.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ACTIVATION_GATE, classFieldOpen, readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { deliveryPathOpen, modelLaneClosure } from "../lib/control-plane/scheduler/model-lane.ts";
import { evaluateItems } from "../lib/control-plane/promotion/window.ts";
import { deriveItemState } from "../lib/control-plane/promotion/pipeline.ts";
import type { PromotionPipelineRecord } from "../lib/control-plane/promotion/types.ts";

const ROOT = process.cwd();

test("the gate opens the §3 classes, opens every candidate-enrichment field, and cites the owner's authorization", () => {
  const gate = readActivationGate(ROOT);
  assert.equal(gate.promotionEnabled, true);
  for (const cls of ["candidate-enrichment", "meeting-times", "agendas", "OFFICIAL_ROSTER", "OFFICIAL_BOARD_DIRECTORY", "VOTER_ACCESS_ROUTE"]) assert.ok(gate.openRecordClasses.includes(cls), cls);
  assert.deepEqual(gate.openFields, {});
  assert.equal(gate.mode, "SHADOW", "the nightly window itself still promotes nothing");
  assert.ok(classFieldOpen(gate, "candidate-enrichment", "campaignSite"));
  assert.ok(classFieldOpen(gate, "candidate-enrichment", "bio"));
  // Each field still passes its own §3 verification before publication.
  for (const field of ["email", "phone", "photo", "positions"]) assert.equal(classFieldOpen(gate, "candidate-enrichment", field), true, field);
  for (const cls of ["candidate-positions", "ballot", "votes", "local-jurisdiction"]) assert.equal(classFieldOpen(gate, cls, "campaignSite"), false, cls);
  assert.deepEqual(readActivationGate(mkdtempSync(join(tmpdir(), "wtp-gate-"))), gate, "no file on disk changes the decision");
  const source = readFileSync(join(ROOT, "lib", "control-plane", "promotion", "activation-gate.ts"), "utf8");
  assert.match(source, /Sean,\s+\*\s+2026-09-21: "You may enable automatic promotion for qualifying results\. Fix\s+\*\s+the gap, recover value already paid for\."/);
  assert.doesNotMatch(source, /readFileSync|readdirSync|freshness-shadow-runs/);
  assert.match(gate.reason, /candidate-enrichment \(every field only\)/);
  assert.equal(ACTIVATION_GATE.openFields["candidate-enrichment"], undefined);
});

test("gate open + owner pause: the paid lane stays CLOSED (PAUSED); the pause is what holds it", () => {
  const gate = readActivationGate(ROOT);
  assert.equal(deliveryPathOpen(gate), true);
  const base = { scheduledBlackout: false, dry: false, noModel: false, credentialConfigured: true, credentialVar: "WTP_WORKERS_ANTHROPIC_API_KEY", activation: gate, runnerPaused: false, runnerPauseIntentId: null, unreadableControls: [] };
  assert.deepEqual(modelLaneClosure({ ...base, paused: true, pauseIntentId: "ri-owner-pause" }), { code: "PAUSED", reason: "paused by owner intent ri-owner-pause" });
  /* The owner's pause is named first, credential or not (model-lane.ts orders the owner's decisions ahead of configuration); without the pause, a missing credential closes it. */
  assert.equal(modelLaneClosure({ ...base, credentialConfigured: false, paused: true, pauseIntentId: "ri-owner-pause" })?.code, "PAUSED");
  assert.equal(modelLaneClosure({ ...base, credentialConfigured: false, paused: false, pauseIntentId: null })?.code, "LANE_DISABLED");
  /* Recorded plainly: once the owner resumes, the open class IS a delivery path and the lane opens (owner directive 2026-09-22). */
  assert.equal(modelLaneClosure({ ...base, paused: false, pauseIntentId: null }), null);
});

test("the campaign-site path is plain code: it never reaches the model lane, a Scout, a paid search or a model client", () => {
  for (const file of [
    "lib/candidates/campaign-site-verifier.ts",
    "lib/candidates/campaign-site-subjects.ts",
    "lib/candidates/research-findings-replay.ts",
    "lib/control-plane/promotion/campaign-site-chain.ts",
    "lib/control-plane/promotion/campaign-site-reads.ts",
    "lib/civic-data/campaign-site-publication.ts",
    "scripts/replay-research-findings.mts",
  ]) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /model-lane|scout-executor|scout-search|scout-tools|model-routing|@anthropic-ai|anthropic|BRAVE_SEARCH|EXA_API|freshness-shadow\.mts/i, file);
  }
});

function item(itemId: string, recordClass: string, field: string | undefined): PromotionPipelineRecord[] {
  const actor = (instance: string) => ({ role: "RELEASE_ORCHESTRATOR" as const, lane: "DETERMINISTIC" as const, instance });
  return [
    { formatVersion: 1, recordId: `${itemId}:scouted`, itemId, at: "2026-09-25T00:00:00.000Z", actor: { role: "SCOUT", lane: "BOUNDED_MODEL_WORKER", instance: "at-1" }, stage: "SCOUTED",
      source: { kind: "SCOUT_RESULT", attemptId: "at-1", obligationId: "o", outcome: "EVIDENCE_FOUND", routeId: null }, recordClass, subjectId: "s", canonicalUrl: null, artifactIds: [], scoutAttemptId: "at-1", summary: "" },
    { formatVersion: 1, recordId: `${itemId}:approved`, itemId, at: "2026-09-25T00:00:00.000Z", actor: actor("a"), stage: "APPROVED_FOR_PROMOTION",
      chain: { scouted: "", confirmed: "", verified: "", audited: "" }, recordClass, ...(field === undefined ? {} : { field }) },
  ];
}

test("the window promotes-would an approved item of an implemented class without a candidate field restriction", () => {
  const states = [
    deriveItemState("site", item("site", "candidate-enrichment", "campaignSite")),
    deriveItemState("photo", item("photo", "candidate-enrichment", "photo")),
    deriveItemState("unscoped", item("unscoped", "candidate-enrichment", undefined)),
    deriveItemState("agenda", item("agenda", "agendas", undefined)),
  ];
  const { verdicts } = evaluateItems(states, readActivationGate(ROOT));
  const by = new Map(verdicts.map((v) => [v.itemId, v]));
  assert.equal(by.get("site")?.verdict, "PROMOTE_WOULD");
  assert.equal(by.get("photo")?.verdict, "PROMOTE_WOULD");
  assert.equal(by.get("unscoped")?.verdict, "PROMOTE_WOULD");
  assert.equal(by.get("agenda")?.verdict, "PROMOTE_WOULD", "meeting agendas are open under §3");
});
