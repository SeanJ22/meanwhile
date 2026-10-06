import assert from "node:assert/strict";
import test from "node:test";
import type { BallotSet } from "../lib/ballot/types.ts";
import { applyManualEdit, checkDoorDraft } from "../lib/doors/registry.ts";
import { campaignFinanceProvider } from "../lib/control-plane/scheduler/providers/campaign-finance.ts";
import { ballotFinanceObligations } from "../lib/control-plane/campaign-finance/obligations.ts";
const at = "2026-10-05T23:00:00Z";
function ballot(state: string): BallotSet {
  const ocdId = `ocd-division/country:us/state:${state.toLowerCase()}/place:alder`;
  const provenance = { sourceUrl: "https://elections.example.gov/candidates", sourceOrg: "Fixture election authority", collectedAt: at, verifiedAt: at };
  return { election: { id: `election:${state}`, state, date: "2026-11-03", name: "General election" },
    contests: [{ id: `contest:${state}`, electionId: `election:${state}`, ocdId, divisionVintage: "fixture", title: "Council", type: "CANDIDACY", voteFor: 1,
      termYears: null, scopeNote: null, provenance }],
    candidacies: [{ id: `candidate:${state}`, contestId: `contest:${state}`, familyName: "Example", givenName: "Avery", partyLabel: null, slogan: null,
      incumbent: null, websiteUrl: null, provenance }], measures: [], absences: [] };
}
function door(ocdId: string) {
  const checked = checkDoorDraft({ doorId: "finance:alder", kind: "campaign-finance-csv", ocdId, hosts: ["filings.example.gov"],
    config: { routeDescriptors: JSON.stringify([{ routeId: "export", label: "Official filing export", executorClass: "DETERMINISTIC",
      executorReason: "Registered official export method", open: { kind: "HTTP_GET", url: "https://filings.example.gov/export" },
      citation: "Official filed export method held in Bank" }]) } });
  assert.ok(checked.ok);
  return applyManualEdit(null, checked.value, at);
}
test("the existing provider enumerates finance from each fresh admitted ballot and door data, with stable candidate work", () => {
  let held = ballot("OH");
  const provider = campaignFinanceProvider(() => ({ ballots: [held, ballot("MI")], admittedDivisions: [held.contests[0].ocdId], doors: [door(held.contests[0].ocdId)] }));
  const first = provider.enumerate({ root: process.cwd(), nowIso: at });
  assert.deepEqual(first.obligations.map(row => row.subjectId), ["candidate:OH"]);
  assert.equal(first.readFailure, null);
  assert.equal(first.obligations[0].routes[0].open.kind, "HTTP_GET");
  const stable = provider.scheduledId(first.obligations[0], first.obligations[0].routes[0]);
  held = { ...held, candidacies: held.candidacies.map(row => ({ ...row, givenName: "Avery A." })) };
  const renamed = provider.enumerate({ root: process.cwd(), nowIso: at });
  assert.equal(provider.scheduledId(renamed.obligations[0], renamed.obligations[0].routes[0]), stable);
  held = ballot("TX");
  assert.deepEqual(provider.enumerate({ root: process.cwd(), nowIso: at }).obligations.map(row => row.subjectId), ["candidate:TX"], "no deploy or named-place list is needed");
});
test("an unregistered finance source stays discovery work; conflicting candidate identities do not pick a first ballot", () => {
  const held = ballot("OH");
  const input = { ballots: [held], admittedDivisions: [held.contests[0].ocdId], doors: [] };
  const unregistered = ballotFinanceObligations(input);
  assert.equal(unregistered.obligations.length, 1);
  assert.equal(unregistered.obligations[0].routes[0].open.kind, "NOT_MACHINE_EXECUTABLE");
  assert.doesNotMatch(JSON.stringify(unregistered), /no reports|\$0|no campaign money/);
  const changed = { ...held, candidacies: held.candidacies.map(row => ({ ...row, familyName: "Someone else" })) };
  const conflict = ballotFinanceObligations({ ...input, ballots: [held, changed] });
  assert.equal(conflict.obligations.length, 0);
  assert.match(conflict.readFailure!, /conflicting ballot identities/);
});
