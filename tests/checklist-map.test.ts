import assert from "node:assert/strict";
import test from "node:test";
import { CALENDAR_ITEMS, CHECKLIST_GROUPS, DEADLINE_ITEMS, checklistItemApplies, meetingFreshnessHours } from "../lib/coverage/checklist-map.ts";

test("the overlay carries the checklist's groups and item sets", () => {
  assert.deepEqual(CHECKLIST_GROUPS.seat, ["OFF", "LEG", "EXE", "PRL"]);
  assert.deepEqual(CHECKLIST_GROUPS.body, ["GOV", "PAR"]);
  assert.equal(DEADLINE_ITEMS.size, 8);
  assert.equal(CALENDAR_ITEMS.size, 9);
});

test("a record owes only its own facts, as before", () => {
  assert.equal(checklistItemApplies("federal-legislator", undefined, { id: "LEG-22", group: "LEG" }), false);
  assert.equal(checklistItemApplies("federal-legislator", undefined, { id: "PRL-01", group: "PRL" }), true);
  assert.equal(checklistItemApplies("registry-body", undefined, { id: "ENG-01", group: "ENG" }), false);
  assert.equal(checklistItemApplies("voting-deadline", undefined, { id: "ELE-08", group: "ELE" }), true);
  assert.equal(checklistItemApplies("voting-deadline", undefined, { id: "ELE-09", group: "ELE" }), false);
  assert.equal(checklistItemApplies("meeting", "body-1", { id: "MTG-01", group: "MTG" }), false);
  assert.equal(checklistItemApplies("meeting", undefined, { id: "MTG-01", group: "MTG" }), true);
  assert.equal(checklistItemApplies("body-calendar", undefined, { id: "MTG-05", group: "MTG" }), false);
  assert.equal(checklistItemApplies(undefined, undefined, { id: "ANY-01", group: "ANY" }), true);
});

test("meeting fields stay fresh one hour near the sitting and twelve hours otherwise", () => {
  const now = "2026-10-04T00:00:00Z";
  assert.equal(meetingFreshnessHours("2026-10-10T00:00:00Z", now), 1);
  assert.equal(meetingFreshnessHours("2026-10-12T00:00:00Z", now), 12);
});
