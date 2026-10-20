import test from 'node:test';
import assert from 'node:assert/strict';
import {factDb} from './helpers/hunters-db.ts';
import {readScopedBank} from '../lib/hunt/place-bank.ts';
import {ensureEntity} from '../lib/facts/entities.ts';

test('a native hunter reads its canonical place and native facts without neighboring bodies',async()=>{
 const db=await factDb();
 try{
  const place='ocd-division/country:us/state:az/place:example',government='az:city:example',body=government+'#governing';
  for(const e of [{id:place,kind:'place',name:'Example',parentId:null},{id:government,kind:'government',name:'Example',parentId:place},{id:body,kind:'body',name:'City Council',parentId:government},{id:'az:city:elsewhere',kind:'government',name:'Elsewhere',parentId:null},{id:'az:city:elsewhere#governing',kind:'body',name:'Other Body',parentId:'az:city:elsewhere'}])await ensureEntity(db.query,{...e,state:'AZ'} as never);
  const [copy]=await db.query(`INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key) VALUES('https://example.gov/council','https://example.gov/council',now(),$1,'fixture') RETURNING id`,['a'.repeat(64)]);
  for(const [id,name] of [[body,'City Council'],['az:city:elsewhere#governing','Other Body']])await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by) VALUES($1,'name',$2::jsonb,$3,'live','OFFICIAL',$4,$3,now(),now(),'fixture')`,[id,JSON.stringify(name),name,copy.id]);
  let bytes=0;
  const query:typeof db.query=async(text,params)=>{const rows=await db.query(text,params);bytes+=Buffer.byteLength(JSON.stringify(rows));return rows;};
  const capture=await readScopedBank(query,[government],'AZ');
  assert.ok(capture.subjects.some(s=>s.kind==='body' && s.id===body));
  assert.ok(capture.held.some(f=>f.subjectId===body && f.checklistId==='GOV-02' && f.value==='City Council'));
  assert.ok(!JSON.stringify(capture).includes('Other Body'));
  assert.ok(capture.subjects.every(s=>s.divisionIds.includes(government)));
  assert.ok(bytes<10000);
  await assert.rejects(readScopedBank(query,[government],'NH'),/HUNT_BANK_CROSS_STATE/);
 }finally{await db.pg.close();}
});
