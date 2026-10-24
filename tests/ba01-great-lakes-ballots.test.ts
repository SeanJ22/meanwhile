import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import { ballotCandidateDisplayName } from "../lib/ballot/name-case.ts";
import { ballotCandidatePeople } from "../lib/ballot/tickets.ts";
import type { BallotSet } from "../lib/ballot/types.ts";

const read = (state: string): BallotSet => Object.values(JSON.parse(readFileSync(`data/ballot/2026-general/${state}.json`, "utf8")).ballots)[0] as BallotSet;
const mn = "ocd-division/country:us/state:mn";
const minneapolis = [mn, `${mn}/county:hennepin`, `${mn}/place:minneapolis`, `${mn}/cd:5`, `${mn}/sldu:59`, `${mn}/sldl:59b`];
const source = JSON.parse(gunzipSync(readFileSync("data/ballot/evidence/ba01-great-lakes/mn-district-4-55415.ballot.json.gz")).toString("utf8")) as {
  Ballots: { OfficeTitle: string; CandidateScreenName: string; PartyName: string }[];
};

test("Minnesota's saved 55415 precinct sample matches all 41 races and every named candidate when all source districts are supplied", () => {
  const ballot = ballotForDivisions(read("mn"), [...minneapolis, `${mn}/county:hennepin/council_district:3`]);
  const groups = new Map<string, string[]>();
  for (const row of source.Ballots) {
    if (row.CandidateScreenName === "WRITE-IN") continue;
    const names = groups.get(row.OfficeTitle) ?? [];
    names.push(row.CandidateScreenName); groups.set(row.OfficeTitle, names);
  }
  assert.equal(groups.size, 41);
  assert.equal(ballot.contests.length, groups.size);
  for (const [office, names] of groups) {
    if (office === "CONSTITUTIONAL AMENDMENT 1") {
      assert.equal(ballot.measures.filter(row => row.officialNumber === office).length, 1);
      continue;
    }
    const contest = ballot.contests.filter(row => row.title === office || row.title.endsWith(` — ${office}`));
    assert.equal(contest.length, 1, office);
    const choices = ballot.candidacies.filter(row => row.contestId === contest[0].id);
    const held = choices.map(ballotCandidateDisplayName);
    const listed = office === "Governor & Lt Governor" ? names.map(name => name.replace(" and ", " / ")) : names;
    assert.deepEqual(held.sort(), listed.sort(), office);
    if (office === "Governor & Lt Governor") for (const choice of choices) {
      assert.ok(choice.ticket, "the official joint choice retains both people");
      const people = ballotCandidatePeople(choice);
      assert.equal(people.length, 2);
      assert.notEqual(people[0].id, people[1].id);
      assert.ok(names.includes(people.map(ballotCandidateDisplayName).join(" and ")), "both names match the saved official specimen");
    }
  }
});

test("Minnesota court and school memberships include the verified electorate while commissioner districts stay scoped", () => {
  const ballot = ballotForDivisions(read("mn"), minneapolis);
  assert.equal(ballot.contests.length, 40);
  assert.equal(ballot.contests.filter(row => row.ocdId === `${mn}/judicial_district:4`).length, 21);
  assert.ok(!ballot.contests.some(row => row.title.includes("Commissioner District 3")));
  const school = ballot.contests.find(row => row.title.includes("School Board Member At Large (SSD #1)"));
  assert.equal(school?.voteFor, 2);
  assert.equal(ballot.candidacies.filter(row => row.contestId === school?.id).length, 4);
  const ramsey = ballotForDivisions(read("mn"), [`${mn}/county:ramsey`]);
  assert.equal(ramsey.contests.filter(row => row.ocdId === `${mn}/judicial_district:2`).length, 9);
  assert.ok(!ramsey.contests.some(row => row.ocdId === `${mn}/judicial_district:4` || row.id === school?.id));
});

test("Illinois House99 and countywide offices are returned for their official divisions", () => {
  const state = "ocd-division/country:us/state:il", set = read("il");
  const brown = ballotForDivisions(set, [`${state}/county:brown`, `${state}/sldl:99`]);
  const house = brown.contests.filter(row => row.ocdId === `${state}/sldl:99`);
  assert.equal(house.length, 1);
  assert.deepEqual(brown.candidacies.filter(row => row.contestId === house[0].id).map(row => [row.familyName, row.partyLabel]), [["Kyle A. Moore", "REPUBLICAN"]]);
  assert.equal(brown.contests.filter(row => row.ocdId === `${state}/county:brown`).length, 3);
  assert.ok(!brown.contests.some(row => row.ocdId === `${state}/county:sangamon`));
  const sangamon = ballotForDivisions(set, [`${state}/county:sangamon`]);
  const sheriff = sangamon.contests.find(row => row.title === "Sangamon County — FOR COUNTY SHERIFF")!;
  assert.deepEqual(sangamon.candidacies.filter(row => row.contestId === sheriff.id).map(row => [row.familyName, row.partyLabel]), [["Paula Crouch", "REPUBLICAN"], ["Marc Bell", "DEMOCRATIC"]]);
});

test("Ohio's verified county races and statutory appellate districts project without widening council districts", () => {
  const set = read("oh"), state = "ocd-division/country:us/state:oh";
  const cuyahoga = ballotForDivisions(set, [`${state}/county:cuyahoga`]);
  assert.equal(cuyahoga.contests.filter(row => row.ocdId === `${state}/court_of_appeals:8`).length, 5);
  assert.equal(cuyahoga.contests.filter(row => row.ocdId === `${state}/county:cuyahoga` && row.title.includes("Common Pleas")).length, 13);
  assert.ok(!cuyahoga.contests.some(row => row.title.includes("Member of County Council")));
  const executive = cuyahoga.contests.find(row => row.title === "Cuyahoga County — For County Executive")!;
  assert.deepEqual(cuyahoga.candidacies.filter(row => row.contestId === executive.id).map(row => row.familyName), ["Chris Ronayne", "Christopher Michael Litwinowicz"]);
  assert.ok(!cuyahoga.candidacies.some(row => row.familyName === "Tariq K. Shabazz"));
  const summit = ballotForDivisions(set, [`${state}/county:summit`]);
  assert.equal(summit.contests.filter(row => row.ocdId === `${state}/court_of_appeals:9`).length, 2);
  const atLarge = summit.contests.find(row => row.title.includes("SUMMIT COUNTY COUNCIL-AT-LARGE"))!;
  assert.equal(atLarge.voteFor, 3);
  assert.equal(summit.candidacies.filter(row => row.contestId === atLarge.id).length, 6);
  const greene = ballotForDivisions(set, [`${state}/county:greene`]);
  assert.equal(greene.contests.filter(row => row.ocdId === `${state}/court_of_appeals:2`).length, 1);
  assert.ok(!greene.contests.some(row => row.ocdId === `${state}/county:montgomery` || row.ocdId === `${state}/court_of_appeals:8`));
});

test("Minnesota school numbers bind to named districts and local wards never become citywide races", () => {
  const set = read("mn");
  const school = ballotForDivisions(set, [`${mn}/school_district:elk_river_school_district`]);
  const atLarge = school.contests.find(row => row.title.includes("School Board Member At Large (ISD #728)"))!;
  assert.equal(atLarge.voteFor, 2);
  assert.equal(school.candidacies.filter(row => row.contestId === atLarge.id).length, 5);
  assert.ok(!school.contests.some(row => row.title.includes("School Board Member District 1")));
  const aitkin = ballotForDivisions(set, [`${mn}/school_district:aitkin_public_school_district`]);
  assert.ok(!aitkin.contests.some(row => row.title.includes("SSD #1")));
  const city = ballotForDivisions(set, [`${mn}/place:apple_valley`]);
  const council = city.contests.find(row => row.title === "Council Member (Apple Valley) (Elect 2)")!;
  assert.equal(council.voteFor, 2);
  assert.equal(city.candidacies.filter(row => row.contestId === council.id).length, 5);
  assert.ok(!city.contests.some(row => row.ocdId.includes("/school_district:")));
});

test("Ohio local measure questions retain the complete official question and their exact electorate", () => {
  const set = read("oh"), state = "ocd-division/country:us/state:oh";
  const county = ballotForDivisions(set, [`${state}/county:hamilton`]);
  const tax = county.measures.find(row => row.contestId === "oh-ba01-hamilton-issue-10")!;
  assert.ok(tax.questionText.startsWith("A renewal of 4.51 mills"));
  assert.ok(tax.questionText.endsWith("due in calendar year 2027."));
  assert.ok(!county.contests.some(row => row.id === "oh-ba01-cincinnati-csd-issue-4"));
  const school = ballotForDivisions(set, [`${state}/school_district:cincinnati_city_school_district`]);
  assert.ok(school.measures.find(row => row.contestId === "oh-ba01-cincinnati-csd-issue-4")?.questionText.endsWith("which is 6% of those expenditures."));
  const akron = ballotForDivisions(set, [`${state}/place:akron`]);
  assert.deepEqual(akron.measures.filter(row => row.contestId.startsWith("oh-ba01-akron-issue-")).map(row => row.officialNumber).sort(), ["11", "12", "13"]);
  assert.ok(akron.measures.filter(row => row.contestId.startsWith("oh-ba01-akron-issue-")).every(row => row.questionText.startsWith("Shall") && row.questionText.endsWith("?")));
  const district = ballotForDivisions(set, [`${state}/county:cuyahoga/council_district:7`]);
  const council = district.contests.find(row => row.title === "Cuyahoga County — For Member of County Council (District 7)")!;
  assert.deepEqual(district.candidacies.filter(row => row.contestId === council.id).map(row => row.familyName), ["Yvonne M. Conwell"]);
});

test("Michigan's complete judicial roster preserves eligible multi-seat races and exact court electorates", () => {
  const set = read("mi"), state = "ocd-division/country:us/state:mi";
  const local = set.contests.filter(row => row.id.startsWith("mi-ba01-"));
  assert.equal(local.length, 168);
  assert.equal(set.candidacies.filter(row => local.some(contest => contest.id === row.contestId)).length, 252);
  const wayne = ballotForDivisions(set, [`${state}/county:wayne`, `${state}/place:detroit`]);
  const courts = wayne.contests.filter(row => row.id.startsWith("mi-ba01-"));
  assert.equal(courts.length, 9);
  assert.equal(wayne.candidacies.filter(row => courts.some(contest => contest.id === row.contestId)).length, 38);
  const incumbent = courts.find(row => row.title === "3rd Circuit Judge of Circuit Court Incumbent 6 Year Terms (16) Positions")!;
  assert.equal(incumbent.voteFor, 16);
  assert.equal(wayne.candidacies.filter(row => row.contestId === incumbent.id).length, 16);
  const probate = courts.find(row => row.title === "WAYNE Judge of Probate Court Non-Incumbent 6 Year Terms (3) Positions Files With County")!;
  assert.deepEqual(wayne.candidacies.filter(row => row.contestId === probate.id).map(row => row.familyName).sort(), ["Colegrove, Sarah", "Fanning, Suzanne", "Moss, Vanessa M."]);
  assert.ok(!wayne.candidacies.some(row => row.familyName === "Hubbard, Susan L." || row.familyName === "Leggs, Shalanda C."));
  const macomb = ballotForDivisions(set, [`${state}/county:macomb`]);
  assert.ok(!macomb.contests.some(row => row.ocdId === `${state}/district_court:36` || row.ocdId === `${state}/circuit_court:3`));
  const countyOnly = ballotForDivisions(set, [`${state}/county:wayne`]);
  assert.ok(!countyOnly.contests.some(row => row.ocdId === `${state}/district_court:36`));
  const district52 = ballotForDivisions(set, [`${state}/district_court:52/division:2`]);
  assert.equal(district52.contests.filter(row => row.id.startsWith("mi-ba01-")).length, 1);
  assert.ok(!district52.contests.some(row => row.ocdId === `${state}/district_court:52/division:1`));
});
