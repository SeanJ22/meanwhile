import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { renderCardWithSources } from "./helpers/render-card.ts";
import { answerVotingSites, type VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import { readGoogleVotingAnswer } from "../lib/sources/google-civic/reader-lookup.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/google-civic/${name}.json`, import.meta.url), "utf8");
const place: VotingReaderPlace = { precision: "ADDRESS", point: null, states: ["MI"], divisionIds: ["ocd-division/country:us/state:mi"], countyFips: [], countySubdivisionGeoids: [], towns: [], wards: [], aiannhGeoids: [], precincts: [] };
const now = () => "2026-10-12T23:13:00.000Z";

test("VS-01 explicit Google fallback uses the shared real-response parser and renders locations on our page", async () => {
  const requests: URL[] = [];
  const answer = await answerVotingSites({ generatedAt: "2026-10-13", jurisdictions: [] }, place,
    { readerRequested: true, googleRequested: true, address: "100 North Capitol Avenue, Lansing, MI 48933" }, {
      readGoogle: (address, resolved) => readGoogleVotingAnswer(address, resolved, { apiKey: "private-test-key", now,
        fetchImpl: (async (url: URL) => { requests.push(url); return new Response(fixture(url.pathname.endsWith("elections") ? "elections" : "mi-voterinfo")); }) as unknown as typeof fetch }),
    });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].searchParams.get("electionId"), "12000");
  assert.equal(answer.googleFallback?.label, "from Google's election data (Voting Information Project)");
  const html = await renderCardWithSources({ modulePath: "./components/map/voting-sites-panel.tsx", exportName: "VotingJurisdictionRecords",
    props: { answer, selectedSiteId: null }, sourceUrls: [answer.jurisdictions[0].sourceUrl] });
  assert.match(html, /FIRST PRESBYTERIAN CHURCH/);
  assert.match(html, /510 W OTTAWA ST/);
  assert.match(html, /7 am - 8 pm/);
  assert.match(html, /Sources/);
  assert.ok(!html.includes("100 North Capitol Avenue"));
  assert.ok(!JSON.stringify(answer).includes("private-test-key"));
});

test("VS-01 official locations suppress Google even if a caller requests the fallback", async () => {
  let sent = 0;
  const google = await readGoogleVotingAnswer("public source sample", place, { apiKey: "test-key", now,
    fetchImpl: (async (url: URL) => new Response(fixture(url.pathname.endsWith("elections") ? "elections" : "mi-voterinfo"))) as unknown as typeof fetch });
  const official = { ...google[0], ocdId: place.divisionIds[0], sourceOrg: "Michigan election office", sourceUrl: "https://www.michigan.gov/sos",
    countyFips: undefined, sites: google[0].sites.map(site => ({ ...site, countyName: "Ingham" })) };
  const answer = await answerVotingSites({ generatedAt: "2026-10-13", jurisdictions: [official] }, { ...place, countyNames: ["Ingham County"] },
    { readerRequested: true, googleRequested: true, address: "private address" }, { readGoogle: async () => { sent++; return google; } });
  assert.equal(sent, 0);
  assert.equal(answer.googleFallback?.requested, false);
});

test("VS-01 Ask, ballot and retired endpoint cannot bypass explicit official-source fallback checks", () => {
  for (const file of ["app/api/ask/grounded/route.ts", "components/ask/ask-box.tsx", "components/ask/ballot-ask.tsx", "app/ballot/page.tsx"]) {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(code, /civicVoterAddress|readerCivicLookup|GoogleCivicAddressLookup|voterAddress/);
  }
  assert.equal(existsSync(new URL("../app/api/civic-voterinfo/route.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../lib/sources/google-civic/session.ts", import.meta.url)), false);
});
