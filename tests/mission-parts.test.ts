/**
 * CH-15: missions split into parts from settings. The pure mapping from checklist family and record class to
 * mission parts, read from the overlay's squad and overridden by the `expansion.missionParts` setting.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { settingDefinition, withSetting, type SettingValue } from "../lib/control-plane/settings.ts";
import { CHECKLIST_FAMILIES, SQUAD_START } from "../lib/coverage/checklist-map.ts";
import { ROUTINE_RECORD_CLASSES } from "../lib/civic-data/types.ts";
import { RECORD_CLASSES } from "../lib/answerability/record-class.ts";
import { buildPlaceOwedList, type PlaceSubject } from "../lib/coverage/place-owed.ts";
import { openBlanksOf } from "../lib/coverage/open-blanks.ts";
import {
  DEFAULT_MISSION_PARTS, MISSION_PARTS_SETTING, missionPartCounts, missionPartOf, missionPartsOf, squadsOf, validMissionParts,
} from "../lib/control-plane/expansion/mission-parts.ts";

const at = "2026-10-05T21:00:00Z";
const county = "ocd-division/country:us/state:az/county:cochise";

test("the starting value is the three §8.1 parts, with families from the overlay's squad", () => {
  assert.deepEqual(DEFAULT_MISSION_PARTS.parts.map((part) => part.id), ["governments-meetings", "people-money", "ballot"]);
  assert.deepEqual(DEFAULT_MISSION_PARTS.families, SQUAD_START);
  assert.ok(validMissionParts(DEFAULT_MISSION_PARTS));
  assert.equal(settingDefinition(MISSION_PARTS_SETTING)?.control, "json");
  // §8.1 families, and the ones the design leaves unassigned, start where the plan puts them.
  const part = (family: string) => missionPartOf({ family });
  for (const family of ["GOV", "MTG", "DOC", "GEO", "REF", "FIN", "PAR"]) assert.equal(part(family), "governments-meetings", family);
  for (const family of ["OFF", "CAN", "CAM", "LEG", "EXE", "PRL"]) assert.equal(part(family), "people-money", family);
  assert.equal(part("ELE"), "ballot");
  assert.equal(missionPartOf({ recordClass: "BALLOT_FILING" }), "ballot", "measures ride the ballot");
  assert.deepEqual(DEFAULT_MISSION_PARTS.weightByGovernmentClass, ["governments-meetings"]);
});

test("every family the overlay gives a squad and every record class the factory writes has a part", () => {
  for (const [family, row] of Object.entries(CHECKLIST_FAMILIES)) {
    assert.equal(missionPartOf({ family }), row.squad, family);
  }
  const unplaced = [...ROUTINE_RECORD_CLASSES, ...RECORD_CLASSES]
    .filter((recordClass) => missionPartOf({ recordClass }) === null && recordClass !== "CURATED_READER_RECORD");
  assert.deepEqual(unplaced, []);
});

test("a checklist item is placed by its family before any record class", () => {
  assert.equal(missionPartOf({ checklistId: "MTG-07", recordClass: "STATE_CAMPAIGN_FINANCE" }), "governments-meetings");
  assert.equal(missionPartOf({ checklistId: "SAFE-01" }), null, "a family no part takes is null, not dropped into a part");
  assert.equal(missionPartOf({ recordClass: "NOT_A_CLASS" }), null);
});

test("the setting overrides the overlay and is read live from the config", () => {
  const config = defaultAdminConfig(at);
  assert.deepEqual(missionPartsOf(null), DEFAULT_MISSION_PARTS);
  assert.deepEqual(missionPartsOf(config), DEFAULT_MISSION_PARTS);
  const changed = withSetting(config, { id: "c1", key: MISSION_PARTS_SETTING, at, why: "",
    after: { parts: [...DEFAULT_MISSION_PARTS.parts, { id: "finance", label: "Government money" }],
      families: { FIN: "finance" }, recordClasses: {}, weightByGovernmentClass: [] } as unknown as SettingValue });
  const parts = missionPartsOf(changed);
  assert.equal(missionPartOf({ checklistId: "FIN-01" }, parts), "finance");
  assert.equal(missionPartOf({ checklistId: "OFF-01" }, parts), "people-money", "a family the setting leaves out keeps the overlay's squad");
  assert.equal(missionPartOf({ recordClass: "MEETING" }, parts), null, "the setting's record classes replace the default ones");
  assert.equal(squadsOf(parts).FIN, "finance");
});

test("a setting that names a part it does not list, or no parts, is refused", () => {
  assert.equal(validMissionParts({ ...DEFAULT_MISSION_PARTS, families: { GOV: "nowhere" } }), false);
  assert.equal(validMissionParts({ ...DEFAULT_MISSION_PARTS, recordClasses: { MEETING: "nowhere" } }), false);
  assert.equal(validMissionParts({ ...DEFAULT_MISSION_PARTS, weightByGovernmentClass: ["nowhere"] }), false);
  assert.equal(validMissionParts({ ...DEFAULT_MISSION_PARTS, parts: [] }), false);
  assert.equal(validMissionParts({ ...DEFAULT_MISSION_PARTS, parts: [{ id: "ballot", label: "A" }, { id: "ballot", label: "B" }] }), false);
  assert.throws(() => withSetting(defaultAdminConfig(at), { id: "c2", key: MISSION_PARTS_SETTING, at, why: "", after: { parts: [] } }));
});

test("a place's owed list is grouped by part, with counts, and its open blanks follow the same parts", () => {
  const meeting: PlaceSubject = { id: "meeting:1", kind: "calendar", captureKind: "meeting", divisionIds: [county], label: "Board", startsAt: "2026-10-20T12:00:00Z" };
  const seat: PlaceSubject = { id: "seat:1", kind: "seat", captureKind: "local-officeholder", divisionIds: [county], label: "Supervisor" };
  const rows = buildPlaceOwedList({ divisions: [{ id: county, label: "Cochise County" }], subjects: [meeting, seat], held: [], now: at,
    hunt: (id, checklistId) => (id === "meeting:1" && checklistId === "MTG-07" ? { inProgress: true, attempts: 0 } : null) });
  const counts = missionPartCounts(rows);
  assert.deepEqual(counts.slice(0, 3).map((row) => row.part), ["governments-meetings", "people-money", "ballot"]);
  const total = counts.reduce((sum, row) => sum + row.owed, 0);
  assert.equal(total, rows.length, "every owed row is counted in exactly one part");
  const governments = counts.find((row) => row.part === "governments-meetings")!;
  assert.equal(governments.label, "Governments and meetings");
  assert.equal(governments.inProgress, 1);
  assert.ok(counts.find((row) => row.part === "people-money")!.owed > 0, "the seat owes people-and-money rows");
  const open = openBlanksOf(rows, squadsOf(DEFAULT_MISSION_PARTS));
  for (const row of counts) {
    const grouped = [...(open.bySquad.get(row.part)?.values() ?? [])].flat().length;
    assert.equal(grouped, row.open, row.part);
  }
});
