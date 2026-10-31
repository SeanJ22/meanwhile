import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { prepareProductionPlacePages, seedRuntimeBodyPageSubjects } from "../scripts/prepare-place-pages.mts";
import type { Query } from "../lib/facts/publish.ts";
import { buildPageBody,PLACE_PACKAGE_SQL } from "../lib/reader/place-builder.ts";
import { queueUnbuiltPlacePages } from "../lib/reader/cache.ts";
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
    assert.deepEqual((await db.query("SELECT place_id FROM place_page WHERE stale_at IS NOT NULL ORDER BY place_id")).map(row => row.place_id),
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

