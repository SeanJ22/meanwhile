import assert from "node:assert/strict";
import test from "node:test";
import type { Contest } from "../lib/ballot/types.ts";
import { lexicalReading } from "../lib/ask/lexical-reading.ts";
import { composeMissingContestCivics } from "../lib/ask/ballot-only-answer.ts";
import type { EvidencePack } from "../lib/ask/evidence.ts";
import type { BindableEntity } from "../lib/routing/named-entity.ts";

const ROOT = "ocd-division/country:us/state:nh";
const contest: Contest = { id: "fixture:governor", electionId: "fixture:2026", title: "Governor", type: "CANDIDACY",
  ocdId: ROOT, divisionVintage: "2026", termYears: 2, voteFor: 1, scopeNote: null,
  provenance: { sourceUrl: "https://example.nh.gov/ballot", sourceOrg: "Fixture Election Office", collectedAt: "2026-10-24", verifiedAt: null, secondHand: false } };
const entity: BindableEntity = { id: contest.id, name: contest.title, nameClass: "body", divisionType: "contest", ocdId: ROOT };
function read(question: string, contests = [contest], inventory = [entity]) {
  return lexicalReading({ question, readerContests: contests, inventory, namedBodies: [] });
}

test("an exact held office and its state establish a civics subject without asking a model to rename it", context => {
  const fetch = context.mock.method(globalThis, "fetch", () => { throw Error("No model needed to bind a held office"); });
  for (const question of ["What does the governor of New Hampshire do?", "What does the New Hampshire governor do?", "What does the governor do?"]) {
    const reading = read(question);
    assert.equal(reading?.shape, "CONTEST_CIVICS", question);
    assert.equal(reading?.subjectId, contest.id);
    assert.equal(reading?.interpretation.intent, "CIVICS");
    assert.deepEqual(reading?.interpretation.temporal, { kind: "NONE" });
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("duties with another state, conditions, history, a person or several matching contests keep the ordinary reader", () => {
  for (const question of ["What does the governor of Vermont do?", "What does the New Hampshire governor do about taxes?",
    "What does the governor do during an emergency?", "What did the governor do?", "What does Casey Example do?",
    "What does the governor and the secretary of state do?"]) {
    assert.notEqual(read(question)?.shape, "CONTEST_CIVICS", question);
  }
  assert.notEqual(read("What does the governor do?", [contest, { ...contest, id: "fixture:other-governor" }])?.shape, "CONTEST_CIVICS");
  assert.notEqual(lexicalReading({ question: "What does the governor do?", readerContests: [contest], inventory: [entity], namedBodies: [],
    activeSubjects: [{ id: "fixture:focused", name: "Focused subject", kind: "PERSON", focused: true }] })?.shape, "CONTEST_CIVICS");
  assert.notEqual(read("What does the governor do?", [contest], [])?.shape, "CONTEST_CIVICS");
});

test("local councils and generic school or county boards retain the body reader even when one ballot contest matches", () => {
  const local: Contest = { ...contest, id: "fixture:council", title: "Concord City Council", ocdId: `${ROOT}/place:concord` };
  const body: BindableEntity = { id: `${local.ocdId}#governing`, name: local.title, nameClass: "body", level: "BODY", divisionType: "place", ocdId: local.ocdId };
  const reading = lexicalReading({ question: "What does the Concord City Council do?", readerContests: [local],
    inventory: [body, { ...entity, id: local.id, name: local.title, ocdId: local.ocdId }], namedBodies: [body] });
  assert.ok(reading);
  assert.equal(reading.shape, "BODY_CIVICS");
  assert.equal(reading.subjectId, body.id);
  for (const [question, title, division] of [
    ["What does a school board do?", "School Board", `${ROOT}/school_district:fixture`],
    ["What does a county board of supervisors do?", "County Board of Supervisors", `${ROOT}/county:fixture`],
  ]) {
    assert.notEqual(read(question, [{ ...contest, title, ocdId: division }])?.shape, "CONTEST_CIVICS", question);
  }
});

const pack: EvidencePack = { question: "What does the governor of New Hampshire do?", intent: "CIVICS", temporal: { kind: "NONE" },
  subject: { id: contest.id, kind: "CONTEST", name: contest.title, office: null }, today: "2026-10-24", denominators: {}, gaps: [], records: [
    { id: contest.id, kind: "CONTEST", text: "Governor appears on the held ballot.", sourceUrl: contest.provenance.sourceUrl },
    { id: "fixture:candidate", kind: "CANDIDACY", text: "Casey Example filed for governor.", sourceUrl: contest.provenance.sourceUrl },
    { id: "fixture:absence", kind: "BALLOT_ABSENCE", text: "The saved ballot's own absence.", sourceUrl: contest.provenance.sourceUrl },
  ] };

test("candidate records cannot establish duties: the gap needs no grounded writer and retains every original record", () => {
  const before = structuredClone(pack);
  const composed = composeMissingContestCivics(pack);
  assert.ok(composed?.missingAnswer);
  assert.equal(composed.answer, "We don't have that answer yet.");
  assert.deepEqual(composed.citedUrls, []);
  assert.deepEqual(pack, before);
});

test("a held definition or source passage still gets the grounded writer; an unrelated or empty pack cannot stand for this contest", () => {
  for (const kind of ["OFFICE", "BODY", "SOURCE_PASSAGE"] as const) {
    assert.equal(composeMissingContestCivics({ ...pack, records: [...pack.records,
      { kind, id: "fixture:definition", text: "The held source defines this office's powers.", sourceUrl: "https://example.nh.gov/constitution" }] }), null);
  }
  assert.equal(composeMissingContestCivics({ ...pack, records: [] }), null);
  assert.equal(composeMissingContestCivics({ ...pack, subject: { ...pack.subject!, id: "fixture:other" } }), null);
  assert.equal(composeMissingContestCivics({ ...pack, intent: "PERSON_RECORD" }), null);
});
