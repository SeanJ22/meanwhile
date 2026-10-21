import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import type { BallotSet } from "../lib/ballot/types.ts";

async function stateBallot(state: string): Promise<BallotSet> {
  const source = JSON.parse(await readFile(new URL(`../data/ballot/2026-general/${state}.json`, import.meta.url), "utf8"));
  return Object.values(source.ballots)[0] as BallotSet;
}

test("Fairfax county and Herndon ballots include both local bond questions without leaking town contests", async () => {
  const state = await stateBallot("va");
  const divisions = ["ocd-division/country:us/state:va", "ocd-division/country:us/state:va/cd:11", "ocd-division/country:us/state:va/county:fairfax_51059"];
  const county = ballotForDivisions(state, divisions);
  assert.equal(county.contests.length, 7, "official Fairfax November 11th-CD full sample has seven contests");
  assert.equal(county.measures.length, 5);
  assert.equal(county.contests.some(row => row.title.includes("Herndon")), false);
  assert.ok(county.measures.some(row => row.questionText.includes("$180,000,000")));
  assert.ok(county.measures.some(row => row.questionText.includes("$75,000,000")));
  const town = ballotForDivisions(state, [...divisions, "ocd-division/country:us/state:va/place:herndon"]);
  assert.equal(town.contests.length, 9, "official Herndon full sample adds mayor and town council");
  const council = town.contests.find(row => row.title === "Member Town Council — Town of Herndon")!;
  assert.equal(council.voteFor, 6);
  assert.equal(town.candidacies.filter(row => row.contestId === council.id).length, 12);
});

test("Charlotte bond measures remain within the city and include their full statutory cost disclosures", async () => {
  const state = await stateBallot("nc");
  const county = ["ocd-division/country:us/state:nc", "ocd-division/country:us/state:nc/county:mecklenburg"];
  const outsideCity = ballotForDivisions(state, county);
  assert.equal(outsideCity.measures.length, 3);
  const city = ballotForDivisions(state, [...county, "ocd-division/country:us/state:nc/place:charlotte"]);
  const bonds = city.measures.filter(row => row.contestId.startsWith("nc-local-measure-2026-"));
  assert.equal(bonds.length, 3);
  for (const measure of bonds) {
    assert.match(measure.questionText, /estimated cumulative cost/);
    assert.match(measure.questionText, /property tax liability increase/);
    assert.match(measure.questionText, /\$0\.00 per year\./);
  }
});

test("Montgomery's county-wide judicial and education races do not include Frederick's circuit candidate", async () => {
  const state = await stateBallot("md");
  const montgomery = ballotForDivisions(state, ["ocd-division/country:us/state:md", "ocd-division/country:us/state:md/county:montgomery"]);
  const court = montgomery.contests.find(row => row.title === "Judge of the Circuit Court — Circuit 6, Montgomery County")!;
  assert.equal(court.voteFor, 4);
  const candidates = montgomery.candidacies.filter(row => row.contestId === court.id);
  assert.equal(candidates.length, 4);
  assert.equal(candidates.some(row => row.familyName === "Minner"), false);
  assert.equal(montgomery.contests.filter(row => row.title.startsWith("Board of Education")).length, 4);
  assert.equal(montgomery.candidacies.some(row => row.familyName === "Killough"), false);
  const princeGeorges = ballotForDivisions(state, ["ocd-division/country:us/state:md", "ocd-division/country:us/state:md/county:prince_george_s"]);
  assert.ok(princeGeorges.candidacies.some(row => row.familyName === "Killough"));
});

test("Kanawha's first official sample ballot contains ten contests with both complete levy texts", async () => {
  const state = await stateBallot("wv");
  const ballot = ballotForDivisions(state, ["ocd-division/country:us/state:wv", "ocd-division/country:us/state:wv/county:kanawha",
    "ocd-division/country:us/state:wv/cd:1", "ocd-division/country:us/state:wv/sldu:17", "ocd-division/country:us/state:wv/sldl:52"]);
  assert.equal(ballot.contests.length, 10);
  assert.equal(ballot.candidacies.length, 19);
  const levies = ballot.measures.filter(row => row.contestId.startsWith("wv-kanawha-2026-"));
  assert.equal(levies.length, 2);
  assert.ok(levies.some(row => row.questionText.includes("No excess levy funds shall be allocated to public charter schools.")));
  assert.ok(levies.some(row => row.questionText.includes("$3,183,675 annually")));
  for (const levy of levies) assert.match(levy.questionText, /Against the Levies/);
});

test("the current DC registered write-in list includes Nadeem A. Khan with the same candidate fields", async () => {
  const state = await stateBallot("dc");
  const candidate = state.candidacies.find(row => row.familyName === "Nadeem A. Khan")!;
  assert.ok(candidate);
  assert.equal(candidate.slogan, "Declared write-in");
  assert.equal(candidate.partyLabel, "Independent");
  assert.equal(candidate.incumbent, null);
  assert.equal(candidate.websiteUrl, null);
  assert.match(candidate.provenance.sourceUrl!, /WRITE-IN-CANDIDATES/);
  const green = state.candidacies.find(row => row.givenName === "Rebekkah" && row.familyName === "Green")!;
  assert.equal(green.partyLabel, "Libertarian", "the current official write-in list replaces the prior Independent label");
});
