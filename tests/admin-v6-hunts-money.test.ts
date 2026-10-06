import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as huntsGET } from "../app/api/admin/v6/hunts/route.ts";
import { GET as moneyGET } from "../app/api/admin/v6/money/route.ts";
import { v6HuntsSection, validateV6Query, type AdminV6HuntView, type V6Refusal } from "../lib/control-plane/admin-view/v6-hunts-read.ts";
import { v6MoneySection, type AdminV6MoneyView } from "../lib/control-plane/admin-view/v6-money-read.ts";
import { v6MoneyHuntsGet, type V6ReadSources } from "../lib/control-plane/admin-view/v6-money-hunts-route.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import { providerBillingAttribution, type BillingAttribution } from "../lib/control-plane/provider-billing-attribution.ts";
import type { ProviderReading } from "../lib/control-plane/provider-billing.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { ORIGINAL_LIFETIME_HUNT } from "../lib/control-plane/scheduler/hunt-continuation.ts";
import { LiveSync, type SyncFetch } from "../app/(admin)/_mw/admin-v6/live-sync.ts";
import { buildLiveBundle } from "../app/(admin)/_mw/admin-v6/live-data.ts";
import { liveReference } from "../app/(admin)/_mw/admin-v6/reference.ts";
import { huntLeftUsd, type Hunt, type MoneyView } from "../app/(admin)/_mw/admin-v6/model.ts";
import { huntAt, huntsWithin, indexPlaces } from "../app/(admin)/_mw/admin-v6/places.ts";
import { ADMIN_HOST, PUBLIC_HOST, adminSessionCookie, withAdminSessionKey } from "./admin-session.ts";

const NOW = "2026-09-28T20:00:00.000Z";
const ORIGINAL: ExpansionScopeDecision = {
  key: ORIGINAL_LIFETIME_HUNT.key,
  geography: { type: "zcta", geoid: "85635", version: "zcta:2020", label: "ZIP 85635 (Census ZCTA)", stateAbbr: "AZ" },
  priority: 1, budgetUsd: ORIGINAL_LIFETIME_HUNT.budgetUsd, budgetStartedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt, sourceWorkVersion: 1,
  note: null, decidedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt, decidedBy: "session:owner", receiptId: ORIGINAL_LIFETIME_HUNT.receiptId, previous: null,
};
const SECOND: ExpansionScopeDecision = {
  ...ORIGINAL, key: "zcta:2020/85602", receiptId: "expansion.scope.set:scope:85602:test",
  geography: { ...ORIGINAL.geography, geoid: "85602", label: "ZIP 85602 (Census ZCTA)" },
  budgetUsd: 20, budgetStartedAt: "2026-09-28T01:00:00.000Z", decidedAt: "2026-09-28T01:00:00.000Z",
};
const ROLLING: ExpansionScopeDecision = {
  ...ORIGINAL, key: "county:2020/04019", receiptId: "expansion.scope.set:scope:04019:test", budgetStartedAt: undefined, budgetUsd: 5,
  geography: { type: "county", geoid: "04019", version: "county:2020", label: "Pima County", stateAbbr: "AZ" },
};

/** The saved 19:33 UTC reading of the original hunt (original-cost-attribution-2026-09-28T19-33-03.516Z.json). */
const ORIGINAL_ROW = {
  key: ORIGINAL.key, receiptId: ORIGINAL.receiptId, label: ORIGINAL.geography.label, startedAt: ORIGINAL.budgetStartedAt!, budgetUsd: 50,
  anthropicUsd: 38.491002400000035, otherUsd: null, anthropicKnownUsd: 38.491002400000035, otherKnownUsd: 0.012,
  knownCombinedUsd: 38.503002400000035, budgetConsumedKnownUsd: 38.491002400000035, budgetUnpriced: 0,
  reservedUsd: 8.16384, availableUsd: 3.3451575999999648, unpriced: 481,
};
const attributionOf = (hunts: BillingAttribution["hunts"]): BillingAttribution => ({ readAt: "2026-09-28T19:33:03.516Z", hunts, providers: [] });

function sources(over: Partial<V6ReadSources> = {}): V6ReadSources {
  return { scopes: [ORIGINAL], malformedScopes: 0, configGap: null, attribution: attributionOf([ORIGINAL_ROW]), snapshotGap: null,
    readAt: NOW, providerBilling: null, fleetSafety: null, fleetSafetyGap: null, adminConfig: null, ...over };
}
const hunts = (scopeKey: string, over: Partial<V6ReadSources> = {}, period: Parameters<typeof v6HuntsSection>[0]["period"] = { kind: "native" }) => {
  const q = validateV6Query(new URLSearchParams({ scope: scopeKey }));
  assert.ok(q.ok);
  return v6HuntsSection({ scopeKey, scope: q.scope, period, sources: sources(over) });
};
function envelope<T>(out: { data: T } | V6Refusal): { data: T; missingParts: readonly string[]; revision: string; asOf: string } {
  assert.ok(!("kind" in out), `expected a section, got ${"kind" in out ? `${out.code}: ${out.says}` : ""}`);
  return out as never;
}
function refusal(out: unknown): V6Refusal {
  assert.ok(out && typeof out === "object" && "kind" in out, "expected a refusal");
  return out as V6Refusal;
}

/* ------------------------------------------------------------- hunts */

test("the original 85635 hunt keeps its exact $50 lifetime accounting: spent, set aside, left and unpriced", () => {
  const section = envelope(hunts("geo:az.zcta.85635"));
  assert.equal(section.data.length, 1);
  const h = section.data[0];
  assert.equal(h.id, `${ORIGINAL.key}#${ORIGINAL.receiptId}`);
  assert.equal(h.placeKey, "geo:az.zcta.85635");
  assert.equal(h.basis, "lifetime");
  assert.equal(h.startedAt, ORIGINAL_LIFETIME_HUNT.budgetStartedAt);
  assert.equal(h.limitUsd, 50);
  assert.equal(h.spentUsd, 38.491002);
  assert.equal(h.reportedSpendUsd, null, "unpriced other-service charges cannot become a measured hunt total");
  assert.equal(h.heldUsd, 8.16384);
  assert.equal(h.availableUsd, 3.345158);
  assert.equal(h.unpricedEntries, 0, "481 unpriced rows are other-service rows, not charges against the Anthropic allowance");
  assert.equal(h.status, "unreported");
  assert.equal(h.researchWorkers, null);
  assert.equal(section.asOf, "2026-09-28T19:33:03.516Z");
  assert.ok(section.missingParts.some(p => /running .* not published/.test(p)));
});

test("a limit edit carries the same hunt forward; a new receipt or a key-only legacy row is not this hunt's accounting", () => {
  const edited = { ...ORIGINAL, budgetUsd: 60, latestDecisionReceiptId: "expansion.scope.set:scope:85635:limit-edit", decidedAt: NOW };
  const h = envelope(hunts("us", { scopes: [edited] })).data[0];
  assert.equal(h.startedAt, ORIGINAL_LIFETIME_HUNT.budgetStartedAt, "the lifetime start is not reset");
  assert.equal(h.spentUsd, 38.491002, "spending carries over");
  assert.equal(h.limitUsd, 60);
  assert.equal(h.availableUsd, 13.345158);
  assert.equal(h.limitSource, "your latest limit change to this hunt");

  const restarted = { ...ORIGINAL, receiptId: "expansion.scope.set:scope:85635:new", budgetStartedAt: NOW };
  const r = refusal(hunts("us", { scopes: [restarted] }));
  assert.equal(r.status, 503);
  assert.equal(r.code, "HUNT_ACCOUNTING_UNAVAILABLE");
  assert.match(r.says, /unknown, not zero/);

  const { receiptId: _dropped, ...legacy } = ORIGINAL_ROW;
  assert.equal(refusal(hunts("us", { attribution: attributionOf([legacy]) })).code, "HUNT_ACCOUNTING_UNAVAILABLE");
  assert.equal(refusal(hunts("us", { attribution: undefined, snapshotGap: "No owner snapshot has been published" })).code, "HUNT_ACCOUNTING_UNAVAILABLE");
});

test("unpriced charges make the amount left unknown; unresolved holds make the whole hunt unavailable", () => {
  const unpriced = envelope(hunts("us", { attribution: attributionOf([{ ...ORIGINAL_ROW, budgetUnpriced: 2, availableUsd: null }]) }));
  assert.equal(unpriced.data[0].availableUsd, null);
  assert.equal(unpriced.data[0].unpricedEntries, 2);
  assert.ok(unpriced.missingParts.some(p => /2 Anthropic requests .* lower bound .* unknown/.test(p)));

  const holdsUnread = refusal(hunts("us", { attribution: attributionOf([{ ...ORIGINAL_ROW, reservedUsd: null, availableUsd: null }]) }));
  assert.equal(holdsUnread.code, "HUNT_ACCOUNTING_UNAVAILABLE");
  const noBudgetFields = refusal(hunts("us", { attribution: attributionOf([{ ...ORIGINAL_ROW, budgetConsumedKnownUsd: undefined, budgetUnpriced: undefined }]) }));
  assert.equal(noBudgetFields.code, "HUNT_ACCOUNTING_UNAVAILABLE");
});

test("a charge shared by two hunts counts against each limit but is allocated once for reporting", () => {
  const cost = (id: string, source: string, usd: number | null, refs: readonly ExpansionScopeDecision[], at = "2026-09-28T02:00:00.000Z"): CostEntry => ({
    attemptId: id, workItemId: `w-${id}`, routeTaskId: null, routeId: null, source, jurisdiction: null, project: "p", role: "SCOUT",
    cost: { inputTokens: null, outputTokens: null, usd, durationMs: null, bytesFetched: null, requestCount: null, cacheReadInputTokens: null,
      cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: null, batch: false },
    recordedAt: at, assignmentRefs: refs.map(s => ({ key: s.key, ref: s.receiptId })),
  } as CostEntry);
  const costs = [cost("a1", "api.anthropic.com", 1, [ORIGINAL]), cost("a2", "api.anthropic.com", 2, [ORIGINAL, SECOND]),
    cost("x1", "api.exa.ai", 0.01, [SECOND]), cost("a3", "api.anthropic.com", null, [SECOND])];
  const attribution = providerBillingAttribution({ now: NOW, costs, attempts: [], scopes: [ORIGINAL, SECOND], readings: [],
    holds: { h1: { holdId: "h1", jobId: "j", obligationId: "o", keys: [`send:${ORIGINAL.key}@${ORIGINAL.budgetStartedAt}`], usd: 0.5,
      heldAt: NOW, what: "job", settled: null } } });
  const section = envelope(hunts("st:az", { scopes: [ORIGINAL, SECOND], attribution }));
  const [first, second] = [ORIGINAL, SECOND].map(d => section.data.find(h => h.id.startsWith(d.key))!);
  assert.equal(first.spentUsd, 3, "the shared $2 request consumes the original allowance");
  assert.equal(second.spentUsd, 2, "and the second hunt's own allowance");
  assert.equal(first.heldUsd, 0.5);
  assert.equal(first.availableUsd, 46.5);
  assert.equal(second.availableUsd, null, "an unpriced Anthropic request makes the second hunt's amount left unknown");
  const allocated = attribution.hunts!.reduce((n, h) => n + h.anthropicKnownUsd, 0);
  assert.equal(allocated, 3, "reporting allocation counts the shared charge once");
  assert.ok(section.missingParts.some(p => /never added together/.test(p)));

  const money = envelope(v6MoneySection({ scopeKey: "st:az", scope: { kind: "state", state: "az" }, period: { kind: "native" },
    sources: sources({ scopes: [ORIGINAL, SECOND], attribution }) }));
  assert.match(money.data.otherServices, /ZIP 85602 \(Census ZCTA\) hunt: \$0\.01 known .* \$2\.01 is known; the full combined cost is unknown/);
  assert.match(money.data.otherServices, /ZIP 85635 \(Census ZCTA\) hunt: \$0\.00 known .* \$1\.00 is known\./);
});

test("a district or county binds the ZIP hunts the Census lookup puts inside it, and no other", () => {
  const second = { ...SECOND, budgetStartedAt: SECOND.budgetStartedAt };
  const attribution = attributionOf([ORIGINAL_ROW, { ...ORIGINAL_ROW, key: second.key, receiptId: second.receiptId, label: second.geography.label, startedAt: second.budgetStartedAt!, budgetUsd: 20 }]);
  const inDistrict = (zips: readonly string[] | null) => hunts("geo:az.congressional_district.0406", { scopes: [ORIGINAL, second], attribution, scopeZips: zips === null ? null : new Set(zips) });
  assert.deepEqual(envelope(inDistrict(["85635", "85122"])).data.map(h => h.placeKey), ["geo:az.zcta.85635"], "only the hunt whose ZIP is in the district");
  assert.deepEqual(envelope(inDistrict(["85635", "85602"])).data.map(h => h.placeKey).sort(), ["geo:az.zcta.85602", "geo:az.zcta.85635"]);
  assert.deepEqual(envelope(inDistrict(["85122"])).data, [], "a district none of the hunts' ZIPs are in has no hunt, which is a valid empty list");
  assert.equal(refusal(inDistrict(null)).code, "SCOPE_BINDING_NOT_CONNECTED", "without the lookup the binding stays unsettled");
  const county = hunts("geo:az.county.04019", { scopeZips: new Set(["85635"]) });
  assert.equal(envelope(county).data.length, 1, "a county binds the same way");
  assert.equal(refusal(hunts("geo:az.congressional_district.0406", { scopes: [ROLLING], scopeZips: new Set(["85635"]) })).code, "SCOPE_BINDING_NOT_CONNECTED", "a county hunt in a district stays unsettled");
  const money = envelope(v6MoneySection({ scopeKey: "geo:az.congressional_district.0406", scope: { kind: "geo", state: "az", type: "congressional_district", geoid: "0406" },
    period: { kind: "native" }, sources: sources({ scopeZips: new Set(["85635"]) }) }));
  assert.equal(money.data.limits.length >= 1, true, "Money answers at a district once its hunts are bound");
});

test("scope: country and state include the hunt, other places exclude it, unsettled overlaps and bodies refuse", () => {
  assert.equal(envelope(hunts("us")).data.length, 1);
  const az = envelope(hunts("st:az"));
  assert.equal(az.data.length, 1);
  assert.ok(az.missingParts.some(p => /crosses a state line/.test(p)));
  assert.deepEqual(envelope(hunts("st:nm")).data, []);
  assert.deepEqual(envelope(hunts("geo:az.zcta.85602")).data, [], "a different ZIP is a disjoint area");
  const county = refusal(hunts("geo:az.county.04019"));
  assert.equal(county.status, 409);
  assert.equal(county.code, "SCOPE_BINDING_NOT_CONNECTED");
  assert.equal(county.dependency, "DEP-SCOPE-IDENTITIES");
  assert.equal(envelope(hunts("geo:nm.county.35001", { scopes: [{ ...ROLLING, budgetStartedAt: undefined }] })).data.length, 0,
    "two counties in different states never overlap");
  assert.equal(refusal(hunts("body:ocd-body-1")).code, "SCOPE_BINDING_NOT_CONNECTED");
  assert.equal(refusal(hunts("us", { malformedScopes: 1 })).code, "HUNT_LIST_INCOMPLETE");
  assert.equal(refusal(hunts("us", { scopes: null, configGap: "Reading the owner operational policy failed." })).code, "HUNT_LIST_UNREAD");
  const empty = envelope(hunts("us", { scopes: [] }));
  assert.deepEqual(empty.data, [], "no saved scope is a valid empty list");
  assert.equal(empty.revision, envelope(hunts("us", { scopes: [], readAt: "2026-09-29T00:00:00.000Z" })).revision, "revision moves only with its source");
});

test("a rolling-budget scope is never shown as a lifetime hunt", () => {
  const section = envelope(hunts("us", { scopes: [ORIGINAL, ROLLING] }));
  assert.deepEqual(section.data.map(h => h.id), [`${ORIGINAL.key}#${ORIGINAL.receiptId}`]);
  assert.ok(section.missingParts.some(p => /Pima County \(\$5\.00 per rolling 24 hours\) has an older rolling 24-hour limit/.test(p)));
  const money = envelope(v6MoneySection({ scopeKey: "us", scope: { kind: "country" }, period: { kind: "native" }, sources: sources({ scopes: [ORIGINAL, ROLLING] }) }));
  const limit = money.data.limits.find(l => l.name.startsWith("Pima County"));
  assert.ok(limit);
  assert.equal(limit.figure, "$5.00 per rolling 24 hours");
  assert.equal(limit.fraction, null);
});

test("period: hunts are lifetime only; narrower periods refuse instead of relabelling lifetime figures", () => {
  assert.equal(envelope(hunts("us", {}, { kind: "whole-hunt" })).data[0].basis, "lifetime");
  for (const period of [{ kind: "last-24h" }, { kind: "month", month: "2026-09" }] as const) {
    const r = refusal(hunts("us", {}, period));
    assert.equal(r.status, 409);
    assert.equal(r.code, "PERIOD_NOT_AVAILABLE");
    assert.equal(r.dependency, "DEP-PERIOD");
  }
});

/* ------------------------------------------------------------- money */

const reading = (provider: ProviderReading["provider"], over: Partial<ProviderReading> = {}): ProviderReading => ({
  provider, attemptedAt: "2026-09-28T19:00:00.000Z", syncedAt: "2026-09-28T19:00:00.000Z", periodStart: "2026-09-01T00:00:00.000Z",
  periodEnd: "2026-09-28T19:00:00.000Z", status: "REPORTED", reportedUsd: 120.5, estimatedUsd: null, credits: null, units: [],
  accountIds: [], existingLimits: [], source: "provider", detail: "", error: null, ...over,
});
const money = (period: Parameters<typeof v6MoneySection>[0]["period"], over: Partial<V6ReadSources> = {}) =>
  v6MoneySection({ scopeKey: "geo:az.zcta.85635", scope: { kind: "geo", state: "az", type: "zcta", geoid: "85635" }, period, sources: sources(over) });
const billing = { formatVersion: 1 as const, collectedAt: "2026-09-28T19:00:00.000Z",
  readings: [reading("anthropic-api"), reading("neon", { status: "ERROR", syncedAt: null, reportedUsd: null, error: "timeout" })] };

test("account readings keep their provider periods; missing readings are unknown, never zero", () => {
  const m = envelope(money({ kind: "native" }, { providerBilling: billing,
    fleetSafety: { rolling24Hours: { modelUsd: 21, asOf: "2026-09-28T19:30:00.000Z" }, bounds: { rolling24HourModelUsd: 25 } },
    adminConfig: { fleetSpendCeiling: { rollingCeilingUsd: 25 } } as never }));
  const anthropic = m.data.account.find(a => a.provider === "Anthropic (API)")!;
  assert.equal(anthropic.amountUsd, 120.5);
  assert.match(anthropic.how, /whole account, including non-token services; not an invoice/);
  const neon = m.data.account.find(a => a.provider === "Neon")!;
  assert.equal(neon.amountUsd, null);
  assert.match(neon.how, /last read failed/i);
  assert.equal(m.data.account.find(a => a.provider === "GitHub")!.amountUsd, null);
  const estimated = envelope(money({ kind: "native" }, { providerBilling: { ...billing, readings: [reading("exa", { status: "ESTIMATED", reportedUsd: null, estimatedUsd: 4.2 })] } }));
  const exa = estimated.data.account.find(a => a.provider === "Exa")!;
  assert.equal(exa.amountUsd, null, "an estimate is not counted as a provider reading");
  assert.match(exa.how, /Only an estimate, \$4\.20, which is not counted as a reading/);
  assert.equal(m.data.accountMonth, "Whole account · August 31, 2026, 8:00 PM EDT to September 28, 2026, 3:00 PM EDT", "provider boundaries are shown on the Eastern clock");
  const mixed = envelope(money({ kind: "native" }, { providerBilling: { ...billing, readings: [...billing.readings, reading("exa", { periodStart: "2026-08-15T00:00:00.000Z" })] } }));
  assert.equal(mixed.data.accountMonth, "Whole account · each provider's own billing period");
  assert.deepEqual(m.data.reconciliation, [], "an attribution with no provider rows matches nothing");
  assert.equal(envelope(money({ kind: "native" }, { providerBilling: billing, attribution: undefined })).data.reconciliation, null, "an attribution that was not published is not read as a reconciliation");
  assert.deepEqual(m.data.readings.map(r => [r.provider, r.status, r.stale]), [["Anthropic (API)", "REPORTED", false], ["Neon", "ERROR", true]], "each provider's last read is carried with its status and age");
  assert.ok(m.missingParts.some(p => /5 of 6 providers have no dollar reading.*unknown, not the sum/.test(p)));
  assert.ok(m.missingParts.some(p => /not split by place or by hunt/.test(p)));
  const fleet = m.data.limits[0];
  assert.equal(fleet.figure, "$21.00 of $25.00");
  assert.equal(fleet.fraction, 0.84);
  assert.equal(fleet.tone, "warn");
  assert.match(m.data.otherServices, /\$0\.01 known from search and data services, but some of their charges have no price, so the full amount is unknown/);
  assert.match(m.data.otherServices, /\$38\.50 is known; the full combined cost is unknown/);
  assert.equal(m.asOf, "2026-09-28T19:00:00.000Z", "asOf is the oldest source reading behind the figures");
});

test("money period: a month shows only readings inside it; whole-hunt and last-24h refuse with DEP-PERIOD", () => {
  const sept = envelope(money({ kind: "month", month: "2026-09" }, { providerBilling: billing }));
  assert.equal(sept.data.accountMonth, "Whole account · September 2026 to date");
  assert.equal(sept.data.account.find(a => a.provider === "Anthropic (API)")!.amountUsd, 120.5);
  assert.match(sept.data.otherServices, /only as whole-hunt totals/);
  const aug = envelope(money({ kind: "month", month: "2026-08" }, { providerBilling: billing }));
  const line = aug.data.account.find(a => a.provider === "Anthropic (API)")!;
  assert.equal(line.amountUsd, null);
  assert.match(line.how, /No saved reading for August 2026/);
  for (const period of [{ kind: "whole-hunt" }, { kind: "last-24h" }] as const) {
    const r = refusal(money(period));
    assert.equal(r.code, "PERIOD_NOT_AVAILABLE");
    assert.equal(r.dependency, "DEP-PERIOD");
  }
});

/* ------------------------------------------------------------- routes */

test("query bounds: only one scope and at most one period, from a bounded vocabulary", () => {
  const q = (s: string) => validateV6Query(new URLSearchParams(s));
  assert.ok(q("scope=us").ok);
  assert.ok(q("scope=geo%3Aaz.zcta.85635&period=2026-09").ok);
  for (const bad of ["", "scope=us&scope=st%3Aaz", "scope=us&period=last-24h&period=whole-hunt", "scope=us&limit=5",
    "scope=us&period=last-week", "scope=us&period=2026-13", `scope=${"x".repeat(80)}`, "scope=AZ", "scope=st%3Aaz%20"])
    assert.equal(q(bad).ok, false, bad);
});

test("routes keep the Admin host 404, signed-session 401, bounded 400 and private no-store answers", async () => {
  for (const GET of [huntsGET, moneyGET]) {
    const path = "/api/admin/v6/x?scope=us";
    const publicRes = await GET(new NextRequest(`https://${PUBLIC_HOST}${path}`, { headers: { host: PUBLIC_HOST } }));
    assert.equal(publicRes.status, 404);
    const anon = await GET(new NextRequest(`https://${ADMIN_HOST}${path}`, { headers: { host: ADMIN_HOST } }));
    assert.equal(anon.status, 401);
    assert.match(anon.headers.get("cache-control") ?? "", /private, no-store/);
    await withAdminSessionKey(async () => {
      const cookie = await adminSessionCookie();
      const req = (suffix: string) => new NextRequest(`https://${ADMIN_HOST}${suffix}`, { headers: { host: ADMIN_HOST, cookie } });
      const bad = await GET(req("/api/admin/v6/x?scope=us&cursor=1"));
      assert.equal(bad.status, 400);
      assert.equal((await bad.json()).code, "UNKNOWN_PARAMETER");
      assert.equal((await GET(req("/api/admin/v6/x?scope=us&scope=us"))).status, 400);
      const saved = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
      delete process.env.WTP_CONTROL_PLANE_DATABASE_URL;
      try {
        const unread = await GET(req(path));
        assert.equal(unread.status, 503, "an unconfigured control plane is unread, never an empty section");
        assert.match(unread.headers.get("cache-control") ?? "", /private, no-store/);
      } finally { if (saved !== undefined) process.env.WTP_CONTROL_PLANE_DATABASE_URL = saved; }
    });
  }
});

/* --------------------------------------- the live adapter reads these sections */

test("an open v6 page picks up both sections through LiveSync and renders the original hunt from the real handler", async () => {
  const repos = createMemoryRepositories();
  await repos.adminConfig.put("current", { expansionScopes: [ORIGINAL] } as never, NOW);
  await repos.ownerSnapshots.put("current", { publishedAt: "2026-09-28T19:34:00.000Z", billingAttribution: attributionOf([ORIGINAL_ROW]),
    providerBilling: billing } as never, NOW);
  const open = async () => ({ ok: true as const, repos });
  const scope = "geo:az.zcta.85635";
  await withAdminSessionKey(async () => {
    const cookie = await adminSessionCookie();
    const handler = { "/api/admin/v6/hunts": v6HuntsSection, "/api/admin/v6/money": v6MoneySection } as const;
    const fetch: SyncFetch = async (url) => {
      const path = url.split("?")[0] as keyof typeof handler;
      const res = await v6MoneyHuntsGet(new NextRequest(`https://${ADMIN_HOST}${url}`, { headers: { host: ADMIN_HOST, cookie } }),
        { withSafety: path === "/api/admin/v6/money", project: handler[path] as never, open });
      return { status: res.status, json: async () => res.json() };
    };
    const sync = new LiveSync({ scope, fetch, schedule: () => () => {} });
    sync.onPulse({ revision: "r1", at: NOW, v6: { version: 1, actions: {}, sections: {
      hunts: { contract: "admin-v6/hunts@1", href: "/api/admin/v6/hunts", revision: "h1" },
      money: { contract: "admin-v6/money@1", href: "/api/admin/v6/money", revision: "m1" } } } });
    for (let i = 0; i < 20 && (sync.snapshot().hunts.phase !== "live" || sync.snapshot().money.phase !== "live"); i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(sync.snapshot().hunts.phase, "live");
    assert.equal(sync.snapshot().money.phase, "live");
    const ref = liveReference({ scope: { kind: "geo", type: "zcta", geoid: "85635", state: "az" }, observedAt: NOW });
    const bundle = buildLiveBundle(sync.snapshot(), ref, { lastCheckIn: null, lastUsefulProgress: null, roundStartedAt: null,
      lastRoundFinishedAt: null, nextRoundDueAt: null, runnerState: null, lanes: null } as never);
    const hunt = huntAt(indexPlaces(bundle.places.data ?? []), bundle.hunts.data ?? [], scope);
    assert.ok(hunt, "the Now and Money screens find the hunt at its own place key");
    assert.equal(hunt.limitUsd, 50);
    assert.equal(huntLeftUsd(hunt), 3.345158);
    const national = buildLiveBundle(sync.snapshot(), liveReference({ scope: { kind: "all" }, observedAt: NOW }),
      { lastCheckIn: null, lastUsefulProgress: null, roundStartedAt: null, lastRoundFinishedAt: null,
        nextRoundDueAt: null, runnerState: null, lanes: null } as never);
    const nationalPlaces = indexPlaces(national.places.data ?? []);
    assert.equal(huntsWithin(nationalPlaces, national.hunts.data ?? [], "us").length, 1,
      "the national view must not mislabel a saved hunt as absent");
    assert.equal(huntsWithin(nationalPlaces, national.hunts.data ?? [], "st:az").length, 1,
      "the saved filing state also locates its hunt");
    assert.deepEqual(bundle.money.data?.reconciliation, []);
    assert.equal(bundle.money.data?.account.length, 6);
  });
});

// Compile-time proof the backend shapes are the UI's shapes (tsc checks tests).
const _huntFits = (h: AdminV6HuntView): Hunt => h;
const _moneyFits = (m: AdminV6MoneyView): MoneyView => m;
void _huntFits; void _moneyFits;
