import assert from "node:assert/strict";
import test from "node:test";
import { buildPlaceOwedList, type HeldPlaceField, type PlaceSubject } from "../lib/coverage/place-owed.ts";
import { peopleCoverage, peopleCoverageWords } from "../lib/coverage/people-coverage.ts";
import { KELLY_FIELDS } from "../lib/coverage/checklist-map.ts";
import { v6PlaceSection } from "../lib/control-plane/admin-view/v6-place-section.ts";

const county = "ocd-division/country:us/state:az/county:cochise";
const now = "2026-10-04T12:00:00Z";
const divisions = [{ id: county, label: "Cochise County" }];
const held = (subjectId: string, checklistId: string): HeldPlaceField => ({ subjectId, checklistId, state: "published", sourceUrl: "https://x.gov", checkedAt: now, freshUntil: "2026-10-05T12:00:00Z" });
const seat = (id: string, captureKind: PlaceSubject["captureKind"]): PlaceSubject => ({ id, kind: "seat", captureKind, divisionIds: [county], label: id });
const candidate = (id: string): PlaceSubject => ({ id, kind: "contest", captureKind: "candidate", divisionIds: [county], label: id });

test("the overlay carries the union of the design's two lists", () => {
  assert.deepEqual(Object.keys(KELLY_FIELDS), ["portrait", "contact", "verifiedPage", "campaignSite", "stances", "money", "votes"]);
  assert.equal(KELLY_FIELDS.campaignSite.appliesTo, "campaign");
  assert.equal(KELLY_FIELDS.votes.appliesTo, "voting-member");
});

test("only the fields that apply to each person are counted", () => {
  const rows = buildPlaceOwedList({ divisions, now,
    subjects: [seat("senator", "state-legislator"), seat("governor", "executive"), candidate("cand:1")],
    held: [held("senator", "OFF-17"), held("senator", "OFF-09"), held("senator", "OFF-08"), held("senator", "OFF-19"),
      held("governor", "OFF-17"),
      held("cand:1", "CAN-17"), held("cand:1", "CAN-06"), held("cand:1", "CAN-01"), held("cand:1", "CAN-05"), held("cand:1", "CAN-07")] });
  const c = peopleCoverage(rows);
  assert.equal(c.people, 3);
  const field = (key: string) => c.fields.find(f => f.key === key)!;
  assert.equal(field("portrait").applies, 3);
  assert.equal(field("portrait").held, 3);
  assert.equal(field("campaignSite").applies, 1, "a campaign site is owed only by people with a campaign");
  assert.equal(field("campaignSite").held, 1);
  assert.equal(field("votes").applies, 1, "votes only for voting members");
  assert.equal(field("votes").held, null, "votes cannot be joined to a person yet: not measured, never missing");
  assert.equal(field("money").held, null);
  assert.deepEqual([...c.notMeasured].sort(), ["Campaign money", "Votes"]);
  assert.equal(c.full, 2, "the senator and the candidate hold every measurable field that applies; the governor holds only a portrait");
  assert.equal(c.percent, 66.6);
  assert.equal(peopleCoverageWords(c), "Officials and candidates with a full profile: 2 of 3");
});

test("a place with no people says nothing is counted, not zero percent", () => {
  const c = peopleCoverage(buildPlaceOwedList({ divisions, now, subjects: [], held: [] }));
  assert.equal(c.people, 0);
  assert.equal(c.percent, null);
});

test("Admin shows the full-profile line with per-field counts", () => {
  const rows = buildPlaceOwedList({ divisions, now, subjects: [seat("senator", "state-legislator")], held: [held("senator", "OFF-17")] });
  const view = v6PlaceSection({ state: "READ", placeKey: "geo:az.county.04003", label: "Cochise County", covers: "x", divisions, rows, observedAt: now, readMs: { geography: 0, held: 0 } },
    { group: null, states: null, q: null, offset: 0, limit: 10 });
  assert.match(view.data.score.profiles.words, /^Officials and candidates with a full profile: 0 of 1$/);
  assert.ok(view.data.score.profiles.figures.fields.some(f => f.key === "portrait" && f.held === 1));
});
