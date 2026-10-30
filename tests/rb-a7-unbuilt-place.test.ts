import assert from "node:assert/strict";
import test from "node:test";
import {GET as meetingsGET} from "../app/api/meetings/route.ts";
import {fixtureZipLocation as lookupZcta} from "./helpers/zip-location.ts";
import {readerLocation} from "../lib/reader/location.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {PLACE_PAGES_SQL,READY_PLACE_SQL,placePageCacheIds,readPlacePackage} from "../lib/reader/place.ts";
import {PLACE_PACKAGE_SQL} from "../lib/reader/place-builder.ts";
import {readerCacheTags} from "../lib/reader/cache.ts";
import {sittingRows} from "./helpers/meeting-fact-rows.ts";
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
/** One fact-store row, as the pre-page reader read it and as the page builder reads it. */
const raw=(divisionIds:readonly string[])=>({division_ids:divisionIds,registry,everyday_routing:null,registration_held:true,governments:[],divisions:[],
  entities:[{id:BODY,division:CITY,kind:"body",state:"AZ"}],fields:[],rosters:[],comments:[],sittings:sittingRows([meeting]),
  agenda_documents:[],agenda_document_links:[],agenda_texts:[],parts:{}});

test("a body whose first page is still queued is composed from the fact store with one more read",async()=>{
  const reads:string[]=[];
  const query:Query=async(text,params=[])=>{
    reads.push(text);
    if(text===READY_PLACE_SQL)return [];
    assert.equal(text,PLACE_PACKAGE_SQL);
    assert.deepEqual(params[2],[BODY]);
    assert.equal(params[6],false,"a reader read without agendas stays without agendas");
    return [raw([])];
  };
  const place=await readPlacePackage({state:"AZ",placeId:BODY,divisionIds:[],bodyIds:[BODY]},query);
  assert.deepEqual(reads,[READY_PLACE_SQL,PLACE_PACKAGE_SQL]);
  assert.deepEqual(place.bodies.map(body=>body.id),[BODY]);
  assert.deepEqual(place.meetings.map(m=>m.id),[meeting.id]);
  assert.deepEqual(placePageCacheIds(place),[BODY],"the answer carries the page tag its first build purges");
});

test("a map selection with any unbuilt page is composed whole from the fact store",async()=>{
  const reads:string[]=[];
  const query:Query=async(text,params=[])=>{
    reads.push(text);
    if(text===PLACE_PAGES_SQL)return [{page_id:CITY,page_kind:"place",built_at:null,body_ids:[BODY],row:null}];
    assert.equal(text,PLACE_PACKAGE_SQL);
    assert.deepEqual(params[1],[CITY]);
    return [raw([CITY])];
  };
  const place=await readPlacePackage({state:"AZ",divisionIds:[CITY],bodyIds:[BODY]},query);
  assert.deepEqual(reads,[PLACE_PAGES_SQL,PLACE_PACKAGE_SQL]);
  assert.deepEqual(place.meetings.map(m=>m.id),[meeting.id]);
});

test("a reader visiting a ZIP with no built page still gets its meetings",async t=>{
  t.mock.timers.enable({apis:["Date"],now:new Date(AT)});
  t.mock.method(globalThis,"fetch",async()=>{throw Error("This fixture must not make network requests");});
  const zip="85701",point=lookupZcta(zip)!,location=await readerLocation(point.lat,point.lng,zip);
  const reads:string[]=[];
  installReaderDatabaseQuery(async statements=>Promise.all(statements.map(async statement=>{
    reads.push(statement.text);
    if(statement.text===READY_PLACE_SQL)return [];
    assert.equal(statement.text,PLACE_PACKAGE_SQL);
    assert.deepEqual(statement.params[1],location.divisionIds,"the ZIP's own selection is the one its page would be built from");
    return [raw(location.divisionIds)];
  })));
  try {
    const response=await meetingsGET(new Request(`https://example.test/api/meetings?zip=${zip}`));
    const payload=await response.json();
    assert.equal(response.status,200,JSON.stringify(payload));
    assert.deepEqual(reads,[READY_PLACE_SQL,PLACE_PACKAGE_SQL]);
    assert.ok(payload.meetings.some((m:Meeting)=>m.id===meeting.id),"the held meeting is shown");
    const tags=String(response.headers.get("Netlify-Cache-Tag")).split(",");
    for(const tag of readerCacheTags({places:[`zip:${zip}`]}))assert.ok(tags.includes(tag),"building the page purges this answer");
  } finally { installReaderDatabaseQuery(null); }
});
