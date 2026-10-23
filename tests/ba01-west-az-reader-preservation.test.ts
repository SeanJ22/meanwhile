import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import { getProvisionTargetIds } from "../lib/ballot/measure-provisions.ts";
import { measureRecordsForBallot } from "../lib/ballot/measure-records.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { LineupReconciliation, LineupReconciliationRow } from "../lib/identity/types.ts";
import { pimaGovernorTickets, reconcileArizonaGovernorTickets } from "../scripts/ba01-west-az-core.mts";

const ballot = Object.values(JSON.parse(readFileSync("data/ballot/2026-general/az.json", "utf8")).ballots)[0] as BallotSet;
const baseline = JSON.parse(readFileSync("data/ballot/ba01-west-evidence/az-reader-baseline.json", "utf8")) as {
  contests: { id: string; hash: string }[]; candidacyIds: string[];
  measures: { id: string; hash: string }[]; measureRecords: { id: string; hash: string }[];
  tucsonContestIds: string[];
  governorReconciliationRows: LineupReconciliationRow[];
};
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, row]) => [key, stable(row)]));
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const additions = ["ballot-az-2026-general-supreme-court-john-lopez-iv", "ballot-az-pima-general-2026-clerk-of-the-superior-court"];

test("Arizona retains every one of the 91 pre-BA-01 contests and every prior candidacy identity", () => {
  assert.equal(baseline.contests.length, 91);
  for (const row of baseline.contests) assert.equal(hash(ballot.contests.find(contest => contest.id === row.id)), row.hash, row.id);
  for (const id of baseline.candidacyIds) assert.ok(ballot.candidacies.some(candidate => candidate.id === id), id);
  for (const row of baseline.measures) assert.equal(hash(ballot.measures.find(measure => measure.id === row.id)), row.hash, row.id);
});

test("Tucson retains all 22 earlier contest IDs and both additional officially verified races", () => {
  const base = "ocd-division/country:us/state:az";
  const selected = ballotForDivisions(ballot, [base, `${base}/county:pima`, `${base}/place:tucson`, `${base}/cd:7`, `${base}/sldu:20`, `${base}/sldl:20`]);
  const ids = new Set(selected.contests.map(contest => contest.id));
  assert.equal(baseline.tucsonContestIds.length, 22);
  for (const id of [...baseline.tucsonContestIds, ...additions]) assert.ok(ids.has(id), id);
  for (const id of additions) {
    const contest = selected.contests.find(contest => contest.id === id)!;
    assert.ok(contest.provenance.sourceUrl && contest.provenance.quote);
    assert.equal(selected.candidacies.filter(candidate => candidate.contestId === id).length, 1);
  }
});

test("raw official Arizona questions preserve vote meanings separately from all 15 reviewed summaries and 52 reaction targets", () => {
  const reviewed = measureRecordsForBallot(ballot);
  assert.equal(reviewed.length, 15);
  assert.equal(getProvisionTargetIds(reviewed).size, 52);
  for (const row of baseline.measureRecords) assert.equal(hash(ballot.measureRecords!.find(record => record.contestId === row.id)), row.hash, row.id);
  for (const id of ["az-maricopa-2026-proposition-413", "az-peoria-general-2026-proposition-417", "az-tempe-general-2026-proposition-424"]) {
    const measure = ballot.measures.find(measure => measure.contestId === id)!;
    assert.ok(measure.questionText && measure.officialStatement, id);
    assert.match(measure.officialStatement, /YES/i);
    assert.match(measure.officialStatement, /NO/i);
    assert.equal(measure.provenance.quote, `${measure.questionText}\n${measure.officialStatement}`);
    assert.ok(!reviewed.some(record => record.contestId === id), `${id} has official ballot words, without a reviewed plain-English summary`);
  }
});

test("all four explicit governor tickets retain old lead-card identity and the complete superseded party evidence", () => {
  const bridge = ballot.lineupReconciliation as LineupReconciliation & {
    supersededRows: { row: LineupReconciliationRow; supersededBy: { sourceUrl: string; quote: string } }[];
  };
  const source = JSON.parse(readFileSync("data/ballot/ba01-west-evidence/sources.json", "utf8"))
    .find((row: { file: string }) => row.file === "az-pima-general-candidates.txt");
  const pairs = pimaGovernorTickets(readFileSync("data/ballot/ba01-west-evidence/az-pima-general-candidates.txt", "utf8"));
  const original = baseline.governorReconciliationRows;
  for (const previous of original) {
    if (previous.outcome === "PARTY_CONFLICT") {
      const history = bridge.supersededRows.find(history => history.row.cardKey === previous.cardKey)!;
      assert.deepEqual(history.row, previous);
      assert.equal(history.supersededBy.sourceUrl, source.sourceUrl);
      assert.match(history.supersededBy.quote, /NOL\s+HOURIHAN, TERI ANN/);
    } else assert.deepEqual(bridge.rows.find(row => row.cardKey === previous.cardKey), previous);
  }
  const tickets = ballot.generalLineup!.contests.find(row => row.contestId === "ballot-az-pima:governor")!.nominees.filter(row => row.name.includes(" / "));
  assert.equal(tickets.length, 4);
  for (const ticket of tickets) {
    const oldKey = `ballot-az-pima:governor|${ticket.name.split(" / ")[0]}`;
    const old = bridge.rows.find(row => row.cardKey === oldKey)!;
    const current = bridge.rows.find(row => row.cardKey === `ballot-az-pima:governor|${ticket.name}`)!;
    assert.equal(current.outcome, "RECONCILED");
    assert.equal(current.canonicalCandidacyId, old.canonicalCandidacyId);
    assert.ok(ballot.candidacies.some(row => row.id === current.canonicalCandidacyId));
  }
  const replay = structuredClone(ballot);
  reconcileArizonaGovernorTickets(replay, pairs, { sourceUrl: source.sourceUrl, sourceOrg: "Pima County Elections Department",
    collectedAt: source.retrievedAt, verifiedAt: source.retrievedAt });
  assert.deepEqual(replay, ballot, "replaying the official pairs preserves every reader and historical identity");
  assert.equal(bridge.proof.lineupNominees, 40);
  assert.equal(bridge.proof.duplicateTargetCollisions, 0);
});
