import assert from "node:assert/strict";
import test from "node:test";
import type { BallotSet } from "../lib/ballot/types.ts";
import { ballotElectionKey } from "../lib/ballot/generic-projection.ts";
import type { BallotElectionSummary, CandidateResult } from "../lib/ballot/election-results.ts";
import { selectedBallotStatement } from "../lib/reader/selected-ballot.ts";
import { selectedStateEntry } from "../lib/reader/selected-entry.ts";
import { publicationVersion, readCanonicalShelf } from "../lib/reader/canonical.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { readResultProjection, refreshedResultFacts, preparedStateResultFeed } from "../lib/election-results/materialize.ts";
import type { ResultProgress } from "../lib/election-results/publisher.ts";
import { resultFeedMemory, resultBallotDb } from "./helpers/election-results.ts";
import { readStateElectionResults } from "../lib/reader/election-results.ts";

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

test("prepared Senate and House summaries retain their independent sources", async () => {
  const payload = { kind: "ballot-contests" as const, ballots: { [ballotElectionKey(ballot)]: ballot } };
  const senate = { ...summary, state: "US", chambers: [{ ...summary.chambers[0], name: "us_senate" }],
    source: { name: "Ballotpedia", url: "https://example.org/senate" } };
  const house = { ...summary, state: "US", chambers: [{ ...summary.chambers[0], name: "us_house" }],
    source: { name: "Ballotpedia", url: "https://example.org/house" } };
  const feed = preparedStateResultFeed({ key: "synthetic", versionId: "source-v1", hash: null, facts: {}, payload }, {
    [`${NATIONAL}#election_summary:us_senate`]: senate, [`${NATIONAL}#election_summary:us_house`]: house,
  }, "MA", AT);
  const store = resultFeedMemory();
  await store.writeState("MA", feed);
  const selected = await readStateElectionResults("MA", ["governor"], store);
  assert.deepEqual(selected?.facts[`${NATIONAL}#election_summary:us_senate`], senate);
  assert.deepEqual(selected?.facts[`${NATIONAL}#election_summary:us_house`], house);
});

test("prepared result selection includes contest and candidate aliases without carrying another state's facts", async () => {
  const set: BallotSet = { ...ballot, contests: [{ ...ballot.contests[0], aliases: ["older-governor"] }],
    candidacies: [{ ...ballot.candidacies[0], aliases: ["older-ticket"] }], measures: [] };
  const projection = { key: "synthetic", versionId: "source-v1", hash: null, facts: {},
    payload: { kind: "ballot-contests" as const, ballots: { [ballotElectionKey(set)]: set } } };
  const feed = preparedStateResultFeed(projection, { "older-governor": race, "older-ticket": choice,
    "ocd-division/country:us/state:ca": { unrelated: true } }, "MA", AT);
  const store = resultFeedMemory();
  await store.writeState("MA", feed);
  const selected = await readStateElectionResults("MA", ["older-governor"], store);
  assert.deepEqual(selected?.facts.governor, race);
  assert.deepEqual(selected?.facts.ticket, choice);
  assert.deepEqual(selected?.facts["older-ticket"], choice);
  assert.ok(selected?.contestIds?.["older-governor"].includes("older-ticket"));
  assert.equal(selected?.facts["ocd-division/country:us/state:ca"], undefined);
});

test("initial ZIP and full-state ballots remain unchanged while a prepared result feed carries checked facts", async context => {
  const db = await resultBallotDb(context);
  const { pg, publish, query } = db;
  const pointer = { recordClass: "BALLOT_CANDIDACY" as const, scope: stateBallotScope("ballot-contests", "MA") };
  const key = `${pointer.recordClass}:${pointer.scope}`;
  const value = { kind: "ballot-contests" as const, ballots: { [ballotElectionKey(ballot)]: ballot } };
  const emptyProgress: ResultProgress = { races: {}, summaries: {} };
  const feeds = resultFeedMemory();
  const prepare = async (progress = emptyProgress) => {
    const held = await readResultProjection(query, "MA");
    assert.ok(held);
    const facts = refreshedResultFacts(held.facts, progress);
    const feed = preparedStateResultFeed(held, facts, "MA", AT);
    await feeds.writeState("MA", feed);
    return feed;
  };
  const resultFeed = async (ballot: BallotSet) => {
    const feed = await readStateElectionResults("MA", ballot.contests.map(row => row.id), feeds);
    assert.ok(feed);
    return feed;
  };
  let reads = 0;
  const readerSql = (text: string) => assert.doesNotMatch(text, /\b(?:checked_fact|fact|fact_confirmation|pass_cursor)\b/i,
    "ballot requests must not join, scan or overlay result facts or clocks");
  const read = async (statements: readonly { text: string; params: readonly unknown[] }[]) => {
    reads++;
    assert.equal(statements.length, 1);
    readerSql(statements[0].text);
    return [await query(statements[0].text, statements[0].params)];
  };
  const selected = async () => {
    const statement = selectedBallotStatement("MA", [STATE]);
    readerSql(statement.text);
    const rows = await query(statement.text, statement.params);
    const entry = selectedStateEntry(pointer.recordClass, pointer.scope, rows[0]);
    assert.equal(entry.kind, "PROMOTED");
    if (entry.kind !== "PROMOTED") throw new Error("Missing selected ballot");
    return (entry.projection.payload as typeof value).ballots[ballotElectionKey(ballot)];
  };
  const full = async () => {
    const before = reads;
    const held = await readCanonicalShelf([pointer], read);
    assert.equal(reads, before + 1, "the initial full-state ballot uses its original single canonical request");
    const entry = await held.readPromotedEntry!(pointer.recordClass, pointer.scope);
    assert.equal(entry.kind, "PROMOTED");
    if (entry.kind !== "PROMOTED") throw new Error("Missing full-state ballot");
    return (entry.projection.payload as typeof value).ballots[ballotElectionKey(ballot)];
  };
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
  assert.equal((await selected()).contests[0].result, undefined, "publishing a fact does not add request-time work");
  const initial = await selected(), initialVersion = await publicationVersion([key], read);
  const prepared = await prepare();
  assert.equal(prepared.ballotVersion, "ballot-with-results");
  assert.equal(await publicationVersion([key], read), initialVersion, "preparing results never updates promotions or their reader version");
  assert.deepEqual(await selected(), initial, "the complete initial ZIP ballot payload remains unchanged");
  assert.equal(Object.hasOwn(prepared, "ballots"), false, "a published result feed holds no ballot copy");
  assert.equal(JSON.stringify(prepared).includes("Synthetic question text."), false, "source wording stays out of the result feed");
  const initialSelected = await selected(), selectedFeed = await resultFeed(initialSelected);
  assert.deepEqual(initialSelected.contests.map(row => row.id), ["governor", "measure-contest"]);
  assert.deepEqual(selectedFeed.facts.governor, race);
  assert.deepEqual(selectedFeed.facts.ticket, choice);
  const nominee = "governor|Blair Baker / Casey Clark";
  assert.equal((selectedFeed.facts[nominee] as CandidateResult).votes, 100000,
    "the feed uses a current nominee's actual served card identity");
  assert.ok(selectedFeed.contestIds?.governor.includes(nominee));
  assert.equal(initialSelected.candidacies[0].id, "ticket");
  assert.deepEqual(selectedFeed.facts["governor|Avery Adams / Taylor Jones"], choice);
  assert.deepEqual(selectedFeed.facts["question-1"], measure);
  assert.deepEqual(selectedFeed.facts[STATE], summary);
  assert.deepEqual(selectedFeed.facts[NATIONAL], nation);
  assert.equal(JSON.stringify(selectedFeed.facts).includes("999"), false, "unrelated results never enter the selected feed");
  const stateFeed = await resultFeed(await full());
  assert.deepEqual(stateFeed.facts.ticket, choice);
  assert.deepEqual(stateFeed.facts[STATE], summary);
  assert.deepEqual(stateFeed.facts[NATIONAL], nation);
  assert.equal(stateFeed.facts.local, undefined, "an unsupported local race remains open");
  const before = await publicationVersion([key], read);
  await pg.query("UPDATE fact SET value=$1 WHERE entity_id='candidacy:ma:ticket' AND status='live'", [JSON.stringify({ ...choice, votes: 123457 })]);
  assert.equal(await publicationVersion([key], read), before, "fact updates alone add no reader invalidation or overlay work");
  assert.equal(((await resultFeed(await selected())).facts.ticket as CandidateResult).votes, 123456);
  await prepare();
  assert.equal(await publicationVersion([key], read), before, "the feed job leaves the initial ballot publication version unchanged");
  assert.equal(((await resultFeed(await selected())).facts.ticket as CandidateResult).votes, 123457);
  assert.equal(((await resultFeed(await full())).facts.ticket as CandidateResult).votes, 123457);
  assert.equal((await selected()).candidacies[0].result, undefined);

  const lastSuccess = "2026-11-06T18:00:00.000Z";
  await pg.query("UPDATE fact SET value=value||$1::jsonb WHERE entity_id='candidacy:ma:ticket' AND status='live'",
    [JSON.stringify({ sourceId: "multistate", sourceRaceId: "governor-10", electionDate: "2026-11-03" })]);
  await pg.query("UPDATE fact SET value=value||$1::jsonb WHERE entity_id=$2 AND field='election_summary' AND status='live'",
    [JSON.stringify({ sourceClockKey: "multistate" }), STATE]);
  const clockVersion = await publicationVersion([key], read);
  const raceClock = { fingerprint: "synthetic", status: "counting", statusChangedAt: AT, nextCheckAt: null, lastCheckedAt: lastSuccess };
  const clock = { races: { "multistate:2026-11-03:governor-10": raceClock,
    "ballotpedia:2026-11-03:governor-10": { ...raceClock, lastCheckedAt: "2026-11-06T23:00:00.000Z" } }, summaries: {},
    sourceChecks: { multistate: { checkedAt: lastSuccess, lastSucceededAt: lastSuccess } } };
  await pg.query("INSERT INTO pass_cursor(name,position) VALUES('election-results:MA',$1)", [JSON.stringify(clock)]);
  assert.equal(await publicationVersion([key], read), clockVersion, "result clocks are not read during a ballot request");
  await prepare(clock);
  const fresh = await resultFeed(await selected());
  assert.equal((fresh.facts.ticket as CandidateResult).checkedAt, lastSuccess, "the job uses the correct source and race clock");
  assert.equal((fresh.facts[STATE] as BallotElectionSummary).checkedAt, lastSuccess);
  const failedClock = { ...clock, sourceChecks: { multistate: { checkedAt: "2026-11-07T00:00:00.000Z", lastSucceededAt: lastSuccess, failed: true } } };
  await pg.query("UPDATE pass_cursor SET position=$1 WHERE name='election-results:MA'", [JSON.stringify(failedClock)]);
  const beforeFailed = await publicationVersion([key], read);
  const priorFeed = await readStateElectionResults("MA", undefined, feeds);
  assert.equal((await prepare(failedClock)).fingerprint, priorFeed?.fingerprint, "a failed check never changes prepared result values");
  assert.equal(await publicationVersion([key], read), beforeFailed);
  assert.equal(((await resultFeed(await full())).facts.ticket as CandidateResult).checkedAt, lastSuccess, "a failed check never advances Sources dates");
  assert.equal((await query("SELECT value->>'checkedAt' AS checked FROM fact WHERE entity_id='candidacy:ma:ticket' AND status='live'"))[0].checked, AT,
    "confirmation dates do not create new fact values or history");
  await publish({ ...pointer, id: "ballot-source-v2", sourceId: "synthetic-ballot", at: "2026-11-07T12:00:00.000Z",
    value: encoded.value, payloadHash: canonicalCivicDataHash(value) });
  assert.equal((await selected()).contests[0].result, undefined, "a new initial source ballot still carries no prepared results");
  assert.equal((await full()).candidacies[0].result, undefined);
  assert.equal((await prepare()).ballotVersion, "ballot-source-v2", "the independent result document names its current source authority version");
});
