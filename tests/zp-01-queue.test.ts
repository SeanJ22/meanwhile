import {fixturePlaceBuild} from "./helpers/place-build-row.ts";
import assert from 'node:assert/strict';
import test from 'node:test';
import {migratedReaderDb} from './helpers/migrated-reader-db.ts';
import { enqueueReaderPlaces } from '../lib/reader/cache.ts';
import { PLACE_PACKAGE_SQL, rebuildPlacePages } from '../lib/reader/place-builder.ts';
import type { FactDb } from '../lib/facts/publish.ts';

const root='ocd-division/country:us/state:az';
// Held 2020 Census residents of each ZCTA, as the deployment seeds them into page_priority.
const residents:Record<string,number>={'85003':11042,'85701':5132,'86001':37093,'85004':8833,'85301':67380,'85302':41369};
const raw={division_ids:[],entities:[],fields:[],rosters:[],comments:[],sittings:[],meeting_rows:[],archived_meetings:[],archived_documents:[],parts:{},registry:null,governments:[],divisions:[]};

test('pending publications do no row updates; an in-flight page retains exactly one later generation',async()=>{
  const db=await migratedReaderDb();
  try {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Arizona','AZ')",[root]);
    await enqueueReaderPlaces({places:[root]},db.query);
    const stamp=()=>db.query('SELECT generation::int,ctid::text,next_queued_at::text FROM rebuild_queue');
    const waiting=await stamp();
    for(let n=0;n<1000;n++)await enqueueReaderPlaces({places:[root]},db.query);
    assert.deepEqual(await stamp(),waiting,'1,000 publications are coalesced without rewriting the pending row');
    await db.query("UPDATE rebuild_queue SET lease_token='building',lease_slot=1,lease_until=clock_timestamp()+interval '5 minutes'");
    await enqueueReaderPlaces({places:[root]},db.query);
    const active=await stamp();
    assert.equal(active[0]!.generation,2);assert.ok(active[0]!.next_queued_at);
    for(let n=0;n<1000;n++)await enqueueReaderPlaces({places:[root]},db.query);
    assert.deepEqual(await stamp(),active,'only the first arrival during the snapshot rewrites the row');
  }finally{await db.pg.close();}
});

test('every pass grows ZIP pages, in descending held population, despite an always-changing large ZIP',async()=>{
  const db=await migratedReaderDb();
  const zips=['85003','85701','86001','85004','85301','85302'];
  try {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Arizona','AZ')",[root]);
    await enqueueReaderPlaces({places:[root]},db.query);
    for(const zip of zips) {
      await db.query("INSERT INTO entity(id,kind,name,state,page_priority) VALUES($1,'place',$1,'AZ',$2)",[`zip:${zip}`,1+residents[zip]!]);
      await enqueueReaderPlaces({places:[`zip:${zip}`]},db.query);
    }
    const ordered=(await db.query("SELECT place_id FROM rebuild_queue WHERE priority>0 ORDER BY priority DESC,place_id")).map(row=>String(row.place_id));
    const built:string[]=[];
    const wrapped:FactDb={transaction:work=>db.transaction(query=>work(async(text,params)=>{
      if(text.includes(PLACE_PACKAGE_SQL))return fixturePlaceBuild(query,text,params,raw);
      const result=await query(text,params);
      if(text.startsWith('WITH slot'))for(const row of result)built.push(String(row.place_id));
      return result;
    }))};
    const hot=ordered[0]!;
    let pages=0;
    for(let pass=0;pass<3;pass++) {
      const result=await rebuildPlacePages({db:wrapped,limit:2,concurrency:1,purge:async()=>{
        await enqueueReaderPlaces({places:[hot]},db.query);return{purged:true};
      }});
      assert.equal(result.failed,0);assert.equal(result.rebuilt,2);
      const turn=built.slice(pass*2);
      assert.equal(new Set(turn).size,2,'a page is built at most once per pass');
      assert.deepEqual(turn,ordered.slice(pass*2,pass*2+2));
      const [count]=await db.query("SELECT count(*)::int AS n FROM place_page WHERE place_id LIKE 'zip:%'");
      assert.ok(Number(count!.n)>pages);pages=Number(count!.n);
    }
    assert.equal(pages,6);
    assert.ok(!(await db.query('SELECT 1 FROM place_page WHERE place_id=$1',[root])).length,'ZIPs precede the older state row');
  }finally{await db.pg.close();}
});

test('a publication after queue deletion cannot rebuild that page twice in one pass',async()=>{
  const db=await migratedReaderDb();
  try {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Arizona','AZ')",[root]);
    await enqueueReaderPlaces({places:[root]},db.query);
    let requeued=false;
    const wrapped:FactDb={transaction:async work=>{
      let completed=false;
      const result=await db.transaction(query=>work(async(text,params)=>{
        if(text.includes(PLACE_PACKAGE_SQL))return fixturePlaceBuild(query,text,params,raw);
        const rows=await query(text,params);
        if(text.startsWith('DELETE FROM rebuild_queue'))completed=true;
        return rows;
      }));
      if(completed&&!requeued){requeued=true;await enqueueReaderPlaces({places:[root]},db.query);}
      return result;
    }};
    assert.deepEqual(await rebuildPlacePages({db:wrapped,limit:10,concurrency:4,purge:async()=>({purged:true})}),{rebuilt:1,failed:0,remaining:1});
    assert.equal(Number((await db.query('SELECT version FROM place_page'))[0]!.version),1);
    assert.deepEqual(await rebuildPlacePages({db:wrapped,limit:10,purge:async()=>({purged:true})}),{rebuilt:1,failed:0,remaining:0});
  }finally{await db.pg.close();}
});
