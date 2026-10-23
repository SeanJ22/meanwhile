import assert from "node:assert/strict";
import test from "node:test";

import type { Candidacy, Contest, Election } from "../lib/ballot/types.ts";
import { ballotQuestionShape, composeBallotSummary, composeOfficeField, contestsOfOffice } from "../lib/ask/ballot-summary.ts";
import type { EvidencePack } from "../lib/ask/evidence.ts";
import { validateAnswer } from "../lib/ask/validate.ts";

const ELECTION: Election = { id: "az-2026-11-03", date: "2026-11-03", name: "2026 General Election", state: "az" };
const provenance = (path: string) => ({ sourceUrl: `https://example.gov/${path}`, sourceOrg: "Example County", collectedAt: "2026-09-20", secondHand: false }) as Contest["provenance"];
const contest = (id: string, title: string, ocdId = "ocd-division/country:us/state:az", type: Contest["type"] = "CANDIDACY"): Contest => ({
  id, electionId: ELECTION.id, ocdId, divisionVintage: "2025", title, type, voteFor: 1, termYears: 4, scopeNote: null, provenance: provenance(id),
});
const candidacy = (id: string, contestId: string, givenName: string, familyName: string, partyLabel: string | null): Candidacy => ({
  id, contestId, givenName, familyName, partyLabel, slogan: null, incumbent: null, websiteUrl: null, provenance: provenance(id),
});

const CONTESTS: Contest[] = [
  contest("gov", "Governor"),
  contest("cd6", "U.S. Representative, District 6", "ocd-division/country:us/state:az/cd:6"),
  contest("sldu19", "State Senator, District 19", "ocd-division/country:us/state:az/sldu:19"),
  contest("sldu17", "State Senator, District 17", "ocd-division/country:us/state:az/sldu:17"),
  contest("p141", "Proposition 141: Prohibit tax; monitoring; vehicle mileage", "ocd-division/country:us/state:az", "MEASURE"),
  contest("p423", "Proposition 423: Vail Unified School District budget override continuation", "ocd-division/country:us/state:az/school_district:vail_unified_district", "MEASURE"),
];

test("the ballot questions are read from their words; an office the table does not hold, or a named person, is not this", () => {
  for (const question of ["What is on my ballot?", "What's on my ballot", "What am I voting on?", "What races are on my ballot?", "What do I vote on?", "Show me my ballot"]) {
    assert.deepEqual(ballotQuestionShape(question), { kind: "SUMMARY" }, question);
  }
  const offices: [string, string][] = [
    ["Who is running for state senate in my district?", "state_senator"],
    ["Who is running for Congress?", "us_representative"],
    ["Who is running for the state house?", "state_lower_house"],
    ["Who's running for governor?", "governor"],
    ["Who are the candidates for attorney general?", "attorney_general"],
    ["Who is running for U.S. Senate?", "us_senator"],
  ];
  for (const [question, key] of offices) {
    const read = ballotQuestionShape(question);
    assert.ok(read?.kind === "OFFICE" && read.key === key, question);
  }
  for (const question of ["Who is running for mayor of Tucson?", "Who is running against Katie Hobbs?", "Who is on the Vail school board?", "What is on my ballot about taxes?", "Explain Prop 141"]) {
    assert.equal(ballotQuestionShape(question), null, question);
  }
});

test("the summary counts the races and the measures and names them, spelling out U.S. so the length contract does not count it as a sentence end", () => {
  const composed = composeBallotSummary({ contests: CONTESTS, election: ELECTION });
  assert.equal(composed?.answer,
    "Your ballot for the 2026 General Election on November 3rd, 2026 has 4 races and 2 ballot measures. The races are Governor, United States Representative, District 6, State Senator, District 19, and State Senator, District 17. The measures are Proposition 141 and Proposition 423.");
  assert.equal(composed?.records.length, 6, "every contest is a record the reader is shown");
  assert.deepEqual(composed?.citedUrls.length, 6);
  const pack: EvidencePack = { question: "What is on my ballot?", intent: "UNKNOWN", temporal: { kind: "NONE" }, subject: null, records: composed!.records, gaps: [], denominators: {}, today: "2026-09-30" };
  assert.equal(validateAnswer(composed!.answer, composed!.citedUrls, pack).kind, "PASSED");
  assert.equal(composeBallotSummary({ contests: [], election: ELECTION }), null, "a ballot we hold nothing of is not summarised");
});

test("an office's field is every contest of that office the reader's divisions reach — two districts, both — with the certified lineup's candidates and parties", () => {
  assert.deepEqual(contestsOfOffice(CONTESTS, "state_senator").map((entry) => entry.id), ["sldu19", "sldu17"]);
  const composed = composeOfficeField({
    key: "state_senator", contests: CONTESTS, election: ELECTION,
    nominees: (id) => id === "sldu19" ? [{ name: "Gail Griffin", partyLabel: "Republican", sourceUrl: "https://example.gov/canvass" }, { name: "Bob Karp", partyLabel: "Democratic", sourceUrl: "https://example.gov/canvass" }] : [],
    candidacies: [candidacy("c1", "sldu17", "Christopher", "King", "Republican"), candidacy("c2", "sldu17", "Edgar", "Soto", "Democratic"), candidacy("c3", "sldu17", "Removed", "Person", "Green")],
    removedCandidacyIds: new Set(["c3"]),
  });
  assert.equal(composed?.answer, "State Senator, District 19: Gail Griffin (Republican) and Bob Karp (Democratic); State Senator, District 17: Christopher King (Republican) and Edgar Soto (Democratic).");
  assert.deepEqual(composed?.gaps, []);
  assert.equal(composed?.records.filter((record) => record.kind === "CANDIDACY").length, 4, "each candidate named is a record with its own source");
  assert.ok(composed?.records.every((record) => record.kind !== "CANDIDACY" || record.text.includes("filed as")), "the party is the record's own");
  const pack: EvidencePack = { question: "Who is running for state senate in my district?", intent: "UNKNOWN", temporal: { kind: "NONE" }, subject: null, records: composed!.records, gaps: [], denominators: {}, today: "2026-09-30" };
  assert.equal(validateAnswer(composed!.answer, composed!.citedUrls, pack).kind, "PASSED");
});

test("a contest with no candidate held says so as a gap of ours; an office with no contest is the caller's", () => {
  const none = composeOfficeField({ key: "governor", contests: CONTESTS, election: ELECTION, nominees: () => [], candidacies: [], removedCandidacyIds: new Set() });
  assert.equal(none?.answer, "We have not recorded who is running for Governor.");
  assert.deepEqual(none?.gaps, ["We have not recorded who is running for Governor."]);
  assert.equal(composeOfficeField({ key: "us_senator", contests: CONTESTS, election: ELECTION, nominees: () => [], candidacies: [], removedCandidacyIds: new Set() }), null);
});

test("local council, board, commission and district offices are matched from the reader's held contests", () => {
  const local = [contest("council", "Member of the Borough Council"),
    contest("board", "School Board Member"), contest("commission", "Water Commission Member"),
    contest("district", "District Attorney"), contest("ward2", "City Council, Ward 2")];
  for (const [phrase, id] of [["borough council", "council"], ["school board", "board"], ["water commission", "commission"], ["district attorney", "district"], ["city council ward 2", "ward2"]]) {
    const shape = ballotQuestionShape(`Who is running for ${phrase}?`, local);
    assert.ok(shape?.kind === "OFFICE");
    const candidate = candidacy(`${id}:candidate`, id, "Avery", "Example", null);
    const answer = composeOfficeField({ ...shape, contests: local, election: ELECTION,
      nominees: () => [], candidacies: [candidate], removedCandidacyIds: new Set() });
    assert.equal(answer?.records.filter(r => r.kind === "CONTEST")[0]?.id, id);
    assert.ok(answer?.answer.includes("Avery Example"));
  }
  assert.equal(ballotQuestionShape("Who is running for parks commission?", local), null);
  assert.equal(ballotQuestionShape("Who is running for city council ward 3?", local), null);
});

test("a local office's division supplies a county omitted by its publisher's title", () => {
  const held = [contest("county-board", "Member of the Board of County Commissioners", "ocd-division/country:us/state:nj/county:morris")];
  for (const question of ["Who is running for Morris County Board of County Commissioners?", "Who is running for county commissioner?"]) {
    const shape = ballotQuestionShape(question, held);
    assert.ok(shape?.kind === "OFFICE", question);
    const result = composeOfficeField({ ...shape, contests: held, election: ELECTION,
      nominees: () => [], candidacies: [candidacy("one", "county-board", "Avery", "Example", "Republican")], removedCandidacyIds: new Set() });
    assert.match(result!.answer, /Avery Example/);
  }
  assert.equal(ballotQuestionShape("Who is running for Essex County Board of County Commissioners?", held), null);
  assert.equal(ballotQuestionShape("Who is running for Morris County sheriff?", held), null);
});
