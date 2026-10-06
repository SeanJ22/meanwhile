/** Read-only vendor reporting. A provider's monthly amount is never divided into guessed days. */
import { easternDay } from "./periods.ts";
import { billingStale, type ProviderBillingSnapshot } from "../provider-billing.ts";
import { billingCollectorEnvironment } from "../provider-billing-environment.ts";
import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";

export interface VendorSpendLine {
  readonly vendor: string; readonly todayUsd: number | null; readonly monthUsd: number | null;
  readonly dailyLimitUsd: number | null; readonly monthlyLimitUsd: number | null;
  readonly todayPeriodStart?: string; readonly todayPeriodEnd?: string;
  readonly todayBytes: number | null; readonly monthBytes: number | null; readonly detail: string;
}
export interface VendorSpendReading { readonly day: string; readonly month: string; readonly readAt: string; readonly vendors: readonly VendorSpendLine[] }
export const VENDOR_LEDGER_SQL = `SELECT
  sum((record->'cost'->>'usd')::float8) FILTER (WHERE (recorded_at AT TIME ZONE 'America/New_York')::date = $1::date) AS today,
  sum((record->'cost'->>'usd')::float8) AS month,
  count(*) FILTER (WHERE record->'cost'->>'usd' IS NULL AND (recorded_at AT TIME ZONE 'America/New_York')::date = $1::date) AS today_unpriced,
  count(*) FILTER (WHERE record->'cost'->>'usd' IS NULL) AS month_unpriced
FROM cp_log_costs WHERE recorded_at >= ($2::date::timestamp AT TIME ZONE 'America/New_York') AND recorded_at <= $3::timestamptz
AND record->>'role' <> 'DISCOVERY_SEARCH' AND (record->>'role' <> 'ACQUIRER' OR record->'cost'->>'usd' IS NOT NULL)`;
const amount = (n: unknown): number | null => (typeof n === "number" || typeof n === "string") && n !== "" && Number.isFinite(Number(n)) && Number(n) >= 0 ? Number(n) : null;

export async function readVendorSpend(input: {
  now: string; sql: Sql; billing?: ProviderBillingSnapshot | null; dailyLimitUsd: number | null;
  transfer: { kind: string; days: readonly { day: string; responseBytes: number; requestBytes: number }[] };
  env?: Readonly<Record<string,string|undefined>>; fetcher?: typeof fetch;
}): Promise<VendorSpendReading> {
  const day = easternDay(new Date(input.now)), month = day.slice(0,7);
  const vendors: VendorSpendLine[] = ["Anthropic","Neon","DigitalOcean","Netlify","GitHub"].map(vendor=>({vendor,todayUsd:null,monthUsd:null,dailyLimitUsd:null,monthlyLimitUsd:null,todayBytes:null,monthBytes:null,detail:"No dollar reading is available. No limit is inferred."}));
  try {
    const [row] = await boundedQuery(input.sql,{operation:"cp_log_costs.vendor_spend",callClass:"PAGE"},VENDOR_LEDGER_SQL,[day,month+"-01",input.now]) as readonly Record<string,unknown>[];
    vendors[0] = {...vendors[0],todayUsd:Number(row?.today_unpriced)===0?amount(row?.today):null,monthUsd:Number(row?.month_unpriced)===0?amount(row?.month):null,dailyLimitUsd:input.dailyLimitUsd,detail:"Recorded paid model charges in Eastern days and months. A missing price makes the amount unknown. The daily limit is the existing rolling 24-hour cap, not a new calendar-day budget."};
  } catch { vendors[0] = {...vendors[0],detail:"The cost ledger could not be read."}; }
  for (const [index,provider] of [[1,"neon"],[3,"netlify"],[4,"github"]] as const) {
    const r=input.billing?.readings.find(r=>r.provider===provider);
    // Saved provider periods are UTC; require an exact current-month start, and never reuse a failed or stale reading.
    const usable=r && r.status==="REPORTED" && !billingStale(r,input.now) && r.periodStart===month+"-01T00:00:00.000Z" && r.periodEnd<=input.now && !r.error;
    vendors[index]={...vendors[index],monthUsd:usable?amount(r.reportedUsd):null,detail:r ? `${r.detail} Provider billing period: ${r.periodStart} to ${r.periodEnd}. ${r.error??""} No daily dollars are reported in this saved reading. Existing provider limits: ${r.existingLimits.join("; ")||"not reported"}.` : "No saved provider billing reading. Billing access or a provider dollar-total endpoint is unavailable."};
  }
  if(input.transfer.kind==="recorded") {
    const today=input.transfer.days.filter(r=>r.day===day), days=input.transfer.days.filter(r=>r.day.startsWith(month));
    vendors[1]={...vendors[1],todayBytes:today.length?today.reduce((n,r)=>n+r.responseBytes+r.requestBytes,0):null,monthBytes:days.length?days.reduce((n,r)=>n+r.responseBytes+r.requestBytes,0):null,detail:vendors[1].detail+" Database transfer is measured in bytes; it is not converted to an estimated bill."};
  }
  let env: Readonly<Record<string,string|undefined>>;
  try { env=input.env??billingCollectorEnvironment(); } catch { env={}; }
  const get=async(url:string,token:string):Promise<Record<string,unknown>>=>{
    const r=await (input.fetcher??fetch)(url,{method:"GET",headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(10_000)});
    if(!r.ok||r.headers.get("link")?.includes('rel="next"'))throw new Error("unread");
    return await r.json() as Record<string,unknown>;
  };
  await Promise.all([
    (async()=>{const token=env.DIGITALOCEAN_TOKEN??env.DIGITALOCEAN_ACCESS_TOKEN;
      if(!token){vendors[2]={...vendors[2],detail:"DigitalOcean billing credential is not configured (DIGITALOCEAN_TOKEN or DIGITALOCEAN_ACCESS_TOKEN)."};return;}
      try{const r=await get("https://api.digitalocean.com/v2/customers/my/balance",token);vendors[2]={...vendors[2],monthUsd:input.now.slice(0,7)===month?amount(r.month_to_date_usage):null,detail:"DigitalOcean's reported month-to-date usage, read from the customer balance API. The API does not report daily charges or an account spending limit."};}
      catch{vendors[2]={...vendors[2],detail:"DigitalOcean billing could not be read with the configured access."};}
    })(),
    (async()=>{const token=env.GITHUB_BILLING_TOKEN,account=env.GITHUB_BILLING_ORG??env.GITHUB_BILLING_USER;
      if(!token||!account){vendors[4]={...vendors[4],detail:vendors[4].detail+" Daily billing requires GITHUB_BILLING_TOKEN and GITHUB_BILLING_ORG or GITHUB_BILLING_USER."};return;}
      try{const prefix=env.GITHUB_BILLING_ORG?"organizations":"users";
        const r=await get(`https://api.github.com/${prefix}/${encodeURIComponent(account)}/settings/billing/usage?year=${month.slice(0,4)}&month=${Number(month.slice(5))}`,token);
        if(!Array.isArray(r.usageItems))throw new Error("unread");
        const rows=r.usageItems as Record<string,unknown>[];
        if(rows.some(r=>amount(r.netAmount)===null||typeof r.date!=="string"||!Number.isFinite(Date.parse(r.date))))throw new Error("unread");
        const providerDay=input.now.slice(0,10);
        const today=rows.filter(r=>(r.date as string).slice(0,10)===providerDay);
        vendors[4]={...vendors[4],todayUsd:input.now.slice(0,7)===month?today.reduce((n,r)=>n+Number(r.netAmount),0):null,todayPeriodStart:providerDay+"T00:00:00.000Z",todayPeriodEnd:new Date(Date.parse(providerDay+"T00:00:00.000Z")+86400000).toISOString(),monthUsd:rows.reduce((n,r)=>n+Number(r.netAmount),0),detail:"GitHub's reported net metered usage after discounts. The provider reports daily UTC billing buckets; their boundaries are supplied explicitly and shown in Eastern time. They cannot be split into guessed Eastern-day amounts. At a month boundary, a missing daily bucket stays unknown. The vendor's month uses its UTC billing period. Fixed subscriptions and an account spending limit are not reported by this usage endpoint."};
      }catch{vendors[4]={...vendors[4],detail:vendors[4].detail+" The daily usage API could not be read completely with the configured billing access."};}
    })(),
  ]);
  return {day,month,readAt:input.now,vendors};
}
