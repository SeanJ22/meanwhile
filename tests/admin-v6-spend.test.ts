import assert from "node:assert/strict";
import test from "node:test";
import { SPEND_SQL, WORK_SQL, modelLabel, neonTransferOf, spendView, workCosts, workName, type SpendRowRaw } from "../lib/control-plane/admin-view/v6-spend-read.ts";

const row = (day: string, role: string, model: string | null, usd: number | null, n = 1): SpendRowRaw => ({ month: day.slice(0, 7), day, role, model, usd, n });
/** A row older than the day window: it counts toward its month only. */
const old = (month: string, role: string, model: string | null, usd: number | null, n = 1): SpendRowRaw => ({ month, day: null, role, model, usd, n });
const NOT_RECORDED = neonTransferOf({ kind: "NOT_INSTALLED", rows: [], detail: "Daily database transfer is not recorded until migration 0030 is applied." });

test("models are named by catalog tier, older versions by family, and anything else is not recorded", () => {
  assert.deepEqual(modelLabel("claude-haiku-5-5-20261001"), { key: "haiku", tier: "haiku", name: "Claude Haiku 5.5" });
  assert.equal(modelLabel("claude-sonnet-5-5").tier, "sonnet");
  assert.equal(modelLabel("claude-opus-5-5").tier, "opus");
  const older = modelLabel("claude-opus-5");
  assert.equal(older.tier, "older");
  assert.match(older.name, /^Opus 5 \(older/);
  assert.equal(modelLabel(null).tier, "unrecorded");
  assert.equal(modelLabel("route-executor/1.0").tier, "unrecorded");
});

test("spend is priced dollars by tier and by Eastern day, search kept apart, unpriced rows counted beside", () => {
  const view = spendView([
    row("2026-09-28", "SCOUT", "claude-haiku-5-5-20261001", 27.3), row("2026-09-28", "SCOUT", "claude-sonnet-5-5", 3.0, 2),
    row("2026-09-28", "DISCOVERY_SEARCH", null, 0.012), row("2026-09-27", "SCOUT", null, 0.4), row("2026-09-27", "SCOUT", "claude-opus-5", null, 5), row("2026-09-27", "SCOUT", "claude-opus-5-5", 0),
  ], NOT_RECORDED);
  assert.deepEqual(view.byTier.map((t) => [t.tier, t.usd]), [["haiku", 27.3], ["sonnet", 3], ["unrecorded", 0.4]]);
  assert.equal(view.anthropicUsd, 30.7);
  assert.equal(view.searchUsd, 0.012);
  assert.equal(view.unpricedRows, 5, "an unpriced row is counted, never priced at $0");
  assert.deepEqual(view.byDay.map((d) => d.day), ["2026-09-28", "2026-09-27"], "newest day first");
  assert.equal(view.byDay[0].searchUsd, 0.012);
  assert.equal(view.byDay[0].anthropicUsd, 30.3);
  assert.ok(view.byDay.every((d) => d.day !== "2026-09-29"), "a day with no rows is absent, not zero");
});

test("the database counter reads 'not recorded yet' until installed, then sums its clients per day, newest first", () => {
  assert.equal(NOT_RECORDED.kind, "not-recorded");
  assert.match(NOT_RECORDED.detail ?? "", /migration 0030/);
  assert.equal(neonTransferOf(null).kind, "not-recorded");
  const recorded = neonTransferOf({ kind: "RECORDED", rows: [
    { day: "2026-09-29", database: "reader", client: "reader", requests: 2, requestBytes: 10, responseBytes: 100 },
    { day: "2026-09-30", database: "reader", client: "reader", requests: 1, requestBytes: 5, responseBytes: 50 },
    { day: "2026-09-30", database: "reader", client: "runner", requests: 3, requestBytes: 6, responseBytes: 70 },
  ] });
  assert.deepEqual(recorded.days, [{ day: "2026-09-30", responseBytes: 120, requestBytes: 11, requests: 4 }, { day: "2026-09-29", responseBytes: 100, requestBytes: 10, requests: 2 }]);
});

test("the ledger is aggregated in the database, in Eastern days, with a split charge counted at each model's own share", () => {
  assert.match(SPEND_SQL, /America\/New_York/);
  assert.match(SPEND_SQL, /jsonb_array_elements/);
  assert.match(SPEND_SQL, /GROUP BY 1, 2, 3, 4/);
  assert.match(WORK_SQL, /LIMIT \$2::int/, "the costliest-work read is bounded");
});

test("months add up every priced row, days only the recent ones, and the month in progress comes first", () => {
  const view = spendView([
    row("2026-09-28", "SCOUT", "claude-haiku-5-5-20261001", 2), row("2026-09-27", "SCOUT", "claude-sonnet-5-5", 1), row("2026-09-27", "DISCOVERY_SEARCH", null, 0.5),
    old("2026-09", "SCOUT", "claude-haiku-5-5-20261001", 10), old("2026-08", "SCOUT", "claude-opus-5-5", 4, 3), old("2026-08", "SCOUT", "claude-opus-5-5", null, 2),
  ], NOT_RECORDED);
  assert.deepEqual(view.byMonth.map((m) => [m.month, m.anthropicUsd, m.searchUsd]), [["2026-09", 13, 0.5], ["2026-08", 4, 0]]);
  assert.deepEqual(view.byMonth[0].byTier.map((t) => [t.name, t.usd]), [["Claude Haiku 5.5", 12], ["Claude Sonnet 5.5", 1]].map(([n, u]) => [n, u]));
  assert.equal(view.anthropicUsd, 3, "the day window is only the recent rows");
  assert.equal(view.unpricedRows, 0, "an unpriced row outside the day window is not counted against the days");
});

test("work is named by its place and kind of record, and its tiers, moves and results are read from the ledger", () => {
  assert.equal(workName("freshness:jurisdiction:az:city:city-of-phoenix#campaign-finance-0", "az:city:city-of-phoenix"), "City of Phoenix, AZ · campaign finance");
  assert.equal(workName("scout-prewarm", null), "Hourly prompt-cache warm-up (no place)");
  assert.equal(workName("mystery-work", null), "mystery-work");
  const [moved, stayed, unknown] = workCosts([
    { work: "freshness:jurisdiction:nh:county:merrimack#officeholders-0", jurisdiction: "nh:county:merrimack", usd: 1.23456, unpriced: false, tries: 3,
      models: ["claude-sonnet-5-5", "claude-haiku-5-5-20261001"], outcomes: ["EVIDENCE_FOUND", "NO_PROGRESS"], refused: 0 },
    { work: "x#meetings-1", jurisdiction: "az:city:city-of-tucson", usd: 0.2, unpriced: false, tries: 1, models: ["claude-haiku-5-5-20261001"], outcomes: [], refused: 1 },
    { work: "y", jurisdiction: null, usd: 5, unpriced: true, tries: 2, models: [], outcomes: [], refused: 0 },
  ]);
  assert.equal(moved.models, "Claude Haiku 5.5 → Claude Sonnet 5.5");
  assert.match(moved.movedUpWhy, /Started on Claude Haiku 5\.5 and moved up to Claude Sonnet 5\.5; the reason isn’t saved/);
  assert.equal(moved.benefit, "Found the record, Nothing yet");
  assert.equal(moved.costUsd, 1.2346);
  assert.deepEqual(moved.applies, ["st:nh"]);
  assert.equal(stayed.movedUpWhy, "Stayed on the same AI");
  assert.equal(stayed.benefit, "Its finish was refused");
  assert.equal(unknown.costUsd, null, "a piece of work with an unpriced charge is unknown, never a partial total");
  assert.equal(unknown.models, "Model not recorded");
});

test("the rolling 24 hours is read from the ledger as model money (search apart), and Scout results become one line per kind of work", async () => {
  const { ROLLING_SQL, OUTCOMES_SQL, scoutOutcomeLines } = await import("../lib/control-plane/admin-view/v6-spend-read.ts");
  assert.match(ROLLING_SQL, /interval '24 hours'/);
  assert.match(ROLLING_SQL, /role <> 'DISCOVERY_SEARCH'/);
  assert.match(OUTCOMES_SQL, /GROUP BY 1, 2/);
  assert.deepEqual(scoutOutcomeLines([
    { recordClass: "local-jurisdiction", outcome: "NO_PROGRESS", n: 87 }, { recordClass: "local-jurisdiction", outcome: "EVIDENCE_FOUND", n: 12 }, { recordClass: "local-jurisdiction", outcome: "ROUTE_CANDIDATE", n: 12 },
    { recordClass: "meetings-discovery", outcome: "EVIDENCE_FOUND", n: 3 }, { recordClass: null, outcome: "BLOCKED", n: 1 },
  ]), [
    { recordClass: "local-jurisdiction", found: 12, route: 12, total: 111 },
    { recordClass: "meetings-discovery", found: 3, route: 0, total: 3 },
    { recordClass: "unrecorded", found: 0, route: 0, total: 1 },
  ]);
});
