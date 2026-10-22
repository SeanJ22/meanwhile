import test from "node:test";
import assert from "node:assert/strict";
import {factDb} from "./helpers/fact-db.ts";
import {flagReaderRecord,readOwnerFlags,resolveOwnerFlag,readerRecordsWithOwnerChoices,withOwnerValues} from "../lib/facts/owner-flags.ts";
import {publishClaim} from "../lib/facts/publish.ts";
import {factClocks} from "../lib/facts/clocks.ts";
const NOW="2026-10-20T06:45:00Z";
const record={id:"office-1",officeholderId:"person-1",office:{phone:"555-123-4567",address:"City Hall"},sourceUrl:"https://clerk.example.gov/"};
const fact={id:"member-offices:office-1",family:"member-offices",area:"AZ",record,sourceUrl:record.sourceUrl,verifiedAt:NOW};

test("a flag leaves the record live; all four owner choices persist and typed fields survive a source refresh",async()=>{
 const db=await factDb();
 try{
 for(const choice of ["KEEP","SEND_FLEET","TYPED_VALUE","REMOVE"] as const){
 await flagReaderRecord(db.query,fact,{reason:"The source's office phone differs."});
 const flags=await readOwnerFlags(db.query);assert.equal(flags.length,1);
 assert.deepEqual(await readerRecordsWithOwnerChoices(db.query,"member-offices",[record]),choice==='REMOVE'?[{...record,office:{...record.office,phone:"555-987-6543"},fieldSources:{'office.phone':{sourceUrl:"",sourceOrg:"Sean",collectedAt:new Date(NOW).toISOString(),verifiedAt:new Date(NOW).toISOString(),provenance:"OWNER"}}}]:[record]);
 await resolveOwnerFlag(db,{id:Number(flags[0].id),choice,...(choice==='TYPED_VALUE'?{values:{'office.phone':"555-987-6543"}}:{})},NOW);
 assert.deepEqual(await readOwnerFlags(db.query),[]);
 }
 assert.deepEqual(await readerRecordsWithOwnerChoices(db.query,"member-offices",[record]),[]);
 }finally{await db.pg.close();}
});

test("a scalar correction publishes as OWNER and a later official disagreement flags that live owner value",async()=>{
 const db=await factDb();
 try{
 await db.query("INSERT INTO entity(id,kind,name,state) VALUES('body','body','City Council','AZ')");
 await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://clerk.example.gov/','https://clerk.example.gov/',$1,$2,'saved')",[NOW,"a".repeat(64)]);
 await db.query("INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by) VALUES('body','phone','\"555-123-4567\"','555-123-4567','live','OFFICIAL',1,'555-123-4567',$1,$1,'test')",[NOW]);
 await flagReaderRecord(db.query,{...fact,id:"fact-store:1",family:"fact-store",record:{id:"1"}},{reason:"Check the phone."});
 await resolveOwnerFlag(db,{id:1,choice:"TYPED_VALUE",values:{value:"555-987-6543"}},NOW);
 const [current]=await db.query("SELECT id,value,provenance_kind FROM fact WHERE status='live'");
 assert.equal(current.value,"555-987-6543");assert.equal(current.provenance_kind,"OWNER");
 await publishClaim(db,{entity:{id:'body',fullName:'City Council',stateName:null,hosts:['clerk.example.gov'],externalIds:[]},field:'phone',fieldKind:'contact',provenance:'OFFICIAL',value:'555-000-1234',valueText:'555-000-1234',quote:'555-000-1234',copy:{id:1,finalUrl:record.sourceUrl,text:'City Council 555-000-1234',fetchedAt:new Date(NOW),isArchive:false},producedBy:'test',costUsd:0},factClocks(null),new Date(NOW));
 const open=await readOwnerFlags(db.query);assert.equal(open.length,1);assert.equal(open[0].factId,Number(current.id));
 assert.equal((await db.query("SELECT value FROM fact WHERE status='live'"))[0].value,'555-987-6543');
 }finally{await db.pg.close();}
});

test("owner corrections cannot change a record identity or a missing field",()=>{
 assert.throws(()=>withOwnerValues(record,{id:'other'}));
 assert.throws(()=>withOwnerValues(record,{'office.missing':'x'}));
 assert.throws(()=>withOwnerValues(record,{'__proto__.polluted':true}));
});

test('owner decisions reach the reader edge without a database call and concurrent answers keep both records',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {LocalFileArtifactStore}=await import('../lib/meetings/edge-store.ts');const {publishOwnerChoice}=await import('../lib/facts/owner-choices-edge.ts');
 const dir=await mkdtemp(join(tmpdir(),'ck01-owner-'));const prior=process.env.WTP_READER_EDGE_DIR;
 try{
 process.env.WTP_READER_EDGE_DIR=dir;const store=new LocalFileArtifactStore(dir);
 const one={...record,id:'member-office:nj-legislature:283:district'};const two={...record,id:'member-office:nj-legislature:155:district'};
 await Promise.all([publishOwnerChoice('member-offices',one,{id:1,resolvedAt:NOW,choice:'TYPED_VALUE',values:{'office.phone':'555-987-6543'},sourceUrl:null},store),
 publishOwnerChoice('member-offices',two,{id:2,resolvedAt:NOW,choice:'REMOVE',values:{},sourceUrl:null},store)]);
 const rows=await readerRecordsWithOwnerChoices(async()=>{throw Error('The edge must not read the database.');},'member-offices',[one,two]);
 assert.equal(rows.length,1);assert.equal(rows[0].office.phone,'555-987-6543');
 }finally{if(prior===undefined)delete process.env.WTP_READER_EDGE_DIR;else process.env.WTP_READER_EDGE_DIR=prior;await rm(dir,{recursive:true,force:true});}
});

test('an owner removal of the last record serves an empty edge projection',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {LocalFileArtifactStore}=await import('../lib/meetings/edge-store.ts');const {publishOwnerChoice}=await import('../lib/facts/owner-choices-edge.ts');
 const {primeCuratedReaderProjectionWithOwnerChoices,curatedReaderReadState}=await import('../lib/civic-data/curated-reader-read-model.ts');
 const dir=await mkdtemp(join(tmpdir(),'ck01-empty-'));const prior=process.env.WTP_READER_EDGE_DIR;
 try{
 process.env.WTP_READER_EDGE_DIR=dir;const row={id:'campaign-site:nj-legislature:283',officeholderId:'nj-legislature:283',site:{url:'https://campaign.example.com'}};
 await publishOwnerChoice('campaign-sites',row,{id:1,resolvedAt:NOW,choice:'REMOVE',values:{},sourceUrl:null},new LocalFileArtifactStore(dir));
 await primeCuratedReaderProjectionWithOwnerChoices('campaign-sites',{kind:'campaign-sites',records:[row]},'held-v1');
 const current=curatedReaderReadState('campaign-sites');assert.equal(current.kind,'BOOTSTRAP');if(current.kind==='BOOTSTRAP')assert.deepEqual(current.value.records,[]);
 }finally{if(prior===undefined)delete process.env.WTP_READER_EDGE_DIR;else process.env.WTP_READER_EDGE_DIR=prior;await rm(dir,{recursive:true,force:true});}
});

test('the deployed target constraint permits scalar and named reader flags and rejects an unnamed target',async()=>{
 const db=await factDb();
 try{
 await assert.rejects(db.query("INSERT INTO owner_flag(kind) VALUES('AUDIT_LOOKS_WRONG')"),/owner_flag_target/);
 await db.query("INSERT INTO owner_flag(kind,reader_family,reader_id) VALUES('AUDIT_LOOKS_WRONG','member-offices','office-1')");
 assert.equal((await readOwnerFlags(db.query)).length,1);
 }finally{await db.pg.close();}
});

test("a flagged board member is gone from the next live roster, the reader cache is purged, and the same source words do not put the member back",async()=>{
 const {MemoryEvidenceStore}=await import("../lib/control-plane/evidence/store.ts");
 const {publishLegistarMembers}=await import("../lib/sources/legistar/members-publication.ts");
 const {readFactRosters}=await import("../lib/facts/roster-read.ts");
 const {rawFor,wiring,storeMemberFixtures}=await import("./helpers/legistar-member-fixtures.ts");
 const db=await factDb();
 try{
 const raw=rawFor("pima"),rows=wiring(raw,"AZ","America/Phoenix"),vault=new MemoryEvidenceStore(),tags:string[][]=[];
 const purge=async(next:readonly string[])=>{tags.push([...next]);return{purged:true};};
 await storeMemberFixtures(vault,raw);
 const input={facts:db,vault,raw,rows,clocks:factClocks(null),now:"2026-10-13T20:00:00.000Z",purge};
 await publishLegistarMembers(input);
 const bodyIds=rows.map(row=>row.bodyId);
 const members=async()=>(await readFactRosters(db.query,bodyIds)).rosters.flatMap(roster=>roster.members.map(member=>member.name));
 const before=await members();assert.ok(before.length>1);
 const [target]=await db.query("SELECT id,entity_id,field FROM fact WHERE field LIKE 'member:%' AND status='live' ORDER BY id LIMIT 1");
 const [person]=await db.query("SELECT value->>'name' AS name FROM fact WHERE id=$1",[target.id]);
 await flagReaderRecord(db.query,{id:`fact-store:${target.id}`,family:"fact-store",area:"AZ",record:{id:String(target.id)},sourceUrl:"https://webapi.legistar.com/v1/pima/officerecords",verifiedAt:NOW},{reason:"Sean says this person does not sit on this board."});
 const [flag]=await readOwnerFlags(db.query);assert.equal(flag.factId,Number(target.id));
 assert.deepEqual(await members(),before,"a flag alone removes nothing");
 await resolveOwnerFlag(db,{id:Number(flag.id),choice:"REMOVE"},"2026-10-13T21:00:00.000Z",purge);
 const after=await members();assert.deepEqual(after,before.filter((name,index)=>!(name===person.name&&index===before.indexOf(name))));
 assert.ok(tags.some(list=>list.some(tag=>tag.startsWith("reader-state:"))),"readers are told the next version changed");
 await db.query("DELETE FROM fact_store_load");
 await publishLegistarMembers({...input,now:"2026-10-14T20:00:00.000Z"});
 assert.deepEqual(await members(),after,"the source repeating the removed value does not restore it");
 }finally{await db.pg.close();}
});

test("Sean finds a published fact by name, flags it himself, and Remove takes it down",async()=>{
 const {searchPublishedFacts,raiseOwnerFlag}=await import("../lib/facts/owner-flags.ts");
 const db=await factDb();
 try{
 await db.query("INSERT INTO entity(id,kind,name,state) VALUES('body','body','Maple City Council','AZ'),('person','person','Jordan Reyes','AZ')");
 await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://maple.example.gov/council','https://maple.example.gov/council',$1,$2,'saved')",[NOW,"b".repeat(64)]);
 await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by) VALUES
  ('body','member:person','{"name":"Jordan Reyes","office":"Council Member"}','Jordan Reyes','live','OFFICIAL',1,'Jordan Reyes',$1,$1,'t'),
  ('person','email','"j@maple.example.gov"','j@maple.example.gov','live','OFFICIAL',1,'j@maple.example.gov',$1,$1,'t')`,[NOW]);
 assert.deepEqual((await searchPublishedFacts(db.query,"jo")).matches,[]);
 const {matches}=await searchPublishedFacts(db.query,"jordan reyes");
 assert.deepEqual(matches.map(row=>[row.title,row.what,row.value,row.flagged]),[["Jordan Reyes","Email","j@maple.example.gov",false],["Maple City Council","Seat on Maple City Council","Jordan Reyes, Council Member",false]]);
 assert.deepEqual(await raiseOwnerFlag(db.query,matches[1].factId),{created:true});
 assert.deepEqual(await raiseOwnerFlag(db.query,matches[1].factId),{created:false},"a fact is flagged once");
 assert.equal((await searchPublishedFacts(db.query,"%")).matches.length,0);
 const [flag]=await readOwnerFlags(db.query);assert.equal(flag.factId,matches[1].factId);
 await resolveOwnerFlag(db,{id:Number(flag.id),choice:"REMOVE"},NOW,async()=>({purged:true}));
 assert.deepEqual((await searchPublishedFacts(db.query,"jordan reyes")).matches.map(row=>row.what),["Email"]);
 }finally{await db.pg.close();}
});

test("with NETLIFY_SITE_ID set and no Netlify runtime, records come back with the database's owner choices and nothing throws",async()=>{
 const keys=["NETLIFY","NETLIFY_BLOBS_CONTEXT","NETLIFY_SITE_ID","NETLIFY_BLOBS_SITE_ID","NETLIFY_BLOBS_TOKEN","NETLIFY_API_TOKEN","WTP_READER_EDGE_DIR"] as const;
 const prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 const db=await factDb();
 try{
 for(const key of keys)delete process.env[key];
 const other={...record,id:"office-2"};
 await flagReaderRecord(db.query,fact,{reason:"The source's office phone differs."});
 const [flag]=await readOwnerFlags(db.query);
 await resolveOwnerFlag(db,{id:Number(flag.id),choice:"TYPED_VALUE",values:{"office.phone":"555-987-6543"}},NOW);
 process.env.NETLIFY_SITE_ID="runner-site-without-credentials";
 const rows=await readerRecordsWithOwnerChoices(db.query,"member-offices",[record,other]);
 assert.equal(rows.length,2);
 assert.equal(rows[0].office.phone,"555-987-6543","the database's typed value is applied");
 assert.equal(rows[1].office.phone,record.office.phone);
 }finally{
  for(const key of keys){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}
  await db.pg.close();
 }
});
