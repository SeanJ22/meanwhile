import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { GoogleCivicResults } from "../components/ballot/google-civic-results.tsx";
import { VotingJurisdictionRecords, civicVotingPins } from "../components/map/voting-sites-panel.tsx";
import { civicLookupFromRaw } from "../lib/sources/google-civic/model.ts";

const lookup = civicLookupFromRaw(readFileSync(new URL("./fixtures/google-civic/mi-voterinfo.json", import.meta.url), "utf8"), "12000", "2026-10-12T23:13:00.000Z");
test("every Google Civic fact has one bottom Sources disclosure, real candidate/site words, and no echoed input address", () => {
  const html = renderToStaticMarkup(<GoogleCivicResults lookup={lookup} />);
  assert.equal((html.match(/>Sources</g) ?? []).length, lookup.rows.length + 1);
  assert.match(html, /Jocelyn Benson/);
  assert.match(html, /FIRST PRESBYTERIAN CHURCH/);
  assert.match(html, /Candidate name not supplied/);
  assert.match(html, /Official government source/);
  assert.match(html, /Publication date not supplied/);
  assert.ok(!html.includes("100 North Capitol Avenue"));
});
test("voting-sites renders Google results beside an intact certified jurisdiction", () => {
  const html = renderToStaticMarkup(<VotingJurisdictionRecords answer={{ googleCivic: lookup, match: true, point: null,
    outsideCoverage: false, pollingPlaceLinks: [], jurisdictions: [{ ocdId: "ocd-division/country:us/state:mi", name: "Certified Michigan sample",
      state: "MI", model: "ASSIGNED", modelSentence: "Your election office's certified locations.", election: "2026 General Election",
      sourceOrg: "Michigan election office", sourceUrl: "https://www.michigan.gov/sos", collectedAt: "2026-10-12", sites: [],
      refusal: null, refusalLine: null, narrowing: { kind: "NOT_NEEDED", sentence: "See your certified list." } }] }}
    selectedSiteId={null} onSelectSite={() => {}} />);
  assert.match(html, /Google Civic results/);
  assert.match(html, /Certified Michigan sample/);
  assert.match(html, /certified locations/);
});

test("source coordinates create voting pins while unplaced source sites stay in the result", () => {
  const pins = civicVotingPins(lookup);
  assert.ok(pins.length > 0);
  assert.ok(pins.every(pin => lookup.rows.some(row => row.id === pin.id && row.kind !== "CONTEST")));
  const unplaced = { ...lookup, rows: lookup.rows.map(row => ({ ...row, value: { ...row.value, latitude: null } })) };
  assert.equal(civicVotingPins(unplaced).length, 0);
  assert.equal(unplaced.rows.length, lookup.rows.length);
});
