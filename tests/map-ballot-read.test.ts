import assert from "node:assert/strict";
import test from "node:test";
import type { BallotSet } from "../lib/ballot/types.ts";
import { ballotElectionKey } from "../lib/ballot/generic-projection.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { mapBallotStatement } from "../lib/reader/map-ballot.ts";
import { readResultContests } from "../lib/map/results-read.ts";
import { fillClass, flipParty, resultsByDistrict } from "../lib/map/results.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const AT = "2026-11-06T12:00:00.000Z";
const provenance = { sourceOrg: "Synthetic election authority", sourceUrl: "https://example.gov/ballot", collectedAt: AT, verifiedAt: AT };
const attribution = { sources: [{ name: "Synthetic results" }], checkedAt: AT };

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

test("the map statement returns only the drawn contests and their candidates, with results, for every state in one request", async () => {
  const { pg, publish, query } = await migratedFactDb();
  try {
    for (const state of ["MA", "AZ"] as const) {
      const ballot = ballotFor(state), s = state.toLowerCase();
      const value = { kind: "ballot-contests" as const, ballots: { [ballotElectionKey(ballot)]: ballot } };
      const encoded = partitionCivicPayload(value);
      for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
      await publish({ recordClass: "BALLOT_CANDIDACY", scope: stateBallotScope("ballot-contests", state), id: `ballot-${s}`, sourceId: `synthetic-${s}`, at: AT,
        value: encoded.value, payloadHash: canonicalCivicDataHash(value) });
      for (const row of [...ballot.contests, ...ballot.candidacies]) await pg.query("INSERT INTO entity(id,kind,name,state) VALUES($1,$2,$3,$4)", [row.id, "contest", row.id, state]);
      const result = (id: string, value: unknown) => pg.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,quote,checked_at,produced_by)
        VALUES($1,'election_result',$2::jsonb,$2::text,'live','OWNER',$2::text,$3,'synthetic-result-test')`, [id, JSON.stringify(value), AT]);
      await result(`${s}:cd1`, { status: "called", seatsToFill: 1, flipped: state === "AZ", gainedByParty: state === "AZ" ? "Democrat" : null, ...attribution });
      await result(`${s}:cd1:Ann`, { votes: 531, won: true, ...attribution });
      await result(`${s}:cd1:Bo`, { votes: 469, won: false, ...attribution });
      await result(`${s}:sen`, { status: "called", seatsToFill: 1, ...attribution });
      await result(`${s}:sen:Cy`, { votes: 9, won: true, ...attribution });
      await result(`${s}:gov`, { status: "called", seatsToFill: 1, ...attribution });
      await result(`${s}:lower`, { status: "counting", seatsToFill: 2, ...attribution });
      await result(`${s}:town:Gus`, { votes: 999, won: true, ...attribution });
    }
    const run = async (states: string[], kinds: "state" | "nation") => {
      const statement = mapBallotStatement(states, kinds);
      return await query(statement.text, statement.params);
    };

    const nation = await run(["MA", "AZ", "TX"], "nation");
    assert.equal(nation.length, 2, "a state with no ballot on file has no row");
    const slim = JSON.stringify(nation.map(row => row.payload));
    assert.ok(slim.includes("cd1") && slim.includes(":sen"), "House and Senate contests are carried");
    for (const left of [":gov", ":lower", ":upper", ":town", "Di Test", "Ed Test", "Flo Test", "Gus"]) assert.equal(slim.includes(left), false, `${left} is not carried to the national view`);

    const one = await run(["AZ"], "state");
    assert.equal(one.length, 1);
    const stateSlim = JSON.stringify(one[0].payload);
    for (const kept of [":cd1", ":sen", ":lower", ":upper"]) assert.ok(stateSlim.includes(kept), `${kept} is carried to the state view`);
    for (const left of [":gov", ":town", "Gus", "ma:"]) assert.equal(stateSlim.includes(left), false, `${left} is left out of the state view`);

    // End to end through the same reader the route uses: the contests become districts with colors and flips.
    const read = async (statements: readonly { text: string; params: readonly unknown[] }[]) => [await query(statements[0].text, statements[0].params)];
    const contests = await readResultContests({ scope: "us-house" }, read);
    const districts = resultsByDistrict(contests);
    const az = districts["ocd-division/country:us/state:az/cd:1"], ma = districts["ocd-division/country:us/state:ma/cd:1"];
    assert.equal(fillClass(az), "D");
    assert.equal(flipParty(az), "D");
    assert.equal(flipParty(ma), null);
    assert.equal(az.candidates.find(row => row.name === "Ann Test")?.votes, 531);
    assert.ok(districts["ocd-division/country:us/state:ma"] && districts["ocd-division/country:us/state:az"], "each state's U.S. Senate seat is carried");
    assert.equal(Object.keys(districts).some(id => id.includes("sldl") || id.includes("sldu")), false);

    const lower = resultsByDistrict(await readResultContests({ scope: "state", state: "AZ" }, read))["ocd-division/country:us/state:az/sldl:2"];
    assert.equal(fillClass(lower), "counting");
    assert.equal(lower.seats.length, 2);
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
    const statement = mapBallotStatement(["MA"], "nation");
    const [row] = await query(statement.text, statement.params);
    const sent = JSON.stringify(row).length, whole = JSON.stringify(big).length;
    assert.ok(whole > 1_000_000, `the whole ballot is large (${whole} bytes)`);
    assert.ok(sent < whole / 50, `the map's answer is a small slice of it (${sent} of ${whole} bytes)`);
  } finally { await pg.close(); }
});
