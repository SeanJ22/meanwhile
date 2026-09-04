import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BODY_ROSTERS, rosterGapForBody, rosterGapsForDivision, rosterHoldersForBody } from "../lib/registry/body-rosters.ts";
import { GET } from "../app/api/representation/[...division]/route.ts";
import { Representation } from "../components/map/popup/entity-modal.tsx";

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
    assert.deepEqual(payload.holders, holders);
    assert.deepEqual(payload.rosterGaps, [gap]);
    const markup = renderToStaticMarkup(createElement(Representation, { holders: payload.holders, note: "Unused empty-roster note", gaps: payload.rosterGaps }));
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
