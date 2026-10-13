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

const owner: Access = { role: "owner", canSpend: true, outreachAuthorized: false };
const ref: LiveReference = liveReference({ scope: { kind: "all" }, observedAt: "2026-10-01T22:00:00.000Z" });
const waiting = Object.fromEntries(SECTION_IDS.map((id) => [id, { phase: "waiting", data: null, asOf: null, revision: null, missingParts: [], attempts: 0 }])) as unknown as Record<(typeof SECTION_IDS)[number], SectionState>;
const page = (view: View): string => renderToStaticMarkup(h(CommandCenter, {
  data: buildLiveBundle(waiting, ref, workerStatusFromPulse(null)), mode: "live", executor: liveExecutor({ capabilities: () => null }),
  scopeKey: "us", onScopeChange: () => {}, connection: "live", lastGoodAt: "2026-10-01T22:00:00.000Z", recovered: false, access: owner, initialView: view,
}));

test("Now reads top to bottom: The country, Direct work, Is it working, Orders in motion, Needs me", () => {
  const text = page("now").replace(/<[^>]+>/g, " ");
  const at = ["The country", "Direct work", "Is it working", "Orders in motion", "Needs me"].map((title) => text.indexOf(title));
  assert.ok(at.every((n) => n >= 0), `every section is on Now: ${at}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, "in that order");
  assert.equal(text.split("Is it working").length - 1, 1, "the five numbers are one card, said once");
  assert.doesNotMatch(text, /The last full hour|Mission progress/, "the duplicate hour card and the separate progress card are gone");
  assert.match(page("now"), /<details[^>]*open=""[^>]*>\s*<summary[^>]*>Direct work/, "Direct work starts open");
});

test("with paid work paused, every hunt says Paused and why, gathered by state, never 'saved, not reported running'", async () => {
  const { adminNowFixture } = await import("../fixtures/admin-now/fixture.ts");
  const f = adminNowFixture("after");
  const html = renderToStaticMarkup(h(CommandCenter, { data: buildLiveBundle(f.snapshot, f.reference, workerStatusFromPulse(null)), mode: "live",
    executor: liveExecutor({ capabilities: () => null }), scopeKey: "us", onScopeChange: () => {}, connection: "live", lastGoodAt: null, recovered: false, access: owner, initialView: "now" }));
  const text = html.replace(/<[^>]+>/g, " ").replace(/&quot;|&#x27;/g, "'").replace(/\s+/g, " ");
  assert.doesNotMatch(text, /Saved, not reported running|not reported running/i);
  assert.match(text, /Paused\. You paused all paid work Oct 12, 5:40 PM ET\. You said: “Holding spend until the new hunter prompt ships\.” Resume paid work to go on\./);
  assert.match(text, /79 hunts in 3 places/);
  assert.match(text, /Arizona 40 hunts · 40 paused/, "a state's 40 ZIP hunts are one row with a count");
  assert.match(text, /78 hunts Paused You paused all paid work/, "Orders in motion says the pause once for the hunts it holds");
  assert.match(text, /Hunt: ZIP 03031 hunt Paused Its budget is set to \$0/, "a hunt paused by its own budget says so");
  assert.match(text, /56 states and territories · 79 hunts, 79 paused/);
  for (const state of ["Wyoming", "Guam", "U.S. Virgin Islands"]) assert.match(text, new RegExp(state), `${state} is listed with what readers have`);
});

test("Now has the things that matter, each with a sentence, and none of the old status stack", () => {
  const html = page("now");
  for (const title of ["Needs me", "Facts live", "Cost per fact", "Orders in motion"]) assert.match(html, new RegExp(title), title);
  assert.doesNotMatch(html, /Not measured yet\. Higher means the factory is producing|Not measured yet\. Lower is better/);
  assert.match(html, /Facts live<.*?—/);
  assert.match(html, /Cost per fact<.*?—/);
  for (const gone of ["What’s stuck", "What it has cost", "What’s happening now", "What’s still missing", "Your recent instructions", "Suggested next steps", "Reader demand"]) assert.doesNotMatch(html, new RegExp(gone), gone);
});

test("the data cards live in Data business, not on Now", () => {
  assert.match(page("data"), /Data business/);
  assert.doesNotMatch(page("now"), /Is capture working/);
});


test("Now reads recorded full hours without substituting Scoreboard aggregate values", () => {
  const live = { ...waiting, scoreboard: {phase:"live",asOf:ref.observedAt,revision:"flow",missingParts:[],attempts:0,data:{rows:[{name:"Facts live per hour",value:"4.25",counts:"102 new or updated reader records",notMeasured:null}]}} as SectionState };
  const html = renderToStaticMarkup(h(CommandCenter,{data:buildLiveBundle(live,ref,workerStatusFromPulse(null)),mode:"live",executor:liveExecutor({capabilities:()=>null}),scopeKey:"us",onScopeChange:()=>{},connection:"live",lastGoodAt:null,recovered:false,access:owner,initialView:"now"}));
  assert.match(html,/Is it working/);
  assert.doesNotMatch(html,/102 new or updated reader records|4\.25/);
});
