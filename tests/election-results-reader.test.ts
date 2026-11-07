import assert from "node:assert/strict";
import test from "node:test";
import type { BallotSet } from "../lib/ballot/types.ts";
import { ballotElectionKey } from "../lib/ballot/generic-projection.ts";
import { withBallotResultFacts } from "../lib/ballot/election-results.ts";
import { selectedBallotStatement } from "../lib/reader/selected-ballot.ts";
import { selectedStateEntry } from "../lib/reader/selected-entry.ts";
import { publicationVersion, readCanonicalShelf } from "../lib/reader/canonical.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const AT = "2026-11-06T12:00:00.000Z";
const STATE = "ocd-division/country:us/state:ma";
const NATIONAL = "ocd-division/country:us";
const source = { sourceOrg: "Synthetic election authority", sourceUrl: "https://example.gov/ballot", collectedAt: AT, verifiedAt: AT };
const election = { state: "MA", id: "ma-2026-general", date: "2026-11-03", name: "General election" };
const contest = (id: string, ocdId: string, title = "Governor / Lieutenant Governor") => ({ id, electionId: election.id,
  ocdId, divisionVintage: "2026", title, type: "CANDIDACY" as const, voteFor: 1, termYears: 4, scopeNote: null, provenance: source });
const candidate = (id: string, contestId: string) => ({ id, contestId, givenName: "Avery", familyName: "Adams",
  partyLabel: "Example", slogan: null, incumbent: false, websiteUrl: null, provenance: source });
const ballot: BallotSet = { election, contests: [contest("governor", STATE),
  { ...contest("measure-contest", STATE, "Question 1"), type: "MEASURE" },
  contest("local", `${STATE}/place:example`, "Town council"),
  contest("other-district", `${STATE}/sldl:other`, "Representative")],
  candidacies: [candidate("ticket", "governor"), candidate("local-person", "local"), candidate("other-person", "other-district")],
  measures: [{ id: "question-1", contestId: "measure-contest", officialNumber: "Question 1",
    questionText: "Synthetic question text. ".repeat(1500), officialStatement: null, provenance: source }], absences: [],
  generalLineup: { curatedAt: AT, canvass: { title: "Synthetic nominees", url: source.sourceUrl,
    issuedBy: source.sourceOrg, reportDate: "2026-11-03", readAt: AT, readNote: "Synthetic test" }, note: "Synthetic current slate",
    contests: [{ contestId: "governor", nominees: [{ name: "Avery Adams / Taylor Jones", partyLabel: "Example", note: null },
      { name: "Blair Baker / Casey Clark", partyLabel: "Other", note: null }] }] } };
const attribution = { sources: [{ name: "Synthetic results source", url: "https://example.org/results" }], checkedAt: AT };
const race = { status: "called", percentCounted: 99.8, statusChangedAt: AT, seatsToFill: 1,
  flipped: true, gainedByParty: "Example", incumbentLost: true, ...attribution };
const choice = { votes: 123456, percent: 55.12, won: true, runoff: false, ...attribution };
const measure = { yesVotes: 120, noVotes: 80, yesPercent: 60, outcome: "passed", ...attribution };
const summary = { state: "MA", chambers: [{ name: "House", seatsBefore: { Example: 100 }, seatsNow: { Example: 101 },
  stillCounting: 2, controlBefore: "Example", controlNow: "Example" }], governor: { before: "Other", now: "Example" },
  statewideOfficesFlipped: [{ office: "Governor", from: "Other", to: "Example" }], source: attribution.sources[0], creditedSources: [], checkedAt: AT };

test("result overlay preserves missing local results and Governor ticket choice identity", () => {
  const value = { kind: "ballot-contests" as const, ballots: { [ballotElectionKey(ballot)]: ballot } };
  const changed = withBallotResultFacts(value, { governor: race, ticket: choice, "question-1": measure, [STATE]: summary });
  const set = changed.ballots[ballotElectionKey(ballot)];
  assert.deepEqual(set.contests[0].result, race);
  assert.deepEqual(set.candidacies[0].result, choice);
  assert.deepEqual(set.measures[0].result, measure);
  assert.equal(set.contests.find(row => row.id === "local")?.result, undefined, "an unsupported local race remains open");
  assert.equal(set.candidacies[0].id, "ticket");
  assert.equal(set.candidacies[0].ticket?.runningMate.familyName, "Taylor Jones");
  assert.deepEqual(set.results?.state, summary);
  assert.equal(ballot.candidacies[0].result, undefined, "the promoted source holding is immutable");
});

test("national Senate and House summaries retain their independent sources", () => {
  const value = { ballots: { [ballotElectionKey(ballot)]: ballot } };
  const senate = { ...summary, state: "US", chambers: [{ ...summary.chambers[0], name: "us_senate" }],
    source: { name: "Ballotpedia", url: "https://example.org/senate" } };
  const house = { ...summary, state: "US", chambers: [{ ...summary.chambers[0], name: "us_house" }],
    source: { name: "Ballotpedia", url: "https://example.org/house" } };
  const changed = withBallotResultFacts(value, {
    [`${NATIONAL}#election_summary:us_senate`]: senate, [`${NATIONAL}#election_summary:us_house`]: house,
  });
  const nation = changed.ballots[ballotElectionKey(ballot)].results!.nation!;
  assert.deepEqual(nation.chambers.map(chamber => [chamber.name, chamber.source?.url]),
    [["us_senate", "https://example.org/senate"], ["us_house", "https://example.org/house"]]);
  assert.equal(nation.sources?.length, 2);
});

test("ZIP and full-state ballots carry Slide facts and summaries in their existing read, including canonical aliases", async () => {
  const { pg, publish, query } = await migratedFactDb();
  const pointer = { recordClass: "BALLOT_CANDIDACY" as const, scope: stateBallotScope("ballot-contests", "MA") };
  const key = `${pointer.recordClass}:${pointer.scope}`;
  const value = { kind: "ballot-contests" as const, ballots: { [ballotElectionKey(ballot)]: ballot } };
  try {
    const encoded = partitionCivicPayload(value);
    assert.ok(encoded.parts.length, "the test reads production's partitioned payload shape");
    for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
    await publish({ ...pointer, id: "ballot-with-results", sourceId: "synthetic-ballot", at: AT,
      value: encoded.value, payloadHash: canonicalCivicDataHash(value) });
    for (const [id, kind, name] of [[STATE, "place", "Massachusetts"], [NATIONAL, "place", "United States"],
      ["contest:ma:governor", "contest", "Governor"], ["candidacy:ma:ticket", "candidacy", "Avery Adams"],
      ["governor|Blair Baker / Casey Clark", "candidacy", "Blair Baker / Casey Clark"],
      ["measure:ma:1", "measure", "Question 1"], ["contest:ma:unrelated", "contest", "Unrelated race"]])
      await pg.query("INSERT INTO entity(id,kind,name,state) VALUES($1,$2,$3,$4)", [id, kind, name, id === NATIONAL ? null : "MA"]);
    for (const [id, alias] of [["contest:ma:governor", "governor"], ["candidacy:ma:ticket", "ticket"], ["measure:ma:1", "question-1"]])
      await pg.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'body-alias',$2)", [id, alias]);
    const nation = { ...summary, state: "US", chambers: [{ ...summary.chambers[0], name: "U.S. House" }] };
    for (const [id, field, result] of [["contest:ma:governor", "election_result", race], ["candidacy:ma:ticket", "election_result", choice],
      ["measure:ma:1", "election_result", measure], [STATE, "election_summary", summary], [NATIONAL, "election_summary", nation],
      ["governor|Blair Baker / Casey Clark", "election_result", { ...choice, votes: 100000, won: false }],
      ["contest:ma:unrelated", "election_result", { status: "called", votes: 999 }]])
      await pg.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,quote,checked_at,produced_by)
        VALUES($1,$2,$3::jsonb,$3::text,'live','OWNER',$3::text,$4,'synthetic-result-test')`, [id, field, JSON.stringify(result), AT]);
    const statement = selectedBallotStatement("MA", [STATE]);
    const rows = await query(statement.text, statement.params);
    const selected = selectedStateEntry(pointer.recordClass, pointer.scope, rows[0]);
    assert.equal(selected.kind, "PROMOTED");
    if (selected.kind !== "PROMOTED") throw new Error("Missing selected ballot");
    const selectedValue = selected.projection.payload as typeof value;
    const set = selectedValue.ballots[ballotElectionKey(ballot)];
    assert.deepEqual(set.contests.map(row => row.id), ["governor", "measure-contest"]);
    assert.deepEqual(set.contests[0].result, race);
    assert.deepEqual(set.candidacies[0].result, choice);
    assert.equal(set.candidacies.find(row => row.id === "governor|Blair Baker / Casey Clark")?.result?.votes, 100000,
      "a nominee created from the current slate receives the result under its actual served card id");
    assert.deepEqual(set.measures[0].result, measure);
    assert.deepEqual(set.results, { state: summary, nation });
    assert.equal(JSON.stringify(selectedValue).includes("999"), false, "another district's results never join the selected ballot");
    let reads = 0;
    const read = async (statements: readonly { text: string; params: readonly unknown[] }[]) => {
      reads++;
      assert.equal(statements.length, 1);
      return [await query(statements[0].text, statements[0].params)];
    };
    const full = await readCanonicalShelf([pointer], read);
    assert.equal(reads, 1, "full-state ballots obtain results in the original canonical request");
    const held = await full.readPromotedEntry!(pointer.recordClass, pointer.scope);
    assert.equal(held.kind, "PROMOTED");
    if (held.kind === "PROMOTED") {
      const fullSet = (held.projection.payload as typeof value).ballots[ballotElectionKey(ballot)];
      assert.deepEqual(fullSet.candidacies[0].result, choice);
      assert.deepEqual(fullSet.results, { state: summary, nation });
      assert.equal(fullSet.contests.find(row => row.id === "local")?.result, undefined);
    }
    const before = await publicationVersion([key], read);
    await pg.query("UPDATE fact SET value=$1 WHERE entity_id='candidacy:ma:ticket' AND status='live'", [JSON.stringify({ ...choice, votes: 123457 })]);
    const after = await publicationVersion([key], read);
    assert.notEqual(after, before, "a new result invalidates shared reads while the original ballot pointer stays unchanged");
    const changed = await readCanonicalShelf([pointer], read);
    const changedEntry = await changed.readPromotedEntry!(pointer.recordClass, pointer.scope);
    if (changedEntry.kind === "PROMOTED") assert.equal((changedEntry.projection.payload as typeof value).ballots[ballotElectionKey(ballot)].candidacies[0].result?.votes, 123457);

    const lastSuccess = "2026-11-06T18:00:00.000Z";
    await pg.query("UPDATE fact SET value=value||$1::jsonb WHERE entity_id='candidacy:ma:ticket' AND status='live'",
      [JSON.stringify({ sourceId: "multistate", sourceRaceId: "governor-10", electionDate: "2026-11-03" })]);
    await pg.query("UPDATE fact SET value=value||$1::jsonb WHERE entity_id=$2 AND field='election_summary' AND status='live'",
      [JSON.stringify({ sourceClockKey: "multistate" }), STATE]);
    const clockVersion = await publicationVersion([key], read);
    const clock = { races: { "multistate:2026-11-03:governor-10": { lastCheckedAt: lastSuccess },
      "ballotpedia:2026-11-03:governor-10": { lastCheckedAt: "2026-11-06T23:00:00.000Z" } },
      sourceChecks: { multistate: { checkedAt: lastSuccess, lastSucceededAt: lastSuccess } } };
    await pg.query("INSERT INTO pass_cursor(name,position) VALUES('election-results:MA',$1)", [JSON.stringify(clock)]);
    assert.notEqual(await publicationVersion([key], read), clockVersion,
      "a successful unchanged check invalidates shared snapshots without modifying facts");
    const freshRows = await query(statement.text, statement.params);
    const fresh = selectedStateEntry(pointer.recordClass, pointer.scope, freshRows[0]);
    if (fresh.kind === "PROMOTED") {
      const freshSet = (fresh.projection.payload as typeof value).ballots[ballotElectionKey(ballot)];
      assert.equal(freshSet.candidacies[0].result?.checkedAt, lastSuccess, "the correct source and race clock supplies last checked");
      assert.equal(freshSet.results?.state?.checkedAt, lastSuccess);
    }
    await pg.query("UPDATE pass_cursor SET position=$1 WHERE name='election-results:MA'", [JSON.stringify({ ...clock,
      sourceChecks: { multistate: { checkedAt: "2026-11-07T00:00:00.000Z", lastSucceededAt: lastSuccess, failed: true } } })]);
    const beforeFailedRead = reads;
    const failed = await readCanonicalShelf([pointer], read);
    const failedEntry = await failed.readPromotedEntry!(pointer.recordClass, pointer.scope);
    assert.equal(reads, beforeFailedRead + 1, "freshness arrives in the existing canonical request");
    if (failedEntry.kind === "PROMOTED") {
      const failedSet = (failedEntry.projection.payload as typeof value).ballots[ballotElectionKey(ballot)];
      assert.equal(failedSet.candidacies[0].result?.checkedAt, lastSuccess, "a failed attempt never advances the race's check date");
      assert.equal(failedSet.results?.state?.checkedAt, lastSuccess, "a failed attempt never advances summary Sources dates");
    }
    assert.equal((await query("SELECT value->>'checkedAt' AS checked FROM fact WHERE entity_id='candidacy:ma:ticket' AND status='live'"))[0].checked, AT,
      "the freshness overlay does not rewrite unchanged fact values");
  } finally { await pg.close(); }
});
