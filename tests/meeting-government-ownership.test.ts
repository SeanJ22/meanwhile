import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { readSittingFacts, withSittingFacts } from "../lib/facts/meeting-read.ts";
import { publishHeldMeetingPins } from "../lib/civic-data/held-meeting-pins.ts";
import { publishedPinOffices } from "../lib/meetings/publish-pins.ts";
import { summarizeCoverage } from "../lib/registry/coverage.ts";
import { withRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import type { Registry } from "../lib/registry/types.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { factDb } from "./helpers/fact-db.ts";
import { installKeyedRows } from "./helpers/keyed-rows.ts";

const ROOT=join(import.meta.dirname,".."),NOW="2026-10-26T20:00:00.000Z",OLD="2026-10-14T03:40:19.031Z";
const COUNTY="ocd-division/country:us/state:az/county:pima";
const BODY=COUNTY+"#central-arizona-water-conservation-district",COUNTY_BODY=COUNTY+"#governing";
const FOREIGN="az:special:pima-county-regional-transportation-authority";
const FOREIGN_BODY="wtp-body/country:us/state:az/census:214891/pima_county_regional_transportation_authority#governing";
const ADDRESS="1 E Broadway Blvd, Suite 401 Tucson, AZ 85701",OWN="23636 N Seventh St, Phoenix, AZ 85024";
const foreignSource={sourceUrl:"https://rtamobility.com/who-we-are/contact-us/",sourceOrg:"Pima County Regional Transportation Authority",collectedAt:OLD,verifiedAt:null};
const ownSource={sourceUrl:"https://www.cap-az.com/contact-us/",sourceOrg:"Central Arizona Water Conservation District",collectedAt:OLD,verifiedAt:null};
const pin=(bodyId:string,basis:"GOVERNMENT_OFFICE"|"BODY_OFFICE"="GOVERNMENT_OFFICE")=>({
  bodyId,meetingId:"fixture",basis,name:basis==="BODY_OFFICE"?"CAP Board":foreignSource.sourceOrg,
  address:basis==="BODY_OFFICE"?OWN:ADDRESS,lat:basis==="BODY_OFFICE"?33.701204:32.221072259202,
  lng:basis==="BODY_OFFICE"?-112.065793:-110.971058083152,matchedAddress:basis==="BODY_OFFICE"?OWN:ADDRESS,
  provenance:basis==="BODY_OFFICE"?ownSource:foreignSource,publishedLocation:null,
});
const meeting=(id:string,bodyId=BODY):Meeting=>({id,bodyId,bodyName:"Board of Directors",ocdId:COUNTY,
  title:"Regular meeting",startsAt:NOW,timeZone:"America/Phoenix",location:null,agendaUrl:null,status:"SCHEDULED",
  jurisdiction:"Central Arizona Water Conservation District, AZ",provenance:{...ownSource,sourceUrl:"https://capaz.portal.civicclerk.com/event/fixture"}});

test("ordinary identity and held-pin maintenance repair a borrowed owner without changing calendar bytes",async()=>{
  const db=await factDb();
  try{
    await db.pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,promoted_at timestamptz,payload jsonb);
      CREATE TABLE civic_data_candidates(id text PRIMARY KEY,source_id text,record_class text,scope text,state text,retrieved_at timestamptz,candidate jsonb);
      ALTER TABLE civic_data_promotions ADD COLUMN source_id text DEFAULT 'fixture'`);
    await installKeyedRows(db.pg);
    await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
      ($1,'place','Pima County','AZ',NULL),($2,'government',$3,'AZ',$1),
      ($4,'body','CAP Board','AZ',$2),($5,'body','County Board','AZ',$2),($6,'body',$3,'AZ',$2)`,
      [COUNTY,FOREIGN,foreignSource.sourceOrg,BODY,COUNTY_BODY,FOREIGN_BODY]);
    const [foreignCopy]=await db.query(`INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key) VALUES($1,$1,$2,$3,'foreign-office') RETURNING id`,
      [foreignSource.sourceUrl,OLD,"a".repeat(64)]);
    const [ownCopy]=await db.query(`INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key) VALUES($1,$1,$2,$3,'own-office') RETURNING id`,
      [ownSource.sourceUrl,OLD,"b".repeat(64)]);
    const addFact=async(entity:string,field:string,value:unknown,copy:unknown)=>db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES($1,$2,$3,$4,'live','OFFICIAL',$5,$4,$6,'fixture')`,[entity,field,JSON.stringify(value),typeof value==="string"?value:JSON.stringify(value),copy,OLD]);
    await addFact(FOREIGN,"office_address",ADDRESS,foreignCopy.id);
    await addFact(BODY,"office_address",OWN,ownCopy.id);
    const borrowed={...meeting("fixture:borrowed-live"),mapPin:pin(BODY)};
    const embedded={...meeting("fixture:borrowed-snapshot-only"),mapPin:pin(BODY)};
    const own={...meeting("fixture:own-office"),mapPin:pin(BODY,"BODY_OFFICE")};
    const actual={...meeting("fixture:actual-venue"),location:{name:"CAP Headquarters, Board Room",address:OWN,lat:33.701204,lng:-112.065793}};
    const legitimate={...meeting("fixture:actual-rta",FOREIGN_BODY),mapPin:pin(FOREIGN_BODY)};
    const originals=[borrowed,embedded,own,actual,legitimate],payload={meetings:originals,agendaDocuments:[]};
    for(const row of originals.filter(row=>row.id!==embedded.id))await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'meeting','Meeting','AZ',$2)",["meeting:"+row.id,row.bodyId]);
    await addFact("meeting:"+borrowed.id,"map_pin",borrowed.mapPin,foreignCopy.id);
    await addFact("meeting:"+own.id,"map_pin",own.mapPin,ownCopy.id);
    await addFact("meeting:"+actual.id,"location",actual.location,ownCopy.id);
    await addFact("meeting:"+legitimate.id,"map_pin",legitimate.mapPin,foreignCopy.id);
    await db.query("INSERT INTO civic_data_promotions(key,record_class,scope,current_version_id,promoted_at,payload) VALUES('MEETING:fixture','MEETING','fixture','same-provider-version',$1,$2)",[OLD,JSON.stringify(payload)]);
    await db.query("INSERT INTO civic_data_promotions(key,record_class,scope,current_version_id,promoted_at,payload) VALUES('REGISTRATION:US-AZ:registration:v1','REGISTRATION','US-AZ:registration:v1','same-directory-version',$1,$2)",
      [OLD,JSON.stringify({governments:[{id:"government:US-AZ:cog:214891",jurisdictionId:FOREIGN,state:"AZ",name:foreignSource.sourceOrg,
        governmentClass:"SPECIAL DISTRICT",aliases:[COUNTY_BODY],bodyIds:[FOREIGN_BODY],officeAddress:ADDRESS,provenance:foreignSource,
        associations:[{divisionId:COUNTY,basis:"COUNTY_IN_NAME"}]}]})]);
    await db.query("INSERT INTO fact_store_load(source,sha256) VALUES('registration:az','former-geographic-owner-inference')");

    assert.deepEqual(await ensureFactEntities(db,ROOT,["az"]),["az"]);
    const parents=await db.query("SELECT id,parent_id FROM entity WHERE id=ANY($1::text[]) ORDER BY id",[[BODY,COUNTY_BODY,FOREIGN_BODY]]);
    assert.equal(parents.find(row=>row.id===BODY)?.parent_id,COUNTY,"a hosted water district belongs to neither the transit authority nor the county government");
    assert.equal(parents.find(row=>row.id===COUNTY_BODY)?.parent_id,"az:county:county-of-pima","the canonical county board keeps its county government");
    assert.equal(parents.find(row=>row.id===FOREIGN_BODY)?.parent_id,FOREIGN,"a native Census identity keeps the legitimate owner in the same county");
    const offices=await publishedPinOffices(db.query,[BODY,FOREIGN_BODY,COUNTY_BODY]);
    assert.equal(offices.get(BODY)?.officeContact?.address,OWN);
    assert.equal(offices.get(BODY)?.governmentOffice,undefined);
    assert.equal(offices.get(FOREIGN_BODY)?.governmentOffice?.address,ADDRESS);
    assert.equal(offices.get(COUNTY_BODY)?.governmentOffice,undefined,"a legacy county-board alias cannot override the county government's identity");
    const facts=[...(await readSittingFacts(db.query,[BODY,FOREIGN_BODY])).values()].flat();
    const seen=withSittingFacts(originals,facts);
    assert.equal(seen[0].mapPin,undefined,"the existing live borrowed claim is withdrawn");
    assert.equal(seen[1].mapPin,undefined,"the immutable snapshot's borrowed claim is withdrawn even when it had no fact row");
    assert.deepEqual(seen[2].mapPin,own.mapPin);
    assert.deepEqual(seen[3].location,actual.location);
    assert.deepEqual(seen[4].mapPin,legitimate.mapPin);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM fact WHERE field='map_pin' AND status='pulled' AND held_reason='GOVERNMENT_OFFICE_OWNER_CHANGED'"))[0].n,2);

    let attempts=0;
    const result=await publishHeldMeetingPins({facts:db,vault:new MemoryEvidenceStore(),clocks:factClocks(null),now:NOW,deadlineMs:Date.parse(NOW)+60_000,
      clock:()=>Date.parse(NOW),fetchImpl:async input=>{
        const url=new URL(String(input));assert.equal(url.hostname,"geocoding.geo.census.gov","unchanged calendar bytes are never fetched");
        assert.ok(url.searchParams.get("address")?.includes("23636"));attempts++;
        return Response.json({result:{addressMatches:[]}});
      }});
    assert.deepEqual(result.failures,[]);assert.equal(result.unplaced,2);assert.equal(attempts,1,"both corrected sittings share the exact body-office attempt");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM blank WHERE field='map_pin'"))[0].n,2,"an unplaced own office stays owed through the existing retry");
    assert.deepEqual((await db.query("SELECT payload FROM civic_data_promotions WHERE key='MEETING:fixture'"))[0].payload,JSON.parse(JSON.stringify(payload)));
    assert.deepEqual(await ensureFactEntities(db,ROOT,["az"]),[],"the repaired identity inputs are quiet on the following pass");
  }finally{await db.pg.close();}
});

test("a division's label stays geographic when a held body carries a different government's name",()=>{
  const registry=JSON.parse(readFileSync(join(ROOT,"lib/registry/registry.json"),"utf8")) as Registry;
  const division=registry.divisions.find(row=>row.ocdId===COUNTY)!;
  const body=registry.bodies.find(row=>row.id===BODY)!;
  assert.ok(division);assert.ok(body);
  const runtime:RegistryRuntimeReadModel={formatVersion:1,registry:{...registry,divisions:[division],bodies:[body]},bodyRosters:[],rosterReaderDispositions:[],
    statewideExecutives:[],officialPhotos:{photos:[]},rosterPhotos:{},officialCandidacies:{formatVersion:1,rule:"EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE",rows:[]}};
  const summary=withRegistryRuntimeProjection(runtime,["AZ"],()=>summarizeCoverage([-111,32],[],new Map([[COUNTY,division]]),
    [{...body,governmentName:foreignSource.sourceOrg}],0,new Map(),[division]));
  assert.equal(summary.bodies.find(row=>row.bodyId===BODY)?.divisionLabel,division.label);
  const owned=withRegistryRuntimeProjection(runtime,["AZ"],()=>summarizeCoverage([-111,32],[],new Map([[COUNTY,division]]),
    [{...body,governmentId:"az:special:water-district",governmentName:ownSource.sourceOrg}],0,new Map(),[division]));
  assert.equal(owned.bodies.find(row=>row.bodyId===BODY)?.divisionLabel,ownSource.sourceOrg,"an exact named district owner stays distinct from its county territory");
});
