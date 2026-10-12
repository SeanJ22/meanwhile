/**
 * An unmeasured charge is counted out of the total (never as a zero), and a charge whose source names no place lands
 * in a named bucket rather than being dropped or folded into a state.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ZERO_COST, type WorkerRole } from "../lib/control-plane/attempt.ts";
import { type CostEntry } from "../lib/control-plane/cost.ts";
import { NOT_A_PLACE_KEY, buildSpendByPlace } from "../lib/control-plane/cost-panel.ts";

let seq = 0;
function entry(source: string | null, usd: number | null, role: WorkerRole = "SCOUT"): CostEntry {
  seq += 1;
  return {
    attemptId: `at-${seq}`,
    workItemId: "w",
    routeTaskId: null,
    routeId: null,
    source,
    jurisdiction: null,
    project: "freshness",
    role,
    cost: { ...ZERO_COST, usd },
    recordedAt: "2026-09-20T00:00:00.000Z",
  };
}

test("rolls up by state then jurisdiction, states most-spent first", () => {
  const view = buildSpendByPlace([
    entry("az:2026:state-az-cd-6:u-s-representative-district-6:peters", 5.0),
    entry("az:2026:state-az-cd-6:u-s-representative-district-6:jones", 3.0),
    entry("az:2026:state-az-sldl-19:state-representative-district-19:anderson", 2.0),
    entry("nh:2026:state-nh-county-merrimack:register-of-deeds:davis", 4.0),
  ]);

  assert.equal(view.total.total, 14.0);
  assert.equal(view.total.measured, 4);
  assert.equal(view.total.unmeasured, 0);

  // AZ ($10) before NH ($4).
  assert.deepEqual(
    view.states.map((s) => s.state),
    ["az", "nh"],
  );

  const az = view.states[0];
  assert.equal(az.label, "AZ");
  assert.equal(az.usd, 10.0);
  // Two charges under the same jurisdiction segment fold into one place ($8), before sldl-19 ($2).
  assert.deepEqual(
    az.places.map((p) => [p.key, p.label, p.usd, p.attempts]),
    [
      ["state-az-cd-6", "cd 6", 8.0, 2],
      ["state-az-sldl-19", "sldl 19", 2.0, 1],
    ],
  );
});

test("an unmeasured charge is counted out of the total, never as zero", () => {
  const view = buildSpendByPlace([
    entry("nh:2026:state-nh-county-merrimack:register-of-deeds:davis", 4.0),
    entry("nh:2026:state-nh-county-merrimack:register-of-deeds:morse", null),
  ]);

  const nh = view.states[0];
  assert.equal(nh.usd, 4.0);
  assert.equal(nh.measuredRows, 1);
  assert.equal(nh.unmeasuredRows, 1);

  const place = nh.places[0];
  assert.equal(place.usd, 4.0);
  assert.equal(place.attempts, 2, "both charges are counted as attempts");
  assert.equal(place.unmeasuredRows, 1);
});

test("a place with only unmeasured charges shows null spend, not 0.00", () => {
  const view = buildSpendByPlace([
    entry("az:2026:state-az-cd-6:u-s-representative-district-6:peters", null),
  ]);
  assert.equal(view.states[0].usd, null);
  assert.equal(view.states[0].places[0].usd, null);
  assert.equal(view.total.total, null);
});

test("a charge whose source names no place lands in a named overhead bucket, last", () => {
  const view = buildSpendByPlace([
    entry("az:2026:state-az-cd-6:u-s-representative-district-6:peters", 5.0),
    entry("api.anthropic.com", 1.0),
    entry(null, 0.5),
    entry("ar-4f70213095e835fb60bdcfa8", 0.25), // an artifact id, not a place
  ]);

  // Overhead is always last, whatever it spent.
  const last = view.states[view.states.length - 1];
  assert.equal(last.state, NOT_A_PLACE_KEY);
  assert.equal(last.usd, 1.75); // 1.0 + 0.5 + 0.25
  assert.equal(last.attempts, 3);
  assert.deepEqual(last.places, []);

  // The real place is unaffected.
  assert.equal(view.states[0].state, "az");
  assert.equal(view.states[0].usd, 5.0);
});

test("an empty ledger is empty, with a null total", () => {
  const view = buildSpendByPlace([]);
  assert.deepEqual(view.states, []);
  assert.equal(view.total.total, null);
  assert.equal(view.total.measured, 0);
});
