import assert from "node:assert/strict";
import test from "node:test";
import { parseMultiStateResults } from "../lib/election-results/multistate.ts";
import { ballotpediaRaceId, parseBallotpediaCongressSummary, parseBallotpediaResults, readBallotpediaCongressSummary, readBallotpediaResults } from "../lib/election-results/ballotpedia.ts";

const now = "2026-11-07T06:00:00.000Z";

test("Ballotpedia identities decode public page paths and reject file and unrelated URLs", () => {
  assert.equal(ballotpediaRaceId("https://ballotpedia.org/Michigan%27s_9th_Congressional_District_election,_2026"),
    "Michigan's_9th_Congressional_District_election,_2026");
  assert.throws(() => ballotpediaRaceId("file:///tmp/race.html"), /public Ballotpedia HTTPS/);
  assert.throws(() => ballotpediaRaceId("https://example.com/race"), /public Ballotpedia HTTPS/);
});
const candidates = [{ name: "Ann María Smith", candidate_id: 10, party: "D", votes: 300, pct: 60, result: "Won" },
  { name: "John Doe", candidate_id: 11, party: "R", votes: 200, pct: 40, result: "Lost" }];
function multi(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ generated_at: now, events: [{ state: "AZ", races: [{ seat_id: 8, office: "Primary only" }] }],
    general_events: [{ state: "AZ", statewide_races: [{ seat_id: 8, office: "Governor", election_date: "2026-11-03",
      result_status: "Called", result_status_set_at: "2026-11-04T01:00:00Z", flipped_seat: { from: "R", to: "D" }, incumbent_defeated: true,
      candidates: [{ name: "Wrong primary winner", result: "Won" }],
      general_results: { contests: [{ election_id: 12, type: "General", result_status: "Called", votes_pct_in: 95, candidates }] }, ...overrides }],
    races: [], ballot_measures: [{ id: 20, measure_number: "Proposition 1", short_title: "Synthetic school funding measure",
      election_date: "2026-11-03", result: "Failed", result_status: "Called", votes_yes: 210, votes_no: 290, yes_percentage: "42.00", vote_source: "sos" }] }],
    scorecard: { states: [{ st: "AZ", chambers: [{ name: "House", before: { composition: { D: 27, R: 33 }, control: "R" },
      after: { composition: { D: 37, R: 20 }, control: "D" }, counting: 3 }],
      statewide: [{ office: "Governor", prev: "R", win: "D", cls: "flip" }] }] } }, null, 2);
}

test("MultiState reads general events and authoritative general candidate results with exact evidence", () => {
  const raw = multi(), batch = parseMultiStateResults(raw, now), race = batch.races[0];
  assert.equal(batch.races.length, 2);
  assert.equal(race.office, "governor");
  assert.equal(race.sourceRaceId, "8");
  assert.equal(race.percentCounted, 95);
  assert.equal(race.seatsToFill, undefined);
  assert.equal(parseMultiStateResults(multi({ num_seats: 3 }), now).races[0].seatsToFill, 3);
  assert.equal(race.statusChangedAt, "2026-11-04T01:00:00Z");
  assert.equal(race.flipped, true);
  assert.equal(race.gainedByParty, "D");
  assert.equal(race.incumbentLost, true);
  assert.equal(race.candidates[0].name, "Ann María Smith");
  assert.equal(race.candidates[0].votes, 300);
  assert.equal(race.candidates[0].percent, 60);
  assert.equal(race.candidates[0].won, true);
  assert.equal(JSON.parse(race.quote).office, "Governor");
  assert.ok(raw.includes(race.quote));
  for (const candidate of race.candidates) {
    assert.ok(candidate.quote && race.quote.includes(candidate.quote));
    assert.equal(JSON.parse(candidate.quote).votes, candidate.votes);
  }
});

test("MultiState preserves chamber composition and source-stated measure outcome", () => {
  const batch = parseMultiStateResults(multi(), now);
  assert.deepEqual(batch.races[1].measure, { name: "Synthetic school funding measure", number: "Proposition 1", yesVotes: 210, noVotes: 290, yesPercent: 42, outcome: "failed" });
  assert.deepEqual(batch.races[1].creditedSources, [{ name: "State election office (sos)" }]);
  assert.deepEqual(batch.summaries[0].chambers[0], { name: "House", seatsBefore: { D: 27, R: 33 }, seatsNow: { D: 37, R: 20 }, stillCounting: 3, controlBefore: "R", controlNow: "D" });
  assert.deepEqual(batch.summaries[0].governor, { before: "R", now: "D" });
  assert.deepEqual(batch.summaries[0].statewideOfficesFlipped, [{ office: "Governor", from: "R", to: "D" }]);
  assert.ok(batch.evidence.text.includes(batch.summaries[0].quote));
});

test("MultiState supports source election IDs for special races without seat IDs", () => {
  const batch = parseMultiStateResults(multi({ seat_id: undefined, is_special: true }), now);
  assert.equal(batch.races[0].sourceRaceId, "election:12");
  assert.equal(JSON.parse(batch.races[0].quote).office, "Governor");
});

test("a seatless special keeps its general identity when primary results follow it", () => {
  const raw = multi({ seat_id: undefined, is_special: true,
    primary_results: { contests: [{ election_id: 6818, type: "Primary_R", candidates: [{ ...candidates[0], votes: 5, pct: 100 }] }] } });
  for (const state of [undefined, "AZ"]) {
    const race = parseMultiStateResults(raw, now, "2026-11-03", state).races[0];
    assert.equal(race.sourceRaceId, "election:12");
    assert.equal(race.candidates[0].name, "Ann María Smith");
    assert.ok(raw.includes(race.quote));
    assert.equal(JSON.parse(race.quote).general_results.contests[0].election_id, 12);
    assert.equal(JSON.parse(race.quote).primary_results.contests[0].election_id, 6818);
    assert.equal(JSON.parse(race.candidates[0].quote!).votes, 300, "candidate evidence comes from general results, not the later primary");
  }
});

test("a seatless special election cannot share the regular seat's race clock or fix-row identity", () => {
  const document = JSON.parse(multi({ seat_id: undefined, is_special: true }));
  const event = document.general_events[0];
  event.statewide_races.push({ ...event.statewide_races[0], seat_id: 12 });
  const batch = parseMultiStateResults(JSON.stringify(document), now);
  assert.deepEqual(batch.races.filter(race => race.office === "governor").map(race => race.sourceRaceId), ["election:12", "12"]);
});

test("MultiState never confuses May or primary results with the November ballot", () => {
  assert.equal(parseMultiStateResults(multi({ election_date: "2026-05-19" }), now).races.length, 1);
  const batch = parseMultiStateResults(multi({ result_status: "Certified", general_results: { contests: [{ type: "General", result_status: "Counting", candidates: [{ ...candidates[0], result: "Runoff" }] }] } }), now);
  assert.equal(batch.races[0].status, "runoff");
  assert.equal(batch.races[0].candidates[0].runoff, true);
  assert.throws(() => parseMultiStateResults('{"events": []}', now), /general_events/);
});

test("a state worker only materializes its state and ignores another state's changed shape", () => {
  const document = JSON.parse(multi());
  document.general_events.unshift({ state: "TX", races: [{ office: "Changed source shape", election_date: "2026-11-03" }] });
  const raw = JSON.stringify(document), batch = parseMultiStateResults(raw, now, "2026-11-03", "az");
  assert.deepEqual([...new Set(batch.races.map(race => race.state))], ["AZ"]);
  assert.deepEqual(batch.summaries.map(summary => summary.state), ["AZ"]);
  assert.equal(batch.evidence.text, raw);
  assert.throws(() => parseMultiStateResults(raw, now, "2026-11-03", "ZZ"), /state is missing/);
});

test("a state worker reads every matching event when a May event precedes November and keeps each event's evidence", () => {
  const document = JSON.parse(multi());
  const november = document.general_events[0];
  const may = structuredClone(november);
  may.statewide_races[0].election_date = "2026-05-19";
  may.statewide_races[0].general_results.contests[0].candidates[0].votes = 7;
  may.ballot_measures = [];
  document.general_events = [may, november];
  const raw = JSON.stringify(document), national = parseMultiStateResults(raw, now), state = parseMultiStateResults(raw, now, "2026-11-03", "AZ");
  assert.deepEqual(state.races.map(race => race.sourceRaceId).sort(), national.races.map(race => race.sourceRaceId).sort());
  assert.equal(state.races.length, 2);
  for (const batch of [national, state]) {
    assert.equal(batch.races[0].candidates[0].votes, 300);
    assert.equal(JSON.parse(batch.races[0].quote).election_date, "2026-11-03");
    assert.equal(JSON.parse(batch.races[0].candidates[0].quote!).votes, 300);
  }
});

test("source-held governor party fills a non-election year but cannot call a counting election", () => {
  const document = JSON.parse(multi());
  document.events[0].gov_status = { gov_party: "R", trifecta: "Split" };
  document.general_events[0].statewide_races = [];
  document.scorecard.states[0].statewide = [];
  const raw = JSON.stringify(document), summary = parseMultiStateResults(raw, now, "2026-11-03", "AZ").summaries[0];
  assert.deepEqual(summary.governor, { before: "R", now: "R" });
  assert.ok(summary.quotes?.every(quote => raw.includes(quote)));
  assert.ok(summary.quotes?.some(quote => quote.includes('"gov_party":"R"')));
  document.scorecard.states[0].statewide = [{ office: "Governor", prev: "R", win: null, cls: "counting" }];
  assert.deepEqual(parseMultiStateResults(JSON.stringify(document), now).summaries[0].governor, { before: "R", now: null });
});

const race = { state: "TX", office: "us_senate" as const, url: "https://ballotpedia.org/United_States_Senate_election_in_Texas,_2026" };
function box(year: number, narrative: string, certified = false) {
  return `<h5>General election for U.S. Senate Texas</h5><p class="results_text">${narrative} on November 3, ${year}.</p>
    <table class="results_table"><tbody>
    <tr class="non_result_row"><td>Candidate</td><td>%</td><td>Votes</td></tr>
    <tr class="results_row winner"><td>&#10004;</td><td><img alt="Thumbnail" /></td><td><a href="/Ann_Smith">Ann Smith</a> (D)</td><td><div class="percentage_number">59.2</div><div style="width:59.211535819%"></div></td><td>4,125,080</td></tr>
    <tr class="results_row"><td></td><td></td><td><a href="/John_Doe"><strong><u>John Doe</u></strong></a> (R)</td><td><div class="percentage_number">0.0</div></td><td>0</td></tr></tbody></table>
    <table class="votebox_legend"><tr><td>${certified ? "The results have been certified." : "Vote totals may change until results are certified."}<a href="https://www.nytimes.com/election-results">Source</a></td></tr></table>`;
}

test("Ballotpedia selects current general election, exact displayed percentage, winner checkmark and credited source", () => {
  const html = `<meta name="description" content="Ann Smith defeated John Doe in the general election in 2026.">
    ${box(2026, "The following candidates ran in the general election")}
    <h4>Primary election</h4><p>John Doe defeated another candidate.</p>
    ${box(2024, "John Doe defeated Ann Smith", true)}`;
  const batch = parseBallotpediaResults(html, race, now), result = batch.races[0];
  assert.equal(result.status, "called");
  assert.deepEqual(result.candidates.map(({ quote: _, ...candidate }) => candidate), [
    { name: "Ann Smith", party: "D", votes: 4125080, percent: 59.2, won: true, runoff: false },
    { name: "John Doe", party: "R", votes: 0, percent: 0, won: false, runoff: false }]);
  assert.equal(result.incumbentLost, true);
  assert.deepEqual(result.creditedSources, [{ name: "The New York Times", url: "https://www.nytimes.com/election-results" }]);
  assert.ok(html.includes(result.quote));
  assert.ok(result.candidates.every(candidate => candidate.quote && result.quote.includes(candidate.quote)));
  assert.equal(result.percentCounted, undefined);
});

test("a checkmark alone cannot call a Ballotpedia race and historic defeated text does not call it", () => {
  const html = `${box(2026, "The following candidates ran")}${box(2024, "Ann Smith defeated John Doe")}`;
  assert.equal(parseBallotpediaResults(html, race, now).races[0].status, "counting");
  assert.equal(parseBallotpediaResults(box(2026, "Ann Smith defeated John Doe"), race, now).races[0].status, "called");
  assert.equal(parseBallotpediaResults(box(2026, "Ann Smith defeated John Doe", true), race, now).races[0].status, "certified");
});

test("Ballotpedia refuses another state and missing or ambiguous current tables", () => {
  assert.throws(() => parseBallotpediaResults(box(2026, "Ann Smith defeated John Doe"), { ...race, state: "AZ" }, now), /ambiguous or missing/);
  assert.throws(() => parseBallotpediaResults(box(2024, "Ann Smith defeated John Doe"), race, now), /ambiguous or missing/);
  assert.throws(() => parseBallotpediaResults(box(2026, "Candidates ran") + box(2026, "Candidates ran").replace("4,125,080", "4,125,081"), race, now), /ambiguous or missing/);
});

test("an identical current results box repeated in a page's year history is one result", () => {
  const html = box(2026, "Candidates ran") + box(2026, "Candidates ran");
  const result = parseBallotpediaResults(html, race, now).races[0];
  assert.equal(result.candidates[0].votes, 4125080);
  assert.ok(html.includes(result.quote));
});

test("special general elections parse and photo submissions never become candidate names", async () => {
  const html = box(2026, "Ann Smith defeated John Doe")
    .replace("General election for", "Special general election for")
    .replace('<td><img alt="Thumbnail" /></td><td>', '<td><a href="https://form.ballotpedia.org/submit">Submit photo</a></td><td class="votebox-results-cell--text">');
  assert.equal(parseBallotpediaResults(html, race, now).races[0].candidates[0].name, "Ann Smith");
  let readUrl: unknown;
  await readBallotpediaResults({ ...race, url: "https://ballotpedia.org/Texas'_1st_Congressional_District_election,_2026" }, now,
    (async url => { readUrl = url; return new Response(html); }) as typeof fetch);
  assert.equal(readUrl, "https://ballotpedia.org/Texas%27_1st_Congressional_District_election,_2026");
});

test("Louisiana's November congressional primary is read by exact election date without treating advancement as a general win", () => {
  const louisiana = { state: "LA", office: "us_house" as const, districtHint: "6",
    url: "https://ballotpedia.org/Louisiana%27s_6th_Congressional_District_election,_2026" };
  const html = box(2026, "The following candidates ran in the primary")
    .replace("General election for U.S. Senate Texas", "Nonpartisan primary election  for U.S. House Louisiana District 6");
  const result = parseBallotpediaResults(html, louisiana, now).races[0];
  assert.equal(result.status, "counting");
  assert.equal(result.candidates[0].votes, 4125080);
  assert.equal(result.candidates[0].won, false);
  assert.equal(result.candidates[0].runoff, true);
  assert.ok(html.includes(result.quote));
  const certified = parseBallotpediaResults(html.replace("Ann Smith</a>", "<strong><u>Ann Smith</u></strong></a>")
    .replace("<strong><u>John Doe</u></strong>", "John Doe")
    .replace("</table>", "</table><p>The results have been certified.</p>"), louisiana, now).races[0];
  assert.equal(certified.incumbentLost, false, "an incumbent who advanced has not lost the seat");
  assert.throws(() => parseBallotpediaResults(html.replace("November 3", "June 2"), louisiana, now), /ambiguous or missing/);
  assert.throws(() => parseBallotpediaResults(html.replaceAll("2026", "2024"), louisiana, now), /ambiguous or missing/);
  assert.throws(() => parseBallotpediaResults(html.replaceAll("Louisiana", "Texas"), { ...louisiana, state: "TX" }, now), /ambiguous or missing/);
});

test("a canceled current general election publishes its source-stated unopposed winner without invented vote totals", () => {
  const florida = { state: "FL", office: "us_house" as const, districtHint: "10",
    url: "https://ballotpedia.org/Florida%27s_10th_Congressional_District_election,_2026" };
  const html = '<h4>General election</h4><p>The general election scheduled for November 3, 2026, was canceled. Incumbent <a href="/Maxwell_Alejandro_Frost">Maxwell Alejandro Frost</a> (D) won election in the general election for U.S. House Florida District 10 without appearing on the ballot.</p>';
  const result = parseBallotpediaResults(html, florida, now).races[0];
  assert.equal(result.status, "unopposed");
  assert.deepEqual(result.candidates.map(({ quote: _quote, ...candidate }) => candidate),
    [{ name: "Maxwell Alejandro Frost", party: "D", won: true, runoff: false }]);
  assert.ok(html.includes(result.quote));
  assert.throws(() => parseBallotpediaResults(html.replace("2026", "2024"), florida, now), /ambiguous or missing/);
  assert.throws(() => parseBallotpediaResults(html, { ...florida, state: "GA" }, now), /ambiguous or missing/);
  assert.throws(() => parseBallotpediaResults(html.replace("won election", "advanced"), florida, now), /ambiguous or missing/);
});

test("Congress summary counts the full chamber, including Senate holdovers and remaining uncalled seats", () => {
  const html = `<h2><span id="Election_results,_2026">Election results, 2026</span></h2>
    <p>As of Nov. 6, 2026, Democrats had won 20 and Republicans 13 of the 35 U.S. Senate races.</p>
    <p>Decision Desk HQ projected that Democrats would win control of the U.S. Senate.</p>
    <p>Republicans held a 53-47 majority. Of the seats up for election, Democrats hold 13 and Republicans hold 22.</p>
    <h2>Partisan balance</h2><table><caption>U.S. Senate Partisan Breakdown</caption>
    <tr><td>Democratic Party</td><td>45<sup>[2]</sup></td><td>Pending</td></tr>
    <tr><td>Republican Party</td><td>53</td><td>Pending</td></tr>
    <tr><td>Independent</td><td>2</td><td>Pending</td></tr>
    <tr><td>Vacancies</td><td>0</td><td>Pending</td></tr></table>
    <li id="cite_note-1"><a href="https://votes.decisiondeskhq.com/balance-of-power/2026/senate">Decision Desk HQ</a></li>`;
  const batch = parseBallotpediaCongressSummary(html, "us_senate", now), summary = batch.summaries[0];
  assert.equal(summary.state, "US");
  assert.equal(summary.chambers[0].name, "us_senate");
  assert.deepEqual(summary.chambers[0].seatsNow, { D: 52, R: 44, I: 2, Vacant: 0 });
  assert.equal(summary.chambers[0].stillCounting, 2);
  assert.equal(summary.chambers[0].controlBefore, "R");
  assert.equal(summary.chambers[0].controlNow, "D");
  assert.deepEqual(summary.creditedSources, [{ name: "Decision Desk HQ", url: "https://votes.decisiondeskhq.com/balance-of-power/2026/senate" }]);
  assert.ok(html.includes(summary.quote));
  assert.throws(() => parseBallotpediaCongressSummary(html.replace("Democrats hold 13", "Democrats hold 15"), "us_senate", now), /holdover evidence/);
  assert.equal(batch.racePages, undefined);
  const catalog = parseBallotpediaCongressSummary(html + `<a href="/United_States_Senate_election_in_Arizona,_2026">Arizona</a>
    <a href="/United_States_Senate_special_election_in_Florida,_2026">Florida special</a>
    <a href="/United_States_Senate_special_election_in_Florida,_2026#Candidates">Florida duplicate</a>`, "us_senate", now).racePages;
  assert.deepEqual(catalog?.map(page => ({ state: page.state, office: page.office, electionDate: page.electionDate })), [
    { state: "AZ", office: "us_senate", electionDate: "2026-11-03" }, { state: "FL", office: "us_senate", electionDate: "2026-11-03" }]);
});

function houseOverview(links: string): string {
  return `<h2><span id="Election_results,_2026">Election results, 2026</span></h2>
    <p>Democrats had won 248 and Republicans 150 of the 435 U.S. House races.</p><p>Republicans held a 218-214 majority.</p>
    <h2>Partisan balance</h2><table><caption>Partisan composition, U.S. House 119th Congress</caption>
    <tr><td>Democratic</td><td>214</td></tr><tr><td>Republican</td><td>218</td></tr>
    <tr><td>Independent</td><td>1</td></tr><tr><td>Vacancies</td><td>2</td></tr></table>${links}`;
}

test("source-owned federal catalog discovers states without held ballots and follows only valid current race URLs", () => {
  const html = houseOverview(`<a href="/Arizona%27s_1st_Congressional_District_election,_2026">Arizona</a>
    <a href="https://ballotpedia.org/Arizona&#39;s_1st_Congressional_District_election,_2026#Results">Duplicate</a>
    <a href="/United_States_House_of_Representatives_election_in_Alaska,_2026">Alaska at large</a>
    <a href="https://example.org/Arizona%27s_2nd_Congressional_District_election,_2026">Foreign</a>
    <a href="http://ballotpedia.org/Arizona%27s_2nd_Congressional_District_election,_2026">Insecure</a>
    <a href="/Arizona%27s_2nd_Congressional_District_special_election,_2026">Other-date special</a>
    <a href="/Arizona%27s_2nd_Congressional_District_election,_2024">Historical</a>`);
  const batch = parseBallotpediaCongressSummary(html, "us_house", now);
  assert.deepEqual(batch.racePages?.map(page => ({ state: page.state, district: page.districtHint })), [{ state: "AZ", district: "1" }, { state: "AK", district: "at-large" }]);
  assert.ok(batch.racePages?.every(page => page.office === "us_house" && page.electionDate === "2026-11-03" && page.url.startsWith("https://ballotpedia.org/")));
});

test("House discovery follows source-linked state indexes only when requested and keeps verified summaries on index failure", async () => {
  const main = houseOverview(`<a href="/United_States_House_of_Representatives_elections_in_Alabama,_2026">Alabama index</a>
    <a href="/United_States_House_of_Representatives_elections_in_Arizona,_2026">Arizona index</a>`);
  const calls: string[] = [], fetcher = (async url => {
    calls.push(String(url));
    if (String(url).includes("elections_in_Alabama")) return new Response(`<a href="/Alabama%27s_1st_Congressional_District_election,_2026">District 1</a>`);
    if (String(url).includes("elections_in_Arizona")) return new Response("Unavailable", { status: 503, headers: { "Retry-After": "60" } });
    return new Response(main);
  }) as typeof fetch;
  const cheap = await readBallotpediaCongressSummary("us_house", now, fetcher);
  assert.equal(calls.length, 1);
  assert.equal(cheap.racePages, undefined);
  calls.length = 0;
  const discovered = await readBallotpediaCongressSummary("us_house", now, fetcher, true);
  assert.equal(calls.length, 3);
  assert.equal(discovered.racePages?.length, 1);
  assert.equal(discovered.racePages?.[0].state, "AL");
  assert.equal(discovered.summaries[0].chambers[0].seatsNow.D, 248);
  assert.equal(discovered.catalogErrors?.length, 1);
  assert.match(discovered.catalogErrors![0].reason, /503.*Retry-After: 60/);
  assert.equal(discovered.evidence.text, main);
});
