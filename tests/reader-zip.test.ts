import assert from "node:assert/strict";
import test from "node:test";
import { resolveReaderZip, lookupReaderZip } from "../lib/reader/zip.ts";
import { lookupZcta, resolveZip } from "../lib/geo/zcta.ts";
import type { ZctaCentroid } from "../lib/geo/zcta-core.ts";

function shard(input: string | URL | Request) {
  const prefix=/\/geo\/reader-zips\/(\d{2})\.json$/.exec(new URL(input instanceof Request?input.url:input,"http://localhost").pathname)?.[1];
  assert.ok(prefix);
  return Response.json({locations:Object.fromEntries(["05009","85701","89109"].filter(zip=>zip.startsWith(prefix)).map(zip=>[zip,lookupZcta(zip)]))});
}

test("typed ZIP lookups validate immediately and share only successful source-resolved places for thirty seconds", async (t) => {
  const requests: string[] = [];
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const request = input instanceof Request ? input : new Request(new URL(input, "http://localhost"));
    requests.push(request.url); return shard(request);
  });
  for (const input of ["0509", "123456", "abcde", "85701-1234"]) assert.deepEqual(await resolveReaderZip(input), { ok: false, reason: "malformed" });
  assert.equal(requests.length, 0);
  const expected = resolveZip("05009"); assert.ok(expected.ok);
  const values = await Promise.all([resolveReaderZip(" 05009 "), resolveReaderZip("05009"), lookupReaderZip("05009")]);
  assert.deepEqual(values, [expected, expected, expected.centroid]);
  assert.equal(requests.length, 1, "concurrent welcome, restored-location and card reads share one request");
  assert.deepEqual(await resolveReaderZip("05009"), resolveZip("05009"));
  assert.equal(requests.length, 1);
  now += 30_001;
  assert.deepEqual(await resolveReaderZip("05009"), resolveZip("05009"));
  assert.equal(requests.length, 2, "a fresh visit after thirty seconds reads the current shelf");
  for (let i = 0; i < 2; i++) assert.deepEqual(await resolveReaderZip("00000"), { ok: false, reason: "uncovered" });
  assert.equal(requests.length, 4, "an uncovered ZIP can be retried");
});

test("failed and malformed location responses never poison later ZIP retries", async (t) => {
  let attempt = 0;
  t.mock.method(globalThis, "fetch", async () => {
    attempt++;
    if (attempt === 1) throw new Error("offline");
    if (attempt === 2) return Response.json({ error: "temporarily unavailable" }, { status: 503 });
    if (attempt === 3) return Response.json({ locations: { "85701": { zip: "85701", lat: 100, lng: -110 } } });
    return shard("http://localhost/geo/reader-zips/85.json");
  });
  await assert.rejects(resolveReaderZip("85701"), /offline/);
  await assert.rejects(resolveReaderZip("85701"), /503/);
  await assert.rejects(resolveReaderZip("85701"), /Invalid ZIP/);
  assert.deepEqual(await resolveReaderZip("85701"), resolveZip("85701"));
  assert.equal(attempt, 4);
});

test("an unavailable regional projection cannot claim an uncovered ZIP", async (t) => {
  let attempts=0;
  t.mock.method(globalThis,"fetch",async(input:string|URL|Request)=>++attempts===1?Response.json({unavailable:true}):shard(input));
  await assert.rejects(resolveReaderZip("89109"),/Invalid ZIP/);
  assert.deepEqual(await resolveReaderZip("89109"), resolveZip("89109"));
  assert.deepEqual(await resolveReaderZip("99999"), { ok: false, reason: "uncovered" });
});

test("map startup locations share the ZIP success cache and invalid or failed starts remain retryable", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis,"window");
  const zip = "30303",point:ZctaCentroid = {zip,lat:33.75,lng:-84.39};
  const replies: (ZctaCentroid|null|Error)[] = [null,{...point,lat:100},new Error("startup offline"),point];
  let starts = 0;
  const reader: {location:{pathname:string};__readerStart?:Window["__readerStart"];__startReaderZip:(zip:string)=>Promise<ZctaCentroid|null>} = {
    location:{pathname:"/"},__startReaderZip:input=>{
      assert.equal(input,zip);starts++;
      const reply = replies.shift();
      if (reply === undefined) throw new Error("Unexpected startup");
      const location = reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
      reader.__readerStart = {zip,location,expires:Date.now()+30_000,requests:{},parsed:new WeakMap()};
      return location;
    },
  };
  Object.defineProperty(globalThis,"window",{configurable:true,value:reader});
  t.mock.method(globalThis,"fetch",async()=>{throw new Error("A started ZIP must not issue another location request");});
  try {
    assert.deepEqual(await resolveReaderZip(zip),{ok:false,reason:"uncovered"});
    await assert.rejects(resolveReaderZip(zip),/Invalid ZIP/);
    await assert.rejects(resolveReaderZip(zip),/startup offline/);
    assert.deepEqual(await resolveReaderZip(zip),{ok:true,centroid:point});
    assert.deepEqual(await lookupReaderZip(zip),point);
    assert.equal(starts,4,"uncovered and failed starts are replaced; the verified location is reused");
  } finally {
    if(previous)Object.defineProperty(globalThis,"window",previous);else Reflect.deleteProperty(globalThis,"window");
  }
});

test("a superseded failed ZIP cannot expire the newer map selection", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis,"window");
  let rejectEarlier: (error:Error)=>void = ()=>{};
  const earlier = new Promise<ZctaCentroid|null>((_resolve,reject)=>{rejectEarlier=reject;});
  const point:ZctaCentroid = {zip:"27182",lat:35,lng:-80};
  const reader: {location:{pathname:string};__readerStart?:Window["__readerStart"];__startReaderZip:(zip:string)=>Promise<ZctaCentroid|null>} = {
    location:{pathname:"/"},__startReaderZip:zip=>{
      const location = zip === "31415" ? earlier : Promise.resolve(point);
      reader.__readerStart={zip,location,expires:Date.now()+30_000,requests:{},parsed:new WeakMap()};
      return location;
    },
  };
  Object.defineProperty(globalThis,"window",{configurable:true,value:reader});
  try {
    const failed = resolveReaderZip("31415"),failure = assert.rejects(failed,/superseded/);
    assert.deepEqual(await resolveReaderZip(point.zip),{ok:true,centroid:point});
    const current = reader.__readerStart;
    rejectEarlier(new Error("superseded"));await failure;
    assert.equal(reader.__readerStart,current);
    assert.ok(current && current.expires>Date.now(),"only the failed starter's own active object may expire");
  } finally {
    if(previous)Object.defineProperty(globalThis,"window",previous);else Reflect.deleteProperty(globalThis,"window");
  }
});
