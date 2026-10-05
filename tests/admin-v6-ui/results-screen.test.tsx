/**
 * What readers can see: the section the backend now announces, read through the same sync every other section uses,
 * and what the Checklist screen prints for it at each stage of that connection.
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
import { LiveSync, type SectionState, type SyncFetch } from "../../app/(admin)/_mw/admin-v6/live-sync.ts";
import { workerStatusFromPulse } from "../../app/(admin)/_mw/admin-v6/pulse-view.ts";
import { liveReference } from "../../app/(admin)/_mw/admin-v6/reference.ts";
import { adminV6ReadCapabilities } from "../../lib/control-plane/admin-view/v6-capabilities.ts";
import { ADMIN_V6_RESULTS_CONTRACT, owedResults, pipelineResults, type PipelineRead } from "../../lib/control-plane/admin-view/v6-results-read.ts";

const owner: Access = { role: "owner", canSpend: true, outreachAuthorized: false };
const ref: LiveReference = liveReference({ scope: { kind: "all" }, observedAt: "2026-10-01T22:00:00.000Z" });
const waiting = Object.fromEntries(SECTION_IDS.map((id) => [id, { phase: "waiting", data: null, asOf: null, revision: null, missingParts: [], attempts: 0 }])) as unknown as Record<(typeof SECTION_IDS)[number], SectionState>;

const pipeline: PipelineRead = {
  state: "READ", publishedAt: "2026-10-01T21:50:44.205Z", revision: "671",
  pending: [{ recordClass: "local-jurisdiction", stage: "SCOUTED", prefix: "az", n: 570 }, { recordClass: "candidate-enrichment", stage: "SCOUTED", prefix: "az", n: 90 }],
  approved: [{ recordClass: "candidate-enrichment", prefix: "az", witness: "NOT_OBSERVED", n: 10, approvedAt: "2026-09-28T11:44:40.084Z", checkedAt: "2026-10-01T21:50:44.205Z", url: null }],
};

const zipRef: LiveReference = { ...ref, geo: { key: "geo:az.zcta.85635", name: "ZIP 85635", kind: "ZIP", state: "az" } };
function page(snapshot: Record<(typeof SECTION_IDS)[number], SectionState>, scopeKey: string): string {
  return renderToStaticMarkup(h(CommandCenter, {
    data: buildLiveBundle(snapshot, scopeKey.startsWith("geo:") ? zipRef : ref, workerStatusFromPulse(null)), mode: "live", executor: liveExecutor({ capabilities: () => null }),
    scopeKey, onScopeChange: () => {}, connection: "live", lastGoodAt: "2026-10-01T22:00:00.000Z", recovered: false, access: owner, initialView: "checklist",
  }));
}
const readersCard = (html: string) => /id="v6-readers"[\s\S]*/.exec(html)?.[0] ?? "";
const live = (data: unknown): SectionState => ({ phase: "live", data, asOf: "2026-10-01T21:50:44.205Z", revision: "r1", missingParts: [], attempts: 0 });

test("before the section is read, the panel shows a dash and no waiting copy", () => {
  const html = readersCard(page(waiting, "us"));
  assert.match(html, /What readers can see/);
  assert.match(html, /—/);
  assert.doesNotMatch(html, /DEP-READER-PROOF|Not connected yet|Reader results with their six stages/);
});

test("a country read shows each kind of record with its six stages, and a stage nothing records reads as not reported", () => {
  const html = readersCard(page({ ...waiting, results: live(pipelineResults(pipeline, "us", { kind: "country" })) }, "us"));
  assert.match(html, /Candidate enrichment/);
  assert.match(html, /Local jurisdiction/);
  assert.match(html, /10 of 100 published · 0 of 10 checked on the page/);
  assert.match(html, /Saved: not reported/, "the dots say a stage is not reported");
  assert.match(html, /Checked on the public page: wrong/);
  assert.doesNotMatch(html, /No results for/);
  assert.doesNotMatch(html, />(New|Reused|Updated|Retained)</, "no kind is invented");
});

test("a state read lists only that state's kinds of record", () => {
  const html = readersCard(page({ ...waiting, results: live(pipelineResults(pipeline, "st:az", { kind: "state", state: "az" })) }, "st:az"));
  assert.match(html, /Candidate enrichment/);
  assert.match(html, /Local jurisdiction/);
  const other = readersCard(page({ ...waiting, results: live(pipelineResults(pipeline, "st:nj", { kind: "state", state: "nj" })) }, "st:nj"));
  assert.doesNotMatch(other, /Candidate enrichment/);
});

test("a read that answers with no data shows a dash, and a real empty list says there are none", () => {
  assert.match(readersCard(page({ ...waiting, results: live(null) }, "us")), /—/);
  assert.doesNotMatch(readersCard(page({ ...waiting, results: live(null) }, "us")), /No results for/);
  assert.match(readersCard(page({ ...waiting, results: live([]) }, "us")), /No results for/);
});

test("a ZIP's groups appear on that ZIP's page", () => {
  const rows = [{ id: "a|OFF-04", checklistId: "OFF-04", state: "published" as const, requirement: "x", subject: { id: "a", kind: "seat", label: "a" }, held: [{ sourceUrl: "https://example.gov/p", checkedAt: "2026-10-01T10:00:00.000Z", state: "published", value: { v: 1 } }] }];
  const html = readersCard(page({ ...waiting, results: live(owedResults({ placeKey: "geo:az.zcta.85635", rows, zip: "85635", witnesses: [] })) }, "geo:az.zcta.85635"));
  assert.match(html, /Officeholders/);
  assert.match(html, /1 of 1 published/);
});

/* ---------------------------------------------- announced, fetched, shown */

test("the announced results section is fetched for the page's scope and fills the same mounted page", async () => {
  const calls: string[] = [];
  const body = { contract: ADMIN_V6_RESULTS_CONTRACT, scope: "st:az", revision: "results:671:st:az", asOf: "2026-10-01T21:50:44.205Z", data: pipelineResults(pipeline, "st:az", { kind: "state", state: "az" }) };
  const fetch: SyncFetch = async (url) => { calls.push(url); return { status: 200, json: async () => body }; };
  const sync = new LiveSync({ scope: "st:az", fetch, schedule: () => () => {} });
  const caps = adminV6ReadCapabilities({ configRevision: null, snapshotRevision: 671, researchRevision: null, workerAgeBucket: 1 });
  sync.onPulse({ revision: "p1", v6: caps });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls.filter((u) => u.includes("/results")), ["/api/admin/v6/results?scope=st%3Aaz"]);
  const bundle = buildLiveBundle(sync.snapshot(), ref, workerStatusFromPulse(null));
  assert.equal(bundle.results.state, "live");
  assert.equal(bundle.results.data?.length, 2);
  assert.equal(bundle.results.problem, undefined);
});
