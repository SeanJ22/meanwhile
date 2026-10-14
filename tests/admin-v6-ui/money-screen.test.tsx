/**
 * Money shows each billed provider by day from the published owner snapshot, names a missing billing key, and says the
 * daily limit covers Anthropic tokens only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CommandCenter } from "../../app/(admin)/_mw/admin-v6/command-center.tsx";
import { SECTION_IDS } from "../../app/(admin)/_mw/admin-v6/contract.ts";
import type { Access } from "../../app/(admin)/_mw/admin-v6/eligibility.ts";
import { liveExecutor } from "../../app/(admin)/_mw/admin-v6/executor.ts";
import { buildLiveBundle } from "../../app/(admin)/_mw/admin-v6/live-data.ts";
import type { SectionState } from "../../app/(admin)/_mw/admin-v6/live-sync.ts";
import { workerStatusFromPulse } from "../../app/(admin)/_mw/admin-v6/pulse-view.ts";
import { liveReference } from "../../app/(admin)/_mw/admin-v6/reference.ts";
import { easternMonth } from "../../lib/control-plane/admin-view/periods.ts";
import { validateV6Query } from "../../lib/control-plane/admin-view/v6-hunts-read.ts";
import { v6MoneySection } from "../../lib/control-plane/admin-view/v6-money-read.ts";
import type { ProviderReading } from "../../lib/control-plane/provider-billing.ts";

const now = new Date();
const nowIso = now.toISOString();
const day = `${easternMonth(now)}-01`;
const owner: Access = { role: "owner", canSpend: true, outreachAuthorized: false };
const ref = liveReference({ scope: { kind: "all" }, observedAt: nowIso });
const waiting = Object.fromEntries(SECTION_IDS.map((id) => [id, { phase: "waiting", data: null, asOf: null, revision: null, missingParts: [], attempts: 0 }])) as unknown as Record<(typeof SECTION_IDS)[number], SectionState>;

const reading = (provider: ProviderReading["provider"], over: Partial<ProviderReading>): ProviderReading => ({
  provider, attemptedAt: nowIso, syncedAt: nowIso, periodStart: `${day}T00:00:00.000Z`, periodEnd: nowIso, status: "REPORTED", reportedUsd: null,
  estimatedUsd: null, credits: null, units: [], days: [], accountIds: [], existingLimits: [], source: "fixture", detail: "", error: null, ...over,
});
/** The providerBilling part of a published owner snapshot. */
const snapshotBilling = { formatVersion: 1 as const, collectedAt: nowIso, readings: [
  reading("anthropic-api", { reportedUsd: 12.5, days: [{ day, usd: 12.5, usage: [] }] }),
  reading("neon", { days: [{ day, usd: null, usage: [{ label: "Compute", value: 4, unit: "CU-hours" }, { label: "Data transfer", value: 2e9, unit: "bytes" }] }] }),
  reading("exa", { reportedUsd: 0.75, days: [{ day, usd: 0.75, usage: [] }] }),
  reading("github", { reportedUsd: 2, days: [{ day, usd: 2, usage: [] }] }),
  reading("netlify", { status: "MISSING_ACCESS", syncedAt: null, error: "MISSING_NETLIFY_BILLING_TOKEN" }),
] };

function moneyPage(): string {
  const q = validateV6Query(new URLSearchParams({ scope: "us" }));
  assert.ok(q.ok);
  const section = v6MoneySection({ scopeKey: "us", scope: q.scope, period: { kind: "native" }, sources: {
    scopes: [], malformedScopes: 0, configGap: null, attribution: null, snapshotGap: null, readAt: nowIso,
    providerBilling: snapshotBilling, fleetSafety: null, fleetSafetyGap: null, adminConfig: null } });
  assert.ok(!("kind" in section));
  const live = { ...waiting, money: { phase: "live", data: section.data, asOf: section.asOf, revision: section.revision, missingParts: section.missingParts, attempts: 0 } as SectionState };
  return renderToStaticMarkup(h(CommandCenter, {
    data: buildLiveBundle(live, ref, workerStatusFromPulse(null)), mode: "live", executor: liveExecutor({ capabilities: () => null }),
    scopeKey: "us", onScopeChange: () => {}, connection: "live", lastGoodAt: nowIso, recovered: false, access: owner, initialView: "money",
  }));
}

test("Money shows all five billed providers by day from the published snapshot", () => {
  const html = moneyPage();
  const card = html.slice(html.indexOf("Provider bills by day"));
  assert.ok(html.includes("Provider bills by day"));
  for (const name of ["Anthropic (API)", "Neon", "Exa", "GitHub", "Netlify"]) assert.match(card, new RegExp(`<th scope="col"[^>]*>${name.replace(/[()]/g, "\\$&")}</th>`), name);
  const row = card.slice(card.indexOf("<tbody>"), card.indexOf("</tbody>"));
  assert.deepEqual([...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]), ["$12.50", "4.0 compute hours · 2.00 GB sent", "$0.75", "$2.00", "—"]);
});

test("a missing billing key is named for its provider; the daily limit is Anthropic tokens only", () => {
  const html = moneyPage();
  assert.match(html, /Netlify: billing key not set \(NETLIFY_BILLING_TOKEN\)/);
  assert.match(html, /Today against the daily limit · Anthropic tokens only/);
});
