import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { factDb } from "./helpers/fact-db.ts";
import { publishHeldMeetingPins, HELD_PIN_PRIOR_VENUES_SQL } from "../lib/civic-data/held-meeting-pins.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { readSittingFacts,withSittingFacts } from "../lib/facts/meeting-read.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { placePublishedMeetingPins } from "../lib/meetings/publish-pins.ts";

const NOW="2026-10-24T18:00:00.000Z",OLD="2026-10-13T01:48:06.116Z";
const DIVISION="ocd-division/country:us/state:az/school_district:sunnyside_unified_district",BODY=`${DIVISION}#board`;
const OFFICE="2238 E. Ginter Road Tucson, AZ 85706",OWN="1415 W Melody Ln, Bisbee, AZ 85603";
const online:Meeting={id:"diligent:susd12:2026-10-13T0730-virtual-governing-board",bodyId:BODY,ocdId:DIVISION,
  bodyName:"Virtual Governing Board",title:"Virtual Governing Board Meeting",jurisdiction:"Sunnyside Unified School District, AZ",
  startsAt:"2026-10-13T07:30:00-07:00",timeZone:"America/Phoenix",status:"CONCLUDED",location:null,agendaUrl:null,
  online:{label:"Virtual",joinUrl:null},carried:{reason:"UNEXPLAINED_DISAPPEARANCE",source:"diligent",lastFreshAt:OLD},
  provenance:{sourceUrl:"https://www.susd12.org/event_view?event_id=1281230",sourceOrg:"Sunnyside Unified School District Governing Board",collectedAt:OLD,verifiedAt:null}};

async function setup(meetings:readonly Meeting[],office=OFFICE){
  const db=await factDb();
  await db.pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,promoted_at timestamptz,payload jsonb);
    CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);
    ALTER TABLE civic_data_promotions ADD COLUMN source_id text DEFAULT 'fixture';
    CREATE TABLE civic_data_candidates(id text PRIMARY KEY,source_id text,record_class text,scope text,state text,retrieved_at timestamptz,candidate jsonb)`);
  for(const statement of readFileSync(new URL("../lib/db/migrations/0036_ne01.sql",import.meta.url),"utf8").split("--> statement-breakpoint"))
    if(/CREATE FUNCTION reader_payload_(?:node|value|members)\(/.test(statement))await db.pg.exec(statement);
  await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Sunnyside Unified School District','AZ',NULL),($2,'body','Governing Board','AZ',$1)",[DIVISION,BODY]);
  const [copy]=await db.query(`INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key)
    VALUES('https://www.susd12.org/office','https://www.susd12.org/office',$1,$2,'office') RETURNING id`,[OLD,"a".repeat(64)]);
  await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
    VALUES($1,'office_address',$2,$3,'live','OFFICIAL',$4,$3,$5,'fixture')`,[BODY,JSON.stringify(office),office,copy.id,OLD]);
  await db.query(`INSERT INTO civic_data_promotions(key,record_class,scope,current_version_id,promoted_at,payload)
    VALUES('MEETING:held','MEETING','source:diligent:body:held','cv-held',$1,$2)`,[OLD,JSON.stringify({meetings})]);
  return db;
}

function geocode(house:string,street:string,suffix:string,direction:string,city:string,zip:string){
  return {result:{addressMatches:[{matchedAddress:`${house} ${direction} ${street} ${suffix}, ${city}, AZ, ${zip}`,
    coordinates:{x:-110.9,y:32.2},addressComponents:{fromAddress:house,toAddress:house,streetName:street,suffixType:suffix,
      preDirection:direction,city,state:"AZ",zip}}]}};
}

test("the automatic fact pass restores a carried online office pin, places a held address, and the following pass makes no Census request",async()=>{
  const physical:Meeting={...online,id:"legistar:held:1",online:undefined,carried:undefined,title:"Regular Meeting",
    venueGap:{kind:"STATED_NOT_PLACED",publisher:"District",publishedText:OWN}};
  const existing:Meeting={...physical,id:"legistar:held:already-placed",venueGap:undefined,location:{name:"Existing room",address:OWN,lat:31.3,lng:-109.9}};
  const originals=[online,physical,existing],db=await setup(originals),vault=new MemoryEvidenceStore();let requests=0;
  try{
    const fetchImpl:typeof fetch=async input=>{
      requests++;const url=new URL(String(input));assert.equal(url.hostname,"geocoding.geo.census.gov","the calendar is never fetched again");
      const board=url.searchParams.get("address")!.includes("2238");
      return new Response(JSON.stringify(board?geocode("2238","GINTER","RD","E","TUCSON","85706"):geocode("1415","MELODY","LN","W","BISBEE","85603")));
    };
    const first=await publishHeldMeetingPins({facts:db,vault,clocks:factClocks(null),now:NOW,clock:()=>Date.parse(NOW),deadlineMs:Date.parse(NOW)+60000,fetchImpl});
    assert.deepEqual(first,{considered:2,published:2,unplaced:0,failures:[]});assert.equal(requests,2);
    const facts=(await readSittingFacts(db.query,[BODY])).get(BODY)!;
    const read=withSittingFacts(originals,facts);
    assert.equal(read[0].id,online.id);assert.equal(read[0].mapPin?.basis,"BODY_OFFICE");assert.equal(read[0].location,null);
    assert.deepEqual(read[0].online,online.online);assert.equal(read[0].provenance.collectedAt,OLD);
    assert.equal(read[1].mapPin?.basis,"MEETING");assert.equal(read[1].location?.address,OWN);assert.equal(read[1].venueGap,undefined);
    assert.deepEqual(read[2],existing,"the already-visible point is untouched");
    const nextAt=new Date(Date.parse(NOW)+3600000).toISOString();
    const next=await publishHeldMeetingPins({facts:db,vault,clocks:factClocks(null),now:nextAt,clock:()=>Date.parse(nextAt),deadlineMs:Date.parse(nextAt)+60000,
      fetchImpl:async()=>{throw new Error("a saved point must not be geocoded again");}});
    assert.deepEqual(next,{considered:0,published:0,unplaced:0,failures:[]});
    const calendar=await placePublishedMeetingPins({meetings:originals.map(meeting=>({...meeting,provenance:{...meeting.provenance,collectedAt:nextAt}})),
      query:db.query,clock:()=>nextAt,fetchImpl:async()=>{throw new Error("the calendar publisher must reuse the already-published point");}});
    assert.equal(calendar.responses.length,0);assert.deepEqual(calendar.held,[]);
    assert.equal(calendar.meetings[0].mapPin?.basis,"BODY_OFFICE");assert.equal(calendar.meetings[1].mapPin?.basis,"MEETING");
    assert.equal(calendar.meetings[0].mapPin?.coordinateCheckedAt,NOW);
    assert.deepEqual((await db.query("SELECT payload FROM civic_data_promotions WHERE key='MEETING:held'"))[0].payload,JSON.parse(JSON.stringify({meetings:originals})),"calendar bytes and timestamps do not change");
    assert.deepEqual((await db.query("SELECT DISTINCT field FROM fact WHERE entity_id LIKE 'meeting:%'")),[{field:"map_pin"}]);
    assert.ok(read[0].fieldSources?.mapPin.sourceUrl?.startsWith("https://geocoding.geo.census.gov/"));
  }finally{await db.pg.close();}
});

test("a failed address uses the normal blank retry, and a newly published office address makes it eligible immediately",async()=>{
  const missing:Meeting={...online,id:"legistar:held:unmatched",online:undefined,carried:undefined,
    venueGap:{kind:"STATED_NOT_PLACED",publisher:"District",publishedText:"123 Missing Street, Tucson, AZ 85706"}};
  const db=await setup([missing],"P.O. Box 123"),vault=new MemoryEvidenceStore();let requests=0;
  try{
    const empty:typeof fetch=async()=>{requests++;return new Response(JSON.stringify({result:{addressMatches:[]}}));};
    const args={facts:db,vault,clocks:factClocks(null),now:NOW,clock:()=>Date.parse(NOW),deadlineMs:Date.parse(NOW)+60000};
    const first=await publishHeldMeetingPins({...args,fetchImpl:empty});assert.equal(first.unplaced,1);assert.equal(requests,1);
    await db.query("UPDATE blank SET updated_at=$1,next_try_at=$2",[NOW,new Date(Date.parse(NOW)+3600000).toISOString()]);
    const repeated=await publishHeldMeetingPins({...args,fetchImpl:empty});assert.equal(repeated.considered,0);assert.equal(requests,1);
    const moved=new Date(Date.parse(NOW)+60000).toISOString();
    await db.query("UPDATE fact SET value=$1,value_text=$2,quote=$2,checked_at=$3 WHERE entity_id=$4 AND field='office_address'",[JSON.stringify(OFFICE),OFFICE,moved,BODY]);
    const filled=await publishHeldMeetingPins({...args,now:moved,clock:()=>Date.parse(moved),deadlineMs:Date.parse(moved)+60000,
      fetchImpl:async input=>new Response(JSON.stringify(new URL(String(input)).searchParams.get("address")!.includes("2238")
        ?geocode("2238","GINTER","RD","E","TUCSON","85706"):{result:{addressMatches:[]}}))});
    assert.equal(filled.published,1);assert.equal(filled.unplaced,0);
    const [seen]=withSittingFacts([missing],(await readSittingFacts(db.query,[BODY])).get(BODY)!);
    assert.equal(seen.mapPin?.basis,"BODY_OFFICE");assert.equal(seen.location,null,"an office point is never an attendance location");
  }finally{await db.pg.close();}
});

test("older online and room facts cannot hide a newer published physical address and its saved point",()=>{
  const physical:Meeting={...online,online:undefined,carried:undefined,provenance:{...online.provenance,collectedAt:NOW},
    venueGap:{kind:"STATED_NOT_PLACED",publishedText:OWN,publisher:"District"}};
  const old={...online.provenance,collectedAt:OLD},fresh={...old,collectedAt:NOW};
  const [seen]=withSittingFacts([physical],[
    {meetingId:physical.id,field:"online",value:online.online,source:old},
    {meetingId:physical.id,field:"location",value:{name:"Old room",address:"1 Old Street",lat:30,lng:-110},source:old},
    {meetingId:physical.id,field:"mapPin",value:{meetingId:physical.id,bodyId:BODY,basis:"MEETING",name:OWN,address:OWN,
      publishedLocation:OWN,lat:31.3,lng:-109.9,provenance:fresh},source:fresh},
  ]);
  assert.equal(seen.online,undefined);assert.equal(seen.venueGap,undefined);assert.equal(seen.location?.address,OWN);
});

test("an already-promoted address for the same source sitting fills an abbreviated street once, without borrowing another body or an unpromoted record",async()=>{
  for(const valid of [true,false]) {
    const short="1415 W Melody Ln",physical:Meeting={...online,id:"legistar:held:short",online:undefined,carried:undefined,
      venueGap:{kind:"STATED_NOT_PLACED",publishedText:short,publisher:"District"}};
    const prior={...physical,bodyId:valid?BODY:"other-body",venueGap:undefined,location:{name:"Board Room",address:OWN,lat:31.3,lng:-109.9}};
    const db=await setup([physical],"P.O. Box 123");let requests=0;
    try {
      for(const [id,state,readModel] of [["cv-previous","PROMOTED",prior],["cv-unpromoted","PARSE_INVALID",{...prior,bodyId:BODY}]] as const)
        await db.query("INSERT INTO civic_data_candidates VALUES($1,'fixture','MEETING','source:diligent:body:held',$2,$3,$4)",
          [id,state,OLD,JSON.stringify({readModel:{meetings:[readModel]}})]);
      const first=await publishHeldMeetingPins({facts:db,vault:new MemoryEvidenceStore(),clocks:factClocks(null),now:NOW,
        clock:()=>Date.parse(NOW),deadlineMs:Date.parse(NOW)+60000,fetchImpl:async input=>{
          requests++;const full=new URL(String(input)).searchParams.get("address")!.includes("Bisbee");
          return new Response(JSON.stringify(full?geocode("1415","MELODY","LN","W","BISBEE","85603"):{result:{addressMatches:[]}}));
        }});
      assert.equal(first.published,Number(valid));assert.equal(first.unplaced,Number(!valid));assert.equal(requests,valid?2:1);
      if(valid) {
        const [read]=withSittingFacts([physical],(await readSittingFacts(db.query,[BODY])).get(BODY)!);
        assert.equal(read.mapPin?.basis,"MEETING");assert.equal(read.mapPin?.address,OWN);assert.equal(read.mapPin?.publishedLocation,short);
        assert.equal(read.provenance.collectedAt,OLD);
        const next=await placePublishedMeetingPins({meetings:[physical],query:db.query,
          fetchImpl:async()=>{throw new Error("the prior-address point must be reused on the following calendar run");}});
        assert.equal(next.responses.length,0);assert.deepEqual(next.held,[]);assert.equal(next.meetings[0].mapPin?.address,OWN);
      }
    }finally{await db.pg.close();}
  }
});

test("an unreadable earlier calendar cannot hold a directly matched meeting address",async()=>{
  const physical:Meeting={...online,id:"legistar:held:readable",online:undefined,carried:undefined,
    venueGap:{kind:"STATED_NOT_PLACED",publishedText:OWN,publisher:"District"}};
  const db=await setup([physical]);
  try {
    const result=await publishHeldMeetingPins({facts:{...db,query:(text,params)=>{
      if(text===HELD_PIN_PRIOR_VENUES_SQL)throw new Error("earlier calendar unavailable");
      return db.query(text,params);
    }},vault:new MemoryEvidenceStore(),clocks:factClocks(null),now:NOW,clock:()=>Date.parse(NOW),deadlineMs:Date.parse(NOW)+60000,
      fetchImpl:async()=>new Response(JSON.stringify(geocode("1415","MELODY","LN","W","BISBEE","85603")))});
    assert.equal(result.published,1);assert.equal(result.unplaced,0);
    assert.deepEqual(result.failures,["Earlier meeting addresses could not be read: earlier calendar unavailable"]);
  }finally{await db.pg.close();}
});

test("a Census result arriving at the pass deadline is saved once and reused by the following pass",async()=>{
  const physical:Meeting={...online,id:"legistar:held:deadline",online:undefined,carried:undefined,
    venueGap:{kind:"STATED_NOT_PLACED",publishedText:OWN,publisher:"District"}};
  const db=await setup([physical]),deadline=Date.parse(NOW)+60000;let clock=Date.parse(NOW);
  try {
    const first=await publishHeldMeetingPins({facts:db,vault:new MemoryEvidenceStore(),clocks:factClocks(null),now:NOW,
      clock:()=>clock,deadlineMs:deadline,fetchImpl:async()=>{
        clock=deadline+1;
        return new Response(JSON.stringify(geocode("1415","MELODY","LN","W","BISBEE","85603")));
      }});
    assert.equal(first.published,1);assert.deepEqual(first.failures,[]);
    const [read]=withSittingFacts([physical],(await readSittingFacts(db.query,[BODY])).get(BODY)!);
    assert.equal(read.mapPin?.address,OWN);
    const next=await publishHeldMeetingPins({facts:db,vault:new MemoryEvidenceStore(),clocks:factClocks(null),
      now:new Date(clock+60000).toISOString(),clock:()=>clock+60000,deadlineMs:clock+120000,
      fetchImpl:async()=>{throw new Error("a completed Census result was thrown away at the pass deadline");}});
    assert.deepEqual(next,{considered:0,published:0,unplaced:0,failures:[]});
  }finally{await db.pg.close();}
});
