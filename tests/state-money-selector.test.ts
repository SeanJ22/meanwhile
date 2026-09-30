import { isRenderable, stateMoneyRecordsForDisplay } from "../lib/funding/state-money-reader.ts";

import assert from "node:assert/strict";

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { dirname, join } from "node:path";

import test from "node:test";

import { type StateMoneyRecord } from "../lib/funding/state-money.ts";

import { stateMoneyForTarget, resetStateMoneyCache } from "../lib/funding/state-snapshot.ts";

test("current normalized state-money records survive the canonical exact-key selector; leads never enter", () => {
  resetStateMoneyCache();
  let eligible = 0;
  let unresolved = 0;
  let superseded = 0;
  for (const state of ["az", "nh", "nj"]) {
    const path = `data/states/${state}/funding/state-money-${state}-2026.json`;
    const snapshot = JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as { records: StateMoneyRecord[] };
    for (const record of snapshot.records) {
      if (!isRenderable(record)) { unresolved++; continue; }
      eligible++;
      assert.ok(record.targetKeys.length > 0, `${path}: renderable record needs a resolved target or scoped gap target`);
      for (const key of record.targetKeys) {
        const selected = stateMoneyForTarget(key);
        assert.ok(selected.some((actual) => JSON.stringify(actual) === JSON.stringify(record)), `${key}: eligible record disappeared before the surface payload`);
        assert.ok(selected.every((actual) => actual.targetKeys.includes(key) && isRenderable(actual)), `${key}: wrong or staged record attached`);
        const answer = stateMoneyRecordsForDisplay(selected);
        if (!answer.some((actual) => JSON.stringify(actual) === JSON.stringify(record))) {
          superseded++;
          assert.notEqual(record.filingState, "FILED", "no held filing may be suppressed by another candidate's or weaker record");
          assert.ok(answer.length && answer.every((actual) => actual.targetKeys.includes(key) && (actual.filingState === "FILED" || record.filingState === "NO_REPORTS_ON_FILE" && actual.filingState === "NO_REPORTS_ON_FILE")), `${key}: withholding an observation needs a stronger filing or equivalent sourced absence on this exact target`);
        }
      }
    }
  }
  assert.equal(eligible, 419);
  assert.equal(unresolved, 3);
  assert.equal(superseded, 94, "54 source observations are superseded by same-candidacy filings and 40 duplicate sourced absences consolidate; none is lost at a loader");
  assert.deepEqual(stateMoneyForTarget("unresolved:Katie Hobbs"), [], "a familiar name without a committed target identity never resolves");
  assert.deepEqual(stateMoneyForTarget("ballot-az-pima:governor:invented-person"), []);
});
