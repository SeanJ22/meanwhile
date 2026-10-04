import assert from "node:assert/strict";
import test from "node:test";
import { buildPlaceOwedList, type HeldPlaceField, type PlaceSubject } from "../lib/coverage/place-owed.ts";
import { coverageWords, isGovernmentDivision, placeCoverage } from "../lib/coverage/place-coverage.ts";
import { v6PlaceSection } from "../lib/control-plane/admin-view/v6-place-section.ts";

const county = "ocd-division/country:us/state:az/county:cochise";
const town = `${county}/place:bisbee`;
const school = `${county}/school_district:bisbee_unified`;
const tract = `${county}/place:statistical_area`;
const now = "2026-10-04T12:00:00Z";
const divisions = [{ id: county, label: "Cochise County" }, { id: town, label: "Bisbee" }, { id: school, label: "Bisbee Unified" },
  { id: tract, label: "Statistical area", funcstat: "S" }];
const held = (subjectId: string, checklistId: string, value?: unknown): HeldPlaceField => ({ subjectId, checklistId, state: "published",
  sourceUrl: `https://source/${subjectId}`, checkedAt: now, freshUntil: "2026-10-05T12:00:00Z", ...(value === undefined ? {} : { value }) });
const body = (id: string, divisionId: string): PlaceSubject => ({ id, kind: "body", captureKind: "registry-body", divisionIds: [divisionId], label: id });
const seat = (id: string): PlaceSubject => ({ id, kind: "seat", divisionIds: [county], label: id });
const candidate = (id: string): PlaceSubject => ({ id, kind: "contest", captureKind: "candidate", divisionIds: [county], label: id });

test("statistical areas are not governments", () => {
  assert.equal(isGovernmentDivision({ id: tract, funcstat: "S" }), false);
  assert.equal(isGovernmentDivision({ id: school }), true);
  assert.equal(isGovernmentDivision({ id: "ocd-division/country:us/state:az/cd:6" }), false);
});

test("governments are counted against the place's divisions, bodies show total unknown, people are seats plus candidates", () => {
  const rows = buildPlaceOwedList({ divisions, now,
    subjects: [body("county-board", county), body("bisbee-council", town), seat("seat:1"), seat("seat:2"), candidate("cand:1"), candidate("cand:2")],
    held: [held("county-board", "GOV-01"), held("bisbee-council", "GOV-01"), held("seat:1", "OFF-04"), held("cand:1", "CAN-01"),
      held("county-board", "REF-06", { authorizedSeats: 5 })] });
  const coverage = placeCoverage(rows, divisions);
  assert.deepEqual(coverage.governments, { accounted: 2, expected: 3 }, "the county and the town are accounted for; the school district is not; the statistical area is excluded");
  assert.deepEqual(coverage.bodies, { found: 2, total: null, sourcesChecked: 2 });
  assert.deepEqual(coverage.seats, { accounted: 1, expected: 5 });
  assert.deepEqual(coverage.people, { accounted: 2, expected: 7 });
  assert.deepEqual(coverageWords(coverage).slice(0, 2), ["Governments: 2 of 3 accounted for", "Bodies: 2 found, total unknown · 2 sources checked"]);
});

test("seats and people say total unknown when no body composition is held", () => {
  const rows = buildPlaceOwedList({ divisions, now, subjects: [seat("seat:1")], held: [held("seat:1", "OFF-04")] });
  const coverage = placeCoverage(rows, divisions);
  assert.equal(coverage.seats.expected, null);
  assert.equal(coverage.people.expected, null);
  assert.ok(coverageWords(coverage).includes("Seats: 1 accounted for, total unknown"));
});

test("Admin's checklist for a sent place shows the coverage line", () => {
  const rows = buildPlaceOwedList({ divisions, now, subjects: [body("county-board", county)], held: [held("county-board", "GOV-01")] });
  const view = v6PlaceSection({ state: "READ", placeKey: "geo:az.county.04003", label: "Cochise County", covers: "x", divisions, rows, observedAt: now, readMs: { geography: 0, held: 0 } },
    { group: null, states: null, q: null, offset: 0, limit: 10 });
  assert.match(view.data.score.coverage.words.join(" · "), /Governments: 1 of 3 accounted for · Bodies: 1 found, total unknown/);
});
