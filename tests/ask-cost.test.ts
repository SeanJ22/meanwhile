import assert from "node:assert/strict";
import test from "node:test";
import { meteredAskFetch } from "../lib/ask/cost.ts";
import { hedgedFetch } from "../lib/ask/hedged-fetch.ts";
import { costEntryModelRequestBound, modelRequestBoundFor, spendByTier, type CostEntry } from "../lib/control-plane/cost.ts";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
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
  assert.ok(Math.abs(rows[0].cost.usd! - .0000152)<1e-12);
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
  await meteredAskFetch(async()=>new Response(JSON.stringify({model:`${MODELS.haiku.model}-20261001`,usage:{input_tokens:3,output_tokens:2}})),"writer",write)("https://provider/messages",init);
  assert.deepEqual(rows.map(r=>r.tier),["haiku","haiku","haiku"]);
  assert.equal(rows[0].cost.usd,null); assert.equal(rows[1].cost.usd,null);
  assert.equal(rows[2].model,`${MODELS.haiku.model}-20261001`);
  assert.ok(!JSON.stringify(rows).includes("secret transport detail"));
});

test("Ask records each actual request bound and requested/served identities without converting an unknown bill into measured dollars", async () => {
  const rows: CostEntry[] = [];
  const boundedInit = { ...init, body: JSON.stringify({ model: MODELS.haiku.model, max_tokens: 1024,
    messages: [{ role: "user", content: "private Unicode question é漢" }] }) };
  let sentBytes = 0;
  const measured = meteredAskFetch(async (_url, request) => {
    sentBytes = Buffer.byteLength(String(request?.body));
    return new Response(JSON.stringify({ model: "provider-unknown-served", usage: { input_tokens: 1, output_tokens: 1 } }));
  }, "interpret", async entry => { rows.push(entry); });
  await measured("https://provider/messages", boundedInit);
  const row = rows[0];
  assert.equal(row.requestedModel, MODELS.haiku.model);
  assert.equal(row.servedModel, "provider-unknown-served");
  assert.equal(row.model, row.servedModel);
  assert.equal(row.cost.usd, null);
  assert.deepEqual(row.modelRequestBound, modelRequestBoundFor(MODELS.haiku.model, sentBytes, 1024));
  assert.equal(row.modelRequestBound?.measured, false);
  assert.equal(costEntryModelRequestBound(row), row.modelRequestBound?.usd);
  assert.ok(!JSON.stringify(rows).includes("private Unicode question"));
  assert.ok(!JSON.stringify(rows).includes("漢"));

  await assert.rejects(meteredAskFetch(async () => { throw new Error("provider failed"); }, "interpret", async entry => { rows.push(entry); })("https://provider/messages", boundedInit));
  assert.equal(rows[1].cost.usd, null);
  assert.equal(rows[1].servedModel, null);
  assert.equal(costEntryModelRequestBound(rows[1]), rows[1].modelRequestBound?.usd);
});

test("historical Ask failures use the known provider context/output maxima at the highest tier's price", () => {
  const row: CostEntry = { model: MODELS.haiku.model, attemptId: "old", workItemId: "ask", routeTaskId: null,
    routeId: "ask:classifier", source: "api.anthropic.com", jurisdiction: null, project: "ask", role: "ASK",
    cost: { ...ZERO_COST, requestCount: 1 }, recordedAt: "2026-10-02T00:00:00Z" };
  const expected = (MODELS.haiku.contextWindowTokens * MODELS.opus.inputUsdPerMillion * 2 +
    MODELS.haiku.maxOutputTokens * MODELS.opus.outputUsdPerMillion) / 1_000_000;
  assert.equal(costEntryModelRequestBound(row), expected);
  assert.ok(expected > 0 && expected < 100);
  assert.equal(row.cost.usd, null, "the ledger's measured value remains untouched");
  assert.equal(costEntryModelRequestBound({ ...row, cost: { ...row.cost, requestCount: 2 } }), expected * 2);
  assert.equal(costEntryModelRequestBound({ ...row, model: "unknown-provider-model" }), null);
  assert.equal(costEntryModelRequestBound({ ...row, role: "SCOUT" }), null, "an Ask bound cannot price another callsite's unknown job");
  assert.equal(costEntryModelRequestBound({ ...row, source: "api.search.brave.com" }), null);
  assert.equal(costEntryModelRequestBound({ ...row, cost: { ...row.cost, requestCount: null } }), null);
  assert.equal(costEntryModelRequestBound({ ...row, model: "unknown-served", cost: { ...row.cost, inputTokens: 1, outputTokens: 1 } }), .000028);
});

test("a stored bound prices only its one unpriced send and never malformed/foreign request metadata", () => {
  const bound = modelRequestBoundFor(MODELS.haiku.model, 100, 1024)!;
  const row: CostEntry = { requestedModel: MODELS.haiku.model, modelRequestBound: bound,
    attemptId: "future", workItemId: "ask", routeTaskId: null, routeId: "ask:interpret", source: "api.anthropic.com",
    jurisdiction: null, project: "ask", role: "ASK", cost: { ...ZERO_COST, requestCount: 1 }, recordedAt: "2026-10-02T00:00:00Z" };
  assert.equal(costEntryModelRequestBound(row), bound.usd);
  assert.equal(costEntryModelRequestBound({ ...row, modelRequestBound: { ...bound, usd: 0 } }), bound.usd, "recompute from central rates rather than trusting a caller's dollar scalar");
  assert.equal(costEntryModelRequestBound({ ...row, requestedModel: MODELS.opus.model }), null);
  assert.equal(costEntryModelRequestBound({ ...row, requestedModel: undefined }), null);
  assert.equal(costEntryModelRequestBound({ ...row, cost: { ...row.cost, requestCount: 2 } }), bound.usd, "the bound covers its own send; the others are measured");
  for (const bad of [-1, NaN, Infinity, 1.5]) {
    assert.equal(costEntryModelRequestBound({ ...row, modelRequestBound: { ...bound, inputTokens: bad } }), null);
    assert.equal(modelRequestBoundFor(MODELS.haiku.model, 100, bad), null);
  }
  assert.equal(costEntryModelRequestBound({ ...row, modelRequestBound: { ...bound, measured: true } as unknown as typeof bound }), null);
  assert.equal(costEntryModelRequestBound({ ...row, modelRequestBound: { ...bound, basis: undefined } as unknown as typeof bound }), null);
});

test("all tiers' dated served identities use their own central price while preserving both identities", async () => {
  for (const model of Object.values(MODELS)) {
    const rows: CostEntry[] = [];
    const served = `${model.model}-20251001`;
    await meteredAskFetch(async () => new Response(JSON.stringify({ model: served, usage: { input_tokens: 100, output_tokens: 10 } })),
      "interpret", async row => { rows.push(row); })("https://provider/messages",
        { ...init, body: JSON.stringify({ model: model.model, max_tokens: 1024, messages: [{ role: "user", content: "private question" }] }) });
    assert.equal(rows[0].model, served);
    assert.equal(rows[0].servedModel, served);
    assert.equal(rows[0].requestedModel, model.model);
    assert.ok(Math.abs(rows[0].cost.usd! - (100 * model.inputUsdPerMillion + 10 * model.outputUsdPerMillion) / 1_000_000) < 1e-15);
  }
});
