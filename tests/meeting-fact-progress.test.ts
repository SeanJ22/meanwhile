import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readerMigrationDb, savePromotedFixture } from "./helpers/dg-migration-db.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { stageMeetingFactPublication, continueMeetingFactPublication, meetingFactPublicationPending, meetingFactsAfterSourceCheck } from "../lib/civic-data/meeting-fact-progress.ts";
import { meetingFactWorkRemains } from "../lib/civic-data/meeting-source-confirmation.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { meetingEntityId } from "../lib/facts/meeting-read.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { RetainedSourceResponse } from "../lib/civic-data/retained-meeting-bytes.ts";

async function fixture(count:number) {
  const db=await readerMigrationDb(),vault=new MemoryEvidenceStore(),at=new Date(Math.floor(Date.now()/1000)*1000).toISOString(),scope="test:meeting-fact-cutoff";
  const body="ocd-division/country:us/state:nh/place:example#governing",url="https://example.nh.gov/council.ics";
  const meetings:Meeting[]=Array.from({length:count},(_,index)=>({id:`ical:test:${index}`,bodyId:body,ocdId:body.split("#")[0]!,bodyName:"Council",title:`Council ${index}`,
    startsAt:new Date(Date.parse(at)+(index+1)*86400000).toISOString(),timeZone:"America/New_York",location:{name:"Town Hall",address:null,lat:43,lng:-71},
    agendaUrl:`https://example.nh.gov/agenda/${index}`,jurisdiction:"Example NH",status:"SCHEDULED",provenance:{sourceUrl:url,sourceOrg:"Town Clerk",collectedAt:at,verifiedAt:null}}));
  const text=["BEGIN:VCALENDAR","VERSION:2.0",...meetings.flatMap(meeting=>["BEGIN:VEVENT",`UID:${meeting.id}`,`DTSTART:${meeting.startsAt.replace(/[-:]/g,"").replace(/\.\d{3}/,"")}`,
    `SUMMARY:${meeting.title}`,"LOCATION:Town Hall",`URL:${meeting.agendaUrl}`,"END:VEVENT"]),"END:VCALENDAR"].join("\r\n");
  const bytes=new TextEncoder().encode(text),response:RetainedSourceResponse={source:"ical",requestedUrl:url,finalUrl:url,httpStatus:200,rawHash:createHash("sha256").update(bytes).digest("hex"),
    byteCount:bytes.length,bytes,retrievedAt:at,contentType:"text/calendar"};
  await savePromotedFixture(db,{recordClass:"MEETING",scope,sourceId:"meetings-public-bodies",at,value:{formatVersion:1,generatedAt:at,meetings,agendaDocuments:[],counts:{fresh:count,carried:0,total:count},
    sources:[{source:"ical",ok:true,fetched:count,normalized:count,drops:{placeless:0,unknownVenue:0,unplaceableInTime:0,notConfigured:0}}]}});
  const [pointer]=await db.query("SELECT current_version_id AS id FROM civic_data_promotions WHERE key=$1",[`MEETING:${scope}`]);
  const candidateId=String(pointer!.id);
  return {db,vault,at,scope,body,meetings,response,candidateId};
}

test("a successful cutoff resumes only pending keyed meetings and leaves completed records alone",async t=>{
  const f=await fixture(2);t.after(()=>f.db.pg.close());
  const clock=Date.parse(f.at);t.mock.timers.enable({apis:["Date"],now:clock});
  await stageMeetingFactPublication({facts:f.db,vault:f.vault,scope:f.scope,candidateId:"unaccepted-candidate",meetings:f.meetings,responses:[f.response]});
  assert.equal(await meetingFactPublicationPending(f.db.query,f.scope),false,"an unaccepted candidate cannot reopen current work");
  await stageMeetingFactPublication({facts:f.db,vault:f.vault,scope:f.scope,candidateId:f.candidateId,meetings:f.meetings,responses:[f.response]});
  const cutQuery:Query=async(text,params)=>{
    const rows=await f.db.query(text,params);
    if(text.startsWith("INSERT INTO pass_cursor")&&JSON.parse(String(params?.[1])).index===1)t.mock.timers.setTime(clock+1000);
    return rows;
  };
  const sliced=await continueMeetingFactPublication({facts:{query:cutQuery,transaction:f.db.transaction},vault:f.vault,candidateId:f.candidateId,
    meetings:f.meetings,observations:[f.response],clocks:factClocks(null),now:new Date(f.at),deadlineMs:clock+500});
  assert.equal(sliced.complete,false);assert.equal(await meetingFactPublicationPending(f.db.query,f.scope),true);
  const firstFields=await f.db.query("SELECT field FROM fact WHERE entity_id=$1 AND status='live' ORDER BY field",[meetingEntityId(f.meetings[0]!.id)]);
  assert.deepEqual(firstFields.map(row=>row.field),["agenda_url","location","starts_at","title"]);
  assert.deepEqual(await f.db.query("SELECT field FROM fact WHERE entity_id=$1 AND status='live'",[meetingEntityId(f.meetings[1]!.id)]),[]);
  const readIds:unknown[]=[];
  const resumeQuery:Query=async(text,params)=>{if(text.includes("FROM civic_data_promotions p JOIN civic_data_rows"))readIds.push(params?.[2]);return f.db.query(text,params);};
  const resumed=await continueMeetingFactPublication({facts:{query:resumeQuery,transaction:f.db.transaction},vault:f.vault,candidateId:f.candidateId,
    observations:[f.response],clocks:factClocks(null),now:new Date(),deadlineMs:Infinity});
  assert.equal(resumed.complete,true);assert.deepEqual(readIds,[f.meetings[1]!.id]);
  assert.equal(await meetingFactPublicationPending(f.db.query,f.scope),false);
});

test("an interruption after required fields cannot hide unfinished optional fields behind an unchanged hash",async t=>{
  const f=await fixture(1);t.after(()=>f.db.pg.close());
  await stageMeetingFactPublication({facts:f.db,vault:f.vault,scope:f.scope,candidateId:f.candidateId,meetings:f.meetings,responses:[f.response]});
  let stop=true;
  const partial:FactDb&{query:Query}={query:f.db.query,transaction:async work=>{
    let started=false;
    const result=await f.db.transaction(query=>work(async(text,params)=>{const rows=await query(text,params);if(text.includes("INSERT INTO fact")&&params?.includes("starts_at"))started=true;return rows;}));
    if(started&&stop){stop=false;throw new Error("CONTROLLED_STOP_AFTER_REQUIRED_FIELDS");}return result;
  }};
  await assert.rejects(continueMeetingFactPublication({facts:partial,vault:f.vault,candidateId:f.candidateId,meetings:f.meetings,observations:[f.response],
    clocks:factClocks(null),now:new Date(f.at),deadlineMs:Infinity}),/CONTROLLED_STOP_AFTER_REQUIRED_FIELDS/);
  assert.equal(await meetingFactWorkRemains(f.db.query,f.meetings.map(meeting=>meeting.id),[f.body],f.at),false,"required-field checks alone miss this unfinished record");
  assert.equal(await meetingFactPublicationPending(f.db.query,f.scope),true);
  const stillOwed=await meetingFactsAfterSourceCheck({facts:f.db,vault:f.vault,head:{versionId:f.candidateId},observations:[f.response],clocks:factClocks(null),
    at:f.at,meetingIds:f.meetings.map(meeting=>meeting.id),bodyIds:[f.body]});
  assert.equal(stillOwed,false,"the source may confirm unchanged only after the pending optional fields finish");
  assert.deepEqual((await f.db.query("SELECT field FROM fact WHERE entity_id=$1 AND status='live' ORDER BY field",[meetingEntityId(f.meetings[0]!.id)])).map(row=>row.field),["agenda_url","location","starts_at","title"]);
});
