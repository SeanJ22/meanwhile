import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHash } from "node:crypto";
import type { BallotSet, Candidacy, Contest } from "../lib/ballot/types.ts";
import { parseMultiStateResults } from "../lib/election-results/multistate.ts";
import { ensureOpenElectionResults, publishElectionResultBatch } from "../lib/election-results/publisher.ts";
import { runElectionResults } from "../lib/election-results/runner.ts";
import type { ElectionResultBatch } from "../lib/election-results/types.ts";
import { summarizeCongressResults } from "../lib/election-results/summary.ts";
import { resultFactDb, resultFeedMemory } from "./helpers/election-results.ts";
import { workList } from "../lib/core/work.ts";
import { parseBallotpediaResults } from "../lib/election-results/ballotpedia.ts";

const AT = "2026-11-06T12:00:00.000Z";
const STATE = "ocd-division/country:us/state:ma";
const source = { sourceOrg: "Synthetic ballot authority", sourceUrl: "https://example.gov/ballot", collectedAt: AT, verifiedAt: AT };
const election = { id: "ma-2026-general", date: "2026-11-03", state: "MA", name: "General election" };
const contest = (id: string, title: string, ocdId = STATE): Contest => ({ id, title, ocdId, electionId: election.id,
  type: "CANDIDACY", divisionVintage: "2026", voteFor: 1, termYears: 4, scopeNote: null, provenance: source });
const candidate = (id: string, contestId: string, name: string): Candidacy => ({ id, contestId, givenName: "", familyName: name,
  partyLabel: "D", slogan: null, incumbent: false, websiteUrl: null, provenance: source });
const ballot: BallotSet = { election, contests: [contest("governor", "Governor / Lieutenant Governor"),
  contest("house-a", "State Representative, First Suffolk", `${STATE}/sldl:first_suffolk`),
  contest("house-b", "State Representative, Second Suffolk", `${STATE}/sldl:second_suffolk`),
  { ...contest("measure", "Question 1"), type: "MEASURE" }, contest("local", "City council", `${STATE}/place:example`)],
  candidacies: [candidate("adams", "governor", "Avery Adams"), candidate("baker", "governor", "Blair Baker"),
    candidate("house-a-smith", "house-a", "Sam Smith"), candidate("house-b-smith", "house-b", "Sam Smith"),
    candidate("local-person", "local", "Taylor Town")],
  measures: [{ id: "question-1", contestId: "measure", officialNumber: "Question 1", questionText: "Synthetic measure text", officialStatement: null, provenance: source }], absences: [] };
const purge = async () => ({ purged: true });

function raw(votes = 100) {
  return JSON.stringify({ general_events: [{ state: "MA", statewide_races: [{ seat_id: 10, office: "Governor", election_date: election.date,
    general_results: { contests: [{ type: "General", election_id: 110, result_status: "Counting", votes_pct_in: 90, vote_source: "sos",
      candidates: [{ candidate_id: 1, name: "Avery Adams", party: "D", votes, pct: 50, result: null },
        { candidate_id: 2, name: "Blair Baker", party: "R", votes: 99, pct: 49.5, result: null },
        { candidate_id: 3, name: "Carmen Carroll", party: "I", votes: 1, pct: 0.5, result: null }] }] } },
    { seat_id: 11, office: "Attorney General", election_date: election.date, general_results: { contests: [{ type: "General", election_id: 111,
      result_status: "Called", vote_source: "sos", candidates: [{ candidate_id: 4, name: "Alex Attorney", party: "D", votes: 200, pct: 100, result: "Won" }] }] } }],
    races: [{ seat_id: 12, office: "State House", election_date: election.date, general_results: { contests: [{ type: "General", election_id: 112,
      result_status: "Called", candidates: [{ candidate_id: 5, name: "Sam Smith", party: "D", votes: 200, pct: 100, result: "Won" }] }] } }],
    ballot_measures: [{ id: 20, measure_number: "Question 1", short_title: "Synthetic measure", election_date: election.date,
      result: "Passed", result_status: "Called", votes_yes: 120, votes_no: 80, yes_percentage: 60, vote_source: "sos" }] }],
    scorecard: { states: [{ st: "MA", chambers: [{ name: "House", before: { composition: { D: 100, R: 60 }, control: "D" },
      after: { composition: { D: 101, R: 58 }, control: "D" }, counting: 1 }], statewide: [{ office: "Governor", prev: "D", win: "D", cls: "hold" }] }] } });
}

const fixture = (context: TestContext) => resultFactDb(context, "test-slide", { MA: "Massachusetts" });

test("source results pass the Slide, publish matching fields, preserve history, and leave every identity gap on the work list", async context => {
  const db = await fixture(context);
  const batch = parseMultiStateResults(raw(), AT);
  const first = await publishElectionResultBatch({ db, query: db.query, batch, ballots: [ballot], state: "MA", now: new Date(AT), purge });
  assert.deepEqual(first.counts, { matched: 2, unmatched: 1, ambiguous: 1, published: 6, unchanged: 0 });
  const facts = await db.query("SELECT entity_id,field,value,quote_start,provenance_kind FROM fact WHERE status='live' ORDER BY entity_id");
  assert.equal(facts.length, 6);
  assert.ok(facts.every(row => row.quote_start !== null && row.provenance_kind === "REFERENCE"), "the real Slide checked the transient source evidence");
  const adams = facts.find(row => row.entity_id === "adams")!.value as { votes: number; sources: { name: string }[] };
  assert.equal(adams.votes, 100);
  assert.deepEqual(adams.sources.map(row => row.name), ["MultiState", "State election office (sos)"]);
  assert.equal((facts.find(row => row.entity_id === "question-1")!.value as { yesVotes: number }).yesVotes, 120);
  const work = await db.query("SELECT kind,value FROM work WHERE kind IN ('fix','detect') ORDER BY kind");
  assert.deepEqual(work.map(row => row.kind), ["detect", "fix", "fix"]);
  assert.match(JSON.stringify(work), /Candidate missing from served ballot/);
  assert.match(JSON.stringify(work), /Carmen Carroll/);
  assert.match(JSON.stringify(work), /CONTEST_IDENTITY_TIE/);
  const sourceRows = await db.query("SELECT url,final_url,sha256,blob_key,text_key FROM source_copy");
  assert.equal(sourceRows.length, 1);
  assert.equal(sourceRows[0].sha256, batch.evidence.contentHash);
  assert.equal(sourceRows[0].text_key, null);
  assert.match(String(sourceRows[0].blob_key), /^observed:[a-f0-9]{64}:[a-f0-9]{64}:/);
  assert.equal(JSON.stringify(sourceRows).includes("Avery Adams"), false, "only source URL/hash/check metadata is stored");

  let repeatedReads = 0;
  const neverRead = async () => { repeatedReads++; throw new Error("An unchanged fingerprint must stop before the database"); };
  const unchanged = await publishElectionResultBatch({ db: { transaction: neverRead }, query: neverRead,
    batch: parseMultiStateResults(raw(), "2026-11-06T18:00:00.000Z"), ballots: [ballot], state: "MA", prior: first.progress,
    now: new Date("2026-11-06T18:00:00.000Z"), purge });
  assert.equal(repeatedReads, 0);
  assert.equal(unchanged.counts.published, 0);

  const nextAt = "2026-11-07T00:00:00.000Z";
  const changed = await publishElectionResultBatch({ db, query: db.query, batch: parseMultiStateResults(raw(101), nextAt),
    ballots: [ballot], state: "MA", prior: unchanged.progress, now: new Date(nextAt), purge });
  assert.equal(changed.counts.published, 1, "only the changed candidate value publishes; other values retain their versions");
  assert.deepEqual((await db.query("SELECT status,value->>'votes' AS votes FROM fact WHERE entity_id='adams' ORDER BY id")),
    [{ status: "superseded", votes: "100" }, { status: "live", votes: "101" }]);
  assert.equal((await db.query("SELECT count(*)::int n FROM fact WHERE entity_id='baker'"))[0].n, 1);
  await ensureOpenElectionResults(db.query, [ballot], new Set(["governor", "measure"]));
  assert.ok((await db.query("SELECT 1 FROM work WHERE kind='hunt' AND subject_id='local' AND field='election_result' AND status='waiting'")).length);
});

for (const statusDate of [AT, undefined]) test(`replaying unchanged results with ${statusDate ? "known" : "unknown"} status dates and no progress confirms Sources without new history`, async context => {
  const db = await fixture(context);
  const batch = (at: string) => {
    const document = JSON.parse(raw());
    document.general_events[0].statewide_races[0].result_status_set_at = statusDate;
    const parsed = parseMultiStateResults(JSON.stringify(document), at);
    return { ...parsed, races: parsed.races.filter(race => race.sourceRaceId === "10") };
  };
  const first = await publishElectionResultBatch({ db, query: db.query, batch: batch(AT), ballots: [ballot], state: "MA", now: new Date(AT), purge });
  assert.equal(first.counts.published, 4);
  const before = (await db.query("SELECT count(*)::int n FROM fact"))[0].n;
  const nextAt = "2026-11-06T18:00:00.000Z";
  const replay = await publishElectionResultBatch({ db, query: db.query, batch: batch(nextAt), ballots: [ballot], state: "MA", now: new Date(nextAt), purge });
  assert.equal(replay.counts.published, 0, "a lost cursor cannot turn a new check date into changed result values");
  assert.equal((await db.query("SELECT count(*)::int n FROM fact"))[0].n, before);
  assert.ok((await db.query("SELECT checked_at FROM checked_fact WHERE status='live'")).every(row => new Date(row.checked_at as string).toISOString() === nextAt),
    "the actual Slide confirmation keeps Sources current after a replay");
  assert.ok((await db.query("SELECT value FROM fact")).every(row => !("checkedAt" in (row.value as Record<string, unknown>))),
    "a source check date belongs to confirmation metadata, outside result values");
  assert.equal((await db.query("SELECT value->>'statusChangedAt' AS changed FROM fact WHERE entity_id='governor' AND status='live'"))[0].changed,
    statusDate ?? null, "an unknown source status date stays unknown");
});

test("a race boundary checkpoint resumes without replaying completed facts", async context => {
  const db = await fixture(context);
  const batch = parseMultiStateResults(raw(), AT);
  let remaining = 1;
  const first = await publishElectionResultBatch({ db, query: db.query, batch, ballots: [ballot], state: "MA", now: new Date(AT), purge,
    more: () => remaining-- > 0 });
  assert.equal(first.deferred, true);
  assert.equal(first.nextCheckAt, AT);
  assert.deepEqual(Object.keys(first.progress.races), ["multistate:2026-11-03:10"]);
  assert.equal(first.counts.published, 3);
  const resumed = await publishElectionResultBatch({ db, query: db.query, batch, ballots: [ballot], state: "MA", now: new Date(AT), purge,
    prior: first.progress, more: () => true });
  assert.equal(resumed.deferred, false);
  assert.equal(Object.keys(resumed.progress.races).length, 4);
  assert.equal((await db.query("SELECT count(*)::int n FROM fact"))[0].n, 6);
  assert.equal((await db.query("SELECT count(*)::int n FROM fact WHERE entity_id='adams'"))[0].n, 1,
    "the completed first race keeps its exact fact versions on resumption");
});

test("independent congressional summaries keep separate fact histories and source references", async context => {
  const db = await fixture(context);
  const batch = (office: "us_senate" | "us_house", now: string): ElectionResultBatch => {
    const url = `https://ballotpedia.org/${office}_elections,_2026`, quote = "United States D 52 R 48 counting 0";
    return { source: { name: "Ballotpedia", url }, races: [], summaries: [{ state: "US", chambers: [{ name: office,
      seatsBefore: { D: 49, R: 51 }, seatsNow: { D: 52, R: 48 }, stillCounting: 0, controlBefore: "R", controlNow: "D" }],
      governor: { before: null, now: null }, statewideOfficesFlipped: [], source: { name: "Ballotpedia", url },
      creditedSources: [{ name: "Synthetic credited source", url: "https://example.gov/results" }], checkedAt: now, quote }],
      evidence: { text: quote, contentType: "text/plain", contentHash: createHash("sha256").update(quote).digest("hex") } };
  };
  const senate = await publishElectionResultBatch({ db, query: db.query, batch: batch("us_senate", AT), ballots: [], state: "US", now: new Date(AT), purge });
  const house = await publishElectionResultBatch({ db, query: db.query, batch: batch("us_house", AT), ballots: [], state: "US", prior: senate.progress, now: new Date(AT), purge });
  assert.equal(senate.counts.published, 1);
  assert.equal(house.counts.published, 1);
  assert.deepEqual((await db.query("SELECT field FROM fact WHERE status='live' ORDER BY field")).map(row => row.field),
    ["election_summary:us_house", "election_summary:us_senate"]);
  assert.equal(Object.keys(house.progress.summaries).length, 2);
  assert.equal((await db.query("SELECT count(DISTINCT url)::int n FROM source_copy"))[0].n, 2);
});

test("a federal race without a ballot match reaches the map only through a checked Slide fact", async context => {
  const db = await fixture(context);
  const batch = (checkedAt: string): ElectionResultBatch => {
    const quote = "Synthetic winner (D) defeated incumbent Synthetic incumbent (R) in Massachusetts in 2026 with 120 votes.";
    const url = "https://ballotpedia.org/Synthetic_Massachusetts_House_race_2026";
    return { source: { name: "Ballotpedia", url }, races: [{ sourceId: "ballotpedia", sourceName: "Ballotpedia", sourceUrl: url,
      creditedSources: [], sourceRaceId: "Synthetic_Massachusetts_House_race_2026", state: "MA", office: "us_house", officeName: "U.S. House Massachusetts",
      electionDate: "2026-11-03", status: "called", seatsFlipped: 1, incumbentsLost: 1,
      candidates: [{ name: "Synthetic winner", party: "D", votes: 120, won: true }], checkedAt, quote }], summaries: [],
      evidence: { text: quote, contentType: "text/plain", contentHash: createHash("sha256").update(quote).digest("hex") } };
  };
  const first = await publishElectionResultBatch({ db, query: db.query, batch: batch(AT), ballots: [], state: "MA", now: new Date(AT), purge });
  assert.equal(first.counts.unmatched, 1);
  assert.equal(first.counts.published, 1, "an unmatched contest does not suppress the independently checked map result");
  const [fact] = await db.query("SELECT entity_id,field,value,quote_start FROM fact WHERE status='live'");
  assert.equal(fact.entity_id, STATE);
  assert.equal(fact.field, "election_congress:Synthetic_Massachusetts_House_race_2026");
  assert.notEqual(fact.quote_start, null);
  assert.equal(summarizeCongressResults(Object.values(first.progress.federalResults!), AT).states.MA.us_house.seatsFlipped, 1);
  const nextAt = "2026-11-07T12:00:00.000Z";
  const never = async (): Promise<never> => { throw new Error("Unchanged federal results must not read or write the database"); };
  const next = await publishElectionResultBatch({ db: { transaction: never }, query: never, batch: batch(nextAt), ballots: [], state: "MA",
    now: new Date(nextAt), prior: first.progress, purge });
  assert.equal(next.counts.published, 0);
  assert.equal(Object.values(next.progress.federalResults!)[0].checkedAt, nextAt);
  await db.query("UPDATE fact SET provenance_kind='OFFICIAL' WHERE field='election_congress:Synthetic_Massachusetts_House_race_2026'");
  const corrected = batch("2026-11-08T12:00:00.000Z");
  corrected.races[0].candidates = [{ name: "Different synthetic winner", party: "R", votes: 121, won: true }];
  const kept = await publishElectionResultBatch({ db, query: db.query, batch: corrected, ballots: [], state: "MA",
    now: new Date("2026-11-08T12:00:00.000Z"), prior: next.progress, purge });
  assert.equal(kept.counts.published, 0, "a reference cannot replace an official value");
  assert.equal(Object.values(kept.progress.federalResults!)[0].winners[0].party, "D",
    "the map must retain the value the Slide kept, even when the acquired reference changed");
});

test("a governor summary checks both separate source fragments and stores no source fragments in its value", async context => {
  const db = await fixture(context);
  const document = JSON.parse(raw());
  document.events = [{ state: "MA", gov_status: { gov_party: "R" } }];
  document.general_events[0].statewide_races = [];
  document.general_events[0].races = [];
  document.general_events[0].ballot_measures = [];
  document.scorecard.states[0].statewide = [];
  const batch = parseMultiStateResults(JSON.stringify(document), AT);
  assert.equal(batch.summaries[0].quotes?.length, 2);
  const result = await publishElectionResultBatch({ db, query: db.query, batch, ballots: [], state: "MA", now: new Date(AT), purge });
  assert.equal(result.counts.published, 1);
  const [fact] = await db.query("SELECT value,quote,quote_start FROM fact WHERE field='election_summary' AND status='live'");
  const value = fact.value as Record<string, unknown>;
  assert.deepEqual(value.governor, { before: "R", now: "R" });
  assert.equal(value.quote, undefined);
  assert.equal(value.quotes, undefined);
  assert.notEqual(fact.quote_start, null, "the actual Slide checked each exact fragment");
  for (const quote of batch.summaries[0].quotes!) assert.ok(String(fact.quote).includes(quote));
  const invalid = { ...batch, summaries: [{ ...batch.summaries[0], governor: { before: "D", now: "D" },
    quotes: [batch.summaries[0].quote, "Absent source fragment"] }] };
  await assert.rejects(publishElectionResultBatch({ db, query: db.query, batch: invalid, ballots: [], state: "MA", now: new Date(AT), purge }),
    /ELECTION_RESULT_EVIDENCE_MISMATCH/);
  assert.equal((await db.query("SELECT count(*)::int n FROM fact WHERE field='election_summary'"))[0].n, 1,
    "a missing fragment preserves the verified summary");
});

test("served contest, candidate and measure aliases publish to their existing survivors without duplicate entities", async context => {
  const db = await fixture(context);
  const aliases = [
    ["governor", "contest:ma:executive-ticket", "contest", "Joint executive election", STATE],
    ["adams", "candidacy:ma:choice-a", "candidacy", "Reader choice A", "contest:ma:executive-ticket"],
    ["baker", "candidacy:ma:choice-b", "candidacy", "Reader choice B", "contest:ma:executive-ticket"],
    ["measure", "contest:ma:public-question", "contest", "Public question contest", STATE],
    ["question-1", "measure:ma:public-question", "measure", "Reader public question", "contest:ma:public-question"],
  ];
  for (const [rawId, id, kind, name, parent] of aliases) {
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,$2,$3,'MA',$4)", [id, kind, name, parent]);
    await db.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'body-alias',$2)", [id, rawId]);
  }
  const batch = parseMultiStateResults(raw(), AT);
  batch.races = batch.races.filter(race => race.sourceRaceId === "10" || race.sourceRaceId === "20");
  const result = await publishElectionResultBatch({ db, query: db.query, batch, ballots: [ballot], state: "MA", now: new Date(AT), purge });
  assert.equal(result.counts.published, 6);
  assert.deepEqual(await db.query("SELECT id FROM entity WHERE id=ANY($1::text[])", [aliases.map(row => row[0])]), [],
    "source aliases never become duplicate entities");
  assert.deepEqual((await db.query("SELECT entity_id FROM fact WHERE field='election_result' AND status='live' ORDER BY entity_id")).map(row => row.entity_id),
    aliases.map(row => row[1]).sort());
  assert.equal((await db.query(`SELECT entity_id FROM entity_external_id
    WHERE scheme='election-results:multistate:MA:contest:10' AND value='10'`))[0].entity_id, "contest:ma:executive-ticket");
  assert.equal((await db.query(`SELECT entity_id FROM entity_external_id
    WHERE scheme='election-results:multistate:MA:candidacy:10' AND value='Avery Adams'`))[0].entity_id, "candidacy:ma:choice-a");
  assert.deepEqual(await db.query("SELECT field,reason FROM blank"), [], "the Slide sees the source identity on the canonical subject");
});

test("a newly matched race closes its old fix and standing hunt while unresolved candidate work stays open", async context => {
  const db = await fixture(context);
  const withoutGovernor = { ...ballot, contests: ballot.contests.filter(row => row.id !== "governor"),
    candidacies: ballot.candidacies.filter(row => row.contestId !== "governor") };
  const batch = (at: string) => { const value = parseMultiStateResults(raw(), at);
    return { ...value, races: value.races.filter(row => row.sourceRaceId === "10"), summaries: [] }; };
  const first = await publishElectionResultBatch({ db, query: db.query, batch: batch(AT), ballots: [withoutGovernor], state: "MA", now: new Date(AT), purge });
  assert.equal(first.counts.unmatched, 1);
  const [oldFix] = await db.query("SELECT id FROM work WHERE subject_id='election-results:MA:10' AND kind='fix'");
  assert.ok(oldFix);
  await ensureOpenElectionResults(db.query, [ballot], new Set());
  const changed = await publishElectionResultBatch({ db, query: db.query, batch: batch("2026-11-06T18:00:00.000Z"),
    ballots: [ballot], state: "MA", prior: first.progress, now: new Date("2026-11-06T18:00:00.000Z"), purge });
  assert.equal(changed.counts.matched, 1);
  const work = await db.query("SELECT id,subject_id,field,status FROM work WHERE kind IN ('fix','hunt')");
  assert.equal(work.find(row => row.subject_id === "governor")?.status, "done");
  assert.equal(work.find(row => row.id === oldFix.id)?.status, "done");
  assert.equal(work.find(row => row.field === "election_result:Candidate missing from served ballot")?.status, "waiting");
  assert.equal(work.find(row => row.subject_id === "local")?.status, "waiting");
});

test("runner obeys persisted race clocks without loading ballots or fetching sources before due or after certification", async context => {
  const db = await fixture(context);
  const progress = { races: { "multistate:2026-11-03:10": { fingerprint: "a".repeat(64), status: "counting", statusChangedAt: AT,
    lastCheckedAt: AT, nextCheckAt: "2026-11-06T18:00:00.000Z" }, "ballotpedia:2026-11-03:held": { fingerprint: "b".repeat(64),
    status: "certified", statusChangedAt: AT, lastCheckedAt: AT, nextCheckAt: null } }, summaries: {} };
  await db.query("INSERT INTO pass_cursor(name,position) VALUES('election-results:MA',$1)", [JSON.stringify(progress)]);
  await db.query("INSERT INTO pass_cursor(name,position) VALUES('election-results:US',$1)", [JSON.stringify({ races: {}, summaries: {},
    sourceChecks: { "ballotpedia:us_senate": { checkedAt: AT }, "ballotpedia:us_house": { checkedAt: AT } } })]);
  const forbidden = async (): Promise<never> => { throw new Error("A settled source was reread"); };
  const result = await runElectionResults({ db, query: db.query, states: ["MA"], now: new Date("2026-11-06T15:00:00.000Z"),
    ballotsForState: forbidden, fetch: forbidden,
    feedStore: resultFeedMemory() });
  assert.equal(result.reads, 1, "only the existing persisted clock read runs");
  assert.equal(result.nextCheckAt, "2026-11-06T18:00:00.000Z");
  assert.equal((await db.query("SELECT count(*)::int n FROM source_copy"))[0].n, 0);
  assert.equal((await db.query("SELECT count(*)::int n FROM work"))[0].n, 0);
});

test("measure results publish on served contests without wording rows and retain separate existing Measure facts", async context => {
  const db = await fixture(context);
  const stateId = "ocd-division/country:us/state:az";
  const azElection = { id: "az-general", state: "AZ", date: "2026-11-03", name: "General election" };
  const held: BallotSet = { election: azElection, contests: [141, 142, 320].map(number => ({
    ...contest(`az-prop-${number}`, `Proposition ${number}`, stateId), electionId: azElection.id, type: "MEASURE",
  })), candidacies: [], measures: [{ id: "az-question-320", contestId: "az-prop-320", officialNumber: "Proposition 320",
    questionText: "The existing published question wording.", officialStatement: null, provenance: source }], absences: [] };
  const batch = (at: string, yesVotes = 120) => parseMultiStateResults(JSON.stringify({ general_events: [{ state: "AZ", ballot_measures: [
    { id: 501, measure_number: "Proposition 141", short_title: "First published measure", votes_yes: yesVotes, votes_no: 80,
      yes_percentage: yesVotes === 120 ? 60 : 60.2, result: "Passed", result_status: "Called" },
    { id: 502, measure_number: "Proposition 142", short_title: "Second published measure", votes_yes: 90, votes_no: 110,
      yes_percentage: 45, result: "Failed", result_status: "Called" },
    { id: 503, measure_number: "Proposition 320", short_title: "Third published measure", votes_yes: 50, votes_no: 20,
      yes_percentage: 71.43, result: null, result_status: "Counting" },
  ].map(measure => ({ ...measure, election_date: "2026-11-03", vote_source: "sos" })) }] }), at);
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Arizona','AZ')", [stateId]);
  const first = await publishElectionResultBatch({ db, query: db.query, batch: batch(AT), ballots: [held], state: "AZ", now: new Date(AT), purge });
  assert.equal(first.counts.matched, 3);
  assert.equal(first.counts.unmatched, 0);
  assert.equal(first.counts.published, 4);
  const facts = await db.query("SELECT entity_id,value FROM fact WHERE status='live' AND field='election_result' ORDER BY entity_id");
  const byId = Object.fromEntries(facts.map(row => [String(row.entity_id), row.value as Record<string, unknown>]));
  for (const [id, yesVotes, noVotes, yesPercent, outcome] of [["az-prop-141", 120, 80, 60, "passed"],
    ["az-prop-142", 90, 110, 45, "failed"], ["az-prop-320", 50, 20, 71.43, "counting"], ["az-question-320", 50, 20, 71.43, "counting"]]) {
    const value = byId[String(id)];
    assert.deepEqual({ yesVotes: value.yesVotes, noVotes: value.noVotes, yesPercent: value.yesPercent, outcome: value.outcome },
      { yesVotes, noVotes, yesPercent, outcome });
  }
  assert.deepEqual((await db.query("SELECT id FROM entity WHERE kind='measure'")).map(row => row.id), ["az-question-320"],
    "missing wording rows never cause a new Measure identity to be invented");
  assert.equal((await db.query("SELECT count(*)::int n FROM work WHERE kind IN ('fix','detect')"))[0].n, 0);
  const forbidden = async (): Promise<never> => { throw new Error("An unchanged measure result must issue no SQL"); };
  const nextAt = "2026-11-07T12:00:00.000Z";
  const unchanged = await publishElectionResultBatch({ db: { transaction: forbidden }, query: forbidden, batch: batch(nextAt),
    ballots: [held], state: "AZ", prior: first.progress, now: new Date(nextAt), purge });
  assert.equal(unchanged.counts.published, 0);
  const changedAt = "2026-11-08T12:00:00.000Z";
  const changed = await publishElectionResultBatch({ db, query: db.query, batch: batch(changedAt, 121), ballots: [held], state: "AZ",
    prior: unchanged.progress, now: new Date(changedAt), purge });
  assert.equal(changed.counts.published, 1);
  assert.deepEqual((await db.query("SELECT status,value->>'yesVotes' votes FROM fact WHERE entity_id='az-prop-141' ORDER BY id")),
    [{ status: "superseded", votes: "120" }, { status: "live", votes: "121" }]);
});

test("contradictory incumbent flags use the shared fix writer, preserve valid results, and close when corrected", async context => {
  const db = await fixture(context);
  const batch = (at: string, incumbentDefeated = false, votes = 100) => {
    const document = JSON.parse(raw(votes));
    const event = document.general_events[0], governor = event.statewide_races[0];
    event.statewide_races = [governor]; event.races = []; event.ballot_measures = []; document.scorecard.states = [];
    governor.incumbent_defeated = incumbentDefeated;
    const general = governor.general_results.contests[0];
    general.result_status = "Called";
    general.candidates = general.candidates.slice(0, 2).map((candidate: Record<string, unknown>, index: number) => ({
      ...candidate, is_incumbent: index === 1, result: index === 0 ? "Won" : "Lost",
    }));
    return parseMultiStateResults(JSON.stringify(document), at);
  };
  const written: string[] = [];
  const writeFix: NonNullable<Parameters<typeof publishElectionResultBatch>[0]["writeFix"]> = async row => {
    written.push(row.field!);
    await workList(db.query, { owner: "election-results" }).ensure([row]);
  };
  const first = await publishElectionResultBatch({ db, query: db.query, batch: batch(AT), ballots: [ballot], state: "MA",
    now: new Date(AT), purge, writeFix });
  assert.equal(first.counts.published, 3, "valid contest and candidate facts publish immediately");
  assert.deepEqual(written, ["election_result:Source incumbent flags disagree"], "the runner's shared capped writer receives the contradiction");
  const [fix] = await db.query("SELECT id,status,value FROM work WHERE field='election_result:Source incumbent flags disagree'");
  assert.equal(fix.status, "waiting", "ordinary successful-match cleanup must preserve the source contradiction");
  assert.deepEqual((fix.value as Record<string, unknown>).candidateNames, ["Blair Baker"]);
  const nextAt = "2026-11-07T12:00:00.000Z";
  const next = await publishElectionResultBatch({ db, query: db.query, batch: batch(nextAt, false, 101), ballots: [ballot], state: "MA",
    now: new Date(nextAt), prior: first.progress, purge, writeFix });
  assert.equal(next.counts.published, 1);
  assert.equal((await db.query("SELECT status FROM work WHERE id=$1", [fix.id]))[0].status, "waiting");
  const correctedAt = "2026-11-08T12:00:00.000Z";
  await publishElectionResultBatch({ db, query: db.query, batch: batch(correctedAt, true, 101), ballots: [ballot], state: "MA",
    now: new Date(correctedAt), prior: next.progress, purge, writeFix });
  assert.equal((await db.query("SELECT status FROM work WHERE id=$1", [fix.id]))[0].status, "done");
  assert.equal(written.length, 2, "a corrected source creates no replacement fix");
});

test("a captured Ballotpedia district page publishes its served contest and candidates though the page never spells its own URL", async context => {
  const db = await resultFactDb(context, "test-slide", { AZ: "Arizona" });
  const html = `<h5 class="votebox-header-election-type">General election for U.S. House Arizona District 6</h5><p class="results_text">JoAnna Mendoza defeated Juan Ciscomani in the general election for U.S. House Arizona District 6 on November 3, 2026.</p>
    <table class="results_table"><tbody><tr class="non_result_row"><td>Candidate</td><td>%</td><td>Votes</td></tr>
    <tr class="results_row winner"><td>&#10004;</td><td></td><td><a href="/JoAnna_Mendoza">JoAnna Mendoza</a> (D)</td><td><div class="percentage_number">53.0</div></td><td>163,197</td></tr>
    <tr class="results_row"><td></td><td></td><td><a href="/Juan_Ciscomani">Juan Ciscomani</a> (R)</td><td><div class="percentage_number">44.9</div></td><td>138,235</td></tr></tbody></table>
    <table class="votebox_legend"><tr><td>Vote totals may change until results are certified.</td></tr></table>`;
  const batch = parseBallotpediaResults(html, { state: "AZ", office: "us_house", districtHint: "6",
    url: "https://ballotpedia.org/Arizona%27s_6th_Congressional_District_election,_2026" }, AT);
  const az = { id: "az-2026-11-03", date: "2026-11-03", state: "AZ", name: "General election" };
  const seat: Contest = { ...contest("az-us-house-6", "U.S. Representative, District 6", "ocd-division/country:us/state:az/cd:6"), electionId: az.id };
  const served: BallotSet = { election: az, contests: [seat], absences: [], measures: [],
    candidacies: [{ ...candidate("mendoza", seat.id, "Mendoza"), givenName: "JoAnna" }, { ...candidate("ciscomani", seat.id, "Ciscomani"), givenName: "Juan" }] };
  const out = await publishElectionResultBatch({ db, query: db.query, batch, ballots: [served], state: "AZ", now: new Date(AT), purge });
  assert.equal(out.counts.matched, 1);
  const rows = await db.query("SELECT entity_id FROM fact WHERE status='live' AND field='election_result' ORDER BY entity_id");
  assert.deepEqual(rows.map(row => row.entity_id), ["az-us-house-6", "ciscomani", "mendoza"]);
});

test("election results are written in one pass and never mark a place page stale per fact", async context => {
  const db = await fixture(context);
  const statements: string[] = [];
  const counted = { ...db, query: db.query, transaction: <T>(work: (query: typeof db.query) => Promise<T>) =>
    db.transaction(query => work((text, params) => { statements.push(text); return query(text, params); })) };
  const batch = parseMultiStateResults(raw(), AT);
  const first = await publishElectionResultBatch({ db: counted, query: db.query, batch, ballots: [ballot], state: "MA", now: new Date(AT), purge });
  assert.equal(first.counts.published, 6);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM place_page"))[0].n, 0, "no place page was queued for a result fact");
  assert.equal(statements.filter(text => /INSERT INTO fact\b/.test(text)).length, 1, "every new fact went in one multi-row statement");
  assert.equal(statements.filter(text => /requested_entities/.test(text)).length, 0, "the place-page stale walk never ran");
  const again = await publishElectionResultBatch({ db: counted, query: db.query, batch: parseMultiStateResults(raw(), AT), ballots: [ballot], state: "MA", now: new Date(AT), purge });
  assert.equal(again.counts.published, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM fact WHERE status='live'"))[0].n, 6);
});
