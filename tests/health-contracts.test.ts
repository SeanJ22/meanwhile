import assert from "node:assert/strict";
import test from "node:test";

import {
  freshnessContract,
  pilotHealth,
  readerContract,
  truthContract,
  type ContractReading,
  type ContractState,
} from "../lib/health/contracts.ts";
import type { ControlScore } from "../lib/health/control-fact.ts";

/**
 * THE THREE CONTRACTS AND THE ROLLUP (WS-CONTRACT): the truth table, the
 * awaiting states for empty corpora, FRESHNESS NOT_READY in the current
 * configuration, and the rule that no contract certifies another.
 */

function greenReader(): ContractReading {
  return readerContract({
    questionsLoaded: 3,
    activeInstances: 5,
    evaluatedGreen: 5,
    evaluatedRed: 0,
    notEvaluable: 0,
    target: "LOCAL_RENDER",
    establishedZeroDenominator: null,
    notCurrent: null,
  });
}

function cleanScore(): ControlScore {
  return {
    knownPresentCount: 3,
    knownAbsenceCount: 2,
    recalled: 3,
    /* Both absence controls correctly reported the verified absence. A clean
       score has to state that positively — "not a false presence" is also true
       of a surface that said nothing at all. (Session B WI1.4.) */
    absencesRecalled: 2,
    falseAbsences: 0,
    falsePresences: 0,
    unobserved: 0,
    recall: 1,
    falseAbsenceRate: 0,
    falsePresenceRate: 0,
  };
}

function greenTruth(): ContractReading {
  return truthContract({ controlsLoaded: 5, score: cleanScore(), notCurrent: null });
}

/** FRESHNESS as it will read AFTER Session B — hand-built, because the current
 *  configuration correctly cannot produce it. */
function hypotheticalGreenFreshness(): ContractReading {
  return { contract: "FRESHNESS", state: "GREEN", reason: "hypothetical post-Session-B reading" };
}

test("all three green is the ONLY green rollup", () => {
  const rollup = pilotHealth(greenReader(), greenTruth(), hypotheticalGreenFreshness());
  assert.equal(rollup.green, true);
  assert.equal(rollup.blocking.length, 0);
  assert.equal(rollup.readings.length, 3);
});

test("any non-green contract, in any position, makes the rollup not green", () => {
  const nonGreenStates: ContractState[] = ["RED", "AWAITING_OWNER_DATA", "NOT_READY"];
  for (const state of nonGreenStates) {
    const readerDown: ContractReading = { contract: "READER", state, reason: "seeded" };
    const truthDown: ContractReading = { contract: "TRUTH", state, reason: "seeded" };
    const freshnessDown: ContractReading = { contract: "FRESHNESS", state, reason: "seeded" };

    const a = pilotHealth(readerDown, greenTruth(), hypotheticalGreenFreshness());
    assert.equal(a.green, false, `READER ${state} must block the rollup`);
    assert.deepEqual(a.blocking, [{ contract: "READER", state }]);

    const b = pilotHealth(greenReader(), truthDown, hypotheticalGreenFreshness());
    assert.equal(b.green, false, `TRUTH ${state} must block the rollup`);
    assert.deepEqual(b.blocking, [{ contract: "TRUTH", state }]);

    const c = pilotHealth(greenReader(), greenTruth(), freshnessDown);
    assert.equal(c.green, false, `FRESHNESS ${state} must block the rollup`);
    assert.deepEqual(c.blocking, [{ contract: "FRESHNESS", state }]);
  }
});

test("no contract certifies another: TRUTH green does not flip READER", () => {
  const readerAwaiting = readerContract({
    questionsLoaded: 0,
    activeInstances: 0,
    evaluatedGreen: 0,
    evaluatedRed: 0,
    notEvaluable: 0,
    target: null,
    establishedZeroDenominator: null,
    notCurrent: null,
  });
  const rollup = pilotHealth(readerAwaiting, greenTruth(), hypotheticalGreenFreshness());
  assert.equal(rollup.green, false);
  // READER is still awaiting, verbatim — a green TRUTH changed nothing about it.
  const reader = rollup.readings.find((r) => r.contract === "READER");
  assert.equal(reader?.state, "AWAITING_OWNER_DATA");
  assert.deepEqual(rollup.blocking, [{ contract: "READER", state: "AWAITING_OWNER_DATA" }]);
});

test("empty corpora read as AWAITING_OWNER_DATA with the exact stated strings", () => {
  const reader = readerContract({
    questionsLoaded: 0,
    activeInstances: 0,
    evaluatedGreen: 0,
    evaluatedRed: 0,
    notEvaluable: 0,
    target: null,
    establishedZeroDenominator: null,
    notCurrent: null,
  });
  assert.equal(reader.state, "AWAITING_OWNER_DATA");
  assert.equal(reader.reason, "0 questions loaded — awaiting owner corpus");

  const truth = truthContract({ controlsLoaded: 0, score: null, notCurrent: null });
  assert.equal(truth.state, "AWAITING_OWNER_DATA");
  assert.equal(truth.reason, "0 controls loaded — awaiting owner answer key");
});

test("FRESHNESS reports NOT_READY in the current configuration, naming Session B", () => {
  const freshness = freshnessContract();
  assert.equal(freshness.state, "NOT_READY");
  assert.match(freshness.reason, /Session B/);
  assert.match(freshness.reason, /non-authoritative/);
});

test("READER is red while any active instance lacks a green verdict", () => {
  const unevaluated = readerContract({
    questionsLoaded: 2,
    activeInstances: 4,
    evaluatedGreen: 3,
    evaluatedRed: 0,
    notEvaluable: 0,
    target: "LOCAL_RENDER",
    establishedZeroDenominator: null,
    notCurrent: null,
  });
  assert.equal(unevaluated.state, "RED");

  const notEvaluable = readerContract({
    questionsLoaded: 2,
    activeInstances: 4,
    evaluatedGreen: 3,
    evaluatedRed: 0,
    notEvaluable: 1,
    target: "LOCAL_RENDER",
    establishedZeroDenominator: null,
    notCurrent: null,
  });
  assert.equal(notEvaluable.state, "RED", "NOT_EVALUABLE is recorded, and it is never green");

  const red = readerContract({
    questionsLoaded: 2,
    activeInstances: 4,
    evaluatedGreen: 3,
    evaluatedRed: 1,
    notEvaluable: 0,
    target: "LOCAL_RENDER",
    establishedZeroDenominator: null,
    notCurrent: null,
  });
  assert.equal(red.state, "RED");
});

test("TRUTH green requires both failure directions to have a denominator", () => {
  const noAbsenceControls = truthContract({
    controlsLoaded: 3,
    score: { ...cleanScore(), knownAbsenceCount: 0, falsePresenceRate: null },
    notCurrent: null,
  });
  assert.equal(noAbsenceControls.state, "RED");

  const noPresentControls = truthContract({
    controlsLoaded: 2,
    score: {
      ...cleanScore(),
      knownPresentCount: 0,
      recalled: 0,
      recall: null,
      falseAbsenceRate: null,
    },
    notCurrent: null,
  });
  assert.equal(noPresentControls.state, "RED");

  const dirty = truthContract({
    controlsLoaded: 5,
    score: { ...cleanScore(), falsePresences: 1, falsePresenceRate: 0.5 },
    notCurrent: null,
  });
  assert.equal(dirty.state, "RED");

  const unobserved = truthContract({
    controlsLoaded: 5,
    score: { ...cleanScore(), unobserved: 1 },
    notCurrent: null,
  });
  assert.equal(unobserved.state, "RED", "an unmeasured control is not a passed one");

  assert.equal(greenTruth().state, "GREEN");
});

test("the rollup refuses readings out of order rather than mislabelling them", () => {
  assert.throws(
    () =>
      pilotHealth(greenTruth() as ContractReading, greenReader(), hypotheticalGreenFreshness()),
    /READER, TRUTH, FRESHNESS/,
  );
});

/* ====================================================================== *
 * A.1 WI5 — THE VACUOUS GREEN, AND THE STALE READING.
 * ====================================================================== */

test("SEEDED: a nonzero corpus with zero evaluated instances cannot produce READER GREEN", () => {
  /*
   * THE EXACT DEFECT. The retired tracked-health reporter passed `activeInstances: 0,
   * evaluatedGreen: 0` as literals with a nonempty corpus. The red branch
   * tests `evaluatedGreen < activeInstances`, which is `0 < 0`, which is
   * false — so the contract fell through every refusal and returned GREEN
   * over zero measured instances.
   */
  const vacuous = readerContract({
    questionsLoaded: 5,
    activeInstances: 0,
    evaluatedGreen: 0,
    evaluatedRed: 0,
    notEvaluable: 0,
    target: null,
    establishedZeroDenominator: null,
    notCurrent: null,
  });
  assert.notEqual(vacuous.state, "GREEN", "zero evaluated instances is never a green contract");
  assert.equal(vacuous.state, "RED");
  assert.match(vacuous.reason, /0 instances are active/);
});

test("a zero denominator IS green when — and only when — it is independently established", () => {
  const established = readerContract({
    questionsLoaded: 5,
    activeInstances: 0,
    evaluatedGreen: 0,
    evaluatedRed: 0,
    notEvaluable: 0,
    target: "LOCAL_RENDER",
    establishedZeroDenominator:
      "the enumeration evidence holds no governing body for these ZIPs at this layer",
    notCurrent: null,
  });
  assert.equal(established.state, "GREEN");
});

test("SEEDED: a stale or off-tree run reads NOT_READY, never green", () => {
  const stale = readerContract({
    questionsLoaded: 3,
    activeInstances: 5,
    evaluatedGreen: 5,
    evaluatedRed: 0,
    notEvaluable: 0,
    target: "LOCAL_RENDER",
    establishedZeroDenominator: null,
    /* Every count says green. The evidence is about a different tree. */
    notCurrent: "the run tested aaaaaaaa, which the release bbbbbbbb does not contain",
  });
  assert.equal(stale.state, "NOT_READY");
  assert.match(stale.reason, /does not contain/);

  const truthStale = truthContract({
    controlsLoaded: 5,
    score: cleanScore(),
    notCurrent: "the newest control-set run finished 96.0h ago",
  });
  assert.equal(truthStale.state, "NOT_READY");
});
