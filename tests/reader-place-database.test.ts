import assert from "node:assert/strict";
import test from "node:test";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {BOOTSTRAP_DDL} from "../lib/control-plane/repository/pg-schema.ts";
import {installFactReader} from "../lib/facts/db.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {PLACE_PACKAGE_SQL,readPlacePackage,readPlacePackageHttp} from "../lib/reader/place.ts";
import {withReaderSelection} from "../lib/db/reader-route.ts";

test("place reads preserve the migrated state type, use the existing one-shot client and share request work",async()=>{
  const {pg}=await migratedReaderDb();
  // The current production reader retains this legacy table. Use its actual
  // production bootstrap declaration beside the complete reader migrations.
  const legacy=BOOTSTRAP_DDL.find(ddl=>ddl.startsWith("CREATE TABLE IF NOT EXISTS cp_work_items ("));
  assert.ok(legacy);await pg.exec(legacy);
  const input={state:"AZ",divisionIds:["ocd-division/country:us/state:az/place:fixture"]};
  let reads=0,release:()=>void=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve});
  try{
    await pg.exec("SET enable_seqscan=off");
    const plan=await pg.query<Record<string,unknown>>(`EXPLAIN (FORMAT JSON) ${PLACE_PACKAGE_SQL}`,
      ["AZ",input.divisionIds,[],"ocd-division/country:us/state:az",false,false,false,null,false,[]]);
    assert.ok(!JSON.stringify(plan.rows).includes("(state)::text"),"a text comparison prevents the real char(2) state index from qualifying the read");
    await pg.exec("RESET enable_seqscan");
    installFactReader(async(text,params=[])=>{reads++;await held;return(await pg.query<Record<string,unknown>>(text,[...params])).rows;});
    installReaderDatabaseQuery(async()=>{throw new Error("A one-shot place read must not open a socket session")});
    await withReaderSelection({states:["AZ"],keys:new Set(input.divisionIds)},async()=>{
      const first=readPlacePackageHttp(input);
      assert.equal(readPlacePackageHttp(input),first);
      assert.equal(readPlacePackage(input),first,"other readers share the same in-flight query");
      assert.equal(reads,1);release();
      assert.deepEqual((await first).meetings,[]);
      assert.equal(readPlacePackageHttp(input),first,"a request keeps its settled answer");
    });
    await withReaderSelection({states:["AZ"],keys:new Set(input.divisionIds)},()=>readPlacePackageHttp(input));
    assert.equal(reads,2,"a later request checks current facts again");
  }finally{release();installFactReader(undefined);installReaderDatabaseQuery(undefined);await pg.close();}
});

test("the ballot's body-facts projection preserves contacts and calendar-derived names while omitting unused packages",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const legacy=BOOTSTRAP_DDL.find(ddl=>ddl.startsWith("CREATE TABLE IF NOT EXISTS cp_work_items ("));
  assert.ok(legacy);await pg.exec(legacy);
  const division="ocd-division/country:us/state:az/place:fixture",body=`${division}#council`,at="2026-10-21T00:00:00.000Z";
  const query=async(text:string,params:readonly unknown[]=[]) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
  const input={state:"AZ",divisionIds:[division],bodyIds:[body]};
  try{
    await pg.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Fixture council','AZ')",[body]);
    await pg.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,$1,$1,$2,$3,'source')",["https://example.gov/council",at,"a".repeat(64)]);
    await pg.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES($1,'office_phone','"520-555-0100"','520-555-0100','live','OFFICIAL',1,'Call the council',$2,'fixture')`,[body,at]);
    await publish({id:"ballot-local-runtime",recordClass:"REGISTRY_RUNTIME_BINDING",scope:"US-AZ:reader-registry-runtime",sourceId:"fixture",at,
      value:{formatVersion:1,registry:{generatedAt:at,bodies:[{id:body,name:"Fixture council",ocdId:division}],divisions:[]},
        bodyRosters:[],rosterReaderDispositions:[],statewideExecutives:[],officialCandidacies:{rows:[]},officialPhotos:{photos:[]},rosterPhotos:{}}});
    await publish({id:"ballot-local-meetings",recordClass:"MEETING",scope:`source:fixture:body:${encodeURIComponent(body)}`,sourceId:"fixture",at,
      value:{formatVersion:1,generatedAt:at,meetings:[{id:"fixture:meeting",bodyId:body,bodyName:"Official council name",ocdId:division,
        title:"Council meeting",startsAt:at,timeZone:"America/Phoenix",location:null,agendaUrl:null,jurisdiction:"Local",status:"SCHEDULED",
        provenance:{sourceUrl:"https://example.gov/council",sourceOrg:"Council",collectedAt:at,verifiedAt:at}}],agendaDocuments:[],sources:[],counts:{}}});
    const full=await readPlacePackage(input,query),facts=await readPlacePackage({...input,bodyFactsOnly:true},query);
    assert.deepEqual(facts.bodies,full.bodies);
    assert.equal(facts.bodies[0]?.fields.officePhone,"520-555-0100");
    assert.equal(facts.bodies[0]?.fields.name,"Official council name");
    assert.deepEqual(facts.meetings,full.meetings);assert.equal(facts.meetings.length,1);
    assert.equal(facts.registry,null);assert.ok(full.registry);
    assert.deepEqual(facts.governments,[]);assert.deepEqual(facts.publicationAttempts,[]);
  }finally{await pg.close();}
});

test("a board filed on the state shows where the one local government sharing its website governs",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const legacy=BOOTSTRAP_DDL.find(ddl=>ddl.startsWith("CREATE TABLE IF NOT EXISTS cp_work_items ("));
  assert.ok(legacy);await pg.exec(legacy);
  const state="ocd-division/country:us/state:az",county=`${state}/county:fixture`,other=`${state}/county:other`,at="2026-10-21T00:00:00.000Z";
  const query=async(text:string,params:readonly unknown[]=[]) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
  try{
    await pg.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
      ($1,'place','Arizona','AZ',NULL),($2,'place','Fixture County','AZ',$1),($3,'place','Other County','AZ',$1),
      ('az:county:county-of-fixture','government','County Of Fixture','AZ',$2),('az:county:county-of-other','government','County Of Other','AZ',$3),
      ('az:special:fixture-water','government','Fixture Water','AZ',$2),('az:state:arizona','government','Arizona','AZ',$1),
      ('wtp-body/fixture/parks#governing','body','Parks Commission','AZ',$1),('wtp-body/fixture/shared#governing','body','Shared Board','AZ',$1),
      ('wtp-body/fixture/state#governing','body','State Board','AZ',$1),('wtp-body/fixture/elsewhere#governing','body','Other Board','AZ',$1)`,[state,county,other]);
    await pg.query(`INSERT INTO entity_place(entity_id,place_id) VALUES('az:county:county-of-fixture',$1),('az:county:county-of-other',$2),('az:special:fixture-water',$1)`,[county,other]);
    await pg.query(`INSERT INTO entity_host(entity_id,host) VALUES('az:county:county-of-fixture','fixture.gov'),('wtp-body/fixture/parks#governing','fixture.gov'),
      ('az:special:fixture-water','shared.org'),('az:county:county-of-other','shared.org'),('wtp-body/fixture/shared#governing','shared.org'),
      ('az:county:county-of-fixture','az.gov'),('wtp-body/fixture/state#governing','az.gov'),
      ('az:county:county-of-other','other.gov'),('wtp-body/fixture/elsewhere#governing','other.gov')`);
    const government=(jurisdictionId:string,divisionId:string|null)=>({id:`government:US-AZ:cog:${jurisdictionId}`,jurisdictionId,name:jurisdictionId,state:"AZ",
      kind:"GOVERNMENT",governmentClass:"COUNTY",aliases:[],nativeIds:{},bodyIds:[],associations:divisionId ? [{divisionId,layer:"county",geoid:"04000",basis:"SOURCE_CODE"}] : []});
    await publish({id:"registration",recordClass:"REGISTRATION",scope:"US-AZ:registration:v1",sourceId:"fixture",at,
      value:{formatVersion:1,state:"AZ",divisions:[],bodies:[],governments:[government("az:county:county-of-fixture",county),government("az:county:county-of-other",other),government("az:special:fixture-water",null)]}});
    await publish({id:"dotgov",recordClass:"DOTGOV_REFERENCE",scope:"US:current-full:domains",sourceId:"fixture",at,
      value:{domains:[{domain:"az.gov",type:"State or territory",state:"AZ",organization:"State of Arizona"}],source:{url:"https://example.gov/dotgov",readAt:"2026-10-13"}}});
    const place=await readPlacePackage({state:"AZ",divisionIds:[county]},query);
    assert.deepEqual(place.bodies.map(body=>[body.id,body.fields.ocdId]),[["wtp-body/fixture/parks#governing",county]],
      "a website two governments share, a state agency's website and another county's board never place a board here");
  }finally{await pg.close();}
});
