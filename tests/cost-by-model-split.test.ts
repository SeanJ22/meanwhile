/**
 * An escalated Scout is one Attempt with one ledger row whose worker is the model it started on. By-model views read
 * the per-model split (`byModel`) through `costPortionsByModel`, and the parts sum to the charge.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ZERO_COST, type AttemptCost } from "../lib/control-plane/attempt.ts";
import { costEntryWithModel, spendByTier, costPortionsByModel, type CostEntry, type CostModelShare } from "../lib/control-plane/cost.ts";
import { canonicalModelId, modelTierFor, MODELS } from "../lib/models.ts";
import { buildCostPanel, buildMonthlySpend } from "../lib/control-plane/cost-panel.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { dispatchOne, type DeclaredExecutor, type RunWork } from "../lib/control-plane/scheduler/dispatch.ts";
import { isScheduled, scheduleObligation, type FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";

const NOW = "2026-09-25T18:00:00.000Z";

test("Ask charges retain their recorded model without a worker Attempt", () => {
  const entry: CostEntry = costEntryWithModel({ attemptId: "ask-request", workItemId: "ask", routeTaskId: null,
    routeId: "ask:interpret", source: "api.anthropic.com", jurisdiction: null, project: "ask", role: "ASK",
    cost: { ...ZERO_COST, usd: 0.01, requestCount: 1 }, recordedAt: NOW }, MODELS.haiku.model);
  assert.equal(costPortionsByModel(entry, "unknown")[0].model, MODELS.haiku.model);
  assert.equal(buildCostPanel({ costs: [entry], attempts: [], cacheByRole: null, share: null, verifiedRecords: null }).costByModel[0].key, MODELS.haiku.model);
});

test("tier read keeps older charges unrecorded and counts multi-model shares once", () => {
  const base: CostEntry = { attemptId: "fixture", workItemId: "work", routeTaskId: null, routeId: null,
    source: null, jurisdiction: null, project: "fixture", role: "SCOUT", recordedAt: NOW,
    cost: { ...ZERO_COST, usd: 3, requestCount: 2 } };
  const modelShare = (model: string, usd: number): CostModelShare => ({ model, usd, requestCount: 1,
    inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null,
    cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null });
  const split = costEntryWithModel({ ...base, byModel: [modelShare(MODELS.haiku.model, 1), modelShare(MODELS.opus.model, 2)] }, MODELS.haiku.model);
  const single = costEntryWithModel({ ...base, cost: { ...ZERO_COST, usd: 4, requestCount: 1 } }, MODELS.sonnet.model);
  assert.equal(single.tier, "sonnet");
  const read = spendByTier([base, split, single, costEntryWithModel({ ...base, cost: ZERO_COST }, null)],
    { since: NOW, until: "2026-09-26T00:00:00Z" });
  assert.deepEqual(read.tiers.map(row => [row.tier, row.usd]), [["haiku", 1], ["sonnet", 4], ["opus", 2], ["none", null], ["unrecorded", 3]]);
  assert.equal(read.tiers.find(row => row.tier === "unrecorded")?.label, "Model not recorded");
});
const SONNET = "claude-sonnet-5";
const OPUS = "claude-opus-5-5";

const share = (model: string, usd: number, requestCount: number, reads: number): CostModelShare => ({
  model,
  requestCount,
  usd,
  inputTokens: reads + 100,
  outputTokens: 50 * requestCount,
  cacheReadInputTokens: reads,
  cacheCreationInputTokens: 60,
  cacheCreation5mInputTokens: 60,
  cacheCreation1hInputTokens: 0,
  uncachedInputTokens: 40,
});

const SPLIT: readonly CostModelShare[] = [share(SONNET, 0.0124, 4, 8000), share(OPUS, 0.0305, 2, 5000)];
const COMBINED: AttemptCost = {
  ...ZERO_COST,
  usd: 0.0429,
  inputTokens: 13_200,
  outputTokens: 300,
  cacheReadInputTokens: 13_000,
  cacheCreationInputTokens: 120,
  cacheCreation5mInputTokens: 120,
  cacheCreation1hInputTokens: 0,
  uncachedInputTokens: 80,
  requestCount: 6 + 9,
  durationMs: 90_000,
  bytesFetched: 40_000,
};

const row = (attemptId: string, cost: AttemptCost, byModel?: readonly CostModelShare[]): CostEntry => ({
  attemptId,
  workItemId: "wi",
  routeTaskId: "rt",
  routeId: "r",
  source: "a.gov",
  jurisdiction: "ocd-division/country:us/state:az/place:x",
  project: "freshness",
  role: "SCOUT",
  cost,
  recordedAt: NOW,
  ...(byModel ? { byModel } : {}),
});

const ATTEMPTS = [
  { id: "at-escalated", worker: { version: SONNET, provider: "anthropic" } },
  { id: "at-plain", worker: { version: SONNET, provider: "anthropic" } },
];
const COSTS = [row("at-escalated", COMBINED, SPLIT), row("at-plain", { ...ZERO_COST, usd: 0.01, requestCount: 3, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, uncachedInputTokens: 10, inputTokens: 10, outputTokens: 5 })];
const close = (a: number | null | undefined, b: number): boolean => a !== null && a !== undefined && Math.abs(a - b) < 1e-9;

test("Money's cost-by-model gives each model its own part of an escalated charge, and the parts are counted once", () => {
  const month = buildMonthlySpend({ costs: COSTS, attempts: ATTEMPTS, nowIso: NOW });
  const of = (model: string) => month.byModel.find((r) => r.key === model);
  assert.ok(close(of(OPUS)?.usd, 0.0305), "the frontier's part is the frontier's, not the start model's");
  assert.ok(close(of(SONNET)?.usd, 0.0124 + 0.01), "Sonnet carries its own part and the plain charge");
  assert.ok(close(month.total.total, 0.0529), "the month's total is the ledger's, unchanged");
  assert.ok(close(month.byModel.reduce((n, r) => n + (r.usd ?? 0), 0), month.total.total ?? Number.NaN), "the by-model rows sum to the total: nothing counted twice");
  assert.equal(of(OPUS)?.tokens.cacheReadInputTokens.total, 5000, "each model's tokens are its own attempt's");
  assert.equal(of(SONNET)?.tokens.cacheReadInputTokens.total, 8000);
  assert.equal(of(OPUS)?.tokens.requestCount.total, 2, "the frontier's requests are its own turns");
  assert.equal(of(SONNET)?.tokens.requestCount.total, 13 + 3, "the start model keeps the Attempt's non-model requests");
  assert.equal(month.tokens.cacheReadInputTokens.total, 13_000, "the month's token totals read the row once");

  const panel = buildCostPanel({ costs: COSTS, attempts: ATTEMPTS, cacheByRole: null, share: null, verifiedRecords: null });
  const usdOf = (rows: typeof panel.costByModel, key: string): number | null => {
    const r = rows.find((x) => x.key === key);
    return r !== undefined && r.usd.held ? r.usd.value.value : null;
  };
  assert.ok(close(usdOf(panel.costByModel, OPUS), 0.0305), "the panel's by-model row gives the frontier its part");
  assert.ok(close(usdOf(panel.costByModel, SONNET), 0.0224));
  assert.ok(close(panel.summary.measuredUsd, 0.0529), "the panel's total is the ledger's");
  assert.ok(close(usdOf(panel.costByRole, "SCOUT"), 0.0529), "by role, the charge is still one Scout charge");
});

test("a split that does not sum to the charge is not trusted: the row is read whole under its Attempt's model, never guessed", () => {
  const skewed = row("at-escalated", COMBINED, [share(SONNET, 0.0124, 4, 8000), share(OPUS, 0.5, 2, 5000)]);
  assert.deepEqual(costPortionsByModel(skewed, SONNET).map((p) => p.model), [SONNET]);
  const unmeasuredPart = row("at-escalated", COMBINED, [share(SONNET, 0.0124, 4, 8000), { ...share(OPUS, 0, 2, 5000), usd: null }]);
  assert.deepEqual(costPortionsByModel(unmeasuredPart, SONNET).map((p) => p.model), [SONNET], "an unmeasured part under a measured total is not a split");
  assert.deepEqual(costPortionsByModel(row("at-plain", COMBINED), SONNET).map((p) => [p.model, p.entry.cost.usd]), [[SONNET, 0.0429]], "no split: one portion, exactly as before");
  const parts = costPortionsByModel(row("at-escalated", COMBINED, SPLIT), SONNET);
  assert.deepEqual(parts.map((p) => [p.model, p.entry.cost.durationMs, p.entry.cost.bytesFetched]), [[SONNET, 90_000, 40_000], [OPUS, 0, 0]], "the Attempt's time and bytes stay on the model it started on, once");
});

const OBLIGATION: FreshnessObligation = {
  id: "freshness:test:split#1", recordClass: "meetings", subjectId: "ocd-division/country:us/state:az/place:x", routeId: "novel",
  active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: "2026-09-20T00:00:00.000Z",
};

function escalatedScout(kind: "DISPOSED" | "ABORTED"): DeclaredExecutor {
  const run: RunWork = async () =>
    kind === "DISPOSED"
      ? {
          ranAs: "BOUNDED_MODEL_WORKER",
          kind: "DISPOSED",
          disposition: { disposition: "DISCOVERED", observation: { rawCount: 0, normalizedCount: 0, routeOnlyCount: null, earliest: null, latest: null }, permission: "ALLOWED", transport: "REACHABLE", note: "route candidate" },
          cost: COMBINED,
          costByModel: SPLIT,
          detail: "escalated",
        }
      : { ranAs: "BOUNDED_MODEL_WORKER", kind: "ABORTED", cost: COMBINED, costByModel: SPLIT, detail: "escalated, no finish" };
  return { lane: "BOUNDED_MODEL_WORKER", workerFor: ({ holder }) => ({ role: "SCOUT", provider: "anthropic", version: SONNET, instance: holder }), run };
}

async function ledgerRowFor(executor: DeclaredExecutor): Promise<CostEntry> {
  const repos = createMemoryRepositories();
  const item = createWorkItem({ project: "freshness", subject: OBLIGATION.subjectId, obligation: `${OBLIGATION.id}#1`, why: "test", now: NOW });
  const task = createRouteTask({ workItemId: item.id, routeId: "novel", routeLabel: "novel", target: "a.gov", inherited: true, now: NOW });
  await registerWorkItem(repos, item, NOW);
  await registerRouteTask(repos, task, NOW);
  const scheduled = scheduleObligation(OBLIGATION, Date.parse(NOW));
  assert.ok(isScheduled(scheduled));
  await dispatchOne(repos, { obligation: scheduled, routeTaskId: task.id, holder: "w", now: NOW, leaseTtlMs: 60_000, maturity: () => "UNGRADUATED", executor });
  const rows = await repos.costs.readAll();
  assert.equal(rows.length, 1, "one Attempt, one charge");
  return rows[0];
}

test("the dispatcher writes the worker's per-model split on the one ledger row — disposed and aborted alike — with the combined cost unchanged", async () => {
  for (const kind of ["DISPOSED", "ABORTED"] as const) {
    const written = await ledgerRowFor(escalatedScout(kind));
    assert.deepEqual(written.cost, COMBINED, `${kind}: the charge is the combined cost, as before`);
    assert.deepEqual(written.byModel, SPLIT.map(share => ({ ...share, tier: modelTierFor(canonicalModelId(share.model)) })), `${kind}: and it says which model each part was for`);
  }
});
