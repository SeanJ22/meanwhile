import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { fixtureRolePlaybook } from "./helpers/playbooks.ts";
import { hunterExecutor, cachedModelRequest, cacheTtlOrderProblems, type ModelRequest } from "../lib/control-plane/scheduler/scout-executor.ts";
import { HUNTER_TOOL_SPECS } from "../lib/control-plane/scheduler/scout-tools.ts";
import { visibleText } from "../lib/extract/visible-text.ts";
import type { ScoutToolkit } from "../lib/control-plane/scheduler/scout-contract.ts";
import { batchEligibleForJob, batchEnabledForJob } from "../lib/control-plane/model-batch.ts";
import { modelSpendView, type ModelSpendRaw } from "../lib/control-plane/admin-view/model-spend.ts";
import { MODELS } from "../lib/models.ts";

const NOW = "2026-10-13T12:00:00.000Z";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const page = visibleText(readFileSync(new URL("./fixtures/schedulepage/newbury-planning-board.html", import.meta.url), "utf8"));

test("R7: two jobs reuse the same hour-long prefix; the saved Newbury passage is delivered once and its repeated result is a reference", async () => {
  assert.match(page, /Planning Board/);
  const cache = new Map<string, number>();
  const requests: ModelRequest[][] = [];
  let clock = NOW;
  const run = async (place: string) => {
    const seen: ModelRequest[] = [];
    requests.push(seen);
    let calls = 0;
    const toolkit: ScoutToolkit = { specs: HUNTER_TOOL_SPECS, vaultedArtifactIds: new Set(), reported: [], requestCount: 0, bytesFetched: 0,
      get toolCalls() { return calls; }, call: async () => {
        calls++;
        return { ok: true, forModel: `Saved-page envelope\n${page}`, artifacts: [], provenance: [], step: null, requestCount: 0, bytesFetched: 0 };
      } };
    const exec = hunterExecutor({ role: "DETECTIVE", model: MODELS.haiku.model, now: () => clock,
      playbookFor: fixtureRolePlaybook, toolkitFor: () => toolkit,
      contextFor: async () => ({ brief: `${place}: saved official Planning Board page`, reason: "Read held planning board evidence", blanks: 1,
        handed: { artifactIds: ["saved-newbury"] },
        tools: { vault: async () => ({ stored: true, where: "fixture", why: "committed source" }), spaceOut: async () => {} } }),
      transport: async request => {
        seen.push(request);
        assert.deepEqual(cacheTtlOrderProblems(request), []);
        const prefix = { tools: request.tools, system: request.system };
        const key = hash(prefix), prefixTokens = Math.ceil(Buffer.byteLength(JSON.stringify(prefix)) / 4);
        const hit = (cache.get(key) ?? 0) > Date.parse(clock);
        const ttl = request.system.at(-1)?.cache_control?.ttl;
        cache.set(key, Date.parse(clock) + (ttl === "1h" ? 3_600_000 : 300_000));
        return { model: request.model, batchEligible: true, batch: true, stop_reason: "tool_use",
          content: seen.length <= 3 ? [{ type: "tool_use", id: `read-${seen.length}`, name: "read_held", input: { artifactId: "saved-newbury", offset: 0 } }] : [],
          usage: { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: hit ? prefixTokens : 0,
            cache_creation_input_tokens: hit ? 0 : prefixTokens,
            cache_creation: { ephemeral_1h_input_tokens: hit ? 0 : prefixTokens, ephemeral_5m_input_tokens: 0 } } };
      } });
    return exec.run({ obligation: { obligation: { id: `job-${place}`, subjectId: place, recordClass: "OFFICIAL_BOARD_DIRECTORY", active: true,
      routeId: null, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, nextDueAt: clock, cadenceHours: 24,
      cadenceSource: "DEFAULT_NO_SIGNAL", basis: "fixture" }, routeTaskId: `task-${place}`, workItemId: `item-${place}`,
      attemptId: `attempt-${place}`, holder: "fixture", executor: "BOUNDED_MODEL_WORKER", bound: { maxAttempts: 1, maxWallMs: 0, maxCostUnits: 0 } } as never);
  };
  const first = await run("Newbury, NH");
  clock = "2026-10-13T12:10:00.000Z";
  const second = await run("New London, NH");
  assert.equal(hash({ tools: requests[0][0].tools, system: requests[0][0].system }), hash({ tools: requests[1][0].tools, system: requests[1][0].system }));
  assert.deepEqual(requests[0][0].system.at(-1)?.cache_control, { type: "ephemeral", ttl: "1h" });
  assert.deepEqual(requests[0][0].cache_control, { type: "ephemeral" });
  const prefix = JSON.stringify({ tools: requests[0][0].tools, system: requests[0][0].system });
  for (const variable of ["Newbury, NH", "New London, NH", NOW, "attempt-Newbury"]) assert.ok(!prefix.includes(variable));
  assert.ok((first.cost?.cacheCreation1hInputTokens ?? 0) > 0);
  assert.equal(second.cost?.cacheCreation1hInputTokens, 0, "the second job no longer writes the stable prefix after the five-minute cache has expired");
  assert.ok(second.cost!.cacheCreationInputTokens! < first.cost!.cacheCreationInputTokens!);
  assert.ok((second.cost?.cacheReadInputTokens ?? 0) > 0);
  const results = requests[0][3].messages.filter(m => m.role === "user" && Array.isArray(m.content)).flatMap(m => m.content as { type: string; content?: string }[]).filter(b => b.type === "tool_result");
  assert.match(results[0].content!, /Planning Board/);
  assert.match(results[1].content!, /supplied on turn 1/);
  assert.ok(Buffer.byteLength(results[1].content!) < Buffer.byteLength(results[0].content!) / 4);
  assert.equal(first.cost?.modelRequestCount, first.cost?.batchRequestCount);
});

test("R7: exact deadline boundaries, elections, concluded meetings and Ask remain synchronous; eligibility survives a disabled batch switch", () => {
  const priority = { now: NOW };
  for (const job of ["PAGE_READER", "TRANSLATOR", "STANCE_SUMMARY", "RECHECKER", "AUDIT_SAMPLE", "LOSS_STUDY", "BACKFILL", "BLANK"] as const) {
    assert.equal(batchEligibleForJob(job, priority), true);
    assert.equal(batchEnabledForJob("background-worker-research", job, { WTP_BACKGROUND_WORKER_BATCH: "0" }, priority), false);
    assert.equal(batchEligibleForJob(job, { ...priority, meetingStartsAt: ["2026-10-20T12:00:00Z"] }), false);
    assert.equal(batchEligibleForJob(job, { ...priority, meetingStartsAt: ["2026-10-06T12:00:00Z"] }), false);
    assert.equal(batchEligibleForJob(job, { ...priority, electionAt: ["2026-12-12T12:00:00Z"] }), false);
    assert.equal(batchEligibleForJob(job, { ...priority, electionAt: ["2026-12-12T12:00:00.001Z"] }), true);
    assert.equal(batchEligibleForJob(job, { ...priority, meetingStartsAt: ["unreadable"] }), false);
  }
  assert.equal(batchEligibleForJob("ASK", priority), false);
  const body = cachedModelRequest({ model: MODELS.haiku.model, max_tokens: 10, system: [], tools: [], messages: [], batchContext: { job: "TRANSLATOR", priority } });
  assert.equal(body.batchContext, undefined, "scheduling metadata never reaches Anthropic");
});

test("R7: Money uses token-weighted shares, eligible calls, list price and live reader records; missing historical measurements stay unknown", () => {
  const row: ModelSpendRaw = { day: "2026-10-13", role: "DETECTIVE", model: MODELS.haiku.model, window: "day", jobs: 2, calls: 10,
    usd: 0.2, uncached: 1000, reads: 84000, writes: 15000, writes1h: 12000, output: 1000, eligible: 8, batched: 6, promptBand: 0 };
  const view = modelSpendView([row, { ...row, window: "before" }, { ...row, window: "after" }], [{ day: row.day, facts: 4 }], NOW, "2026-10-14T12:00:00Z");
  const line = view.days[0];
  assert.equal(line.cacheHitShare, 0.84);
  assert.equal(line.cacheWriteShare, 0.15);
  assert.equal(line.hourCacheTokens, 12000);
  assert.equal(line.cacheWritesPerJob, 7500);
  assert.equal(line.batchShare, 0.75);
  assert.equal(line.costPerLiveFact, 0.05);
  assert.ok(line.savedDollars !== null);
  assert.equal(view.comparison, "complete");
  assert.deepEqual(view.before[0].cacheHitShare, view.after[0].cacheHitShare);
  const old = modelSpendView([{ ...row, model: null, reads: null, eligible: null }], [], null, NOW).days[0];
  assert.equal(old.cacheHitShare, null);
  assert.equal(old.savedDollars, null);
  assert.equal(old.batchShare, null);
  assert.equal(old.costPerLiveFact, null);
  const premium = modelSpendView([{ ...row, promptBand: 100001, listPrice: 0.25 }], [], null, NOW).days[0];
  assert.equal(premium.savedDollars, 0.05, "the per-request list prices take precedence over an aggregate job's prompt length");
});
