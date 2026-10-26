import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {GET as meetingsGET} from "../app/api/meetings/route.ts";
import {lookupZcta} from "../lib/geo/zcta.ts";
import {stateCoverage} from "../lib/reader/coverage.ts";
import {readerLocation,readerTerritory} from "../lib/reader/location.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {PLACE_PAGES_SQL,READY_PLACE_SQL,placePageTerritory,readPlacePackage} from "../lib/reader/place.ts";
import {packReadyPlace,unpackReadyPlace,unpackReadyTerritory} from "../lib/reader/place-ready.ts";
import {PLACE_PACKAGE_SQL,rebuildPlacePages} from "../lib/reader/place-builder.ts";
import {bodyIdsAtPoint,bodyIdsWithTerritory,selectBodyTerritory,type BodyTerritoryFile} from "../lib/registry/body-territory.ts";
import type {Body,Division} from "../lib/registry/types.ts";
import type {RegistryRuntimeReadModel} from "../lib/registry/runtime-data-plane.ts";
import type {PlacePackage} from "../lib/reader/place-types.ts";
import type {Meeting} from "../lib/sources/types.ts";
import type {OfficeholderSet} from "../lib/officials/types.ts";
import {snapshotCounts} from "../lib/meetings/snapshot.ts";
import type {FactDb} from "../lib/facts/publish.ts";
import {factDb} from "./helpers/fact-db.ts";

const AT="2026-10-24T12:00:00.000Z",ROOT="ocd-division/country:us/state:az",CITY=`${ROOT}/place:tucson`;
const LOCAL=`${CITY}#governing`,INSIDE="curated:az/synthetic-inside#governing",OUTSIDE="curated:az/synthetic-outside#governing",OVERLAP="wtp-body/country:us/state:az/synthetic-overlap#governing";
const source={sourceUrl:"https://example.test/verified",sourceOrg:"Fixture publisher",collectedAt:AT,verifiedAt:AT};
const division=(id:string):Division=>({ocdId:id,label:id===CITY?"Example city":"Arizona",divisionType:id===ROOT?"state":"place",tier:id===ROOT?"state":"local",state:"AZ",parentOcdId:id===ROOT?"ocd-division/country:us":ROOT,
  lsad:null,funcstat:null,classfp:null,geoid:null,canonicalOcdId:id,canonicalMatch:"exact",sourceDataset:"GOV_DIRECTORY",provenance:source});
const body=(id:string,ocdId:string|null):Body=>({id,ocdId,name:id===LOCAL?"Mayor and Council":id,bodyClass:"GOVERNING",bodyOrigin:"SOURCED",coverageStatus:"LIVE",agendaSourceType:"NONE",agendaSourceRef:null,
  meetingCadence:null,homepageUrl:source.sourceUrl,demandCount:0,sourceDataset:"GOV_DIRECTORY",provenance:source});
const bodies=[body(LOCAL,CITY),body(INSIDE,null),body(OUTSIDE,CITY),body(OVERLAP,null)];
const member={id:`roster:${LOCAL}#member`,personId:"person:exact",name:"Member — 予算",officeTitle:"Mayor",termNote:null,email:null,phone:null,websiteUrl:null};
const runtime=(divisions:Division[]):RegistryRuntimeReadModel=>({formatVersion:1,registry:{generatedAt:AT,bodies,divisions},
  bodyRosters:[{bodyId:LOCAL,bodyName:"Mayor and Council",members:[member],sourceUrl:source.sourceUrl,sourceOrg:source.sourceOrg,collectedAt:AT,partisanship:"UNDETERMINED"}],
  rosterReaderDispositions:[],statewideExecutives:[],officialCandidacies:{formatVersion:1,rule:"EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE",rows:[]},officialPhotos:{photos:[]},rosterPhotos:{}});
function polygon(id:string,x:number,y:number):BodyTerritoryFile["features"][number] {
  return {properties:{bodyId:id,bodyName:id,plat:"Synthetic fixture",sequence:null,zcta:"85701",formationInstrument:"Fixture instrument",formationSource:source.sourceUrl,platSource:source.sourceUrl,platSourceOrg:source.sourceOrg},
    geometry:{type:"Polygon",coordinates:[[[x-.01,y-.01],[x+.01,y-.01],[x+.01,y+.01],[x-.01,y+.01],[x-.01,y-.01]]]}};
}
function geometry(point:[number,number]):BodyTerritoryFile {
  return {type:"FeatureCollection",note:"Synthetic fixture only",generatedAt:AT,features:[polygon(INSIDE,...point),polygon(OVERLAP,point[0]+.005,point[1]+.005),polygon(OUTSIDE,point[0]+.1,point[1]+.1),polygon(INSIDE,point[0]+.2,point[1]+.2)]};
}
function ready(divisions:Division[]):PlacePackage {
  const meetings:Meeting[]=bodies.map((b,index)=>({id:`fixture:${index}`,...(b.id===INSIDE?{mergedMeetingIds:["calendar:former-permanent-id"]}:{}),bodyId:b.id,bodyName:b.name!,ocdId:b.ocdId,title:`Public hearing ${index}`,
    startsAt:`2026-10-${25+index}T12:00:00Z`,timeZone:"UTC",location:null,agendaUrl:source.sourceUrl,jurisdiction:"Local",status:"SCHEDULED",provenance:source}));
  const snapshot={formatVersion:1 as const,generatedAt:AT,meetings,agendaDocuments:[],sources:[],counts:snapshotCounts(meetings,0)};
  return {registry:runtime(divisions),everydayRouting:null,publicationAttempts:[],bodies:[],governments:[],divisions,registrationHeld:true,meetings,snapshot,snapshotHeldAt:AT,
    bodySnapshots:Object.fromEntries(bodies.map(b=>[b.id,{...snapshot,meetings:meetings.filter(m=>m.bodyId===b.id)}])),agendaDocumentLinks:[]};
}

test("a preselected territory preserves complete coverage for inside, outside, overlap, empty and permanent body identities",()=>{
  const point:[number,number]=[0,0],file=geometry(point),registry=runtime([division(ROOT),division(CITY)]);
  const people:OfficeholderSet={scope:"04",generatedAt:AT,officeholders:[{id:"official:exact",name:"Verified Official",officeTitle:"Mayor",level:"LOCAL",termStart:"2025-01-01",termEnd:"2028-12-31",birthDate:null,partyLabel:null,
    websiteUrl:source.sourceUrl,contactFormUrl:null,phone:null,email:null,campaignUrl:null,photo:null,provenance:source}],divisions:[{ocdId:CITY,officeholderId:"official:exact",bodyId:null}],unmatched:[]};
  const state={state:"AZ",registry,version:AT,people};
  for(const current of [point,[-.009,-.009],[.014,.014],[.5,.5]] as [number,number][]) {
    const selected=selectBodyTerritory(current,file)!;
    assert.deepEqual(bodyIdsAtPoint(current,selected),bodyIdsAtPoint(current,file));
    assert.deepEqual(bodyIdsWithTerritory(selected),bodyIdsWithTerritory(file));
    const full=stateCoverage(state,[ROOT,CITY],current[1],current[0],[],[],[],file);
    const preselected=stateCoverage(state,[ROOT,CITY],current[1],current[0],[],[],[],selected);
    assert.deepEqual(preselected,full,"every body, member, official and coverage field stays identical");
    assert.ok(!preselected.bodies.some(b=>b.bodyId===OUTSIDE),"a known outside territory cannot fall back to its city filing");
    assert.equal(preselected.bodies.find(b=>b.bodyId===LOCAL)!.readerRoster!.members[0]!.id,member.id);
    assert.ok(preselected.seats.some(seat=>seat.representatives.some(holder=>holder.id==="official:exact")));
  }
  assert.deepEqual([...bodyIdsAtPoint(point,selectBodyTerritory(point,file))],[INSIDE,OVERLAP]);
  assert.deepEqual(selectBodyTerritory(point,null),null);
  assert.deepEqual(bodyIdsWithTerritory(selectBodyTerritory(point,{...file,features:[]})),new Set());
});

// Node 23.6 renamed --experimental-test-isolation to --test-isolation; CI runs 24, local checkouts may run 22.
const isolationNone=Number(process.versions.node.split(".")[0])>=23?"--test-isolation=none":"--experimental-test-isolation=none";

test("a canonical ZIP uses its private ready selection with one SQL read and no geometry load; legacy and custom points retain geometry",async t=>{
  // A fresh process proves a cold geometry cache and cannot leave fixture polygons in other tests.
  if(process.env.WTP_TEST_ZIP_TERRITORY_CHILD!=="1") {
    const child=spawnSync(process.execPath,["--test",isolationNone,"--test-name-pattern=^a canonical ZIP","--experimental-strip-types","--import","./scripts/register-test-loader.mjs","--import","./tests/helpers/install-fixture-doors.ts",fileURLToPath(import.meta.url)],
      {cwd:process.cwd(),env:{...process.env,WTP_TEST_ZIP_TERRITORY_CHILD:"1"},encoding:"utf8",timeout:120_000,maxBuffer:2*1024*1024});
    assert.ifError(child.error);assert.equal(child.status,0,child.stdout+child.stderr);
    t.diagnostic("Fresh-process proof: one READY SELECT, zero geometry loads/fetches; private scope, legacy/custom behavior and worker persistence preserved.");
    return;
  }
  t.mock.timers.enable({apis:["Date"],now:new Date(AT)});
  const zip="85701",point=lookupZcta(zip)!;
  const coordinates:[number,number]=[point.lng,point.lat],file=geometry(coordinates),selection=selectBodyTerritory(coordinates,file)!;
  let geometryReads=0,fetches=0,reads:string[]=[],stored:unknown;
  const original=fs.readFile;
  t.mock.method(fs,"readFile",async(...args:Parameters<typeof fs.readFile>)=>{
    if(String(args[0]).endsWith("data/states/az/geo/body-territories.geojson")){geometryReads++;return JSON.stringify(file);}
    return Reflect.apply(original,fs,args);
  });
  syncBuiltinESMExports();
  t.mock.method(globalThis,"fetch",async()=>{fetches++;throw Error("This fixture must not make network requests");});
  try {
    const location=await readerLocation(point.lat,point.lng,zip),page=ready([...new Set([ROOT,...location.divisionIds,...location.fringe])].map(division));
    stored=packReadyPlace(page,selection);
    installReaderDatabaseQuery(async statements=>Promise.all(statements.map(async statement=>{
      reads.push(statement.text);
      assert.equal(statement.text,READY_PLACE_SQL);
      assert.deepEqual(statement.params,[`zip:${zip}`,false]);
      return [{page:stored,version:1}];
    })));
    const call=async()=>{const response=await meetingsGET(new Request(`https://example.test/api/meetings?zip=${zip}`));const payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));return payload;};
    const fast=await call();
    assert.deepEqual(reads,[READY_PLACE_SQL]);assert.equal(geometryReads,0);assert.equal(fetches,0);
    assert.equal(JSON.stringify(fast).includes("BodyTerritorySelection"),false,"internal selection never enters public JSON");
    assert.ok(fast.meetings.some((m:Meeting)=>m.mergedMeetingIds?.includes("calendar:former-permanent-id")));
    stored=packReadyPlace(page,null);reads=[];
    const noGeometry=await call();
    assert.ok(noGeometry.coverage.bodies.some((b:{bodyId:string})=>b.bodyId===OUTSIDE),"null uses the saved absence of territory geometry rather than the legacy fallback");
    assert.deepEqual(reads,[READY_PLACE_SQL]);assert.equal(geometryReads,0);assert.equal(fetches,0);
    stored=packReadyPlace(page);reads=[];
    assert.deepEqual(await call(),fast,"legacy full geometry produces the identical complete API answer");
    assert.deepEqual(reads,[READY_PLACE_SQL]);assert.equal(geometryReads,1);
    const loaded=await readerTerritory("AZ");
    assert.ok(loaded);
    loaded.features=file.features.map(feature=>polygon(feature.properties.bodyId,point.lng+.5,point.lat+.5));
    stored=packReadyPlace(page,selectBodyTerritory(coordinates,loaded));reads=[];
    const empty=await call();
    assert.deepEqual(empty.coverage.bodies.map((b:{bodyId:string})=>b.bodyId),[LOCAL]);
    stored=packReadyPlace(page);reads=[];
    assert.deepEqual(await call(),empty,"an empty inside set still excludes the complete known territory universe");
    const raw={division_ids:location.divisionIds,registry:page.registry,everyday_routing:null,registration_held:true,governments:[],divisions:page.divisions,
      entities:bodies.map(b=>({id:b.id,division:b.ocdId??ROOT,kind:"body",state:"AZ"})),fields:[],rosters:[],comments:[],sittings:[],meeting_rows:[{scope:"source:derived:family:US-AZ",payload:page.snapshot,current_version_id:"fixture",confirmation:null}],
      archived_meetings:[],archived_documents:[],archived_document_links:[],agenda_texts:[],parts:{}};
    let customReads=0;
    installReaderDatabaseQuery(async statements=>Promise.all(statements.map(async statement=>{
      assert.equal(statement.text,PLACE_PAGES_SQL);customReads++;assert.deepEqual(statement.params[2],[]);
      return [{page_id:CITY,page_kind:"place",built_at:AT,body_ids:[],row:raw}];
    })));
    const custom=await meetingsGET(new Request(`https://example.test/api/meetings?zip=${zip}&lat=${point.lat+.02}&lng=${point.lng+.02}`));
    assert.equal(custom.status,200,JSON.stringify(await custom.clone().json()));assert.equal(customReads,1);
    const db=await factDb({withHourlyCounts:true});
    try {
      await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Fixture ZIP','AZ')",[`zip:${zip}`]);
      await db.query("INSERT INTO rebuild_queue(place_id) VALUES($1)",[`zip:${zip}`]);
      let sourceReads=0;
      const wrapped:FactDb={transaction:run=>db.transaction(query=>run(async(text,args)=>{
        if(text!==PLACE_PACKAGE_SQL)return query(text,args);
        sourceReads++;assert.deepEqual(args?.[2],[]);return [raw];
      }))};
      assert.deepEqual(await rebuildPlacePages({db:wrapped,limit:1,concurrency:1,purge:async()=>({purged:true})}),{rebuilt:1,failed:0,remaining:0});
      assert.equal(sourceReads,1);
      const [saved]=await db.query("SELECT body,context FROM place_page WHERE place_id=$1",[`zip:${zip}`]);
      assert.deepEqual(saved!.context,{formatVersion:1});
      assert.deepEqual(unpackReadyTerritory(saved!.body),selectBodyTerritory(coordinates,loaded));
      const published=await readPlacePackage({state:"AZ",placeId:`zip:${zip}`,divisionIds:[]},async()=>[{page:saved!.body,version:1}]);
      assert.deepEqual(placePageTerritory(published),selectBodyTerritory(coordinates,loaded));
      assert.deepEqual(published,unpackReadyPlace(saved!.body));
      assert.equal(JSON.stringify(published).includes("BodyTerritorySelection"),false);
    }finally{await db.pg.close();}
    assert.equal(fetches,0);
    t.diagnostic("Canonical ZIP: one ready-page SELECT, zero geometry loads and zero fetches; legacy fallback and custom-coordinate query retained.");
  }finally{installReaderDatabaseQuery(undefined);t.mock.timers.reset();t.mock.restoreAll();syncBuiltinESMExports();}
});
