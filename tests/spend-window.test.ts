import test from "node:test";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileRepositories, fileAggregateRepository, fileAppendOnlyRepository } from "../lib/control-plane/repository/file-store.ts";
import { PGlite } from "@electric-sql/pglite";
import { MODEL_CHARGES_DDL, pgSpendRepository } from "../lib/control-plane/repository/model-charges.ts";
import type { SpendHold } from "../lib/control-plane/budget.ts";
import assert from "node:assert/strict";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import { costEntryWorstCaseUsd, modelRequestBoundFor, type CostEntry } from "../lib/control-plane/cost.ts";
import { aggregatePricedSpend, pricedModelCharge } from "../lib/control-plane/fleet-safety.ts";
import { MODELS } from "../lib/models.ts";
import { cacheHitRateByRole, scoutCapacity, scoutCapacityFromTotals } from "../lib/control-plane/research-metrics.ts";
import { recordCost } from "../lib/control-plane/repository/coordinator.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { costRecordId, readSpendWindow, summarizeCharges } from "../lib/control-plane/spend-window.ts";

const NOW = "2026-10-13T19:00:00.000Z";
const haiku = MODELS.haiku.model;
const at = (hoursAgo: number) => new Date(Date.parse(NOW) - hoursAgo * 3_600_000).toISOString();
const charge = (id: string, recordedAt: string, cost: Partial<CostEntry["cost"]>, extra: Partial<CostEntry> = {}): CostEntry => ({
  attemptId: id, workItemId: `wi-${id}`, routeTaskId: `rt-${id}`, routeId: null, source: "api.anthropic.com", jurisdiction: null,
  project: "freshness", role: "SCOUT", model: haiku, recordedAt, cost: { ...ZERO_COST, ...cost }, ...extra,
});

test("immutable charges count once and admissions read one aggregate", async () => {
  const repos = createMemoryRepositories();
  const rows = [
    charge("a", at(1), { usd: 0.25, requestCount: 3 }),
    charge("b", at(2), { usd: 1.5, requestCount: 2 }),
    { ...charge("plain", at(1), { requestCount: 4 }), role: "ACQUIRER" as const, source: "api.marginalia.nu", model: null },
  ];
  for (const row of rows) await recordCost(repos, row, row.recordedAt);
  await recordCost(repos, rows[0]!, rows[0]!.recordedAt);
  const held = await readSpendWindow(repos, NOW);
  assert.equal(held.measured, 2, "plain code adds nothing and a retried write counts once");
  const priced = (await repos.costs.readAll()).flatMap(row => pricedModelCharge(row, costRecordId(row)) ?? []);
  assert.equal(held.windowUsd, aggregatePricedSpend(priced, at(24), NOW).usd);
  assert.equal(held.windowUsd, 1.75);
});

test("rolling boundaries expire without deleting lifetime budget charges", async () => {
  const repos = createMemoryRepositories();
  for (const row of [charge("old", at(40), { usd: 9 }), charge("edge", at(24), { usd: 2 }), charge("new", NOW, { usd: 1 })]) {
    await recordCost(repos, row, row.recordedAt);
  }
  assert.equal((await readSpendWindow(repos, NOW)).windowUsd, 3);
  assert.equal((await readSpendWindow(repos, new Date(Date.parse(NOW) + 1).toISOString())).windowUsd, 1);
  const later = new Date(Date.parse(NOW) + 31 * 3_600_000).toISOString();
  await recordCost(repos, charge("next-day", later, { usd: 0.5 }), later);
  assert.equal((await readSpendWindow(repos, later)).windowUsd, 0.5);
  assert.equal((await repos.spend.aggregate({ since: at(48), until: later })).usd, 12.5);
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

test("cache and capacity summaries match ledger measures without scanning cost rows in the runner", async () => {
  const repos = createMemoryRepositories();
  const metering = { uncachedInputTokens: 1200, cacheReadInputTokens: 30_000, cacheCreationInputTokens: 2000, cacheCreation5mInputTokens: 2000, cacheCreation1hInputTokens: 0 };
  const rows = [charge("s1", at(1), { usd: 0.02, requestCount: 3, inputTokens: 33_200, outputTokens: 900, ...metering }),
    charge("s2", at(3), { usd: 0.01, requestCount: 2, inputTokens: 33_200, outputTokens: 400, ...metering }),
    { ...charge("audit", at(2), { usd: 0.004, requestCount: 1, inputTokens: 33_200, outputTokens: 100, ...metering }), role: "ADVERSARIAL_AUDITOR" as const }];
  for (const row of rows) await recordCost(repos, row, row.recordedAt);
  const ledger = await repos.costs.readAll();
  const counted = await repos.spend.metrics({ since: at(24), until: NOW });
  assert.deepEqual(counted.cache,
    cacheHitRateByRole({ costs: ledger, results: [], sinceIso: at(24), untilIso: NOW }));
  const capacity = { nowIso: NOW, windowHours: 24, ceilingUsd: 100 };
  assert.deepEqual(scoutCapacityFromTotals({ ...capacity, totals: counted.scout }), scoutCapacity({ ...capacity, costs: ledger }));
  const round = await readFile(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.doesNotMatch(round, /costs\.readSince\(/);
});

async function database() {
  const db = new PGlite();
  const statements: string[] = [];
  const sql = { async query(text: string, params?: readonly unknown[]) {
    statements.push(text);
    return (await db.query(text, params ? [...params] : undefined)).rows;
  } };
  for (const ddl of MODEL_CHARGES_DDL) await sql.query(ddl);
  await sql.query("CREATE TABLE cp_log_scout_results (log_key text, position bigint, record jsonb)");
  return { db, sql, statements, spend: pgSpendRepository(sql) };
}

test("Postgres concurrent writers are idempotent; admissions preserve exact bounds, task exclusions and holds", async () => {
  const { db, spend, statements } = await database();
  try {
    const rows = Array.from({ length: 80 }, (_, i) => pricedModelCharge(charge(`parallel-${i}`, at(i % 25), { usd: 0.25 },
      { spendHoldJobId: `job-${i}`, obligationId: `ob-${i}`, jurisdiction: `place-${i % 50}` }), `id-${i}`)!);
    await Promise.all(rows.flatMap(row => [spend.record(row), spend.record(row), spend.record(row)]));
    const expected = aggregatePricedSpend(rows, at(24), NOW);
    assert.deepEqual(await spend.aggregate({ since: at(24), until: NOW }), { ...expected, bySubject: 0 });
    const edge = await spend.aggregate({ since: new Date(Date.parse(at(24)) + 1).toISOString(), until: NOW });
    assert.equal(edge.usd, expected.usd - rows.filter(row => row.at === at(24)).length * 0.25);
    const bound = { ...rows[0], id: "bound", jobId: "bound-job", usd: 10, knownUsd: 0, measured: false, bounded: true };
    await spend.record(bound);
    const holds = [{ holdId: "h", jobId: "bound-job", usd: 2, heldAt: NOW, settled: null },
      { holdId: "unmatched", jobId: "search", usd: 20, heldAt: NOW, settled: null }] as SpendHold[];
    assert.equal((await spend.aggregate({ since: at(24), until: NOW, holds: [...holds, holds[0]] })).usd, expected.usd + 2);
    const excludeTasks = [{ id: rows[0].routeTaskId!, since: NOW }];
    const selected = [...rows, bound].filter(row => row.routeTaskId !== rows[0].routeTaskId || row.at < NOW);
    assert.equal((await spend.aggregate({ since: at(24), until: NOW, excludeTasks })).usd,
      aggregatePricedSpend(selected, at(24), NOW).usd);
    const reads = statements.filter(statement => statement.startsWith("SELECT") || statement.startsWith("WITH"));
    assert.ok(reads.every(statement => !statement.includes("SELECT charge") && !statement.includes("SELECT *")));
    assert.equal(statements.filter(statement => statement.startsWith("INSERT")).length, 241);
    const assignmentRows = [
      { ...rows[0], id: "send-exact", obligationId: "send-work", jurisdiction: "send-place", at: at(2), assignmentRefs: [{ key: "send", ref: "current" }] },
      { ...rows[0], id: "send-old", obligationId: "send-work", jurisdiction: "send-place", at: at(2), assignmentRefs: [{ key: "send", ref: "old" }] },
      { ...rows[0], id: "send-before-membership", obligationId: "send-work", jurisdiction: "send-place", at: at(4) },
      { ...rows[0], id: "send-subject", obligationId: null, jurisdiction: "send-place", at: at(2) },
      { ...rows[0], id: "send-unrelated-obligation", obligationId: "different-work", jurisdiction: "send-place", at: at(2) },
      { ...rows[0], id: "send-legacy", obligationId: "send-work", jurisdiction: "send-place", at: at(2) },
    ];
    for (const row of assignmentRows) await spend.record(row);
    const query = { since: at(24), until: NOW, assignment: { key: "send", ref: "current",
      obligations: [{ id: "send-work", since: at(3) }], subjects: [{ id: "send-place", since: at(3) }] } };
    assert.deepEqual(await spend.aggregate(query), summarizeCharges(assignmentRows, query));
    assert.equal((await spend.aggregate(query)).usd, 0.75);

  } finally { await db.close(); }
});

test("SQL cache and capacity summaries match the existing Admin measures", async () => {
  const { db, sql, spend } = await database();
  try {
    const metering = { uncachedInputTokens: 1200, cacheReadInputTokens: 30_000, cacheCreationInputTokens: 2000, cacheCreation5mInputTokens: 2000, cacheCreation1hInputTokens: 0 };
    const entries = [charge("cache-a", at(1), { usd: 0.02, requestCount: 3, inputTokens: 33_200, outputTokens: 900, ...metering }),
      charge("cache-b", at(2), { usd: 0.01, requestCount: 2, inputTokens: 33_200, outputTokens: 400, batch: true, ...metering }),
      charge("unreported", at(2), { usd: null, requestCount: 1 }),
      charge("outside", at(25), { usd: 20, requestCount: 1 })];
    for (const entry of entries) await spend.record(pricedModelCharge(entry, costRecordId(entry))!);
    const results = [{ attemptId: "cache-a", steps: [
      { kind: "MODEL", step: "scout-research-loop", turn: 1, tokens: { cacheRead: 0 } },
      { kind: "MODEL", step: "scout-research-loop", turn: 2, tokens: { cacheRead: 100 } },
      { kind: "MODEL", step: "other", turn: 2, tokens: { cacheRead: 0 } },
    ], cacheDefect: { stationaryTurns: [2] } }];
    await sql.query("INSERT INTO cp_log_scout_results VALUES ('work',1,$1::jsonb)", [JSON.stringify(results[0])]);
    const metrics = await spend.metrics({ since: at(24), until: NOW });
    assert.deepEqual(metrics.cache, cacheHitRateByRole({ costs: entries, results: results as never, sinceIso: at(24), untilIso: NOW }));
    const input = { nowIso: NOW, windowHours: 24, ceilingUsd: 100 };
    assert.deepEqual(scoutCapacityFromTotals({ ...input, totals: metrics.scout }), scoutCapacity({ ...input, costs: entries }));
  } finally { await db.close(); }
});

test("file migration streams old charge snapshots, keeps their prices and removes the old directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "cp01-spend-"));
  try {
    const old = fileAggregateRepository<{ charges: ReturnType<typeof pricedModelCharge>[] }>(root, "SpendWindow", "spend-window");
    const costs = fileAppendOnlyRepository<CostEntry>(root, "costs");
    const entry = charge("saved-price", at(1), { usd: 1 });
    const held = { ...pricedModelCharge(entry, costRecordId(entry))!, usd: 7, knownUsd: 7,
      jurisdiction: 'place-"quoted\\braces{}[]' + "x".repeat(100_000) };
    await old.put("model-charges", { charges: [] }, NOW);
    await old.compareAndSet("model-charges", 1, { charges: [held] }, NOW);
    await costs.append("work", "priced", entry, entry.recordedAt);
    const older = charge("lifetime-file", at(100), { usd: 5 });
    await costs.append("work", "older", older, older.recordedAt);
    const repos = await createFileRepositories(root);
    assert.equal((await readSpendWindow(repos, NOW)).usd, 7);
    assert.equal((await repos.spend.aggregate({ since: at(120), until: NOW })).usd, 12);
    await assert.rejects(stat(join(root, "aggregates", "spend-window")), { code: "ENOENT" });
    const reopened = await createFileRepositories(root);
    assert.equal((await readSpendWindow(reopened, NOW)).usd, 7);
  } finally { await rm(root, { recursive: true, force: true }); }
});
