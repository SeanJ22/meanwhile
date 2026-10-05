/**
 * BR-25: Now shows the few things that matter, each with one sentence. The old stack of status cards is gone, and the data cards
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

test("Now has the four things that matter, each with a sentence, and none of the old status stack", () => {
  const html = page("now");
  for (const title of ["Needs me", "Mission progress", "Facts live per hour", "Cost per fact", "Orders in motion"]) assert.match(html, new RegExp(title), title);
  assert.match(html, /Not measured yet\. Higher means the factory is producing/);
  assert.match(html, /Not measured yet\. Lower is better/);
  for (const gone of ["What’s stuck", "What it has cost", "What’s happening now", "What’s still missing", "Your recent instructions", "Suggested next steps", "Reader demand"]) assert.doesNotMatch(html, new RegExp(gone), gone);
});

test("the data cards live in Data business, not on Now", () => {
  assert.match(page("data"), /Data business/);
  assert.doesNotMatch(page("now"), /Is capture working/);
});
