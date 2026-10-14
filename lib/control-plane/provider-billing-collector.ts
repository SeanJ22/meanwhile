/** Server-side GET-only reporting, invoked by the existing snapshot publisher.
 * Never persists raw responses, credentials or provider error bodies. */
import { createHash } from "node:crypto";
import { BILLING_KEYS, BILLING_SYNC_MS, REPORTING_PROVIDERS, retainBillingReading, type ProviderBillingSnapshot, type ProviderDay, type ProviderReading, type ReportingProvider } from "./provider-billing.ts";
import type { CostEntry } from "./cost.ts";
import { billingCollectorEnvironment } from "./provider-billing-environment.ts";

type Json = Record<string, unknown>;
const object = (v: unknown): Json => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const array = (v: unknown): Json[] => Array.isArray(v) ? v.map(object) : [];
const number = (v: unknown): number => { if ((typeof v !== "number" && typeof v !== "string") || v === "" || !Number.isFinite(Number(v))) throw new Error("REPORT_SCHEMA"); return Number(v); };
const text = (v: unknown): string => typeof v === "string" ? v : "";
const safeId = (v: unknown, env: Readonly<Record<string, string | undefined>>): string => {
  const id = text(v);
  if (!id) return "";
  return Object.values(env).includes(id) ? `key-${createHash("sha256").update(id).digest("hex").slice(0,12)}` : id.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0,100);
};
const dayOf = (v: unknown): string => { const day = text(v).slice(0, 10); if (!/^\d{4}-\d\d-\d\d$/.test(day)) throw new Error("REPORT_SCHEMA"); return day; };
const add = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) ?? 0) + value);
const usdDays = (byDay: ReadonlyMap<string, number>): ProviderDay[] => [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, usd]) => ({ day, usd, usage: [] }));
async function eachLimited<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) await run(items[next++]); }));
}
const NEON_METRICS = ["compute_unit_seconds", "root_branch_bytes_month", "child_branch_bytes_month", "instant_restore_bytes_month", "snapshot_storage_bytes_month", "public_network_transfer_bytes", "private_network_transfer_bytes", "extra_branches_month"];

export interface BillingCollectorInput {
  readonly now: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly previous?: ProviderBillingSnapshot | null;
  readonly costs?: readonly CostEntry[] | null;
  readonly fetcher?: typeof fetch;
}

export async function collectProviderBilling(input: BillingCollectorInput): Promise<ProviderBillingSnapshot> {
  let env: Readonly<Record<string, string | undefined>>;
  let environmentError = false;
  try { env = input.env ?? billingCollectorEnvironment(); }
  catch { env = {}; environmentError = true; }
  const fetcher = input.fetcher ?? fetch;
  const start = input.now.slice(0,7) + "-01T00:00:00.000Z";
  const base = (provider: ReportingProvider): ProviderReading => ({ provider, attemptedAt: input.now, syncedAt: null, periodStart: start, periodEnd: input.now, status: "MISSING_ACCESS", reportedUsd: null, estimatedUsd: null, credits: null, units: [], days: [], accountIds: [], existingLimits: [], source: "", detail: "", error: null });
  // A shared deadline and bounded pagination prevent a billing outage delaying civic publication.
  const signal = AbortSignal.timeout(35_000);
  const get = async (url: string, headers: Record<string,string>): Promise<Json> => {
    let response: Response;
    try { response = await fetcher(url, { method: "GET", headers, signal, redirect: "error" }); }
    catch { throw new Error("REPORT_NETWORK_OR_TIMEOUT"); }
    if (!response.ok) throw new Error(`REPORT_HTTP_${response.status}`);
    try { const value: unknown = await response.json(); return Array.isArray(value) ? { items: value } : object(value); } catch { throw new Error("REPORT_SCHEMA"); }
  };
  const need = (name: string): string => { const value = env[name]?.trim(); if (!value) throw new Error(`MISSING_${name}`); return value; };
  const utcDays: string[] = [];
  for (let t = Date.parse(start); t < Date.parse(input.now); t += 86_400_000) utcDays.push(new Date(t).toISOString().slice(0, 10));
  // A provider that reports the whole month charged nothing on a day it does not list.
  const monthDays = () => new Map<string, number>(utcDays.map(day => [day, 0]));
  const reported = (r: ProviderReading, values: Partial<ProviderReading>): ProviderReading => ({ ...r, status: "REPORTED", syncedAt: input.now, ...values });
  async function anthropic(r: ProviderReading): Promise<ProviderReading> {
    const headers = { "x-api-key": need(BILLING_KEYS["anthropic-api"]), "anthropic-version": "2023-06-01" };
    const pages = async (path: string, groups: string[]): Promise<Json[]> => {
      const params = new URLSearchParams({ starting_at: start, ending_at: input.now, bucket_width: "1d", limit: "31" });
      groups.forEach(g => params.append("group_by[]", g));
      const rows: Json[] = [], seen = new Set<string>();
      for (let page = 0; page < 50; page++) {
        const d = await get(`https://api.anthropic.com/v1/organizations/${path}?${params}`, headers);
        if (!Array.isArray(d.data) || typeof d.has_more !== "boolean") throw new Error("REPORT_SCHEMA");
        rows.push(...array(d.data));
        if (!d.has_more) return rows;
        const next = text(d.next_page); if (!next || seen.has(next)) throw new Error("REPORT_PAGINATION");
        seen.add(next); params.set("page", next);
      }
      throw new Error("REPORT_INCOMPLETE");
    };
    const [costs, usage, organization] = await Promise.all([pages("cost_report", ["description", "workspace_id"]), pages("usage_report/messages", ["model", "api_key_id", "workspace_id"]), get("https://api.anthropic.com/v1/organizations/me", headers)]);
    let usd = 0, tokenUsd = 0;
    const byDay = monthDays();
    for (const bucket of costs) for (const row of array(bucket.results)) {
      if (text(row.currency).toUpperCase() !== "USD") throw new Error("REPORT_CURRENCY");
      const dollars = number(row.amount) / 100; usd += dollars; add(byDay, dayOf(bucket.starting_at), dollars);
      if (row.cost_type === "tokens") tokenUsd += dollars;
    }
    const usageRows = usage.flatMap(b => array(b.results));
    const units = new Map<string,number>();
    for (const row of usageRows) for (const key of ["uncached_input_tokens", "cache_read_input_tokens", "output_tokens"]) {
      if (row[key] !== undefined) { const label = `${text(row.model)} ${key}`; units.set(label, (units.get(label) ?? 0) + number(row[key])); }
    }
    for (const row of usageRows) for (const [key,value] of Object.entries(object(row.cache_creation))) { const label = `${text(row.model)} cache_creation ${key}`; units.set(label, (units.get(label) ?? 0) + number(value)); }
    return reported(r, { reportedUsd: usd, units: [{ label: "Token usage cost (part of total)", value: tokenUsd, unit: "USD" }, ...[...units].map(([label,value]) => ({ label, value, unit: "tokens" }))], days: usdDays(byDay), accountIds: [...new Set([safeId(organization.id,env), ...usageRows.flatMap(x => [safeId(x.workspace_id,env),safeId(x.api_key_id,env)])].filter(Boolean))], source: "Anthropic Usage and Cost Admin API", detail: "Organization accrued costs in USD (provider cents converted). Includes non-token services separately from the token subtotal. Priority-tier costs are excluded by the provider. This is not a final invoice or the hunt's own spending; provider totals are never added to request-ledger estimates." });
  }
  async function exa(r: ProviderReading): Promise<ProviderReading> {
    if (!env.EXA_SERVICE_API_KEY?.trim()) return searchEstimate(r, "api.exa.ai", "Exa", "MISSING_EXA_SERVICE_API_KEY");
    const headers = { "x-api-key": need(BILLING_KEYS.exa) }, host = "https://admin-api.exa.ai/team-management";
    const keys = await get(`${host}/api-keys`, headers);
    if (!Array.isArray(keys.apiKeys)) throw new Error("REPORT_SCHEMA");
    const entries = array(keys.apiKeys); if (entries.length > 100) throw new Error("REPORT_INCOMPLETE");
    const units: ProviderReading["units"][number][] = [], limits: string[] = [], ids: string[] = [];
    let total = 0;
    const byDay = new Map<string, number>();
    const usd = async (id: string, from: string, to: string) => number((await get(`${host}/api-keys/${encodeURIComponent(id)}/usage?${new URLSearchParams({ start_date: from, end_date: to })}`, headers)).total_cost_usd);
    // At most four requests at once; no search requests and no key/budget mutations.
    for (const key of entries) {
      const id = text(key.id); if (!id) throw new Error("REPORT_SCHEMA");
      const amount = await usd(id, start, input.now); total += amount;
      await eachLimited(utcDays, 4, async day => {
        const next = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString();
        add(byDay, day, await usd(id, `${day}T00:00:00.000Z`, next < input.now ? next : input.now));
      });
      const label = safeId(id,env); ids.push(label);
      units.push({ label: `API key ${label}`, value: amount, unit: "USD" });
      if (key.budgetCents !== null && key.budgetCents !== undefined) limits.push(`${label}: existing provider budget $${(number(key.budgetCents)/100).toFixed(2)}; over budget: ${key.isOverBudget === true}`);
      if (key.rateLimit !== null && key.rateLimit !== undefined) limits.push(`${label}: ${number(key.rateLimit)} requests/second`);
    }
    return reported(r, { reportedUsd: total, units, days: usdDays(byDay), accountIds: ids, existingLimits: limits, source: "Exa Team Management per-key usage API", detail: "All team API keys, for the month and for each day; per-key amounts are parts of this total, not additional charges. Existing provider limits are read only." });
  }
  async function neon(r: ProviderReading): Promise<ProviderReading> {
    const headers = { Authorization: `Bearer ${need(BILLING_KEYS.neon)}` }, host = "https://console.neon.tech/api/v2";
    const orgs = env.NEON_BILLING_ORG_ID ? [{ id: env.NEON_BILLING_ORG_ID }] : array((await get(`${host}/users/me/organizations`, headers)).organizations);
    if (!orgs.length) throw new Error("REPORT_ORGANIZATION_ACCESS");
    const metrics = new Map<string,number>(), compute = new Map<string,number>(), transfer = new Map<string,number>(), ids: string[] = [], seen = new Set<string>();
    for (const org of orgs) {
      const id = text(org.id); if (!id) throw new Error("REPORT_SCHEMA"); ids.push(id);
      const params = new URLSearchParams({ org_id: id, from: start, to: input.now, granularity: "daily", metrics: NEON_METRICS.join(","), limit: "100" });
      let complete = false;
      for (let page = 0; page < 50; page++) {
        const data = await get(`${host}/consumption_history/v2/projects?${params}`, headers);
        if (!Array.isArray(data.projects)) throw new Error("REPORT_SCHEMA");
        const projects = array(data.projects);
        for (const project of projects) {
          const projectId = text(project.project_id); if (!projectId || seen.has(projectId)) throw new Error("REPORT_PAGINATION"); seen.add(projectId); ids.push(projectId);
          for (const period of array(project.periods)) for (const bucket of array(period.consumption)) {
            const day = dayOf(bucket.timeframe_start);
            for (const metric of array(bucket.metrics)) {
              const name = text(metric.metric_name), value = number(metric.value);
              add(metrics, `${projectId} ${name}`, value);
              if (name === "compute_unit_seconds") add(compute, day, value);
              if (name.endsWith("network_transfer_bytes")) add(transfer, day, value);
            }
          }
        }
        const cursor = text(object(data.pagination).cursor);
        if (!cursor || projects.length === 0) { complete = true; break; }
        if (cursor === params.get("cursor")) throw new Error("REPORT_PAGINATION"); params.set("cursor", cursor);
      }
      if (!complete) throw new Error("REPORT_INCOMPLETE");
    }
    const days = [...new Set([...compute.keys(), ...transfer.keys()])].sort().map(day => ({ day, usd: null,
      usage: [{ label: "Compute", value: (compute.get(day) ?? 0) / 3600, unit: "CU-hours" }, { label: "Data transfer", value: transfer.get(day) ?? 0, unit: "bytes" }] }));
    return reported(r, { units: [...metrics].map(([label,value]) => ({ label, value, unit: label.endsWith("compute_unit_seconds") ? "CU-seconds" : label.endsWith("extra_branches_month") ? "branch-hours" : label.includes("bytes_month") ? "byte-hours" : "bytes" })), days, accountIds: ids, source: "Neon consumption_history/v2/projects", detail: "Provider-reported invoice-aligned consumption. No invoice dollars, discounts or credit balance are returned; dollar total remains unknown rather than assuming a plan rate. Shared database costs are platform costs, not hunt token spending." });
  }
  async function github(r: ProviderReading): Promise<ProviderReading> {
    const headers = { Authorization: `Bearer ${need(BILLING_KEYS.github)}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" };
    const account = env.GITHUB_BILLING_ORG || text((await get("https://api.github.com/user", headers)).login);
    if (!account) throw new Error("REPORT_ACCOUNT_ACCESS");
    const prefix = env.GITHUB_BILLING_ORG ? "organizations" : "users";
    const params = new URLSearchParams({ year: start.slice(0,4), month: String(Number(start.slice(5,7))) });
    const data = await get(`https://api.github.com/${prefix}/${encodeURIComponent(account)}/settings/billing/usage?${params}`, headers);
    if (!Array.isArray(data.usageItems)) throw new Error("REPORT_SCHEMA");
    const byDay = monthDays(), units = new Map<string, { value: number; unit: string }>();
    let net = 0, discount = 0;
    for (const x of array(data.usageItems)) {
      const amount = number(x.netAmount); net += amount; discount += number(x.discountAmount); add(byDay, dayOf(x.date), amount);
      const label = `${text(x.product)} / ${text(x.sku)}`;
      units.set(label, { value: (units.get(label)?.value ?? 0) + number(x.quantity), unit: text(x.unitType) });
    }
    return reported(r, { reportedUsd: net, credits: { amount: discount, kind: "DISCOUNT_USD", unit: "USD" }, units: [...units].map(([label, u]) => ({ label, ...u })), days: usdDays(byDay), accountIds: [account], source: "GitHub billing usage report", detail: "Provider net metered usage after reported discounts. Discounts are included in net cost and must not be deducted twice. Fixed subscriptions and unreported products require invoice facts. Platform cost, not hunt token spending." });
  }
  function searchEstimate(r: ProviderReading, host: string, name: string, error: string | null = null): ProviderReading {
    const rows = input.costs?.filter(c => c.recordedAt >= start && c.recordedAt <= input.now && c.source === host);
    const known = rows !== undefined && rows.every(c => c.cost.usd !== null);
    return reported(r, { status: "ESTIMATED", error, estimatedUsd: known ? rows.reduce((n,c) => n + (c.cost.usd ?? 0),0) : null, units: rows ? [{ label: "Recorded search requests", value: rows.reduce((n,c) => n + (c.cost.requestCount ?? 0),0), unit: "requests" }] : [], source: `Internal ${name} request ledger`, detail: `Estimate from recorded request prices, limited to this system's recorded requests; not the provider's billing total or prepaid balance. ${name === "Exa" ? "Per-key provider billing awaits EXA_SERVICE_API_KEY service access." : "Public Search API documentation provides no account billing-read endpoint. Console balance, credits and monthly limits remain manual billing facts."} ${rows === undefined ? "The request ledger was not read, so the estimate is unknown." : ""} No search call is made to collect billing.` });
  }
  async function brave(r: ProviderReading): Promise<ProviderReading> {
    return searchEstimate(r, "api.search.brave.com", "Brave");
  }
  async function netlify(r: ProviderReading): Promise<ProviderReading> {
    const headers = { Authorization: `Bearer ${need(BILLING_KEYS.netlify)}` };
    const host = "https://api.netlify.com/api/v1", siteId = need("NETLIFY_SITE_ID");
    const site = await get(`${host}/sites/${encodeURIComponent(siteId)}`, headers);
    if (!text(site.account_id)) throw new Error("REPORT_SCHEMA");
    const account = await get(`${host}/accounts/${encodeURIComponent(text(site.account_id))}`, headers);
    const included = typeof account.plan_credits === "number" ? number(account.plan_credits) : null;
    const periodStart = text(account.current_usage_period_start) || start;
    let deploys = 0, complete = false;
    const byDay = new Map<string, number>();
    if (included !== null) for (let page = 1; page <= 50; page++) {
      const data = await get(`${host}/sites/${encodeURIComponent(text(site.id))}/deploys?production=true&state=ready&page=${page}&per_page=100`, headers);
      if (!Array.isArray(data.items)) throw new Error("REPORT_SCHEMA");
      const rows = array(data.items);
      for (const d of rows) if (Date.parse(text(d.published_at)) >= Date.parse(periodStart) && Date.parse(text(d.published_at)) <= Date.parse(input.now) && d.context === "production") { deploys++; add(byDay, dayOf(d.published_at), 1); }
      if (rows.length < 100 || rows.some(d => Date.parse(text(d.created_at)) < Date.parse(periodStart))) { complete = true; break; }
    }
    if (included !== null && !complete) throw new Error("REPORT_INCOMPLETE");
    const limits: string[] = [];
    if (account.ai_usage_limit_enforced === true) limits.push(`Existing Netlify AI credit limit: ${number(account.ai_usage_limit_credits)} credits (Netlify AI services only)`);
    if (Array.isArray(account.usages_exceeded) && account.usages_exceeded.length) limits.push("Netlify reports exceeded usage allowances; inspect the billing console.");
    return reported(r, { status: "ESTIMATED", periodStart, credits: included === null ? null : { amount: included, kind: "INCLUDED", unit: "Netlify credits; not remaining balance" },
      units: included === null ? [] : [{ label: "Successful published production deploys this site", value: deploys, unit: "deploys" }, { label: "Deploy component estimate at 15 credits/deploy", value: deploys * 15, unit: "credits (part of total usage)" }],
      days: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, usd: null, usage: [{ label: "Deploy credits (estimate)", value: count * 15, unit: "credits" }] })),
      existingLimits: limits, accountIds: [text(site.id),text(site.account_id)], source: "Netlify public account/site/deploy APIs; published credit-plan rates",
      detail: "Included credits are read from the account; deploy credits are an estimate from this site's recorded production deploys at the published credit-plan rate. This omits other sites, compute, bandwidth and requests. The published OpenAPI contract exposes no total account credit-consumption or billing-total endpoint. Remaining credits and dollar total stay unknown; no undocumented billing endpoint is assumed." });
  }
  const collectors = { "anthropic-api": anthropic, neon, exa, github, brave, netlify };
  const readings = await Promise.all(REPORTING_PROVIDERS.map(async provider => {
    const previous = input.previous?.readings.find(r => r.provider === provider);
    if (previous && previous.attemptedAt.slice(0,7) === input.now.slice(0,7) && Date.parse(input.now)-Date.parse(previous.attemptedAt) < BILLING_SYNC_MS) return previous;
    let candidate: ProviderReading;
    try {
      if (environmentError) throw new Error("REPORT_ENV_FILE_UNREADABLE");
      candidate = await collectors[provider](base(provider));
    }
    catch (error) {
      // Whitelist our codes only. Raw response bodies/URLs/headers are never logged or saved.
      const message = error instanceof Error && /^(MISSING_[A-Z_]+|REPORT_[A-Z_0-9]+)$/.test(error.message) ? error.message : "REPORT_FAILED";
      candidate = { ...base(provider), status: message.startsWith("MISSING_") ? "MISSING_ACCESS" : "ERROR", error: message, detail: "Reporting unavailable; this does not block hunt launch or change its budget." };
    }
    return retainBillingReading(candidate, previous);
  }));
  return { formatVersion: 1, collectedAt: input.now, readings };
}
