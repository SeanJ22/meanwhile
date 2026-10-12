/**
 * The first test re-reads the executors, so ROLE_COST_POLICY cannot call a role plain code once an executor hands
 * it a model. It carries a planted positive control, because a sweep never seen to fire proves nothing.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ZERO_COST, WORKER_ROLES, type AttemptCost, type WorkerRole } from "../lib/control-plane/attempt.ts";
import { entriesInWindow, utcMonthWindow, type CostEntry } from "../lib/control-plane/cost.ts";
import {
  ATTEMPT_NOT_ON_RECORD,
  COST_CLASS_WORDS,
  DEFAULT_DAILY_CEILING_USD,
  MONTHLY_TOKEN_METRICS,
  NO_MODEL_KEY,
  ROLE_COST_POLICY,
  buildCostPanel,
  buildMonthlySpend,
  capacitySentence,
  costClassOf,
  modelLabel,
  roleBarClass,
  shareSentence,
  spendWindowRows,
  utcStamp,
  costSectionNumbers,
} from "../lib/control-plane/cost-panel.ts";
import { auditRenderedNumbers, gap, held, measured } from "../lib/control-plane/owner-surface.ts";
import { codeOf } from "./read-code.ts";

const CEILINGS = { rolling24HourModelUsd: 25 };

function entry(
  attemptId: string,
  role: WorkerRole,
  usd: number | null,
  recordedAt: string,
  cost: Partial<AttemptCost> = {},
): CostEntry {
  return {
    attemptId,
    workItemId: "w",
    routeTaskId: null,
    routeId: null,
    source: null,
    jurisdiction: null,
    project: "freshness",
    role,
    cost: { ...ZERO_COST, usd, ...cost },
    recordedAt,
  };
}

/** A row whose cost object PREDATES the six metering fields: they are absent, not null. */
function predatingCost(usd: number | null): AttemptCost {
  return { inputTokens: null, outputTokens: null, usd, durationMs: null, bytesFetched: null, requestCount: 1 } as unknown as AttemptCost;
}

test("§9A.4: every role the cost policy calls plain code is one no executor hands a model to, re-read from the code", () => {
  /* The table covers every role there is; a new role cannot slip past it. */
  assert.deepEqual(
    [...WORKER_ROLES].sort(),
    Object.keys(ROLE_COST_POLICY).sort(),
    "ROLE_COST_POLICY must name every worker role, or a role classifies as nothing",
  );
  for (const role of WORKER_ROLES) {
    assert.equal(ROLE_COST_POLICY[role].role, role, "each entry names itself");
    assert.ok(ROLE_COST_POLICY[role].provenIn.includes("lib/"), `${role} must cite the file that proves it`);
  }
  assert.deepEqual(
    WORKER_ROLES.filter((r) => ROLE_COST_POLICY[r].access === "ROUTED_TO_A_PAID_MODEL").sort(),
    ["ADVERSARIAL_AUDITOR", "DETECTIVE", "PARSER", "SCOUT"],
    "every role that may escalate is distinguished from roles that always run plain code",
  );

  /* `assertStepMayInvokeModel` is the one gate before any transport call, so every model-spending path in lib/ calls it. */
  const callers = ["scheduler/scout-executor.ts", "workers/model-audit.ts", "workers/model-parser.ts", "scheduler/model-routing.ts"];
  const swept: string[] = [];
  for (const file of ["scheduler/scout-executor.ts", "workers/model-audit.ts", "workers/model-parser.ts", "workers/runtime.ts", "workers/research-runtime.ts", "scheduler/model-routing.ts", "scheduler/dispatch.ts"]) {
    const code = codeOf("lib/control-plane", file);
    assert.ok(code.length > 500, `the sweep must reach ${file}; read ${code.length} chars`);
    if (/assertStepMayInvokeModel\s*\(/.test(code)) swept.push(file);
  }
  assert.deepEqual(swept.sort(), [...callers].sort(), "a new caller of the model gate means a new row in ROLE_COST_POLICY");

  const scout = codeOf("lib/control-plane/scheduler", "scout-executor.ts");
  assert.match(scout, /role:\s*deps\.role\s*\?\?\s*"SCOUT",\s*provider:\s*"anthropic"/, "the shared research executor declares the Anthropic provider for its selected role");

  const runtime = codeOf("lib/control-plane/workers", "runtime.ts");
  assert.match(
    runtime,
    /role === "ADVERSARIAL_AUDITOR" && runtime\.auditReasoner !== undefined/,
    "the adversarial audit retains its model path",
  );
  const otherAssisted = [...runtime.matchAll(/role === "([A-Z_]+)"[^;\n]*auditReasoner/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(otherAssisted)], ["ADVERSARIAL_AUDITOR"], "only one role is ever model-assisted here");
  assert.match(runtime, /const parseAssisted = usesModelParse\(runtime, spec\)/, "Parser model fallback is included in the spend policy");

  const research = codeOf("lib/control-plane/workers", "research-runtime.ts");
  assert.match(research, /spec\.role !== "ACQUIRER"/, "the research executor still owns exactly the acquirer role");
  assert.match(research, /provider:\s*"we-the-people"/, "and still declares itself deterministic");
  assert.doesNotMatch(research, /anthropic/i, "no Anthropic provider is declared for an acquirer Attempt");

  /* Positive control: the detector catches a runtime that model-assists a second role. */
  const PLANT = 'const assisted = role === "DETECTIVE" && runtime.auditReasoner !== undefined;';
  const planted = [...PLANT.matchAll(/role === "([A-Z_]+)"[^;\n]*auditReasoner/g)].map((m) => m[1]);
  assert.deepEqual(planted, ["DETECTIVE"], "the detector reads the role out of an assisted branch");
  assert.equal(ROLE_COST_POLICY.DETECTIVE.access, "ROUTED_TO_A_PAID_MODEL", "Detective failure response must never be presented as free by design");
});

test("ADM-33: a role that can spend and did not reads '$0 this run'; only a role the policy proves reads 'Plain code'", () => {
  const panel = buildCostPanel({
    costs: [
      entry("s1", "SCOUT", 0.31, "2026-09-06T10:00:00.000Z", { requestCount: 1 }),
      entry("z1", "ADVERSARIAL_AUDITOR", null, "2026-09-06T10:01:00.000Z", { requestCount: 1 }),
      entry("d1", "DETECTIVE", null, "2026-09-06T10:02:00.000Z", { requestCount: 1 }),
      entry("d2", "PARSER", null, "2026-09-06T10:03:00.000Z", { requestCount: 1 }),
    ],
    attempts: [
      { id: "s1", worker: { version: "claude-opus-5", provider: "anthropic" } },
      { id: "z1", worker: { version: "fleet/1", provider: "we-the-people" } },
      { id: "d1", worker: { version: "autonomous-research-workers/1.0.0", provider: "we-the-people" } },
      { id: "d2", worker: { version: "fleet/1", provider: "we-the-people" } },
    ],
    cacheByRole: null,
    share: null,
    verifiedRecords: null,
  });
  const of = (key: string) => costClassOf(panel.costByRole.find((r) => r.key === key)!);

  assert.equal(of("SCOUT").cls, "PAID_MODEL");
  assert.match(of("SCOUT").says, /\$0\.31 measured/);

  /* The auditor can spend, so its silence is not freedom. */
  assert.equal(of("ADVERSARIAL_AUDITOR").cls, "ZERO_THIS_RUN");
  assert.equal(of("ADVERSARIAL_AUDITOR").words, "$0 this run");
  assert.match(of("ADVERSARIAL_AUDITOR").says, /not a claim the role is free/);

  for (const role of ["DETECTIVE", "PARSER"]) {
    assert.equal(of(role).cls, "ZERO_THIS_RUN", `${role} can escalate, although these attempts ran plain code`);
    assert.match(of(role).says, /not a claim the role is free/);
    assert.ok(of(role).provenIn?.includes("lib/control-plane/workers/"), "and the row carries where that is written");
  }
});

test("ADM-33: a model attempt with no dollars is 'Not measured'; rows predating the fields say so; a missing Attempt is a named join gap", () => {
  const unmeasured = costClassOf({
    key: "SCOUT",
    kind: "UNMEASURED",
    usd: gap("OURS", "1 model attempt of 1 reported no dollar cost."),
    attemptsMeasured: 0,
    attemptsUnmeasured: 1,
    metering: { measured: 0, predatesFields: 0, unreported: 1, batched: 0 },
  });
  assert.equal(unmeasured.cls, "NOT_MEASURED");
  assert.match(unmeasured.says, /not zero, and not free/);

  const old = costClassOf({
    key: "SCOUT",
    kind: "UNMEASURED",
    usd: gap("OURS", "3 model attempts of 3 reported no dollar cost."),
    attemptsMeasured: 0,
    attemptsUnmeasured: 3,
    metering: { measured: 0, predatesFields: 3, unreported: 0, batched: 0 },
  });
  assert.equal(old.cls, "PREDATES_MEASUREMENT");
  assert.equal(old.words, "Predates measurement fields");
  assert.match(old.says, /nothing here is a zero/);

  const orphan = costClassOf({ key: ATTEMPT_NOT_ON_RECORD, kind: "FREE_BY_DESIGN", usd: held(measured(0, 1, "c", "s")), attemptsMeasured: 0, attemptsUnmeasured: 2 });
  assert.equal(orphan.cls, "NOT_MEASURED", "a join gap is never read as evidence that nothing spent");
  assert.match(orphan.says, /not in the attempts list/);

  assert.equal(costClassOf({ key: NO_MODEL_KEY, kind: "FREE_BY_DESIGN", usd: held(measured(0, 0, "c", "s")) }).cls, "PLAIN_CODE");
  assert.deepEqual(Object.values(COST_CLASS_WORDS).sort(), ["$0 this run", "Not measured", "Paid model", "Plain code", "Predates measurement fields"]);
});

test("ADM-26: the three windows render as the brief's own rows, to the cent, and an unmeasured window is never $0.00", () => {
  const rows = spendWindowRows({ cycleUsd: 0, operationalNightUsd: 0, rolling24HourUsd: 0.4404, ceilings: CEILINGS });
  assert.deepEqual(rows.map((r) => r.window), ["Current cycle", "Operational night", "Last 24 hours"]);
  // Every window is framed against the one rolling daily ceiling.
  assert.deepEqual(rows.map((r) => r.shown), ["$0.00 of $25.00", "$0.00 of $25.00", "$0.44 of $25.00"]);
  assert.ok(rows[1].defines?.includes("6pm to 6am"), "the one window whose name does not explain itself is defined");
  assert.ok(rows.every((r) => !r.unmeasured));

  const blind = spendWindowRows({ cycleUsd: null, operationalNightUsd: 0, rolling24HourUsd: 0, ceilings: CEILINGS });
  assert.equal(blind[0].unmeasured, true);
  assert.doesNotMatch(blind[0].shown, /\$0\.00 of/);
  assert.match(blind[0].shown, /not measured/);
});

test("§9A.4: the capacity sentence is computed from the ledger and matches the owner's shape; an unmeasured window says so", () => {
  const now = "2026-09-06T18:00:00.000Z";
  /* Six hunts at $0.3164 each: $100 / 0.3164 = 316.05 -> 316. */
  const costs = Array.from({ length: 6 }, (_, i) => entry(`s${i}`, "SCOUT", 0.3164, "2026-09-06T12:00:00.000Z"));
  const panel = buildCostPanel({ costs, attempts: [], cacheByRole: null, share: null, verifiedRecords: null, nowIso: now, dailyCeilingUsd: 100 });
  assert.equal(
    capacitySentence(panel.capacity),
    "At the current average cost, the $100.00 daily limit buys about 316 hunts at roughly $0.32 each.",
  );
  assert.equal(DEFAULT_DAILY_CEILING_USD, 0, "a missing Admin spend dial does not authorize a fixed dollar budget");

  const quiet = buildCostPanel({
    costs: [entry("s9", "SCOUT", null, "2026-09-06T12:00:00.000Z")],
    attempts: [],
    cacheByRole: null,
    share: null,
    verifiedRecords: null,
    nowIso: now,
  });
  const says = capacitySentence(quiet.capacity);
  assert.match(says, /not measured — which is not the same as it buying nothing/);
  assert.doesNotMatch(says, /buys about 0/);

  assert.equal(buildCostPanel({ costs, attempts: [], cacheByRole: null, share: null, verifiedRecords: null }).capacity, null, "no clock, no window, no figure");
  assert.match(capacitySentence(null), /not published on this snapshot yet/);
});

test("ADM-47: each of the three zeroes on the model share says which zero it is", () => {
  assert.equal(shareSentence(held(measured(0, 0, "c", "s"))), "0% model work this cycle — nothing was dispatched.");
  assert.equal(
    shareSentence(held(measured(5, 5, "c", "s"))),
    "0% model work this cycle — all 5 jobs ran as plain code, with no paid model.",
  );
  assert.equal(shareSentence(held(measured(7, 10, "c", "s"))), "70% of this cycle's 10 jobs ran as plain code; 3 used a paid model.");
  assert.equal(shareSentence(gap("OURS", "no cycle has recorded its lane split yet.")), "no cycle has recorded its lane split yet.");
});

test("§9A.23: the window is the UTC calendar month, and the UTC/Eastern day edge does not move it", () => {
  const mid = utcMonthWindow("2026-09-06T18:00:00.000Z");
  assert.equal(mid.since, "2026-09-01T00:00:00.000Z");
  assert.equal(mid.until, "2026-09-06T18:00:00.000Z", "the open month runs to the instant of the reading");
  assert.equal(mid.resetsAt, "2026-10-01T00:00:00.000Z");
  assert.equal(mid.label, "September 2026");
  assert.equal(mid.complete, false);

  /*
   * THE UTC-vs-EASTERN EDGE. 2026-09-01T02:00Z is still 31 August, 10pm in New
   * York. The console's spend bars would bucket it in August; this window must
   * not, because the funds reset on the UTC boundary.
   */
  const edge = utcMonthWindow("2026-09-01T02:00:00.000Z");
  assert.equal(edge.since, "2026-09-01T00:00:00.000Z");
  assert.equal(edge.label, "September 2026");
  const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date("2026-09-01T02:00:00.000Z"));
  assert.equal(easternDay, "2026-08-31", "the same instant really is still August in Eastern time");

  /* The first millisecond of a month, and the last. */
  const first = utcMonthWindow("2026-09-01T00:00:00.000Z");
  assert.equal(first.since, first.until, "at the boundary the open window is a single instant, not a whole month");
  const dec = utcMonthWindow("2026-12-14T00:00:00.000Z");
  assert.equal(dec.resetsAt, "2027-01-01T00:00:00.000Z", "December rolls into the next year");
  const janBack = utcMonthWindow("2027-01-14T00:00:00.000Z", 1);
  assert.equal(janBack.since, "2026-12-01T00:00:00.000Z");
  assert.equal(janBack.until, "2026-12-31T23:59:59.999Z", "a closed month ends on its own last millisecond");
  assert.equal(janBack.complete, true);

  /* Adjacent months neither overlap nor leave a gap. */
  const nov = utcMonthWindow("2027-01-14T00:00:00.000Z", 2);
  assert.equal(Date.parse(janBack.since) - Date.parse(nov.until), 1);

  assert.throws(() => utcMonthWindow("not a time"), /unreadable/);
  assert.throws(() => utcMonthWindow("2026-09-06T18:00:00.000Z", -1), /has not happened/);
  assert.equal(utcStamp("2026-10-01T00:00:00.000Z"), "1 October 2026, 00:00 UTC");
  assert.equal(utcStamp("nonsense"), "an unreadable time");
});

test("§9A.23: rows are counted into their own month, both bounds inclusive, and an unreadable stamp is dropped rather than filed at the epoch", () => {
  const rows = [
    entry("a", "SCOUT", 1, "2026-09-01T00:00:00.000Z"),
    entry("b", "SCOUT", 1, "2026-08-31T23:59:59.999Z"),
    entry("c", "SCOUT", 1, "2026-09-06T18:00:00.000Z"),
    entry("d", "SCOUT", 1, "whenever"),
  ];
  const september = entriesInWindow(rows, utcMonthWindow("2026-09-06T18:00:00.000Z"));
  assert.deepEqual(september.map((r) => r.attemptId), ["a", "c"], "both bounds inclusive; the August row stays in August");
  const august = entriesInWindow(rows, utcMonthWindow("2026-09-06T18:00:00.000Z", 1));
  assert.deepEqual(august.map((r) => r.attemptId), ["b"]);
  assert.equal(september.length + august.length, 2 + 1, "no row lands in two months and none is lost between them");
  assert.ok(!entriesInWindow(rows, utcMonthWindow("1970-01-15T00:00:00.000Z")).some((r) => r.attemptId === "d"));
});

test("§9A.23: an empty month is a month with nothing measured, never a month that cost $0.00", () => {
  const view = buildMonthlySpend({ costs: [], attempts: [], nowIso: "2026-09-06T18:00:00.000Z" });
  assert.equal(view.total.total, null);
  assert.equal(view.total.measured, 0);
  assert.deepEqual(view.byProvider, []);
  assert.equal(view.cacheSavingUsd, null);
  assert.equal(view.cacheHitRate.held, false, "an empty month has no hit rate — a gap, never a 0%");
  assert.equal(view.batchSavingUsd, null);
  assert.equal(view.ledgerBeginsAt, null);
  assert.deepEqual(view.history.map((h) => h.label), ["September 2026"], "no ledger history means no months to compare");
  for (const metric of MONTHLY_TOKEN_METRICS) assert.equal(view.tokens[metric].total, null, `${metric} is unmeasured, not zero`);
});

test("§9A.23: the month totals by provider, model and role, prices the savings once, and keeps unmeasured rows out of the dollars", () => {
  const now = "2026-09-06T18:00:00.000Z";
  const metered = { uncachedInputTokens: 1_000, cacheReadInputTokens: 40_000, cacheCreationInputTokens: 5_000, cacheCreation5mInputTokens: 5_000, cacheCreation1hInputTokens: 0, outputTokens: 900, inputTokens: 46_000, requestCount: 1 };
  const costs: CostEntry[] = [
    entry("s1", "SCOUT", 0.31, "2026-09-03T10:00:00.000Z", metered),
    entry("s2", "SCOUT", 0.09, "2026-09-04T10:00:00.000Z", { ...metered, cacheReadInputTokens: 0, batch: true }),
    entry("a1", "ACQUIRER", null, "2026-09-04T11:00:00.000Z", { requestCount: 2 }),
    { ...entry("o1", "SCOUT", 0.5, "2026-09-05T10:00:00.000Z"), cost: predatingCost(0.5) },
    entry("x1", "SCOUT", 4, "2026-08-14T10:00:00.000Z"),
  ];
  const attempts = [
    { id: "s1", worker: { version: "claude-opus-5", provider: "anthropic" } },
    { id: "s2", worker: { version: "claude-haiku-4-5", provider: "anthropic" } },
    { id: "a1", worker: { version: "deterministic-walker", provider: "we-the-people" } },
    { id: "o1", worker: { version: "claude-opus-5", provider: "anthropic" } },
    { id: "x1", worker: { version: "claude-opus-5", provider: "anthropic" } },
  ];
  const view = buildMonthlySpend({ costs, attempts, nowIso: now });

  assert.equal(view.window.label, "September 2026");
  assert.equal(view.total.total, 0.9, "0.31 + 0.09 + 0.50; the August row is another month and the null row is not a zero");
  assert.equal(view.total.measured, 3);
  assert.equal(view.total.unmeasured, 1);

  assert.deepEqual(view.byProvider.map((r) => [r.key, r.usd]), [["anthropic", 0.9], ["we-the-people", null]]);
  assert.deepEqual(view.byModel.map((r) => r.key), ["claude-opus-5", "claude-haiku-4-5", NO_MODEL_KEY]);
  assert.deepEqual(view.byRole.map((r) => [r.key, r.usd]), [["SCOUT", 0.9], ["ACQUIRER", null]]);

  /* 40,000 cache-read tokens on Opus 5 at $5/MTok saved 0.9 of the base rate. */
  assert.equal(view.cacheSavingUsd, 0.18);
  assert.equal(view.cacheSavingRows, 1, "the batched row read nothing from the cache, so it saved nothing there");
  assert.equal(view.batchRows, 1);
  assert.equal(view.batchSavingUsd, 0.09, "a batched row was charged half, so what it saved is what it cost");

  assert.deepEqual(view.unmeasured, { predatesFields: 1, providerReportedNothing: 1, noDollarFigure: 1 });
  assert.deepEqual(view.history.map((h) => [h.label, h.usd, h.complete]), [["September 2026", 0.9, false], ["August 2026", 4, true]]);
  assert.equal(view.ledgerBeginsAt, "2026-08-14T10:00:00.000Z");
  /* The billed quantities are carried per model, not only in aggregate. */
  const opus = view.byModel.find((r) => r.key === "claude-opus-5")!;
  const haiku = view.byModel.find((r) => r.key === "claude-haiku-4-5")!;
  assert.equal(opus.tokens.cacheReadInputTokens.total, 40_000, "only the Opus row read from the cache");
  assert.equal(haiku.tokens.cacheReadInputTokens.total, 0);
  assert.equal(haiku.batchedRows, 1);
  assert.equal(opus.batchedRows, 0);
  assert.equal(view.byModel.find((r) => r.key === NO_MODEL_KEY)!.tokens.inputTokens.total, null, "the deterministic rows reported no prompt at all");

  /* Per-model cache hit rate and saving are carried on the row, not recomputed in the render. */
  assert.ok(
    opus.cacheHitRate.held && opus.cacheHitRate.value.value === 40_000 && opus.cacheHitRate.value.denominator === 46_000,
    "Opus hit rate is cache reads / (reads + writes + uncached) = 40000 / 46000",
  );
  assert.equal(opus.cacheSavingUsd, 0.18, "Opus saved 0.18 on its 40k cache reads, the per-model half of the aggregate");
  assert.ok(
    haiku.cacheHitRate.held && haiku.cacheHitRate.value.value === 0 && haiku.cacheHitRate.value.denominator === 6_000,
    "Haiku read nothing from the cache: a real, measured 0% — not a gap",
  );
  assert.equal(haiku.cacheSavingUsd, null, "no cache read means no per-model saving to price, which is not a zero");
  const noModel = view.byModel.find((r) => r.key === NO_MODEL_KEY)!;
  assert.equal(noModel.cacheHitRate.held, false, "the deterministic rows carry no metering, so the hit rate is our named gap");
  assert.equal(noModel.cacheSavingUsd, null);
  assert.ok(
    view.cacheHitRate.held && view.cacheHitRate.value.value === 40_000 && view.cacheHitRate.value.denominator === 52_000,
    "the month's aggregate hit rate sums every model's input: 40000 / (40000 + 10000 + 2000)",
  );

  assert.equal(view.tokens.cacheReadInputTokens.total, 40_000);
  assert.equal(view.tokens.requestCount.total, 5, "1 + 1 + 2 + 1 across the four September rows");
  assert.equal(view.tokens.cacheCreation1hInputTokens.total, 0);
  assert.equal(view.tokens.inputTokens.unmeasured, 2, "the deterministic row and the predating row reported no prompt");

  /* The same numbers reach the panel when the publisher passes its clock. */
  const panel = buildCostPanel({ costs, attempts, cacheByRole: null, share: null, verifiedRecords: null, nowIso: now });
  assert.equal(panel.monthlySpend?.total.total, 0.9);
  assert.equal(buildCostPanel({ costs, attempts, cacheByRole: null, share: null, verifiedRecords: null }).monthlySpend, null);
});

test("ADM-C14: the cache row carries the defect counts, the batch share and the saving the cycle measured", () => {
  const panel = buildCostPanel({
    costs: [],
    attempts: [],
    cacheByRole: [{
      role: "SCOUT", cacheRead: 40_867, cacheWrite: 51_568, uncachedInput: 44, hitRate: 0.442,
      repeatedPrefixTurns: 6, repeatedPrefixMisses: 1, stationaryTurns: 2, attempts: 3,
      measuredRows: 2, predatingRows: 1, unreportedRows: 0, uncachedPerAttempt: { mean: 22, max: 22 },
      batchShare: 0, savedUsd: 0.1839, aggregatePricedRows: 0, denominator: "d",
    }],
    share: null,
    verifiedRecords: null,
  });
  const row = panel.cacheHitRateByCaller.find((c) => c.callerKey.startsWith("SCOUT"))!;
  assert.deepEqual(row.health, {
    zeroReadTurns: 1, turnsExamined: 6, stationaryTurns: 2,
    measuredRows: 2, predatesFieldRows: 1, providerReportedNothingRows: 0,
    batchShare: 0, savedUsd: 0.1839, aggregatePricedRows: 0,
  });
  assert.ok(row.hitRate.held && row.hitRate.value.value === 40_867);
});


test("search API charges are broken down by host and never counted as model spend", () => {
  // One DISCOVERY_SEARCH row per request: source is the API host, usd the published price or null.
  const now = "2026-09-23T18:00:00.000Z";
  const search = (id: string, usd: number | null, source: string | null): CostEntry => ({ ...entry(id, "DISCOVERY_SEARCH" as WorkerRole, usd, "2026-09-23T12:00:00.000Z"), source });
  const costs = [
    entry("s1", "SCOUT", 0.5, "2026-09-23T11:00:00.000Z"),
    search("b1", 0.005, "api.search.brave.com"),
    search("b2", 0.005, "api.search.brave.com"),
    search("e1", null, "api.exa.ai"),
    search("n1", 0.01, null),
  ];
  const view = buildMonthlySpend({ costs, attempts: [{ id: "s1", worker: { version: "claude-opus-5", provider: "anthropic" } }], nowIso: now });

  assert.equal(view.total.total, 0.52, "the ledger's total still carries every charge");
  assert.deepEqual(view.byModel.map((r) => r.key), ["claude-opus-5"], "a search request has no model and is not read as the cache pre-warm");
  const role = view.byRole.find((r) => r.key === "DISCOVERY_SEARCH")!;
  assert.deepEqual([role.usd, role.measuredRows, role.unmeasuredRows], [0.02, 3, 1]);
  assert.deepEqual(
    view.bySearchSource?.map((r) => [r.key, r.usd, r.measuredRows, r.unmeasuredRows]),
    [["(host not recorded)", 0.01, 1, 0], ["api.search.brave.com", 0.01, 2, 0], ["api.exa.ai", null, 0, 1]],
    "dollars first, then the key; an unpriced request is unmeasured, never a zero; a row with no host is its own group",
  );
});

test("ADM-36 and ADM-33: a role bar carries a role class and a model renders as its name", () => {
  assert.equal(roleBarClass("SCOUT"), "role-scout");
  assert.equal(roleBarClass("ADVERSARIAL_AUDITOR"), "role-adversarial-auditor");
  assert.equal(roleBarClass("SCOUT (control-plane model workers)"), "role-scout");
  assert.equal(roleBarClass("something else"), "role-other");
  assert.equal(modelLabel("claude-opus-5"), "Claude Opus 5");
  assert.equal(modelLabel("claude-haiku-4-5-20251001"), "Claude Haiku 4.5");
  assert.equal(modelLabel(NO_MODEL_KEY), "No model — plain code");
  assert.equal(modelLabel(ATTEMPT_NOT_ON_RECORD), "Attempt not on record");
});

test("every number the cost section draws itself carries a denominator and a contract", () => {
  const now = "2026-09-06T18:00:00.000Z";
  const panel = buildCostPanel({
    costs: [entry("s1", "SCOUT", 0.31, "2026-09-06T12:00:00.000Z")],
    attempts: [{ id: "s1", worker: { version: "claude-opus-5", provider: "anthropic" } }],
    cacheByRole: null, share: null, verifiedRecords: null, nowIso: now,
  });
  const numbers = costSectionNumbers({
    monthly: panel.monthlySpend,
    windows: spendWindowRows({ cycleUsd: 0, operationalNightUsd: null, rolling24HourUsd: 0.31, ceilings: CEILINGS }),
    capacity: panel.capacity,
  });
  assert.ok(numbers.length >= 3, `expected the section's own figures, saw ${numbers.length}`);
  assert.equal(auditRenderedNumbers(numbers).ok, true, auditRenderedNumbers(numbers).detail);
  assert.ok(!numbers.some((n) => n.label.includes("Operational night")), "an unmeasured window is not pushed as a number");
  /* Positive control: the audit really does refuse a figure with no denominator. */
  assert.equal(auditRenderedNumbers([{ label: "x", value: 1, denominator: null, contract: "c" }]).ok, false);
});
