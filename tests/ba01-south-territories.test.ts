import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { captureSha256 } from "../scripts/ba01-evidence.mts";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import type { BallotSet, Candidacy } from "../lib/ballot/types.ts";
import { ballotCandidateDisplayName } from "../lib/ballot/name-case.ts";
import { ballotCandidatePeople } from "../lib/ballot/tickets.ts";
import type { BallotWithTickets } from "../lib/ballot/tickets.ts";
import type { BallotWithDistrictMemberships } from "../lib/ballot/district-memberships.ts";
import type { ManualSourceSetReceipt } from "../lib/civic-data/types.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = `${root}data/ballot/evidence/ba01-south/territories/`;
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const state = (st: string): BallotSet => Object.values(json(`${root}data/ballot/2026-general/${st.toLowerCase()}.json`).ballots)[0] as BallotSet;
const base = (st: string) => `ocd-division/country:us/territory:${st.toLowerCase()}`;
const count = (set: BallotSet) => ({ contests: set.contests.length, choices: set.candidacies.length });

function assertOfficialTickets(set: BallotSet, choices: readonly Candidacy[], expectedCount: number) {
  const sourceTickets = set.candidateTickets!.filter(ticket => choices.some(choice =>
    choice.id === ticket.leadCandidacyId || choice.aliases?.includes(ticket.leadCandidacyId)));
  assert.equal(sourceTickets.length, expectedCount);
  for (const sourceTicket of sourceTickets) {
    const rawLead = set.candidacies.find(row => row.id === sourceTicket.leadCandidacyId)!;
    const selected = choices.filter(row => row.id === sourceTicket.leadCandidacyId || row.aliases?.includes(sourceTicket.leadCandidacyId));
    assert.equal(selected.length, 1, "each official ticket remains one choice");
    const choice = selected[0];
    assert.ok(choice.ticket);
    assert.equal(choice.ticket.id, sourceTicket.id);
    assert.equal(choice.ticket.runningMate.id, sourceTicket.runningMate.id);
    assert.notEqual(choice.id, choice.ticket.runningMate.id, "ticket members keep distinct person cards");
    const names = [ballotCandidateDisplayName(rawLead), ballotCandidateDisplayName(sourceTicket.runningMate)];
    assert.equal(ballotCandidateDisplayName(choice), names.join(" / "));
    assert.deepEqual(ballotCandidatePeople(choice).map(ballotCandidateDisplayName), names);
    assert.ok(sourceTicket.provenance.quote?.includes(names.join(" / ")), "both names are in the saved official pairing");
    assert.deepEqual(choice.ticket.provenance, sourceTicket.provenance);
  }
}

test("American Samoa's certified roster reaches only the reader's House district and every delegate candidate", () => {
  const set = state("AS");
  assert.deepEqual(count(set), { contests: 18, choices: 44 });
  const one = ballotForDivisions(set, [`${base("AS")}/sldl:1`]);
  assert.deepEqual(count(one), { contests: 2, choices: 11 });
  const fifteen = ballotForDivisions(set, [`${base("AS")}/sldl:15`]);
  assert.deepEqual(count(fifteen), { contests: 2, choices: 11 });
  assert.equal(one.candidacies.filter(row => row.contestId.endsWith("delegate")).length, 6);
  assert(one.contests.every(row => row.voteFor === null));
  assert(set.candidacies.every(row => row.partyLabel === null));
  assert(!set.contests.some(row => /senate|swains/i.test(row.title)));
});

test("CNMI reader selection matches all 13 official specimen fronts with explicit governor pairings", () => {
  const set = state("MP"), samples = json(`${evidence}mp-sample-comparison.json`);
  assert.deepEqual(count(set), { contests: 21, choices: 72 });
  for (const sample of samples.samplePrecincts) {
    const house = sample.precinct[0];
    const divisions = [`${base("MP")}/sldl:${house}`];
    // District 4 spans Saipan and Northern Islands. Only the Saipan fronts
    // supply that mayor's exact canonical electorate.
    if (house === "4" && sample.precinct !== "4D") divisions.push(`${base("MP")}/county:saipan`);
    const selected = ballotForDivisions(set, divisions);
    const missingNorthernIslands = sample.precinct === "4D";
    assert.deepEqual(count(selected), {
      contests: sample.contests - (missingNorthernIslands ? 1 : 0),
      choices: sample.choices - (missingNorthernIslands ? 2 : 0),
    }, `official specimen precinct ${sample.precinct}`);
    const governor = selected.contests.find(row => row.id === "mp-ba01-2026-governor")!;
    const tickets = selected.candidacies.filter(row => row.contestId === governor.id);
    assert.equal(tickets.length, 3);
    assertOfficialTickets(set, tickets, 3);
    const senate = selected.contests.find(row => /-senate-/.test(row.id))!;
    assert.equal(senate.voteFor, 2);
  }
  assert(!set.contests.some(row => row.id === "mp-ba01-2026-mayor-northern-islands"));
});

test("both Virgin Islands district samples have every printed choice and the exact elections-board electorate", () => {
  const set = state("VI"), samples = json(`${evidence}vi-sample-comparison.json`);
  assert.deepEqual(count(set), { contests: 10, choices: 70 });
  for (const [district, slug] of [["St. Croix", "st_croix"], ["St. Thomas/St. John", "st_thomas-st_john"]]) {
    const expected = samples.sampleDistricts[district];
    const selected = ballotForDivisions(set, [`${base("VI")}/sldu:${slug}`]);
    assert.deepEqual(count(selected), { contests: expected.contests, choices: expected.choices });
    const governor = selected.candidacies.filter(row => row.contestId === "vi-ba01-2026-governor");
    assert.equal(governor.length, 5);
    assertOfficialTickets(set, governor, 5);
    const board = selected.contests.filter(row => row.id.includes("board-of-elections"));
    assert.equal(board.length, district === "St. Croix" ? 1 : 2);
    assert(board.every(row => row.ocdId === `${base("VI")}/board_of_elections:${slug}`));
  }
  assert.deepEqual(samples.officialNameVariants.map((row: { sampleName: string }) => row.sampleName).sort(),
    ["Julian S. Viera", "Mustasem Moe Mustafa", "Kurt Vialet", "Franklin D. Johnson", "Eugene D. Farrell"].sort());
});

test("territorial candidate, ticket and membership facts retain their exact source capture receipts", () => {
  for (const st of ["AS", "MP", "VI"]) {
    const pack = json(`${root}data/ballot/2026-general/${st.toLowerCase()}.json`);
    const set = Object.values(pack.ballots)[0] as BallotWithTickets & BallotWithDistrictMemberships;
    const facts = [...set.contests, ...set.candidacies, ...set.districtMemberships ?? [],
      ...(set.candidateTickets ?? []).flatMap(ticket => [ticket, ticket.runningMate])];
    for (const row of facts) {
      const sourceUrl = row.provenance.sourceUrl;
      assert.ok(sourceUrl);
      const matching = pack.sourceReceipt.sources.filter((source: ManualSourceSetReceipt["sources"][number]) =>
        [source.requestedUrl, source.finalUrl].includes(sourceUrl) &&
        source.retrievedAt === row.provenance.collectedAt && source.reviewOutcome === "SUPPORTED");
      assert.equal(matching.length, 1, `${st} ${row.id}`);
      assert(row.provenance.quote);
    }
    assert(set.contests.every(row => row.ocdId.startsWith(`${base(st)}`)));
  }
  for (const name of ["as-candidates.html", "mp-candidates.html", "mp-sample.pdf", "vi-stx-sample.pdf", "vi-stt-stj-sample.pdf", "vi-board.html"]) {
    const metadata = json(`${evidence}${name}.source.json`);
    assert.equal(captureSha256(readFileSync(`${evidence}${name}`)), metadata.sha256);
    assert.equal(metadata.httpStatus, 200);
  }
});

test("Puerto Rico's next regular date and dated Cataño special do not create a November general contest", () => {
  const report = json(`${evidence}comparison.json`).find((row: { territory: string }) => row.territory === "PR");
  assert.equal(report.regularGeneralElectionDate, "2028-11-07");
  assert.equal(report.specialElection.date, "2026-09-27");
  assert.equal(existsSync(`${root}data/ballot/2026-general/pr.json`), false);
  assert.equal(existsSync(`${root}data/ballot/2026-general/gu.json`), false);
});
