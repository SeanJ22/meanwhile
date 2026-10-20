/**
 * The pure computations in `research-metrics.ts` and the lines/rows in `research-digest.ts`. Each test fixes
 * an input and asserts the number and the denominator or rule that travels with it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { CostEntry } from "../lib/control-plane/cost.ts";
import { MODELS, MODEL_TIERS } from "../lib/models.ts";
import { CACHE_RATE_MULTIPLIERS } from "../lib/control-plane/model-cost.ts";
import {
  ORDERING_RULE,
  UNIVERSE_PROVIDERS,
  bandFor,
  cacheDefectCounts,
  cacheHitRateByRole,
  costPerUsefulOutcome,
  graduationFunnel,
  modelShareTrend,
  orderByReaderImpact,
  scoutCapacity,
  type OrderingInputs,
  type ResearchMetrics,
} from "../lib/control-plane/research-metrics.ts";
import { researchDigestLines, researchDigestRows } from "../lib/control-plane/research-digest.ts";
import type { ScoutResult, ScoutStep } from "../lib/control-plane/scheduler/scout-result.ts";

const NOW = "2026-09-02T16:00:00.000Z";

function cost(attemptId: string, usd: number | null, recordedAt = NOW, role: CostEntry["role"] = "SCOUT"): CostEntry {
  return { attemptId, workItemId: "w", routeTaskId: null, routeId: null, source: null, jurisdiction: null, project: "freshness", role, cost: { inputTokens: 1, outputTokens: 1, usd, durationMs: 1, bytesFetched: null, requestCount: 1, cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false }, recordedAt };
}

function result(over: Partial<ScoutResult> & { readonly attemptId: string }): ScoutResult {
  return {
    formatVersion: 1,
    obligationId: `obl-${over.attemptId}`,
    routeTaskId: "rt",
    workItemId: "wi",
    subjectId: "s",
    routeId: null,
    recordClass: "meetings",
    providerId: "p",
    reason: "r",
    outcome: "ROUTE_CANDIDATE",
    stoppedBy: "MODEL",
    rungs: [],
    distinctEvidenceRungs: 1,
    candidates: [],
    findings: [],
    nextRungs: [],
    unverified: [],
    narrative: "n",
    worker: { provider: "anthropic", model: "claude-opus-5-5", modelReported: "claude-opus-5-5" },
    usage: { inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 500, cacheCreationInputTokens: 100, turns: 2, toolCalls: 1 },
    usd: 1,
    elapsedMs: 1,
    artifactIds: ["a"],
    methodCandidateIds: [],
    refusal: null,
    startedAt: NOW,
    recordedAt: NOW,
    ...over,
  };
}

const modelStep = (turn: number, cacheRead: number): ScoutStep => ({ step: "scout-research-loop", kind: "MODEL", turn, model: "claude-opus-5-5", effort: "medium", tokens: { cacheRead, cacheWrite: 0, uncachedInput: 100, output: 10 }, usd: 0.01, representationBytes: 0, count: 1 });

test("capacity: Attempts per day the ceiling supports at the measured mean, with unmeasured counted beside and the window honoured", () => {
  const c = scoutCapacity({
    costs: [cost("a", 1.0), cost("b", 1.5), cost("c", null), cost("d", 9, "2026-08-30T00:00:00.000Z"), cost("e", 9, NOW, "ACQUIRER")],
    nowIso: NOW,
    windowHours: 24,
    ceilingUsd: 25,
  });
  assert.equal(c.measuredAttempts, 2);
  assert.equal(c.unmeasuredAttempts, 1);
  assert.equal(c.meanUsdPerAttempt, 1.25);
  assert.equal(c.attemptsPerDayAtCap, 20);
  assert.match(c.denominator, /2 measured, 1 unmeasured/);
  const none = scoutCapacity({ costs: [cost("c", null)], nowIso: NOW, windowHours: 24, ceilingUsd: 25 });
  assert.equal(none.attemptsPerDayAtCap, null, "an unmeasured mean supports no capacity number");
});

test("ordering: band 1 for a reader signal, band 2 for a universe provider, band 3 for the tail; oldest due first within a band; every input named", () => {
  const inputs = { pilotZips: ["85701", "85641", "07866", "03255"] };
  const rows = [
    { id: "freshness:meetings:x", subjectId: "ocd-division/country:us/state:az/place:nowhere", readerImpactAt: null, providerId: "meetings", nextDueAt: "2026-09-01T00:00:00.000Z" },
    { id: "freshness:candidate-enrichment:az:2026:x#site", subjectId: "az:2026:x", readerImpactAt: null, providerId: "candidate-enrichment", nextDueAt: "2026-09-02T00:00:00.000Z" },
    { id: "freshness:jurisdiction:az:county:county-of-pima#meetings-1", subjectId: "az:county:county-of-pima", readerImpactAt: null, providerId: "local-jurisdictions", nextDueAt: "2026-09-02T01:00:00.000Z" },
    { id: "freshness:meetings:t#r", subjectId: "t", readerImpactAt: "2026-09-10T00:00:00.000Z", providerId: "meetings", nextDueAt: "2026-09-01T12:00:00.000Z" },
    { id: "freshness:candidate-enrichment:az:2026:y#site", subjectId: "az:2026:y", readerImpactAt: null, providerId: "candidate-enrichment", nextDueAt: "2026-08-30T00:00:00.000Z" },
  ];
  const { ordered, ordering } = orderByReaderImpact(rows, inputs);
  assert.deepEqual(
    ordered.map((o) => [o.band, o.row.id]),
    [
      [1, "freshness:meetings:t#r"],
      [2, "freshness:candidate-enrichment:az:2026:y#site"],
      [2, "freshness:candidate-enrichment:az:2026:x#site"],
      [2, "freshness:jurisdiction:az:county:county-of-pima#meetings-1"],
      [3, "freshness:meetings:x"],
    ],
  );
  assert.deepEqual(ordering.bands, { 1: 1, 2: 3, 3: 1 });
  assert.equal(ordering.rule, ORDERING_RULE);
  assert.equal(ordering.appliesTo, "BOUNDED_MODEL_WORKER");
  assert.equal(ordering.inputs.readerImpactAt, "FreshnessObligation.readerImpactAt");
  assert.equal(ordering.inputs.pilotJurisdictions, undefined, "no pilot place is ahead of the line");
  assert.deepEqual(ordering.inputs.universeProviders, UNIVERSE_PROVIDERS);
  assert.match(ordered[0].why, /readerImpactAt/);
  assert.match(ordered[1].why, /source-universe denominator/);
  assert.match(ordered[4].why, /long tail/);
  // Retired ordering fields on the inputs cannot influence the band.
  const legacyMutation = {
    pilotZips: [],
    openRedQuestionZips: ["07866"],
    openRedQuestions: 99,
    readerSuiteRun: "reader-suite@forged",
  } as unknown as OrderingInputs;
  const unaffected = bandFor(
    { id: "freshness:meetings:ocd-division/country:us/state:nj/place:rockaway", subjectId: "", readerImpactAt: null, providerId: "meetings", nextDueAt: NOW },
    legacyMutation,
  );
  assert.equal(unaffected.band, 3);
  assert.match(unaffected.why, /long tail/);
  /* A candidate whose surname matches a place name is not that jurisdiction. */
  const surname = bandFor({ id: "freshness:candidate-enrichment:nh:2026:state-nh:united-states-senator:vail-john#candidate-wikipedia-api", subjectId: "nh:2026:state-nh:united-states-senator:vail-john", readerImpactAt: null, providerId: "candidate-enrichment", nextDueAt: NOW }, inputs);
  assert.equal(surname.band, 2, surname.why);
  const newbury = bandFor({ id: "freshness:candidate-enrichment:nh:2026:state-nh-county-merrimack-place-newbury-town:x#site", subjectId: "", readerImpactAt: null, providerId: "candidate-enrichment", nextDueAt: NOW }, inputs);
  assert.equal(newbury.band, 2, "a former pilot place is only in the band its provider puts it in");
});

test("funnel: SCOUTED counts distinct non-refused obligations; pipeline stages read 'none recorded' by default; candidate stages come from the store counts", () => {
  const f = graduationFunnel({
    results: [result({ attemptId: "a" }), result({ attemptId: "b", obligationId: "obl-a" }), result({ attemptId: "c", refusal: [{ code: "SCOUT_TRANSPORT_FAILED", detail: "x" }] })],
    candidateCounts: { proposed: 0, validated: 7, admitted: 0, rejected: 0 },
    pipeline: [],
    pipelineSource: "none recorded (lib/control-plane/promotion is another lane's)",
    deterministicReplays: 0,
  });
  const by = Object.fromEntries(f.stages.map((s) => [s.stage, s]));
  assert.equal(by.SCOUTED.count, 1, "two results on one obligation and one refused result count once");
  assert.equal(by.VERIFIED.count, 0);
  assert.match(by.VERIFIED.source, /none recorded for VERIFIED/);
  assert.equal(by.VALIDATED.count, 7);
  assert.equal(by.ADMITTED.count, 0);
  assert.equal(by.DETERMINISTIC_REPLAYS.count, 0);
  const withPipeline = graduationFunnel({ results: [], candidateCounts: null, pipeline: [{ stage: "VERIFIED", count: 2 }], pipelineSource: "promotion pipeline", deterministicReplays: 1 });
  assert.equal(withPipeline.stages.find((s) => s.stage === "VERIFIED")?.count, 2);
});

test("share: this cycle against the trailing window, with the delta in points and null when nothing dispatched", () => {
  const t = modelShareTrend({ thisCycle: { deterministic: 1, model: 3 }, windowCycles: [{ startedAt: "2026-09-01T00:00:00.000Z", deterministic: 8, model: 2 }, { startedAt: "2026-09-02T00:00:00.000Z", deterministic: 2, model: 3 }] });
  assert.equal(t.thisCycle.modelShare, 0.75);
  assert.equal(t.window.modelShare, 5 / 15);
  assert.equal(t.window.cycles, 2);
  assert.equal(t.window.since, "2026-09-01T00:00:00.000Z");
  assert.ok(Math.abs((t.delta ?? 0) - (0.75 - 5 / 15)) < 1e-12);
  const empty = modelShareTrend({ thisCycle: { deterministic: 0, model: 0 }, windowCycles: [] });
  assert.equal(empty.thisCycle.modelShare, null);
  assert.equal(empty.delta, null);
});

/** A ledger row carrying the cache metering. */
function meteredCost(attemptId: string, m: { read: number; write: number; uncached: number; split?: boolean; batch?: boolean; requests?: number }, role: CostEntry["role"] = "SCOUT", recordedAt = NOW): CostEntry {
  return {
    ...cost(attemptId, 1, recordedAt, role),
    model: MODELS.haiku.model, tier: "haiku",
    cost: {
      inputTokens: m.read + m.write + m.uncached, outputTokens: 10, usd: 1, durationMs: 1, bytesFetched: null, requestCount: m.requests ?? 1,
      cacheReadInputTokens: m.read, cacheCreationInputTokens: m.write,
      cacheCreation5mInputTokens: m.split === false ? null : m.write, cacheCreation1hInputTokens: m.split === false ? null : 0,
      uncachedInputTokens: m.uncached, batch: m.batch ?? false,
    },
  };
}

test("cache hit rate by role reads the COST LEDGER: a row predating the cache fields is NOT MEASURED by name, a measured row gives the rate, per-Attempt uncached, batch share and the dollar effect", () => {
  /* The `cost()` helper's rows carry the fields as null: the provider reported nothing. A row with the keys absent predates them. */
  const predating = { ...cost("old", 1), cost: { inputTokens: 1, outputTokens: 1, usd: 1, durationMs: 1, bytesFetched: null, requestCount: 1 } as unknown as CostEntry["cost"] };
  const rows = cacheHitRateByRole({ costs: [predating, cost("unreported", 1)], results: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, "SCOUT");
  assert.equal(rows[0].measuredRows, 0);
  assert.equal(rows[0].predatingRows, 1);
  assert.equal(rows[0].unreportedRows, 1);
  assert.equal(rows[0].hitRate, null, "no measured row: no rate, never 0%");
  assert.equal(rows[0].savedUsd, null, "missing usage and identity are not a measured zero saving");
  assert.match(rows[0].denominator, /1 predate the cache fields and are NOT MEASURED/);

  const measured = cacheHitRateByRole({
    costs: [meteredCost("a", { read: 900, write: 100, uncached: 200 }), meteredCost("b", { read: 300, write: 0, uncached: 600, batch: true, requests: 2 }), { ...meteredCost("audit", { read: 50, write: 50, uncached: 0, split: false }, "ADVERSARIAL_AUDITOR"), model: MODELS.opus.model, tier: "opus" }],
    results: [result({ attemptId: "a", steps: [modelStep(1, 0), modelStep(2, 0), modelStep(3, 900)], cacheDefect: { turns: [2, 3], detail: "d", stationaryTurns: [3], zeroReadTurns: [2] } })],
  });
  const scout = measured.find((r) => r.role === "SCOUT")!;
  assert.equal(scout.measuredRows, 2);
  assert.equal(scout.cacheRead, 1200);
  assert.equal(scout.cacheWrite, 100);
  assert.equal(scout.uncachedInput, 800);
  assert.equal(scout.hitRate, 1200 / 2100, "read over read + write + uncached");
  assert.deepEqual(scout.uncachedPerAttempt, { mean: 400, max: 600 });
  assert.equal(scout.batchShare, 2 / 3, "two of three requests went through the Batches API");
  assert.equal(scout.repeatedPrefixTurns, 2);
  assert.equal(scout.repeatedPrefixMisses, 1);
  assert.equal(scout.stationaryTurns, 1);
  assert.ok(Math.abs((scout.savedUsd ?? 0) - ((900 + 300 * CACHE_RATE_MULTIPLIERS.batch) / 1_000_000) * MODELS.haiku.inputUsdPerMillion * (1 - MODELS.haiku.cacheReadMultiplier)) < 1e-12, "each recorded Haiku row uses its actual batch discount, without an Opus role guess");
  const audit = measured.find((r) => r.role === "ADVERSARIAL_AUDITOR")!;
  assert.equal(audit.aggregatePricedRows, 1, "a row with the aggregate and no split is counted by name");
  assert.equal(audit.hitRate, 0.5);
  assert.ok(Math.abs(audit.savedUsd! - 50 / 1_000_000 * MODELS.opus.inputUsdPerMillion * (1 - MODELS.opus.cacheReadMultiplier)) < 1e-12);

  for (const tier of MODEL_TIERS) {
    for (const batch of [false, true]) {
      const row = { ...meteredCost(`${tier}-${batch}`, { read: 1_000_000, write: 0, uncached: 0, batch }, "PARSER"), model: `${MODELS[tier].model}-20261002`, tier };
      const actual = cacheHitRateByRole({ costs: [row], results: [] })[0];
      assert.equal(actual.role, "PARSER");
      assert.equal(actual.savedUsd, MODELS[tier].inputUsdPerMillion * (1 - MODELS[tier].cacheReadMultiplier) * (batch ? CACHE_RATE_MULTIPLIERS.batch : 1));
    }
  }
  const tierOnly = { ...meteredCost("tier-only", { read: 1_000_000, write: 0, uncached: 0 }, "ENGINEERING"), model: undefined, tier: "sonnet" as const };
  assert.equal(cacheHitRateByRole({ costs: [tierOnly], results: [] })[0].savedUsd, MODELS.sonnet.inputUsdPerMillion * (1 - MODELS.sonnet.cacheReadMultiplier));

  const splitRow = { ...meteredCost("mixed-models", { read: 300, write: 30, uncached: 40, batch: true, requests: 2 }, "ENGINEERING"), model: MODELS.haiku.model };
  const shares: NonNullable<CostEntry["byModel"]> = [
    { model: MODELS.haiku.model, tier: "haiku", requestCount: 1, usd: 0.4, inputTokens: 120, outputTokens: 5, cacheReadInputTokens: 100, cacheCreationInputTokens: 10, cacheCreation5mInputTokens: 10, cacheCreation1hInputTokens: 0, uncachedInputTokens: 10 },
    { model: MODELS.opus.model, tier: "opus", requestCount: 1, usd: 0.6, inputTokens: 250, outputTokens: 5, cacheReadInputTokens: 200, cacheCreationInputTokens: 20, cacheCreation5mInputTokens: 20, cacheCreation1hInputTokens: 0, uncachedInputTokens: 30 },
  ];
  const mixed = cacheHitRateByRole({ costs: [{ ...splitRow, byModel: shares }], results: [] })[0];
  assert.equal(mixed.role, "ENGINEERING");
  assert.equal(mixed.cacheRead, 300);
  assert.equal(mixed.attempts, 1);
  assert.equal(mixed.measuredRows, 1);
  assert.equal(mixed.batchShare, 1);
  assert.ok(Math.abs(mixed.savedUsd! - (100 * MODELS.haiku.inputUsdPerMillion * (1 - MODELS.haiku.cacheReadMultiplier) + 200 * MODELS.opus.inputUsdPerMillion * (1 - MODELS.opus.cacheReadMultiplier)) / 1_000_000 * CACHE_RATE_MULTIPLIERS.batch) < 1e-12, "validated shares replace the aggregate rather than adding another charge");
  const unknownRows: CostEntry[] = [
    { ...meteredCost("missing-model", { read: 100, write: 0, uncached: 0 }), model: undefined, tier: undefined },
    { ...meteredCost("unknown-served", { read: 100, write: 0, uncached: 0 }), model: "unpriced-served-model" },
    { ...meteredCost("contradictory-tier", { read: 100, write: 0, uncached: 0 }), tier: "opus" },
    { ...splitRow, byModel: [{ ...shares[0], model: "unpriced-model", tier: null }, shares[1]] },
    { ...splitRow, byModel: [{ ...shares[0], cacheReadInputTokens: null }, shares[1]] },
    { ...splitRow, byModel: [{ ...shares[0], cacheReadInputTokens: 101 }, shares[1]] },
    { ...splitRow, byModel: [{ ...shares[0], usd: 0.5 }, shares[1]] },
    { ...splitRow, byModel: [{ ...shares[0], tier: "opus" }, shares[1]] },
  ];
  const wrongBatch = { ...shares[0], batch: false };
  const malformedBatch = { ...shares[0], batch: "true" };
  unknownRows.push({ ...splitRow, byModel: [wrongBatch, shares[1]] }, { ...splitRow, byModel: [malformedBatch as never, shares[1]] });
  unknownRows.push(JSON.parse(JSON.stringify({ ...tierOnly, tier: "unpriced-tier" })), JSON.parse(JSON.stringify({ ...tierOnly, model: 42 })));
  for (const row of unknownRows) assert.equal(cacheHitRateByRole({ costs: [row], results: [] })[0].savedUsd, null, "unknown or contradictory portions cannot be assigned a neighboring model's price");
  assert.equal(cacheHitRateByRole({ costs: [meteredCost("known", { read: 100, write: 0, uncached: 0 }), unknownRows[0]], results: [] })[0].savedUsd, null, "a partial known subtotal never reads as complete savings");
  assert.deepEqual(cacheHitRateByRole({ costs: [{ ...meteredCost("plain-parser", { read: 0, write: 0, uncached: 0 }, "PARSER"), model: null, tier: "none" }, { ...meteredCost("plain-engineer", { read: 0, write: 0, uncached: 0 }, "ENGINEERING"), model: null, tier: "none" }], results: [] }), [], "plain workers do not become missing model measurements");

  /* The window: a row outside it is not in the denominator. */
  const windowed = cacheHitRateByRole({ costs: [meteredCost("a", { read: 900, write: 100, uncached: 200 }), meteredCost("stale", { read: 1, write: 1, uncached: 1 }, "SCOUT", "2026-08-01T00:00:00.000Z")], results: [], sinceIso: "2026-09-01T00:00:00.000Z" });
  assert.equal(windowed[0].attempts, 1);

  /* A pre-warm row is a cache write for the cycle, never an Attempt. */
  const prewarmed = cacheHitRateByRole({ costs: [{ ...meteredCost("pw", { read: 0, write: 4586, uncached: 77 }), routeId: "scout:prewarm" }], results: [] });
  assert.equal(prewarmed.length, 0);

  assert.deepEqual(
    cacheDefectCounts([result({ attemptId: "a" }), result({ attemptId: "b", steps: [modelStep(1, 0)], cacheDefect: { turns: [2], detail: "d", stationaryTurns: [2], zeroReadTurns: [] } }), result({ attemptId: "c", steps: [modelStep(1, 0)], cacheDefect: null }), result({ attemptId: "d", steps: [modelStep(1, 0)], cacheDefect: { turns: [2], detail: "old detector" } })]),
    { defective: 2, instrumented: 3, stationary: 1, zeroRead: 1 },
    "the two signatures are counted apart; an old-detector defect (turns only) was a zero read by construction",
  );
});

test("cost per useful outcome shares the whole measured spend across classes and names an unrecorded pipeline stage", () => {
  const rows = costPerUsefulOutcome({
    results: [result({ attemptId: "a", usd: 2 }), result({ attemptId: "b", usd: 4, outcome: "EVIDENCE_FOUND" }), result({ attemptId: "c", usd: 3, outcome: "NO_PROGRESS" }), result({ attemptId: "d", usd: null, outcome: "BLOCKED" })],
    candidateCounts: { validated: 2, admitted: 0 },
  });
  const by = Object.fromEntries(rows.map((r) => [r.outcome, r]));
  assert.equal(by.ROUTE_CANDIDATE.usdPerOutcome, 9, "$9 measured over 1 ROUTE_CANDIDATE: the NO_PROGRESS Attempt's cost is not hidden");
  assert.equal(by.EVIDENCE_FOUND.usdPerOutcome, 9);
  assert.equal(by.GRADUATED_ROUTE.count, 0);
  assert.equal(by.GRADUATED_ROUTE.usdPerOutcome, null);
  assert.match(by.ROUTE_CANDIDATE.denominator, /3 measured Attempt\(s\) \(1 unmeasured\)/);
});

test("the digest lines and rows print every number with its denominator, and an unmeasured value as its named gap", () => {
  const metrics: ResearchMetrics = {
    computedAt: NOW,
    capacity: scoutCapacity({ costs: [cost("a", 1.25)], nowIso: NOW, windowHours: 24, ceilingUsd: 25 }),
    ordering: orderByReaderImpact([], { pilotZips: ["85701"] }).ordering,
    funnel: graduationFunnel({ results: [], candidateCounts: null, pipeline: [], pipelineSource: "none recorded", deterministicReplays: 0 }),
    share: modelShareTrend({ thisCycle: { deterministic: 0, model: 0 }, windowCycles: [] }),
    cacheByRole: [],
    costPerOutcome: costPerUsefulOutcome({ results: [], candidateCounts: null }),
    cacheDefects: { defective: 0, instrumented: 0 },
  };
  const lines = researchDigestLines(metrics);
  assert.match(lines.join("\n"), /capacity\s+20 Attempt\(s\)\/day at the \$25 ceiling/);
  assert.match(lines.join("\n"), /queue by band\s+band 1 0 · band 2 0 · band 3 0/);
  assert.match(lines.join("\n"), /model share\s+this cycle UNMEASURED/);
  assert.match(lines.join("\n"), /cache hit rate\s+NOT MEASURED/);
  assert.match(lines.join("\n"), /cost per outcome/);
  const rows = researchDigestRows(metrics);
  for (const row of Object.values(rows).flat()) assert.ok(row.denominator.length > 0, `${row.label} has no denominator`);
  assert.equal(rows.capacity[0].value, "20");
  assert.equal(rows.share[0].value, "UNMEASURED");
});
