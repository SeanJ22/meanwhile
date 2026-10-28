import assert from "node:assert/strict";
import test from "node:test";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {readPlaceBuild,reusePlaceBuild} from "../lib/reader/place-build-reuse.ts";
import type {Query} from "../lib/facts/publish.ts";

test("identical ZIP inputs transfer only a fingerprint and copy the complete answer and dependencies in the database",async()=>{
  const {pg}=await migratedReaderDb();
  const query:Query=async(t,p=[]) => (await pg.query<Record<string,unknown>>(t,[...p])).rows;
  try {
    for(const id of ['zip:11111','zip:22222','body:shared','body:old'])await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$1,'NY')",[id]);
    const value={rosters:[{name:'Person',quote:'é'.repeat(50000)}],meetings:[{id:'event',at:'2026-10-28'}]};
    const statement='SELECT $1::jsonb AS facts';
    const first=await readPlaceBuild(query,statement,[JSON.stringify(value)],null);
    assert.deepEqual(first.row,{facts:value});
    await query("INSERT INTO place_page(place_id,body,history_body,context,build_fingerprint) VALUES('zip:11111',$1,'{}','{}',$2)",[JSON.stringify(value),first.fingerprint]);
    await query("INSERT INTO place_page_dependency(page_id,entity_id) VALUES('zip:11111','zip:11111'),('zip:11111','body:shared')");
    const next=await readPlaceBuild(query,statement,[JSON.stringify(value)],null);
    assert.equal(next.row,undefined);
    assert.deepEqual(next.reused,{placeId:'zip:11111'});
    assert.ok(Buffer.byteLength(JSON.stringify(next))<250);
    await reusePlaceBuild(query,'zip:22222',next.reused!,next.fingerprint);
    assert.deepEqual((await query("SELECT body FROM place_page WHERE place_id='zip:22222'"))[0]?.body,value);
    assert.deepEqual((await query("SELECT entity_id FROM place_page_dependency WHERE page_id='zip:22222' ORDER BY entity_id")).map(r=>r.entity_id),['body:shared','zip:22222']);
    // A changed selected fact, a removed field, and different territory each require fresh composition.
    for(const changed of [{...value,rosters:[]},{meetings:value.meetings}]) {
      const fresh=await readPlaceBuild(query,statement,[JSON.stringify(changed)],null);
      assert.equal(fresh.reused,undefined);assert.deepEqual(fresh.row,{facts:changed});
    }
    assert.equal((await readPlaceBuild(query,statement,[JSON.stringify(value)],{type:'BodyTerritorySelection',inside:[],known:['other']})).reused,undefined);
    assert.equal((await readPlaceBuild(query,statement,[JSON.stringify(value)],null,"new-release")).reused,undefined);
    await query("UPDATE place_page SET version=version+1 WHERE place_id='zip:11111'");
    await query("INSERT INTO place_page_dependency(page_id,entity_id) VALUES('zip:22222','body:old')");
    await reusePlaceBuild(query,'zip:22222',next.reused!,next.fingerprint);
    assert.deepEqual((await query("SELECT entity_id FROM place_page_dependency WHERE page_id='zip:22222' ORDER BY entity_id")).map(r=>r.entity_id),['body:shared','zip:22222']);
    await reusePlaceBuild(query,'zip:11111',next.reused!,next.fingerprint);
    assert.deepEqual((await query("SELECT entity_id FROM place_page_dependency WHERE page_id='zip:11111' ORDER BY entity_id")).map(r=>r.entity_id),['body:shared','zip:11111']);
    await query("UPDATE place_page SET build_fingerprint='changed' WHERE place_id='zip:11111'");
    await assert.rejects(reusePlaceBuild(query,'zip:22222',next.reused!,next.fingerprint),/REUSE_REPLACED/);
  }finally{await pg.close();}
});
