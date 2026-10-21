import assert from "node:assert/strict";
import test from "node:test";
import { createOfficeLocator } from "../lib/map/office-locator.ts";

test("office readers share in-flight and recent coordinates, expire them, and retry failed matches", async () => {
  let now = 1, calls = 0, match = true;
  const locate = createOfficeLocator((async () => { calls++; return Response.json({ match, lat: 32, lng: -110 }); }) as typeof fetch, () => now);
  const first = locate("One office");
  assert.equal(locate("One office"), first);
  assert.deepEqual(await first, { lat: 32, lng: -110 });
  assert.deepEqual(await locate("One office"), { lat: 32, lng: -110 });
  assert.equal(calls, 1);
  now += 30_000;
  match = false;
  assert.equal(await locate("One office"), null);
  match = true;
  assert.deepEqual(await locate("One office"), { lat: 32, lng: -110 });
  assert.equal(calls, 3);
});

test("a stalled public-office lookup gets one overlapping read, keeps a valid point and cancels the loser", async context => {
  context.mock.timers.enable({apis:["setTimeout"]});
  const signals:AbortSignal[]=[];
  let calls=0;
  const locate=createOfficeLocator((async(_url,init)=>{
    calls++;signals.push(init!.signal!);
    if(calls===1)return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener("abort",()=>reject(new Error("canceled"))));
    return Response.json({match:true,lat:40.8,lng:-74.5});
  })as typeof fetch);
  const first=locate("1250 Sussex Turnpike, Randolph, NJ 07869");
  assert.equal(calls,1);context.mock.timers.tick(499);assert.equal(calls,1);
  context.mock.timers.tick(1);assert.equal(calls,2);
  assert.deepEqual(await first,{lat:40.8,lng:-74.5});assert.equal(signals[0].aborted,true);
  context.mock.timers.tick(10000);assert.equal(calls,2,"the locator cannot create a retry loop");
});

test("a postal contact box never starts a street geocoder; actual office streets still resolve", async () => {
  const addresses:string[]=[];
  const locate=createOfficeLocator((async(_url,init)=>{addresses.push(JSON.parse(String(init?.body)).address);return Response.json({match:true,lat:40.8,lng:-74.5});})as typeof fetch);
  for(const address of ["P.O. Box 25, Mt. Freedom, NJ 07970","PO Box 25","P O Box 25","POBox25","Post Office Box #25"]){
    assert.equal(await locate(address),null,address);
  }
  assert.deepEqual(addresses,[],"mailing contacts do not become guessed office pins or eight-second Census requests");
  assert.deepEqual(await locate("1250 Sussex Turnpike Suite D, Randolph, NJ 07869"),{lat:40.8,lng:-74.5});
  assert.deepEqual(await locate("12 Post Office Road, Randolph, NJ 07869"),{lat:40.8,lng:-74.5});
  assert.equal(addresses.length,2);
});

test("a server's public-office points are reused without another request and retain their short lifetime",async()=>{
  let now=0,calls=0;
  const locate=createOfficeLocator((async()=>{calls++;return Response.json({match:false})})as typeof fetch,()=>now);
  locate.prime({"100 Public Office Street":{lat:32,lng:-110},"P.O. Box 25":{lat:32,lng:-110},"Invalid":{lat:Infinity,lng:0}});
  assert.deepEqual(await locate("100 Public Office Street"),{lat:32,lng:-110});assert.equal(calls,0);
  assert.equal(await locate("P.O. Box 25"),null);assert.equal(calls,0);
  assert.equal(await locate("Invalid"),null);assert.equal(calls,1);
  now=30000;assert.equal(await locate("100 Public Office Street"),null);assert.equal(calls,2);
});
