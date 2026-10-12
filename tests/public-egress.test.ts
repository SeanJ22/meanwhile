import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import { assertPublicUrl, EgressRefusal, isPublicAddress, resolvePublicTarget, type PublicLookup } from "../lib/hunt/egress.ts";
import { createPublicFetch, publicProxyFor, requestPinned } from "../lib/hunt/public-transport.ts";
import { checkedCurlArguments } from "../lib/hunt/public-curl.ts";
import { fulfillPublicSourceRoute } from "../lib/hunt/public-browser.ts";
import { curlGetText } from "../lib/sources/http.ts";
import type { Route } from "playwright";

const publicDns: PublicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("private, reserved, encoded and mapped addresses cannot be source targets", () => {
  for (const host of ["127.0.0.1", "127.1", "2130706433", "0x7f000001", "10.1.2.3", "169.254.169.254", "100.64.0.1", "192.168.0.1", "172.31.0.1", "0.0.0.0", "198.18.0.1", "192.0.2.1", "224.0.0.1", "localhost.", "x.localhost", "x.home.arpa", "[::1]", "[::ffff:127.0.0.1]", "[fc00::1]", "[fe80::1]", "[2001:db8::1]", "[2002:7f00:1::1]", "[3fff::1]"]) {
    assert.throws(() => assertPublicUrl(`http://${host}/`), EgressRefusal, host);
  }
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(isPublicAddress(address), true, address);
  assert.throws(() => assertPublicUrl("https://user:password@example.gov/"), EgressRefusal);
  assert.throws(() => assertPublicUrl("file:///etc/passwd"), EgressRefusal);
  assert.equal(assertPublicUrl("https://county.gov/minutes").hostname, "county.gov");
});

test("DNS failure or a mixed public/private answer refuses before transport", async () => {
  let sent = 0;
  for (const lookup of [async () => [], async () => [{ address: "93.184.216.34", family: 4 as const }, { address: "10.0.0.1", family: 4 as const }], async () => { throw Error("DNS failed"); }]) {
    const fetcher = createPublicFetch({ lookup, env: {}, request: async () => { sent++; return new Response("bad"); } });
    await assert.rejects(fetcher("https://county.gov/"));
  }
  assert.equal(sent, 0);
});

test("the checked DNS answer is handed unchanged to the socket path and rechecked at each redirect", async () => {
  let lookups = 0; let sent = 0;
  const fetcher = createPublicFetch({ env: {}, lookup: async () => [{ address: ++lookups === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }],
    request: async target => { sent++; assert.equal(target.addresses[0].address, "93.184.216.34"); return new Response(null, {status:302,headers:{location:"/second"}}); } });
  await assert.rejects(fetcher("https://county.gov/first"), EgressRefusal);
  assert.equal(lookups, 2); assert.equal(sent, 1);
});

test("redirects strip origin credentials, rewrite POST only as HTTP requires, and retain final URL", async () => {
  const seen: {url:string;method:string;headers:Headers;body:Uint8Array|undefined}[] = [];
  const fetcher = createPublicFetch({env:{},lookup:publicDns,request:async (target, request) => {
    seen.push({url:target.url.href,...request});
    return seen.length === 1 ? new Response(null,{status:302,headers:{location:"https://other.gov/result"}}) : new Response("published");
  }});
  const response = await fetcher("https://county.gov/form", {method:"POST",body:"a=b",headers:{authorization:"secret",cookie:"session=secret","x-api-key":"secret",accept:"text/html","content-type":"application/x-www-form-urlencoded"}});
  assert.equal(await response.text(), "published"); assert.equal(response.url,"https://other.gov/result"); assert.equal(response.redirected,true);
  assert.equal(seen[1].method,"GET"); assert.equal(seen[1].body,undefined);
  for(const header of ["authorization","cookie","x-api-key","content-type"]) assert.equal(seen[1].headers.has(header),false,header);
  assert.equal(seen[1].headers.get("accept"),"text/html");
});

test("redirect to private IP or another scheme, redirect loops, and API redirect:error fail closed", async () => {
  for (const location of ["http://169.254.169.254/", "file:///secret", "/loop"]) {
    let calls=0;
    const fetcher=createPublicFetch({env:{},lookup:publicDns,request:async()=>{calls++;return new Response(null,{status:302,headers:{location}});}});
    await assert.rejects(fetcher("https://county.gov/"),EgressRefusal);
    assert.equal(calls,location === "/loop" ? 11 : 1);
  }
  const fetcher=createPublicFetch({env:{},lookup:publicDns,request:async()=>new Response(null,{status:302,headers:{location:"https://other.gov/"}})});
  await assert.rejects(fetcher("https://api.gov/",{redirect:"error"}),EgressRefusal);
  assert.equal((await fetcher("https://api.gov/",{redirect:"manual"})).status,302);
});

test("caller cancellation covers DNS, without contacting the source", async () => {
  const controller=new AbortController(); let sent=0;
  const fetcher=createPublicFetch({env:{},lookup:async()=>new Promise(()=>{}),request:async()=>{sent++;return new Response("bad");}});
  const pending=fetcher("https://county.gov/",{signal:controller.signal});
  controller.abort(new Error("fixture cancelled"));
  await assert.rejects(pending,/fixture cancelled/); assert.equal(sent,0);
});

test("proxy environment honors NO_PROXY and refuses unsupported configured proxies", () => {
  const env={HTTPS_PROXY:"http://proxy.internal:8080",NO_PROXY:".county.gov,other.gov:8443"};
  assert.equal(publicProxyFor(new URL("https://www.county.gov/"),env),null);
  assert.equal(publicProxyFor(new URL("https://other.gov:8443/"),env),null);
  assert.equal(publicProxyFor(new URL("https://api.gov/"),env)?.hostname,"proxy.internal");
  assert.throws(()=>publicProxyFor(new URL("https://api.gov/"),{ALL_PROXY:"socks5://proxy.internal:1080"}),EgressRefusal);
});

// Exercise requestPinned itself with core request/socket doubles. No listening
// port, DNS query, browser launch, external request or credentials are needed.
function fakeResponse(body="ok") {
  return Object.assign(Readable.from([Buffer.from(body)]),{statusCode:200,rawHeaders:["content-type","text/plain","content-length",String(body.length)]});
}
function fakeRequest(emit:(request:EventEmitter)=>void) {
  const request=Object.assign(new EventEmitter(),{end:()=>queueMicrotask(()=>emit(request))});
  return request;
}

test("core HTTPS connects to the checked IP while retaining Host and certificate identity",async t=>{
  const observed: https.RequestOptions[]=[];
  t.mock.method(https,"request",(options:https.RequestOptions)=>{observed.push(options);return fakeRequest(request=>request.emit("response",fakeResponse()));});
  syncBuiltinESMExports();
  try {
    const target=await resolvePublicTarget("https://county.gov/document",publicDns);
    const response=await requestPinned(target,{method:"GET",headers:new Headers(),body:undefined,signal:AbortSignal.timeout(1000)},null);
    assert.equal(await response.text(),"ok"); assert.equal(observed.length,1);
    assert.equal(observed[0].hostname,"93.184.216.34"); assert.equal(observed[0].servername,"county.gov");
    assert.equal((observed[0].headers as Record<string,string>).host,"county.gov");
    assert.equal(observed[0].agent,false);
    assert.equal(typeof observed[0].checkServerIdentity,"function");
  } finally {t.mock.restoreAll();syncBuiltinESMExports();}
});

test("core proxy uses CONNECT to the checked IP, then reuses that tunnel without resolving the source",async t=>{
  const observed:http.RequestOptions[]=[]; const tunnel=new PassThrough();
  t.mock.method(http,"request",(options:http.RequestOptions)=>{observed.push(options);return fakeRequest(request=>{
    if(options.method === "CONNECT") request.emit("connect",{statusCode:200},tunnel,Buffer.alloc(0));
    else request.emit("response",fakeResponse());
  });});
  syncBuiltinESMExports();
  try {
    const target=await resolvePublicTarget("http://county.gov/calendar",publicDns);
    const response=await requestPinned(target,{method:"GET",headers:new Headers(),body:undefined,signal:AbortSignal.timeout(1000)},new URL("http://proxy.internal:8080"));
    assert.equal(await response.text(),"ok");assert.equal(observed.length,2);
    assert.equal(observed[0].hostname,"proxy.internal");assert.equal(observed[0].path,"93.184.216.34:80");
    const agent=observed[1].agent as http.Agent;
    assert.equal(agent.createConnection({}),tunnel);
    assert.equal((observed[1].headers as Record<string,string>).host,"county.gov");
  } finally {tunnel.destroy();t.mock.restoreAll();syncBuiltinESMExports();}
});

test("unsupported publisher status rejects the request and closes its body without escaping the callback", async t => {
  const source = Object.assign(fakeResponse(), { statusCode: 600 });
  t.mock.method(http, "request", () => fakeRequest(request => request.emit("response", source)));
  syncBuiltinESMExports();
  try {
    const target = await resolvePublicTarget("http://county.gov/calendar", publicDns);
    await assert.rejects(requestPinned(target, {
      method: "GET", headers: new Headers(), body: undefined, signal: AbortSignal.timeout(1000),
    }, null), RangeError);
    assert.equal(source.destroyed, true);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test("curl pins direct and proxy destinations and cannot follow redirects or curlrc overrides",async()=>{
  const direct=await checkedCurlArguments("https://county.gov/x",{signal:AbortSignal.timeout(1000),lookup:publicDns,env:{}});
  assert.equal(direct[0],"-q");assert.ok(direct.includes("county.gov:443:93.184.216.34:443"));assert.ok(!direct.includes("-L"));
  const proxy=await checkedCurlArguments("https://county.gov/x",{signal:AbortSignal.timeout(1000),lookup:publicDns,env:{HTTPS_PROXY:"http://proxy.internal:8080"}});
  assert.ok(proxy.includes("--proxytunnel"));assert.ok(proxy.includes("--suppress-connect-headers"));
});

test("source curl redirect is rechecked before another subprocess can read private data",async()=>{
  let calls=0;
  await assert.rejects(curlGetText("https://county.gov/",{},AbortSignal.timeout(1000),async()=>{
    calls++;return Buffer.from("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/private\r\n\r\n");
  },publicDns),EgressRefusal);
  assert.equal(calls,1);
});

test("browser fulfills bytes through the guarded transport and never continues an unchecked request",async()=>{
  let continued=0,aborted=0; const fulfilled:unknown[]=[];
  const route={request:()=>({url:()=>"https://county.gov/",method:()=>"GET",postDataBuffer:()=>null}),
    continue:async()=>{continued++;},abort:async()=>{aborted++;},fulfill:async(value:unknown)=>{fulfilled.push(value);}} as unknown as Route;
  const fetcher=createPublicFetch({env:{},lookup:publicDns,request:async()=>new Response("public document")});
  await fulfillPublicSourceRoute(route,{},fetcher);
  assert.equal(fulfilled.length,1);assert.equal(continued,0);assert.equal(aborted,0);
  await fulfillPublicSourceRoute(route,{},createPublicFetch({env:{},lookup:async()=>[{address:"10.0.0.1",family:4}],request:async()=>{throw Error("must not send");}}));
  assert.equal(fulfilled.length,1);assert.equal(continued,0);assert.equal(aborted,1);
});

test("browser keeps valid bodyless responses whose content length describes the resource", async () => {
  for (const [method, status] of [["HEAD", 200], ["GET", 304], ["GET", 204], ["GET", 205]] as const) {
    let aborted = false;
    const fulfilled: { status?: number; headers?: Record<string, string>; body?: Buffer | string }[] = [];
    const route = {
      request: () => ({ url: () => "https://county.gov/", method: () => method, postDataBuffer: () => null }),
      abort: async () => { aborted = true; },
      fulfill: async (value: typeof fulfilled[number]) => { fulfilled.push(value); },
    } as unknown as Route;
    const headers: HeadersInit = method === "HEAD" || status === 304 ? { "content-length": "100000000" } : {};
    await fulfillPublicSourceRoute(route, {}, async () => new Response(null, { status, headers }));
    assert.equal(aborted, false, `${method} ${status}`);
    assert.equal(fulfilled.length, 1);
    assert.equal(fulfilled[0].status, status);
    assert.equal(fulfilled[0].body?.length, 0);
    if (method === "HEAD" || status === 304) assert.equal(fulfilled[0].headers?.["content-length"], "100000000");
  }
});
