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
import { agendaLetterheadOffice } from "../lib/meetings/agenda-address.ts";

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
        assert.equal(read.mapPin?.basis,"MEETING");assert.equal(read.mapPin?.address,short);assert.equal(read.mapPin?.publishedLocation,short);
        assert.match(read.mapPin!.matchedAddress!,/BISBEE, AZ, 85603$/,"the saved Census match retains the complete address used to check the point");
        assert.equal(read.provenance.collectedAt,OLD);
        const next=await placePublishedMeetingPins({meetings:[physical],query:db.query,
          fetchImpl:async()=>{throw new Error("the prior-address point must be reused on the following calendar run");}});
        assert.equal(next.responses.length,0);assert.deepEqual(next.held,[]);assert.equal(next.meetings[0].mapPin?.address,short);
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

test("an overlapping pin publisher keeps the winning live point and the following pass does no new geocoding",async()=>{
  const db=await setup([online]),later=new Date(Date.parse(NOW)+60000).toISOString();
  const collision=Object.assign(new Error('duplicate key value violates unique constraint "fact_one_live"'),{code:"23505",constraint:"fact_one_live"});
  let collided=false,requests=0,winner:unknown;
  const facts={...db,transaction:async<T>(work:Parameters<typeof db.transaction<T>>[0])=>{
    let insert:{sql:string;params:readonly unknown[]}|undefined;
    try{return await db.transaction(query=>work(async(sql,params=[])=>{
      if(!collided&&sql.startsWith("INSERT INTO fact ")){collided=true;insert={sql,params};throw collision;}
      return query(sql,params);
    }));}catch(error){
      if(error===collision&&insert){
        const params=[...insert.params];winner={...JSON.parse(String(params[2])),coordinateCheckedAt:later};
        params[2]=JSON.stringify(winner);params[10]=later;
        // The other transaction commits its point before this failed transaction retries.
        await db.query(insert.sql,params);
      }
      throw error;
    }
  }};
  try{
    const args={facts,vault:new MemoryEvidenceStore(),clocks:factClocks(null),now:NOW,clock:()=>Date.parse(NOW),deadlineMs:Date.parse(NOW)+60000};
    const first=await publishHeldMeetingPins({...args,fetchImpl:async()=>{requests++;return new Response(JSON.stringify(geocode("2238","GINTER","RD","E","TUCSON","85706")));}});
    assert.equal(collided,true);assert.deepEqual(first,{considered:1,published:0,unplaced:0,failures:[]});
    assert.deepEqual((await db.query("SELECT value FROM fact WHERE field='map_pin' AND status='live'")).map(row=>row.value),[winner]);
    const next=await publishHeldMeetingPins({...args,now:later,clock:()=>Date.parse(later),deadlineMs:Date.parse(later)+60000,
      fetchImpl:async()=>{throw Error("the concurrent winner must be reused");}});
    assert.deepEqual(next,{considered:0,published:0,unplaced:0,failures:[]});assert.equal(requests,1);
  }finally{await db.pg.close();}
});

test("Raleigh's own saved agenda letterhead supplies a board-office pin without a venue list or any changed source fact",async()=>{
  const division="ocd-division/country:us/state:nc/county:wake",body=`${division}#governing`;
  const meeting:Meeting={...online,id:"legistar:wake:6264",bodyId:body,ocdId:division,bodyName:"Board of Commissioners",
    jurisdiction:"COUNTY OF WAKE",online:undefined,carried:undefined,
    venueGap:{kind:"STATED_NOT_PLACED",publishedText:"Wake County Justice Center",publisher:"COUNTY OF WAKE"}};
  const db=await setup([meeting]),vault=new MemoryEvidenceStore();
  const header=readFileSync(new URL("./fixtures/mt01-wake-agenda-header.txt",import.meta.url),"utf8");
  const census=readFileSync(new URL("./fixtures/mt01-wake-office-census.json",import.meta.url),"utf8");
  const document={meetingId:meeting.id,ocdId:division,extraction:"pdf",text:header,
    documentUrl:"https://wake.legistar1.com/wake/meetings/2026/10/6264_A_Board_of_Commissioners_26-10-26_Meeting_Agenda.pdf",
    sourceOrg:"COUNTY OF WAKE",collectedAt:OLD};
  try{
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Wake County','NC',NULL),($2,'body','Board of Commissioners','NC',$1)",[division,body]);
    const payload={meetings:[meeting],agendaDocuments:[document]};
    await db.query("UPDATE civic_data_promotions SET payload=$1 WHERE key='MEETING:held'",[JSON.stringify(payload)]);
    let requests=0;const args={facts:db,vault,clocks:factClocks(null),now:NOW,clock:()=>Date.parse(NOW),deadlineMs:Date.parse(NOW)+60000};
    const first=await publishHeldMeetingPins({...args,fetchImpl:async()=>{requests++;return new Response(census);}});
    assert.deepEqual(first,{considered:1,published:1,unplaced:0,failures:[]});assert.equal(requests,1);
    const [read]=withSittingFacts([meeting],(await readSittingFacts(db.query,[body])).get(body)!);
    assert.equal(read.mapPin?.basis,"BODY_OFFICE");assert.equal(read.mapPin?.address,"301 South McDowell Street, Raleigh, NC");
    assert.equal(read.mapPin?.provenance.sourceUrl,document.documentUrl);assert.equal(read.location,null);
    assert.equal(read.venueGap?.publishedText,meeting.venueGap?.publishedText);assert.equal(read.id,meeting.id);
    assert.deepEqual((await db.query("SELECT payload FROM civic_data_promotions WHERE key='MEETING:held'"))[0].payload,JSON.parse(JSON.stringify(payload)));
    const next=await publishHeldMeetingPins({...args,fetchImpl:async()=>{throw Error("A saved Raleigh point was geocoded again");}});
    assert.deepEqual(next,{considered:0,published:0,unplaced:0,failures:[]});
    await db.query("DELETE FROM fact WHERE entity_id=$1",[`meeting:${meeting.id}`]);
    await db.query("UPDATE civic_data_promotions SET payload=$1 WHERE key='MEETING:held'",[JSON.stringify({...payload,agendaDocuments:[{...document,ocdId:DIVISION}]})]);
    const foreign=await publishHeldMeetingPins({...args,fetchImpl:async()=>{throw Error("Another division's letterhead supplied an address");}});
    assert.equal(foreign.published,0);assert.equal(foreign.considered,0);
  }finally{await db.pg.close();}
});

test("an address in an agenda item or a conflicting state never becomes a board office",()=>{
  assert.equal(agendaLetterheadOffice("Meeting Agenda Public hearing for 301 South McDowell Street, Raleigh, NC","COUNTY OF WAKE","NC"),null);
  const header=readFileSync(new URL("./fixtures/mt01-wake-agenda-header.txt",import.meta.url),"utf8");
  assert.equal(agendaLetterheadOffice(header,"COUNTY OF WAKE","AZ"),null);
});

test("pin publication uses its saved Census citation even when an old calendar source URL is relative",async()=>{
  for(const kind of ["office","meeting","blank"]){
    const placed=kind!=="blank";
    const meeting:Meeting={...online,provenance:{...online.provenance,sourceUrl:"/Calendar.aspx?EID=755"},
      ...(kind!=="office"?{online:undefined,venueGap:{kind:"STATED_NOT_PLACED" as const,publishedText:OWN,publisher:"District"}}:{})};
    const db=await setup([meeting],kind==="office"?OFFICE:"P.O. Box 123");
    try{
      const result=await publishHeldMeetingPins({facts:db,vault:new MemoryEvidenceStore(),clocks:factClocks(null),now:NOW,
        clock:()=>Date.parse(NOW),deadlineMs:Date.parse(NOW)+60000,fetchImpl:async()=>new Response(JSON.stringify(
          !placed?{result:{addressMatches:[]}}:kind==="office"?geocode("2238","GINTER","RD","E","TUCSON","85706"):
            geocode("1415","MELODY","LN","W","BISBEE","85603")))});
      assert.deepEqual(result,{considered:1,published:Number(placed),unplaced:Number(!placed),failures:[]});
      const [saved]=await db.query("SELECT payload FROM civic_data_promotions WHERE key='MEETING:held'");
      assert.equal((saved.payload as {meetings:Meeting[]}).meetings[0].provenance.sourceUrl,meeting.provenance.sourceUrl);
      assert.equal((await db.query("SELECT field FROM blank WHERE entity_id=$1",[`meeting:${meeting.id}`])).length,Number(!placed));
    }finally{await db.pg.close();}
  }
});

test("Galveston's published office uses the Census directory's explicit postal alias without turning a mailing address into an office",async()=>{
  const division="ocd-division/country:us/state:tx/county:galveston",governing=`${division}#governing`;
  const header=readFileSync(new URL("./fixtures/mt01-galveston-regular-header.txt",import.meta.url),"utf8");
  const responses=JSON.parse(readFileSync(new URL("./fixtures/mt01-galveston-census.json",import.meta.url),"utf8")) as {url:string;text:string;status:number}[];
  const mailing="722 MOODY AVE 21ST ST, 2 FL, GALVESTON, TX, 77550";
  for(const variant of ["governing","child","mail-only","wrong-house","wrong-city","foreign"]){
    const body=variant==="child"?`${division}#body:special-meeting`:governing;
    const meeting:Meeting={...online,id:`legistar:galveston:${variant}`,bodyId:body,ocdId:division,bodyName:"Commissioners Court",
      jurisdiction:"COUNTY OF GALVESTON",online:undefined,carried:undefined,
      provenance:{...online.provenance,sourceUrl:"https://galvestoncountytx.legistar.com/Calendar.aspx",sourceOrg:"COUNTY OF GALVESTON"},
      venueGap:{kind:"STATED_NOT_PLACED",publishedText:"Galveston County Courthouse",publisher:"COUNTY OF GALVESTON"}};
    const db=await setup([meeting]),vault=new MemoryEvidenceStore();let requests=0;
    try{
      await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Galveston County','TX',NULL),($2,'body','Commissioners Court','TX',$1)",[division,body]);
      const source={sourceUrl:"https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP",sourceOrg:"U.S. Census Bureau",collectedAt:OLD,verifiedAt:null};
      const government={id:"government:US-TX:cog:175884",name:"COUNTY OF GALVESTON",state:"TX",aliases:[variant==="foreign"?`${division}:other#governing`:governing],
        mailingAddress:variant==="wrong-house"?mailing.replace("722","723"):variant==="wrong-city"?mailing.replace("GALVESTON","HOUSTON"):mailing,provenance:source};
      await db.query("INSERT INTO civic_data_promotions(key,record_class,scope,current_version_id,promoted_at,payload) VALUES('REGISTRATION:US-TX:registration:v1','REGISTRATION','US-TX:registration:v1','registration',$1,$2)",[NOW,JSON.stringify({governments:[government]})]);
      const document={meetingId:meeting.id,ocdId:division,extraction:"pdf",text:variant==="mail-only"?"Meeting Agenda October 26, 2026":header,
        documentUrl:"https://galvestoncountytx.legistar.com/regular-agenda.pdf",sourceOrg:"COUNTY OF GALVESTON",collectedAt:OLD};
      const payload={meetings:[meeting],agendaDocuments:[document]};
      await db.query("UPDATE civic_data_promotions SET payload=$1 WHERE key='MEETING:held'",[JSON.stringify(payload)]);
      const args={facts:db,vault,clocks:factClocks(null),now:NOW,clock:()=>Date.parse(NOW),deadlineMs:Date.parse(NOW)+60000};
      const result=await publishHeldMeetingPins({...args,fetchImpl:async input=>{
        requests++;const row=responses.find(row=>row.url===String(input));assert.ok(row,`unrecorded lookup: ${String(input)}`);return new Response(row.text,{status:row.status});
      }});
      const success=variant==="governing"||variant==="child";
      assert.equal(result.published,Number(success));assert.deepEqual(result.failures,[]);
      if(success){
        const [read]=withSittingFacts([meeting],(await readSittingFacts(db.query,[body])).get(body)!);
        assert.equal(read.mapPin?.basis,"BODY_OFFICE");assert.equal(read.mapPin?.address,"722 Moody, Galveston, TX 77550");
        assert.equal(read.mapPin?.addressAlias?.sourceAddress,mailing);assert.equal(read.mapPin?.matchedAddress,"722 21ST ST, GALVESTON, TX, 77550");
        assert.equal(read.mapPin?.provenance.sourceUrl,document.documentUrl);assert.equal(read.mapPin?.addressAlias?.provenance.sourceUrl,source.sourceUrl);
        assert.equal(requests,2);
        const next=await publishHeldMeetingPins({...args,fetchImpl:async()=>{throw Error("The saved postal-alias point was geocoded again");}});
        assert.deepEqual(next,{considered:0,published:0,unplaced:0,failures:[]});
      }else assert.equal(requests,variant==="mail-only"?0:1);
      assert.deepEqual((await db.query("SELECT payload FROM civic_data_promotions WHERE key='MEETING:held'"))[0].payload,JSON.parse(JSON.stringify(payload)));
    }finally{await db.pg.close();}
  }
});

test("an own-meeting agenda address precedes its letterhead office and accepts Census's confirmed road spelling",async()=>{
  const division="ocd-division/country:us/state:tx/county:galveston",body=`${division}#governing`;
  const meeting:Meeting={...online,id:"legistar:galveston:calder",bodyId:body,ocdId:division,bodyName:"Commissioners Court",
    jurisdiction:"COUNTY OF GALVESTON",online:undefined,carried:undefined,
    venueGap:{kind:"STATED_NOT_PLACED",publishedText:"CALDER MEETING LOCATION",publisher:"COUNTY OF GALVESTON"}};
  const db=await setup([meeting]);let requests=0;
  try{
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Galveston County','TX',NULL),($2,'body','Commissioners Court','TX',$1)",[division,body]);
    const text=readFileSync(new URL("./fixtures/mt01-galveston-agenda-header.txt",import.meta.url),"utf8");
    await db.query("UPDATE civic_data_promotions SET payload=$1 WHERE key='MEETING:held'",[JSON.stringify({meetings:[meeting],agendaDocuments:[{meetingId:meeting.id,ocdId:division,
      extraction:"pdf",text,documentUrl:"https://galvestoncountytx.legistar.com/special-agenda.pdf",sourceOrg:"COUNTY OF GALVESTON",collectedAt:OLD}]})]);
    const responses=JSON.parse(readFileSync(new URL("./fixtures/mt01-galveston-census.json",import.meta.url),"utf8")) as {url:string;text:string;status:number}[];
    const result=await publishHeldMeetingPins({facts:db,vault:new MemoryEvidenceStore(),clocks:factClocks(null),now:NOW,clock:()=>Date.parse(NOW),deadlineMs:Date.parse(NOW)+60000,fetchImpl:async input=>{
      requests++;assert.ok(String(input).includes("Calder"),"the own-meeting address must be tried before Moody");const row=responses.find(row=>row.url===String(input));assert.ok(row);return new Response(row.text,{status:row.status});
    }});
    assert.equal(result.published,1);assert.deepEqual(result.failures,[]);assert.equal(requests,1);
    const [read]=withSittingFacts([meeting],(await readSittingFacts(db.query,[body])).get(body)!);
    assert.equal(read.mapPin?.basis,"MEETING");assert.equal(read.mapPin?.address,"174 Calder Rd., League City, TX 77573");
    assert.equal(read.mapPin?.matchedAddress,"174 N CALDER DR, LEAGUE CITY, TX, 77573");
  }finally{await db.pg.close();}
});

test("Tacoma's address after the agenda title places physical meetings and retains online-only meetings at the board address",async()=>{
  for(const onlyOnline of [false,true]){
    const division="ocd-division/country:us/state:wa/place:tacoma",body=`${division}#governing`;
    const meeting:Meeting={...online,id:`legistar:cityoftacoma:${onlyOnline}`,bodyId:body,ocdId:division,bodyName:"City Council",jurisdiction:"CITY OF TACOMA",carried:undefined,
      ...(!onlyOnline?{online:undefined,venueGap:{kind:"STATED_NOT_PLACED" as const,publishedText:"Council Chambers",publisher:"CITY OF TACOMA"}}:{})};
    const db=await setup([meeting]),vault=new MemoryEvidenceStore();let requests=0;
    try{
      await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Tacoma','WA',NULL),($2,'body','City Council','WA',$1)",[division,body]);
      const text=readFileSync(new URL("./fixtures/mt01-tacoma-agenda-header.txt",import.meta.url),"utf8");
      const payload={meetings:[meeting],agendaDocuments:[{meetingId:meeting.id,ocdId:division,extraction:"pdf",text,
        documentUrl:"https://cityoftacoma.legistar.com/agenda.pdf",sourceOrg:"CITY OF TACOMA",collectedAt:OLD}]};
      await db.query("UPDATE civic_data_promotions SET payload=$1 WHERE key='MEETING:held'",[JSON.stringify(payload)]);
      const rows=JSON.parse(readFileSync(new URL("./fixtures/mt01-tacoma-census.json",import.meta.url),"utf8")) as {url:string;status:number;text:string}[];
      const args={facts:db,vault,clocks:factClocks(null),now:NOW,clock:()=>Date.parse(NOW),deadlineMs:Date.parse(NOW)+60000};
      const first=await publishHeldMeetingPins({...args,fetchImpl:async input=>{
        requests++;const row=rows.find(row=>row.url===String(input));assert.ok(row);return new Response(row.text,{status:row.status});
      }});
      assert.equal(first.published,1);assert.deepEqual(first.failures,[]);assert.equal(requests,1);
      const [read]=withSittingFacts([meeting],(await readSittingFacts(db.query,[body])).get(body)!);
      assert.equal(read.mapPin?.basis,onlyOnline?"BODY_OFFICE":"MEETING");assert.equal(read.mapPin?.address,"747 Market Street, Tacoma, WA 98402");
      assert.deepEqual(read.online,meeting.online);
      const next=await publishHeldMeetingPins({...args,fetchImpl:async()=>{throw Error("Tacoma's saved point was geocoded again");}});
      assert.deepEqual(next,{considered:0,published:0,unplaced:0,failures:[]});
      assert.deepEqual((await db.query("SELECT payload FROM civic_data_promotions WHERE key='MEETING:held'"))[0].payload,JSON.parse(JSON.stringify(payload)));
    }finally{await db.pg.close();}
  }
});
