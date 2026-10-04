import assert from "node:assert/strict";
import test from "node:test";
import { applyManualEdit, checkDoorDraft } from "../lib/doors/registry.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { readFinanceDoor } from "../lib/funding/finance-door-reader.ts";
import { bindFinanceDoorFilings } from "../lib/funding/finance-door-bindings.ts";

const at = "2026-10-04T08:00:00Z";
const division = "ocd-division/country:us/state:oh/place:alder";
const provenance = { sourceUrl: "https://elections.example.gov/candidates", sourceOrg: "Fixture election authority", collectedAt: at, verifiedAt: null };
function ballot(): BallotSet {
  return { election: { id: "oh-fixture-election", state: "OH", date: "2026-11-03", name: "General election" },
    contests: [{ id: "ballot-contest:alder", electionId: "oh-fixture-election", ocdId: division,
      divisionVintage: "fixture", title: "Council", type: "CANDIDACY", voteFor: 1, termYears: null, scopeNote: null, provenance }],
    candidacies: [{ id: "ballot-candidacy:avery", contestId: "ballot-contest:alder", familyName: "Example", givenName: "Avery",
      partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance }], measures: [], absences: [] };
}
function read(extra = "", complete = true) {
  const draft = checkDoorDraft({ doorId: "finance:alder", kind: "campaign-finance-csv", ocdId: division,
    hosts: ["filings.example.gov"], config: { fieldMap: JSON.stringify({ committeeId: "Id", registeredName: "Name",
      candidateName: "Candidate", office: "Office", electionYear: "Cycle", reportId: "Report", period: "Period", receipts: "Raised", expenditures: "Spent" }) } });
  assert.ok(draft.ok);
  const door = applyManualEdit(null, draft.value, at);
  return readFinanceDoor(door, [{ url: "https://filings.example.gov/export", retrievedAt: at, complete,
    bytes: Buffer.from("Id,Name,Candidate,Office,Cycle,Report,Period,Raised,Spent\nC1,Friends of Avery,Avery Example,Council,2026,R1,January through June,1200,0\n" + extra) }]);
}

test("a new-place filing binds its reported period to the exact ballot candidate without summing periods", () => {
  const source = read("C1,Friends of Avery,Avery Example,Council,2026,R2,July through September,300,\n");
  const result = bindFinanceDoorFilings({ read: source,
    ballots: [ballot()], agency: "Fixture filing authority" });
  assert.equal(result.unbound.length, 0);
  assert.equal(result.bound.length, 2);
  assert.deepEqual(result.bound.map(row => row.record.targetKeys), [["ballot-candidacy:avery"], ["ballot-candidacy:avery"]]);
  assert.deepEqual(result.bound.map(row => row.record.totals.receipts), [1200, 300]);
  assert.equal(result.bound[1].record.totals.expenditures, null);
  assert.equal(result.bound[0].record.totals.cashOnHand, null);
  assert.equal(result.bound[0].record.match.allThreeAgree, true);
  assert.equal(result.bound[0].filing.sourceHash, source.captures[0].hash);
  assert.equal(result.bound[0].record.provenance.sourceUrl, "https://filings.example.gov/export");
});

test("a committee name, another office, another cycle or another jurisdiction never attaches its dollars", () => {
  const source = read();
  for (const fields of [{ candidateName: null }, { candidateName: "Different Person" }, { office: "Mayor" },
    { electionYear: 2028 }, { ocdId: "ocd-division/country:us/state:oh/place:birch" }]) {
    const changed = { ...source, filings: source.filings.map(row => ({ ...row, ...fields })) };
    const result = bindFinanceDoorFilings({ read: changed, ballots: [ballot()], agency: "Fixture filing authority" });
    assert.equal(result.bound.length, 0);
    assert.deepEqual(result.unbound, changed.filings, "unmatched source rows remain work, never disappear");
  }
});

test("unknown election dates, ambiguous candidates and incomplete captures stay unbound", () => {
  const known = ballot(), unknown = { ...known, election: { ...known.election, date: "" } };
  const ambiguous = { ...known, candidacies: [...known.candidacies, { ...known.candidacies[0], id: "another-person:same-filed-name" }] };
  for (const [source, ballots] of [[read(), [unknown]], [read(), [ambiguous]], [read("", false), [known]]] as const) {
    const result = bindFinanceDoorFilings({ read: source, ballots, agency: "Fixture filing authority" });
    assert.equal(result.bound.length, 0);
    assert.deepEqual(result.unbound, source.filings);
  }
});
