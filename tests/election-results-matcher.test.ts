import assert from "node:assert/strict";
import test from "node:test";
import { matchElectionResult } from "../lib/election-results/matcher.ts";
import type { ElectionResult } from "../lib/election-results/types.ts";
import type { BallotSet, Candidacy, Contest, Measure } from "../lib/ballot/types.ts";

const provenance = { sourceUrl: "https://example.gov/ballot", sourceOrg: "Election office", collectedAt: "2026-11-04", verifiedAt: null };
const contest = (id: string, state = "NH", title = "State Representative", district = "sldl:merrimack-1"): Contest => ({
  id, electionId: `${state}-general`, ocdId: `ocd-division/country:us/state:${state.toLowerCase()}${district ? `/${district}` : ""}`,
  divisionVintage: "2026", title, type: "CANDIDACY", voteFor: 1, termYears: 2, scopeNote: null, provenance,
});
const candidate = (id: string, contestId: string, name: string): Candidacy => ({
  id, contestId, givenName: "", familyName: name, partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance,
});
const ballot = (contests: Contest[], candidacies: Candidacy[], measures: Measure[] = []): BallotSet => ({
  election: { id: contests[0].electionId, date: "2026-11-03", name: "General election", state: /state:([a-z]+)/.exec(contests[0].ocdId)![1].toUpperCase() },
  contests, candidacies, measures, absences: [],
});
const result = (state: string, names: string[], rest: Partial<ElectionResult> = {}): ElectionResult => ({
  sourceId: "multistate", sourceName: "MultiState", sourceUrl: "https://example.org/results", creditedSources: [],
  sourceRaceId: "race", state, office: "state_house", officeName: "State House", districtHint: "1", electionDate: "2026-11-03",
  status: "counting", candidates: names.map(name => ({ name })), checkedAt: "2026-11-04T12:00:00Z", quote: "results", ...rest,
});

test("full candidate names match a county-numbered New Hampshire district without relying on its number", () => {
  const a = contest("served-merrimack"), b = contest("served-rockingham", "NH", "State Representative", "sldl:rockingham-1");
  const set = ballot([a, b], [candidate("a", a.id, "Alice Eleanor Quinn"), candidate("b", b.id, "Bob Reed")]);
  const found = matchElectionResult(result("NH", ["Alice Eleanor Quinn"]), set);
  assert.equal(found.kind, "matched");
  if (found.kind === "matched") { assert.equal(found.contest.id, a.id); assert.equal(found.candidates[0].candidacy.id, "a"); }
});

test("Massachusetts named districts and Minnesota lettered districts use candidate identity", () => {
  for (const [state, district, title] of [["MA", "sldl:second-suffolk-and-middlesex", "State Representative - Second Suffolk and Middlesex"],
    ["MN", "sldl:09a", "State Representative District 9A"]]) {
    const held = contest("served", state, title, district);
    assert.equal(matchElectionResult(result(state, ["Alice Quinn"], { districtHint: "200" }),
      ballot([held], [candidate("a", held.id, "QUINN, ALICE")])).kind, "matched");
  }
});

test("a matching district number never beats more matching full names", () => {
  const a = contest("one", "NH", "State Representative", "sldl:1"), b = contest("two", "NH", "State Representative", "sldl:2");
  const set = ballot([a, b], [candidate("a1", a.id, "Alice Quinn"), candidate("b1", b.id, "Alice Quinn"), candidate("b2", b.id, "Bob Reed")]);
  const found = matchElectionResult(result("NH", ["Alice Quinn", "Bob Reed"]), set);
  assert.equal(found.kind === "matched" && found.contest.id, b.id);
});

test("a true race identity tie is returned to the detective without choosing a contest", () => {
  const a = contest("merrimack"), b = contest("rockingham", "NH", "State Representative", "sldl:rockingham-1");
  const found = matchElectionResult(result("NH", ["Alice Quinn"]), ballot([a, b], [candidate("a", a.id, "Alice Quinn"), candidate("b", b.id, "Alice Quinn")]));
  assert.equal(found.kind, "ambiguous");
  if ("contestIds" in found) assert.deepEqual(found.contestIds, [a.id, b.id]);
});

test("governor results attach to the existing joint ticket and retain its visible candidate id", () => {
  const held = contest("governor-ticket", "MN", "Governor / Lt. Governor", "");
  const lead = { ...candidate("ticket-choice", held.id, "Alice Quinn"), ticket: { id: "ticket", runningMate: candidate("mate", held.id, "Bob Reed"), provenance } };
  const found = matchElectionResult(result("MN", ["Alice Quinn / Bob Reed"], { office: "governor", officeName: "Governor" }), ballot([held], [lead]));
  assert.equal(found.kind, "matched");
  if (found.kind === "matched") assert.equal(found.candidates[0].candidacy.id, "ticket-choice");
});

test("surname-only and party-label guesses do not establish a candidate match", () => {
  const held = contest("one");
  assert.equal(matchElectionResult(result("NH", ["Quinn"]), ballot([held], [candidate("a", held.id, "Alice Quinn")])).kind, "unmatched");
  // A middle initial the source leaves out is the same person (AK Governor: "Bernadette M. Wilson" is printed "Bernadette Wilson").
  assert.equal(matchElectionResult(result("NH", ["Alice Quinn"]), ballot([held], [candidate("a", held.id, "Alice E. Quinn")])).kind, "matched");
  assert.equal(matchElectionResult(result("NH", ["Alice Quinn"]), ballot([held], [candidate("a", held.id, "Alice Rae Quinn")])).kind, "unmatched");
});

test("state, office and election boundaries prevent cross-race matches", () => {
  const held = contest("one");
  const set = ballot([held], [candidate("a", held.id, "Alice Quinn")]);
  for (const change of [{ state: "MA" }, { office: "us_house" }, { electionDate: "2024-11-05" }])
    assert.equal(matchElectionResult(result("NH", ["Alice Quinn"], change), set).kind, "unmatched");
});

test("Nebraska's unicameral legislature matches the served state senator office", () => {
  const held = contest("nebraska", "NE", "State Senator, District 8", "sldu:8");
  assert.equal(matchElectionResult(result("NE", ["Alice Quinn"], { office: "state_legislature", officeName: "State Legislature" }),
    ballot([held], [candidate("a", held.id, "Alice Quinn")])).kind, "matched");
});

test("a source candidate missing on a safely matched race remains explicit work", () => {
  const held = contest("one"), a = candidate("a", held.id, "Alice Quinn");
  const found = matchElectionResult(result("NH", ["Alice Quinn", "Bob Reed"]), ballot([held], [a]));
  assert.equal(found.kind, "matched");
  if (found.kind === "matched") { assert.deepEqual(found.unmatchedCandidates, [1]); assert.deepEqual(found.ambiguousCandidates, []); }
});

test("two held candidates with the same full name remain an explicit identity tie", () => {
  const held = contest("one");
  const found = matchElectionResult(result("NH", ["Alice Quinn"]), ballot([held], [candidate("a", held.id, "Alice Quinn"), candidate("b", held.id, "Alice Quinn")]));
  assert.equal(found.kind, "matched");
  if (found.kind === "matched") { assert.deepEqual(found.candidates, []); assert.deepEqual(found.ambiguousCandidates, [0]); }
});

test("statewide measures match held designations without selecting a local measure sharing the number", () => {
  const statewide = { ...contest("statewide", "MA", "Question 1", ""), type: "MEASURE" as const };
  const local = { ...contest("local", "MA", "Question 1", "county:suffolk"), type: "MEASURE" as const };
  const measures = [statewide, local].map(row => ({ id: `${row.id}:measure`, contestId: row.id, officialNumber: "1", questionText: "Shall the law be approved?", officialStatement: null, provenance }));
  const found = matchElectionResult(result("MA", [], { office: "measure", officeName: "Measure", measure: { name: "Question 1", number: "1", outcome: "counting" } }), ballot([statewide, local], [], measures));
  assert.equal(found.kind, "matched");
  if (found.kind === "matched") assert.equal(found.measure?.id, "statewide:measure");
});

test("measure designation matching keeps published type and number despite No. and subtitle furniture", () => {
  const amendment = { ...contest("amendment", "MA", "Constitutional Amendment No. 1: Voting rules", ""), type: "MEASURE" as const };
  const question = { ...contest("question", "MA", "Question 1", ""), type: "MEASURE" as const };
  const measures = [amendment, question].map(row => ({ id: `${row.id}:measure`, contestId: row.id, questionText: "Shall the law be approved?", officialStatement: null, provenance }));
  const found = matchElectionResult(result("MA", [], { office: "measure", officeName: "Measure", measure: { name: "Voting rules", number: "Amendment 1", outcome: "counting" } }), ballot([amendment, question], [], measures));
  assert.equal(found.kind, "matched");
  if (found.kind === "matched") assert.equal(found.contest.id, "amendment");
});

test("the measure number remains readable when No. has no following space", () => {
  const held = { ...contest("alaska", "AK", "Ballot Measure No.2 — Primaries", ""), type: "MEASURE" as const };
  const measure: Measure = { id: "question", contestId: held.id, questionText: "Shall the law pass?", officialStatement: null, provenance };
  const found = matchElectionResult(result("AK", [], { office: "measure", officeName: "Measure", measure: { name: "Primaries", number: "Measure 2", outcome: "counting" } }), ballot([held], [], [measure]));
  assert.equal(found.kind, "matched");
});

for (const number of [141, 320]) test(`Arizona Proposition ${number} matches its served contest before a Measure record exists`, () => {
  const statewide = { ...contest("statewide", "AZ", `Proposition ${number}: Published question title`, ""), type: "MEASURE" as const };
  const local = { ...contest("local", "AZ", `Proposition ${number}`, "county:maricopa"), type: "MEASURE" as const };
  const other = { ...contest("other", "AZ", `Question ${number}`, ""), type: "MEASURE" as const };
  const found = matchElectionResult(result("AZ", [], { office: "measure", officeName: "Measure",
    measure: { name: "Published question title", number: `Proposition ${number}`, outcome: "counting" } }), ballot([statewide, local, other], []));
  assert.equal(found.kind, "matched");
  if (found.kind === "matched") { assert.equal(found.contest.id, statewide.id); assert.equal(found.measure, undefined); }
});

test("missing Measure rows do not permit a designation guess or resolve two matching contests", () => {
  const one = { ...contest("one", "AZ", "Proposition 141", ""), type: "MEASURE" as const };
  const other = { ...one, id: "other", title: "Proposition 142" };
  const source = result("AZ", [], { office: "measure", officeName: "Measure",
    measure: { name: "Published question title", number: "Proposition 141", outcome: "counting" } });
  assert.equal(matchElectionResult(source, ballot([other], [])).kind, "unmatched");
  const tied = matchElectionResult(source, ballot([one, { ...one, id: "duplicate" }], []));
  assert.equal(tied.kind, "ambiguous");
  if (tied.kind === "ambiguous") assert.deepEqual(tied.contestIds, ["one", "duplicate"]);
});

for (const [state, sourceOffice, title, district] of [
  ["AL", "Agriculture Commissioner", "Commissioner of Agriculture and Industries", ""],
  ["AL", "Public Service Commissioner Place 1", "Public Service Commission Place 1", ""],
  ["AL", "Public Service Commissioner Place 2", "Public Service Commission Place 2", ""],
  ["AR", "Commissioner of State Lands", "COMMISSIONER OF STATE LANDS", ""],
  ["DE", "Auditor", "Auditor of Accounts", ""],
  ["FL", "Treasurer", "Chief Financial Officer", ""],
  ["GA", "Insurance Commissioner", "Insurance and Fire Safety Commissioner", ""],
  ["GA", "Superintendent of Public Instruction", "State School Superintendent", ""],
  ["IN", "Auditor", "State Comptroller (Auditor of State)", ""],
  ["IN", "Treasurer", "Treasurer of State", ""],
  ["IA", "Agriculture Commissioner", "Secretary of Agriculture", ""],
  ["IA", "Treasurer", "Treasurer of State", ""],
  ["MS", "State House", "For State House Of Rep 70, District 70", "sldl:70"],
  ["NE", "Auditor", "Auditor of Public Accounts", ""],
  ["ND", "Public Service Commissioner Seat 2", "Public Service Commissioner Unexpired 2-Year Term", ""],
  ["ND", "Superintendent of Public Instruction", "Superintendent of Public Instruction Unexpired 2-Year Term", ""],
  ["ND", "Tax Commissioner", "Tax Commissioner", ""],
  ["ND", "State House", "State Representative Unexpired 2-Year Term District 20", "sldl:20"],
  ["OH", "Treasurer", "Treasurer of State", ""],
  ["SC", "Comptroller General", "Comptroller General", ""],
  ["SC", "Superintendent of Public Instruction", "State Superintendent of Education", ""],
  ["SD", "Commissioner of School and Public Lands", "Commissioner of School and Public Lands", ""],
  ["TX", "Commissioner of the General Land Office", "COMMISSIONER OF THE GENERAL LAND OFFICE", ""],
  ["TX", "Comptroller", "COMPTROLLER OF PUBLIC ACCOUNTS", ""],
  ["TX", "State House", "STATE REPRESENTATIVE, DISTRICT 93 — Special Election", "sldl:93"],
  ["TX", "State Senate", "STATE SENATE, DISTRICT 22 — Special Election", "sldu:22"],
  ["VT", "Auditor", "AUDITOR OF ACCOUNTS", ""],
]) test(`${state} results recognize the served office title: ${title}`, () => {
  const held = contest("served-office", state, title, district);
  const set = ballot([held], [candidate("served-person", held.id, "Alice Eleanor Quinn")]);
  const office = sourceOffice.toLowerCase().replaceAll(" ", "_");
  const found = matchElectionResult(result(state, ["Alice Eleanor Quinn"], { office, officeName: sourceOffice, districtHint: "999" }), set);
  assert.equal(found.kind, "matched");
  if (found.kind === "matched") assert.equal(found.contest.id, held.id);
  assert.equal(matchElectionResult(result(state, ["Another Full Name"], { office, officeName: sourceOffice }), set).kind, "unmatched",
    "an office alias still requires the full candidate name");
});

for (const [state, sourceOffice, title, district] of [
  ["NC", "State House", "GASTON SOIL AND WATER CONSERVATION DISTRICT SUPERVISOR", "county:gaston"],
  ["TX", "State House", "Williamson-Travis Counties Municipal Utility District No. 1 Directors", "special_district:williamson_travis_counties_mud_1"],
  ["TX", "State Senate", "JUDGE, COUNTY CRIMINAL COURT NO. 1", "county:tarrant"],
  ["GA", "Superintendent of Public Instruction", "State School Superintendent", "county:example"],
  ["FL", "Treasurer", "Chief Financial Officer", "county:example"],
  ["CA", "Treasurer", "Chief Financial Officer", ""],
  ["ND", "Tax Commissioner", "Tax Commissioner", "county:example"],
  ["SC", "Comptroller General", "Comptroller of Public Accounts", ""],
]) test(`${state} a full name cannot match the wrong office or scope: ${title}`, () => {
  const held = contest("wrong-office", state, title, district);
  const found = matchElectionResult(result(state, ["Alice Eleanor Quinn"], {
    office: sourceOffice.toLowerCase().replaceAll(" ", "_"), officeName: sourceOffice,
  }), ballot([held], [candidate("same-full-name", held.id, "Alice Eleanor Quinn")]));
  assert.equal(found.kind, "unmatched");
});

const given = (id: string, contestId: string, givenName: string, familyName: string): Candidacy => ({ ...candidate(id, contestId, familyName), givenName });

test("an Arizona district seat takes its Ballotpedia result by candidate names, nickname and suffix spellings included", () => {
  const held = contest("az-6", "AZ", "U.S. Representative, District 6", "cd:6"), other = contest("az-7", "AZ", "U.S. Representative, District 7", "cd:7");
  const set = ballot([held, other], [given("m", held.id, "JoAnna", "Mendoza"), given("c", held.id, "Juan", "Ciscomani"),
    given("p", held.id, "Jereme Lance", "Peters"), given("f", other.id, "Thomas \"Jay\"", "Feely IV"), given("g", other.id, "Adelita", "Grijalva")]);
  const found = matchElectionResult(result("AZ", ["JoAnna Mendoza", "Juan Ciscomani", "Jereme Peters"], { office: "us_house", officeName: "U.S. House Arizona District 6", districtHint: "6" }), set);
  assert.equal(found.kind, "matched");
  if (found.kind === "matched") { assert.equal(found.contest.id, held.id); assert.equal(found.candidates.length, 3); assert.deepEqual(found.unmatchedCandidates, []); }
  const nickname = matchElectionResult(result("AZ", ["Jay Feely", "Adelita Grijalva"], { office: "us_house", districtHint: "7" }), set);
  assert.equal(nickname.kind === "matched" && nickname.contest.id, other.id);
});

test("an at-large House seat and a Senate special with a parenthetical term match their served contests", () => {
  const house = contest("ak-house", "AK", "U.S. Representative", "cd:0"), senate = contest("oh-special", "OH", "U.S. Senator (Unexpired term ending 1/3/2029)", "");
  assert.equal(matchElectionResult(result("AK", ["Nick Begich"], { office: "us_house", districtHint: "at-large" }),
    ballot([house], [given("b", house.id, "Nick", "Begich")])).kind, "matched");
  const found = matchElectionResult(result("OH", ["Sherrod Brown", "Jon Husted"], { office: "us_senate", districtHint: undefined }),
    ballot([senate], [given("s", senate.id, "Sherrod", "Brown"), given("h", senate.id, "Jon", "Husted")]));
  assert.equal(found.kind === "matched" && found.contest.id, senate.id);
});

test("a printed nickname that is not a prefix matches its formal filing name, and a tie between nicknames stays ambiguous", () => {
  const senate = contest("oh-special", "OH", "U.S. Senator (Unexpired term ending 1/3/2029)", "");
  const set = ballot([senate], [given("w", senate.id, "William", "Redpath"), given("g", senate.id, "Gregory", "Levy")]);
  const found = matchElectionResult(result("OH", ["Bill Redpath", "Greg Levy"], { office: "us_senate", districtHint: undefined }), set);
  assert.equal(found.kind, "matched");
  if (found.kind === "matched") { assert.deepEqual(found.candidates.map(row => row.candidacy.id), ["w", "g"]); assert.deepEqual(found.unmatchedCandidates, []); }
  // Different family name or an unrelated given name is never a nickname.
  const other = matchElectionResult(result("OH", ["Bob Redpath", "Greg Levin"], { office: "us_senate", districtHint: undefined }), set);
  assert.equal(other.kind, "unmatched");
  // Two filings that both answer to the printed nickname are a tie, never a guess; an exact filing name still wins.
  const tie = ballot([senate], [given("a", senate.id, "Katherine", "Jones"), given("b", senate.id, "Catherine", "Jones")]);
  const ambiguous = matchElectionResult(result("OH", ["Kate Jones"], { office: "us_senate", districtHint: undefined }), tie);
  assert.equal(ambiguous.kind === "matched" && ambiguous.ambiguousCandidates.join(), "0");
  assert.equal(ambiguous.kind === "matched" && ambiguous.candidates.length, 0);
  const exact = ballot([senate], [given("a", senate.id, "Katherine", "Jones"), given("b", senate.id, "Kate", "Jones")]);
  const chosen = matchElectionResult(result("OH", ["Kate Jones"], { office: "us_senate", districtHint: undefined }), exact);
  assert.equal(chosen.kind === "matched" && chosen.candidates[0]?.candidacy.id, "b");
});
