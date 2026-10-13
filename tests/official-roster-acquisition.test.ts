import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { acquireOfficialRoster, OFFICIAL_ROSTER_TARGETS, HOUSE_ROSTER_URL, SENATE_ROSTER_URL, SENATE_APPOINTMENTS_URL } from "../lib/sources/official-rosters/index.ts";
import { gunzipSync } from "node:zlib";
import { GEORGIA_SESSIONS_URL, GEORGIA_MEMBER_URL_PREFIX } from "../lib/sources/official-rosters/request.ts";
import { ALASKA_DIRECTORY_URL, alaskaCurrentProfileRoutes } from "../lib/sources/official-rosters/alaska.ts";

const fixture=(name:string)=>readFileSync(new URL(`./fixtures/official-rosters/${name}`,import.meta.url),"utf8");
const AT="2026-10-13T04:15:32.259Z";
const stateFixture=(name:string)=>gunzipSync(readFileSync(new URL(`./fixtures/official-rosters/states/${name}`,import.meta.url))).toString("utf8");
test("daily official roster targets cover federal chambers and every state legislature alongside NH's native feed",()=>{
  assert.equal(OFFICIAL_ROSTER_TARGETS.filter(target=>target.kind!=="legislature").length,2);
  assert.equal(new Set(OFFICIAL_ROSTER_TARGETS.flatMap(target=>target.state?[target.state]:[])).size,49);
  assert.ok(!OFFICIAL_ROSTER_TARGETS.some(target=>target.state==="NH"));
  assert.ok(OFFICIAL_ROSTER_TARGETS.every(target=>target.sourceId==="official-rosters" && target.routes.length>0));
});
test("Admin refresh asks the publisher conditionally even before the daily clock and retains original source bytes",async()=>{
  const store=new MemoryEvidenceStore(),{locks}=createMemoryRepositories();
  let now=AT;
  const requests:{url:string;headers:Headers}[]=[];
  const fetchImpl=(async(url,init)=>{
    const href=String(url),headers=new Headers(init?.headers);requests.push({url:href,headers});
    if(href.includes("/states/"))return new Response("Optional service history unavailable",{status:404});
    if(headers.has("if-none-match"))return new Response(null,{status:304});
    const body=href===SENATE_ROSTER_URL?fixture("senate-current.xml"):fixture("senate-appointed.html");
    assert.ok([SENATE_ROSTER_URL,SENATE_APPOINTMENTS_URL].includes(href));
    return new Response(body,{headers:{etag:'"source-release"',"content-type":href===SENATE_ROSTER_URL?"application/xml":"text/html"}});
  }) as typeof fetch;
  const input={targetId:"official-senate-roster",store,locks,fetchImpl,now:()=>now,signal:AbortSignal.timeout(10_000)};
  const coreRequests=()=>requests.filter(row=>!row.url.includes("/states/"));
  const first=await acquireOfficialRoster(input);assert.equal(first.roster.officeholders.length,100);assert.equal(first.complete,true);assert.equal(coreRequests().length,2);
  now="2026-10-13T04:17:32.259Z";
  await acquireOfficialRoster(input);assert.equal(coreRequests().length,2,"ordinary replay shares the daily source clock");
  const checked=await acquireOfficialRoster({...input,refresh:true});assert.equal(coreRequests().length,4);
  assert.ok(coreRequests().slice(2).every(row=>row.headers.get("if-none-match")==='"source-release"'));
  assert.ok(checked.acquisitions.every(row=>row.sourceCheck?.httpStatus===304 && row.sourceCheck.checkedAt===now && row.retrievedAt===AT));
  assert.equal(checked.releaseId,first.releaseId);assert.equal(checked.roster.officeholders[0]!.provenance.collectedAt,AT);
});
test("a malformed changed source remains a gap and cannot poison the held valid release",async()=>{
  const store=new MemoryEvidenceStore(),{locks}=createMemoryRepositories();let broken=false;
  const input={targetId:"official-house-roster",store,locks,now:()=>AT,signal:AbortSignal.timeout(10_000),
    fetchImpl:(async()=>new Response(broken?fixture("house-current.xml").slice(0,-10):fixture("house-current.xml"),{headers:{etag:broken?'"bad"':'"good"'}})) as typeof fetch};
  const first=await acquireOfficialRoster(input);assert.equal(first.roster.vacancies?.length,2);
  broken=true;const failed=await acquireOfficialRoster({...input,refresh:true});
  assert.equal(failed.roster.officeholders.length,0);assert.equal(failed.complete,false);assert.ok(failed.gaps.some(gap=>gap.sourceUrl===HOUSE_ROSTER_URL && /complete MemberData/.test(gap.detail)));
  const held=await acquireOfficialRoster(input);assert.equal(held.releaseId,first.releaseId);assert.equal(held.roster.officeholders.length,439);
});
test("an optional appointment source outage preserves verified current Senate facts and records the exact failure",async()=>{
  const {locks}=createMemoryRepositories();
  const result=await acquireOfficialRoster({targetId:"official-senate-roster",store:new MemoryEvidenceStore(),locks,now:()=>AT,signal:AbortSignal.timeout(10_000),
    fetchImpl:(async url=>String(url).includes("/states/")?new Response("Unavailable",{status:404}):String(url)===SENATE_APPOINTMENTS_URL?new Response("Unavailable",{status:503}):new Response(fixture("senate-current.xml"),{headers:{etag:'"senators"'}})) as typeof fetch});
  assert.equal(result.roster.officeholders.length,100);assert.equal(result.complete,true);
  assert.ok(result.gaps.some(gap=>gap.sourceUrl===SENATE_APPOINTMENTS_URL && /503/.test(gap.detail)));
  assert.equal(result.roster.officeholders.find(row=>row.id==="congress:M001244")?.termStart,"");
});
test("Delaware's official POST rosters reach the shared acquisition and conditional source check",async()=>{
  const store=new MemoryEvidenceStore(),{locks}=createMemoryRepositories(),requests:{url:string;method:string|undefined;body:BodyInit|null|undefined;headers:Headers}[]=[];
  let now=AT;
  const fetchImpl=(async(url,init)=>{
    const href=String(url),headers=new Headers(init?.headers);requests.push({url:href,method:init?.method,body:init?.body,headers});
    assert.equal(init?.method,"POST");assert.equal(init?.body,"");
    if(headers.has("if-none-match"))return new Response(null,{status:304});
    const body=stateFixture(href.includes("GetRepresentatives")?"de-house-post.json.gz":"de-senate-post.json.gz");
    return new Response(body,{headers:{etag:'"delaware-roster"',"content-type":"application/json"}});
  }) as typeof fetch;
  const input={targetId:"official-legislature-de",store,locks,fetchImpl,now:()=>now,signal:AbortSignal.timeout(10_000)};
  const first=await acquireOfficialRoster(input);assert.equal(first.roster.officeholders.length,62);assert.equal(first.complete,true);assert.equal(requests.length,2);
  now="2026-10-13T04:20:32.259Z";
  const checked=await acquireOfficialRoster({...input,refresh:true});assert.equal(requests.length,4);assert.equal(checked.releaseId,first.releaseId);
  assert.ok(checked.acquisitions.every(row=>row.sourceCheck?.httpStatus===304 && row.retrievedAt===AT));
});
test("Georgia discovers its current session and checks both official sources conditionally using its public website access",async()=>{
  const store=new MemoryEvidenceStore(),{locks}=createMemoryRepositories(),requests:{url:string;headers:Headers}[]=[];
  let now=AT;
  const fetchImpl=(async(url,init)=>{
    const href=String(url),headers=new Headers(init?.headers);requests.push({url:href,headers});
    if(href.startsWith("https://www.legis.ga.gov/api/authentication/token?"))return new Response(JSON.stringify("public-site-session"),{headers:{"content-type":"application/json"}});
    assert.equal(headers.get("authorization"),"Bearer public-site-session");
    assert.ok([GEORGIA_SESSIONS_URL,`${GEORGIA_MEMBER_URL_PREFIX}1033`].includes(href));
    if(headers.has("if-none-match"))return new Response(null,{status:304});
    return new Response(stateFixture(href===GEORGIA_SESSIONS_URL?"ga-sessions-json.json.gz":"ga-roster-1033.json.gz"),{headers:{etag:'"georgia-official"',"content-type":"application/json"}});
  }) as typeof fetch;
  const input={targetId:"official-legislature-ga",store,locks,fetchImpl,now:()=>now,signal:AbortSignal.timeout(10_000)};
  const first=await acquireOfficialRoster(input);assert.equal(first.roster.officeholders.length,236);assert.equal(first.complete,true);assert.equal(first.acquisitions.length,2);assert.equal(requests.length,3);
  assert.equal(first.acquisitions[0]!.requestedUrl,GEORGIA_SESSIONS_URL);
  assert.equal(first.acquisitions[1]!.requestedUrl,`${GEORGIA_MEMBER_URL_PREFIX}1033`);
  await acquireOfficialRoster(input);assert.equal(requests.length,3,"replaying held source bytes does not request another public token");
  now="2026-10-13T04:20:32.259Z";
  const checked=await acquireOfficialRoster({...input,refresh:true});assert.equal(requests.length,6);assert.equal(checked.releaseId,first.releaseId);
  assert.ok(checked.acquisitions.every(row=>row.sourceCheck?.httpStatus===304 && row.retrievedAt===AT));
});
test("Alaska's current directory feeds the next pass's exact profiles through eight bounded source reads",async()=>{
  const folder=new URL("./fixtures/official-rosters/states/",import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL("manifest-alaska.json",folder),"utf8")) as {url:string;fixture:string}[];
  const sources=new Map(manifest.map(row=>[row.url,gunzipSync(readFileSync(new URL(row.fixture,folder))).toString("utf8")]));
  const expected=alaskaCurrentProfileRoutes(sources.get(ALASKA_DIRECTORY_URL)!);
  const store=new MemoryEvidenceStore(),{locks}=createMemoryRepositories();
  let active=0,maximum=0;const seen:string[]=[];
  const fetchImpl=(async(url,init)=>{
    const href=String(url),headers=new Headers(init?.headers);seen.push(href);active++;maximum=Math.max(maximum,active);
    try{
      await new Promise(resolve=>setImmediate(resolve));
      assert.ok(sources.has(href),href);
      if(headers.has("if-none-match"))return new Response(null,{status:304});
      return new Response(sources.get(href)!,{headers:{etag:'"alaska-source"',"content-type":"text/html"}});
    }finally{active--;}
  }) as typeof fetch;
  const input={targetId:"official-legislature-ak",store,locks,fetchImpl,now:()=>AT,signal:AbortSignal.timeout(10_000)};
  const first=await acquireOfficialRoster(input);assert.equal(first.roster.officeholders.length,60);assert.equal(first.complete,true);
  assert.equal(first.acquisitions.length,61);assert.equal(seen.length,61);assert.equal(maximum,8);
  assert.deepEqual(new Set(seen),new Set([ALASKA_DIRECTORY_URL,...expected]));
  assert.equal(first.roster.officeholders.find(row=>row.name==="Steve St. Clair")?.termStart,"2025-12-30");
  const confirmed=await acquireOfficialRoster({...input,refresh:true});assert.equal(confirmed.releaseId,first.releaseId);
  assert.ok(confirmed.acquisitions.every(row=>row.sourceCheck?.httpStatus===304 && row.retrievedAt===AT));
});
test("the publisher's current-session marker is checked before reading the selected South Dakota roster",async()=>{
  const store=new MemoryEvidenceStore(),{locks}=createMemoryRepositories();const seen:string[]=[];
  const fetchImpl=(async(url,init)=>{
    const href=String(url);seen.push(href);const headers=new Headers(init?.headers);
    if(headers.has("if-none-match"))return new Response(null,{status:304});
    assert.ok(["https://sdlegislature.gov/api/Sessions","https://sdlegislature.gov/api/SessionMembers/Session/71"].includes(href));
    return new Response(stateFixture(href.endsWith("/Sessions")?"sd-sessions-json.json.gz":"sd-roster-json.json.gz"),{headers:{etag:'"south-dakota-source"'}});
  }) as typeof fetch;
  const input={targetId:"official-legislature-sd",store,locks,fetchImpl,now:()=>AT,signal:AbortSignal.timeout(10_000)};
  const first=await acquireOfficialRoster(input);assert.equal(first.roster.officeholders.length,105);assert.equal(first.complete,true);
  assert.deepEqual(seen,["https://sdlegislature.gov/api/Sessions","https://sdlegislature.gov/api/SessionMembers/Session/71"]);
  const confirmed=await acquireOfficialRoster({...input,refresh:true});assert.equal(confirmed.releaseId,first.releaseId);
  assert.ok(confirmed.acquisitions.every(row=>row.sourceCheck?.httpStatus===304));
});
test("Wyoming's current root and declared modules supply the roster year before either chamber is read",async()=>{
  const folder=new URL("./fixtures/official-rosters/states/",import.meta.url);
  const manifests=["research-wy-current-modules.json","research-recovered.json"].flatMap(name=>JSON.parse(readFileSync(new URL(name,folder),"utf8"))) as {id:string;url:string;fixture?:string}[];
  const sources=new Map(manifests.filter(row=>row.fixture && (row.id.startsWith("wy-current-") || ["wy-house-proxy","wy-senate-proxy"].includes(row.id)))
    .map(row=>[row.url,gunzipSync(readFileSync(new URL(row.fixture!,folder))).toString("utf8")]));
  const store=new MemoryEvidenceStore(),{locks}=createMemoryRepositories();const seen:string[]=[];
  const fetchImpl=(async(url,init)=>{
    const href=String(url);seen.push(href);assert.ok(sources.has(href),href);
    if(new Headers(init?.headers).has("if-none-match"))return new Response(null,{status:304});
    return new Response(sources.get(href)!,{headers:{etag:'"wyoming-official"'}});
  }) as typeof fetch;
  const input={targetId:"official-legislature-wy",store,locks,fetchImpl,now:()=>AT,signal:AbortSignal.timeout(10_000)};
  const first=await acquireOfficialRoster(input);assert.equal(first.roster.officeholders.length,93);assert.equal(first.complete,true);assert.equal(first.acquisitions.length,7);
  assert.equal(seen[0],"https://wyoleg.gov/");assert.ok(seen.slice(1,5).every(url=>url.endsWith(".js")));
  assert.deepEqual(new Set(seen.slice(5)),new Set(["https://wyoleg.gov/LsoService/api/Legislator/2026/H","https://wyoleg.gov/LsoService/api/Legislator/2026/S"]));
  const checked=await acquireOfficialRoster({...input,refresh:true});assert.equal(checked.releaseId,first.releaseId);assert.ok(checked.acquisitions.every(row=>row.sourceCheck?.httpStatus===304));
});
