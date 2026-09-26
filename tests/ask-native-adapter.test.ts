import assert from "node:assert/strict";
import test from "node:test";
import ask, { config } from "../netlify/functions/grounded-ask.mts";
import { afterResponse, withResponseLifetime } from "../lib/log/after-response.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

test("native Ask uses the public route and preserves validation and origin rejection", async () => {
  assert.deepEqual(config, { path:"/api/ask/grounded", method:"POST" });
  const context = { waitUntil: (_work:Promise<unknown>) => undefined };
  const request = (origin:string,body:string) => new Request(`${PUBLIC_SITE_ORIGIN}/api/ask/grounded`,{method:"POST",headers:{origin,"content-type":"application/json"},body});
  const rejected = await ask(request("https://unrelated.example","{}"),context);
  assert.equal(rejected.status,403);
  const missing = await ask(request(PUBLIC_SITE_ORIGIN,"{}"),context);
  assert.equal(missing.status,400);
  assert.equal((await missing.json()).error,"question is required");
  assert.equal(rejected.headers.get("x-wtp-ask-instance"),missing.headers.get("x-wtp-ask-instance"));
  assert.equal(Number(missing.headers.get("x-wtp-ask-instance-request")),Number(rejected.headers.get("x-wtp-ask-instance-request"))+1);
});

test("request lifetimes retain background receipts and stay isolated across concurrent calls", async () => {
  const held:Promise<unknown>[][]=[[],[]],finished:number[]=[];
  await Promise.all(held.map((list,i)=>withResponseLifetime(p=>list.push(p),async()=>{
    await Promise.resolve();
    await afterResponse(async()=>{await Promise.resolve();finished.push(i);});
    assert.equal(list.length,1);
  })));
  await Promise.all(held.flat());
  assert.deepEqual(finished.sort(),[0,1]);
});
