import assert from "node:assert/strict";
import test from "node:test";

import { stateMoneyForCard } from "../lib/funding/nominee-money.ts";
import { isRenderable } from "../lib/funding/state-money.ts";

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
  /* The bridge answers for the Arizona certified lineup and nothing else. */
  const out = stateMoneyForCard("ballot-nh-grafton:state-house-1", "ballot-nh-grafton:state-house-1");
  assert.equal(out.resolution, "DIRECT_CANDIDACY_KEY");
  assert.equal(out.resolvedTargetKey, "ballot-nh-grafton:state-house-1");
});
