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
  assert.equal(matchElectionResult(result("NH", ["Alice Quinn"]), ballot([held], [candidate("a", held.id, "Alice E. Quinn")])).kind, "unmatched");
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
