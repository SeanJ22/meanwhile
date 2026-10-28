import test from "node:test";
import assert from "node:assert/strict";
import { publishedBodyLabel } from "../lib/civic-data/published-body-name.ts";
import { ensureEntity } from "../lib/facts/entities.ts";
import { foldPortalBodyLabels } from "../lib/facts/portal-publication.ts";
import { resolveId } from "../lib/core/resolve.ts";
import { factDb } from "./helpers/fact-db.ts";

test("calendar selectors keep the printed body and reject notice and test identities", () => {
  for (const name of ["Planning and Zoning Commission Special Meeting", "Planning and Zoning Commission Executive Session and Regular Meeting"])
    assert.deepEqual(publishedBodyLabel(name),{kind:"meeting",name:"Planning and Zoning Commission"});
  assert.deepEqual(publishedBodyLabel("Board of Directors Workshop on Audit"),{kind:"meeting",name:"Board of Directors"});
  assert.deepEqual(publishedBodyLabel("Board of Supervisors Addendum"),{kind:"meeting",name:"Board of Supervisors"});
  assert.deepEqual(publishedBodyLabel("Special Meeting of the Facilities Committee"),{kind:"meeting",name:"Facilities Committee"});
  for(const name of ["Public Notice","Notice of Quorum","Public Notice under the Open Meetings Act"]) assert.equal(publishedBodyLabel(name).kind,"notice");
  for(const name of ["Test 1","SYSTEM TEST 145","Audio Testing","Test Open Meetings Act Committee"]) assert.equal(publishedBodyLabel(name).kind,"test");
  for(const name of ["Town Meeting","FPC TESTING AND RECRUITING COMMITTEE","KC AD HOC Open Meetings Act","Open Meetings Advisory Committee","Public Meetings Commission"])
    assert.equal(publishedBodyLabel(name).kind,"body");
});

test("every writer reuses the real body; held meetings and evidence survive a label fold",async()=>{
  const db=await factDb();
  const place="ocd-division/country:us/state:az/place:mesa", board=`${place}#governing`, planning=`${place}#body:planning-and-zoning-commission`;
  try {
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Mesa','AZ',NULL),($2,'body','City Council','AZ',$1),($3,'body','Planning and Zoning Commission','AZ',$1)",[place,board,planning]);
    const original=`${place}#body:planning-and-zoning-commission-special-meeting`;
    assert.equal(await ensureEntity(db.query,{id:original,kind:"body",name:"Planning and Zoning Commission Special Meeting",state:"AZ",parentId:place}),planning);
    for(const [tail,name] of [["special-meeting","Special Meeting"],["notice","Notice of Quorum"],["test","Test 1"]]) {
      const id=`${place}#body:${tail}`;
      await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'body',$2,'AZ',$3),($4,'meeting','Sitting','AZ',$1)",[id,name,place,`meeting:${tail}`]);
    }
    await db.query("INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key) VALUES('https://mesa.example.gov/calendar','https://mesa.example.gov/calendar',now(),$1,'artifact:calendar-fingerprint')",['a'.repeat(64)]);
    await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES($1,'member:person-1','{}','Council member','live','OFFICIAL',1,'Council member',now(),'calendar'),
      ($1,'name','"Special Meeting"','Special Meeting','live','OFFICIAL',1,'Special Meeting',now(),'calendar')`,[`${place}#body:special-meeting`]);
    const before=await db.query("SELECT id FROM entity WHERE kind='meeting' ORDER BY id");
    const report=await foldPortalBodyLabels(db,"AZ",async()=>({purged:true}));
    assert.equal(report.before,3);assert.equal(report.folded,3);assert.equal(report.meetings,3);assert.deepEqual(report.unresolved,[]);
    assert.deepEqual(await db.query("SELECT id FROM entity WHERE kind='meeting' ORDER BY id"),before);
    assert.equal((await db.query("SELECT count(*) AS n FROM entity m JOIN entity b ON b.id=m.parent_id WHERE m.kind='meeting' AND b.kind='body' AND b.id=$1",[board]))[0]?.n,3);
    assert.equal(await resolveId(`${place}#body:notice`,db.query),board,"even a held original entity resolves through its alias");
    assert.equal(await ensureEntity(db.query,{id:original,kind:"body",name:"Planning and Zoning Commission Special Meeting",state:"AZ",parentId:place}),planning);
    assert.deepEqual(await db.query("SELECT entity_id,field,status,source_copy_id FROM fact ORDER BY id"),[
      {entity_id:board,field:'member:person-1',status:'live',source_copy_id:1},
      {entity_id:board,field:'name',status:'superseded',source_copy_id:1},
    ]);
    assert.equal((await db.query("SELECT count(*) AS n FROM source_copy"))[0]?.n,1,"reconciliation neither downloads nor copies a source");
    assert.equal((await foldPortalBodyLabels(db,"AZ",async()=>({purged:true}))).folded,0,"a second pass changes nothing");
  }finally{await db.pg.close();}
});

test("a named sitting remains publishable before its government is held", async () => {
  const db = await factDb();
  try {
    const id = "ocd-division/country:us/state:az/county:pima#body:study-session";
    assert.equal(await ensureEntity(db.query, { id, kind: "body", name: "Board of Supervisors Study Session", state: "AZ", parentId: "missing" }), id);
    assert.deepEqual(await db.query("SELECT name FROM entity WHERE id=$1", [id]), [{ name: "Board of Supervisors" }]);
  } finally { await db.pg.close(); }
});

test("a sitting is not assigned arbitrarily when two bodies share its name", async () => {
  const db = await factDb();
  const place = "ocd-division/country:us/state:az/place:example";
  try {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Planning Commission','AZ'),($2,'body','Planning Commission','AZ')", [`${place}#one`, `${place}#two`]);
    const id = `${place}#session`;
    assert.equal(await ensureEntity(db.query, { id, kind: "body", name: "Planning Commission Study Session", state: "AZ", parentId: null }), id);
    assert.deepEqual(await db.query("SELECT entity_id FROM entity_external_id WHERE scheme='body-alias' AND value=$1", [id]), []);
  } finally { await db.pg.close(); }
});
