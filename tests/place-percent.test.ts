import assert from "node:assert/strict";
import test from "node:test";
import { isCoreChecklistItem, percentOf } from "../lib/coverage/place-percent.ts";
import { placePercent } from "../lib/coverage/place-measures.ts";
import { GROUP_NAMES, PLACE_GROUPS } from "../lib/coverage/group-names.ts";
import { CHECKLIST_GROUPS } from "../lib/coverage/checklist-map.ts";
import { scorePlace, type OwedRowLike } from "../lib/control-plane/admin-view/place-scorecard.ts";
import { orderPlaceWork } from "../lib/control-plane/expansion/dispatch-work.ts";
import checklist from "../lib/control-plane/readiness/checklist-profile.json" with { type: "json" };

const extensionId = checklist.definitions.find(d => d.group === "FIN" && !d.originalCore)!.id;
const row = (checklistId: string, state: OwedRowLike["state"]): OwedRowLike => ({ id: `${checklistId}:${state}`, checklistId, state,
  requirement: checklistId, subject: { id: "s", kind: "division", label: "S" }, held: [] });

test("one formula floors to one decimal and never rounds up to an unearned 100%", () => {
  assert.equal(percentOf(2, 3), 66.6);
  assert.equal(percentOf(999, 1000), 99.9);
  assert.equal(percentOf(0, 0), null);
});

test("extension items stay out of the core count and show apart", () => {
  const rows = [row("GOV-01", "published"), row("GOV-02", "missing"), row(extensionId, "published"), row(extensionId, "published")];
  assert.equal(isCoreChecklistItem(extensionId), false);
  const score = scorePlace(rows, GROUP_NAMES, ["GOV", "FIN"]);
  assert.equal(score.overall.total, 2);
  assert.equal(score.overall.percent, 50);
  assert.equal(placePercent(rows), 50);
  assert.equal(score.extension?.total, 2);
  assert.equal(score.extension?.captured, 2);
  assert.equal(scorePlace([row("GOV-01", "published")], GROUP_NAMES, ["GOV"]).extension, null);
});

test("the family rows add up to the headline", () => {
  const rows = [row("GEO-01", "published"), row("OFF-04", "held"), row("EXE-01", "missing"), row("PRL-01", "stale"), row("GOV-01", "unpublished")];
  const score = scorePlace(rows, GROUP_NAMES, [...PLACE_GROUPS]);
  assert.equal(score.groups.reduce((n, g) => n + g.total, 0), score.overall.total);
  assert.equal(score.groups.reduce((n, g) => n + g.captured, 0), score.overall.captured);
});

test("the runner's place order and Admin give the same number for a place", () => {
  const rows = [row("GOV-01", "published"), row("GOV-02", "held"), row("GOV-03", "missing")];
  const admin = scorePlace(rows, GROUP_NAMES, ["GOV"]).overall.percent;
  assert.equal(admin, placePercent(rows));
  // A held fact counts as captured in both, so the half-captured place outranks the empty one.
  const order = orderPlaceWork({}, [{ key: "a", receiptId: "empty", items: [row("GOV-01", "missing")] },
    { key: "b", receiptId: "held", items: [row("GOV-01", "held"), row("GOV-02", "missing")] }]);
  assert.deepEqual(order, ["empty", "held"]);
});

test("the family names read correctly and ASK, ENG are not place families", () => {
  assert.equal(GROUP_NAMES.EXE, "Executive actions");
  assert.equal(GROUP_NAMES.PRL, "Public statement profiles");
  assert.equal(GROUP_NAMES.ENG, "Reader participation");
  assert.equal(PLACE_GROUPS.has("ASK"), false);
  assert.equal(PLACE_GROUPS.has("ENG"), false);
  assert.equal(CHECKLIST_GROUPS.body.includes("ENG"), false);
  assert.ok(PLACE_GROUPS.has("EXE") && PLACE_GROUPS.has("PRL"));
});
