import assert from "node:assert/strict";
import test from "node:test";
import checklist from "../lib/control-plane/readiness/checklist-profile.json" with { type: "json" };
import { CALENDAR_ITEMS, CHECKLIST_GROUPS, CHECKLIST_ITEMS, DEADLINE_ITEMS, REPLACED_BY_ADMIN, SQUAD_START, applicabilityOf, canonicalItemId, checklistItem, checklistItemApplies, meetingFreshnessHours, squadOf, subjectKindOfUnit } from "../lib/coverage/checklist-map.ts";
import { buildPlaceOwedList } from "../lib/coverage/place-owed.ts";
import { GROUP_NAMES, PLACE_GROUPS } from "../lib/coverage/group-names.ts";

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

test("every checklist ID carries a unit, trigger, due date, predicate kind and score type", () => {
  assert.equal(Object.keys(CHECKLIST_ITEMS).length, checklist.definitionCount);
  for (const d of checklist.definitions) {
    const item = checklistItem(d.id);
    assert.ok(item, d.id);
    for (const key of ["unit", "trigger", "due", "predicateKind", "scoreAs", "countsAs"] as const) assert.ok(item[key], `${d.id} ${key}`);
    assert.equal(item.scoreAs === "core", d.originalCore && d.dimension === "CIVIC_FULL_TARGET", `${d.id} core flag matches the profile`);
    const into = d.contribution === "SHARED" ? d.canonicalPredicate : undefined;
    assert.equal(item.into, into, `${d.id} shared predicate`);
  }
});

test("squads start where the design puts each family, and are a setting", () => {
  assert.equal(squadOf("MTG-05"), "governments-meetings");
  for (const group of ["GEO", "REF", "FIN", "PAR"]) assert.equal(SQUAD_START[group], "governments-meetings");
  for (const group of ["EXE", "PRL", "OFF", "CAN", "CAM", "LEG"]) assert.equal(SQUAD_START[group], "people-money");
  assert.equal(SQUAD_START.ELE, "ballot");
  assert.equal(squadOf("ELE-11", { ELE: "people-money" }), "people-money");
});

test("an unknown trigger is unresolved, never dropped", () => {
  assert.equal(applicabilityOf("GEO-01"), "applies");
  assert.equal(applicabilityOf("DOC-01"), "conditional");
  assert.equal(applicabilityOf("NOT-LISTED-99"), "unresolved");
});

test("the replaced gates are recorded as Admin's", () => {
  assert.deepEqual(Object.keys(REPLACED_BY_ADMIN).sort(), ["GATE-01", "GATE-13"]);
  assert.equal(checklistItem("GATE-01")?.replacedBy, "admin");
  assert.equal(checklistItem("GATE-13")?.replacedBy, "admin");
});

test("reference data is owed by governments and bodies, and shared items count once", () => {
  assert.equal(subjectKindOfUnit("REF-01"), "division");
  assert.equal(subjectKindOfUnit("REF-04"), "body");
  assert.equal(subjectKindOfUnit("REF-08"), null);
  assert.ok(PLACE_GROUPS.has("REF"));
  assert.equal(GROUP_NAMES.REF, "Reference data");
  assert.equal(canonicalItemId("MTG-20"), "MTG-17");
  const now = "2026-10-04T00:00:00Z";
  const rows = buildPlaceOwedList({ divisions: [{ id: "ocd-division/country:us/state:az/county:cochise", label: "Cochise County" }],
    subjects: [{ id: "body-1", kind: "body", captureKind: "registry-body", divisionIds: ["ocd-division/country:us/state:az/county:cochise"], label: "Board" },
      { id: "body-1#calendar", kind: "calendar", captureKind: "body-calendar", divisionIds: ["ocd-division/country:us/state:az/county:cochise"], label: "Board: calendar" }],
    held: [{ subjectId: "body-1#calendar", checklistId: "MTG-20", state: "published", sourceUrl: "https://x.gov", checkedAt: now, freshUntil: "2026-10-05T00:00:00Z" }], now });
  const refRows = rows.filter(r => r.checklistId.startsWith("REF-"));
  assert.ok(refRows.some(r => r.subject.id === "body-1" && r.checklistId === "REF-04"));
  assert.ok(refRows.some(r => r.subject.kind === "division" && r.checklistId === "REF-01"));
  assert.ok(!refRows.some(r => r.checklistId === "REF-08"));
  assert.ok(!rows.some(r => r.checklistId === "MTG-20"), "a shared predicate has no row of its own");
  assert.equal(rows.find(r => r.subject.id === "body-1#calendar" && r.checklistId === "MTG-17")?.state, "published", "the shared fact counts once, under MTG-17");
});
