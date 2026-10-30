import {fixturePlaceBuild} from "./helpers/place-build-row.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { queueUnbuiltPlacePages, prepareProductionPlacePages, seedZipPagePlaces, seedRuntimeBodyPageSubjects } from "../scripts/prepare-place-pages.mts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import { buildPageBody,PLACE_PACKAGE_SQL, rebuildPlacePages } from "../lib/reader/place-builder.ts";
import { unpackReadyPlace, unpackReadyTerritory } from "../lib/reader/place-ready.ts";
import { readerCacheTags,enqueueReaderPlaces,UNBUILT_ZIP_PRIORITY } from "../lib/reader/cache.ts";
import { factDb } from "./helpers/fact-db.ts";
import { zipLocationMigration } from "./helpers/reader-identity-db.ts";
import { fillMissingZipLocations } from "../lib/place-map/location-import.ts";

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
  const db = await factDb();
  try {
    await db.pg.exec(zipLocationMigration());
    await db.pg.exec(`CREATE TABLE zip_place(zip text NOT NULL,place_id text NOT NULL REFERENCES entity(id),share double precision NOT NULL,
      boundary_year integer NOT NULL,PRIMARY KEY(zip,place_id,boundary_year))`);
    const root="ocd-division/country:us/state:az",county=`${root}/county:maricopa`,ca="ocd-division/country:us/state:ca";
    await db.query(`INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Arizona','AZ'),($2,'place','Maricopa','AZ'),
      ($3,'place','California','CA'),('az:city:phoenix#governing','body','Phoenix City Council','AZ')`,[root,county,ca]);
    const located=(zip:string,state:string,lat:number|null)=>({zip,boundary_year:2020,lat,lng:lat===null?null:-112,
      postal:{type:"standard",zcta:zip,place:"Phoenix",state},source_urls:["https://www2.census.gov/"],checked_at:"2026-10-01T00:00:00Z"});
    await db.query(`INSERT INTO zip_location(zip,boundary_year,lat,lng,postal,source_urls,checked_at)
      SELECT zip,boundary_year,lat,lng,postal,source_urls,checked_at FROM jsonb_to_recordset($1::jsonb)
        AS p(zip text,boundary_year integer,lat float8,lng float8,postal jsonb,source_urls jsonb,checked_at timestamptz)`,
      [JSON.stringify([located("85001","AZ",33),located("85002","AZ",33),located("85003","AZ",null),located("85004","AZ",33),located("90001","CA",34)])]);
    // 85002's only membership is across the line; 85004 has no membership and 85003 no display point.
    await db.query(`INSERT INTO zip_place(zip,place_id,share,boundary_year) VALUES
      ('85001',$1,1,2023),('85001',$2,1,2023),('85002',$2,1,2023),('85003',$1,1,2023),('90001',$2,1,2023)`,[county,ca]);
    const n=await seedZipPagePlaces(db.query,{states:["AZ"],bodies:async()=>()=>["az:city:phoenix#governing"],residents:async()=>({"85001":200})});
    assert.equal(n,2);
    assert.deepEqual(await db.query("SELECT id,name,state,parent_id,page_priority FROM entity WHERE id LIKE 'zip:%' ORDER BY id"),
      [{id:"zip:85001",name:"ZIP 85001",state:"AZ",parent_id:root,page_priority:201},{id:"zip:85002",name:"ZIP 85002",state:"AZ",parent_id:null,page_priority:1}]);
    assert.deepEqual(await db.query("SELECT page_id,entity_id FROM place_page_dependency ORDER BY page_id,entity_id"),
      [{page_id:"zip:85001",entity_id:"az:city:phoenix#governing"},{page_id:"zip:85001",entity_id:county},{page_id:"zip:85001",entity_id:ca},
        {page_id:"zip:85002",entity_id:"az:city:phoenix#governing"},{page_id:"zip:85002",entity_id:ca}]);
    assert.equal(await seedZipPagePlaces(db.query,{states:["AZ"],bodies:async()=>null,residents:async()=>({"85001":200})}),2,"a second deploy keeps the same identities");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM place_page_dependency"))[0].n,5);
  } finally { await db.pg.close(); }
});

test("a deploy writes only missing ZIP display points and never replaces a held one", async () => {
  const db = await factDb();
  try {
    await db.pg.exec(zipLocationMigration());
    await db.query(`INSERT INTO zip_location(zip,boundary_year,lat,lng,postal,source_urls,checked_at)
      VALUES('85701',2020,1,1,'{"state":"AZ"}','["https://example.test/"]','2026-01-01T00:00:00Z')`);
    const written = await fillMissingZipLocations(db.query, process.cwd());
    assert.ok(written > 40_000, "every postal state's acquired rows are written once");
    const [tucson] = await db.query("SELECT lat,checked_at FROM zip_location WHERE zip='85701'");
    assert.equal(tucson.lat, 1, "a held point is kept for the state's map import to update");
    const [phoenix] = await db.query("SELECT lat,lng,postal->>'state' AS state,source_urls FROM zip_location WHERE zip='85004'");
    assert.equal(phoenix.state, "AZ");
    assert.ok(Number(phoenix.lat) > 33 && Number(phoenix.lng) < -111);
    assert.equal(await fillMissingZipLocations(db.query, process.cwd()), 0, "a later deploy writes nothing");
  } finally { await db.pg.close(); }
});

test('production ZIP preparation fills existing priorities without requeueing or rewriting unchanged rows',async()=>{
  const db=await factDb();
  const root='ocd-division/country:us/state:az',ready='zip:85003',unbuilt='zip:85701';
  try {
    await db.pg.exec(zipLocationMigration());
    await db.pg.exec(`CREATE TABLE zip_place(zip text NOT NULL,place_id text NOT NULL REFERENCES entity(id),share double precision NOT NULL,
      boundary_year integer NOT NULL,PRIMARY KEY(zip,place_id,boundary_year))`);
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Arizona','AZ'),($2,'place','Held ZIP name','AZ'),($3,'place','Tucson ZIP','AZ')",[root,ready,unbuilt]);
    await db.query(`INSERT INTO zip_location(zip,boundary_year,lat,lng,postal,source_urls,checked_at) VALUES
      ('85003',2020,33,-112,'{"state":"AZ"}','["https://www2.census.gov/"]','2026-10-01T00:00:00Z'),
      ('85701',2020,32,-110,'{"state":"AZ"}','["https://www2.census.gov/"]','2026-10-01T00:00:00Z')`);
    await db.query("INSERT INTO zip_place(zip,place_id,share,boundary_year) VALUES('85003',$1,1,2023),('85701',$1,1,2023)",[root]);
    await db.query("INSERT INTO place_page(place_id,body) VALUES($1,'{}')",[ready]);
    await db.query('INSERT INTO rebuild_queue(place_id,generation) VALUES($1,7),($2,9)',[ready,unbuilt]);
    const seed=()=>seedZipPagePlaces(db.query,{states:['AZ'],bodies:async()=>null,residents:async()=>({'85003':200,'85701':100})});
    assert.equal(await seed(),2);
    const rows=()=>db.query('SELECT q.place_id,q.generation::int,q.priority,q.ctid::text AS queue_tuple,e.ctid::text AS entity_tuple FROM rebuild_queue q JOIN entity e ON e.id=q.place_id ORDER BY q.place_id');
    const first=await rows();
    assert.deepEqual(first.map(({place_id,generation,priority})=>({place_id,generation,priority})),
      [{place_id:ready,generation:7,priority:201},{place_id:unbuilt,generation:9,priority:UNBUILT_ZIP_PRIORITY+101}]);
    assert.equal((await db.query('SELECT name FROM entity WHERE id=$1',[ready]))[0]!.name,'Held ZIP name');
    await seed();assert.deepEqual(await rows(),first,'the next deployment leaves both tuple versions and generations unchanged');
  }finally{await db.pg.close();}
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
  agenda_documents:[],agenda_document_links:[],parts:{},registry:null,governments:[],divisions:[]});

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
      if(!text.includes(PLACE_PACKAGE_SQL))return query(text,args);
      sourceReads++;
      assert.equal(args?.[5],false);
      assert.equal(args?.[6],false);
      return fixturePlaceBuild(query,text,args,{...rawPage(city),entities:[{id:body,kind:'body',state:'CA',division:city,parent_id:city}],divisions:[{ocdId:fringe}]});
    }))};
    assert.deepEqual(await rebuildPlacePages({db:wrapped,limit:1,concurrency:1,purge:async()=>({purged:true})}),{rebuilt:1,failed:0,remaining:0});
    assert.equal(sourceReads,1);
    const [page]=await db.query('SELECT body,history_body,context FROM place_page WHERE place_id=$1',[zip]);
    assert.deepEqual(page!.history_body,{});
    assert.deepEqual(page!.context,{formatVersion:1});
    assert.equal((page!.body as {encoding:string}).encoding,'br-json-v1');
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
