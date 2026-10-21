import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { renderCardWithSources } from "./helpers/render-card.ts";
import { answerVotingSites, type VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import { readGoogleVotingAnswer } from "../lib/sources/google-civic/reader-lookup.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/google-civic/${name}.json`, import.meta.url), "utf8");
const place: VotingReaderPlace = { precision: "ADDRESS", point: null, states: ["MI"], divisionIds: ["ocd-division/country:us/state:mi"], countyFips: [], countySubdivisionGeoids: [], towns: [], wards: [], aiannhGeoids: [], precincts: [] };
const now = () => "2026-10-12T23:13:00.000Z";

test("VS-01 voting reader renders held records without invoking the Google adapter", async () => {
  const held = await readGoogleVotingAnswer("public source sample", place, { apiKey: "test-key", now,
    fetchImpl: (async (url: URL) => new Response(fixture(url.pathname.endsWith("elections") ? "elections" : "mi-voterinfo"))) as unknown as typeof fetch });
  held.forEach(jurisdiction => { jurisdiction.ocdId = place.divisionIds[0]; jurisdiction.sites.forEach(site => { site.countyName = "Ingham"; }); });
  const previous = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Reader requested external election data"); };
  try {
    const answer = await answerVotingSites({ generatedAt: "2026-10-13", jurisdictions: held }, { ...place, countyNames: ["Ingham County"] });
    assert.equal(requests, 0);
    assert.equal(answer.googleFallback, undefined);
    const html = await renderCardWithSources({ modulePath: "./components/map/voting-sites-panel.tsx", exportName: "VotingJurisdictionRecords",
      props: { answer, selectedSiteId: null }, sourceUrls: [answer.jurisdictions[0].sourceUrl] });
    assert.match(html, /FIRST PRESBYTERIAN CHURCH/);
    assert.match(html, /510 W OTTAWA ST/);
    assert.match(html, /7 am - 8 pm/);
    assert.ok(!JSON.stringify(answer).includes("private address"));
  } finally { globalThis.fetch = previous; }
});

test("VS-01 Ask, ballot and retired endpoint cannot bypass explicit official-source fallback checks", () => {
  for (const file of ["app/api/ask/grounded/route.ts", "components/ask/ask-box.tsx", "components/ask/ballot-ask.tsx", "app/ballot/page.tsx"]) {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(code, /civicVoterAddress|readerCivicLookup|GoogleCivicAddressLookup|voterAddress/);
  }
  assert.equal(existsSync(new URL("../app/api/civic-voterinfo/route.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../lib/sources/google-civic/session.ts", import.meta.url)), false);
});
