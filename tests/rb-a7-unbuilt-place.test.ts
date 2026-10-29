import assert from "node:assert/strict";
import test from "node:test";
import {GET as meetingsGET} from "../app/api/meetings/route.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {READY_PLACE_SQL,placePageCacheIds,readPlacePackage} from "../lib/reader/place.ts";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {installFactReader} from "../lib/facts/db.ts";
import {snapshotCounts} from "../lib/meetings/snapshot.ts";
import type {Query} from "../lib/facts/publish.ts";
import type {Meeting} from "../lib/sources/types.ts";
import type {RegistryRuntimeReadModel} from "../lib/registry/runtime-data-plane.ts";

const AT="2026-10-24T12:00:00.000Z",ROOT="ocd-division/country:us/state:az",CITY=`${ROOT}/place:tucson`,BODY=`${CITY}#governing`;
const source={sourceUrl:"https://example.test/verified",sourceOrg:"Fixture publisher",collectedAt:AT,verifiedAt:AT};
const meeting:Meeting={id:"fixture:hearing",bodyId:BODY,bodyName:"Mayor and Council",ocdId:CITY,title:"Public hearing",startsAt:"2026-10-27T12:00:00Z",
  timeZone:"UTC",location:null,agendaUrl:source.sourceUrl,jurisdiction:"Local",status:"SCHEDULED",provenance:source};
const registry:RegistryRuntimeReadModel={formatVersion:1,registry:{generatedAt:AT,divisions:[],bodies:[{id:BODY,ocdId:CITY,name:"Mayor and Council",bodyClass:"GOVERNING",
  bodyOrigin:"SOURCED",coverageStatus:"LIVE",agendaSourceType:"NONE",agendaSourceRef:null,meetingCadence:null,homepageUrl:source.sourceUrl,demandCount:0,
  sourceDataset:"GOV_DIRECTORY",provenance:source}]},bodyRosters:[],rosterReaderDispositions:[],statewideExecutives:[],
  officialCandidacies:{formatVersion:1,rule:"EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE",rows:[]},officialPhotos:{photos:[]},rosterPhotos:{}};
const snapshot={formatVersion:1 as const,generatedAt:AT,meetings:[meeting],agendaDocuments:[],sources:[],counts:snapshotCounts([meeting],0)};
async function firstUse(){
  const db=await migratedReaderDb();
  await db.publish({id:'registry',recordClass:'REGISTRY_RUNTIME_BINDING',scope:'US-AZ:reader-registry-runtime',sourceId:'fixture',at:AT,value:registry});
  await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Arizona','AZ',NULL),($2,'place','Tucson','AZ',$1),($3,'body','Council','AZ',$2)",[ROOT,CITY,BODY]);
  await db.publish({id:'meetings',recordClass:'MEETING',scope:`source:fixture:body:${encodeURIComponent(BODY)}`,sourceId:'fixture',at:AT,value:snapshot});
  return db;
}

test('the first body visit builds and saves its page; the next visit reads only that page',async()=>{
  const db=await firstUse(),reads:string[]=[];
  const query:Query=async(text,params=[])=>{reads.push(text);return db.query(text,params);};
  try{
    const input={state:'AZ',placeId:BODY,divisionIds:[],bodyIds:[BODY]};
    const first=await readPlacePackage(input,query);
    assert.deepEqual(first.meetings.map(row=>row.id),[meeting.id]);
    assert.deepEqual(placePageCacheIds(first),[BODY]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM place_page WHERE place_id=$1',[BODY]))[0].n,1);
    reads.length=0;assert.deepEqual(await readPlacePackage(input,query),first);
    assert.deepEqual(reads,[READY_PLACE_SQL]);
  }finally{await db.pg.close();}
});

test('a map selection saves each missing place and body, then serves their saved answers',async()=>{
  const db=await firstUse(),reads:string[]=[];
  const query:Query=async(text,params=[])=>{reads.push(text);return db.query(text,params);};
  try{
    const input={state:'AZ',divisionIds:[CITY],bodyIds:[BODY]};
    const first=await readPlacePackage(input,query);
    assert.ok(first.meetings.some(row=>row.id===meeting.id));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM place_page WHERE place_id=ANY($1::text[])',[[CITY,BODY]]))[0].n,2);
    reads.length=0;assert.deepEqual(await readPlacePackage(input,query),first);
    assert.ok(reads.every(sql=>!(/civic_data_(?:promotions|candidates|candidate_events|payload_parts)/.test(sql))));
  }finally{await db.pg.close();}
});

test('a ZIP with no page gets its held meetings on first use and keeps the saved page for the next reader',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(AT)});
  t.mock.method(globalThis,'fetch',async()=>{throw Error('This fixture must stay local');});
  const db=await firstUse(),reads:string[]=[];
  const query:Query=async(text,params=[])=>{reads.push(text);return db.query(text,params);};
  installFactReader(query);installReaderDatabaseQuery(async batch=>Promise.all(batch.map(s=>query(s.text,s.params))));
  try{
    const request=()=>new Request('https://example.test/api/meetings?zip=85701');
    const first=await meetingsGET(request());assert.equal(first.status,200,await first.clone().text());
    assert.ok((await first.json()).meetings.some((row:Meeting)=>row.id===meeting.id));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM place_page WHERE place_id=$1',['zip:85701']))[0].n,1);
    reads.length=0;const next=await meetingsGET(request());assert.equal(next.status,200);
    assert.ok(reads.every(sql=>!(/civic_data_(?:promotions|candidates|candidate_events|payload_parts)/.test(sql))));
  }finally{installFactReader(undefined);installReaderDatabaseQuery(undefined);await db.pg.close();}
});
