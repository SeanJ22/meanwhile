/**
 * The first test re-reads the executors, so ROLE_COST_POLICY cannot call a role plain code once an executor hands
 * it a model. It carries a planted positive control, because a sweep never seen to fire proves nothing.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ZERO_COST, WORKER_ROLES, type AttemptCost, type WorkerRole } from "../lib/control-plane/attempt.ts";
import { utcMonthWindow, type CostEntry } from "../lib/control-plane/cost.ts";
import { ATTEMPT_NOT_ON_RECORD, COST_CLASS_WORDS, NO_MODEL_KEY, ROLE_COST_POLICY, buildCostPanel, costClassOf, utcStamp } from "../lib/control-plane/cost-panel.ts";
import { gap, held, measured } from "../lib/control-plane/owner-surface.ts";
import { codeOf } from "./read-code.ts";

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
  assert.match(scout, /role:\s*workerRole,\s*provider:\s*"anthropic"/, "the shared research executor declares the Anthropic provider for its selected role");

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

