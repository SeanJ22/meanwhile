import "./helpers/linking-copies.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { votingSources } from "../components/map/voting-sites-panel.tsx";
import { renderCardWithSources } from "./helpers/render-card.ts";
import { parseVotingCapture, votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import { projectVotingJurisdiction, type VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import type { VotingJurisdiction, VotingSitesAnswer } from "../lib/ballot/voting-sites.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

test("VS-01 official ballot-return rows become in-page hours, return rules, clerk contact and Sources", async () => {
  const source = { publisher: "North Dakota Secretary of State", url: "https://vip.sos.nd.gov/Precincts.aspx?eid=348", checkedAt: "2026-10-13" };
  const door: VotingSourceDoor = { id: "nd-official-table", publisher: source.publisher, url: source.url, shape: "list-page", covers: ["ELECTION_DAY", "DROP_BOX", "EARLY_VOTING"],
    scope: { state: "ND", ocdId: "ocd-division/country:us/state:nd", name: "North Dakota" }, electionDate: "2026-11-03", electionPageUrl: source.url,
    extraction: { format: "html", columns: { address: ["Address", "City", "Zip Code"] } } };
  const bytes = readFileSync(new URL("./fixtures/voting-sources/nd-2026-official-tables.html", import.meta.url));
  const parsed = votingRowsToSites(await parseVotingCapture({ url: source.url, bytes, contentType: "text/html" }, door), door, source);
  const j: VotingJurisdiction = { ocdId: door.scope.ocdId, state: "ND", name: "North Dakota", model: "UNKNOWN", election: "November 3, 2026", sites: parsed.sites,
    sourceUrl: source.url, sourceOrg: source.publisher, collectedAt: source.checkedAt, refusal: null };
  const place: VotingReaderPlace = { precision: "ZIP", point: null, divisionIds: [j.ocdId], states: ["ND"], countyFips: [], countyNames: ["Adams", "Barnes"], countySubdivisionGeoids: [], towns: [], wards: [], aiannhGeoids: [], precincts: [] };
  const answer: VotingSitesAnswer = { match: true, point: null, jurisdictions: [projectVotingJurisdiction(j, place)], outsideCoverage: false };
  const markup = await renderCardWithSources({ modulePath: "./components/map/voting-sites-panel.tsx", exportName: "VotingJurisdictionRecords",
    props: { answer, selectedSiteId: null }, sourceUrls: [source.url] });
  assert.match(markup, /Adams County Courthouse/);
  assert.match(markup, /Available 24 hours per day/);
  assert.doesNotMatch(markup, /9:00AM-7:00PM/);
  assert.match(markup, /north side of Courthouse entry available 24\/7/);
  assert.match(markup, /\(701\) 845-8500/);
  assert.match(markup, /Sources/);
  assert.equal((markup.match(/data-card-gap=/g) ?? []).length, 0, "existing sites do not carry a missing-information message");
  assert.doesNotMatch(markup, /working on getting this info/i);
  assert.doesNotMatch(markup, /Still gathering/);
  const citations = votingSources(j);
  assert.ok(citations.some(citation => citation.provenance.sourceUrl === source.url));
});

test("VS-01 a held primary CSV never stands in for the reader's November polling place", async () => {
  const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
  const door = doors.find(item => item.id === "nc-statewide-polling-primary-2026")!;
  const source = { publisher: door.publisher, url: door.url, title: door.title, lastUpdated: door.fileUpdatedAt, checkedAt: "2026-10-13" };
  const bytes = readFileSync(new URL("./fixtures/voting-sources/nc-polling-place-20260303-native.csv.bin", import.meta.url));
  const rows = await parseVotingCapture({ url: door.url, bytes, contentType: "application/octet-stream" }, door);
  const parsed = votingRowsToSites(rows, door, source);
  const place: VotingReaderPlace = { precision: "ZIP", point: null, divisionIds: [door.scope.ocdId], states: [door.scope.state], countyFips: ["37001"], countyNames: ["Alamance"], countySubdivisionGeoids: [], towns: [], wards: [], aiannhGeoids: [], precincts: [] };
  const j: VotingJurisdiction = { ...door.scope, model: "UNKNOWN", election: null, electionDate: door.electionDate, sites: parsed.sites,
    sourceUrl: door.url, sourceOrg: door.publisher, collectedAt: source.checkedAt, refusal: null };
  const projected = projectVotingJurisdiction(j, place);
  assert.ok(parsed.sites.length > 0, "the source remains held");
  assert.ok(parsed.sites.every(site => site.election === "03/03/2026" && !site.electionDate));
  assert.equal(projected.sites.length, 0, "unassigned archive rows are withheld from the polling-place answer");
  assert.doesNotMatch(projected.modelSentence, /listed below/i);
  assert.ok(votingSources(j).some(citation => citation.updatedAt === door.fileUpdatedAt));

  // A current official election-page association is authoritative even when
  // the linked file carries an earlier publisher label or modification date.
  const associated = votingRowsToSites(rows, { ...door, electionAssociationVerified: true }, source);
  assert.ok(associated.sites.every(site => site.election === "03/03/2026" && site.electionDate === "2026-11-03"));
  assert.equal(projectVotingJurisdiction({ ...j, sites: associated.sites }, place).sites.length, 0,
    "a current election association still cannot assign a ZIP to a precinct");
});
