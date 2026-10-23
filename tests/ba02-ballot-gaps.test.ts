import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { genericBallotProblems, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import { withCandidateTickets } from "../lib/ballot/tickets.ts";
import { divisionsWithDistrictMemberships } from "../lib/ballot/district-memberships.ts";
import { indexedZipDivisionEntry } from "../lib/geo/zip-division-index.ts";
import { unestablishedDistrictOfficesForFamilies } from "../lib/ballot/zip-divisions.ts";
import type { Provenance } from "../lib/sources/types.ts";

type StateInput = GenericBallotProjection & { sourceReceipt: { sources: { requestedUrl: string; finalUrl: string; retrievedAt: string; rawHash: string }[] } };
const stateInput = async (state: string): Promise<StateInput> => ({ ...JSON.parse(await readFile(`data/ballot/2026-general/${state.toLowerCase()}.json`, "utf8")), kind: "ballot-contests" });
const counts = { AK: 1, AZ: 13, CO: 7, FL: 23, ID: 33, KS: 63, MO: 1, MT: 10, NM: 43, WY: 3, MP: 1 };

function assertReceipt(input: StateInput, provenance: Provenance) {
  assert.ok(input.sourceReceipt.sources.some(row => [row.requestedUrl, row.finalUrl].includes(provenance.sourceUrl ?? "") &&
    row.retrievedAt === provenance.collectedAt && /^[a-f0-9]{64}$/.test(row.rawHash)), `Saved source observation for ${provenance.sourceUrl}`);
}

test("BA-02: all 198 requested retention questions keep their official source through division selection", async () => {
  let total = 0;
  for (const [state, expected] of Object.entries(counts)) {
    const input = await stateInput(state);
    assert.deepEqual(genericBallotProblems(input, state), []);
    const rows = Object.values(input.ballots).flatMap(ballot => ballot.contests.filter(contest => contest.type === "RETENTION"));
    assert.equal(rows.length, expected, state);
    for (const contest of rows) {
      const question = contest.retentionQuestion;
      assert.ok(question, contest.id);
      assert.ok(question.questionText.trim(), contest.id);
      assert.equal(contest.voteFor, 1, contest.id);
      assertReceipt(input, question.provenance);
      const ballot = Object.values(input.ballots).find(row => row.election.id === contest.electionId)!;
      const selected = ballotForDivisions(ballot, [contest.ocdId]);
      assert.deepEqual(selected.contests.find(row => row.id === contest.id)?.retentionQuestion, question);
    }
    total += rows.length;
  }
  assert.equal(total, 198);
});

test("BA-02: every SC and AS published race has sourced voting instructions", async () => {
  for (const [state, expected] of [["SC", 298], ["AS", 18]] as const) {
    const input = await stateInput(state);
    assert.deepEqual(genericBallotProblems(input, state), []);
    const contests = Object.values(input.ballots).flatMap(ballot => ballot.contests);
    assert.equal(contests.length, expected, state);
    for (const contest of contests) {
      assert.ok(Number.isInteger(contest.voteFor) && contest.voteFor! > 0, contest.id);
      assert.ok(contest.voteForSources?.length, contest.id);
      for (const source of contest.voteForSources) assertReceipt(input, source);
    }
  }
});

test("BA-02: Guam keeps the official joint ticket and every printed contest", async () => {
  const input = await stateInput("GU");
  assert.deepEqual(genericBallotProblems(input, "GU"), []);
  const ballot = withCandidateTickets(Object.values(input.ballots)[0]);
  assert.equal(ballot.election.date, "2026-11-03");
  assert.equal(ballot.contests.length, 6);
  const governor = ballot.contests.find(row => /Governor/.test(row.title))!;
  const tickets = ballot.candidacies.filter(row => row.contestId === governor.id);
  assert.equal(tickets.length, 2);
  assert.ok(tickets.every(row => row.familyName.includes(" / ")));
  for (const office of [/Lieutenant Governor/, /House of Representatives/, /Legislature/, /Attorney General/, /Utilities/, /Education/])
    assert.ok(ballot.contests.some(row => office.test(row.title)), String(office));
});

test("BA-02: official AS House memberships fill the district gap for real ZIP 96799", async () => {
  const input = await stateInput("AS"), ballot = Object.values(input.ballots)[0];
  const indexed = await indexedZipDivisionEntry("96799");
  assert.ok(indexed);
  const divisions = [...divisionsWithDistrictMemberships(ballot, indexed.ids)];
  assert.equal(divisions.filter(id => /\/sldl:\d+$/.test(id)).length, 17);
  assert.deepEqual(unestablishedDistrictOfficesForFamilies(["as/sldl"], divisions), []);
});

test("BA-02: Puerto Rico's source-backed no-election statement is a publishable ballot on its own", async () => {
  const input = await stateInput("PR");
  assert.deepEqual(genericBallotProblems(input, "PR"), []);
  const ballot = Object.values(input.ballots)[0];
  assert.deepEqual(ballot.contests, []);
  const selected = ballotForDivisions(ballot, ["ocd-division/country:us/territory:pr"]);
  assert.equal(selected.absences.length, 1);
  assert.match(selected.absences[0].statement, /no general election on November 3, 2026/);
  assert.match(selected.absences[0].statement, /November 7, 2028/);
  assert.match(selected.absences[0].provenance.sourceOrg, /Comisión Estatal de Elecciones/);
  assertReceipt(input, selected.absences[0].provenance);
});
