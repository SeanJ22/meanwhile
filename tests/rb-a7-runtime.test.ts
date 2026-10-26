import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { queueUnbuiltPlacePages, prepareProductionPlacePages, seedZipPagePlaces, seedRuntimeBodyPageSubjects } from "../scripts/prepare-place-pages.mts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import { buildPageBody,PLACE_PACKAGE_SQL, rebuildPlacePages } from "../lib/reader/place-builder.ts";
import { unpackReadyPlace, unpackReadyTerritory } from "../lib/reader/place-ready.ts";
import { readerCacheTags,enqueueReaderPlaces } from "../lib/reader/cache.ts";
import { factDb } from "./helpers/fact-db.ts";

test("the deployment queues every place and body that has no ready page for the runner", async () => {
  const db = await factDb();
  try {
    const built = "ocd-division/country:us/state:az/county:built", unbuilt = "ocd-division/country:us/state:az/county:unbuilt";
    for (const [id, kind] of [[built, "place"], [unbuilt, "place"], [`${unbuilt}#board`, "body"], ["ocd-person/one", "person"]])
      await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,$2,$1,'AZ')", [id, kind]);
    await db.query("INSERT INTO place_page(place_id,version,built_at,body) VALUES($1,1,now(),'{}'::jsonb)", [built]);
    assert.equal(await queueUnbuiltPlacePages(db.query), 2);
    assert.deepEqual((await db.query("SELECT place_id FROM rebuild_queue ORDER BY place_id")).map(row => row.place_id),
      [unbuilt, `${unbuilt}#board`]);
    assert.equal(await queueUnbuiltPlacePages(db.query), 0, "a page already queued keeps its place in line");
  } finally { await db.pg.close(); }
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
  assert.equal(n,2);
  assert.deepEqual(saved,[{id:'zip:85001',name:'ZIP 85001',state:'AZ',parent_id:root},
    {id:'zip:85002',name:'ZIP 85002',state:'AZ',parent_id:null}]);
  assert.deepEqual(dependencies,[{page_id:'zip:85001',entity_id:'ocd-division/country:us/state:ca'},
    {page_id:'zip:85001',entity_id:root},{page_id:'zip:85001',entity_id:'az:city:phoenix#governing'},
    {page_id:'zip:85002',entity_id:'az:city:phoenix#governing'}]);
});

test("runtime-only bodies get their existing canonical IDs without overwriting held subjects",async()=>{
  const db=await factDb();
  const state='ocd-division/country:us/state:az',city=`${state}/place:tucson`;
  try {
    await db.pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,payload jsonb);
      CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);`);
    const functions=readFileSync(new URL('../lib/db/migrations/0036_ne01.sql',import.meta.url),'utf8')
      .split('--> statement-breakpoint').filter(sql=>/^\s*CREATE FUNCTION reader_payload_(?:value|node|members)\(/.test(sql));
    for(const sql of functions)await db.pg.exec(sql);
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Arizona','AZ',NULL),($2,'place','Tucson','AZ',$1)",[state,city]);
    await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
      ('held-body','body','Held verified name','AZ',$1),('canonical-body','body','Held canonical name','AZ',$1),
      ('foreign-body','body','California board','CA',NULL)`,[city]);
    await db.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES('canonical-body','body-alias','prior-body'),('foreign-body','body-alias','foreign-alias')");
    const registry={bodies:[
      {id:'new-body',name:'New published board',ocdId:city},
      {id:'held-body',name:'A newer projection spelling',ocdId:city},
      {id:'prior-body',name:'A prior spelling',ocdId:city},
      {id:'unplaced-body',name:'Published board without a held division',ocdId:`${state}/place:unknown`},
      {id:'foreign-alias',name:'A California board',ocdId:city},
    ]};
    const hash='a'.repeat(64);
    await db.query('INSERT INTO civic_data_payload_parts VALUES($1,$2::jsonb)',[hash,JSON.stringify(registry)]);
    await db.query("INSERT INTO civic_data_promotions VALUES('REGISTRY_RUNTIME_BINDING:US-AZ:reader-registry-runtime','REGISTRY_RUNTIME_BINDING',$1::jsonb)",
      [JSON.stringify({registry:{$civicPayloadPart:hash}})]);
    assert.equal(await seedRuntimeBodyPageSubjects(db.query,['AZ']),2);
    assert.deepEqual((await db.query("SELECT id,name,state,parent_id FROM entity WHERE id IN ('new-body','unplaced-body','held-body','canonical-body') ORDER BY id")),[
      {id:'canonical-body',name:'Held canonical name',state:'AZ',parent_id:city},
      {id:'held-body',name:'Held verified name',state:'AZ',parent_id:city},
      {id:'new-body',name:'New published board',state:'AZ',parent_id:city},
      {id:'unplaced-body',name:'Published board without a held division',state:'AZ',parent_id:null},
    ]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM entity WHERE id IN ('prior-body','foreign-alias')"))[0]!.n,0);
    assert.equal(await seedRuntimeBodyPageSubjects(db.query,['AZ']),0,'an unchanged publication never replaces an existing identity');
  }finally{await db.pg.close();}
});

const rawPage=(id:string)=>({division_ids:[id],entities:[],fields:[],rosters:[],comments:[],sittings:[],
  meeting_rows:[],archived_meetings:[],archived_documents:[],parts:{},registry:null,governments:[],divisions:[]});

test("a state-root rebuild never loads the statewide meeting corpus",async()=>{
  const state='ocd-division/country:us/state:az';
  const selections:unknown[][]=[];
  const query:Query=async(text,args=[])=>{
    assert.equal(text,PLACE_PACKAGE_SQL);
    assert.equal(args[4],false,'all-body jobs read bounded body pages instead of one statewide source corpus');
    selections.push([...args]);
    return[{...rawPage(state),division_ids:args[1]}];
  };
  const result=await buildPageBody(state,'place','AZ',query);
  assert.equal(selections.length,2,'the root and empty selection are the only source reads');
  assert.ok(result.emptyCurrent&&result.emptyHistory);
  assert.ok(!Object.hasOwn(result,'allCurrent')&&!Object.hasOwn(result,'allHistory'));
});

test("ZIP construction reads one current projection without agenda or history data",async()=>{
  const id='ocd-division/country:us/state:ca/place:los_angeles';
  let reads=0;
  const query:Query=async(_sql,args)=>{
    reads++;
    assert.equal(args?.[5],false);
    assert.equal(args?.[6],false);
    return[{...rawPage(id),entities:[{id:`${id}#board`,division:id,kind:'body',state:'CA'}]}];
  };
  const page=await buildPageBody('zip:90001','place','CA',query);
  assert.equal(page.readyCurrent.bodies.length,1);
  assert.equal(page.history,undefined);
  assert.equal(page.readyHistory,undefined);
  assert.equal(page.territory,null,"a ZIP without state territory geometry records that selection explicitly");
  assert.equal(reads,1);
});

test("a ZIP worker stores only its ready current page and retains the serving dependencies",async()=>{
  const db=await factDb({withHourlyCounts:true});
  const zip='zip:90001',city='ocd-division/country:us/state:ca/place:los_angeles',body=`${city}#board`,fringe=`${city}/council_district:2`;
  try {
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','ZIP 90001','CA',NULL),($2,'place','Los Angeles','CA',NULL),($3,'body','Council','CA',$2),($4,'place','Neighbor district','CA',NULL)",
      [zip,city,body,fringe]);
    await db.query('INSERT INTO rebuild_queue(place_id) VALUES($1)',[zip]);
    let sourceReads=0;
    const wrapped:FactDb={transaction:run=>db.transaction(query=>run(async(text,args)=>{
      if(text!==PLACE_PACKAGE_SQL)return query(text,args);
      sourceReads++;
      assert.equal(args?.[5],false);
      assert.equal(args?.[6],false);
      return[{...rawPage(city),entities:[{id:body,kind:'body',state:'CA',division:city,parent_id:city}],divisions:[{ocdId:fringe}]}];
    }))};
    assert.deepEqual(await rebuildPlacePages({db:wrapped,limit:1,concurrency:1,purge:async()=>({purged:true})}),{rebuilt:1,failed:0,remaining:0});
    assert.equal(sourceReads,1);
    const [page]=await db.query('SELECT body,history_body,context FROM place_page WHERE place_id=$1',[zip]);
    assert.deepEqual(page!.history_body,{});
    assert.deepEqual(page!.context,{formatVersion:1});
    assert.equal((page!.body as {encoding:string}).encoding,'gzip-json-v1');
    assert.equal(unpackReadyPlace(page!.body).bodies.length,1);
    assert.equal(unpackReadyTerritory(page!.body),null);
    const dependencies=await db.query('SELECT entity_id FROM place_page_dependency WHERE page_id=$1 ORDER BY entity_id',[zip]);
    assert.deepEqual(dependencies.map(row=>row.entity_id),[zip,city,body,fringe].sort());
  }finally{await db.pg.close();}
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

test("a constantly changing place cannot reclaim its old queue position ahead of untouched places",async()=>{
  const db=await factDb({withHourlyCounts:true});
  const hot='ocd-division/country:us/state:az/county:pima',untouched='ocd-division/country:us/state:az/county:maricopa';
  try {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Pima','AZ'),($2,'place','Maricopa','AZ')",[hot,untouched]);
    await db.query(`INSERT INTO rebuild_queue(place_id,queued_at) VALUES
      ($1,clock_timestamp()-interval '10 minutes'),($2,clock_timestamp()-interval '9 minutes')`,[hot,untouched]);
    const visits:string[]=[];
    let firstPending:string|undefined;
    const wrapped:FactDb={transaction:async run=>{
      let built:string|undefined;
      const result=await db.transaction(query=>run(async(text,args)=>{
        if(text!==PLACE_PACKAGE_SQL)return query(text,args);
        built=String((args?.[1] as string[])[0]);
        visits.push(built);
        return[rawPage(built)];
      }));
      if(built===hot) {
        await enqueueReaderPlaces({places:[hot]},db.query);
        const [arrival]=await db.query('SELECT next_queued_at::text AS pending FROM rebuild_queue WHERE place_id=$1',[hot]);
        assert.ok(arrival!.pending,'the first unbuilt arrival has its own waiting time');
        firstPending=String(arrival!.pending);
      }
      return result;
    }};
    assert.deepEqual(await rebuildPlacePages({db:wrapped,limit:2,concurrency:1,purge:async()=>({purged:true})}),
      {rebuilt:2,failed:0,remaining:1});
    assert.deepEqual(visits,[hot,untouched]);
    const [waiting]=await db.query('SELECT place_id,generation,queued_at::text AS since,next_queued_at,lease_token FROM rebuild_queue');
    assert.equal(waiting!.place_id,hot);
    assert.equal(Number(waiting!.generation),2);
    assert.equal(waiting!.since,firstPending);
    assert.equal(waiting!.next_queued_at,null);
    assert.equal(waiting!.lease_token,null);
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
