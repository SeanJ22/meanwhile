import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { factDb } from "./helpers/fact-db.ts";
import { door } from "../lib/core/door.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { openBlank, restampFacts } from "../lib/facts/publish.ts";
import { confirmFactSource, recordFactConfirmation, withFactConfirmations } from "../lib/facts/confirmation.ts";
import { campaignFinanceSource } from "../lib/funding/state-sources.ts";
import { campaignSourceRecord } from "../lib/funding/state-source-records.ts";
import { fileCampaignMoneyFacts } from "../lib/funding/state-facts.ts";
import { rebuildCampaignCycles } from "../lib/funding/state-cycles.ts";

const at = "2026-10-26T10:00:00.000Z";
const later = (hour: number) => new Date(Date.parse(at)+hour*3_600_000).toISOString();
const purge = async () => ({purged:true});
const clocks = factClocks(null);

async function countedDb() {
  const db = await factDb();
  await db.pg.exec(`CREATE TABLE updated_rows(table_name text PRIMARY KEY,n integer DEFAULT 0);
    INSERT INTO updated_rows(table_name) VALUES('fact'),('entity'),('blank');
    CREATE FUNCTION count_updated_rows() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      UPDATE updated_rows SET n=n+1 WHERE table_name=TG_TABLE_NAME; RETURN NEW; END $$;
    CREATE TRIGGER count_fact_updates AFTER UPDATE ON fact FOR EACH ROW EXECUTE FUNCTION count_updated_rows();
    CREATE TRIGGER count_entity_updates AFTER UPDATE ON entity FOR EACH ROW EXECUTE FUNCTION count_updated_rows();
    CREATE TRIGGER count_blank_updates AFTER UPDATE ON blank FOR EACH ROW EXECUTE FUNCTION count_updated_rows();`);
  return db;
}
const updates = async (db: Awaited<ReturnType<typeof countedDb>>) => db.query("SELECT table_name,n FROM updated_rows ORDER BY table_name");
const zero = [{table_name:"blank",n:0},{table_name:"entity",n:0},{table_name:"fact",n:0}];

test("the door compares fingerprints without returning the held value, including corrections to null", async t=>{
  const db=await countedDb();t.after(()=>db.pg.close());
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES('body','body','Example Council','KY')");
  await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://example.gov','https://example.gov',$1,$2,'source')",[at,"a".repeat(64)]);
  const heads:unknown[]=[];
  const observed={...db,transaction:<T>(work:Parameters<typeof db.transaction<T>>[0])=>db.transaction(query=>work(async(text,params)=>{
    const rows=await query(text,params);if(text.includes("WITH head AS MATERIALIZED"))heads.push(...rows);return rows;
  }))};
  const input={subjectId:"body",field:"large_value",fieldKind:"contact" as const,value:{a:"x".repeat(100_000),b:2},valueText:"value",quote:"",
    provenance:"OFFICIAL" as const,producedBy:"wr-01",costUsd:0,copy:{id:1,finalUrl:"https://example.gov",fetchedAt:new Date(at),isArchive:false,text:""}};
  assert.equal((await door(observed,input,clocks,new Date(at),{purge}) as {decision:string}).decision,"PUBLISH");
  assert.equal((await door(observed,{...input,value:{b:2,a:input.value.a}},clocks,new Date(at),{purge}) as {decision:string}).decision,"CONFIRM");
  assert.ok(Buffer.byteLength(JSON.stringify(heads))<1500,"the held record never crosses the database connection");
  assert.equal((await door(observed,{...input,value:null,copy:{...input.copy,fetchedAt:new Date(later(1))}},clocks,new Date(later(1)),{purge}) as {decision:string}).decision,"PUBLISH");
});

async function seed(db: Awaited<ReturnType<typeof countedDb>>) {
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES('body','body','Example Council','KY')");
  await db.query(`INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key)
    SELECT id,'https://example.gov','https://example.gov',$1,$2,'source-'||id FROM generate_series(1,4) id`,[at,"a".repeat(64)]);
  for (const field of ["office_phone","office_email"]) await door(db,{subjectId:"body",field,fieldKind:"contact",value:field,valueText:field,
    quote:"",provenance:"OFFICIAL",producedBy:"wr-01",costUsd:0,
    copy:{id:1,finalUrl:"https://example.gov",fetchedAt:new Date(at),isArchive:false,text:""}},clocks,new Date(at),{purge});
  return (await db.query("SELECT id,entity_id,field FROM fact ORDER BY id")).map(row=>({id:Number(row.id),entityId:String(row.entity_id),field:String(row.field),quote:""}));
}

test("two later source checks advance reader dates and receipts with zero fact, entity or unchanged blank updates",async t=>{
  const db=await countedDb();t.after(()=>db.pg.close());
  const facts=await seed(db);
  const blank={entityId:"body",field:"missing",stage:"ACQUIRE" as const,reason:"NOT_FOUND",retryMinutes:60};
  await openBlank(db.query,blank);
  const stored=await db.query("SELECT id,checked_at,source_copy_id,quote_start FROM fact ORDER BY id");
  await db.query("UPDATE updated_rows SET n=0");
  for(const hour of [1,2]){
    assert.equal(await restampFacts(db,facts,{id:hour+1,text:"",fetchedAt:new Date(later(hour))}),2);
    await openBlank(db.query,blank);
    await db.query("UPDATE entity SET name=name WHERE id='body'");
    assert.deepEqual(await updates(db),zero);
    assert.deepEqual(await db.query("SELECT id,checked_at,source_copy_id,quote_start FROM fact ORDER BY id"),stored);
    const effective=await db.query("SELECT checked_at,source_copy_id FROM checked_fact ORDER BY id");
    assert.ok(effective.every(row=>new Date(row.checked_at as string).toISOString()===later(hour)&&Number(row.source_copy_id)===hour+1));
    assert.equal(await restampFacts(db,facts,{id:hour+1,text:"",fetchedAt:new Date(later(hour))}),0);
  }
  await openBlank(db.query,{...blank,reason:"SOURCE_UNAVAILABLE"});
  assert.deepEqual((await updates(db))[0],{table_name:"blank",n:1});
});

test("a saved-copy scope is batched once and a later partial confirmation cannot advance another fact's date",async t=>{
  const db=await countedDb();t.after(()=>db.pg.close());const facts=await seed(db);
  await withFactConfirmations(db,async()=>{
    for(const fact of facts)await confirmFactSource(db,{copyId:2,scope:"roster:body",at:later(1),factIds:[fact.id]},purge);
  },purge);
  assert.deepEqual(await db.query("SELECT count(*)::int AS n,cardinality(max(fact_ids)) AS facts FROM fact_confirmation"),[{n:1,facts:2}]);
  await db.transaction(query=>recordFactConfirmation(query,{copyId:2,scope:"roster:body",at:later(2),factIds:[facts[0].id]}));
  assert.deepEqual((await db.query("SELECT checked_at FROM checked_fact ORDER BY id")).map(row=>new Date(row.checked_at as string).toISOString()),[later(2),later(1)]);
  await db.transaction(query=>recordFactConfirmation(query,{copyId:3,scope:"roster:body",at:later(1),factIds:[facts[0].id]}));
  assert.equal(new Date((await db.query("SELECT checked_at FROM checked_fact WHERE id=$1",[facts[0].id]))[0].checked_at as string).toISOString(),later(2));
});

test("sparse confirmation buckets use one query and preserve each bucket's partial dates",async t=>{
  const db=await countedDb();t.after(()=>db.pg.close());const facts=await seed(db);
  await db.query("UPDATE fact SET id=500000 WHERE id=$1",[facts[1].id]);
  let saves=0;
  await db.transaction(query=>recordFactConfirmation(async(text,params)=>{if(text.includes('WITH eligible AS MATERIALIZED'))saves++;return query(text,params);},
    {copyId:2,scope:'sparse',at:later(1),factIds:[facts[0].id,500000]}));
  assert.equal(saves,1);
  assert.equal((await db.query('SELECT scope FROM fact_confirmation')).length,2);
  await db.transaction(query=>recordFactConfirmation(query,{copyId:2,scope:'sparse',at:later(2),factIds:[facts[0].id]}));
  assert.deepEqual((await db.query('SELECT checked_at FROM checked_fact ORDER BY id')).map(row=>new Date(row.checked_at as string).toISOString()),[later(2),later(1)]);
});

test("Kentucky counts cross-export transactions once, preserves within-export repeats and never reinserts donors for confirmation order",async t=>{
  const db=await countedDb();t.after(()=>db.pg.close());
  const source=campaignFinanceSource("KY").resources[0];
  const [native]=JSON.parse(readFileSync(new URL("./fixtures/campaign-finance/ky-native-contributions.json",import.meta.url),"utf8"));
  const person={id:"kentucky-person",name:"Example Candidate",seat:"ocd-division/country:us/state:ky/sldl:1#representative",sourceUrl:"https://legislature.ky.gov"};
  const make=(election:string,label:string,amount:number,ordinal:number)=>{
    const url=`https://secure.kentucky.gov/kref/publicsearch/ExportContributors?ElectionDate=${election}`;
    const row=campaignSourceRecord("KY",source,{...native,"Recipient First Name":"Example","Recipient Last Name":"Candidate",
      "Office Sought":"STATE REPRESENTATIVE","Location":"1ST DISTRICT","Election Date":election,"Election Type":label,
      "Statement Type":label,"Contribution Type":"INDIVIDUAL","Contributor First Name":"Example","Contributor Last Name":"Donor",
      "Address 1":"Fixture identity","City":"Frankfort","State":"KY","Zip":"40601","Receipt Date":"7/1/2026","Amount":String(amount)},
      {url,rawHash:(label==="PRIMARY"?"a":"b").repeat(64),vaultKey:label,byteLength:10,retrievedAt:at,publicationDate:null});
    return {...row,id:`${row.id}:${ordinal}`,person,unjoinedReason:null,cycle:2026};
  };
  const may=[make("5/19/2026","PRIMARY",150,1),make("5/19/2026","PRIMARY",150,2)];
  const november=[make("11/3/2026","GENERAL",150,1),make("11/3/2026","GENERAL",200,1)];
  await fileCampaignMoneyFacts(db,"KY",[...may,...november],at,{purge});
  await rebuildCampaignCycles(db,"KY",[person.id],at,purge);
  let temporaryTables=0;
  const observed={...db,transaction:<T>(work:Parameters<typeof db.transaction<T>>[0])=>db.transaction(query=>work(async(sql,params)=>{
    if(sql.includes("CREATE TEMP TABLE"))temporaryTables++;
    return query(sql,params);
  }))};
  await rebuildCampaignCycles(observed,"KY",[person.id],at,purge);
  assert.equal(temporaryTables,0,"an unchanged rebuild stops on its fingerprint before creating temporary rows");
  const before=await db.query("SELECT id,field,value->>'amount' AS amount FROM fact WHERE field LIKE 'campaign-donor:%' AND status='live'");
  assert.equal(before.length,1);assert.equal(before[0].amount,"500");
  assert.equal(Number((await db.query("SELECT value#>>'{totals,0,amount}' AS amount FROM fact WHERE field LIKE 'campaign-cycle:%' AND status='live'"))[0].amount),500);
  await db.query("UPDATE updated_rows SET n=0");
  for(const hour of [1,2]){
    for(const rows of hour===1?[may,november]:[november,may]){
      assert.deepEqual(await fileCampaignMoneyFacts(db,"KY",rows,later(hour),{purge}),{written:0,confirmed:2});
      await rebuildCampaignCycles(db,"KY",[person.id],later(hour),purge);
    }
    assert.deepEqual(await updates(db),zero);
    assert.deepEqual(await db.query("SELECT id,field,value->>'amount' AS amount FROM fact WHERE field LIKE 'campaign-donor:%' AND status='live'"),before);
    assert.deepEqual(await db.query("SELECT count(*)::int AS n FROM fact WHERE field LIKE 'campaign-donor:%'"),[{n:1}]);
  }
  const changed={...november[1],amounts:[{label:"Receipts",amount:250}],donor:{...november[1].donor!,amount:250}};
  await fileCampaignMoneyFacts(db,"KY",[changed],later(3),{purge});await rebuildCampaignCycles(db,"KY",[person.id],later(3),purge);
  assert.equal(Number((await db.query("SELECT value->>'amount' AS amount FROM fact WHERE field LIKE 'campaign-donor:%' AND status='live'"))[0].amount),550);
  await db.query("UPDATE fact SET status='superseded' WHERE field LIKE 'campaign-donor:%' AND status='live'");
  await rebuildCampaignCycles(db,"KY",[person.id],later(3),purge);
  assert.equal(Number((await db.query("SELECT value->>'amount' AS amount FROM fact WHERE field LIKE 'campaign-donor:%' AND status='live'"))[0].amount),550,
    "a changed published result invalidates the fingerprint and is rebuilt");
});

test("later page checks retain a confirmation's quote, display text and source rank",async t=>{
  const db=await countedDb();t.after(()=>db.pg.close());const [fact]=await seed(db);
  await db.transaction(query=>recordFactConfirmation(query,{copyId:2,scope:"door",at:later(1),factIds:[fact.id],
    receipts:{[fact.id]:{quote:"New source quote",value_text:"Source display text",quote_start:12,provenance_kind:"FILING"}}}));
  await restampFacts(db,[{...fact,quote:"New source quote"}],{id:3,text:"New source quote",fetchedAt:new Date(later(2))});
  assert.deepEqual(await db.query("SELECT quote,value_text,quote_start,provenance_kind FROM checked_fact WHERE id=$1",[fact.id]),
    [{quote:"New source quote",value_text:"Source display text",quote_start:0,provenance_kind:"FILING"}]);
});

test("a correction made in place cannot inherit an earlier value's confirmation",async t=>{
  const db=await countedDb();t.after(()=>db.pg.close());const [fact]=await seed(db);
  await db.transaction(query=>recordFactConfirmation(query,{copyId:2,scope:"door",at:later(1),factIds:[fact.id],
    receipts:{[fact.id]:{value_text:"Previous display"}}}));
  await db.query("UPDATE fact SET value='\"corrected\"'::jsonb,value_text='Corrected display' WHERE id=$1",[fact.id]);
  assert.deepEqual(await db.query("SELECT value_text,source_copy_id FROM checked_fact WHERE id=$1",[fact.id]),[{value_text:"Corrected display",source_copy_id:1}]);
});
