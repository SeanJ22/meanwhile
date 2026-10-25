import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { PORTRAIT_PEOPLE_SQL, PORTRAIT_CAPTURES_SQL } from "../lib/civic-data/portrait-inputs.ts";

const AT="2026-10-25T12:00:00.000Z",hash="a".repeat(64);
function person(id:string,at=AT) {
  return {id,personId:id,name:id,officeTitle:"Senator",level:"STATE",state:"AZ",nativeIds:{openstates:[id]},
    profileUrls:["https://legislature.example.gov/"+id],websiteUrl:null,
    provenance:{sourceUrl:"https://source.example.gov/roster",sourceOrg:"source.example.gov",collectedAt:"2026-10-01",verifiedAt:null},
    photo:{url:"/api/portraits/officials/"+hash+".png",sourceUrl:"https://legislature.example.gov/"+id+".png",
      verification:{personId:id,name:id,imageHash:"sha256-"+hash,sourceImageHash:"sha256-"+hash,
        imageUrl:"https://legislature.example.gov/"+id+".png",checkedAt:at,basis:"OWN_PAGE",
        attribution:{name:id,sourceUrl:"https://legislature.example.gov/"+id},sources:[{url:"https://legislature.example.gov/"+id,
          vaultKey:"project/freshness/source/photo",contentHash:"sha256-"+hash,retrievedAt:AT}]}}};
}
async function database(){
  const db=new PGlite();
  await db.exec(`CREATE TABLE civic_data_promotions(scope text,source_id text,record_class text,payload jsonb);
    CREATE TABLE civic_data_candidates(id text,candidate jsonb);
    CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);
    CREATE TABLE entity(id text,kind text,state text);
    CREATE TABLE entity_external_id(entity_id text,scheme text,value text);
    CREATE TABLE source_copy(id text,url text);
    CREATE TABLE fact(entity_id text,field text,value jsonb,status text,source_copy_id text,checked_at timestamptz);`);
  return db;
}
test("Postgres selects only changed, missing and due people, including encoded array groups and held people",async()=>{
  const db=await database();try{
    const current=person("current"),changed={...person("changed"),name:"New name"},missing={...person("missing"),photo:null};
    const due=person("due","2026-10-18T12:00:00.000Z"),held=person("held","2026-10-17T12:00:00.000Z");
    const original=[current,person("changed"),{...person("missing"),photo:null},due,held];
    const encoded=partitionCivicPayload({roster:{officeholders:[current,changed,missing,due],unrelated:"never-transfer".repeat(20000)}});
    for(const part of encoded.parts)await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4),($5,$6,$3,$7),($8,$2,$3,$9)",[
      "US-AZ:openstates-people:v1","plural-openstates","STATE_LEGISLATOR",encoded.value,
      "US-AZ:people:portraits:v1","people-portraits",{roster:{officeholders:original}},
      "US-WY:openstates-people:v1",{roster:{officeholders:[person("other-state")]}}]);
    const rows=await db.query<{node:ReturnType<typeof person>}>(PORTRAIT_PEOPLE_SQL,["US-AZ",AT,null]);
    assert.deepEqual(rows.rows.map(row=>row.node.id).sort(),["changed","due","held","missing"]);
    assert.ok(!JSON.stringify(rows.rows).includes("never-transfer"));
    const before=await db.query<{node:{id:string}}>(PORTRAIT_PEOPLE_SQL,["US-AZ","2026-10-25T11:59:59.999Z",null]);
    assert.ok(!before.rows.some(row=>row.node.id==="due"),"the exact seven-day boundary follows the configured clock");
  }finally{await db.close();}
});
test("capture projection returns hashes first and only requested changed capture metadata",async()=>{
  const db=await database();try{
    const captures=[{finalUrl:"https://source.example.org/one",capture:{rawHash:hash}},{finalUrl:"https://source.example.org/two",capture:{rawHash:"b".repeat(64)}}];
    const encoded=partitionCivicPayload({normalizedPayload:{captures,unrelated:"never-transfer".repeat(20000)}});
    for(const part of encoded.parts)await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
    await db.query("INSERT INTO civic_data_candidates VALUES('old',$1)",[encoded.value]);
    const versions=await db.query<{hash:string;node:null}>(PORTRAIT_CAPTURES_SQL,[["old"],[captures[0].finalUrl],true,null,false]);
    assert.equal(versions.rows.length,1);assert.equal(versions.rows[0].node,null);
    const rows=await db.query<{node:unknown}>(PORTRAIT_CAPTURES_SQL,[["old"],[captures[0].finalUrl],false,[versions.rows[0].hash],false]);
    assert.deepEqual(rows.rows.map(row=>row.node),[captures[0]]);
    assert.ok(!JSON.stringify(rows.rows).includes("never-transfer"));
  }finally{await db.close();}
});

test("live local members keep their state scope and null-office fallback, including registered bodies without an entity state",async()=>{
  const db=await database();try{
    await db.exec(`INSERT INTO entity VALUES('body','body',NULL),('foreign','body','WY');
      INSERT INTO source_copy VALUES('source','https://council.example.gov/members');
      INSERT INTO fact VALUES('body','member:person','{"name":"Local Member","office":null}','live','source','2026-10-20T12:00:00Z'),
        ('foreign','member:other','{"name":"Other state"}','live','source','2026-10-20T12:00:00Z');`);
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4)",[
      "US-AZ:reader-registry-runtime","runtime","REGISTRY_RUNTIME_BINDING",{registry:{bodies:[{id:"body"}]},bodyRosters:[]}]);
    const first=await db.query<{node:Record<string,unknown>}>(PORTRAIT_PEOPLE_SQL,["US-AZ",AT,null]);
    assert.equal(first.rows.length,1);
    const local=first.rows[0].node;
    assert.equal(local.personId,"person");assert.equal(local.name,"Local Member");assert.equal(local.officeTitle,"Member");
    assert.equal(local.state,"AZ");
    const photo=person("person").photo;
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4)",[
      "US-AZ:people:portraits:v1","people-portraits","STATE_LEGISLATOR",{roster:{officeholders:[{...local,photo}]}}]);
    const next=await db.query(PORTRAIT_PEOPLE_SQL,["US-AZ",AT,null]);
    assert.equal(next.rows.length,0,"a current local portrait is not made due by missing versus null optional fields");
  }finally{await db.close();}
});

test("an encoded body's metadata follows only its changed member across the wire",async()=>{
  const db=await database();try{
    const member={...person("local"),level:"LOCAL",photo:null};
    const payload={registry:{bodies:[]},bodyRosters:[{bodyId:"body",sourceUrl:"https://council.example.gov/roster",sourceOrg:"Council",
      collectedAt:"2026-10-20",unused:"unrelated-body-material".repeat(10000),members:[member]}]};
    const encoded=partitionCivicPayload(payload);
    for(const part of encoded.parts)await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4)",[
      "US-AZ:reader-registry-runtime","runtime","REGISTRY_RUNTIME_BINDING",encoded.value]);
    const rows=await db.query<{node:{provenance:{sourceUrl:string}}}>(PORTRAIT_PEOPLE_SQL,["US-AZ",AT,null]);
    assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].node.provenance.sourceUrl,payload.bodyRosters[0].sourceUrl);
    assert.ok(!JSON.stringify(rows.rows).includes("unrelated-body-material"));
  }finally{await db.close();}
});

test("complementary native IDs and source name aliases do not restart a current portrait; an owned name change selects the same canonical person",async()=>{
  const db=await database();try{
    const reference={...person("primary"),name:"Jane Reference",photo:null};
    const official={...person("official"),personId:"official",name:"Jane Official",photo:null,
      nativeIds:{openstates:["primary"]},provenance:{...reference.provenance,sourceUrl:"https://legislature.example.gov/official"}};
    const held={...person("primary"),name:official.name,provenance:official.provenance,
      nativeIds:{openstates:["primary"],reader:["primary","official"]},profileUrls:[...reference.profileUrls,...official.profileUrls]};
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4),($5,$6,$3,$7),($8,$9,$3,$10)",[
      "US-AZ:openstates-people:v1","plural-openstates","STATE_LEGISLATOR",{roster:{officeholders:[reference]}},
      "US-AZ:official","official-state-people",{roster:{officeholders:[official]}},
      "US-AZ:people:portraits:v1","people-portraits",{roster:{officeholders:[held]}}]);
    const current=await db.query(PORTRAIT_PEOPLE_SQL,["US-AZ",AT,null]);
    assert.equal(current.rows.length,0);
    await db.query("UPDATE civic_data_promotions SET payload=jsonb_set(payload,'{roster,officeholders,0,name}','\"Jane Changed\"') WHERE scope='US-AZ:official'");
    const changed=await db.query<{node:{personId:string}}>(PORTRAIT_PEOPLE_SQL,["US-AZ",AT,null]);
    assert.equal(changed.rows.length,2);assert.ok(changed.rows.every(row=>row.node.personId==="primary"));
  }finally{await db.close();}
});
