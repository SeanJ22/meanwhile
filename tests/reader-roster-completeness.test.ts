import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

import { BODY_ROSTERS, rosterGapForBody, rosterGapsForDivision, rosterHoldersForBody } from "../lib/registry/body-rosters.ts";
import { GET } from "../app/api/representation/[...division]/route.ts";
function renderRepresentation(payload: { holders: ReturnType<typeof rosterHoldersForBody>; rosterGaps: ReturnType<typeof rosterGapsForDivision> }): string {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "-e", `
    import { readFileSync } from 'node:fs';
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { Representation } from './components/map/popup/entity-modal.tsx';
    const payload = JSON.parse(readFileSync(0, 'utf8'));
    console.log(JSON.stringify(renderToStaticMarkup(createElement(Representation, { holders: payload.holders, note: 'Unused empty-roster note', gaps: payload.rosterGaps }))));
  `], { cwd: process.cwd(), input: JSON.stringify(payload), encoding: "utf8", timeout: 120_000, maxBuffer: 4_000_000 });
  const result: unknown = JSON.parse(output);
  assert.ok(typeof result === "string");
  return result;
}

test("every partial verified roster keeps its members and exact sourced completeness gap through API and actual representation leaf", async () => {
  const incomplete = BODY_ROSTERS.flatMap(roster => { const gap = rosterGapForBody(roster.bodyId); return gap ? [{ roster, gap }] : []; });
  assert.ok(incomplete.length > 0);
  for (const { roster, gap } of incomplete) {
    const ocdId = roster.bodyId.split("#")[0];
    const holders = rosterHoldersForBody(roster.bodyId);
    assert.equal(holders.length, gap.verifiedMembers);
    assert.equal(gap.verifiedMembers + gap.unresolvedSlots, gap.expectedMembers);
    assert.deepEqual(rosterGapsForDivision(ocdId), [gap]);
    const response = await GET(new Request(`https://wtp.test/api/representation/${ocdId}`), { params: Promise.resolve({ division: ocdId.split("/") }) });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.holders, JSON.parse(JSON.stringify(holders)),
      "the HTTP response preserves each holder; JSON omits optional undefined fields");
    assert.deepEqual(payload.rosterGaps, [gap]);
    const markup = renderRepresentation(payload);
    assert.equal((markup.match(/data-roster-holder=/g) ?? []).length, holders.length);
    assert.ok(markup.includes(gap.statement));
    assert.ok(markup.includes(`data-verified-members="${holders.length}"`));
    assert.ok(markup.includes(`data-expected-members="${gap.expectedMembers}"`));
    assert.ok(markup.includes(gap.sourceUrl));
    assert.ok(!markup.includes("Unused empty-roster note"));
    for (const holder of holders) assert.ok(markup.includes(`data-roster-holder="${holder.id}"`));
  }
});

test("an incomplete roster cannot attach its gap or a fifth person's identity to another body", () => {
  assert.deepEqual(rosterGapsForDivision("ocd-division/country:us/state:nj/county:morris/place:rockaway_township"), []);
  assert.equal(rosterGapForBody("unresolved:body"), null);
  const roster = BODY_ROSTERS.find(row => rosterGapForBody(row.bodyId))!;
  assert.equal(roster.members.length, new Set(roster.members.map(row => row.id)).size);
});
