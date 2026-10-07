import assert from "node:assert/strict";
import test from "node:test";
import { agentRuns, type AgentRunRaw } from "../lib/control-plane/admin-view/v6-agents-read.ts";

const NOW = "2026-09-30T18:00:00.000Z";
const run = (id: string, role: string, extra: Partial<AgentRunRaw> = {}): AgentRunRaw => ({ id, role, version: null, startedAt: "2026-09-30T17:50:00.000Z", endedAt: "2026-09-30T17:55:00.000Z",
  outcome: "COMPLETED", workItemId: "wi-abc", project: "freshness", attemptUsd: null, artifactCount: 2, ...extra });

test("an agent run names its role, model tier, cost, what it found and its saved source page", () => {
  const out = agentRuns({ nowIso: NOW,
    runs: [run("at-1", "SCOUT", { version: "claude-sonnet-5-5" }), run("at-2", "ACQUIRER", { version: "route-executor/1.0" }), run("at-3", "SCOUT", { version: "claude-opus-5" })],
    costs: [
      { attemptId: "at-1", usd: 0.4, jurisdiction: "az:school:palominas-school-district-49", obligationId: "freshness:meetings-discovery:az:school:palominas-school-district-49#own-site-meetings",
        byModel: [{ model: "claude-haiku-5-5-20261001", usd: 0.1 }, { model: "claude-sonnet-5-5", usd: 0.3 }] },
      { attemptId: "at-2", usd: 0, jurisdiction: null, obligationId: null, byModel: null },
    ],
    artifacts: [{ attemptId: "at-1", artifactId: "ar-deadbeef", workItemId: "wi-abc", url: "https://www.cochise.az.gov/agenda", byteLength: 1200, tier: "RAW", partial: false, count: 3 }],
    results: [{ attemptId: "at-1", kind: "scout", verdict: "EVIDENCE_FOUND", narrative: "Found the agenda page.", records: null }] });
  const [scout, code, older] = out;
  assert.equal(scout.role, "Scout");
  assert.equal(scout.model.tier, "sonnet", "the model that took most of the charge is named");
  assert.match(scout.costWords, /\$0\.40 · moved up a model partway/);
  assert.match(scout.found, /Found the record\. Found the agenda page\./);
  assert.equal(scout.source?.url, "https://www.cochise.az.gov/agenda");
  assert.equal(scout.source?.savedPages, 3);
  assert.deepEqual(scout.source?.copy, { path: "/api/admin/evidence/wi-abc/at-1/ar-deadbeef", byteLength: 1200 });
  assert.equal(scout.placeKey, "st:az");
  assert.match(scout.title, /Palominas School District 49/);
  assert.equal(code.model.tier, "plain-code");
  assert.equal(code.costUsd, 0);
  assert.equal(older.model.tier, "older", "with no cost row the attempt's own recorded model is named, and a model the catalog no longer has is an older one");
});

test("a retired model is named as older; an unpriced run is unknown, not $0; an old open run did not finish", () => {
  const out = agentRuns({ nowIso: NOW,
    runs: [run("at-1", "SCOUT", { version: "claude-opus-5" }), run("at-2", "PARSER", { endedAt: null, outcome: null, startedAt: "2026-09-30T17:59:00.000Z" }),
      run("at-3", "SCOUT", { endedAt: null, outcome: null, startedAt: "2026-09-30T10:00:00.000Z", version: "claude-haiku-5-5" })],
    costs: [{ attemptId: "at-1", usd: null, jurisdiction: null, obligationId: null, byModel: null }], artifacts: [], results: [] });
  assert.equal(out[0].model.tier, "older");
  assert.equal(out[0].model.name, "claude-opus-5");
  assert.equal(out[0].costUsd, null);
  assert.equal(out[0].costWords, "—");
  assert.equal(out[1].state, "running");
  assert.equal(out[2].state, "did-not-finish");
  assert.equal(out[2].model.tier, "haiku");
  assert.equal(out[0].source, null);
});

test("a source page is offered as a copy only when its saved capture is eligible", () => {
  const base = { attemptId: "at-1", artifactId: "ar-x1", workItemId: "wi-abc", url: "http://insecure.example/p", byteLength: 10, tier: "RAW", partial: false, count: 1 };
  const one = (extra: object, project = "freshness") => agentRuns({ nowIso: NOW, runs: [run("at-1", "ACQUIRER", { project })], costs: [], artifacts: [{ ...base, ...extra }], results: [] })[0].source!;
  assert.equal(one({}).url, null, "only an https page is linked");
  assert.ok(one({}).copy);
  assert.equal(one({ partial: true }).copy, null);
  assert.equal(one({ tier: "SANITIZED" }).copy, null);
  assert.equal(one({ byteLength: 40 * 1024 * 1024 }).copy, null);
  assert.equal(one({}, "conformance").copy, null);
});
