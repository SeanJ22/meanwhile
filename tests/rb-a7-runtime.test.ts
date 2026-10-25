import assert from "node:assert/strict";
import test from "node:test";
import { preparePlacePages, prepareProductionPlacePages, seedZipPagePlaces } from "../scripts/prepare-place-pages.mts";
import { config } from "../netlify/functions/rebuild-place-pages.mts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import { buildPageBody,PLACE_PACKAGE_SQL, rebuildPlacePages } from "../lib/reader/place-builder.ts";
import { readerCacheTags } from "../lib/reader/cache.ts";
import { factDb } from "./helpers/fact-db.ts";

test("the rebuild worker runs every minute without a public HTTP route", () => {
  assert.deepEqual(config, { schedule: "* * * * *", background: true });
});

test("initial page publication resumes missing places and bodies before the reader is deployed", async () => {
  const queries: string[] = [];
  const query: Query = async text => {
    queries.push(text);
    if (text.startsWith("SELECT")) return [{ places: 3, bodies: 2, missing: 0 }];
    return [];
  };
  const db = { query, transaction: async <T>(run: (query: Query) => Promise<T>) => run(query) };
  let passes = 0;
  const result = await preparePlacePages({ db, rebuild: async options => {
    assert.equal(options?.db, db);
    assert.equal(options?.concurrency, 4);
    passes++;
    return { rebuilt: passes === 1 ? 3 : 2, failed: 0, remaining: passes === 1 ? 2 : 0 };
  } });
  assert.deepEqual(result, { rebuilt: 5, places: 3, bodies: 2, missing: 0 });
  assert.equal(passes, 2);
  assert.match(queries[0], /e.kind IN \('place','body'\)/);
  assert.match(queries[0], /p.place_id IS NULL/);
  assert.match(queries[0], /ON CONFLICT\(place_id\) DO NOTHING/);
});

test("a failed rebuild or absent page prevents the reader cutover", async () => {
  const query: Query = async text => text.startsWith("SELECT") ? [{ places: 3, bodies: 2, missing: 1 }] : [];
  const db = { query, transaction: async <T>(run: (query: Query) => Promise<T>) => run(query) };
  await assert.rejects(preparePlacePages({ db, rebuild: async () => ({ rebuilt: 4, failed: 1, remaining: 1 }) }), /could not be built/);
  await assert.rejects(preparePlacePages({ db, rebuild: async () => ({ rebuilt: 0, failed: 0, remaining: 1 }) }), /without progress/);
  await assert.rejects(preparePlacePages({ db, rebuild: async () => ({ rebuilt: 4, failed: 0, remaining: 0 }) }), /no built page/);
});

test("initial preparation lets the published worker finish its active page leases",async()=>{
  let calls=0,waits=0;
  const query:Query=async text=>/AS active/.test(text)?[{active:4}]:text.startsWith('SELECT')?[{places:3,bodies:2,missing:0}]:[];
  const db={query,transaction:async<T>(run:(query:Query)=>Promise<T>)=>run(query)};
  const result=await preparePlacePages({db,waitForWorkers:async()=>{waits++;},rebuild:async()=>{
    calls++;
    return {rebuilt:calls===1?0:1,failed:0,remaining:calls===1?5:0};
  }});
  assert.equal(calls,2);
  assert.equal(waits,1);
  assert.equal(result.missing,0);
});

test("preview and local builds never try to populate production pages", async () => {
  await prepareProductionPlacePages({ NETLIFY: "true", CONTEXT: "deploy-preview", BRANCH: "main" });
  await prepareProductionPlacePages({ NETLIFY: "true", CONTEXT: "production", BRANCH: "stream/rb-a7" });
  await prepareProductionPlacePages({});
  await assert.rejects(prepareProductionPlacePages({ NETLIFY: "true", CONTEXT: "production", BRANCH: "main",
    WTP_PRODUCTION_DATABASE_URL_WRITE: "postgres://readonly:secret@ep-dry-river-axwtolzc.neon.tech/neondb" }), /read-only/);
  await assert.rejects(prepareProductionPlacePages({ NETLIFY: "true", CONTEXT: "production", BRANCH: "main",
    WTP_PRODUCTION_DATABASE_URL_WRITE: "postgres://owner:secret@example.test/neondb" }), /production reader database/);
});

test("ZIP page identities follow the routed ZIP geography and retain their state's parent", async () => {
  const saved: Record<string,unknown>[]=[];
  const dependencies:Record<string,unknown>[]=[];
  const query:Query=async(text,args)=>{
    const records=JSON.parse(String(args?.[0])) as Record<string,unknown>[];
    if(text.startsWith('INSERT INTO entity'))saved.push(...records);else dependencies.push(...records);
    return[];
  };
  const root="ocd-division/country:us/state:az";
  const n=await seedZipPagePlaces(query,{
    states:['AZ'],
    postal:()=>({
      '85001':[33,-112,'standard','85001','Phoenix','AZ','Maricopa',null,null],
      '85002':[33,-112,'standard','85002','Phoenix','AZ','Maricopa',null,null],
      '85003':[null,null,'standard','85003','Phoenix','AZ','Maricopa',null,null],
      '90001':[34,-118,'standard','90001','Los Angeles','CA','Los Angeles',null,null],
    }),
    point:zip=>zip==='85003'?null:{zip,lat:33,lng:-112},
    bodies:async()=>['az:city:phoenix#governing'],
    place:async zip=>zip==='85002'?null:{ids:['ocd-division/country:us/state:ca',root],partial:[],samples:1},
  });
  assert.equal(n,1);
  assert.deepEqual(saved,[{id:'zip:85001',name:'ZIP 85001',state:'AZ',parent_id:root}]);
  assert.deepEqual(dependencies,[{page_id:'zip:85001',entity_id:'ocd-division/country:us/state:ca'},
    {page_id:'zip:85001',entity_id:root},{page_id:'zip:85001',entity_id:'az:city:phoenix#governing'}]);
});

const rawPage=(id:string)=>({division_ids:[id],entities:[],fields:[],rosters:[],comments:[],sittings:[],
  meeting_rows:[],archived_meetings:[],archived_documents:[],parts:{},registry:null,governments:[],divisions:[]});

test("initial ZIP construction rejects changed current content; routine rebuilds need only the history query",async()=>{
  const id='ocd-division/country:us/state:ca/place:los_angeles';
  let reads=0;
  const query:Query=async(_sql,args)=>{
    reads++;
    return[{...rawPage(id),entities:args?.[5]?[{id:`${id}#board`,division:id,kind:'body',state:'CA'}]:[]}];
  };
  await assert.rejects(buildPageBody('zip:90001','place','CA',query,true),/changed ZIP 90001's current answer/);
  assert.equal(reads,2);
  reads=0;
  const page=await buildPageBody('zip:90001','place','CA',query);
  assert.equal(page.readyCurrent.bodies.length,1);
  assert.equal(reads,1);
});

test("a publication arriving during the data snapshot keeps its generation queued without aborting the built page", async () => {
  const db=await factDb({withHourlyCounts:true});
  const id='ocd-division/country:us/state:az/county:pima';
  try {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Pima County','AZ')",[id]);
    await db.query("INSERT INTO rebuild_queue(place_id) VALUES($1)",[id]);
    let arrival=false,snapshotLocks=0;
    const wrapped:FactDb={transaction:async run=>{
      let snapshot=false;
      const result=await db.transaction(query=>run(async(text,args)=>{
        if(text==='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')snapshot=true;
        if(text===PLACE_PACKAGE_SQL)return[rawPage(id)];
        if(snapshot && /FROM rebuild_queue[\s\S]*FOR UPDATE/.test(text)) {
          snapshotLocks++;
          throw Object.assign(new Error('could not serialize access due to concurrent update'),{code:'40001'});
        }
        return query(text,args);
      }));
      if(snapshot&&!arrival) {
        arrival=true;
        await db.query("UPDATE rebuild_queue SET generation=generation+1 WHERE place_id=$1",[id]);
      }
      return result;
    }};
    const purges:string[][]=[];
    const result=await rebuildPlacePages({db:wrapped,limit:1,concurrency:1,purge:async selected=>{purges.push([...selected]);return{purged:true};}});
    assert.deepEqual(result,{rebuilt:1,failed:0,remaining:1});
    assert.equal(snapshotLocks,0,'the lease is locked only after leaving the data snapshot');
    assert.deepEqual(purges,[readerCacheTags({places:[id]})]);
    assert.equal(Number((await db.query("SELECT version FROM place_page WHERE place_id=$1",[id]))[0]!.version),1);
    const [queued]=await db.query("SELECT generation,lease_token,lease_slot,lease_until FROM rebuild_queue WHERE place_id=$1",[id]);
    assert.equal(Number(queued!.generation),2);
    assert.equal(queued!.lease_token,null);
    assert.equal(queued!.lease_slot,null);
    assert.equal(queued!.lease_until,null);
  }finally{await db.pg.close();}
});

test("overlapping scheduled invocations share four page leases and reclaim an expired slot", async () => {
  const db=await factDb({withHourlyCounts:true});
  try {
    for(let n=1;n<=5;n++) {
      const id=`ocd-division/country:us/state:az/county:test${n}`;
      await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$1,'AZ')",[id]);
      await db.query(`INSERT INTO rebuild_queue(place_id,lease_token,lease_until,lease_slot)
        VALUES($1,$2,CASE WHEN $2::text IS NOT NULL THEN clock_timestamp()+interval '5 minutes' END,$3)`,
      [id,n<=4?`running${n}`:null,n<=4?n:null]);
    }
    const wrapped:FactDb={transaction:run=>db.transaction(query=>run(async(text,args)=>
      text===PLACE_PACKAGE_SQL?[rawPage(String(args?.[1] && (args[1] as string[])[0]))]:query(text,args)))};
    assert.deepEqual(await rebuildPlacePages({db:wrapped,limit:1,concurrency:1,purge:async()=>({purged:true})}),
      {rebuilt:0,failed:0,remaining:5});
    await db.query("UPDATE rebuild_queue SET lease_until=clock_timestamp()-interval '1 second' WHERE lease_slot=2");
    assert.deepEqual(await rebuildPlacePages({db:wrapped,limit:1,concurrency:1,purge:async()=>({purged:true})}),
      {rebuilt:1,failed:0,remaining:4});
    const [active]=await db.query("SELECT count(*)::int AS n FROM rebuild_queue WHERE lease_slot IS NOT NULL");
    assert.equal(active!.n,3,'the completed page releases its reclaimed slot');
  }finally{await db.pg.close();}
});
