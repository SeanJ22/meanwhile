import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { pollingLookupFallbacks } from "../lib/ballot/polling-lookup-fallback.ts";
import { POLLING_PLACE_LINKS } from "../lib/ballot/polling-place-links.ts";
import type { VotingSitesAnswer } from "../lib/ballot/voting-sites.ts";

test("official voting lookup fallback preserves unavailable versus resolved jurisdictions on both surfaces", () => {
  assert.deepEqual(pollingLookupFallbacks("idle"), []);
  assert.deepEqual(pollingLookupFallbacks("asking"), []);
  assert.deepEqual(pollingLookupFallbacks("failed"), [], "a failed canonical read must not reopen the tracked first seed");
  assert.deepEqual(pollingLookupFallbacks("answered", {
    match: true,
    point: null,
    outsideCoverage: true,
    jurisdictions: [],
    pollingPlaceLinks: POLLING_PLACE_LINKS,
  }), POLLING_PLACE_LINKS);
  for (const link of POLLING_PLACE_LINKS) {
    const answer = {
      match: true,
      point: null,
      outsideCoverage: false,
      jurisdictions: [{ state: link.state, sites: [{ id: "held:site" }], refusal: null, narrowing: { kind: "EXACT" } }],
      pollingPlaceLinks: POLLING_PLACE_LINKS,
    } as unknown as VotingSitesAnswer;
    assert.deepEqual(pollingLookupFallbacks("answered", answer), [], "an exact held answer must not grow a duplicate handoff");
    answer.jurisdictions[0].narrowing = { kind: "REFUSED", sentence: "The held geometry cannot establish a voter assignment.", rungs: [] };
    assert.deepEqual(pollingLookupFallbacks("answered", answer), [link], "unresolved assignment only offers the exact named state's authority");
  }
});

test("every held official lookup renders its actual URL, authority, access note and verification date", () => {
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "-e", `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { PollingLookupFallback } from './components/ballot/polling-lookup-fallback.tsx';
    import { POLLING_PLACE_LINKS } from './lib/ballot/polling-place-links.ts';
    console.log(JSON.stringify({ markup: renderToStaticMarkup(createElement(PollingLookupFallback, { links: POLLING_PLACE_LINKS })), empty: renderToStaticMarkup(createElement(PollingLookupFallback, { links: [] })) }));
  `], { encoding: "utf8", timeout: 30_000 });
  const result = JSON.parse(output);
  assert.equal(result.empty, "");
  assert.equal([...result.markup.matchAll(/data-polling-lookup-state=/g)].length, POLLING_PLACE_LINKS.length);
  for (const link of POLLING_PLACE_LINKS) {
    assert.ok(result.markup.includes(link.url));
    assert.ok(result.markup.includes(link.sourceOrg));
    assert.ok(result.markup.includes(`data-polling-lookup-state="${link.state}"`));
  }
});
