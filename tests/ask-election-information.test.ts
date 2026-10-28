import assert from "node:assert/strict";
import test from "node:test";
import { composeElectionInformation, electionInformationQuestion } from "../lib/ask/election-information.ts";
import type { BallotForDivisions } from "../lib/ask/server-sources.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { PublishedElectionField } from "../lib/civic-data/election-fields.ts";

const ROOT = "ocd-division/country:us/state:nj";
const AT = "2026-10-24T12:00:00.000Z";
const set: BallotSet = { election: { id: "fixture:election", name: "2026 General Election", date: "2026-11-03", state: "NJ" },
  contests: [{ id: "fixture:governor", electionId: "fixture:election", ocdId: ROOT, title: "Governor", type: "CANDIDACY",
    divisionVintage: "2025", voteFor: 1, termYears: 4, scopeNote: null,
    provenance: { sourceUrl: "https://example.nj.gov/ballot", sourceOrg: "Fixture Election Office", collectedAt: AT, verifiedAt: AT, secondHand: false } }],
  candidacies: [], measures: [], absences: [] };
const ballot = (value = set): BallotForDivisions => ({ set: value, sets: [value], contests: value.contests, absences: [], loaderFailures: [],
  analysisLoaderFailed: false, setForTarget: () => value, nominees: () => [], positions: () => [],
  measureAnalysis: () => null, measureSummary: () => null, measureProvisions: () => [] });
function field(kind: PublishedElectionField["value"]["fieldKind"], changes: Partial<PublishedElectionField["value"]> = {}): PublishedElectionField {
  return { id: `fixture:${kind}:${changes.divisionId ?? ROOT}`, kind: "ELECTION_FIELD", value: {
    state: "NJ", divisionId: ROOT, fieldKind: kind, text: "Fixture Elections Division", quote: "Published election information.",
    dates: [], electionDate: set.election.date, url: "https://example.nj.gov/elections", navigationUrl: null,
    sourceOrg: "Fixture Election Office", collectedAt: AT, verifiedAt: AT, ...changes } };
}
function compose(question: string, fields: PublishedElectionField[], held = ballot()) {
  const ask = electionInformationQuestion(question);
  assert.ok(ask, question);
  return composeElectionInformation({ question, ask, today: "2026-10-24", ballot: held, fields });
}

test("closed voting questions name an exact state; extra subjects, years and conditions remain with the ordinary reader", () => {
  for (const [question, kind, state] of [
    ["When is Election Day?", "ELECTION_DAY", null],
    ["When did early voting start in Arizona?", "early_voting", "AZ"],
    ["What is the voter registration deadline in Arizona?", "registration_deadline", "AZ"],
    ["How can I contact the Arizona election office?", "election_office", "AZ"],
    ["How can I contact Puerto Rico's election office?", "election_office", "PR"],
  ]) {
    const ask = electionInformationQuestion(question!);
    assert.equal(ask?.field, kind, question!);
    assert.equal(ask?.state, state, question!);
  }
  for (const question of ["When did early voting start in Arizona and Nevada?", "When is Election Day in 2028?",
    "What is the voter registration deadline in Arizona if I moved?", "How can I contact the Washington County election office?",
    "How can I contact the Arizona election office by email?", "When is my school board election?"]) {
    assert.equal(electionInformationQuestion(question), null, question);
  }
});

test("Election Day uses the held election and all its original contest records and sources without a model", context => {
  const fetch = context.mock.method(globalThis, "fetch", () => { throw Error("No model for a held election date"); });
  const before = structuredClone(set);
  const result = compose("When is Election Day?", []);
  assert.ok(result);
  assert.equal(result.missingAnswer, false);
  assert.match(result.composed.answer, /November 3rd, 2026/);
  assert.deepEqual(result.pack.records.map(row => row.id), set.contests.map(row => row.id));
  assert.deepEqual(result.composed.citedUrls, [set.contests[0].provenance.sourceUrl]);
  assert.equal(result.verdict.kind, "PASSED");
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(set, before);
  assert.equal(compose("When is Election Day?", [], { ...ballot(), loaderFailures: ["NJ"] }), null);
  assert.equal(compose("When is Election Day?", [], ballot({ ...set, election: { ...set.election, date: "2024-11-05" } })), null);
});

test("early-voting answers retain the entire official window, mail dates and exceptions instead of guessing from the field title", () => {
  const quote = "October 24 early voting begins; October 27 is the mail application deadline; November 1 early voting ends, except on the stated holiday.";
  const early = field("early_voting", { text: "Last day to vote early", dates: ["2026-10-24", "2026-11-01"], quote });
  const result = compose("When did early voting start in New Jersey?", [early]);
  assert.ok(result);
  assert.equal(result.missingAnswer, false);
  assert.ok(result.composed.answer.includes(quote));
  assert.deepEqual(result.pack.records.map(row => row.id), [early.id]);
  assert.ok(result.pack.records[0].text.includes(quote));
  assert.equal(result.verdict.kind, "PASSED");
});

test("the election office comes from the named state's office, preserving its phone and source", () => {
  const own = field("election_office", { phone: "609-555-0100" });
  const other = field("election_office", { divisionId: `${ROOT}/county:morris`, phone: "973-555-0100" });
  const result = compose("How can I contact the New Jersey election office?", [own, other]);
  assert.ok(result);
  assert.ok(result.composed.answer.includes(own.value.phone!));
  assert.equal(result.composed.answer.includes(other.value.phone!), false);
  assert.deepEqual(result.pack.records.map(row => row.id), [own.id]);
  assert.deepEqual(result.composed.citedUrls, [own.value.url]);
  const withoutBallot = { ...ballot(), set: null, sets: [], contests: [], loaderFailures: ["NJ"] };
  assert.ok(compose("How can I contact the New Jersey election office?", [own], withoutBallot)?.composed.answer.includes(own.value.phone!));
  assert.equal(compose("How can I contact the New Jersey election office?", [field("election_office")]), null);
});

test("a missing or removed deadline remains an explicit gap for the separate AI answer", () => {
  const result = compose("What is the voter registration deadline in New Jersey?", [field("early_voting")]);
  assert.ok(result);
  assert.equal(result.missingAnswer, true);
  assert.equal(result.composed.answer, "We don't have that answer yet.");
  assert.deepEqual(result.pack.records, []);
  assert.deepEqual(result.composed.citedUrls, []);
  assert.ok(result.pack.gaps.length);
});

test("dates for another election or division cannot answer a current statewide question", () => {
  const old = field("registration_deadline", { electionDate: "2024-11-05", dates: ["2024-10-15"] });
  const county = field("registration_deadline", { divisionId: `${ROOT}/county:morris`, dates: ["2026-10-13"] });
  const result = compose("What is the voter registration deadline in New Jersey?", [old, county]);
  assert.ok(result?.missingAnswer);
  assert.deepEqual(result.pack.records, []);
});
