import assert from "node:assert/strict";
import test from "node:test";
import { meteredAskFetch } from "../lib/ask/cost.ts";
import { hedgedFetch } from "../lib/ask/hedged-fetch.ts";
import { spendByTier, type CostEntry } from "../lib/control-plane/cost.ts";
import { MODELS } from "../lib/models.ts";

const init = { method: "POST", body: JSON.stringify({ model: MODELS.haiku.model, messages: [{role:"user",content:"private question"}] }) };
const reply = () => new Response(JSON.stringify({ model: MODELS.haiku.model, content: [], usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 20 } }));
test("every Ask send records model/tier, cache billing and no question or reader fields", async () => {
  const rows: CostEntry[] = [];
  const measured = meteredAskFetch(async (_url, request) => {
    assert.deepEqual(JSON.parse(String(request?.body)).cache_control,{type:"ephemeral"});
    return reply();
  }, "interpret", async e => {rows.push(e);});
  const response = await measured("https://provider/messages",init);
  await response.json();
  assert.equal(rows.length,1);
  assert.equal(rows[0].model,MODELS.haiku.model); assert.equal(rows[0].tier,"haiku");
  assert.equal(rows[0].cost.inputTokens,120); assert.equal(rows[0].cost.requestCount,1);
  assert.ok(Math.abs(rows[0].cost.usd! - .000152)<1e-12);
  assert.ok(!JSON.stringify(rows).includes("private question"));
  assert.equal(rows[0].question,undefined);
});
test("a stopped hedge is charged as unmeasured alongside the measured winner", async () => {
  const rows: CostEntry[] = []; let sends=0;
  const measured = meteredAskFetch(async (_url,request) => {
    if (++sends === 2) return reply();
    return new Promise((_resolve,reject)=>request!.signal!.addEventListener("abort",()=>reject(new Error("aborted")),{once:true}));
  }, "interpret", async e=>{rows.push(e);});
  await hedgedFetch(measured,"https://provider/messages",init,{hedgeAfterMs:1,timeoutMs:1000});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sends,2); assert.equal(rows.length,2);
  assert.deepEqual(rows.map(r=>r.cost.usd===null).sort(),[false,true]);
  assert.equal(rows[0].tier,"haiku"); assert.equal(rows[1].tier,"haiku");
  const since=new Date(Date.now()-10000).toISOString(),until=new Date(Date.now()+10000).toISOString();
  assert.equal(spendByTier(rows,{since,until}).tiers.find(t=>t.tier==="haiku")!.usd,null);
});
test("provider refusals and malformed responses preserve unknown spend and served dated models", async () => {
  const rows: CostEntry[] = [];
  const write = async(e:CostEntry)=>{rows.push(e);};
  await assert.rejects(meteredAskFetch(async()=>{throw new TypeError("secret transport detail");},"fallback",write)("https://provider/messages",init));
  await meteredAskFetch(async()=>new Response("bad",{status:429}),"classifier",write)("https://provider/messages",init);
  await meteredAskFetch(async()=>new Response(JSON.stringify({model:`${MODELS.haiku.model}-20251001`,usage:{input_tokens:3,output_tokens:2}})),"writer",write)("https://provider/messages",init);
  assert.deepEqual(rows.map(r=>r.tier),["haiku","haiku","haiku"]);
  assert.equal(rows[0].cost.usd,null); assert.equal(rows[1].cost.usd,null);
  assert.equal(rows[2].model,`${MODELS.haiku.model}-20251001`);
  assert.ok(!JSON.stringify(rows).includes("secret transport detail"));
});
