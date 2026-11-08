import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createHash } from "node:crypto";
import { runElectionResults } from "../lib/election-results/runner.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { seedFeedDoors } from "../lib/doors/seed-feeds.ts";
import type { Query } from "../lib/facts/publish.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { ElectionResultBatch } from "../lib/election-results/types.ts";
import { parseMultiStateResults } from "../lib/election-results/multistate.ts";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { resultReadCache, resultFeedMemory, resultFactDb, resultBallotDb } from "./helpers/election-results.ts";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import { ballotElectionKey } from "../lib/ballot/generic-projection.ts";
import { stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { selectedBallotStatement } from "../lib/reader/selected-ballot.ts";
import { selectedStateEntry } from "../lib/reader/selected-entry.ts";
import type { GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { readNationalElectionResults, readStateElectionResults } from "../lib/reader/election-results.ts";
import { publicationVersion, readCanonicalShelf } from "../lib/reader/canonical.ts";
import { installElectionResultFeedStore, type ElectionResultFeedStore } from "../lib/election-results/feed-store.ts";

let feeds: ElectionResultFeedStore;
beforeEach(() => {
  feeds = resultFeedMemory();
  installElectionResultFeedStore(feeds);
});

const at = "2026-11-04T00:00:00.000Z";
const emptyBatch: ElectionResultBatch = { source: { name: "Synthetic result feed", url: "https://example.org/results" },
  races: [], summaries: [], evidence: { text: "Synthetic fixture", contentHash: "", contentType: "text/plain" } };
const provenance = { sourceUrl: "https://example.gov/ballot", sourceOrg: "Election office", collectedAt: at, verifiedAt: null };
const overview = (office: "us_house" | "us_senate", racePages: NonNullable<ElectionResultBatch["racePages"]> = []): ElectionResultBatch => {
  const source = { name: "Ballotpedia", url: `https://ballotpedia.org/United_States_${office === "us_house" ? "House_of_Representatives" : "Senate"}_elections,_2026` };
  const quote = "United States D 52 R 48 counting 0";
  return { source, racePages, races: [], summaries: [{ state: "US", chambers: [{ name: office, seatsBefore: { D: 49, R: 51 },
    seatsNow: { D: 52, R: 48 }, stillCounting: 0, controlBefore: "R", controlNow: "D" }], governor: { before: null, now: null },
    statewideOfficesFlipped: [], source, creditedSources: [], checkedAt: at, quote }],
    evidence: { text: quote, contentType: "text/plain", contentHash: createHash("sha256").update(quote).digest("hex") } };
};
const federalBox = (state: string, office: string) => `<h5>General election for U.S. ${office} ${state}</h5>
  <p class="results_text">Casey Citizen defeated another candidate on November 3, 2026.</p>
  <table class="results_table"><tr class="results_row"><td>&#10004;</td><td><a href="/Casey_Citizen">Casey Citizen</a> (D)</td>
  <td><div class="percentage_number">100</div></td><td>50</td></tr></table><p>The results have been certified.</p>`;
const ballot = (state: string, title = "Local board"): BallotSet => ({ election: { id: `${state}-general`, state,
  date: "2026-11-03", name: "General election" }, contests: [{ id: `${state}-contest`, electionId: `${state}-general`,
  ocdId: `ocd-division/country:us/state:${state.toLowerCase()}`, title, type: "CANDIDACY", voteFor: 1, termYears: 2,
  scopeNote: null, divisionVintage: "2026", provenance }], candidacies: [], measures: [], absences: [] });

async function localRuntime() {
  const saved = new Map<string, string>(), versions = new Map<string, string>();
  const positionBytes: number[] = [], cache = resultReadCache();
  const query: Query = async (text, params = []) => {
    if (text.includes("requested(name,scope,hash)")) {
      const rows = (params[0] as string[]).map((name, index) => {
        const position = saved.get(name), clock_hash = position === undefined ? null : createHash("md5").update(position).digest("hex");
        return { name, clock_hash, position: clock_hash === (params[2] as (string | null)[])[index] ? null : position ?? null,
          ballot_version: versions.get(name) ?? "ballot-v1" };
      });
      positionBytes.push(rows.reduce((total, row) => total + Buffer.byteLength(row.position ?? ""), 0));
      return rows;
    }
    if (text.startsWith("INSERT INTO pass_cursor")) saved.set(String(params[0]), String(params[1]));
    return [];
  };
  const repos = createMemoryRepositories();
  await seedFeedDoors({ repo: repos.doors, deriveInputAt: at, at });
  return { saved, versions, query, cache, positionBytes, doors: repos.doors, db: { transaction: async <T>(run: (execute: Query) => Promise<T>) => run(query) } };
}

test("unchanged due results reuse fingerprints and cached race routes without rereading ballot data", async () => {
  const runtime = await localRuntime();
  let ballotReads = 0;
  const multistate: ElectionResultBatch = { ...emptyBatch, races: [{ sourceId: "multistate", sourceName: "Synthetic result feed",
    sourceUrl: "https://example.org/results", creditedSources: [], sourceRaceId: "synthetic-governor", state: "AZ", office: "governor",
    officeName: "Governor", electionDate: "2026-11-03", status: "counting", candidates: [], checkedAt: at, quote: "Synthetic fixture" }] };
  const input = { ...runtime, states: ["AZ"], multistate,
    ballotsForState: async () => { ballotReads++; return [ballot("AZ")]; },
    fetch: async () => { throw new Error("Synthetic source unavailable"); } };
  const first = await runElectionResults({ ...input, now: new Date(at) });
  assert.equal(first.unmatched, 1);
  assert.equal(ballotReads, 1);
  const second = await runElectionResults({ ...input, now: new Date("2026-11-04T06:00:00.000Z") });
  assert.equal(ballotReads, 1, "the changed-source comparison happens before any saved ballot is read");
  assert.equal(second.unchanged, 1);
  assert.equal(second.reads, 2, "one compact metadata statement and one batched source-door operation");
  assert.equal(runtime.positionBytes[1], 0, "the fresh server MD5 confirms cached progress without transporting stored record bodies");
  assert.equal(second.nextCheckAt, "2026-11-04T12:00:00.000Z");
  const external = JSON.parse(runtime.saved.get("election-results:AZ")!);
  runtime.saved.set("election-results:AZ", JSON.stringify({ ...external, externalObservation: "changed" }));
  await runElectionResults({ ...input, now: new Date("2026-11-04T06:05:00.000Z") });
  assert.ok(runtime.positionBytes[2] > 0, "a fresh changed server fingerprint replaces the disposable cached continuation");
  assert.equal(ballotReads, 1);
  runtime.versions.set("election-results:AZ", "ballot-v2");
  await runElectionResults({ ...input, now: new Date("2026-11-04T12:00:00.000Z") });
  assert.equal(ballotReads, 2, "a new served ballot version rematches unchanged source results");
  await runElectionResults({ ...input, multistate: undefined, now: new Date("2026-11-04T18:00:00.000Z") });
  const failed = JSON.parse(runtime.saved.get("election-results:AZ")!);
  assert.equal(failed.sourceChecks.multistate.failed, true);
  assert.equal(failed.sourceChecks.multistate.lastSucceededAt, "2026-11-04T12:00:00.000Z");
  assert.equal(failed.races[Object.keys(failed.races)[0]].lastCheckedAt, "2026-11-04T12:00:00.000Z");
});

test("a source read-now request is spent once and Admin receives the real source outcome", async () => {
  const runtime = await localRuntime();
  const row = await runtime.doors.mustRead("feed:election-results:multistate");
  await runtime.doors.compareAndSet(row.id, row.revision, { ...row.value, readNow: true }, at);
  const result = await runElectionResults({ ...runtime, states: ["AZ"], multistate: emptyBatch, ballotsForState: async () => [ballot("AZ")],
    now: new Date(at), fetch: async () => { throw new Error("Synthetic source unavailable"); } });
  assert.equal(result.nextCheckAt, "2026-11-04T06:00:00.000Z");
  const source = (await runtime.doors.mustRead(row.id)).value;
  assert.equal(source.readNow, false);
  assert.equal(source.lastSuccessAt, at);
  assert.equal(source.notes, row.value.notes, "updating a clock preserves all other source metadata");
});

test("empty state coverage and unavailable sources stay scheduled, with no source snapshots in saved metadata", async () => {
  const runtime = await localRuntime();
  const result = await runElectionResults({ ...runtime, states: ["AZ"], multistate: emptyBatch, ballotsForState: async () => [],
    now: new Date(at), fetch: async () => { throw new Error("Synthetic source unavailable"); } });
  assert.equal(result.nextCheckAt, "2026-11-04T06:00:00.000Z");
  for (const saved of runtime.saved.values()) assert.ok(!saved.includes("Synthetic fixture"));
});

test("federal routes include statewide at-large seats and use the source's plural-state possessive", async () => {
  const runtime = await localRuntime(), urls: string[] = [];
  await runElectionResults({ ...runtime, states: ["AK", "IL"], multistate: emptyBatch, now: new Date(at),
    ballotsForState: async state => [state === "AK" ? ballot(state, "U.S. Representative") : { ...ballot(state, "U.S. Representative"),
      contests: ballot(state, "U.S. Representative").contests.map(contest => ({ ...contest, ocdId: `${contest.ocdId}/cd:15` })) }],
    fetch: async request => { urls.push(String(request)); throw new Error("Synthetic source unavailable"); } });
  assert.ok(urls.includes("https://ballotpedia.org/Alaska%27s_At-Large_Congressional_District_election,_2026"));
  assert.ok(urls.includes("https://ballotpedia.org/Illinois%27_15th_Congressional_District_election,_2026"));
});

test("the maintenance deadline saves completed states and resumes remaining work while national checks run first", async () => {
  const runtime = await localRuntime(), readStates: string[] = [], requested: string[] = [];
  let tick = 0;
  const query: Query = async (text, params) => {
    const rows = await runtime.query(text, params);
    if (text.startsWith("INSERT INTO pass_cursor") && params?.[0] === "election-results:AZ") tick = 2;
    return rows;
  };
  const input = { ...runtime, query, states: ["AZ", "CA"], multistate: emptyBatch, deadlineMs: 1, clock: () => tick,
    ballotsForState: async (state: string) => { readStates.push(state); return [ballot(state)]; },
    fetch: async (url: Parameters<typeof fetch>[0]) => { requested.push(String(url)); throw new Error("Synthetic source unavailable"); } };
  const first = await runElectionResults({ ...input, now: new Date(at) });
  assert.deepEqual(readStates, ["AZ"]);
  assert.equal(first.nextCheckAt, at);
  assert.ok(runtime.saved.has("election-results:AZ"));
  assert.ok(!runtime.saved.has("election-results:CA"));
  const nation = JSON.parse(runtime.saved.get("election-results:US")!);
  assert.equal(nation.sourceChecks["ballotpedia:us_senate"].checkedAt, at);
  assert.equal(nation.sourceChecks["ballotpedia:us_house"].checkedAt, at);
  assert.equal(requested.length, 2, "both national clocks were checked before the first state used its budget");
  tick = 0;
  const resumed = await runElectionResults({ ...input, now: new Date("2026-11-04T00:05:00.000Z") });
  assert.deepEqual(readStates, ["AZ", "CA"], "completed Arizona work is skipped without rereading its ballot");
  assert.ok(runtime.saved.has("election-results:CA"));
  assert.equal(resumed.reads, 2, "resuming adds no polling query");
  assert.ok(resumed.nextCheckAt! > "2026-11-04T00:05:00.000Z");
});

test("an already spent maintenance deadline defers without database or source reads", async () => {
  let calls = 0;
  const query: Query = async () => { calls++; return []; };
  const result = await runElectionResults({ query, db: { transaction: async work => work(query) },
    now: new Date(at), deadlineMs: 1, clock: () => 2, fetch: async () => { calls++; throw new Error("Unexpected source read"); } });
  assert.equal(calls, 0);
  assert.equal(result.reads, 0);
  assert.equal(result.nextCheckAt, at);
});

test("a race-boundary checkpoint resumes changed old races without republishing the completed race", async context => {
  const db = await resultFactDb(context, "test-results-deadline", { AZ: "Arizona" });
  const held = ballot("AZ", "Governor");
  held.contests[0].id = "az-governor";
  held.contests.push({ ...held.contests[0], id: "az-attorney", title: "Attorney General" });
  held.candidacies = [["alpha", "az-governor", "Alpha Governor"], ["beta", "az-attorney", "Beta Lawyer"]].map(([id, contestId, familyName]) => ({
    id, contestId, givenName: "", familyName, partyLabel: "D", slogan: null, incumbent: null, websiteUrl: null, provenance,
  }));
  const batch = (now: string, votes: number) => parseMultiStateResults(JSON.stringify({ general_events: [{ state: "AZ", statewide_races:
    [[21, "Governor", "Alpha Governor"], [22, "Attorney General", "Beta Lawyer"]].map(([seat_id, office, name]) => ({ seat_id, office,
      election_date: "2026-11-03", general_results: { contests: [{ type: "General", election_id: Number(seat_id) + 100,
        result_status: "Counting", candidates: [{ candidate_id: Number(seat_id), name, party: "D", votes, pct: 100 }] }] } })) }] }), now);
  let tick = 0, expire = false, ballotReads = 0;
  const clockBytes: number[] = [];
  const query: Query = async (text, params) => {
    const rows = await db.query(text, params);
    if (text.includes("requested(name,scope,hash)")) clockBytes.push(rows.reduce((total, row) => total +
      (typeof row.position === "string" ? Buffer.byteLength(row.position) : 0), 0));
    if (expire && text.startsWith("UPDATE work SET status='done'") && params?.[0] === "az-governor") tick = 2;
    return rows;
  };
  const input = { db, query, states: ["AZ"], deadlineMs: 1, clock: () => tick,
    ballotsForState: async () => { ballotReads++; return [held]; }, purge: async () => ({ purged: true }),
    fetch: async () => { throw new Error("Synthetic overview unavailable"); } };
  await runElectionResults({ ...input, now: new Date(at), multistate: batch(at, 10) });
  const later = "2026-11-04T06:00:00.000Z";
  expire = true;
  const partial = await runElectionResults({ ...input, now: new Date(later), multistate: batch(later, 20) });
  assert.equal(clockBytes[1], 0, "the actual SQL returns only fresh headers when the cached continuation matches");
  assert.equal(partial.published, 1);
  assert.equal(partial.nextCheckAt, later);
  const position = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:AZ'"))[0].position));
  assert.ok(position.pendingSources.includes("multistate"));
  assert.equal(position.races["multistate:2026-11-03:21"].lastCheckedAt, later);
  assert.equal(position.races["multistate:2026-11-03:22"].lastCheckedAt, at);
  assert.equal((await db.query("SELECT value->>'votes' votes FROM fact WHERE entity_id='beta' AND status='live'"))[0].votes, "10");
  const alphaVersions = (await db.query("SELECT count(*)::int n FROM fact WHERE entity_id='alpha'"))[0].n;
  tick = 0;
  const failedAt = "2026-11-04T06:05:00.000Z";
  const failed = await runElectionResults({ ...input, now: new Date(failedAt) });
  assert.equal(failed.nextCheckAt, "2026-11-04T12:00:00.000Z", "the next national clock, rather than immediate retry of the source outage, owns the next turn");
  const waiting = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:AZ'"))[0].position));
  assert.ok(!waiting.pendingSources.includes("multistate"));
  assert.equal(waiting.sourceChecks.multistate.checkedAt, failedAt);
  const resumedAt = "2026-11-04T12:05:00.000Z";
  const resumed = await runElectionResults({ ...input, now: new Date(resumedAt), multistate: batch(resumedAt, 20) });
  assert.equal(resumed.published, 1, "the old fingerprint of the unfinished changed race was retained");
  assert.equal((await db.query("SELECT value->>'votes' votes FROM fact WHERE entity_id='beta' AND status='live'"))[0].votes, "20");
  assert.equal((await db.query("SELECT count(*)::int n FROM fact WHERE entity_id='alpha'"))[0].n, alphaVersions,
    "the completed first race retains its saved field fingerprints and history");
  const complete = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:AZ'"))[0].position));
  assert.ok(!complete.pendingSources.includes("multistate"));
  assert.equal(complete.races["multistate:2026-11-03:22"].lastCheckedAt, resumedAt);
  assert.equal(ballotReads, 3, "only the remaining changed race requires its state's current ballot on resume");
});

test("the source catalog fetches a race missing from the served ballot and gives it a fix row", async context => {
  const db = await resultFactDb(context, "test-source-catalog");
  await db.query("INSERT INTO pass_cursor(name,position) VALUES('election-results:AZ',$1)", [JSON.stringify({ races: {}, summaries: {},
    federalRoutes: [], ballotVersion: null, sourceChecks: { multistate: { checkedAt: at }, ballotpedia: { checkedAt: at } } })]);
  const url = "https://ballotpedia.org/Arizona%27s_7th_Congressional_District_election,_2026";
  const house = overview("us_house", [{ state: "AZ", office: "us_house", districtHint: "7", electionDate: "2026-11-03", url }]);
  house.catalogErrors = [{ url: "https://ballotpedia.org/United_States_House_of_Representatives_elections_in_Arizona,_2026", reason: "Synthetic index unavailable" }];
  const requested: string[] = [];
  const input = { query: db.query, db, states: ["AZ"], multistate: emptyBatch, congressSummaries: [overview("us_senate"), house],
    ballotsForState: async () => [], purge: async () => ({ purged: true }),
    fetch: async (request: Parameters<typeof fetch>[0]) => { requested.push(String(request)); return new Response(federalBox("Arizona", "House")); } };
  const result = await runElectionResults({ ...input, now: new Date("2026-11-04T00:05:00.000Z") });
  assert.deepEqual(requested, [url], "a newly cataloged race runs even though the state's prior source clock is not due");
  assert.equal(result.unmatched, 1);
  assert.equal(result.published, 3, "national summaries and the unmatched race's map fact publish despite a partial catalog index failure");
  const summary = await readNationalElectionResults(feeds);
  assert.equal(summary?.states.AZ.us_house.reportedRaces, 1, "an unmatched race still reaches the national map through its Slide fact");
  assert.equal(summary?.states.AZ.us_house.totalRaces, 1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM fact WHERE field LIKE 'election_congress:%' AND status='live'"))[0].n, 1);
  const fixes = await db.query("SELECT state,subject_id,field FROM work WHERE kind='fix' AND status='waiting'");
  assert.ok(fixes.some(row => row.state === "AZ" && String(row.subject_id).includes("Arizona's_7th_Congressional_District_election,_2026")
    && String(row.field).startsWith("election_result:")), "the source-known missing contest has its own fix row");
  assert.ok(fixes.some(row => row.state === "US" && String(row.field).startsWith("source:")));
  const nation = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:US'"))[0].position));
  assert.deepEqual(nation.federalRoutes.map((page: { url: string }) => page.url), [url]);
  await runElectionResults({ ...input, now: new Date("2026-11-04T00:10:00.000Z") });
  assert.deepEqual(requested, [url], "the catalog does not restart the certified race");
});

test("the Senate catalog replaces a generic Florida fallback with the source's special-election route", async context => {
  const db = await resultFactDb(context, "test-special-catalog");
  const url = "https://ballotpedia.org/United_States_Senate_special_election_in_Florida,_2026", requested: string[] = [];
  await runElectionResults({ query: db.query, db, states: ["FL"], multistate: emptyBatch,
    congressSummaries: [overview("us_house"), overview("us_senate", [{ state: "FL", office: "us_senate", electionDate: "2026-11-03", url }])],
    now: new Date(at), ballotsForState: async () => [ballot("FL", "U.S. Senate")], purge: async () => ({ purged: true }),
    fetch: async request => { requested.push(String(request)); return new Response(federalBox("Florida", "Senate")); } });
  assert.deepEqual(requested, [url]);
});

test("the production reader matches every held district before creating a missing-race fix", async context => {
  const db = await resultBallotDb(context);
  const stateId = "ocd-division/country:us/state:az";
  const scope = stateBallotScope("ballot-contests", "AZ");
  const key = `BALLOT_CANDIDACY:${scope}`;
  const held: BallotSet = { ...ballot("AZ", "State Representative District 1"),
    contests: [1, 2].map(district => ({ ...ballot("AZ").contests[0], id: `az-house-${district}`,
      title: `State Representative District ${district}`, ocdId: `${stateId}/sldl:${district}` })),
    candidacies: ["Alice Legislator", "Blair Legislator"].map((familyName, index) => ({ id: `az-person-${index + 1}`,
      contestId: `az-house-${index + 1}`, givenName: "", familyName, partyLabel: "D", slogan: null,
      incumbent: false, websiteUrl: null, provenance })),
  };
  const withdrawn = { ...held.candidacies[1], id: "az-withdrawn", familyName: "Casey Missing" };
  held.candidacies.push(withdrawn);
  held.removals = [{ ...withdrawn, status: "REMOVED_FROM_FILING", lastListed: provenance, absentFrom: provenance,
    firstAbsentOn: "2026-11-04", statement: "The current official filing no longer lists this candidate." }];
  const selectedZipBallot = ballotForDivisions(held, [stateId, `${stateId}/sldl:1`]);
  assert.deepEqual(selectedZipBallot.contests.map(row => row.id), ["az-house-1"]);
  const batch = parseMultiStateResults(JSON.stringify({ general_events: [{ state: "AZ", races:
    ["Alice Legislator", "Blair Legislator", "Casey Missing"].map((name, index) => ({ seat_id: 801 + index,
      office: "State House", district: String(index + 1), election_date: "2026-11-03",
      general_results: { contests: [{ type: "General", election_id: 901 + index, result_status: "Counting",
        candidates: [{ candidate_id: index + 1, name, party: "D", votes: 100, pct: 100 }] }] } })) }] }), at);
  const cache = resultReadCache();
  const canonicalReads: unknown[][] = [];
  const query: Query = async (sql, params = []) => {
    if (sql.startsWith("WITH RECURSIVE shelf AS MATERIALIZED")) {
      canonicalReads.push([...params]);
      assert.deepEqual(params, [[key], key], "authority and fact bootstrap name the whole state, with no ZIP or selected district");
    }
    return db.query(sql, params);
  };
  for (const sql of WORK_DDL) await db.pg.exec(sql);
  await db.publish({ id: "full-state-ballot", at, sourceId: "synthetic-ballot-authority", recordClass: "BALLOT_CANDIDACY", scope,
    value: { kind: "ballot-contests", ballots: { [ballotElectionKey(held)]: held } } });
  for (const id of ["ocd-division/country:us", stateId, ...held.contests.map(row => row.ocdId)])
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$1,$2) ON CONFLICT DO NOTHING",
      [id, id === "ocd-division/country:us" ? null : "AZ"]);
  workList(db.query, { owner: "test-statewide-results" });
  const result = await runElectionResults({ db, query, cache, states: ["AZ"], now: new Date(at), multistate: batch,
    purge: async () => ({ purged: true }), fetch: async () => { throw new Error("Synthetic overview unavailable"); } });
  assert.equal(canonicalReads.length, 1, "the default production path reads the promoted full-state authority once");
  assert.equal(result.matched, 2);
  assert.equal(result.unmatched, 1);
  assert.deepEqual((await db.query("SELECT entity_id FROM fact WHERE field='election_result' AND status='live' AND entity_id LIKE 'az-house-%' ORDER BY entity_id"))
    .map(row => row.entity_id), ["az-house-1", "az-house-2"], "the race outside the selected ZIP publishes to its existing contest");
  assert.equal((await db.query("SELECT entity_id FROM fact WHERE entity_id='az-withdrawn' AND field='election_result'")).length, 0,
    "a withdrawn filing cannot match a race after it leaves the reader's choices");
  const fixes = await db.query("SELECT subject_id FROM work WHERE kind='fix' AND status='waiting' AND field LIKE 'election_result:%'");
  assert.deepEqual(fixes.map(row => row.subject_id), ["election-results:AZ:803"], "only the race absent everywhere in the held state ballot becomes a fix");
  const selected = selectedBallotStatement("AZ", [stateId, `${stateId}/sldl:1`]);
  assert.doesNotMatch(selected.text, /\b(?:fact|checked_fact|fact_confirmation|pass_cursor)\b/, "a ballot visit never looks up result facts or clocks");
  const readBallot = async () => {
    const rows = await db.query(selected.text, selected.params);
    const entry = selectedStateEntry("BALLOT_CANDIDACY", scope, rows[0]);
    assert.equal(entry.kind, "PROMOTED");
    return (entry as Extract<typeof entry, { kind: "PROMOTED" }>).projection.payload as GenericBallotProjection;
  };
  const first = await readBallot();
  assert.equal(Object.values(first.ballots)[0].contests[0].result, undefined, "the initial ballot remains the original source projection");
  const feed = await readStateElectionResults("AZ", undefined, feeds);
  assert.equal((feed?.facts[held.contests[0].id] as { status: string }).status, "counting");
  const later = "2026-11-04T06:00:00.000Z";
  const next = await runElectionResults({ db, query, cache, states: ["AZ"], now: new Date(later), multistate: { ...batch,
    races: batch.races.map(race => ({ ...race, checkedAt: later })) },
    congressSummaries: [overview("us_house"), overview("us_senate")],
    purge: async () => ({ purged: true }), fetch: async () => { throw new Error("Synthetic overview unavailable"); } });
  assert.equal(next.published, 0, "an unchanged scheduled run makes no new fact versions");
  assert.equal(canonicalReads.length, 1, "the next scheduled run reuses the freshly versioned held ballot");
  const second = await readBallot();
  assert.deepEqual(second, first, "results never change the initial ballot payload");
  const refreshed = await readStateElectionResults("AZ", undefined, feeds);
  assert.equal((refreshed?.facts[held.contests[0].id] as { checkedAt: string }).checkedAt, later,
    "the prepared result feed carries the job's successful check date");
});

test("one fix allowance spans sources, states and candidate gaps while facts publish and queued certified work resumes", async context => {
  const db = await resultFactDb(context, "test-results-fix-allowance", { AZ: "Arizona", CA: "California" });
  const multistate = parseMultiStateResults(JSON.stringify({ general_events: [
    { state: "AZ", statewide_races: [[101, "Attorney General", "Alex Attorney"], [105, "State House", "Sam Smith"]] },
    { state: "CA", statewide_races: [[102, "Treasurer", "Blair Treasurer"], [103, "Governor", "Casey Citizen"]] },
  ].map(state => ({ ...state, statewide_races: state.statewide_races.map(([seat_id, office, name]) => ({
    seat_id, office, election_date: "2026-11-03", general_results: { contests: [{ type: "General", result_status: office === "Governor" ? "Certified" : "Counting",
      candidates: [{ candidate_id: seat_id, name, party: "D", votes: 100, pct: 100 },
        ...(office === "Governor" ? [{ candidate_id: 104, name: "Taylor Missing", party: "R", votes: 0, pct: 0 }] : [])] }] },
  })) })) }), at);
  const held = ballot("CA", "Governor");
  held.candidacies.push({ id: "ca-governor-person", contestId: held.contests[0].id, givenName: "", familyName: "Casey Citizen",
    partyLabel: "D", slogan: null, incumbent: false, websiteUrl: null, provenance });
  const arizona = ballot("AZ");
  for (const district of [9, 10]) {
    const id = `az-house-${district}`;
    arizona.contests.push({ ...arizona.contests[0], id, title: "State Representative", ocdId: `ocd-division/country:us/state:az/sldl:${district}` });
    arizona.candidacies.push({ ...held.candidacies[0], id: `${id}-person`, contestId: id, familyName: "Sam Smith" });
  }
  const url = "https://ballotpedia.org/Arizona%27s_7th_Congressional_District_election,_2026";
  const requests: string[] = [], ballotReads: string[] = [], cache = resultReadCache();
  const input = { db, query: db.query, cache, states: ["AZ", "CA"], multistate, maxFixRows: 2,
    congressSummaries: [overview("us_senate"), overview("us_house", [{ state: "AZ", office: "us_house", districtHint: "7", electionDate: "2026-11-03", url }])],
    ballotsForState: async (state: string) => { ballotReads.push(state); return [state === "CA" ? held : arizona]; },
    purge: async () => ({ purged: true }), fetch: async (request: Parameters<typeof fetch>[0]) => {
      requests.push(String(request)); return new Response(federalBox("Arizona", "House"));
    } };
  const first = await runElectionResults({ ...input, now: new Date(at) });
  assert.equal(first.unmatched, 3);
  assert.equal(first.fixRowsWritten, 2);
  assert.equal(first.pendingFixRows, 2);
  assert.equal(first.ambiguous, 1);
  assert.equal((await db.query("SELECT count(*)::int n FROM work WHERE kind='detect'"))[0].n, 1, "detectives remain separate from the fix allowance");
  assert.equal(first.matched, 1, "a matched race after the exhausted allowance still publishes");
  assert.equal(first.nextCheckAt, at);
  assert.deepEqual(requests, [url]);
  const fixes = () => db.query("SELECT state,subject_id FROM work WHERE kind='fix' AND field LIKE 'election_result:%' ORDER BY subject_id");
  assert.equal((await fixes()).length, 2, "the allowance is shared by MultiState and Ballotpedia, not reset by a state or batch");
  const progress = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:CA'"))[0].position));
  assert.ok(progress.races["multistate:2026-11-03:102"]);
  assert.ok(progress.sourceFingerprints["multistate:2026-11-03:102"], "queued work does not require refetching a checked source");
  assert.equal(progress.races["multistate:2026-11-03:103"].status, "certified");
  assert.ok(!progress.pendingSources.includes("multistate"));
  assert.equal(progress.pendingFixes.length, 2);
  const versions = () => db.query("SELECT entity_id,count(*)::int n FROM fact WHERE entity_id IN ('CA-contest','ca-governor-person') GROUP BY entity_id ORDER BY entity_id");
  const before = await versions();
  assert.deepEqual(before.map(row => row.n), [1, 1]);
  const later = "2026-11-04T00:05:00.000Z";
  const forbidden = async (): Promise<never> => { throw new Error("Queued work must not refetch sources or reread ballots"); };
  const resumed = await runElectionResults({ ...input, now: new Date(later), multistate: undefined, ballotsForState: forbidden, fetch: forbidden });
  assert.equal(resumed.unmatched, 0);
  assert.equal(resumed.published, 0);
  assert.equal(resumed.fixRowsWritten, 2);
  assert.equal(resumed.pendingFixRows, 0);
  assert.ok(resumed.nextCheckAt! > later);
  assert.equal((await fixes()).length, 4);
  assert.deepEqual(await versions(), before, "completed matched facts retain their original history versions on resume");
  assert.deepEqual(ballotReads, ["AZ", "CA"], "the work-only continuation does not reload any ballot");
  assert.deepEqual(requests, [url], "the completed federal race is not fetched again");
});

test("a fix allowance must be a positive integer before any database reads", async () => {
  const query: Query = async () => { throw new Error("The invalid allowance must fail before a database read"); };
  for (const maxFixRows of [0, -1, 0.5, NaN, Infinity])
    await assert.rejects(runElectionResults({ query, db: { transaction: async work => work(query) }, maxFixRows }), /positive integer/);
});

test("the default runner turn writes at most 100 fixes including source failures and queues all remaining descriptors", async context => {
  const db = await resultFactDb(context, "test-default-fix-cap");
  const multistate: ElectionResultBatch = { ...emptyBatch, races: Array.from({ length: 101 }, (_, index) => ({
    sourceId: "multistate", sourceName: "Synthetic result feed", sourceUrl: "https://example.org/results", creditedSources: [],
    sourceRaceId: `missing-${index}`, state: "AZ", office: "governor", officeName: "Governor", electionDate: "2026-11-03",
    status: "counting", candidates: [], checkedAt: at, quote: "Synthetic fixture",
  })) };
  const runtime = await localRuntime();
  const result = await runElectionResults({ query: db.query, db, cache: runtime.cache, states: ["AZ"], multistate,
    ballotsForState: async () => [ballot("AZ")], now: new Date(at), fetch: async () => { throw new Error("Synthetic overview unavailable"); } });
  assert.equal(result.unmatched, 101);
  assert.equal(result.fixRowsWritten, 100);
  assert.equal(result.pendingFixRows, 3);
  assert.equal((await db.query("SELECT count(*)::int n FROM work WHERE kind='fix'"))[0].n, 100);
  assert.equal(result.nextCheckAt, at);
  const progress = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:AZ'"))[0].position));
  assert.ok(progress.races["multistate:2026-11-03:missing-100"]);
  assert.ok(progress.sourceFingerprints["multistate:2026-11-03:missing-100"]);
  assert.equal(progress.pendingFixes.length, 3);
  assert.ok(progress.pendingFixes.every((row: { kind: string }) => row.kind === "fix"));
});

test("source failures share the fix cap and deduplicated national work survives later state saves", async context => {
  const db = await resultFactDb(context, "test-results-source-queue");
  const senate = overview("us_senate"), house = overview("us_house");
  senate.catalogErrors = [{ url: "https://ballotpedia.org/synthetic-senate-index", reason: "Synthetic Senate index unavailable" }];
  house.catalogErrors = Array.from({ length: 3 }, () => ({ url: "https://ballotpedia.org/synthetic-house-index", reason: "Synthetic House index unavailable" }));
  const cache = resultReadCache();
  const forbidden = async (): Promise<never> => { throw new Error("Source failures queued as work need no acquisition retry"); };
  const first = await runElectionResults({ db, query: db.query, cache, states: ["AZ", "CA"], maxFixRows: 1,
    multistate: emptyBatch, congressSummaries: [senate, house], ballotsForState: async state => [ballot(state)],
    now: new Date(at), purge: async () => ({ purged: true }), fetch: forbidden });
  assert.equal(first.fixRowsWritten, 1);
  assert.equal(first.pendingFixRows, 1, "three reports of the same pending source fix share its WorkId");
  assert.equal(first.published, 2, "the fix allowance cannot hold either valid national summary");
  assert.equal((await db.query("SELECT count(*)::int n FROM work WHERE kind='fix'"))[0].n, 1);
  const nation = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:US'"))[0].position));
  assert.equal(nation.pendingFixes.length, 1);
  assert.equal(nation.pendingFixes[0].state, "US");
  assert.equal(nation.sourceChecks["ballotpedia:us_house"].failed, true);
  const later = "2026-11-04T00:05:00.000Z";
  const next = await runElectionResults({ db, query: db.query, cache, states: ["AZ", "CA"], maxFixRows: 1,
    now: new Date(later), fetch: forbidden, ballotsForState: forbidden });
  assert.equal(next.fixRowsWritten, 1);
  assert.equal(next.pendingFixRows, 0);
  assert.equal(next.published, 0);
  assert.ok(next.nextCheckAt! > later, "emptying pending work restores the existing source clock");
  assert.equal((await db.query("SELECT count(*)::int n FROM work WHERE kind='fix'"))[0].n, 2);
  const saved = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:US'"))[0].position));
  assert.deepEqual(saved.pendingFixes, []);
});

test("a queued incumbent contradiction retires on correction before the capped writer can flush it", async context => {
  const db = await resultFactDb(context, "test-queued-incumbent-correction", { AZ: "Arizona" });
  const held = ballot("AZ", "Governor");
  held.candidacies = ["Alpha Governor", "Beta Governor"].map((familyName, index) => ({
    id: `az-governor-${index}`, contestId: held.contests[0].id, givenName: "", familyName,
    partyLabel: index ? "R" : "D", slogan: null, incumbent: Boolean(index), websiteUrl: null, provenance,
  }));
  const batch = (checkedAt: string, incumbentDefeated: boolean) => {
    const parsed = parseMultiStateResults(JSON.stringify({ general_events: [{ state: "AZ", statewide_races: [{
      seat_id: 901, office: "Governor", election_date: "2026-11-03", incumbent_defeated: incumbentDefeated,
      general_results: { contests: [{ type: "General", election_id: 1901, result_status: "Called",
        candidates: held.candidacies.map((candidate, index) => ({ candidate_id: index + 1, name: candidate.familyName,
          party: candidate.partyLabel, votes: index ? 80 : 120, pct: index ? 40 : 60,
          is_incumbent: Boolean(index), result: index ? "Lost" : "Won" })) }] },
    }] }] }), checkedAt);
    return { ...parsed, summaries: [] };
  };
  const statements: { text: string; params: readonly unknown[] }[] = [];
  const traced = (query: Query): Query => async (text, params = []) => {
    statements.push({ text, params });
    const rows = await query(text, params);
    // The metadata query has no ordering guarantee. Exercise the valid order where national work spends the allowance first.
    return text.includes("requested(name,scope,hash)")
      ? [...rows].sort((a, b) => Number(b.name === "election-results:US") - Number(a.name === "election-results:US")) : rows;
  };
  const cache = resultReadCache();
  const input = { query: traced(db.query), db: { transaction: async <T,>(work: (query: Query) => Promise<T>) => db.transaction(query => work(traced(query))) },
    cache, states: ["AZ"], maxFixRows: 1, ballotsForState: async () => [held], purge: async () => ({ purged: true }),
    fetch: async () => { throw new Error("Synthetic Ballotpedia overview unavailable"); } };
  const writtenFixes = () => statements.filter(row => row.text.startsWith("INSERT INTO work"))
    .flatMap(row => JSON.parse(String(row.params[0])) as { kind: string; field: string }[]).filter(row => row.kind === "fix");
  const first = await runElectionResults({ ...input, now: new Date(at), multistate: batch(at, false) });
  assert.equal(first.fixRowsWritten, 1);
  assert.equal(writtenFixes().length, 1);
  assert.equal(first.pendingFixRows, 2, "the second overview failure and the contradictory source flag wait behind the cap");
  const firstAZ = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:AZ'"))[0].position));
  assert.ok(firstAZ.summaries["incumbent-conflict:multistate:2026-11-03:901"]);
  assert.deepEqual(firstAZ.pendingFixes.map((row: { field: string }) => row.field), ["election_result:Source incumbent flags disagree"]);
  assert.equal((await db.query("SELECT count(*)::int n FROM work WHERE field='election_result:Source incumbent flags disagree'"))[0].n, 0);
  statements.length = 0;
  const later = "2026-11-05T00:00:00.000Z";
  const next = await runElectionResults({ ...input, now: new Date(later), multistate: batch(later, true) });
  assert.equal(next.fixRowsWritten, 1);
  assert.equal(writtenFixes().length, 1);
  assert.ok(writtenFixes().every(row => row.field.startsWith("source:")), "the queued source failure spends this turn's only fix write");
  assert.equal(next.pendingFixRows, 1, "only a current source failure remains queued after the source corrects its incumbent flag");
  const nextAZ = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:AZ'"))[0].position));
  assert.equal(nextAZ.summaries["incumbent-conflict:multistate:2026-11-03:901"], undefined);
  assert.deepEqual(nextAZ.pendingFixes, [], "saving progress prunes the unwritten contradiction instead of recreating it next turn");
  const nation = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:US'"))[0].position));
  assert.ok(nation.pendingFixes.every((row: { field: string }) => row.field.startsWith("source:")));
  assert.equal((await db.query("SELECT count(*)::int n FROM work WHERE field='election_result:Source incumbent flags disagree'"))[0].n, 0);
  assert.equal(statements.filter(row => /^\s*SELECT\b[\s\S]*\bFROM\s+work\b/i.test(row.text)).length, 0,
    "retiring queued work uses the already read progress and adds no work-list read");
  assert.equal((await db.query("SELECT value->>'incumbentLost' lost FROM fact WHERE entity_id='AZ-contest' AND field='election_result' AND status='live'"))[0].lost,
    "true", "the corrected source value still publishes while fix work is capped");
});

test("a fresh national overview reaches a prepared state feed while its called and certified races are not due", async context => {
  const db = await resultBallotDb(context);
  for (const sql of WORK_DDL) await db.pg.exec(sql);
  const stateId = "ocd-division/country:us/state:az", scope = stateBallotScope("ballot-contests", "AZ");
  const held = ballot("AZ", "State Representative District 1");
  held.contests[0].ocdId = `${stateId}/sldl:1`;
  held.candidacies.push({ id: "az-called-legislator", contestId: held.contests[0].id, givenName: "", familyName: "Alex Legislator",
    partyLabel: "D", slogan: null, incumbent: false, websiteUrl: null, provenance });
  await db.publish({ id: "az-national-refresh-authority", recordClass: "BALLOT_CANDIDACY", scope, at,
    sourceId: "synthetic-ballot-authority", value: { kind: "ballot-contests", ballots: { [ballotElectionKey(held)]: held } } });
  for (const [id, name] of [["ocd-division/country:us", "United States"], [stateId, "Arizona"], [held.contests[0].ocdId, "District 1"]])
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$2,$3) ON CONFLICT DO NOTHING",
      [id, name, id === "ocd-division/country:us" ? null : "AZ"]);
  workList(db.query, { owner: "test-national-ballot-refresh" });
  const stateResults = parseMultiStateResults(JSON.stringify({ general_events: [{ state: "AZ", races: [{
    seat_id: 601, office: "State House", district: "1", election_date: "2026-11-03", incumbent_defeated: false,
    general_results: { contests: [{ type: "General", election_id: 1601, result_status: "Called",
      candidates: [{ candidate_id: 1, name: "Alex Legislator", party: "D", votes: 100, pct: 100, is_incumbent: false, result: "Won" }] }] },
  }] }] }), at);
  const url = "https://ballotpedia.org/Arizona%27s_7th_Congressional_District_election,_2026";
  const house = overview("us_house", [{ state: "AZ", office: "us_house", districtHint: "7", electionDate: "2026-11-03", url }]);
  const senate = (democrats: number, checkedAt: string): ElectionResultBatch => {
    const batch = overview("us_senate"), quote = `United States D ${democrats} R ${100 - democrats} counting 0`;
    return { ...batch, summaries: batch.summaries.map(summary => ({ ...summary, quote, checkedAt,
      chambers: summary.chambers.map(chamber => ({ ...chamber, seatsNow: { D: democrats, R: 100 - democrats } })) })),
      evidence: { text: quote, contentType: "text/plain", contentHash: createHash("sha256").update(quote).digest("hex") } };
  };
  const jobStatements: string[] = [], requests: string[] = [], cache = resultReadCache();
  const query: Query = async (text, params) => { jobStatements.push(text); return db.query(text, params); };
  const input = { db, query, cache, states: ["AZ"], multistate: { ...stateResults, summaries: [] }, purge: async () => ({ purged: true }),
    fetch: async (request: Parameters<typeof fetch>[0]) => { requests.push(String(request)); return new Response(federalBox("Arizona", "House")); } };
  const first = await runElectionResults({ ...input, now: new Date(at), congressSummaries: [senate(52, at), house] });
  assert.equal(first.matched, 1);
  assert.equal(first.unmatched, 1);
  assert.deepEqual(requests, [url]);
  const senateSeats = async () => {
    const feed = await readStateElectionResults("AZ", undefined, feeds);
    return (feed?.facts["ocd-division/country:us#election_summary:us_senate"] as { chambers: { seatsNow: { D: number } }[] })?.chambers[0].seatsNow.D;
  };
  assert.equal(await senateSeats(), 52);
  const before = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:AZ'"))[0].position));
  assert.equal(before.races["multistate:2026-11-03:601"].nextCheckAt, "2026-11-05T00:00:00.000Z");
  assert.ok(Object.entries(before.races).some(([key, value]) => key.startsWith("ballotpedia:") && (value as { status: string }).status === "certified"));
  jobStatements.length = 0;
  const later = "2026-11-04T06:00:00.000Z";
  const next = await runElectionResults({ ...input, now: new Date(later), congressSummaries: [senate(53, later), house],
    fetch: async (): Promise<never> => { throw new Error("The state's certified race and cached ballot are not due to be fetched"); } });
  assert.equal(next.matched, 0, "the called state race remains on its daily clock");
  assert.equal(next.unmatched, 0, "the certified federal race remains stopped");
  assert.equal(await senateSeats(), 53, "the new national count reaches the prepared state feed at the national clock");
  assert.equal(jobStatements.filter(text => text.includes("requested(name,scope,hash)")).length, 1,
    "the ordinary compact metadata read discovers national and state work together");
  assert.equal(jobStatements.filter(text => text.startsWith("WITH RECURSIVE shelf AS MATERIALIZED")).length, 0,
    "the job reuses its verified state projection rather than rereading ballot or fact records");
  assert.deepEqual(requests, [url]);
  const after = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:AZ'"))[0].position));
  assert.equal(after.races["multistate:2026-11-03:601"].lastCheckedAt, at, "national propagation does not claim a new state-source check");
});

test("a failed prepared-feed write retries from checked facts without changing initial ballots or rereading sources", async context => {
  const db = await resultBallotDb(context);
  for (const sql of WORK_DDL) await db.pg.exec(sql);
  const stateId = "ocd-division/country:us/state:az", scope = stateBallotScope("ballot-contests", "AZ");
  const held = ballot("AZ", "Governor");
  held.candidacies.push({ id: "az-feed-governor", contestId: held.contests[0].id, givenName: "", familyName: "Alex Governor",
    partyLabel: "D", slogan: null, incumbent: false, websiteUrl: null, provenance });
  await db.publish({ id: "az-feed-authority", recordClass: "BALLOT_CANDIDACY", scope, at, sourceId: "synthetic-ballot-authority",
    value: { kind: "ballot-contests", ballots: { [ballotElectionKey(held)]: held } } });
  for (const [id, name] of [["ocd-division/country:us", "United States"], [stateId, "Arizona"]])
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$2,$3)", [id, name, id === stateId ? "AZ" : null]);
  workList(db.query, { owner: "test-prepared-feed-retry" });
  const stateResults = parseMultiStateResults(JSON.stringify({ general_events: [{ state: "AZ", statewide_races: [{ seat_id: 602,
    office: "Governor", election_date: "2026-11-03", incumbent_defeated: false, general_results: { contests: [{ type: "General", election_id: 1602,
      result_status: "Called", candidates: [{ candidate_id: 1, name: "Alex Governor", party: "D", votes: 100, pct: 100, is_incumbent: false, result: "Won" }] }] },
  }] }] }), at);
  const initial = () => db.query("SELECT xmin::text AS version,payload FROM civic_data_promotions WHERE record_class='BALLOT_CANDIDACY' AND scope=$1", [scope]);
  const original = await initial(), statements: string[] = [];
  const key = `BALLOT_CANDIDACY:${scope}`;
  const reader = async (queries: readonly { text: string; params: readonly unknown[] }[]) =>
    Promise.all(queries.map(statement => db.query(statement.text, statement.params)));
  const versionBefore = await publicationVersion([key], reader);
  const selectedStatement = selectedBallotStatement("AZ", [stateId]);
  const initialSelected = async () => {
    const rows = await db.query(selectedStatement.text, selectedStatement.params);
    return selectedStateEntry("BALLOT_CANDIDACY", scope, rows[0]);
  };
  const initialFull = async () => (await readCanonicalShelf([{ recordClass: "BALLOT_CANDIDACY", scope }], reader)).readPromotedEntry!("BALLOT_CANDIDACY", scope);
  const selectedBefore = await initialSelected(), fullBefore = await initialFull();
  const { doors } = await localRuntime();
  const cache = resultReadCache();
  let writes = 0;
  const store: ElectionResultFeedStore = { ...feeds, writeState: async (state, document) => {
    if (++writes === 1) throw new Error("Synthetic object store unavailable");
    await feeds.writeState(state, document);
  } };
  const query: Query = async (text, params) => { statements.push(text); return db.query(text, params); };
  const forbidden = async (): Promise<never> => { throw new Error("Feed retries must not reacquire source pages"); };
  const input = { db, query, cache, doors, states: ["AZ"], maxFixRows: 1, feedStore: store, multistate: { ...stateResults, summaries: [] },
    congressSummaries: [overview("us_senate"), overview("us_house")], purge: async () => ({ purged: true }), fetch: forbidden };
  const first = await runElectionResults({ ...input, now: new Date(at) });
  assert.equal(first.fixRowsWritten, 1);
  assert.equal(first.nextCheckAt, at, "a failed feed write schedules an immediate job continuation");
  assert.equal(await feeds.readState("AZ"), null);
  assert.deepEqual(await initial(), original);
  assert.equal(await publicationVersion([key], reader), versionBefore, "the first results run cannot invalidate the source ballot publication");
  assert.deepEqual(await initialSelected(), selectedBefore);
  assert.deepEqual(await initialFull(), fullBefore);
  const progress = JSON.parse(String((await db.query("SELECT position FROM pass_cursor WHERE name='election-results:AZ'"))[0].position));
  assert.equal(progress.readerPending, true);
  assert.ok(!progress.pendingSources.length, "checked sources keep their existing clocks");
  assert.equal((await db.query("SELECT count(*)::int n FROM fact WHERE field='election_result' AND status='live'"))[0].n, 2,
    "valid contest and candidate facts reached the Slide before the object store failed");
  statements.length = 0;
  const later = "2026-11-04T00:05:00.000Z";
  const next = await runElectionResults({ ...input, now: new Date(later), multistate: undefined, congressSummaries: undefined });
  assert.equal(next.published, 0);
  assert.equal(next.reads, 2, "the warm retry only needs the ordinary compact clock and Admin source-door metadata reads");
  assert.equal(next.fixRowsWritten, 0);
  assert.ok(next.nextCheckAt! > later);
  assert.equal(writes, 2);
  assert.equal(statements.filter(text => text.startsWith("WITH RECURSIVE shelf AS MATERIALIZED")).length, 0);
  const prepared = await feeds.readState("AZ");
  assert.equal((prepared?.facts[held.contests[0].id] as { status: string }).status, "called");
  assert.equal(Object.hasOwn(prepared!, "ballots"), false);
  assert.equal(JSON.stringify(prepared).includes("Synthetic election office"), false, "the feed holds result citations rather than a source ballot copy");
  assert.deepEqual(await initial(), original, "neither feed preparation nor retry changes the foreground promotion payload or version");
  assert.equal(await publicationVersion([key], reader), versionBefore);
  assert.deepEqual(await initialSelected(), selectedBefore);
  assert.deepEqual(await initialFull(), fullBefore);
  assert.doesNotMatch(JSON.stringify(await initialFull()), /"(?:result|results)"\s*:/, "the full initial ballot carries no result fields");
  assert.equal((await db.query("SELECT count(*)::int n FROM work WHERE kind='fix' AND field LIKE 'source:%' AND status='waiting'"))[0].n, 0,
    "successful publication closes the earlier object-store failure");
});
