/**
 * Now shows the few things that matter, each with one sentence. The old stack of status cards is gone, and the data cards
 * live in their own view.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CommandCenter } from "../../app/(admin)/_mw/admin-v6/command-center.tsx";
import { SECTION_IDS } from "../../app/(admin)/_mw/admin-v6/contract.ts";
import type { Access } from "../../app/(admin)/_mw/admin-v6/eligibility.ts";
import { liveExecutor } from "../../app/(admin)/_mw/admin-v6/executor.ts";
import { buildLiveBundle, type LiveReference } from "../../app/(admin)/_mw/admin-v6/live-data.ts";
import type { SectionState } from "../../app/(admin)/_mw/admin-v6/live-sync.ts";
import { workerStatusFromPulse } from "../../app/(admin)/_mw/admin-v6/pulse-view.ts";
import { liveReference } from "../../app/(admin)/_mw/admin-v6/reference.ts";
import type { View } from "../../app/(admin)/_mw/admin-v6/view-param.ts";
import { actionDef } from "../../app/(admin)/_mw/admin-v6/actions.ts";

const owner: Access = { role: "owner", canSpend: true, outreachAuthorized: false };
const ref: LiveReference = liveReference({ scope: { kind: "all" }, observedAt: "2026-10-01T22:00:00.000Z" });
const waiting = Object.fromEntries(SECTION_IDS.map((id) => [id, { phase: "waiting", data: null, asOf: null, revision: null, missingParts: [], attempts: 0 }])) as unknown as Record<(typeof SECTION_IDS)[number], SectionState>;
const page = (view: View): string => renderToStaticMarkup(h(CommandCenter, {
  data: buildLiveBundle(waiting, ref, workerStatusFromPulse(null)), mode: "live", executor: liveExecutor({ capabilities: () => null }),
  scopeKey: "us", onScopeChange: () => {}, connection: "live", lastGoodAt: "2026-10-01T22:00:00.000Z", recovered: false, access: owner, initialView: view,
}));

test("Now has the four things that matter, each with a sentence, and none of the old status stack", () => {
  const html = page("now");
  for (const title of ["Needs me", "Mission progress", "The last full hour", "Facts live", "Cost per fact", "Orders in motion"]) assert.match(html, new RegExp(title), title);
  // Before the first hour is recorded each number shows "—" and still keeps its one sentence.
  assert.match(html, /Not measured yet\./);
  assert.match(html, /went live\. Higher is better\./);
  assert.match(html, /divided by facts live\. Lower is better\./);
  for (const gone of ["What’s stuck", "What it has cost", "What’s happening now", "What’s still missing", "Your recent instructions", "Suggested next steps", "Reader demand"]) assert.doesNotMatch(html, new RegExp(gone), gone);
});

test("the data cards live in Data business, not on Now", () => {
  assert.match(page("data"), /Data business/);
  assert.doesNotMatch(page("now"), /Is capture working/);
});

test("officials checks and source results are available for state, county, district and ZIP places", () => {
  for (const scopeKey of ["st:fl", "geo:fl.county.12011", "geo:fl.congressional_district.1220", "geo:fl.zcta.33301"]) {
    const data = buildLiveBundle(waiting, ref, workerStatusFromPulse(null));
    const html = renderToStaticMarkup(h(CommandCenter, { data: { ...data,
      places: { ...data.places, data: [...data.places.data!.filter(place => place.key !== scopeKey), { key: scopeKey, name: "Florida place", kind: "Area", navParent: "st:fl", within: ["st:fl"] }] },
      officials: { state: "live", load: "ready", asOf: "2026-10-13T05:01:00.000Z", data: {
        placeKey: scopeKey, requestedAt: "2026-10-13T05:00:00.000Z", status: "done", lead: null,
        feeds: [{ id: "feed:official-house-roster", name: "House Clerk", sourceUrl: "https://clerk.house.gov/xml/lists/MemberData.xml", state: "changed", checkedAt: "2026-10-13T05:01:00.000Z" }],
        changes: [{ kind: "vacant", name: null, officeTitle: "U.S. Representative", divisionId: "ocd-division/country:us/state:fl/cd:20", since: "2026-04-21", sourceUrl: "https://clerk.house.gov/xml/lists/MemberData.xml" }],
      } } }, mode: "live", executor: liveExecutor({ capabilities: () => null }), scopeKey, onScopeChange: () => {},
      connection: "live", lastGoodAt: "2026-10-13T05:01:00.000Z", recovered: false, access: owner, initialView: "now" }));
    assert.match(html, /Check officials now/);
    assert.match(html, /Vacant since 2026-04-21/);
    assert.match(html, /District 20/);
    assert.match(html, /House Clerk/);
    assert.match(html, /href="https:\/\/clerk.house.gov\/xml\/lists\/MemberData.xml"/);
  }
  assert.equal(actionDef("officials-check").preview({ target: "st:fl", targetName: "Florida", scopeName: "Florida", scopeIsCountry: false, outreachAuthorized: false }).noteLabel, "What I heard (optional)");
});
