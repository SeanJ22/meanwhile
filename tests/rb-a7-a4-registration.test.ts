import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { factDb } from "./helpers/fact-db.ts";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { fileEntityPlaces } from "../lib/facts/entity-places.ts";
import type { Query } from "../lib/facts/publish.ts";

function references() {
  const root=mkdtempSync(join(tmpdir(),'rb-a7-a4-registration-'));
  const put=(path:string,value:unknown)=>{
    const file=join(root,path);mkdirSync(join(file,'..'),{recursive:true});
    writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));
  };
  put('lib/registry/registry.json',{bodies:[]});put('lib/registry/promoted-bodies.json',{bodies:[]});
  put('data/reference/openstates_legislators.csv','ocd_person_id,name,jurisdiction\n');
  put('data/derived/registration/index.json',{source:'native-fixture.csv'});
  put('data/derived/registration/az.json',{state:'AZ',divisions:[['ocd-division/country:us/state:az','state','04','Arizona']],
    governments:[['700001','az:special:first-district','First district','SPECIAL DISTRICT',-1,'UNPAIRED'],
      ['700002','az:special:second-district','Second district','SPECIAL DISTRICT',-1,'UNPAIRED']]});
  for(const [state,facts] of [
    ['az',{}],['ca',{'700001':{web:'',county:'Los Angeles',countyFips:'06037'}}],
    ['nv',{'700002':{web:'',county:'Clark',countyFips:'32003'}}],
  ] as const) {
    if(state!=='az')put(`data/derived/registration/${state}.json`,{state:state.toUpperCase(),divisions:[],governments:[]});
    const bytes=JSON.stringify(facts);
    put(`data/derived/place-reference/${state}.jsonl`,bytes);
    put(`data/derived/place-reference/${state}.json`,{formatVersion:2,state:state.toUpperCase(),censusSource:'data/reference/native-fixture.csv',
      units:[],byZip:{},shares:{},facts:[0,Buffer.byteLength(bytes)]});
  }
  return root;
}

test('a native Census host correction queues both former and corrected states for its government and held boards',async()=>{
  const db=await factDb(),root=references(),country='ocd-division/country:us';
  const az=`${country}/state:az`,ca=`${country}/state:ca`,nv=`${country}/state:nv`,ut=`${country}/state:ut`;
  const counties=[`${ca}/county:los_angeles`,`${nv}/county:clark`],governments=['az:special:first-district','az:special:second-district'];
  try {
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','United States',NULL,NULL)",[country]);
    for(const [id,state] of [[az,'AZ'],[ca,'CA'],[nv,'NV'],[ut,'UT']])
      await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place',$1,$2,$3)",[id,state,country]);
    for(const [id,state,parent,fips] of [[counties[0],'CA',ca,'06037'],[counties[1],'NV',nv,'32003']]) {
      await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place',$1,$2,$3)",[id,state,parent]);
      await db.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'census-geoid:county',$2)",[id,fips]);
    }
    for(const id of governments) {
      await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'government',$1,'AZ',$2),($3,'body','Held board','AZ',$1)",[id,az,`${id}#board`]);
      await db.query('INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2),($3,$2)',[id,az,`${id}#board`]);
    }
    for(const [zip,state,parent] of [['85001','AZ',az],['90001','CA',ca],['89101','NV',nv],['84001','UT',ut]])
      await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place',$1,$2,$3)",[`zip:${zip}`,state,parent]);
    let queueWrites=0;
    const observe=(query:Query):Query=>async(text,args)=>{if(text.includes('INSERT INTO rebuild_queue'))queueWrites++;return query(text,args);};
    const connected={...db,query:observe(db.query),transaction:<T>(run:(query:Query)=>Promise<T>)=>db.transaction(query=>run(observe(query)))};
    assert.deepEqual(await ensureFactEntities(connected,root,['az']),['az']);
    for(const [index,state] of ['CA','NV'].entries()) {
      const id=governments[index];
      assert.deepEqual(await db.query('SELECT state,parent_id FROM entity WHERE id=$1',[id]),[{state,parent_id:counties[index]}]);
      assert.deepEqual(await db.query('SELECT state FROM entity WHERE id=$1',[`${id}#board`]),[{state}]);
      assert.deepEqual(await db.query('SELECT place_id,placement_basis FROM entity_place WHERE entity_id=$1',[`${id}#board`]),
        [{place_id:counties[index],placement_basis:'HOST_COUNTY'}]);
    }
    assert.equal(queueWrites,1,'one registration transaction queues the full old and new footprint');
    const queued=(await db.query('SELECT place_id FROM rebuild_queue')).map(row=>row.place_id);
    for(const id of ['zip:85001','zip:90001','zip:89101'])assert.ok(queued.includes(id),id);
    assert.ok(!queued.includes('zip:84001'));
    await db.query('DELETE FROM rebuild_queue');
    assert.deepEqual(await ensureFactEntities(connected,root,['az']),[]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM rebuild_queue'))[0]!.n,0);
  }finally{await db.pg.close();rmSync(root,{recursive:true,force:true});}
});

test('an explicit service area replaces an inherited host-county marker and refreshes the place once',async()=>{
  const db=await factDb(),city='ocd-division/country:us/state:az/county:pima',body='az:special:board',government='az:special:government';
  try {
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Pima','AZ',NULL),($2,'government','District','AZ',$1),($3,'body','Board','AZ',$2),('zip:85701','place','ZIP 85701','AZ',$1)",[city,government,body]);
    await db.query("INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis) VALUES($1,$3,2025,'HOST_COUNTY'),($2,$3,2025,'HOST_COUNTY')",[government,body,city]);
    await db.query("INSERT INTO place_page_dependency VALUES('zip:85701',$1)",[city]);
    const places=[{placeId:city,boundaryYear:2025,basis:'SERVICE_AREA' as const}];
    assert.equal(await fileEntityPlaces(db.query,body,places,government).then(filed=>filed.moved),true);
    assert.deepEqual(await db.query('SELECT placement_basis FROM entity_place WHERE entity_id=$1',[body]),[{placement_basis:'SERVICE_AREA'}]);
    assert.ok((await db.query("SELECT place_id FROM rebuild_queue WHERE place_id='zip:85701'")).length);
    await db.query('DELETE FROM rebuild_queue');
    assert.equal(await fileEntityPlaces(db.query,body,places,government).then(filed=>filed.moved),false);
    assert.deepEqual(await db.query('SELECT * FROM rebuild_queue'),[]);
    assert.equal(await fileEntityPlaces(db.query,body,[],government).then(filed=>filed.moved),false,'a later inherited host filing cannot erase the source-established service area');
    assert.deepEqual(await db.query('SELECT placement_basis FROM entity_place WHERE entity_id=$1',[body]),[{placement_basis:'SERVICE_AREA'}]);
  }finally{await db.pg.close();}
});
