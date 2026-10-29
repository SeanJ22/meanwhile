import assert from "node:assert/strict";
import test from "node:test";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { readPlacePackage } from "../lib/reader/place.ts";
import { buildMissingPlacePages, buildPageBody } from "../lib/reader/place-builder.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";

test("a first place visit saves the builder's answer; the next visit only reads ready pages", async () => {
  const {pg,publish}=await migratedReaderDb();
  const statements:string[]=[];
  const query:Query=async(text,params=[])=>{statements.push(text);return (await pg.query<Record<string,unknown>>(text,[...params])).rows;};
  const state='ocd-division/country:us/state:az',city=`${state}/place:example`,body=`${city}#council`;
  const checked=new Date(Date.now()-60_000).toISOString();
  try {
    await query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Arizona','AZ',NULL),($2,'place','Example','AZ',$1),($3,'body','Council','AZ',$2)",[state,city,body]);
    await publish({id:'runtime',recordClass:'REGISTRY_RUNTIME_BINDING',scope:'US-AZ:reader-registry-runtime',sourceId:'registry',at:checked,
      value:{formatVersion:1,registry:{generatedAt:checked,divisions:[{ocdId:city,label:'Example',state:'AZ',divisionType:'place'}],
        bodies:[{id:body,ocdId:city,name:'Council',bodyType:'council',homepage:'https://example.gov'}]},bodyRosters:[],rosterReaderDispositions:[],statewideExecutives:[]}});
    const expected=await buildPageBody(city,'place','AZ',query);
    const input={state:'AZ',divisionIds:[city]};
    const first=await readPlacePackage(input,query);
    assert.deepEqual(first,expected.readyCurrent);
    assert.equal((await query("SELECT count(*)::int AS n FROM place_page WHERE place_id=$1",[city]))[0]?.n,1);
    statements.length=0;
    const next=await readPlacePackage(input,query);
    assert.deepEqual(next,first);
    assert.ok(statements.length>0);
    assert.ok(statements.every(sql=>!(/civic_data_(?:promotions|candidates|candidate_events|payload_parts)/.test(sql))));
    assert.ok(statements.some(sql=>sql.includes('place_page')));
    const db:FactDb={transaction:work=>pg.transaction(tx=>work(async(text,params=[])=>(await tx.query<Record<string,unknown>>(text,[...params])).rows))};
    await buildMissingPlacePages([{id:city,kind:'place',state:'AZ'}],db);
    assert.equal((await query("SELECT version::int FROM place_page WHERE place_id=$1",[city]))[0]?.version,1);
  } finally {await pg.close();}
});

test('an existing legacy place upgrades its saved answer without reopening any source bundle',async()=>{
  const {pg,publish}=await migratedReaderDb();
  const {buildPlacePackage,buildPlaceRow}=await import('../lib/reader/place-builder.ts');
  const {packReadyPlace,packPlaceContext}=await import('../lib/reader/place-ready.ts');
  const state='ocd-division/country:us/state:az',city=`${state}/place:legacy`,body=`${city}#council`,at='2026-10-19T00:00:00.000Z';
  const query:Query=async(text,params=[])=>(await pg.query<Record<string,unknown>>(text,[...params])).rows;
  try {
    await query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Arizona','AZ',NULL),($2,'place','Legacy','AZ',$1),($3,'body','Council','AZ',$2)",[state,city,body]);
    await publish({id:'legacy-runtime',recordClass:'REGISTRY_RUNTIME_BINDING',scope:'US-AZ:reader-registry-runtime',sourceId:'registry',at,
      value:{formatVersion:1,registry:{generatedAt:at,divisions:[{ocdId:city,label:'Legacy',state:'AZ',divisionType:'place'}],bodies:[{id:body,ocdId:city,name:'Council'}]},
        bodyRosters:[],rosterReaderDispositions:[],statewideExecutives:[],officialPhotos:{photos:[]},officialCandidacies:{rows:[]},rosterPhotos:{}}});
    const input={state:'AZ',placeId:city,divisionIds:[city]},legacy=await buildPlacePackage(input,query),row=await buildPlaceRow(input,query);
    await query("INSERT INTO place_page(place_id,version,built_at,body,history_body,context) VALUES($1,1,now(),$2,'{}',$3)",
      [city,JSON.stringify(packReadyPlace(legacy)),JSON.stringify(packPlaceContext({formatVersion:1,current:row}))]);
    const statements:string[]=[];
    const result=await readPlacePackage(input,async(text,params=[])=>{statements.push(text);return query(text,params);});
    assert.deepEqual(result.meetings,legacy.meetings);assert.deepEqual(result.bodies.map(row=>row.id),legacy.bodies.map(row=>row.id));
    assert.equal(result.snapshotHeldAt,legacy.snapshotHeldAt);
    assert.ok(statements.length&&statements.every(sql=>!(/civic_data_(?:candidates|promotions|candidate_events|payload_parts)/.test(sql))));
    assert.equal((await query("SELECT context->>'readerFormat' AS format FROM place_page WHERE place_id=$1",[city]))[0]?.format,'1');
  }finally{await pg.close();}
});
