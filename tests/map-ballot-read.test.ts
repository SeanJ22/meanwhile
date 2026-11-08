import assert from "node:assert/strict";
import test from "node:test";
import type { BallotSet } from "../lib/ballot/types.ts";
import { ballotElectionKey } from "../lib/ballot/generic-projection.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { mapBallotStatement } from "../lib/reader/map-ballot.ts";
import { mapResults } from "../lib/map/results-read.ts";
import { fillClass, flipCount } from "../lib/map/results.ts";
import { electionFeedFixture } from "./helpers/election-feed-fixture.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const AT = "2026-11-06T12:00:00.000Z";
const provenance = { sourceOrg: "Synthetic election authority", sourceUrl: "https://example.gov/ballot", collectedAt: AT, verifiedAt: AT };

function ballotFor(state: "MA" | "AZ"): BallotSet {
  const s = state.toLowerCase(), place = `ocd-division/country:us/state:${s}`;
  const election = { state, id: `${s}-2026-general`, date: "2026-11-03", name: "General election" };
  const contest = (id: string, ocdId: string, title: string, voteFor = 1) => ({ id: `${s}:${id}`, electionId: election.id, ocdId, divisionVintage: "2026",
    title, type: "CANDIDACY" as const, voteFor, termYears: 2, scopeNote: null, provenance });
  const person = (contestId: string, name: string, party: string) => ({ id: `${s}:${contestId}:${name}`, contestId: `${s}:${contestId}`, givenName: name,
    familyName: "Test", partyLabel: party, slogan: null, incumbent: false, websiteUrl: null, provenance });
  return { election, absences: [], measures: [],
    contests: [contest("cd1", `${place}/cd:1`, "U.S. Representative"), contest("sen", place, "U.S. Senator"), contest("gov", place, "Governor"),
      contest("lower", `${place}/sldl:2`, "State House", 2), contest("upper", `${place}/sldu:3`, "State Senate"), contest("town", `${place}/place:town`, "Town council")],
    candidacies: [person("cd1", "Ann", "Democrat"), person("cd1", "Bo", "Republican"), person("sen", "Cy", "Republican"), person("gov", "Di", "Democrat"),
      person("lower", "Ed", "Democrat"), person("upper", "Flo", "Republican"), person("town", "Gus", "Nonpartisan")] };
}

test("the map statement returns one state's drawn contests and their candidates, and joined with the state's feed they become colored districts", async context => {
  const copy = electionFeedFixture(context);
  const { pg, publish, query } = await migratedFactDb();
  try {
    for (const state of ["MA", "AZ"] as const) {
      const ballot = ballotFor(state);
      const value = { kind: "ballot-contests" as const, ballots: { [ballotElectionKey(ballot)]: ballot } };
      const encoded = partitionCivicPayload(value);
      for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
      await publish({ recordClass: "BALLOT_CANDIDACY", scope: stateBallotScope("ballot-contests", state), id: `ballot-${state.toLowerCase()}`, sourceId: `synthetic-${state.toLowerCase()}`, at: AT,
        value: encoded.value, payloadHash: canonicalCivicDataHash(value) });
    }
    const statement = mapBallotStatement("AZ");
    const rows = await query(statement.text, statement.params);
    assert.equal(rows.length, 1);
    const slim = JSON.stringify(rows[0].payload);
    for (const kept of [":cd1", ":sen", ":lower", ":upper", "Ann Test"]) assert.ok(slim.includes(kept) || kept.includes(" ") && slim.includes("Ann"), `${kept} is carried`);
    for (const left of [":gov", ":town", "Di Test", "Gus", "ma:"]) assert.equal(slim.includes(left), false, `${left} is left out`);
    assert.equal((await query(mapBallotStatement("TX").text, mapBallotStatement("TX").params)).length, 0, "a state with no ballot on file has no row");

    // The results job's feed for the state: keyed by contest and candidate id.
    const result = (status: string, extra: object = {}) => ({ status, seatsToFill: 1, sources: [{ name: "Synthetic results" }], checkedAt: AT, ...extra });
    await copy.store.writeState("AZ", { formatVersion: 1, state: "AZ", ballotVersion: null, checkedAt: AT, fingerprint: "synthetic", facts: {
      "az:cd1": result("called", { flipped: true, gainedByParty: "Democrat", seatsFlipped: 1 }), "az:cd1:Ann": { votes: 531, won: true }, "az:cd1:Bo": { votes: 469, won: false },
      "az:sen": result("called"), "az:sen:Cy": { votes: 9, won: true }, "az:gov": result("called"), "az:lower": result("counting", { seatsToFill: 2 }),
      "az:town:Gus": { votes: 999, won: true } } });
    const districts = await mapResults({ scope: "state", state: "AZ" }, { store: copy.store, query: async statements => [await query(statements[0].text, statements[0].params)] });
    const cd = districts["ocd-division/country:us/state:az/cd:1"];
    assert.equal(fillClass(cd), "D");
    assert.equal(flipCount(cd), 1);
    assert.equal(cd.candidates.find(row => row.name === "Ann Test")?.votes, 531);
    assert.ok(districts["ocd-division/country:us/state:az"], "the U.S. Senate seat is carried");
    assert.equal(fillClass(districts["ocd-division/country:us/state:az/sldl:2"]), "counting");
    assert.equal(districts["ocd-division/country:us/state:az/sldu:3"], undefined, "a contest the feed has nothing for is absent: no results yet");
  } finally { await pg.close(); }
});

test("a state with thousands of local races still sends back only the handful the map draws", async () => {
  const { pg, publish, query } = await migratedFactDb();
  try {
    const ballot = ballotFor("MA");
    const local = Array.from({ length: 1500 }, (_, index) => ({ ...ballot.contests[5], id: `ma:town-${index}`, ocdId: `ocd-division/country:us/state:ma/place:town-${index}`, title: `Town council ${index}` }));
    const people = local.flatMap(row => ["A", "B", "C"].map(name => ({ ...ballot.candidacies[6], id: `${row.id}:${name}`, contestId: row.id, givenName: name })));
    const big = { ...ballot, contests: [...ballot.contests, ...local], candidacies: [...ballot.candidacies, ...people] };
    const value = { kind: "ballot-contests" as const, ballots: { [ballotElectionKey(big)]: big } };
    const encoded = partitionCivicPayload(value);
    for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
    await publish({ recordClass: "BALLOT_CANDIDACY", scope: stateBallotScope("ballot-contests", "MA"), id: "ballot-ma", sourceId: "synthetic-ma", at: AT,
      value: encoded.value, payloadHash: canonicalCivicDataHash(value) });
    const statement = mapBallotStatement("MA");
    const [row] = await query(statement.text, statement.params);
    const sent = JSON.stringify(row).length, whole = JSON.stringify(big).length;
    assert.ok(whole > 1_000_000, `the whole ballot is large (${whole} bytes)`);
    assert.ok(sent < whole / 50, `the map's answer is a small slice of it (${sent} of ${whole} bytes)`);
  } finally { await pg.close(); }
});
