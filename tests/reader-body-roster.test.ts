import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/reader/roster/route.ts";
import { preparePlaceRosters, savePlaceRosters, placeBodyRoster } from "../lib/reader/body-roster.ts";
import { loadReaderBodyRoster } from "../lib/reader/body-roster-client.ts";
import { expandReaderValues, shareReaderValues } from "../lib/reader/shared.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { factDb } from "./helpers/fact-db.ts";
import type { PlacePackage } from "../lib/reader/place-types.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";
import { readPlacePackage, READY_PLACE_SQL } from "../lib/reader/place.ts";

const CITY="ocd-division/country:us/state:az/place:roster-fixture";
const source={sourceUrl:"https://example.gov/board",sourceOrg:"Council",collectedAt:"2026-10-26",verifiedAt:null};

test("ready pages omit full rosters; opening bodies shares one immutable, complete roster with every portrait", async()=>{
  const ids=[`${CITY}#one`,`${CITY}#two`];
  const member={id:"roster:shared-fixture#member",personId:"person:shared-fixture",name:"Verified member — é",officeTitle:"Superintendent",termNote:null,
    email:null,phone:null,websiteUrl:null};
  const snapshot={formatVersion:1,generatedAt:"2026-10-26T00:00:00Z",meetings:[],sources:[],agendaDocuments:[],counts:{fresh:0,carried:0,total:0}};
  const place={registry:{formatVersion:1,registry:{generatedAt:snapshot.generatedAt,divisions:[],bodies:ids.map(id=>({id,ocdId:CITY,name:id}))},
    bodyRosters:ids.map(bodyId=>({bodyId,bodyName:bodyId,members:[member,{...member,id:"roster:shared-fixture#board",personId:"person:board-fixture",name:"Board member",officeTitle:"Member"}],membershipHistory:[{...member,id:"roster:earlier-fixture",name:"Earlier member"}],
      ...source,partisanship:"UNDETERMINED"})),rosterPhotos:{[member.id]:"https://example.gov/member.jpg"},
    rosterReaderDispositions:[],officialPhotos:{photos:[]},officialCandidacies:{rows:[]},statewideExecutives:[]},
    bodies:[],meetings:[],snapshot,bodySnapshots:{},snapshotHeldAt:snapshot.generatedAt,agendaDocumentLinks:[],publicationAttempts:[],
    everydayRouting:null,governments:[],divisions:[],registrationHeld:true} as unknown as PlacePackage;
  const expected=JSON.parse(JSON.stringify(placeBodyRoster(place,ids[0]!)));
  const prepared=preparePlaceRosters(place);
  assert.equal(prepared.rosters.size,1,"identical membership travels and is stored once");
  assert.equal(new Set(Object.values(prepared.place.rosterRefs!)).size,1);
  assert.equal(prepared.place.registry!.bodyRosters[0]!.members.length,0);
  assert.deepEqual(prepared.place.rosterPreviews![ids[0]!]?.map(holder=>holder.name),[member.name],"the list retains only its named executive");
  assert.equal(prepared.place.registry!.bodyRosters[0]!.membershipHistory!.length,0);
  assert.deepEqual(prepared.place.registry!.rosterPhotos,{});
  for(const saved of [place,prepared.place]) {
    const list=await readPlacePackage({state:"AZ",placeId:"zip:85701",divisionIds:[]},async sql=>{
      assert.equal(sql,READY_PLACE_SQL);return [{page:saved}];
    });
    assert.equal(list.rosterRefs![ids[0]!],saved.rosterRefs ? prepared.place.rosterRefs![ids[0]!] : "unbuilt",
      "a legacy page must not point to an immutable roster resource that was never published");
  }
  const db=await factDb();const originalFetch=globalThis.fetch;
  try {
    await savePlaceRosters(db.query,[place,place]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM reader_body_roster"))[0]!.n,1);
    let queries=0,fetches=0;
    installFactReader(async(text,params)=>{
      queries++;assert.equal(text,"SELECT payload FROM reader_body_roster WHERE hash=$1");return db.query(text,params);
    });
    globalThis.fetch=(async(input,init)=>{fetches++;
      const url=new URL(String(input),"https://example.test");assert.equal(url.searchParams.has("body"),false,"shared roster URLs depend only on their content hash");
      return GET(new Request(url,init));}) as typeof fetch;
    const bodies=ids.map(bodyId=>({bodyId,rosterRef:prepared.place.rosterRefs![bodyId]} as CoveredBody));
    const [first,second]=await Promise.all(bodies.map(loadReaderBodyRoster));
    assert.deepEqual(first,expected);assert.deepEqual(second,expected);
    assert.equal(first!.members[0]!.photoUrl,"https://example.gov/member.jpg");
    assert.equal(first!.earlierMembers![0]!.name,"Earlier member");
    assert.equal(fetches,1);assert.equal(queries,1);
    assert.deepEqual(await loadReaderBodyRoster(bodies[0]!),expected);assert.equal(fetches,1);
    const hash=bodies[0]!.rosterRef!;
    const response=await GET(new Request(`https://example.test/api/reader/roster?hash=${hash}&body=${encodeURIComponent(ids[0]!)}`));
    assert.equal(response.status,200);assert.match(response.headers.get("cache-control")!,/immutable/);
    assert.ok(Buffer.byteLength(await response.text())<2000);
    const conditional=await GET(new Request(`https://example.test/api/reader/roster?hash=${hash}&body=${encodeURIComponent(ids[1]!)}`,{headers:{"if-none-match":`"${hash}"`}}));
    assert.equal(conditional.status,304);
    assert.equal((await GET(new Request("https://example.test/api/reader/roster?hash=invalid&body=x"))).status,400);
  } finally {globalThis.fetch=originalFetch;installFactReader(undefined);await db.pg.close();}
});

test("shared list values round-trip Unicode, citations, arrays, null and false without changing any field",()=>{
  const value={coverage:{bodies:[{bodyId:CITY,fieldSources:{name:source}},{bodyId:CITY,fieldSources:{name:source}}]},
    metadata:{blank:"",missing:null,enabled:false},repeat:[CITY,CITY],unicode:"予算 — é"};
  const wire=shareReaderValues(value);
  assert.ok(JSON.stringify(wire).length<JSON.stringify(value).length);
  assert.deepEqual(expandReaderValues(JSON.parse(JSON.stringify(wire))),value);
  assert.deepEqual(expandReaderValues(value),value);
  const optional={members:[{name:"First",contactKind:undefined,termEnd:null},{name:"Second",contactKind:undefined,termEnd:null}]};
  assert.deepEqual(expandReaderValues(JSON.parse(JSON.stringify(shareReaderValues(optional)))),JSON.parse(JSON.stringify(optional)));
});

test("a failed roster can be retried and an unbuilt body's cached membership refreshes",async t=>{
  t.mock.timers.enable({apis:["Date"],now:new Date("2026-10-26T00:00:00Z")});
  const originalFetch=globalThis.fetch;let calls=0;
  const body={bodyId:"fixture:unbuilt-roster-cache",rosterRef:"unbuilt"} as CoveredBody;
  globalThis.fetch=(async()=>{
    calls++;
    return calls===1 ? new Response("{}",{status:503}) : Response.json({members:[{id:"member",name:`Published member ${calls}`}],gaps:[],officePhone:null});
  }) as typeof fetch;
  try {
    const first=loadReaderBodyRoster(body),second=loadReaderBodyRoster(body);
    assert.equal(first,second);
    assert.deepEqual((await Promise.allSettled([first,second])).map(result=>result.status),["rejected","rejected"]);
    assert.equal(calls,1);
    assert.equal((await loadReaderBodyRoster(body)).members[0]!.name,"Published member 2");
    await loadReaderBodyRoster(body);assert.equal(calls,2);
    t.mock.timers.tick(31_000);
    assert.equal((await loadReaderBodyRoster(body)).members[0]!.name,"Published member 3");
    assert.equal(calls,3);
  } finally {globalThis.fetch=originalFetch;}
});
