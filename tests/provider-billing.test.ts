import test from "node:test";
import assert from "node:assert/strict";
import { collectProviderBilling } from "../lib/control-plane/provider-billing-collector.ts";
import { BILLING_SECRET_NAMES, billingTotal, withoutBillingSecrets } from "../lib/control-plane/provider-billing.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { billingCollectorEnvironment } from "../lib/control-plane/provider-billing-environment.ts";
import { admittedRuntimeChildEnvironment } from "../lib/civic-data/runtime-authority.ts";
import { providerBillingAttribution } from "../lib/control-plane/provider-billing-attribution.ts";

const now = "2026-09-26T08:00:00.000Z";
const env = Object.fromEntries(BILLING_SECRET_NAMES.map(k => [k, `secret-${k}`]));
env.NETLIFY_SITE_ID = "test-site";
const calls: URL[] = [];
function response(data: unknown) { return Response.json(data); }
const fixtureFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  assert.equal(init?.method, "GET", "collector must never mutate budgets, keys or provider settings");
  const u = new URL(String(url)); calls.push(u);
  if (u.hostname === "api.anthropic.com" && u.pathname.endsWith("/me")) return response({ id: "org-anthropic" });
  if (u.pathname.endsWith("cost_report")) return response({ data: [{ starting_at: u.searchParams.has("page") ? "2026-09-26T00:00:00Z" : "2026-09-25T00:00:00Z", results: [{ amount: "123.45", currency: "USD", cost_type: "tokens" }, { amount: "20", currency: "USD", cost_type: "web_search" }] }], has_more: !u.searchParams.has("page"), next_page: u.searchParams.has("page") ? null : "second" });
  if (u.pathname.endsWith("usage_report/messages")) return response({ data: [{ starting_at: "2026-09-25T00:00:00Z", results: [{ model: "claude-opus-5", api_key_id: "key-one", workspace_id: "workspace-one", uncached_input_tokens: 42, cache_read_input_tokens: 100, output_tokens: 2 }] }], has_more: false });
  if (u.hostname === "admin-api.exa.ai" && u.pathname.endsWith("/api-keys")) return response({ apiKeys: [{ id: "exa-1", budgetCents: 1000, isOverBudget: false, rateLimit: 5 }] });
  if (u.hostname === "admin-api.exa.ai") return response({ total_cost_usd: u.searchParams.get("start_date") === "2026-09-01T00:00:00.000Z" && u.searchParams.get("end_date") === now ? 2.5 : 0.1, period: { start: now, end: now } });
  if (u.pathname.endsWith("/organizations")) return response({ organizations: [{ id: "org-neon" }] });
  if (u.pathname.endsWith("/consumption_history/v2/projects")) return response(u.searchParams.has("cursor") ? { projects: [] } : { projects: [{ project_id: "proj-1", periods: [{ consumption: [{ timeframe_start: "2026-09-24T00:00:00Z", metrics: [{ metric_name: "compute_unit_seconds", value: 3600 }, { metric_name: "snapshot_storage_bytes_month", value: 75 }, { metric_name: "public_network_transfer_bytes", value: 2e9 }] }] }] }], pagination: { cursor: "proj-1" } });
  if (u.hostname === "api.github.com" && u.pathname === "/user") return response({ login: "owner" });
  if (u.hostname === "api.github.com" && u.pathname === "/users/owner/settings/billing/usage") return response({ usageItems: [
    { date: "2026-09-24T00:00:00Z", product: "Actions", sku: "linux", quantity: 60, unitType: "minutes", netAmount: 1, discountAmount: 2 },
    { date: "2026-09-25T00:00:00Z", product: "Actions", sku: "linux", quantity: 40, unitType: "minutes", netAmount: 2, discountAmount: 0 }] });
  if (u.hostname === "api.netlify.com" && u.pathname === "/api/v1/sites/test-site") return response({ id: "site-1", account_id: "team-1" });
  if (u.hostname === "api.netlify.com" && u.pathname === "/api/v1/accounts/team-1") return response({ plan_credits: 3000, current_usage_period_start: "2026-09-17T00:00:00.000Z" });
  if (u.hostname === "api.netlify.com" && u.pathname === "/api/v1/sites/site-1/deploys") return response([
    { published_at: "2026-09-20T10:00:00Z", created_at: "2026-09-20T09:58:00Z", context: "production" },
    { published_at: "2026-09-20T12:00:00Z", created_at: "2026-09-20T11:58:00Z", context: "production" },
    { published_at: "2026-09-25T12:00:00Z", created_at: "2026-09-25T11:58:00Z", context: "production" }]);
  throw new Error("Unexpected request");
}) as typeof fetch;

test("provider reporting uses documented GETs, cents/discounts correctly, and preserves historical model labels", async () => {
  calls.length = 0;
  const report = await collectProviderBilling({ now, env, costs: [], fetcher: fixtureFetch });
  const by = (key: string) => report.readings.find(r => r.provider === key)!;
  assert.ok(report.readings.every(r => r.error === null));
  assert.ok(Math.abs(by("anthropic-api").reportedUsd! - 2.869) < 1e-9);
  assert.ok(Math.abs(by("anthropic-api").units[0].value - 2.469) < 1e-9);
  assert.ok(by("anthropic-api").units.some(u => u.label.startsWith("claude-opus-5 ")));
  assert.equal(by("exa").reportedUsd, 2.5);
  assert.match(by("exa").existingLimits[0], /existing provider budget \$10.00/);
  assert.equal(by("github").reportedUsd, 3, "net already includes the discount");
  assert.equal(by("github").credits?.amount, 2);
  assert.equal(by("neon").reportedUsd, null, "consumption metrics are not invoice dollars");
  assert.equal(by("neon").units.find(u => u.label.endsWith("snapshot_storage_bytes_month"))?.value, 75);
  assert.equal(by("netlify").reportedUsd, null, "site access never proves access to billing");
  const day = (key: string, d: string) => by(key).days?.find(x => x.day === d);
  assert.equal(by("anthropic-api").days?.length, 26, "every UTC day of the month so far, zero when the provider lists no charge");
  assert.ok(Math.abs(day("anthropic-api", "2026-09-25")!.usd! - 1.4345) < 1e-9);
  assert.equal(day("anthropic-api", "2026-09-01")?.usd, 0);
  assert.equal(by("exa").days?.length, 26);
  assert.ok(Math.abs(day("exa", "2026-09-26")!.usd! - 0.1) < 1e-9, "each day is its own provider read");
  assert.equal(day("github", "2026-09-24")?.usd, 1);
  assert.equal(day("github", "2026-09-25")?.usd, 2);
  assert.deepEqual(by("github").units, [{ label: "Actions / linux", value: 100, unit: "minutes" }]);
  assert.deepEqual(day("neon", "2026-09-24")?.usage, [{ label: "Compute", value: 1, unit: "CU-hours" }, { label: "Data transfer", value: 2e9, unit: "bytes" }]);
  assert.equal(day("neon", "2026-09-24")?.usd, null, "Neon reports usage, not dollars");
  assert.deepEqual(by("netlify").days?.map(d => [d.day, d.usage[0].value]), [["2026-09-20", 30], ["2026-09-25", 15]]);
  assert.ok(calls.some(u => u.pathname.includes("/consumption_history/v2/")));
  assert.ok(calls.every(u => !u.href.includes("secret-")));
  assert.doesNotMatch(JSON.stringify(report), /secret-/);
  const total = billingTotal(report.readings, "2026-09-01T00:00:00.000Z", now);
  assert.ok(Math.abs(total.combinedUsd - 8.369) < 1e-9);
  assert.equal(total.missing, 2);
});

test("a fresh cached sync makes no provider calls; failure retains last report and its actual period", async () => {
  const previous = await collectProviderBilling({ now, env, costs: [], fetcher: fixtureFetch });
  const forbidden = (async () => { throw new Error("secret-provider-response") }) as typeof fetch;
  const cached = await collectProviderBilling({ now: "2026-09-26T08:30:00.000Z", env, previous, fetcher: forbidden });
  assert.deepEqual(cached.readings, previous.readings);
  const failed = await collectProviderBilling({ now: "2026-10-01T08:00:00.000Z", env, previous, fetcher: forbidden });
  const held = failed.readings.find(r => r.provider === "anthropic-api")!;
  assert.equal(held.syncedAt, now);
  assert.equal(held.periodStart, "2026-09-01T00:00:00.000Z");
  assert.equal(held.error, "REPORT_NETWORK_OR_TIMEOUT");
  assert.doesNotMatch(JSON.stringify(failed), /secret-provider-response/);
  assert.equal(billingTotal(failed.readings, "2026-10-01T00:00:00.000Z", "2026-10-01T08:00:00.000Z").reportedUsd, 0);
});

test("missing reporting credentials and unread request ledger remain unknown; search keys are unchanged", async () => {
  const report = await collectProviderBilling({ now, env: { EXA_API_KEY: "search-key", BRAVE_SEARCH_API_KEY: "brave-key", NEON_API_KEY: "db-admin", NETLIFY_AUTH_TOKEN: "deploy", GH_TOKEN: "release", NETLIFY_SITE_ID: "test-site" }, fetcher: fixtureFetch });
  assert.deepEqual(report.readings.filter(r => r.provider !== "brave").map(r => [r.provider, r.error]), [
    ["anthropic-api", "MISSING_ANTHROPIC_ADMIN_API_KEY"], ["neon", "MISSING_NEON_BILLING_API_KEY"], ["exa", "MISSING_EXA_SERVICE_API_KEY"],
    ["github", "MISSING_GITHUB_BILLING_TOKEN"], ["netlify", "MISSING_NETLIFY_BILLING_TOKEN"]], "each bill is read only with its own billing key, never another token");
  assert.equal(report.readings.find(r => r.provider === "brave")?.estimatedUsd, null);
  const stripped = withoutBillingSecrets<Record<string,string | undefined>>({ ...env, EXA_API_KEY: "search-key", BRAVE_SEARCH_API_KEY: "brave-key" });
  for (const name of BILLING_SECRET_NAMES) assert.equal(stripped[name], undefined);
  assert.equal(stripped.EXA_API_KEY, "search-key");
  assert.equal(stripped.BRAVE_SEARCH_API_KEY, "brave-key");
});

test("an incomplete report cannot silently replace a previously complete provider total", async () => {
  const previous = await collectProviderBilling({ now, env, costs: [], fetcher: fixtureFetch });
  const repeating = (async (url: string | URL | Request, init?: RequestInit) => new URL(String(url)).hostname === "api.anthropic.com" ? response({ data: [], has_more: true, next_page: "same" }) : fixtureFetch(url,init)) as typeof fetch;
  const report = await collectProviderBilling({ now: "2026-09-26T10:00:00.000Z", env, previous, fetcher: repeating });
  const a = report.readings.find(r => r.provider === "anthropic-api")!;
  assert.equal(a.error, "REPORT_PAGINATION");
  assert.equal(a.reportedUsd, previous.readings[0].reportedUsd);
});

test("collector reloads the exact absolute file after rotation; siblings receive neither reporting keys nor its path", () => {
  const dir = mkdtempSync(join(tmpdir(), "billing-env-")), file = join(dir,".env.local");
  try {
    writeFileSync(file, "ANTHROPIC_ADMIN_API_KEY=first\nEXA_API_KEY=must-not-reload\n");
    const parent = { ...process.env, WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "a".repeat(40), WTP_BILLING_ENV_FILE: file, ANTHROPIC_ADMIN_API_KEY: "stale", EXA_API_KEY: "existing-search-key" };
    const worker = admittedRuntimeChildEnvironment({ parentEnv: parent, capability: "RESEARCH_CYCLE" });
    assert.equal(worker.ANTHROPIC_ADMIN_API_KEY, undefined);
    assert.equal(worker.WTP_BILLING_ENV_FILE, undefined);
    const collector = admittedRuntimeChildEnvironment({ parentEnv: parent, capability: "CONSOLE_PUBLISHER", billingCollector: true });
    assert.equal(billingCollectorEnvironment(collector).ANTHROPIC_ADMIN_API_KEY,"first");
    writeFileSync(file, "ANTHROPIC_ADMIN_API_KEY=rotated\n");
    const loaded = billingCollectorEnvironment(collector);
    assert.equal(loaded.ANTHROPIC_ADMIN_API_KEY,"rotated");
    assert.equal(loaded.EXA_API_KEY,"existing-search-key");
    assert.equal(loaded.EXA_SERVICE_API_KEY,undefined);
    assert.throws(() => billingCollectorEnvironment({ ...parent, WTP_BILLING_ENV_FILE: "relative.env" }), /NOT_ABSOLUTE/);
  } finally { rmSync(dir,{ recursive:true,force:true }); }
});

test("hunt attribution does not add account reports or count shared reservation keys twice", async () => {
  const report = await collectProviderBilling({ now, env, costs: [], fetcher: fixtureFetch });
  const scope = { key:"zcta:2020/85635", receiptId:"scope-receipt", budgetStartedAt:"2026-09-25T00:00:00.000Z", budgetUsd:50, geography:{label:"85635"} };
  const row = (id:string, source:string, usd:number, assigned=true) => ({attemptId:id,source,recordedAt:now,assignmentKeys:assigned?[scope.key]:[],assignmentRefs:assigned?[{key:scope.key,ref:scope.receiptId}]:[],cost:{usd}});
  const reading = providerBillingAttribution({ now, readings:report.readings, scopes:[scope] as never,
    attempts:[{id:"anth",worker:{provider:"anthropic",version:"claude-haiku-4-5-20251001"}},{id:"outside",worker:{provider:"anthropic",version:"claude-opus-5"}}],
    costs:[row("anth","source.gov",2),row("outside","source.gov",3,false),row("exa","api.exa.ai",0.5)] as never,
    holds:{one:{settled:null,usd:4,keys:[`send:${scope.key}@${scope.budgetStartedAt}`,`area:${scope.key}@${scope.budgetStartedAt}`]}} as never });
  assert.equal(reading.hunts![0].anthropicUsd,2);
  assert.equal(reading.hunts![0].otherUsd,0.5);
  assert.equal(reading.hunts![0].reservedUsd,4);
  assert.equal(reading.providers[0].huntUsd,2);
  assert.equal(reading.providers[0].otherRecordedUsd,3);
  assert.ok(Math.abs(reading.providers[0].differenceUsd!-(2.469-5))<1e-9);
});

test("missing Exa service access uses priced requests as estimates, without searching or claiming provider charges", async () => {
  const report = await collectProviderBilling({now,env:{},costs:[{source:"api.exa.ai",recordedAt:now,cost:{usd:0.05,requestCount:1}}] as never});
  const exa=report.readings.find(r=>r.provider==="exa")!;
  assert.equal(exa.status,"ESTIMATED");
  assert.equal(exa.reportedUsd,null);
  assert.equal(exa.estimatedUsd,0.05);
  assert.equal(exa.error,"MISSING_EXA_SERVICE_API_KEY");
  assert.equal(billingTotal(report.readings,"2026-09-01T00:00:00.000Z",now).estimatedUsd,0.05);
});
