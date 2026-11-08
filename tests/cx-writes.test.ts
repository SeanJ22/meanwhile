import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";
import { door } from "../lib/core/door.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { saveReleaseCopy } from "../lib/facts/source-copy.ts";
import { rebuildPlacePages, PLACE_PACKAGE_SQL } from "../lib/reader/place-builder.ts";
import { readPlacePackage } from "../lib/reader/place.ts";
import { enqueueReaderPlaces } from "../lib/reader/cache.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { buildUnchangedConfirmation, serializeUnchangedConfirmation } from "../lib/civic-data/unchanged-confirmation.ts";

const PLACE="ocd-division/country:us/state:az/place:example", BODY=`${PLACE}#council`;
const AT="2026-10-26T10:00:00.000Z", url="https://example.gov/council", purge=async()=>({purged:true});

test("unchanged scheduled checks write no facts, source copies or pages; a reader gets fresh dates and a changed phone publishes",async t=>{
  const db=await migratedFactDb();t.after(()=>db.pg.close());
  await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Example','AZ',NULL),($2,'body','Council','AZ',$1)",[PLACE,BODY]);
  await db.query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2)",[BODY,PLACE]);
  await db.pg.exec(`CREATE TABLE writes(name text PRIMARY KEY,n int DEFAULT 0);
    INSERT INTO writes(name) VALUES('fact'),('source_copy'),('place_page');
    CREATE FUNCTION count_writes() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      UPDATE writes SET n=n+1 WHERE name=TG_TABLE_NAME; RETURN NEW; END $$;
    CREATE TRIGGER fact_writes AFTER INSERT OR UPDATE ON fact FOR EACH ROW EXECUTE FUNCTION count_writes();
    CREATE TRIGGER copy_writes AFTER INSERT OR UPDATE ON source_copy FOR EACH ROW EXECUTE FUNCTION count_writes();
    CREATE TRIGGER page_writes AFTER INSERT OR UPDATE ON place_page FOR EACH ROW EXECUTE FUNCTION count_writes();`);
  const publish=async(phone:string,hour:number)=>{
    const checkedAt=new Date(Date.parse(AT)+hour*3_600_000).toISOString(),text=`Council phone: ${phone}`;
    const copy=await saveReleaseCopy(db.query,{name:"council",url,sha256:createHash("sha256").update(text).digest("hex"),checkedAt,text});
    return door(db,{subjectId:BODY,field:"office_phone",fieldKind:"contact",value:phone,valueText:phone,quote:text,
      provenance:"OFFICIAL",acquisition:"checked",producedBy:"council-loader",costUsd:0,copy},factClocks(null),new Date(checkedAt),{purge});
  };
  const rebuild=()=>rebuildPlacePages({db,purge,limit:20,concurrency:1});
  const read=()=>readPlacePackage({state:"AZ",divisionIds:[PLACE],bodyFactsOnly:true},db.query);
  const held=()=>db.query("SELECT place_id,version,context,stale_at FROM place_page ORDER BY place_id");
  assert.equal((await publish("520-555-0100",0) as {decision:string}).decision,"PUBLISH");
  assert.equal((await rebuild()).failed,0);
  const before=await held();assert.ok(before.length);
  await db.query("UPDATE writes SET n=0");
  for(const hour of [1,2]){
    assert.equal((await publish("520-555-0100",hour) as {decision:string}).decision,"CONFIRM");
    assert.deepEqual(await held(),before,"a scheduled check neither marks nor rewrites any page");
    assert.deepEqual(await db.query("SELECT name,n FROM writes ORDER BY name"),[{name:"fact",n:0},{name:"place_page",n:0},{name:"source_copy",n:0}]);
    const page=await read(),source=page.bodies.find(body=>body.id===BODY)!.fields.fieldSources!.officePhone!;
    assert.equal(source.verifiedAt,new Date(Date.parse(AT)+hour*3_600_000).toISOString());
    assert.deepEqual(await held(),before,"reading the current date does not rewrite a page");
  }
  let assembled=0;
  await rebuildPlacePages({db:{transaction:run=>db.transaction(query=>run(async(text,params)=>{if(text===PLACE_PACKAGE_SQL)assembled++;return query(text,params);} ))},purge,limit:20});
  assert.equal(assembled,0,"the next scheduled page turn never reads an unchanged place");
  assert.equal((await publish("520-555-0199",3) as {decision:string}).decision,"PUBLISH");
  assert.equal((await rebuild()).failed,0);
  assert.equal((await read()).bodies.find(body=>body.id===BODY)!.fields.officePhone,"520-555-0199");
  assert.deepEqual(await db.query("SELECT status,value FROM fact ORDER BY id"),[{status:"superseded",value:"520-555-0100"},{status:"live",value:"520-555-0199"}]);
  console.log("Two scheduled unchanged checks: 0 fact writes, 0 saved-copy writes, 0 page writes; current dates and changed content reached the reader.");
});

test("an unchanged calendar's current check reaches the reader without rebuilding its saved page",async t=>{
  const db=await migratedFactDb();t.after(()=>db.pg.close());
  await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Example','AZ',NULL),($2,'body','Council','AZ',$1)",[PLACE,BODY]);
  await db.query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2)",[BODY,PLACE]);
  const scope=`source:ical:body:${encodeURIComponent(BODY)}`,value={formatVersion:1,generatedAt:AT,sources:[{source:"ical",ok:true,error:null}],
    counts:{fresh:1,total:1},agendaDocuments:[],meetings:[{id:"ical:one",bodyId:BODY,ocdId:PLACE,bodyName:"Council",title:"Council meeting",
      startsAt:"2026-11-02T19:00:00Z",timeZone:"UTC",location:null,jurisdiction:"Local",status:"SCHEDULED",provenance:{sourceUrl:url,sourceOrg:"Example",collectedAt:AT,verifiedAt:AT}}]};
  await db.publish({id:"calendar-1",value,at:AT,recordClass:"MEETING",scope,sourceId:"ical"});
  await enqueueReaderPlaces({places:[PLACE]},db.query);
  assert.equal((await rebuildPlacePages({db,purge,limit:20,concurrency:1})).failed,0);
  const before=await db.query("SELECT place_id,context,version,stale_at FROM place_page ORDER BY place_id");
  for(const hour of [1,2]){
    const at=new Date(Date.parse(AT)+hour*3_600_000).toISOString();
    const built=buildUnchangedConfirmation({sourceId:"ical",recordClass:"MEETING",scope,pointerVersionId:"calendar-1",readModelHash:canonicalCivicDataHash(value),
      parserVersion:"metadata-test",basis:"READ_MODEL_RECOMPUTED",retrieval:{requestedUrl:url,finalUrl:url,httpStatus:200,rawHash:"a".repeat(64),retrievedAt:at}},`MEETING:${scope}`,at);
    assert.ok(built.ok);
    await db.query("INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES('calendar-1',$1,'PROMOTED',$2,$3)",[4+hour,at,serializeUnchangedConfirmation(built.confirmation)]);
    const page=await readPlacePackage({state:"AZ",divisionIds:[PLACE],bodyFactsOnly:true},db.query);
    assert.equal(page.snapshot.generatedAt,at);assert.equal(page.meetings[0]!.provenance.collectedAt,at);
    assert.deepEqual(await db.query("SELECT place_id,context,version,stale_at FROM place_page ORDER BY place_id"),before);
  }
});
