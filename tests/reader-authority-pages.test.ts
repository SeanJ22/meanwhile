import assert from "node:assert/strict";
import test from "node:test";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { buildMissingPlacePages,buildPageBody,storePlacePage } from "../lib/reader/place-builder.ts";
import { readCanonicalShelf } from "../lib/reader/canonical.ts";
import type { Query } from "../lib/facts/publish.ts";
import {unpackPlaceContextRow} from "../lib/reader/place-ready.ts";

test('adding a requested section preserves the other saved sections and never recompiles their sources',async()=>{
  const {pg,publish}=await migratedReaderDb(),id='ocd-division/country:us/state:az/place:extra';
  const query:Query=async(text,params=[])=>(await pg.query<Record<string,unknown>>(text,[...params])).rows;
  try{
    await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Extra','AZ')",[id]);
    await storePlacePage(query,id,await buildPageBody(id,'place','AZ',query));
    const scopes=['US-AZ:detail:one','US-AZ:detail:two'];
    for(const scope of scopes)await publish({id:scope,recordClass:'CURATED_READER_RECORD',scope,sourceId:'official',at:'2026-10-28T00:00:00.000Z',value:{records:[{id:scope,ocdId:id,text:'sourced detail'}]}});
    const reads:string[]=[];
    const tracked:Query=async(text,params=[])=>{if(text.includes('civic_data_promotions')){reads.push(text);assert.deepEqual(params[0],['CURATED_READER_RECORD:'+scopes[reads.length-1]]);}return query(text,params);};
    const db={transaction:<T>(work:(q:Query)=>Promise<T>)=>work(tracked)};
    for(const scope of scopes)await buildMissingPlacePages([{id,kind:'place',state:'AZ',authorities:true,authorityKeys:['CURATED_READER_RECORD:'+scope]}],db);
    const [saved]=await query("SELECT context->'authorities' AS sections,context->'authorityKeys' AS keys FROM place_page WHERE place_id=$1",[id]);
    for(const scope of scopes){const key='CURATED_READER_RECORD:'+scope;assert.ok((saved.keys as string[]).includes(key));
      assert.deepEqual(unpackPlaceContextRow((saved.sections as Record<string,{payload:unknown}>)[key].payload),{records:[{id:scope,ocdId:id,text:'sourced detail'}]});}
    assert.equal(reads.length,2);
  }finally{await pg.close();}
});

test("a ready place carries its source section and Checked metadata without any bundle lookup",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const state='ocd-division/country:us/state:az',city=`${state}/place:example`;
  const pointer={recordClass:'CURATED_READER_RECORD' as const,scope:`US:plain-english-translations:${city}`};
  const checked='2026-10-28T12:00:00.000Z',payload={formatVersion:1,records:[{id:'example',kind:'BODY_DEFINITION',value:{text:'A sourced description'}}]};
  const query:Query=async(text,params=[])=>(await pg.query<Record<string,unknown>>(text,[...params])).rows;
  try {
    await query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Arizona','AZ',NULL),($2,'place','Example','AZ',$1)",[state,city]);
    await publish({...pointer,id:'description',sourceId:'source',value:payload,at:checked});
    await storePlacePage(query,city,await buildPageBody(city,'place','AZ',query));
    const statements:string[]=[];
    const reader=await readCanonicalShelf([pointer],async batch=>Promise.all(batch.map(({text,params})=>{
      statements.push(text);assert.doesNotMatch(text,/civic_data_(?:promotions|candidates|candidate_events|payload_parts)/);
      return query(text,params);
    })));
    const entry=await reader.readPromotedEntry!(pointer.recordClass,pointer.scope);
    assert.equal(entry.kind,'PROMOTED');
    if(entry.kind==='PROMOTED'){
      assert.deepEqual(entry.projection.payload,payload);
      assert.equal(entry.attested.retrievedAt,checked);
    }
    assert.equal(statements.length,1);
  } finally {await pg.close();}
});


test("the complete ZIP authority compiler handles missing optional sources and persists their admitted absence",async()=>{
  const {pg}=await migratedReaderDb();
  const {buildPageAuthorities}=await import('../lib/reader/place-builder.ts');
  const query:Query=async(text,params=[])=>(await pg.query<Record<string,unknown>>(text,[...params])).rows;
  try {
    const built=await buildPageAuthorities({state:'AZ',placeId:'zip:85701',divisionIds:['ocd-division/country:us/state:az/county:pima']},query);
    assert.equal(built.authorityFormat,1);assert.ok(built.authorityKeys?.includes('STATE_LEGISLATOR:US-AZ:openstates-people:v1'));
    assert.deepEqual(built.authorities,{});
  }finally{await pg.close();}
});

test('one cross-state ZIP saves each state geography and every optional source key in the same page',async()=>{
  const {pg}=await migratedReaderDb();const {buildPageAuthorities}=await import('../lib/reader/place-builder.ts');
  try {
    const built=await buildPageAuthorities({state:'AZ',placeId:'zip:cross-state',divisionIds:[
      'ocd-division/country:us/state:az/county:example','ocd-division/country:us/state:nv/county:example']},
      async(text,params=[])=>(await pg.query<Record<string,unknown>>(text,[...params])).rows);
    assert.deepEqual(Object.keys(built.authorityGeographies).sort(),['AZ','NV']);
    for(const state of ['AZ','NV'])assert.ok(built.authorityKeys.includes(`STATE_LEGISLATOR:US-${state}:openstates-people:v1`));
  }finally{await pg.close();}
});

test('a new check of identical source content updates the saved page clock without transferring the source again',async()=>{
  const {pg,publish}=await migratedReaderDb();
  const {rebuildPageBody}=await import('../lib/reader/place-builder.ts');
  const {unpackPlaceContextRow}=await import('../lib/reader/place-ready.ts');
  const city='ocd-division/country:us/state:az/place:clock',scope=`US:plain-english-translations:${city}`;
  const payload={formatVersion:1,records:[]};
  const query:Query=async(text,params=[])=>(await pg.query<Record<string,unknown>>(text,[...params])).rows;
  try {
    await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Clock','AZ')",[city]);
    await publish({id:'clock-v1',recordClass:'CURATED_READER_RECORD',scope,sourceId:'source',value:payload,at:'2026-10-19T00:00:00.000Z'});
    const page=await buildPageBody(city,'place','AZ',query);await storePlacePage(query,city,page);
    assert.ok(page.prints);
    await publish({id:'clock-v2',recordClass:'CURATED_READER_RECORD',scope,sourceId:'source',value:payload,at:'2026-10-20T00:00:00.000Z'});
    let sourceBodyBytes=0;
    const rebuilt=await rebuildPageBody(city,'place','AZ',async(text,params=[])=>{
      const rows=await query(text,params);
      if(text.includes('civic_data_promotions'))sourceBodyBytes+=rows.reduce((bytes,row)=>bytes+(row.payload?Buffer.byteLength(JSON.stringify(row.payload)):0),0);
      return rows;
    },undefined,{prints:page.prints!,row:async key=>unpackPlaceContextRow(page[key as 'current'|'history'])});
    assert.ok('unchanged' in rebuilt);assert.equal(sourceBodyBytes,0);
    const shelf=await readCanonicalShelf([{recordClass:'CURATED_READER_RECORD',scope}],async batch=>Promise.all(batch.map(s=>query(s.text,s.params))));
    const read=await shelf.readPromotedEntry!('CURATED_READER_RECORD',scope);
    assert.equal(read.kind,'PROMOTED');if(read.kind==='PROMOTED'){
      assert.equal(read.projection.versionId,'clock-v2');
      assert.equal(new Date(read.attested.retrievedAt).toISOString(),'2026-10-20T00:00:00.000Z');
      assert.deepEqual(read.projection.payload,payload);
    }
  }finally{await pg.close();}
});
