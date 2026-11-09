import assert from "node:assert/strict";
import test from "node:test";
import type { BallotSet } from "../lib/ballot/types.ts";
import { houseDistrictResults } from "../lib/election-results/house-districts.ts";
import { nationalResultFeed } from "../lib/election-results/feed-store.ts";

const source = { sourceOrg: "Synthetic", sourceUrl: "https://example.gov/ballot", collectedAt: "2026-11-04T00:00:00Z", verifiedAt: "2026-11-04T00:00:00Z" };
const contest = (id: string, ocdId: string, title = "U.S. Representative") => ({ id, title, ocdId, electionId: "az-2026-general", type: "CANDIDACY" as const,
  divisionVintage: "2026", voteFor: 1, termYears: 2, scopeNote: null, provenance: source });
const person = (id: string, contestId: string, party: string) => ({ id, contestId, givenName: "", familyName: id, partyLabel: party, slogan: null,
  incumbent: false, websiteUrl: null, provenance: source });
const ballot = { election: { id: "az-2026-general", date: "2026-11-03", state: "AZ", name: "General" },
  contests: [contest("cd6", "ocd-division/country:us/state:az/cd:6"), contest("cd1", "ocd-division/country:us/state:az/cd:1"),
    contest("cd2", "ocd-division/country:us/state:az/cd:2"), contest("gov", "ocd-division/country:us/state:az", "Governor")],
  candidacies: [person("mendoza", "cd6", "Democratic"), person("ciscomani", "cd6", "Republican"), person("lead-r", "cd1", "Republican"), person("trail-d", "cd1", "Democratic"),
    person("held-d", "cd2", "Democratic")], measures: [], absences: [] } as unknown as BallotSet;

test("the national feed carries one small result per U.S. House district, only where every vote-getter matched", () => {
  const facts = {
    cd6: { status: "called", flipped: true, allCandidatesMatched: true }, mendoza: { votes: 163197, won: true }, ciscomani: { votes: 138235, won: false },
    cd1: { status: "counting", flipped: null, allCandidatesMatched: true }, "lead-r": { votes: 60, won: false }, "trail-d": { votes: 40, won: false },
    cd2: { status: "called", flipped: false }, "held-d": { votes: 9, won: true },
    gov: { status: "called", allCandidatesMatched: true },
  };
  const districts = houseDistrictResults([ballot], facts);
  assert.deepEqual(districts, {
    "ocd-division/country:us/state:az/cd:6": { status: "called", party: "D", flipped: true },
    "ocd-division/country:us/state:az/cd:1": { status: "counting", party: "R", flipped: null },
  }, "the called winner's party, the counting leader's party, no partial contest and no statewide office");
  const feed = nationalResultFeed({ checkedAt: "2026-11-04T00:00:00Z", states: {}, sources: [], houseDistricts: districts });
  assert.deepEqual(feed.houseDistricts, districts, "the feed document keeps the field");
});
