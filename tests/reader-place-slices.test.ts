import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import type { GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { answerVotingSites, type VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import type { VotingJurisdiction, VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import { stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { selectedBallotStatement } from "../lib/reader/selected-ballot.ts";
import { selectedVotingStatement } from "../lib/reader/selected-voting.ts";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";

const at = "2026-10-19T00:00:00.000Z";

test("ZIP ballot SQL retains the existing ballot answer, including inherited districts and historical House-seat spelling", async () => {
  const { pg, publish } = await migratedReaderDb();
  try {
    for (const [state, divisions] of [
      ["AZ", ["ocd-division/country:us/state:az/county:pima", "ocd-division/country:us/state:az/cd:7"]],
      ["ND", ["ocd-division/country:us/state:nd/cd:0"]],
    ] as const) {
      const value = JSON.parse(readFileSync(new URL(`../data/ballot/2026-general/${state.toLowerCase()}.json`, import.meta.url), "utf8")) as GenericBallotProjection;
      await publish({ id: `ballot:${state}`, recordClass: "BALLOT_CANDIDACY", scope: stateBallotScope("ballot-contests", state), sourceId: "ballot", at, value });
      const statement = selectedBallotStatement(state, divisions);
      const { rows } = await pg.query<{ published: boolean; payload: GenericBallotProjection }>(statement.text, statement.params);
      assert.equal(rows[0].published, true);
      const expected = Object.fromEntries(Object.entries(value.ballots).flatMap(([key, ballot]) => {
        const selected = ballotForDivisions(ballot, divisions);
        return selected.contests.length || selected.heldContests?.length ? [[key, selected]] : [];
      }));
      const actual = Object.fromEntries(Object.entries(rows[0].payload.ballots).map(([key, ballot]) => [key, ballotForDivisions(ballot, divisions)]));
      assert.deepEqual(actual, expected, state);
      assert.ok(JSON.stringify(rows[0].payload).length < JSON.stringify(value).length, "foreign districts are omitted before transfer");
    }
  } finally { await pg.close(); }
});

test("county-selected voting holdings preserve every location, rule, lookup and source in the exact reader answer", async () => {
  const { pg, publish } = await migratedReaderDb();
  const source = { publisher: "County elections", url: "https://elections.example.test/locations", checkedAt: at };
  const base: VotingJurisdiction = { ocdId: "ocd-division/country:us/state:fl/county:okaloosa", name: "Okaloosa County", state: "FL", countyFips: "12091", model: "ASSIGNED", election: null,
    sites: [{ id: "site", name: "County voting location", address: "5503 HWY 4 Baker, FL 32531", kind: "ELECTION_DAY", room: null, lat: 30.803, lng: -86.68, election: null,
      serves: "Precinct 01", precinct: "01", countyFips: "12091", sources: [source] }], sourceOrg: source.publisher, sourceUrl: source.url, collectedAt: at, refusal: null };
  const value: VotingSitesFile = { generatedAt: at, jurisdictions: [base,
    { ...base, ocdId: "ocd-division/country:us/state:fl/county:other", name: "FOREIGN_COUNTY".repeat(10000), countyFips: "12001" },
    { ...base, ocdId: "ocd-division/country:us/state:fl", name: "Florida rules", countyFips: undefined, sites: [], rules: [{ text: "Use the official county lookup", source }] },
    { ...base, ocdId: `${base.ocdId}/cousub:baker`, countyFips: "12001", countySubdivisionGeoid: "1209100001" },
  ] };
  const place: VotingReaderPlace = { precision: "ZIP", point: null, divisionIds: [base.ocdId], states: ["FL"], countyFips: ["12091"], countySubdivisionGeoids: [], towns: [], wards: [], aiannhGeoids: [], precincts: [] };
  try {
    await publish({ id: "voting:FL", recordClass: "VOTING_SITE", scope: stateBallotScope("voting-sites", "FL"), sourceId: "voting", at, value });
    const statement = selectedVotingStatement("FL", place);
    const { rows } = await pg.query<{ published: boolean; payload: VotingSitesFile }>(statement.text, statement.params);
    assert.equal(rows[0].published, true);
    assert.deepEqual(await answerVotingSites(rows[0].payload, place), await answerVotingSites(JSON.parse(JSON.stringify(value)), place));
    assert.ok(!JSON.stringify(rows).includes("FOREIGN_COUNTY"), "the unrelated county's stored records never reach the server");
  } finally { await pg.close(); }
});
