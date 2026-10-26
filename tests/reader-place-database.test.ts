import assert from "node:assert/strict";
import test from "node:test";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {installFactReader} from "../lib/facts/db.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {PLACE_PAGES_SQL,readPlacePackage,readPlacePackageHttp} from "../lib/reader/place.ts";
import {PLACE_PACKAGE_SQL,buildPlacePackage} from "../lib/reader/place-builder.ts";
import {seedPlacePages} from "./helpers/place-pages.ts";
import {withReaderSelection} from "../lib/db/reader-route.ts";
import {stateCoverage,withPlaceRegistry} from "../lib/reader/coverage.ts";
import {CivicReadCache} from "../lib/db/civic-read-cache.ts";
import {versionedSelect} from "../lib/db/versioned-query.ts";

test("a ballot roster keeps each person's current office, contacts, terms and sources without reading other-body facts",async()=>{
  const {pg}=await migratedReaderDb();
  const division="ocd-division/country:us/state:co/place:fixture",body=`${division}#council`,person="person:fixture",at="2026-10-24T12:00:00.000Z";
  const values={name:"Casey Resident",office:"Council Member",email:"casey@example.gov",phone:"303-555-0100",website:"https://example.gov/casey",
    term_note:"Elected term",term_start:"2025-01-06",term_end:"2029-01-08"};
  try{
    await pg.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Fixture council','CO'),($2,'person','Casey Resident','CO')",[body,person]);
    await pg.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,$1,$1,$2,$3,'source')",["https://example.gov/council",at,"c".repeat(64)]);
    const fact=async(id:string,field:string,value:unknown,quote:string)=>pg.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES($1,$2,$3,'saved','live','OFFICIAL',1,$4,$5,'fixture')`,[id,field,JSON.stringify(value),quote,at]);
    await fact(body,`member:${person}`,{name:"Casey Resident",office:"Member"},"Official council roster");
    for(const [field,value] of Object.entries(values))await fact(person,field==="name"||field==="phone" ? field : `${field}:${body}`,value,`Verified ${field}`);
    await fact(person,"office:another-body","Different office","Unrelated board evidence".repeat(12000));
    await fact(person,"biography","Held elsewhere","Unrelated biography evidence".repeat(12000));
    let bytes=0;
    const place=await buildPlacePackage({state:"CO",divisionIds:[division],bodyIds:[body],bodyFactsOnly:true},async(text,params=[])=>{
      const rows=(await pg.query<Record<string,unknown>>(text,[...params])).rows;bytes=Buffer.byteLength(JSON.stringify(rows));return rows;
    });
    const member=place.bodies.find(row=>row.id===body)?.roster?.members[0];assert.ok(member);
    assert.equal(member.name,values.name);assert.equal(member.officeTitle,values.office);
    assert.equal(member.email,values.email);assert.equal(member.phone,values.phone);assert.equal(member.websiteUrl,values.website);
    assert.equal(member.termNote,values.term_note);assert.equal(member.termStart,values.term_start);assert.equal(member.termEnd,values.term_end);
    for(const [field,source] of Object.entries(member.fieldSources ?? {})){
      const original=({websiteUrl:"website",termNote:"term_note",termStart:"term_start",termEnd:"term_end"} as Record<string,string>)[field]??field;
      assert.equal(source.quote,`Verified ${original}`);assert.equal(source.sourceUrl,"https://example.gov/council");
    }
    assert.equal(Object.keys(member.fieldSources ?? {}).length,8);
    assert.ok(bytes<20000,`Only roster-consumed person facts should cross the connection; got ${bytes} bytes`);
  }finally{await pg.close();}
});

test("place reads preserve the migrated state type, use the existing one-shot client and share request work",async()=>{
  const {pg}=await migratedReaderDb();
  const input={state:"AZ",divisionIds:["ocd-division/country:us/state:az/place:fixture"]};
  let reads=0,release:()=>void=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve});
  try{
    await pg.exec("SET enable_seqscan=off");
    const plan=await pg.query<Record<string,unknown>>(`EXPLAIN (FORMAT JSON) ${PLACE_PACKAGE_SQL}`,
      ["AZ",input.divisionIds,[],"ocd-division/country:us/state:az",false,false,false,null,false,[]]);
    assert.ok(!JSON.stringify(plan.rows).includes("(state)::text"),"a text comparison prevents the real char(2) state index from qualifying the read");
    await pg.exec("RESET enable_seqscan");
    const query=async(text:string,params:readonly unknown[]=[]) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
    await seedPlacePages(query,input);
    installFactReader(async(text,params=[])=>{assert.equal(text,PLACE_PAGES_SQL);reads++;await held;return(await pg.query<Record<string,unknown>>(text,[...params])).rows;});
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
    assert.equal(reads,2,"a later request checks the current ready page again");
  }finally{release();installFactReader(undefined);installReaderDatabaseQuery(undefined);await pg.close();}
});

test("an independent place request sees a rebuilt current page while an older query response is pending",async()=>{
  const {pg}=await migratedReaderDb();
  const copies=new Map<string,string>();
  const checked=versionedSelect("place-request-race",new CivicReadCache({read:async key=>copies.get(key)??null,
    write:async(key,value)=>{copies.set(key,value);}}));
  const division="ocd-division/country:us/state:az/place:request-race",body=`${division}#council`,at="2026-10-24T12:00:00.000Z";
  const input={state:"AZ",divisionIds:[division],bodyIds:[body],bodyFactsOnly:true};
  const firstSelection={states:["AZ"],keys:new Set(input.divisionIds)},secondSelection={states:["AZ"],keys:new Set(input.divisionIds)};
  let reads=0,release=()=>{},started=()=>{};
  const held=new Promise<void>(resolve=>{release=resolve;});
  const queried=new Promise<void>(resolve=>{started=resolve;});
  try {
    await pg.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Request race council','AZ')",[body]);
    await pg.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,$1,$1,$2,$3,'source')",["https://example.gov/council",at,"d".repeat(64)]);
    await pg.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES($1,'office_phone','"520-555-0100"','520-555-0100','live','OFFICIAL',1,'Council contact',$2,'fixture')`,[body,at]);
    const query=async(text:string,params:readonly unknown[]=[]) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
    await seedPlacePages(query,input);
    installFactReader(async(text,params=[])=>{
      const call=++reads;
      const rows=await checked(async(text,params)=>(await pg.query<Record<string,unknown>>(text,[...params])).rows,text,params);
      if(call===1){started();await held;}
      return rows;
    });
    const first=withReaderSelection(firstSelection,()=>readPlacePackageHttp(input));
    await queried;
    await pg.query(`UPDATE fact SET value='"520-555-0199"',value_text='520-555-0199' WHERE entity_id=$1 AND field='office_phone'`,[body]);
    await seedPlacePages(query,input);
    const second=withReaderSelection(secondSelection,()=>readPlacePackageHttp(input));
    assert.notEqual(second,first,"a new request never joins an older fact snapshot");
    assert.equal(withReaderSelection(firstSelection,()=>readPlacePackageHttp(input)),first,"same-request composition retains its own snapshot");
    assert.equal((await second).bodies[0]?.fields.officePhone,"520-555-0199");
    assert.equal(reads,2,"the independent request issues a fresh database version check");
    assert.equal(withReaderSelection(secondSelection,()=>readPlacePackageHttp(input)),second);
    release();
    assert.equal((await first).bodies[0]?.fields.officePhone,"520-555-0100");
  } finally {release();installFactReader(undefined);await pg.close();}
});

test("the ballot's body-facts projection preserves contacts and registered body names while omitting unused packages",async()=>{
  const {pg,publish}=await migratedReaderDb();
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
    const full=await buildPlacePackage(input,query),facts=await buildPlacePackage({...input,bodyFactsOnly:true},query);
    assert.deepEqual(facts.bodies,full.bodies);
    assert.equal(facts.bodies[0]?.fields.officePhone,"520-555-0100");
    assert.equal(facts.bodies[0]?.fields.name,"Fixture council");
    assert.deepEqual(facts.meetings,full.meetings);assert.equal(facts.meetings.length,1);
    assert.equal(facts.registry,null);assert.ok(full.registry);
    assert.deepEqual(facts.governments,[]);assert.deepEqual(facts.publicationAttempts,[]);
  }finally{await pg.close();}
});

test("a board filed on the state shows where the one local government sharing its website governs",async()=>{
  const {pg,publish}=await migratedReaderDb();
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
    const place=await buildPlacePackage({state:"AZ",divisionIds:[county]},query);
    assert.deepEqual(place.bodies.map(body=>[body.id,body.fields.ocdId]),[["wtp-body/fixture/parks#governing",county]],
      "a website two governments share, a state agency's website and another county's board never place a board here");
  }finally{await pg.close();}
});

test("a local registration brings its own native and jurisdiction boards with live facts into the place",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const state="ocd-division/country:us/state:al",city=`${state}/place:mobile`,other=`${state}/place:elsewhere`,at="2026-10-23T00:00:00.000Z";
  const native="government:US-AL:cog:115070",alias="al:special:mobile-housing-authority";
  const query=async(text:string,params:readonly unknown[]=[]) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
  try{
    await pg.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
      ($1,'place','Alabama','AL',NULL),($2,'place','Mobile','AL',$1),($3,'place','Elsewhere','AL',$1),
      ($4,'government','Mobile Housing Authority','AL',$1),($5,'government','Mobile Housing Authority','AL',$1),
      ($4||'#governing','body','Mobile Housing Authority governing board','AL',$4),
      ($5||'#body:finance','body','Finance Committee','AL',$5),
      ('al:special:other','government','Other Authority','AL',$1),('al:special:other#governing','body','Other Board','AL','al:special:other')`,[state,city,other,native,alias]);
    await pg.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES (1,'https://example.gov/housing','https://example.gov/housing',$1,$2,'housing')",[at,"b".repeat(64)]);
    await pg.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES ($1||'#governing','office_phone','"251-555-0100"','251-555-0100','live','OFFICIAL',1,'251-555-0100',$2,'fixture')`,[native,at]);
    const government=(id:string,jurisdictionId:string,divisionId:string)=>({id,jurisdictionId,name:"Housing Authority",state:"AL",kind:"GOVERNMENT",governmentClass:"SPECIAL_DISTRICT",aliases:[],nativeIds:{},bodyIds:[],
      associations:[{divisionId,layer:"place",geoid:"0150000",basis:"SOURCE_CODE"}]});
    await publish({id:"registration-local",recordClass:"REGISTRATION",scope:"US-AL:registration:v1",sourceId:"fixture",at,
      value:{formatVersion:1,state:"AL",divisions:[],bodies:[],governments:[government(native,alias,city),government("government:US-AL:cog:other","al:special:other",other)]}});
    const place=await buildPlacePackage({state:"AL",divisionIds:[city]},query);
    assert.deepEqual(place.bodies.map(body=>body.id).sort(),[`${alias}#body:finance`,`${native}#governing`].sort());
    assert.equal(place.bodies.find(body=>body.id===`${native}#governing`)?.fields.officePhone,"251-555-0100");
    assert.ok(!place.bodies.some(body=>body.id.startsWith("al:special:other")));
  }finally{await pg.close();}
});

test("a merged board's saved runtime and old links resolve to one canonical body and preserve its roster",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const state="ocd-division/country:us/state:az",place=`${state}/school_district:fixture`,body=`${place}#board`,alias="wtp-body/country:us/state:az/fixture#governing",at="2026-10-23T00:00:00.000Z";
  const query=async(text:string,params:readonly unknown[]=[]) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
  try{
    await pg.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
      ($1,'place','Arizona','AZ',NULL),($2,'place','Fixture School District','AZ',$1),($3,'body','Fixture School Board','AZ',$2)`,[state,place,body]);
    await pg.query("INSERT INTO entity_place VALUES ($1,$2)",[body,place]);
    await pg.query("INSERT INTO entity_external_id VALUES ($1,'body-alias',$2)",[body,alias]);
    const roster={bodyId:alias,bodyName:"Fixture School Board",members:[{id:"roster:fixture:1",name:"Jane Example",officeTitle:"Member"}],sourceUrl:"https://example.gov/board",sourceOrg:"Fixture District",collectedAt:at};
    await publish({id:"alias-runtime",recordClass:"REGISTRY_RUNTIME_BINDING",scope:"US-AZ:reader-registry-runtime",sourceId:"fixture",at,
      value:{formatVersion:1,registry:{generatedAt:at,bodies:[{id:alias,name:roster.bodyName,ocdId:place}],divisions:[]},
        bodyRosters:[roster],rosterReaderDispositions:[],statewideExecutives:[],officialCandidacies:{rows:[]},officialPhotos:{photos:[]},rosterPhotos:{}}});
    for(const input of [{state:"AZ",divisionIds:[place]},{state:"AZ",divisionIds:[],bodyIds:[alias],neighbors:true}]){
      await seedPlacePages(query,input);
      const result=await readPlacePackage(input,query);
      assert.deepEqual(result.bodies.map(row=>row.id),[body]);
      assert.deepEqual(result.registry?.registry.bodies.map(row=>row.id),[body]);
      assert.equal(result.registry?.bodyRosters[0]?.bodyId,body);
      assert.equal(result.registry?.bodyRosters[0]?.members[0]?.name,"Jane Example");
      const current=result.registry!;
      const old={...current,registry:{...current.registry,bodies:[...current.registry.bodies,{...current.registry.bodies[0]!,id:alias}]}};
      const statePackage={state:"AZ",version:"fixture",registry:old};
      const local=withPlaceRegistry(statePackage,current);
      assert.equal(local.registry.officialPhotos,old.officialPhotos,"state officials' portraits survive the local board selection");
      const coverage=stateCoverage(local,[place],0,0,[],result.bodies,[{ocdId:place,label:"Fixture School District",state:"AZ",divisionType:"school_district",parentOcdId:state,
        tier:"local",lsad:null,funcstat:null,classfp:null,geoid:null,canonicalOcdId:place,canonicalMatch:"exact",sourceDataset:"TIGER_CB2023",
        provenance:{sourceUrl:"https://example.gov/district",sourceOrg:"Fixture District",collectedAt:at,verifiedAt:at}}]);
      assert.deepEqual(coverage.bodies.map(row=>row.bodyId),[body],"map movement uses the same canonical local registry as ZIP entry");
    }
  }finally{await pg.close();}
});
