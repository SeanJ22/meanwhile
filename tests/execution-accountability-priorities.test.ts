import assert from "node:assert/strict";
import test from "node:test";
import { rankedWorkBlockers } from "../lib/control-plane/admin-view/work-view.ts";
import type { AssignmentIndexRow } from "../lib/control-plane/assignment-view.ts";

const row = (id: string, extra: Partial<AssignmentIndexRow>): AssignmentIndexRow => ({
  id, kind: "STANDING", lane: "STANDING", state: "BLOCKED", label: id, subjectName: null,
  stateCode: "az", assignmentKeys: ["zcta:2020/85635"], lastActivityAt: null,
  band: null, overdue: null, waitingSince: null, eligibleAt: null,
  blocker: "A named source failed", owner: "SCOUT_LANE", nextAction: "Try the next recorded route", ...extra,
} as AssignmentIndexRow);

test("full-population blocker ranking names the actual next owner and does not invent downstream unlock", () => {
  const ranked = rankedWorkBlockers([
    row("publisher", { owner: "SOURCE", waitingSince: "2026-09-01T00:00:00Z" }),
    row("urgent", { band: 1, overdue: true, owner: "ENGINEERING", assignmentKeys: ["one", "two"] }),
    row("done", { state: "SUCCEEDED", blocker: null }),
  ], "2026-09-28T00:00:00Z");
  assert.deepEqual(ranked.map(entry => entry.row.id), ["urgent", "publisher"]);
  assert.deepEqual(ranked.map(entry => entry.rank), [1, 2]);
  assert.equal(ranked[0].category, "NEEDS_CODE_CHANGE");
  assert.equal(ranked[0].linkedInstructions, 2);
  assert.match(ranked[0].rankingWhy, /Downstream work unlocked is not measured/);
  assert.equal(ranked[1].category, "WAITING_ON_PUBLISHER");
});
test("measured ready dependents improve intervention priority without claiming all dependencies are ready",()=>{
  const ranked=rankedWorkBlockers([
    row("many-blocked-elsewhere",{directDependentCount:50,readyAfterThisSettlesCount:0}),
    row("unlocks-three",{directDependentCount:3,readyAfterThisSettlesCount:3}),
    row("unknown",{directDependentCount:100,readyAfterThisSettlesCount:null}),
  ],"2026-09-28T00:00:00Z");
  assert.equal(ranked[0].row.id,"unlocks-three");
  assert.match(ranked[0].rankingWhy,/3 directly dependent items would be ready/);
  assert.match(ranked.find(row=>row.row.id==="unknown")!.rankingWhy,/not measured/);
  assert.match(ranked.find(row=>row.row.id==="many-blocked-elsewhere")!.rankingWhy,/0 directly dependent items/);
});
