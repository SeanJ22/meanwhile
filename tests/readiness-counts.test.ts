import assert from "node:assert/strict";
import test from "node:test";
import { readinessCounts, readinessItemIds, recoveryWitnesses, READINESS_GROUPS } from "../lib/coverage/readiness-counts.ts";
import { CHECKLIST_ITEMS } from "../lib/coverage/checklist-map.ts";

test("each readiness group counts its own rows and shared predicates fold into their row", () => {
  assert.deepEqual(READINESS_GROUPS.map(g => readinessItemIds(g).length), [20, 17, 18, 20]);
  assert.ok(!readinessItemIds("REC").includes("REC-17"));
});

test("with no witnesses every row is not measured, and nothing is a pass", () => {
  for (const c of readinessCounts({})) {
    assert.equal(c.witnessed, 0);
    assert.equal(c.failing, 0);
    assert.equal(c.notMeasured, c.of);
  }
});

test("a shared witness (REC-17) counts for the row it folds into (REC-08)", () => {
  const rec = readinessCounts({ "REC-17": { state: "witnessed", evidence: "recorded at dispatch" } }).find(c => c.group === "REC")!;
  assert.equal(rec.rows.find(r => r.id === "REC-08")!.state, "witnessed");
  assert.equal(rec.witnessed, 1);
});

test("existing recovery fields witness REC rows; missing counts stay not measured", () => {
  const w = recoveryWitnesses({ bankEntriesInherited: 12, bankEntriesUsed: 5, failureDebts: 4, failureDebtsWithReason: 4, absences: 3, absencesWithRecheck: 2, manualWriteBacks: null });
  assert.deepEqual(Object.keys(w).sort(), ["REC-01", "REC-08", "REC-09", "REC-13"]);
  assert.equal(w["REC-13"].state, "failing");
  assert.equal(w["REC-01"].state, "witnessed");
  const rec = readinessCounts(w).find(c => c.group === "REC")!;
  assert.equal(rec.witnessed, 3);
  assert.equal(rec.failing, 1);
  assert.equal(rec.notMeasured, rec.of - 4);
});

test("readiness rows are never scored as civic completeness", () => {
  for (const g of READINESS_GROUPS) {
    for (const id of readinessItemIds(g)) assert.ok(!["core", "extension"].includes(CHECKLIST_ITEMS[id]!.scoreAs), id);
  }
});
