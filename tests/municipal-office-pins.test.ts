import { installKeyedRows } from "./helpers/keyed-rows.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readOfficeContexts, withMunicipalHallOffices } from "../lib/meetings/municipal-office.ts";
import { placePublishedMeetingPins } from "../lib/meetings/publish-pins.ts";
import type { MeetingPinBody } from "../lib/meetings/pin-location.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { factDb } from "./helpers/fact-db.ts";

const DIVISION = "ocd-division/country:us/state:id/place:boise_city", BODY = `${DIVISION}#governing`;
const NOW = "2026-10-25T09:00:00.000Z";
const { source, target } = JSON.parse(readFileSync(new URL("./fixtures/mt01-municipal-hall-meetings.json", import.meta.url), "utf8")) as { source: Meeting; target: Meeting };
const HALL = source.location!.address!;
const HALL_ADDRESS = "150 N. Capitol Blvd, Boise, ID 83702";
const census = JSON.parse(readFileSync(new URL("./fixtures/mt01-municipal-hall-census.json", import.meta.url), "utf8"));
const reply = (value: unknown) => new Response(JSON.stringify(value));

test("the same municipality's published hall address supplies a saved government-office fallback", async () => {
  const db = await factDb();
  try {
    await db.pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,payload jsonb,current_version_id text DEFAULT 'fixture',promoted_at timestamptz DEFAULT now());
      CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)`);
    for (const statement of readFileSync(new URL("../lib/db/migrations/0036_ne01.sql", import.meta.url), "utf8").split("--> statement-breakpoint"))
      if (/CREATE FUNCTION reader_payload_(?:node|value|members)\(/.test(statement)) await db.pg.exec(statement);
    await installKeyedRows(db.pg);
    const scope = `source:iqm2:body:${encodeURIComponent(source.bodyId!)}`;
    const repeated = Array.from({length:100},(_,index)=>({...source,id:`fixture:repeated-hall:${index}`,
      startsAt:new Date(Date.parse(source.startsAt)+index*60000).toISOString()}));
    await db.query("INSERT INTO civic_data_promotions(key,record_class,scope,payload) VALUES($1,'MEETING',$2,$3)", [`MEETING:${scope}`, scope, JSON.stringify({ meetings: [source,...repeated] })]);
    const requests: string[] = [];
    const hallRows:number[]=[];
    const query:typeof db.query=async(sql,params)=>{const rows=await db.query(sql,params);if(sql.includes('halls AS ('))hallRows.push(rows.length);return rows;};
    const placed = await placePublishedMeetingPins({ meetings: [target], query, offices: new Map(), clock: () => NOW,
      fetchImpl: async input => {
        const address = new URL(String(input)).searchParams.get("address")!;
        requests.push(address);
        // The meeting's omitted directional has two competing Census candidates.
        return reply(address.includes("150 N.") ? census : { result: { addressMatches: [
          ...census.result.addressMatches, ...census.result.addressMatches] } });
      } });
    assert.deepEqual(placed.held, []);
    assert.deepEqual(requests, ["150 Capitol Blvd, Boise, ID 83702", "150 N. Capitol Blvd, Boise, ID 83702"]);
    const pin = placed.meetings[0].mapPin!;
    assert.equal(pin.basis, "GOVERNMENT_OFFICE");
    assert.equal(pin.address, HALL_ADDRESS);
    assert.deepEqual(hallRows,[1],"Repeated meetings at one published hall return one candidate from Postgres");
    assert.equal(pin.provenance.sourceUrl, source.provenance.sourceUrl);
    assert.equal(pin.lat, 43.615387122768);
    assert.equal(pin.lng, -116.201864471479);
    assert.equal(placed.meetings[0].location, null);
    assert.equal(placed.meetings[0].venueGap?.publishedText, target.venueGap!.publishedText);
    assert.equal(placed.meetings[0].id, target.id);
    assert.equal(source.location!.address,HALL,"The source location remains exactly as published");
    const changedRoom={...source,location:{...source.location!,name:HALL.replace('Tablerock','Greenbelt'),address:HALL.replace('Tablerock','Greenbelt')}};
    await db.query("UPDATE civic_data_promotions SET payload=$1 WHERE key=$2",[JSON.stringify({meetings:[changedRoom]}),`MEETING:${scope}`]);
    const following = await placePublishedMeetingPins({ meetings: [target], previous: placed.meetings,
      query: db.query, offices: new Map(), clock: () => "2026-10-25T10:00:00.000Z",
      fetchImpl: async () => { throw Error("Saved office requested Census again"); } });
    assert.deepEqual(following.held, []);
    assert.deepEqual(following.meetings[0].mapPin, pin);
    assert.equal(following.responses.length, 0);
    const withoutHall = await placePublishedMeetingPins({ meetings: [target], previous: placed.meetings,
      offices: new Map(), query: async () => [], fetchImpl: async () => reply({ result: { addressMatches: [] } }) });
    assert.deepEqual(withoutHall.held, []);
    assert.deepEqual(withoutHall.meetings[0].mapPin, pin, "A calendar dropping a hall citation does not erase a saved office pin");
  } finally { await db.pg.close(); }
});

test("a hall cannot borrow a neighboring city, a county, a school district or a mailing address", async () => {
  for (const changed of [
    { bodyId: "ocd-division/country:us/state:id/place:meridian#governing" },
    { ocdId: "ocd-division/country:us/state:id/place:meridian" },
    { jurisdiction: "Boise School District" },
    { jurisdiction: "County of Boise" },
    { location: { ...source.location!, address: "150 N. Capitol Blvd, Meridian, ID 83702" } },
    { location: { ...source.location!, address: "150 N. Capitol Blvd, Boise, WA 83702" } },
    { location: { ...source.location!, address: "P.O. Box 500, Boise, ID 83702" } },
    { location: { ...source.location!, name: "Town Hall Meeting at a library" } },
    { provenance: { ...source.provenance, sourceUrl: null } },
  ]) {
    const unstated = { ...target, venueGap: { kind: "NOT_STATED_BY_PUBLISHER" as const, publishedText: null, publisher: "CITY OF BOISE" } };
    const result = await withMunicipalHallOffices(undefined, [unstated, { ...source, ...changed }], new Map(), () => assert.fail());
    assert.deepEqual(result.get(BODY)?.governmentOfficeAlternatives, [], JSON.stringify(changed));
  }
  const county = { ...target, bodyId: "ocd-division/country:us/state:id/county:ada#governing", jurisdiction: "County of Ada" };
  const result = await withMunicipalHallOffices(async () => [], [county, source], new Map(), () => assert.fail());
  assert.deepEqual(result.get(county.bodyId)?.governmentOfficeAlternatives??[],[],"a county can acquire its own courthouse but cannot borrow a city hall");
});

test("a valid hall after a bounded page is still available to publication", async () => {
  const offsets: number[] = [];
  const result = await withMunicipalHallOffices(async (_sql, params) => {
    offsets.push(params![3] as number);
    const invalid = { body_id: source.bodyId, ocd_id: DIVISION, jurisdiction: source.jurisdiction,
      location: { ...source.location, address: "P.O. Box 500, Boise, ID 83702" }, provenance: source.provenance };
    return params![3] === 0 ? Array.from({ length: 64 }, () => invalid)
      : [{ ...invalid, location: source.location }];
  }, [{ ...target, venueGap: undefined }], new Map(), () => assert.fail());
  assert.deepEqual(offsets, [0, 64]);
  assert.equal(result.get(BODY)?.governmentOfficeAlternatives?.[0].address, HALL_ADDRESS);
});

test("unchanged verified board and explicit government references do not reread hall candidates",async()=>{
  for(const basis of ["BODY_OFFICE","GOVERNMENT_OFFICE"] as const){
    const offices=new Map<string,MeetingPinBody>([[BODY,{bodyId:BODY,name:'Council',
      ...(basis==='BODY_OFFICE'?{officeContact:{address:HALL_ADDRESS,phone:null,provenance:source.provenance}}
        :{governmentOffice:{name:'City of Boise',address:HALL_ADDRESS,provenance:source.provenance}})}]]);
    const missing:Meeting={...target,venueGap:{kind:'NOT_STATED_BY_PUBLISHER',publishedText:null,publisher:target.jurisdiction}};
    const first=await placePublishedMeetingPins({meetings:[missing,source],offices,fetchImpl:async()=>reply(census)});
    assert.deepEqual(first.held,[]);assert.equal(first.meetings[0].mapPin?.basis,basis);
    const next=await placePublishedMeetingPins({meetings:[missing],previous:first.meetings,offices,
      query:async()=>{throw Error('A verified higher reference reread the hall calendars');},
      fetchImpl:async()=>{throw Error('A verified higher reference requested Census again');}});
    assert.deepEqual(next.held,[]);assert.deepEqual(next.meetings[0].mapPin,first.meetings[0].mapPin);
  }
});

test("a board's own address and an explicit government office retain priority over a hall venue", async () => {
  for (const basis of ["BODY_OFFICE", "GOVERNMENT_OFFICE"] as const) {
    const offices = new Map<string, MeetingPinBody>([[BODY, { bodyId: BODY, name: "Council",
      ...(basis === "BODY_OFFICE" ? { officeContact: { address: "150 N. Capitol Blvd, Boise, ID 83702", phone: null, provenance: source.provenance } }
        : { governmentOffice: { name: "City of Boise", address: "150 N. Capitol Blvd, Boise, ID 83702", provenance: source.provenance } }) }]]);
    const result = await placePublishedMeetingPins({ meetings: [{ ...target, venueGap: { kind: "NOT_STATED_BY_PUBLISHER", publishedText: null, publisher: "CITY OF BOISE" } }, source],
      offices, fetchImpl: async () => reply(census) });
    assert.deepEqual(result.held, []);
    assert.equal(result.meetings[0].mapPin?.basis, basis);
    assert.deepEqual(result.meetings[1], source, "Existing meeting location remains visible");
  }
});


const COUNTY="ocd-division/country:us/state:wi/county:milwaukee",COUNTY_BODY=`${COUNTY}#body:finance`;
const COURTHOUSE="901 N. 9th Street, Milwaukee, WI";
const countySource:Meeting={...source,id:"legistar:milwaukeecounty:7080",bodyId:`${COUNTY}#body:election-commission`,ocdId:COUNTY,
  jurisdiction:"County of Milwaukee",location:{name:"Courthouse Rm G10 / Cafeteria",address:COURTHOUSE,lat:43.040887236474,lng:-87.923149040346},
  provenance:{...source.provenance,sourceUrl:"https://county.example.gov/calendar",sourceOrg:"Milwaukee County"},
  fieldSources:{location:{sourceUrl:"https://county.example.gov/elections/agenda.pdf",sourceOrg:"Milwaukee County",collectedAt:NOW,verifiedAt:null,
    quote:COURTHOUSE}},mapPin:{meetingId:"legistar:milwaukeecounty:7080",bodyId:`${COUNTY}#body:election-commission`,name:"Courthouse Rm G10 / Cafeteria",
    address:COURTHOUSE,basis:"MEETING",provenance:source.provenance,lat:43.040887236474,lng:-87.923149040346,
    matchedAddress:"901 N 9TH ST, MILWAUKEE, WI, 53233",coordinateSourceUrl:"https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=901+N+9th+Street%2C+Milwaukee%2C+WI&benchmark=Public_AR_Current&format=json",
    coordinateCheckedAt:NOW}};
const countyTarget:Meeting={...target,id:"legistar:milwaukeecounty:unplaced",bodyId:COUNTY_BODY,ocdId:COUNTY,jurisdiction:"Milwaukee County",location:null,
  venueGap:{kind:"NOT_STATED_BY_PUBLISHER",publishedText:null,publisher:"Milwaukee County"}};

test("the exact county's published courthouse supplies its government office and retains its verified point metadata",async()=>{
  const result=await withMunicipalHallOffices(undefined,[countyTarget,countySource],new Map(),()=>assert.fail());
  const office=result.get(COUNTY_BODY)?.governmentOfficeAlternatives?.[0];
  assert.equal(office?.address,COURTHOUSE);
  assert.equal(office?.provenance.sourceUrl,countySource.fieldSources?.location?.sourceUrl,"the published physical address cites its own source rather than the calendar's room label");
  assert.equal(office?.quote,COURTHOUSE);
  assert.deepEqual(office?.verifiedPoint,{lat:43.040887236474,lng:-87.923149040346,matchedAddress:countySource.mapPin!.matchedAddress,
    coordinateSourceUrl:countySource.mapPin!.coordinateSourceUrl,coordinateCheckedAt:NOW});
  assert.deepEqual(countySource.location,{name:"Courthouse Rm G10 / Cafeteria",address:COURTHOUSE,lat:43.040887236474,lng:-87.923149040346});
});

test("county courthouse fallback rejects federal, neighboring, municipal and school ownership",async()=>{
  for(const changed of [
    {jurisdiction:"County of Waukesha"},
    {ocdId:"ocd-division/country:us/state:wi/county:waukesha"},
    {bodyId:"ocd-division/country:us/state:wi/county:waukesha#body:elections"},
    {jurisdiction:"City of Milwaukee"},
    {jurisdiction:"Milwaukee County School District"},
    {location:{...countySource.location!,name:"Federal Courthouse"}},
    {location:{...countySource.location!,name:"U.S. Courthouse"}},
    {location:{...countySource.location!,name:"Waukesha County Courthouse"}},
    {location:{...countySource.location!,name:"City Hall"}},
    {location:{...countySource.location!,address:"PO Box 100, Milwaukee, WI"}},
    {location:{...countySource.location!,address:"901 N. 9th Street, Milwaukee, MN"}},
    {bodyId:"government:US-MN:cog:other#governing"},
  ]){
    const result=await withMunicipalHallOffices(undefined,[countyTarget,{...countySource,...changed}],new Map(),()=>assert.fail());
    assert.deepEqual(result.get(COUNTY_BODY)?.governmentOfficeAlternatives,[],JSON.stringify(changed));
  }
});

test("native government body identities recover only their exact published county or municipal office",async()=>{
  const nativeCounty={...countyTarget,bodyId:"government:US-WI:cog:county#body:finance"};
  const nativeCity:Meeting={...target,bodyId:"government:US-ID:cog:boise#body:finance",ocdId:DIVISION,jurisdiction:"City of Boise",location:null,
    venueGap:{kind:"NOT_STATED_BY_PUBLISHER",publishedText:null,publisher:"City of Boise"}};
  for(const [missing,existing] of [[nativeCounty,countySource],[nativeCounty,{...countySource,bodyId:"government:US-WI:cog:county#body:elections",
    mapPin:undefined}],[nativeCity,source],[nativeCity,{...source,bodyId:"government:US-ID:cog:boise#governing"}]] as const){
    const result=await withMunicipalHallOffices(undefined,[missing,existing],new Map(),()=>assert.fail());
    assert.equal(result.get(missing.bodyId!)?.governmentOfficeAlternatives?.[0]?.address,missing===nativeCounty?COURTHOUSE:HALL_ADDRESS);
  }
  const wrongNative={...nativeCity,bodyId:"government:US-WI:cog:boise#body:finance"};
  assert.equal((await withMunicipalHallOffices(undefined,[wrongNative,source],new Map(),()=>assert.fail())).size,0);
});

test("the bounded courthouse read includes exact-location provenance and point metadata from a native partition",async()=>{
  const db=await factDb();
  try{
    await db.pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,payload jsonb,current_version_id text DEFAULT 'fixture',promoted_at timestamptz DEFAULT now());
      CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)`);
    for(const statement of readFileSync(new URL("../lib/db/migrations/0036_ne01.sql",import.meta.url),"utf8").split("--> statement-breakpoint"))
      if(/CREATE FUNCTION reader_payload_(?:node|value|members)\(/.test(statement))await db.pg.exec(statement);
    await installKeyedRows(db.pg);
    const body="government:US-WI:cog:county#body:elections",physical={...countySource,bodyId:body,
      mapPin:{...countySource.mapPin!,bodyId:body}};
    const scope=`source:legistar:body:${encodeURIComponent(body)}`;
    await db.query("INSERT INTO civic_data_promotions(key,record_class,scope,payload) VALUES($1,'MEETING',$2,$3)",[`MEETING:${scope}`,scope,JSON.stringify({meetings:[{...physical,id:"legistar:milwaukeecounty:newer-same-address",mapPin:undefined,
      startsAt:new Date(Date.parse(physical.startsAt)+60000).toISOString()},physical]})]);
    const result=await withMunicipalHallOffices(db.query,[countyTarget],new Map(),()=>assert.fail());
    assert.equal(result.get(COUNTY_BODY)?.governmentOfficeAlternatives?.[0]?.address,COURTHOUSE);
    assert.equal(result.get(COUNTY_BODY)?.governmentOfficeAlternatives?.[0]?.provenance.sourceUrl,physical.fieldSources!.location!.sourceUrl);
    assert.equal(result.get(COUNTY_BODY)?.governmentOfficeAlternatives?.[0]?.verifiedPoint?.lat,physical.location!.lat);
  }finally{await db.pg.close();}
});

test("another body's verified courthouse point reaches the county's unplaced meeting without another Census request",async()=>{
  const result=await placePublishedMeetingPins({meetings:[countyTarget,countySource],offices:new Map(),clock:()=>NOW,
    fetchImpl:async()=>{throw Error("A saved courthouse point was geocoded unchanged");}});
  assert.deepEqual(result.held,[]);assert.equal(result.responses.length,0);
  const meeting=result.meetings[0];
  assert.equal(meeting.mapPin?.basis,"GOVERNMENT_OFFICE");assert.equal(meeting.mapPin?.address,COURTHOUSE);
  assert.equal(meeting.mapPin?.lat,countySource.location!.lat);assert.equal(meeting.mapPin?.lng,countySource.location!.lng);
  assert.equal(meeting.mapPin?.coordinateSourceUrl,countySource.mapPin!.coordinateSourceUrl);
  assert.equal(meeting.mapPin?.coordinateCheckedAt,NOW);assert.equal(meeting.location,null);
  assert.deepEqual(result.meetings[1],countySource,"the source body's own meeting and pin remain visible");
  const named={...countyTarget,venueGap:{kind:"STATED_NOT_PLACED" as const,publishedText:`Courthouse, ${COURTHOUSE}`,publisher:"Milwaukee County"}};
  const duplicate=await withMunicipalHallOffices(undefined,[named,countySource],new Map(),()=>assert.fail());
  assert.equal(duplicate.get(COUNTY_BODY)?.governmentOfficeAlternatives?.length,1);
  assert.equal(duplicate.get(COUNTY_BODY)?.governmentOfficeAlternatives?.[0]?.verifiedPoint?.lat,countySource.location!.lat,
    "an earlier repeated address without coordinates cannot discard a later saved point");
  let requests=0;
  const conflict={...countySource,mapPin:{...countySource.mapPin!,lat:countySource.mapPin!.lat+1}};
  const mismatched=await placePublishedMeetingPins({meetings:[countyTarget,conflict],offices:new Map(),clock:()=>NOW,
    fetchImpl:async()=>{requests++;return reply({result:{addressMatches:[]}});}});
  assert.equal(requests,1);assert.equal(mismatched.meetings[0].mapPin,undefined,"mismatched saved coordinate metadata cannot supply a point");
});


test("office acquisition reads one actual owner context per body without waiting on a pin or loading complete meetings",async()=>{
  const db=await factDb();
  try{
    await db.pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,payload jsonb,current_version_id text DEFAULT 'fixture',promoted_at timestamptz DEFAULT now());
      CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)`);
    for(const statement of readFileSync(new URL("../lib/db/migrations/0036_ne01.sql",import.meta.url),"utf8").split("--> statement-breakpoint"))
      if(/CREATE FUNCTION reader_payload_(?:node|value|members)\(/.test(statement))await db.pg.exec(statement);
    await installKeyedRows(db.pg);
    const wanted={...countyTarget,id:"legistar:milwaukeecounty:current",startsAt:NOW};
    const older={...wanted,id:"legistar:milwaukeecounty:older",startsAt:new Date(Date.parse(NOW)-60000).toISOString()};
    const scope=`source:legistar:body:${encodeURIComponent(COUNTY_BODY)}`;
    await db.query("INSERT INTO civic_data_promotions(key,record_class,scope,payload) VALUES($1,'MEETING',$2,$3)",[`MEETING:${scope}`,scope,
      JSON.stringify({meetings:[older,wanted],agendaDocuments:[{text:"Unrelated document contents".repeat(10000)}]})]);
    const sourceScope=`source:legistar:body:${encodeURIComponent(countySource.bodyId!)}`;
    await db.query("INSERT INTO civic_data_promotions(key,record_class,scope,payload) VALUES($1,'MEETING',$2,$3)",[`MEETING:${sourceScope}`,sourceScope,JSON.stringify({meetings:[countySource]})]);
    const native="government:US-WI:cog:county#body:planning",derived={...wanted,id:"derived:planning",bodyId:native,bodyName:"Planning Commission"};
    await db.query("INSERT INTO civic_data_promotions(key,record_class,scope,payload) VALUES('MEETING:source:derived:family:US-WI','MEETING','source:derived:family:US-WI',$1)",
      [JSON.stringify({meetings:[derived,{...derived,id:"derived:unrequested",bodyId:"government:US-WI:cog:other#governing"}]})]);
    const contexts=await readOfficeContexts(db.query,[COUNTY_BODY,native,COUNTY_BODY]);
    assert.equal(contexts.length,2);
    const held=contexts.find(context=>context.bodyId===COUNTY_BODY)!;
    assert.deepEqual(held,{id:wanted.id,bodyId:COUNTY_BODY,ocdId:COUNTY,bodyName:wanted.bodyName,jurisdiction:wanted.jurisdiction,provenance:wanted.provenance});
    assert.deepEqual(Object.keys(held).sort(),["id","bodyId","ocdId","bodyName","jurisdiction","provenance"].sort());
    assert.ok(!JSON.stringify(contexts).includes("Unrelated document contents"));
    const offices=await withMunicipalHallOffices(db.query,contexts,new Map(),()=>assert.fail());
    for(const body of [COUNTY_BODY,native]){
      assert.equal(offices.get(body)?.governmentOfficeAlternatives?.[0]?.address,COURTHOUSE);
      assert.equal(offices.get(body)?.governmentOfficeAlternatives?.[0]?.verifiedPoint?.lat,countySource.location!.lat);
    }
    assert.deepEqual(await readOfficeContexts(async()=>{throw Error("An empty body set must not query any source");},[]),[]);
  }finally{await db.pg.close();}
});


test("a corrected explicit school owner cannot inherit a neighboring county courthouse from its old calendar label",async()=>{
  const offices=new Map([[COUNTY_BODY,{bodyId:COUNTY_BODY,name:"Governing Board",
    governmentOwner:{id:"government:US-WI:nces:school",name:"Independent School District"}}]]);
  const selected=await withMunicipalHallOffices(undefined,[countyTarget,countySource],offices,()=>assert.fail());
  assert.equal(selected.get(COUNTY_BODY)?.governmentOfficeAlternatives,undefined);
});
