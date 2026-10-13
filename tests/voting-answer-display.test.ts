import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VotingJurisdictionRecords, votingSources } from "../components/map/voting-sites-panel.tsx";
import { parseVotingCapture, votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import { projectVotingJurisdiction, type VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import type { VotingJurisdiction, VotingSitesAnswer } from "../lib/ballot/voting-sites.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

test("VS-01 official HTML tables become in-page hours, return rules, clerk contact and Sources", async () => {
  const source = { publisher: "North Dakota Secretary of State", url: "https://vip.sos.nd.gov/Precincts.aspx?eid=348", checkedAt: "2026-10-13" };
  const door: VotingSourceDoor = { id: "nd-official-table", publisher: source.publisher, url: source.url, shape: "list-page", covers: ["ELECTION_DAY", "DROP_BOX", "EARLY_VOTING"],
    scope: { state: "ND", ocdId: "ocd-division/country:us/state:nd", name: "North Dakota" }, electionDate: "2026-11-03", electionPageUrl: source.url,
    extraction: { format: "html", columns: { address: ["Address", "City", "Zip Code"] } } };
  const bytes = readFileSync(new URL("./fixtures/voting-sources/nd-2026-official-tables.html", import.meta.url));
  const parsed = votingRowsToSites(await parseVotingCapture({ url: source.url, bytes, contentType: "text/html" }, door), door, source);
  const j: VotingJurisdiction = { ocdId: door.scope.ocdId, state: "ND", name: "North Dakota", model: "UNKNOWN", election: "November 3, 2026", sites: parsed.sites,
    sourceUrl: source.url, sourceOrg: source.publisher, collectedAt: source.checkedAt, refusal: null };
  const place: VotingReaderPlace = { precision: "ZIP", point: null, divisionIds: [j.ocdId], states: ["ND"], countyFips: [], countyNames: ["Adams", "Barnes"], countySubdivisionGeoids: [], towns: [], wards: [], aiannhGeoids: [], precincts: [] };
  const answer: VotingSitesAnswer = { match: true, point: null, jurisdictions: [projectVotingJurisdiction(j, place)], outsideCoverage: false, pollingPlaceLinks: [] };
  const markup = renderToStaticMarkup(createElement(VotingJurisdictionRecords, { answer, selectedSiteId: null, onSelectSite: () => {} }));
  assert.match(markup, /Adams County Courthouse/);
  assert.match(markup, /9:00AM-7:00PM/);
  assert.match(markup, /north side of Courthouse entry available 24\/7/);
  assert.match(markup, /\(701\) 845-8500/);
  assert.match(markup, /Sources/);
  assert.doesNotMatch(markup, /data-polling-lookup-fallback/);
  const citations = votingSources(j);
  assert.ok(citations.some(citation => citation.provenance.sourceUrl === source.url));
});
