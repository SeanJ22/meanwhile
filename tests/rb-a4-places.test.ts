import assert from "node:assert/strict";
import test from "node:test";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { ensureEntity, ensureFactEntities } from "../lib/facts/entities.ts";
import { fileEntityPlaces } from "../lib/facts/entity-places.ts";
import { readPlacePackage } from "../lib/reader/place.ts";
import { factDb } from "./helpers/fact-db.ts";
import {door} from '../lib/core/door.ts';
import {factClocks} from '../lib/facts/clocks.ts';
import { seedPlacePages } from "./helpers/place-pages.ts";

test("a board keeps one identity and reaches every served city in ten states, including after the next write", async () => {
  const {pg} = await migratedReaderDb();
  const query = async (sql: string, params: readonly unknown[] = []) => (await pg.query<Record<string,unknown>>(sql,[...params])).rows;
  try {
    const [source] = await query(`INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key)
      VALUES('https://example.gov/boards','https://example.gov/boards',now(),$1,'board-page') RETURNING id`,["a".repeat(64)]);
    for (const state of ["AZ","CA","CO","FL","IL","MI","NY","OR","TX","WA"]) {
      const root = `ocd-division/country:us/state:${state.toLowerCase()}`;
      const cities = ["first","second","outside"].map(city => `${root}/place:${city}`);
      await query("INSERT INTO entity(id,kind,name,state) SELECT id,'place',id,$2 FROM unnest($1::text[]) id",[[root,...cities],state]);
      const government = `${state.toLowerCase()}:special:regional-transit`, id = `${root}#body:transit`;
      const places = [root,...cities.slice(0,2)].map(placeId => ({placeId,boundaryYear:2025,basis:"SERVICE_AREA" as const}));
      await ensureEntity(query,{id:government,kind:"government",name:"Regional Transit",state,parentId:root,places});
      await ensureEntity(query,{id,kind:"body",name:"Transit Board",state,parentId:government});
      await query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by,cost_usd)
        VALUES($1,'name','"Transit Board"','Transit Board','live','OFFICIAL',$2,'Transit Board',now(),now(),'fixture',0)`,[id,source.id]);
      for (let run = 0; run < 2; run++) {
        await ensureEntity(query,{id,kind:"body",name:"Transit Board",state,parentId:government});
        for (const city of cities.slice(0,2)) {
          const input = {state,divisionIds:[city]};
          await seedPlacePages(query,input);
          const answer = await readPlacePackage(input,query);
          const board = answer.bodies.find(body => body.id === id);
          assert.ok(board,`${state} run ${run}: ${city}`);
          assert.equal(board.fields.ocdId,city);
          assert.deepEqual([city,...board.fields.alsoServesOcdIds ?? []].sort(),cities.slice(0,2).sort());
        }
        const outside = {state,divisionIds:[cities[2]]};
        await seedPlacePages(query,outside);
        assert.deepEqual((await readPlacePackage(outside,query)).bodies,[]);
      }
      assert.deepEqual(await query("SELECT place_id,boundary_year FROM entity_place WHERE entity_id=$1 ORDER BY place_id",[id]),
        cities.slice(0,2).sort().map(place_id => ({place_id,boundary_year:2025})));
    }
  } finally { await pg.close(); }
});

test('an identical saved fact can file a newly served city and refresh its reader without counting another fact',async()=>{
  const db=await factDb({withHourlyCounts:true}),id='az:special:regional#governing',city='ocd-division/country:us/state:az/place:served',now=new Date('2026-10-24T00:00:00.000Z');
  try {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Regional Board','AZ'),($2,'place','Served','AZ')",[id,city]);
    await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://example.gov/board','https://example.gov/board',$1,$2,'source')",[now.toISOString(),'a'.repeat(64)]);
    const input={subjectId:id,field:'office_phone',fieldKind:'contact' as const,value:'520-555-0100',valueText:'520-555-0100',quote:'Phone 520-555-0100',provenance:'OFFICIAL' as const,producedBy:'fixture',costUsd:0,
      copy:{id:1,finalUrl:'https://example.gov/board',text:'Phone 520-555-0100',fetchedAt:now,isArchive:false}};
    let purges=0;const options={purge:async()=>{purges++;return {purged:true};}};
    assert.equal((await door(db,input,factClocks(null),now,options) as {decision:string}).decision,'PUBLISH');
    const before=purges;
    const served={...input,places:[{placeId:city,boundaryYear:2025,basis:'SERVICE_AREA' as const}]};
    assert.equal((await door(db,served,factClocks(null),now,options) as {decision:string}).decision,'CONFIRM');
    assert.ok(purges>before);
    assert.deepEqual(await db.query('SELECT place_id FROM rebuild_queue ORDER BY place_id'),[city,id].sort().map(place_id=>({place_id})));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM fact'))[0]!.n,1);
    assert.deepEqual(await db.query(`SELECT state,sum(n)::int AS n FROM count_hour
      WHERE left(step,3)='v1:' AND substring(step FROM 4)::jsonb->>1='fact:live'
        AND substring(step FROM 4)::jsonb->>2='in' GROUP BY state`),[{state:'AZ',n:1}]);
    const after=purges;await db.query('DELETE FROM rebuild_queue');
    await door(db,served,factClocks(null),now,options);
    assert.equal(purges,after);assert.deepEqual(await db.query('SELECT * FROM rebuild_queue'),[]);
  } finally {await db.pg.close();}
});

test("the next registration import retains all published territory and removes only superseded state links", async () => {
  const db = await factDb();
  try {
    await ensureFactEntities(db,process.cwd(),["az"]);
    const government = "az:special:alpine-sanitary-district";
    const places = ["apache","pima"].map(county => `ocd-division/country:us/state:az/county:${county}`);
    const board = `${government}#governing`;
    await ensureEntity(db.query,{id:board,kind:"body",name:"Alpine board",state:"AZ",parentId:government});
    await ensureEntity(db.query,{id:"meeting:existing-permanent-id",kind:"meeting",name:"Alpine meeting",state:"AZ",parentId:board});
    await db.pg.exec("CREATE TABLE civic_data_promotions(key text PRIMARY KEY,payload jsonb)");
    await db.query("INSERT INTO civic_data_promotions VALUES('REGISTRATION:US-AZ:registration:v1',$1::jsonb)",
      [JSON.stringify({governments:[{id:government,jurisdictionId:government,associations:places.map(divisionId => ({divisionId,basis:"SOURCE_BOUNDARY",boundaryYear:2024}))}]})]);
    await ensureFactEntities(db,process.cwd(),["az"]);
    assert.deepEqual(await db.query("SELECT place_id,boundary_year FROM entity_place WHERE entity_id=$1 ORDER BY place_id",[government]),
      places.map(place_id => ({place_id,boundary_year:2024})));
    assert.deepEqual(await ensureFactEntities(db,process.cwd(),["az"]),[],"unchanged scheduled imports preserve the complete set");
    for (const id of [board,"meeting:existing-permanent-id"]) assert.deepEqual(
      await db.query("SELECT place_id FROM entity_place WHERE entity_id=$1 ORDER BY place_id",[id]),places.map(place_id => ({place_id})),
      "existing dynamically acquired boards and meetings inherit every place when registration is refreshed");
    await ensureEntity(db.query,{id:board,kind:"body",name:"Alpine board",state:"AZ",parentId:government});
    await fileEntityPlaces(db.query,board,[],government);
    assert.equal((await db.query("SELECT place_id FROM entity_place WHERE entity_id=$1",[board])).length,2);
  } finally { await db.pg.close(); }
});
