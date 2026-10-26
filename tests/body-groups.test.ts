import assert from "node:assert/strict";
import test from "node:test";
import { groupBodiesByGovernment } from "../lib/registry/body-groups.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";

function body(id: string, governmentId: string, governmentName: string, governmentType: CoveredBody["governmentType"], extra: Partial<CoveredBody> = {}): CoveredBody {
  return { bodyId: id, ocdId: governmentId, name: `${governmentName} ${id}`, divisionLabel: governmentName,
    divisionType: "county", lsad: null, schoolDependency: "UNCLASSIFIED", bodyClass: "GOVERNING",
    coverageStatus: "NOT_ATTEMPTED", homepageUrl: null, agendaSourceRef: null, lookedAt: false, tier: "local",
    governmentId, governmentName, governmentType, ...extra };
}

test("body lists group a city's and county's bodies together and put each special district under its own government", () => {
  const rows = [
    body("water-board", "water", "Clear Water District", "special_district"),
    body("supervisors", "county", "Pima County", "county"),
    body("fire-board", "fire", "Tucson Fire District", "special_district"),
    body("clerk", "county", "Pima County", "county", { bodyClass: "EXECUTIVE_AGENCY" }),
    body("school-board", "school", "Tucson Unified School District", "school_district"),
    body("council", "city", "City of Tucson", "city"),
  ];
  const sections = groupBodiesByGovernment(rows);
  assert.deepEqual(sections.map(section => section.type), ["city", "county", "school_district", "special_district"]);
  assert.deepEqual(sections.find(section => section.type === "county")!.governments.map(government => ({ name: government.name, ids: government.rows.map(row => row.body.bodyId) })),
    [{ name: "Pima County", ids: ["supervisors", "clerk"] }]);
  const special = sections.find(section => section.label === "Special Districts")!;
  assert.deepEqual(special.governments.map(government => government.name), ["Clear Water District", "Tucson Fire District"]);
  assert.deepEqual(groupBodiesByGovernment([...rows].reverse()), sections);
});

test("a work session remains clickable beneath the body that holds it, preserving every original id", () => {
  const council = body("council", "city", "City of Raleigh", "city");
  const work = body("work", "city", "City of Raleigh", "city", { bodyClass: "MEETING_TYPE", meetingBodyId: "council" });
  const briefing = body("briefing", "city", "City of Raleigh", "city", { bodyClass: "MEETING_TYPE", meetingBodyId: "council" });
  const rows = [work, council, briefing];
  const grouped = groupBodiesByGovernment(rows);
  const group = grouped[0].governments[0];
  assert.equal(group.rows.length, 1);
  assert.equal(group.rows[0].body, council);
  assert.deepEqual(group.rows[0].meetingTypes.map(row => row.bodyId).sort(), ["briefing", "work"]);
  assert.deepEqual(grouped.flatMap(section => section.governments.flatMap(government => government.rows.flatMap(row => [row.body, ...row.meetingTypes]))).map(row => row.bodyId).sort(), rows.map(row => row.bodyId).sort());
});

test("a missing holder or broken parent relationship cannot hide a historical body target", () => {
  const rows = [
    body("work", "city", "City of Raleigh", "city", { meetingBodyId: "missing" }),
    body("one", "county", "Wake County", "county", { meetingBodyId: "two" }),
    body("two", "county", "Wake County", "county", { meetingBodyId: "one" }),
  ];
  const grouped = groupBodiesByGovernment(rows);
  const ids = grouped.flatMap(section => section.governments.flatMap(government => government.rows.flatMap(row => [row.body.bodyId, ...row.meetingTypes.map(type => type.bodyId)])));
  assert.deepEqual(ids.sort(), ["one", "two", "work"]);
});
