/**
 * **THE PROJECTION LAYER: WHAT ONE CARD ACTUALLY GETS.**
 * (Session C3, 2026-09-01. RULING 229, RULING 224.)
 *
 * `lib/funding/nominee-money.ts` is the only thing standing between a certified
 * nominee's card and the state campaign-money corpus. These tests assert the
 * two properties the whole change exists for:
 *
 * 1. the key handed to `stateMoneyForTarget` is the RECONCILED CANDIDACY ID and
 *    never the nominee's name;
 * 2. **no applicable non-federal card can come back with nothing.** Every one
 *    ends in exactly one honest state — filed, registered-with-no-activity,
 *    sourced absence, or an OURS gap that says whose gap it is.
 *
 * NO LIVE CALLS.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { stateMoneyForCard } from "../lib/funding/nominee-money.ts";
import { isRenderable } from "../lib/funding/state-money.ts";
import type { LineupReconciliation } from "../lib/identity/types.ts";

const ROOT = process.cwd();
const bridge = JSON.parse(
  readFileSync(
    join(ROOT, "data", "states", "az", "identity", "az-2026-certified-lineup-reconciliation.json"),
    "utf8",
  ),
) as LineupReconciliation;

function isFederal(contestId: string): boolean {
  return /:us-senate$|:us-house-\d+$/.test(contestId);
}

test("a reconciled nominee's card is answered with the CANDIDACY id, not the name", () => {
  const key = "ballot-az-pima:governor|Katie Hobbs";
  const out = stateMoneyForCard(key, "ballot-az-pima:governor");
  assert.equal(out.resolution, "RECONCILED_NOMINEE");
  assert.equal(out.resolvedTargetKey, "ballot-az-pima:governor:hobbs-katie");
  assert.notEqual(out.resolvedTargetKey, key);
  const filed = out.records.filter((r) => r.filingState === "FILED");
  assert.equal(filed.length, 1);
  assert.equal(filed[0].totals.receipts, 11109719.95);
});

test("the nickname control resolves too, and it resolves to an OURS gap with no figure", () => {
  const out = stateMoneyForCard(
    'ballot-az-pima:mine-inspector|Walter "Les" Presmyk',
    "ballot-az-pima:mine-inspector",
  );
  assert.equal(out.resolution, "RECONCILED_NOMINEE");
  assert.equal(out.resolvedTargetKey, "ballot-az-pima:mine-inspector:presmyk-walter");
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].filingState, "OURS_GAP");
  assert.equal(out.records[0].totals.receipts, null);
  assert.equal(out.records[0].totals.expenditures, null);
});

test("an unresolved nominee renders an OURS gap rather than silence", () => {
  for (const [key, contestId] of [
    ["ballot-az-pima:governor|Teri Ann Hourihan", "ballot-az-pima:governor"],
    ["ballot-az-pima:state-senate-19|Bob Karp", "ballot-az-pima:state-senate-19"],
  ] as const) {
    const out = stateMoneyForCard(key, contestId);
    assert.equal(out.resolution, "UNRECONCILED_NOMINEE", key);
    assert.equal(out.resolvedTargetKey, null, key);
    assert.equal(out.records.length, 1, key);
    const record = out.records[0];
    assert.equal(record.filingState, "OURS_GAP", key);
    assert.ok(isRenderable(record), `${key} produced a record that does not render`);
    assert.ok(record.ourGap && record.ourGap.whatIsMissing.length > 0, key);
    /* A read stamp, carried from the corpus that took it. Never invented. */
    assert.match(record.checkedAt, /^\d{4}-\d{2}-\d{2}$/, key);
  }
});

test("an OURS gap carries no money of any kind — the prohibition, asserted", () => {
  const out = stateMoneyForCard("ballot-az-pima:governor|Teri Ann Hourihan", "ballot-az-pima:governor");
  const record = out.records[0];
  assert.equal(record.totals.receipts, null);
  assert.equal(record.totals.expenditures, null);
  assert.equal(record.totals.cashOnHand, null);
  assert.equal(record.committeeId, null);
  assert.equal(record.registeredName, "");
  /* And it names OUR gap, not a fact about the candidate. */
  assert.match(record.ourGap!.whatIsMissing, /we have not established/i);
});

test("a card keyed on a candidacy id passes straight through, unchanged", () => {
  const out = stateMoneyForCard(
    "ballot-az-pima:corporation-commissioner:thompson",
    "ballot-az-pima:corporation-commissioner",
  );
  assert.equal(out.resolution, "DIRECT_CANDIDACY_KEY");
  assert.equal(out.resolvedTargetKey, "ballot-az-pima:corporation-commissioner:thompson");
  assert.equal(out.records.filter((r) => r.filingState === "FILED").length, 1);
});

test("a contest the bridge does not speak for is untouched", () => {
  /* New Hampshire and New Jersey must keep behaving exactly as they did: the
     bridge answers for the Arizona certified lineup and for nothing else. */
  const out = stateMoneyForCard("ballot-nh-grafton:state-house-1", "ballot-nh-grafton:state-house-1");
  assert.equal(out.resolution, "DIRECT_CANDIDACY_KEY");
  assert.equal(out.resolvedTargetKey, "ballot-nh-grafton:state-house-1");
});

test("EVERY applicable non-federal certified nominee ends in exactly one honest state", () => {
  const applicable = bridge.rows.filter((r) => !isFederal(r.contestId));
  assert.ok(applicable.length > 0);
  const tally: Record<string, number> = {};
  for (const row of applicable) {
    const out = stateMoneyForCard(row.cardKey, row.contestId);
    assert.ok(
      out.records.length > 0,
      `${row.cardKey} renders NO money state — the defect this change exists to remove`,
    );
    for (const record of out.records) {
      assert.ok(isRenderable(record), `${row.cardKey} carries a record that does not render`);
    }
    /* `StateMoneySection` shows exactly one class per card, in its own order. */
    const shown = out.records.some((r) => r.filingState === "FILED")
      ? "FILED"
      : out.records.some((r) => r.filingState === "REGISTERED_NO_ACTIVITY_REPORTED")
        ? "REGISTERED_NO_ACTIVITY_REPORTED"
        : out.records.some((r) => r.filingState === "NO_REPORTS_ON_FILE")
          ? "NO_REPORTS_ON_FILE"
          : "OURS_GAP";
    tally[shown] = (tally[shown] ?? 0) + 1;
  }
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  assert.equal(total, applicable.length, `${JSON.stringify(tally)}`);
  /* Stated with its denominator, and pinned so a regression is a diff. */
  assert.equal(applicable.length, bridge.proof.applicableNonFederalNominees);
});

test("no LEAD and no ROUTE_UNREAD can reach a card through this path", () => {
  for (const row of bridge.rows) {
    for (const record of stateMoneyForCard(row.cardKey, row.contestId).records) {
      assert.notEqual(record.filingState, "LEAD", row.cardKey);
      assert.notEqual(record.filingState, "ROUTE_UNREAD", row.cardKey);
    }
  }
});
