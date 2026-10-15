import test from "node:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import { costEntryWorstCaseUsd, modelRequestBoundFor, type CostEntry } from "../lib/control-plane/cost.ts";
import { aggregatePricedSpend, pricedModelCharge } from "../lib/control-plane/fleet-safety.ts";
import { MODELS } from "../lib/models.ts";
import { cacheHitRateByRole, scoutCapacity } from "../lib/control-plane/research-metrics.ts";
import { recordCost } from "../lib/control-plane/repository/coordinator.ts";
import { createFileRepositories, fileAggregateRepository, fileAppendOnlyRepository } from "../lib/control-plane/repository/file-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { researchSpendInWindow } from "../lib/control-plane/scheduler/research-policy.ts";
import { costRecordId, readSpendWindow } from "../lib/control-plane/spend-window.ts";

const NOW = "2026-10-13T19:00:00.000Z";
const haiku = MODELS.haiku.model;
const at = (hoursAgo: number) => new Date(Date.parse(NOW) - hoursAgo * 3_600_000).toISOString();
const charge = (id: string, recordedAt: string, cost: Partial<CostEntry["cost"]>, extra: Partial<CostEntry> = {}): CostEntry => ({
  attemptId: id, workItemId: `wi-${id}`, routeTaskId: `rt-${id}`, routeId: null, source: "api.anthropic.com", jurisdiction: null,
  project: "freshness", role: "SCOUT", model: haiku, recordedAt, cost: { ...ZERO_COST, ...cost }, ...extra,
});

test("the running counter holds each model charge once, priced as written, and sums to the window the ceiling reads", async () => {
  const repos = createMemoryRepositories();
  const rows = [
    charge("a", at(1), { usd: 0.25, requestCount: 3 }),
    charge("b", at(2), { usd: 1.5, requestCount: 2 }),
    { ...charge("plain", at(1), { requestCount: 4 }), role: "ACQUIRER" as const, source: "api.marginalia.nu", model: null },
  ];
  for (const row of rows) await recordCost(repos, row, row.recordedAt);
  await recordCost(repos, rows[0]!, rows[0]!.recordedAt);
  const held = await readSpendWindow(repos, NOW);
  assert.deepEqual(held.map(row => row.id).sort(), [costRecordId(rows[0]!), costRecordId(rows[1]!)].sort(), "plain code adds nothing and a retried write counts once");
  const priced = (await repos.costs.readAll()).flatMap(row => pricedModelCharge(row, costRecordId(row)) ?? []);
  assert.equal(researchSpendInWindow(held, NOW).windowUsd, aggregatePricedSpend(priced, at(24), NOW).usd);
  assert.equal(researchSpendInWindow(held, NOW).windowUsd, 1.75);
});

test("every ledger append records its price, and charges past the requested window are excluded", async () => {
  const repos = createMemoryRepositories();
  await repos.costs.append("wi-old", "old", charge("old", at(40), { usd: 9, requestCount: 1 }), at(40));
  await repos.costs.append("wi-in", "in", charge("in", at(5), { usd: 2, requestCount: 1 }), at(5));
  const seeded = await readSpendWindow(repos, NOW);
  assert.deepEqual(seeded.map(row => row.usd), [2]);
  await recordCost(repos, charge("new", at(0), { usd: 1, requestCount: 1 }), NOW);
  assert.equal(researchSpendInWindow(await readSpendWindow(repos, NOW), NOW).windowUsd, 3);
  const later = new Date(Date.parse(NOW) + 31 * 3_600_000).toISOString();
  await recordCost(repos, charge("next-day", later, { usd: 0.5, requestCount: 1 }), later);
  assert.deepEqual((await readSpendWindow(repos, later)).map(row => row.usd), [0.5]);
});

test("honest pricing: nothing sent costs zero, a lost request costs its send limit beside the measured turns", () => {
  const unsent = charge("unsent", NOW, { requestCount: 0 });
  assert.equal(costEntryWorstCaseUsd(unsent), 0);
  assert.equal(pricedModelCharge(unsent, "u")?.usd, 0);

  const bound = modelRequestBoundFor(haiku, 40_000, 4096)!;
  const lost = charge("lost", NOW, { usd: null, requestCount: 4, inputTokens: 3000, outputTokens: 300,
    uncachedInputTokens: 3000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0 },
  { modelRequestBound: bound, requestedModel: haiku });
  const answered = pricedModelCharge({ ...lost, modelRequestBound: undefined }, "answered")!;
  const priced = pricedModelCharge(lost, "lost")!;
  assert.ok(answered.usd > 0 && answered.measured);
  assert.ok(Math.abs(priced.usd - (answered.usd + bound.usd)) < 1e-12, "the measured turns plus the one lost request");
  assert.equal(priced.bounded, true);
  assert.ok(priced.usd < costEntryWorstCaseUsd({ ...lost, cost: { ...lost.cost, inputTokens: null, outputTokens: null } }) / 10,
    "far under the context-window worst case the 13 Oct trip counted");

  const unknown = charge("unknown", NOW, { usd: null, requestCount: null });
  assert.equal(pricedModelCharge(unknown, "x")?.usd, costEntryWorstCaseUsd(unknown), "a sent request with no bound stays at its worst case");
});

test("the cache and capacity readings come from the counter, matching the ledger rows they replace, and the round scans no cost rows", async () => {
  const repos = createMemoryRepositories();
  const metering = { uncachedInputTokens: 1200, cacheReadInputTokens: 30_000, cacheCreationInputTokens: 2000, cacheCreation5mInputTokens: 2000, cacheCreation1hInputTokens: 0 };
  const rows = [charge("s1", at(1), { usd: 0.02, requestCount: 3, inputTokens: 33_200, outputTokens: 900, ...metering }),
    charge("s2", at(3), { usd: 0.01, requestCount: 2, inputTokens: 33_200, outputTokens: 400, ...metering }),
    { ...charge("audit", at(2), { usd: 0.004, requestCount: 1, inputTokens: 33_200, outputTokens: 100, ...metering }), role: "ADVERSARIAL_AUDITOR" as const }];
  for (const row of rows) await recordCost(repos, row, row.recordedAt);
  const ledger = await repos.costs.readAll();
  const counted = (await readSpendWindow(repos, NOW)).map(row => row.metered);
  assert.deepEqual(cacheHitRateByRole({ costs: counted, results: [], sinceIso: at(24), untilIso: NOW }),
    cacheHitRateByRole({ costs: ledger, results: [], sinceIso: at(24), untilIso: NOW }));
  const capacity = { nowIso: NOW, windowHours: 24, ceilingUsd: 100 };
  assert.deepEqual(scoutCapacity({ ...capacity, costs: counted }), scoutCapacity({ ...capacity, costs: ledger }));
  const round = await readFile(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.doesNotMatch(round, /costs\.readSince\(/);
});


test("file-store migration preserves held prices, replays recent costs and deletes the retired counter", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ms01-charges-"));
  try {
    const now = new Date().toISOString();
    const older = charge("held", now, { usd: 3, requestCount: 1 });
    const missing = charge("missing", now, { usd: 0.5, requestCount: 1 });
    const log = fileAppendOnlyRepository<CostEntry>(root, "costs");
    await log.append(older.workItemId, costRecordId(older), older, now);
    await log.append(missing.workItemId, costRecordId(missing), missing, now);
    const held = { ...pricedModelCharge(older, costRecordId(older))!, usd: 0.125, knownUsd: 0.125 };
    await fileAggregateRepository(root, "SpendWindow", "spend-window").put("model-charges", { charges: [held] }, now);
    const repos = await createFileRepositories(root);
    const query = { since: new Date(Date.parse(now) - 86_400_000).toISOString(), until: now };
    assert.equal((await repos.modelCharges.totals(query)).usd, 0.625);
    await assert.rejects(access(path.join(root, "aggregates", "spend-window")), { code: "ENOENT" });
    assert.equal((await (await createFileRepositories(root)).modelCharges.totals(query)).usd, 0.625);
  } finally { await rm(root, { recursive: true, force: true }); }
});
