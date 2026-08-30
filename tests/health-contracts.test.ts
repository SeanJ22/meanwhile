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
  });
}

function cleanScore(): ControlScore {
  return {
    knownPresentCount: 3,
    knownAbsenceCount: 2,
    recalled: 3,
    falseAbsences: 0,
    falsePresences: 0,
    unobserved: 0,
    recall: 1,
    falseAbsenceRate: 0,
    falsePresenceRate: 0,
  };
}

function greenTruth(): ContractReading {
  return truthContract({ controlsLoaded: 5, score: cleanScore() });
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
  });
  assert.equal(reader.state, "AWAITING_OWNER_DATA");
  assert.equal(reader.reason, "0 questions loaded — awaiting owner corpus");

  const truth = truthContract({ controlsLoaded: 0, score: null });
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
  });
  assert.equal(unevaluated.state, "RED");

  const notEvaluable = readerContract({
    questionsLoaded: 2,
    activeInstances: 4,
    evaluatedGreen: 3,
    evaluatedRed: 0,
    notEvaluable: 1,
    target: "LOCAL_RENDER",
  });
  assert.equal(notEvaluable.state, "RED", "NOT_EVALUABLE is recorded, and it is never green");

  const red = readerContract({
    questionsLoaded: 2,
    activeInstances: 4,
    evaluatedGreen: 3,
    evaluatedRed: 1,
    notEvaluable: 0,
    target: "LOCAL_RENDER",
  });
  assert.equal(red.state, "RED");
});

test("TRUTH green requires both failure directions to have a denominator", () => {
  const noAbsenceControls = truthContract({
    controlsLoaded: 3,
    score: { ...cleanScore(), knownAbsenceCount: 0, falsePresenceRate: null },
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
  });
  assert.equal(noPresentControls.state, "RED");

  const dirty = truthContract({
    controlsLoaded: 5,
    score: { ...cleanScore(), falsePresences: 1, falsePresenceRate: 0.5 },
  });
  assert.equal(dirty.state, "RED");

  const unobserved = truthContract({
    controlsLoaded: 5,
    score: { ...cleanScore(), unobserved: 1 },
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
