import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { coloradoRows, denverCountywideRows, maricopaCountywideRows, maricopaMeasure } from "../scripts/ba01-west-official-ballots.mts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { pimaGovernorTickets, pimaStatewideCourt } from "../scripts/ba01-west-az-core.mts";
import { denverGovernorTickets } from "../scripts/ba01-west-co-tickets.mts";
import { scottsdaleCountywideRows } from "../scripts/ba01-west-az-maricopa.mts";

const evidence = resolve(import.meta.dirname, "../data/ballot/ba01-west-evidence");
const state = (name: string) => Object.values((JSON.parse(readFileSync(resolve(import.meta.dirname,
  `../data/ballot/2026-general/${name}.json`), "utf8")) as { ballots: Record<string, BallotSet> }).ballots)[0];

test("every candidate in Colorado's official legislative table is in the same district's contest", () => {
  const rows = coloradoRows(readFileSync(resolve(evidence, "co-general-candidates.html"), "utf8"));
  const ballot = state("co"), offices = new Map([["State Senate", "sldu"], ["State House of Representatives", "sldl"]]);
  const legislative = rows.filter(row => offices.has(row[1]));
  assert.equal(legislative.length, 181);
  assert.equal(new Set(legislative.filter(row => row[1] === "State Senate").map(row => row[2])).size, 21);
  assert.equal(new Set(legislative.filter(row => row[1] === "State House of Representatives").map(row => row[2])).size, 65);
  for (const row of legislative) {
    const contest = ballot.contests.find(c => c.ocdId === `ocd-division/country:us/state:co/${offices.get(row[1])}:${row[2]}`);
    assert.ok(contest, `${row[1]} ${row[2]}`);
    assert.ok(ballot.candidacies.some(c => c.contestId === contest.id && `${c.givenName} ${c.familyName}` === row[0] &&
      c.partyLabel === row[3]), row.join(" | "));
  }
});

test("Maricopa countywide clerk race and each of 48 retention decisions preserve all printed candidates", () => {
  const rows = maricopaCountywideRows(readFileSync(resolve(evidence, "maricopa-candidates.txt"), "utf8"));
  assert.equal(rows.length, 50);
  assert.equal(rows.filter(row => row.seat).length, 48);
  const ballot = state("az"), contests = ballot.contests.filter(c => c.id.startsWith("az-maricopa-2026-") && c.type === "CANDIDACY");
  assert.equal(contests.length, 49);
  for (const row of rows) {
    const contest = contests.find(c => row.seat ? c.title === `${row.office}, Division ${row.seat} — Retention` : c.title === row.office);
    assert.ok(contest);
    assert.equal(contest.ocdId, "ocd-division/country:us/state:az/county:maricopa");
    assert.ok(ballot.candidacies.some(c => c.contestId === contest.id && `${c.familyName}, ${c.givenName}` === row.name &&
      c.partyLabel === row.party));
  }
  const clerk = contests.find(c => c.title === "Clerk of the Superior Court")!;
  const candidates = ballot.candidacies.filter(c => c.contestId === clerk.id);
  assert.equal(candidates.length, 2);
  assert.deepEqual(Object.keys(candidates[0]).sort(), Object.keys(candidates[1]).sort());
  assert.ok(candidates.every(c => c.websiteUrl === null && c.incumbent === null && c.slogan === null));
  // Precinct and special-district candidates remain owed until their actual reader divisions are resolved.
  assert.ok(contests.every(c => !/Justice of the Peace|Constable|College|Healthcare/.test(c.title)));
});

test("Maricopa Proposition 413 uses the published ballot format and explicit vote meanings", () => {
  const measure = maricopaMeasure(readFileSync(resolve(evidence, "maricopa-proposition-413.txt"), "utf8"));
  const ballot = state("az"), held = ballot.measures.find(row => row.contestId === "az-maricopa-2026-proposition-413");
  assert.ok(held);
  assert.equal(held.questionText, measure.questionText);
  assert.match(measure.questionText, /expiring in March 2027/);
  assert.match(measure.yesMeans, /approving a sales tax/);
  assert.match(measure.noMeans, /rejecting a sales tax/);
  assert.throws(() => maricopaMeasure("A proposal was discussed"));
});

test("Denver's sample ballot supplies all ten vacancy candidates, sixteen local retention decisions and five city measures", () => {
  const local = denverCountywideRows(readFileSync(resolve(evidence, "denver-sample-ballot.txt"), "utf8")), ballot = state("co");
  assert.equal(local.candidates.length, 26);
  assert.equal(local.candidates.filter(row => row.office === "Councilmember At-Large — Seat B").length, 10);
  assert.deepEqual(local.measures.map(row => row.number), ["2H", "2I", "2J", "2K", "311"]);
  const contests = ballot.contests.filter(row => row.id.startsWith("co-denver-2026-"));
  assert.equal(contests.length, 22);
  assert.ok(contests.every(row => row.ocdId === "ocd-division/country:us/state:co/county:denver"));
  for (const row of local.candidates) {
    const contest = contests.find(c => c.title === row.office);
    assert.ok(contest);
    const candidate = ballot.candidacies.find(c => c.contestId === contest.id && `${c.givenName} ${c.familyName}` === row.name);
    assert.ok(candidate);
    assert.equal(candidate.partyLabel, null);
  }
  for (const row of local.measures) assert.ok(ballot.measures.some(measure => measure.questionText === row.questionText));
  // District-specific offices and questions are kept out of a countywide match.
  assert.ok(contests.every(c => !/RTD|Transportation|4A|7A/.test(c.title)));
});

test("Pima's official general list supplies the statewide Supreme Court contest for every Arizona division", () => {
  const nominee = pimaStatewideCourt(readFileSync(resolve(evidence, "az-pima-general-candidates.txt"), "utf8"));
  const ballot = state("az"), contest = ballot.contests.find(c => c.id === "az-2026-general-supreme-court-john-lopez-iv");
  assert.ok(contest);
  assert.equal(contest.ocdId, "ocd-division/country:us/state:az");
  assert.match(contest.title, /John Lopez IV — Retention$/);
  const candidate = ballot.candidacies.find(c => c.contestId === contest.id);
  assert.ok(candidate);
  assert.equal(candidate.familyName, nominee.familyName);
  assert.equal(candidate.givenName, nominee.givenName);
  assert.equal(candidate.partyLabel, null);
});

test("Arizona joint tickets follow the explicit official pair order, including different-party pairs", () => {
  const pairs = pimaGovernorTickets(readFileSync(resolve(evidence, "az-pima-general-candidates.txt"), "utf8"));
  assert.deepEqual(pairs.map(pair => [pair.lead.name, pair.mate.name, pair.mate.partyLabel]), [
    ["KATIE HOBBS", "JOHN GILES", "PND"], ["ANDY BIGGS", "SINE KERR", "REP"],
    ["RISA LOMBARDO", "LISA CASTILLO", "GRN"], ["TERI ANN HOURIHAN", "ANGELA HARROLLE MOHAN", "PND"],
  ]);
  const ballot = state("az") as BallotSet & { candidateTickets: { leadCandidacyId: string; runningMate: { familyName: string; contestId: string; slogan: null; incumbent: null; websiteUrl: null } }[] };
  assert.equal(ballot.candidateTickets.length, 4);
  for (const ticket of ballot.candidateTickets) {
    const lead = ballot.candidacies.find(row => row.id === ticket.leadCandidacyId);
    assert.ok(lead);
    assert.equal(ticket.runningMate.contestId, lead.contestId);
    assert.equal(ticket.runningMate.slogan, null);
    assert.equal(ticket.runningMate.incumbent, null);
    assert.equal(ticket.runningMate.websiteUrl, null);
  }
  const lineup = (ballot as unknown as { generalLineup: { contests: { contestId: string; nominees: { name: string; note: string | null; partyLabel: string }[] }[] } }).generalLineup.contests
    .find(row => row.contestId === "ballot-az-pima:governor")!;
  assert.deepEqual(lineup.nominees.slice(0, 4).map(row => row.name), ["Katie Hobbs / John Giles", "Andy Biggs / Sine Kerr",
    "Risa Lombardo / Lisa Castillo", "Teri Ann Hourihan / Angela Harrolle Mohan"]);
  assert.deepEqual(lineup.nominees.slice(4).map(row => row.name), ["Gertritrude Gonzalez", "Alice Novoa"]);
  assert.equal(lineup.nominees[0].partyLabel, "Democratic / PND");
  assert.equal(lineup.nominees[3].partyLabel, "No Labels / PND");
  assert.ok(lineup.nominees.slice(4).every(row => row.note === "Qualified write-in candidate."));
});

test("Scottsdale's official sample adds all eight Maricopa appeals retentions and both countywide college nominees", () => {
  const rows = scottsdaleCountywideRows(readFileSync(resolve(evidence, "az-scottsdale-sample.txt"), "utf8"));
  const ballot = state("az");
  assert.equal(rows.length, 10);
  const contests = ballot.contests.filter(contest => contest.id.startsWith("az-maricopa-general-2026-"));
  assert.equal(contests.length, 9);
  for (const row of rows) {
    const contest = contests.find(contest => contest.title === row.title);
    assert.ok(contest);
    assert.equal(contest.ocdId, "ocd-division/country:us/state:az/county:maricopa");
    const candidate = ballot.candidacies.find(candidate => candidate.contestId === contest.id && `${candidate.familyName}, ${candidate.givenName}` === row.name);
    assert.ok(candidate);
    assert.equal(candidate.partyLabel, null);
  }
});

test("Colorado joint tickets use every explicitly printed Denver pair and reuse existing mate identities", () => {
  const pairs = denverGovernorTickets(readFileSync(resolve(evidence, "denver-sample-ballot.txt"), "utf8"));
  assert.deepEqual(pairs.map(pair => [pair.lead, pair.mate]), [["Victor Marx", "George Washington Markert"],
    ["Phil Weiser", "Lesley Dahlkemper"], ["Stephen T. Hamilton", "James K Treibert"], ["Eric Mulder", "Wayne Harlos"],
    ["Jeff Peckman", "T.J. Cole"], ["Erik Underwood", "Frank Atwood"], ["Greg Lopez", "Taralyn Romero"]]);
  const ballot = state("co") as BallotSet & { candidateTickets: { leadCandidacyId: string; runningMate: { id: string; contestId: string } }[] };
  assert.equal(ballot.candidateTickets.length, 7);
  for (const ticket of ballot.candidateTickets) {
    const lead = ballot.candidacies.find(candidate => candidate.id === ticket.leadCandidacyId);
    assert.ok(lead);
    assert.ok(ballot.candidacies.some(candidate => candidate.id === ticket.runningMate.id && candidate.contestId === "co-sos-2026-general-lt-governor-state"));
    assert.equal(ticket.runningMate.contestId, lead.contestId);
  }
});
