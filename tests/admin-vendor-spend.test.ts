import assert from "node:assert/strict";
import {test} from "node:test";
import { readVendorSpend, VENDOR_LEDGER_SQL } from "../lib/control-plane/admin-view/vendor-spend.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";
import type { ProviderReading } from "../lib/control-plane/provider-billing.ts";
const now="2026-10-06T00:30:00.000Z";
const sql=(row:Record<string,unknown>)=>({query:async(query:string,params:unknown[])=>{assert.equal(query,VENDOR_LEDGER_SQL);assert.deepEqual(params,["2026-10-05","2026-10-01",now]);return[row];}}) as unknown as Sql;
const base={now,sql:sql({today:2,month:4,today_unpriced:0,month_unpriced:0}),dailyLimitUsd:50,transfer:{kind:"recorded",days:[{day:"2026-10-05",responseBytes:100,requestBytes:20}]},env:{},fetcher:async()=>{throw new Error("No credentials: no network read");}};
const reading=(over:Partial<ProviderReading>):ProviderReading=>({provider:"netlify",attemptedAt:now,syncedAt:now,periodStart:"2026-10-01T00:00:00.000Z",periodEnd:now,status:"REPORTED",reportedUsd:7,estimatedUsd:null,credits:null,units:[],accountIds:[],existingLimits:[],source:"billing",detail:"provider measurement",error:null,...over});
test("Eastern ledger totals, measured transfer and unknown provider dollars are kept separate",async()=>{
 const r=await readVendorSpend(base);assert.equal(r.day,"2026-10-05");assert.deepEqual(r.vendors.map(v=>v.vendor),["Anthropic","Neon","DigitalOcean","Netlify","GitHub"]);
 assert.equal(r.vendors[0].todayUsd,2);assert.equal(r.vendors[0].monthUsd,4);assert.equal(r.vendors[0].dailyLimitUsd,50);
 assert.equal(r.vendors[1].todayBytes,120);assert.equal(r.vendors[1].todayUsd,null);assert.equal(r.vendors[2].monthUsd,null);
});
test("unpriced ledger charges, provider estimates, stale reads and old billing periods never become measured spend",async()=>{
 for(const value of [reading({status:"ESTIMATED",reportedUsd:null,estimatedUsd:99}),reading({syncedAt:"2026-10-05T00:00:00Z"}),reading({periodStart:"2026-09-01T00:00:00.000Z"}),reading({status:"ERROR",error:"failed"})]){
 const r=await readVendorSpend({...base,sql:sql({today:2,month:4,today_unpriced:1,month_unpriced:1}),billing:{formatVersion:1,collectedAt:now,readings:[value]}});
 assert.equal(r.vendors[0].todayUsd,null);assert.equal(r.vendors[0].monthUsd,null);assert.equal(r.vendors[3].monthUsd,null);
 }
 const r=await readVendorSpend({...base,billing:{formatVersion:1,collectedAt:now,readings:[reading({})]}});assert.equal(r.vendors[3].monthUsd,7);assert.equal(r.vendors[3].todayUsd,null);
});
test("configured vendor reads use GET, preserve actual zero and put GitHub usage timestamps in Eastern days",async()=>{
 const urls:string[]=[];
 const r=await readVendorSpend({...base,env:{GITHUB_BILLING_TOKEN:"fixture",GITHUB_BILLING_USER:"fixture-user",DIGITALOCEAN_TOKEN:"fixture"},fetcher:async(url,init)=>{
 assert.equal(init?.method,"GET");urls.push(String(url));return Response.json(String(url).includes("digitalocean")?{month_to_date_usage:"0.00"}:{usageItems:[{date:"2026-10-06T00:00:00Z",netAmount:3},{date:"2026-10-05T02:00:00Z",netAmount:2}]});
 }});
 assert.equal(r.vendors[2].monthUsd,0);assert.equal(r.vendors[2].todayUsd,null);assert.equal(r.vendors[4].todayUsd,3);assert.equal(r.vendors[4].monthUsd,5);assert.equal(urls.length,2);
});
test("incomplete or malformed vendor reads never show a partial total",async()=>{
 for(const response of [Response.json({usageItems:[{date:"wrong",netAmount:99}]}),Response.json({usageItems:[{date:now,netAmount:99}]},{headers:{link:'<https://example.test/page2>; rel="next"'}}),new Response(null,{status:403})]){
 const r=await readVendorSpend({...base,env:{GITHUB_BILLING_TOKEN:"fixture",GITHUB_BILLING_USER:"fixture"},fetcher:async()=>response});assert.equal(r.vendors[4].todayUsd,null);
 }
});
