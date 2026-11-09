import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RaceSummary } from "../components/ballot/contest-result.tsx";
import { guardResultFacts, type ContestResult } from "../lib/ballot/election-results.ts";
import { withCandidateTickets } from "../lib/ballot/tickets.ts";
import type { BallotSet, Candidacy } from "../lib/ballot/types.ts";
import { matchElectionResultAcrossBallots } from "../lib/election-results/matcher.ts";
import { publishElectionResultBatch } from "../lib/election-results/publisher.ts";
import { parseMultiStateResults } from "../lib/election-results/multistate.ts";
import { resultFactDb } from "./helpers/election-results.ts";

const AT = "2026-11-09T02:00:00.000Z", GOV = "ak-doe-2026-general-governor-lieutenant-governor";
const purge = async () => ({ purged: true });
const text = (node: unknown) => renderToStaticMarkup(node as never).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** MultiState's real AK race 7387 spelling: plain names, a write-in with no tally, a withdrawn candidate. */
const multistate = (extra: object[] = []) => JSON.stringify({ general_events: [{ state: "AK", statewide_races: [{ seat_id: 7387, office: "Governor", election_date: "2026-11-03", flipped_seat: { from: "R", to: "D" },
  general_results: { contests: [{ type: "General", election_id: 1, result_status: "Called", votes_pct_in: 73.81,
    candidates: [{ candidate_id: 19296, name: "Jonathan Kreiss-Tomkins", party: "D", votes: 103837, pct: 49.13, result: "Won" },
      { candidate_id: 125617, name: "Bernadette Wilson", party: "R", votes: 61734, pct: 29.21, result: "Lost" },
      { candidate_id: 125619, name: "Dave Bronson", party: "R", votes: 30003, pct: 14.2, result: "Lost" },
      { candidate_id: 132657, name: "Meda DeWitt", party: "NP", result: "Lost" },
      { candidate_id: 126, name: "James Parkin", party: "R", result: "Lost" }, ...extra] }] } }] }] });
const served = (): BallotSet => {
  const data = JSON.parse(readFileSync("data/ballot/2026-general/ak.json", "utf8")) as { ballots: Record<string, BallotSet> };
  const set = Object.values(data.ballots)[0];
  return withCandidateTickets({ ...set, contests: set.contests.filter(row => row.id === GOV), candidacies: set.candidacies.filter(row => row.contestId === GOV), measures: [] });
};

test("AK Governor tickets with quoted nicknames, middle initials and joint names match the plain names MultiState prints", () => {
  const race = parseMultiStateResults(multistate(), AT, "2026-11-03", "AK").races[0];
  const found = matchElectionResultAcrossBallots(race, [served()]);
  assert.equal(found.kind, "matched");
  if (found.kind !== "matched") return;
  const ids = found.candidates.map(row => race.candidates[row.resultIndex].name);
  assert.deepEqual(ids.sort(), ["Bernadette Wilson", "Dave Bronson", "James Parkin", "Jonathan Kreiss-Tomkins"]);
  assert.deepEqual(found.unmatchedCandidates.map(index => race.candidates[index].name), ["Meda DeWitt"]);
});

const feedFacts = (marker: boolean) => ({
  [GOV]: { status: "called", percentCounted: 73.81, flipped: true, gainedByParty: "D", incumbentLost: false, seatsToFill: 1,
    ...(marker ? { allCandidatesMatched: true } : {}), sources: [{ name: "MultiState", url: "https://multistate.example/results.json" }], checkedAt: AT,
    sourceId: "multistate", sourceRaceId: "7387", electionDate: "2026-11-03" },
  bronson: { votes: 30003, percent: 14.2, won: null, sources: [], checkedAt: AT, sourceId: "multistate", sourceRaceId: "7387", electionDate: "2026-11-03" },
  kreiss: { votes: 103837, percent: 49.13, won: true, sources: [], checkedAt: AT, sourceId: "multistate", sourceRaceId: "7387", electionDate: "2026-11-03" },
});
const card = (facts: Record<string, unknown>) => {
  const guarded = guardResultFacts(facts);
  const people = [["bronson", "Bronson"], ["kreiss", "Kreiss-Tomkins"]].map(([id, name]) => ({ id, familyName: name, result: guarded[id] as Candidacy["result"] }));
  return text(<RaceSummary contest={{ id: GOV, title: "Governor / Lieutenant Governor", ocdId: "ocd-division/country:us/state:ak", voteFor: 1, result: guarded[GOV] as ContestResult }}
    candidates={people} names={new Map(people.map(row => [row.id, row.familyName]))} />);
};

test("a contest fact without the completeness marker shows only its source: no leader, Won, Called or Flipped", () => {
  const html = card(feedFacts(false));
  assert.match(html, /Results from MultiState/);
  assert.doesNotMatch(html, /Leading so far|Won|Called|Flipped|Bronson|Kreiss/);
  const guarded = guardResultFacts(feedFacts(false));
  assert.equal((guarded.kreiss as { won?: boolean }).won, undefined, "no candidate keeps a win");
  assert.equal((guarded.bronson as { votes: number }).votes, 30003, "counts stay");
});

test("a contest fact marked complete is untouched and still shows its winner and flip", () => {
  const facts = feedFacts(true);
  assert.equal(guardResultFacts(facts), facts);
  assert.match(card(facts), /Won Kreiss-Tomkins.*Flipped.*Called/);
});

test("the publisher withholds the outcome while a vote-getter is unmatched, and replaces it once everyone matches", async context => {
  const db = await resultFactDb(context, "test-slide", { AK: "Alaska" });
  const full = served(), partial: BallotSet = { ...full, candidacies: full.candidacies.filter(row => /bronson/.test(row.id)) };
  const batch = parseMultiStateResults(multistate(), AT, "2026-11-03", "AK");
  const first = await publishElectionResultBatch({ db, query: db.query, batch, ballots: [partial], state: "AK", now: new Date(AT), purge });
  const read = async (id: string) => (await db.query("SELECT value FROM fact WHERE entity_id=$1 AND status='live'", [id]))[0]?.value as Record<string, unknown>;
  const held = await read(GOV);
  assert.equal(held.allCandidatesMatched, undefined);
  for (const field of ["flipped", "gainedByParty", "incumbentLost", "percentCounted"]) assert.equal(field in held, false, field);
  assert.equal(held.status, "counting");
  assert.equal((await read(partial.candidacies[0].id)).won, null);
  assert.match(JSON.stringify(await db.query("SELECT value FROM work WHERE kind='fix'")), /Candidate missing from served ballot/);

  const later = new Date("2026-11-12T00:00:00.000Z");
  await publishElectionResultBatch({ db, query: db.query, batch, ballots: [full], state: "AK", now: later, purge, prior: first.progress });
  const done = await read(GOV);
  assert.equal(done.allCandidatesMatched, true);
  assert.equal(done.status, "called");
  assert.equal(done.flipped, true);
  assert.equal((await read(full.candidacies.find(row => /kreiss/.test(row.id))!.id)).won, true);
});
