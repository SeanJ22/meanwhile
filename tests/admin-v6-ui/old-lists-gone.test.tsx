/**
 * The old order and stuck lists are gone. Each order, hunt, stuck item and fix item is on the Queue only: Work has no
 * Lanes or History tab, Workers has no "Your instructions", and the Fix list is not a page of its own.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CommandCenter } from "../../app/(admin)/_mw/admin-v6/command-center.tsx";
import { VIEWS } from "../../app/(admin)/_mw/admin-v6/context.tsx";
import { SECTION_IDS } from "../../app/(admin)/_mw/admin-v6/contract.ts";
import type { Access } from "../../app/(admin)/_mw/admin-v6/eligibility.ts";
import { liveExecutor } from "../../app/(admin)/_mw/admin-v6/executor.ts";
import { buildLiveBundle, type LiveReference } from "../../app/(admin)/_mw/admin-v6/live-data.ts";
import type { SectionState } from "../../app/(admin)/_mw/admin-v6/live-sync.ts";
import { workerStatusFromPulse } from "../../app/(admin)/_mw/admin-v6/pulse-view.ts";
import { liveReference } from "../../app/(admin)/_mw/admin-v6/reference.ts";
import { parseView, type View } from "../../app/(admin)/_mw/admin-v6/view-param.ts";

const owner: Access = { role: "owner", canSpend: true, outreachAuthorized: false };
const ref: LiveReference = liveReference({ scope: { kind: "all" }, observedAt: "2026-10-01T22:00:00.000Z" });
const waiting = Object.fromEntries(SECTION_IDS.map((id) => [id, { phase: "waiting", data: null, asOf: null, revision: null, missingParts: [], attempts: 0 }])) as unknown as Record<(typeof SECTION_IDS)[number], SectionState>;
const page = (view: View): string => renderToStaticMarkup(h(CommandCenter, {
  data: buildLiveBundle(waiting, ref, workerStatusFromPulse(null)), mode: "live", executor: liveExecutor({ capabilities: () => null }),
  scopeKey: "us", onScopeChange: () => {}, connection: "live", lastGoodAt: "2026-10-01T22:00:00.000Z", recovered: false, access: owner, initialView: view,
}));

test("Work keeps no Lanes or History tab, and Workers no list of instructions", () => {
  const work = page("work");
  for (const gone of ["Stuck, by who moves it", "History of your instructions", "Blockers by cause", "Instructions you sent the fleet", "Scheduled orders"]) assert.doesNotMatch(work, new RegExp(gone), gone);
  assert.doesNotMatch(page("workers"), /Your instructions, and what the workers did with them/);
  assert.doesNotMatch(page("now"), /Your recent instructions/);
});

test("the Fix list is not a page of its own: its items are on the Queue and dispatch is automatic", () => {
  assert.equal(VIEWS.some(([id]) => (id as string) === "fix"), false);
  assert.equal(parseView("fix"), "now", "an old link to the Fix list opens Now, not a page that no longer exists");
  const queue = page("queue");
  assert.doesNotMatch(queue, /Send everything waiting on the fix list/);
  assert.equal(parseView("work"), "work");
  assert.equal(VIEWS.some(([id]) => id === "work"), true);
  assert.doesNotMatch(page("work"), /All work rows/);
  assert.match(queue, /Queue/);
});


test("measures supplied work rows keep their view and detail link", () => {
  const snapshot = {...waiting,workRows:{phase:"live",data:{rows:[{id:"work-one",stage:"waiting",placeKey:"us",title:"A saved work row",age:"One minute",at:"2026-10-06T04:00:00Z"}],totals:[{stage:"waiting",total:1}]},asOf:ref.observedAt,revision:"saved-work",missingParts:[],attempts:0} as SectionState};
  const html = renderToStaticMarkup(h(CommandCenter,{data:buildLiveBundle(snapshot,ref,workerStatusFromPulse(null)),mode:"live",executor:liveExecutor({capabilities:()=>null}),scopeKey:"us",onScopeChange:()=>{},connection:"live",lastGoodAt:null,recovered:false,access:owner,initialView:"work"}));
  assert.match(html,/All work rows/);
  assert.match(html,/A saved work row/);
});
