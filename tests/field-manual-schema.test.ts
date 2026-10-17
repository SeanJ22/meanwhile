import assert from "node:assert/strict";
import test from "node:test";

import { BOOTSTRAP_DDL, BOOTSTRAP_VERSION, DECLARED_TABLES, FIELD_MANUAL_ENTRIES_KIND_INDEX_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { entryInSlice, newFieldManualEntry, normalizeEntry, type FieldManualQuery } from "../lib/control-plane/field-manual.ts";
import { openHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";
import { FIELD_MANUAL_SLICE_SQL, fieldManualSliceParams, pgFieldManualRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { createFixMapRepository, FIX_MAP_DDL, methodWorksOf, stateOfPlace, type FixMapRow } from "../lib/method/fix-map.ts";
import { MANUAL_ORDER_INDEXES } from "../lib/control-plane/repository/field-manual-sql.ts";
import { sourceHintsOf } from "../lib/control-plane/field-manual-sources.ts";

test("bootstrap declares the manual rows and indexed method aggregates, one statement per entry", () => {
  assert.ok(BOOTSTRAP_VERSION >= 32);
  assert.ok(DECLARED_TABLES.includes("cp_field_manual_entries"));
  assert.ok(DECLARED_TABLES.includes("cp_fix_map"));
  assert.equal(DECLARED_TABLES.includes("cp_field_manual"),false);
  for (const ddl of [...FIX_MAP_DDL, FIELD_MANUAL_ENTRIES_KIND_INDEX_DDL]) {
    assert.ok(BOOTSTRAP_DDL.includes(ddl));
    assert.equal(ddl.replace(/\$\$[\s\S]*?\$\$/g, "").trim().split(";").filter((part) => part.trim() !== "").length, 1, "the HTTP driver prepares one statement per query");
  }
});

test("a slice is asked of Postgres by role, kind, record class, platform and the job's place and state", () => {
  const params = fieldManualSliceParams({ role: "SCOUT", recordClass: "Meetings", platform: "Legistar", withinState: "AZ",
    ocdIds: ["ocd-division/country:us/state:az/county:pima/place:tucson#governing"] });
  assert.deepEqual(params, [["SCOUT", "SHARED"], null, "meetings", false,
    ["ocd-division/country:us", "ocd-division/country:us/state:az", "ocd-division/country:us/state:az/county:pima",
      "ocd-division/country:us/state:az/county:pima/place:tucson"], "legistar", "az",null,null,
      ["ocd-division/country:us/state:az/county:pima/place:tucson"],null,null,[],"az"]);
  assert.deepEqual(fieldManualSliceParams({ kinds: ["PLAYBOOK"], everywhere: true }).slice(0, 4), [null, ["PLAYBOOK"], null, true]);
});

test("where a method works is read per method, never the whole map", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const repo = createFixMapRepository(async (sql, params) => { calls.push({ sql, params }); return []; });
  assert.equal((await repo.worksFor([])).size, 0);
  assert.equal(calls.length, 0, "no methods, no read");
  await repo.worksFor(["a", "b", "a"]);
  await repo.workingMethods(50);
  assert.match(calls[0]!.sql, /FROM unnest\(\$1::text\[\]\) AS methods/);
  assert.deepEqual(calls[0]!.params, [["a", "b"]]);
  assert.match(calls[1]!.sql, /DISTINCT ON \(method_id\) \* FROM cp_fix_map WHERE state = 'WORKS'/);
  assert.deepEqual(calls[1]!.params, [50]);
  const row = (placeId: string, at: string, state: FixMapRow["state"] = "WORKS"): FixMapRow =>
    ({ methodId: "m", placeId, state, triedAt: at, attemptId: null, cause: null, updatedAt: at });
  const held = methodWorksOf([row("ocd-division/country:us/state:az/county:pima", "2026-10-01T00:00:00Z"),
    row("ocd-division/country:us/state:nj/county:morris", "2026-10-03T00:00:00Z"), row("ocd-division/country:us/state:nh/place:concord", "2026-10-02T00:00:00Z", "FAILS")], ["m"]);
  assert.deepEqual(held.get("m"), { places: ["ocd-division/country:us/state:nj/county:morris", "ocd-division/country:us/state:az/county:pima"], states: ["az", "nj"] });
  assert.equal(stateOfPlace("ocd-division/country:us/state:tx/county:harris#governing"), "tx");
});

test("a runner slice reads scoped SQL and never opens or rewrites a national held copy", async () => {
  const NOW = "2026-10-08T12:00:00.000Z";
  const entry = normalizeEntry(newFieldManualEntry("t", "az-lesson", { role: "SCOUT", kind: "LESSON", title: "AZ lesson", summary: "s", outcome: "YIELDED", states: ["az"] }));
  const seen: string[] = [];
  const sql: Sql = { query: async text => { seen.push(text); return [{ id: entry.id, revision: 1, updated_at: NOW, value: entry }]; } };
  const dir = await mkdtemp(join(tmpdir(), "manual-copies-"));
  const copies = openHeldCopies(dir, { log: line => assert.fail(line) });
  const held = pgFieldManualRepository(sql,{copies},()=>createFixMapRepository(async()=>[]));
  assert.deepEqual((await held.select({ role: "SCOUT", state: "az",limit:12 })).store.entries, [entry]);
  assert.deepEqual(seen, [FIELD_MANUAL_SLICE_SQL]);
  assert.deepEqual(await readdir(dir), []);
});

test("SQL manual slices exclude other places and source routes while preserving transferable methods and ranking", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { projectFieldManual } = await import("../lib/control-plane/field-manual.ts");
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE cp_field_manual_entries (id text PRIMARY KEY, revision integer, updated_at timestamptz, value jsonb)");
    for(const ddl of FIX_MAP_DDL)await db.exec(ddl);
    for (const ddl of BOOTSTRAP_DDL.filter(ddl => ddl.startsWith("CREATE INDEX") && /cp_field_manual_(reach|everywhere|transferable|platform_reach)/.test(ddl))) await db.exec(ddl);
    await db.exec(FIELD_MANUAL_ENTRIES_KIND_INDEX_DDL);
    const states = ["al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc"];
    const entries = states.flatMap(state => Array.from({ length: 30 }, (_, i) => normalizeEntry(newFieldManualEntry("t", `${state}-${i}`, {
      role: "HUNTER", kind: "ROUTE", title: `${state} ${i}`, summary: "A place's source", outcome: "YIELDED", states: [state],
      ocdIds: [`ocd-division/country:us/state:${state}/county:${i}`], url: `https://${state}-${i}.gov` }))));
    entries.push(normalizeEntry(newFieldManualEntry("t", "transferable", { role: "SHARED", kind: "METHOD", title: "Shared method", summary: "Read the API", outcome: "YIELDED", platforms: ["legistar"] })));
    entries.push(...(["SCOUT", "HUNTER", "SHARED"] as const).map(role => normalizeEntry(newFieldManualEntry("t", `playbook-${role}`, {
      role, kind: "PLAYBOOK", title: role, summary: "Shared role instructions", outcome: "REFERENCE", portable: true }))));
    entries.push(...Array.from({ length: 18 }, (_, i) => normalizeEntry(newFieldManualEntry("t", `note-${i}`, {
      role: "HUNTER", kind: "NOTE", title: `Note ${i}`, summary: "Local instructions", outcome: "YIELDED",
      ocdIds: ["ocd-division/country:us/state:az/county:12"] }))));
    entries.push(...[
      { key: "state", kind: "LESSON", states: ["az"], recordClasses: ["meetings"] },
      { key: "body", kind: "LESSON", bodyIds: ["Council"] },
      { key: "portable", kind: "LESSON", portable: true, platforms: ["civicplus"] },
      { key: "other-method", kind: "METHOD", platforms: ["civicplus"] },
    ].map(({ key, ...fields }) => normalizeEntry(newFieldManualEntry("t", key, {
      role: "HUNTER", title: key, summary: "A bounded shared instruction", outcome: "YIELDED", ...fields }))));
    await db.query("INSERT INTO cp_field_manual_entries SELECT e->>'id', 1, now(), e FROM jsonb_array_elements($1::jsonb) e", [JSON.stringify(entries)]);
    await db.exec("ANALYZE cp_field_manual_entries");
    const query: FieldManualQuery = { role: "HUNTER", ocdIds: ["ocd-division/country:us/state:az/county:12"], limit: 12 };
    const sql={query:async(text:string,params?:readonly unknown[])=>(await db.query(text,[...params??[]])).rows};
    const map=createFixMapRepository(async(text,params)=>(await db.query<Record<string,unknown>>(text,[...params])).rows);
    const repo=pgFieldManualRepository(sql,{},()=>map);
    const page=await repo.select(query),actual=page.store.entries;
    const expected = entries.filter(entry => entryInSlice(entry, query));
    assert.equal(actual.length, 12);
    assert.deepEqual(actual.map(entry=>entry.id),projectFieldManual({entries:expected},query).entryIds);
    assert.deepEqual(page.projection,projectFieldManual({entries:expected},query));
    assert.equal(projectFieldManual({ entries: actual }, query).lines.length, 12);
    assert.ok(Buffer.byteLength(JSON.stringify(actual)) < 15000);
    const selections:FieldManualQuery[]=[
      { ...query, platform: "Legistar" },{...query,withinState:"az"},{...query,withinState:"NH"}, { ...query, state: "AZ", recordClass: "Meetings" },
      { ...query, ocdIds: query.ocdIds!.map(place => place.toUpperCase()), bodyIds: ["Council"] },
      { role: "SCOUT" as const }, { kinds: [] }, { ...query, everywhere: true, platform: "legistar" }, {},
    ];
    for(const selection of selections) {
      const page=await repo.select(selection),sliced=page.store.entries;
      const matched=entries.filter(entry=>entryInSlice(entry,selection)),expected=projectFieldManual({entries:matched},selection);
      assert.deepEqual(sliced.map(entry=>entry.id).sort(),[...(selection.limit===undefined?matched.map(entry=>entry.id):expected.entryIds)].sort(),JSON.stringify(selection));
      assert.deepEqual(page.projection,expected);
    }
    const plan = await db.query(`EXPLAIN ${FIELD_MANUAL_SLICE_SQL}`, fieldManualSliceParams(query));
    assert.match(JSON.stringify(plan.rows), /cp_field_manual_reach_places/);
    const playbook = { role: "SCOUT" as const, kinds: ["PLAYBOOK"], everywhere: true };
    assert.equal((await repo.select(playbook)).store.entries.length, 2);
    const globalPlan = await db.query(`EXPLAIN ${FIELD_MANUAL_SLICE_SQL}`, fieldManualSliceParams({...playbook,limit:12}));
    assert.match(JSON.stringify(globalPlan.rows), /cp_field_manual_entries_kind/);
  } finally { await db.close(); }
});

test("Census government note slices retain the exact place key and its state",()=>{
  const parameters=fieldManualSliceParams({role:"SCOUT",ocdIds:["government:US-AZ:123456"]});
  assert.deepEqual(parameters[4],["government:us-az:123456"]);
  assert.equal(parameters[6],"az");
});

test("source hints keep successful routes beyond the advisory limit and reduce history per publisher",async()=>{
  const {PGlite}=await import("@electric-sql/pglite");
  const db=new PGlite(),origin="https://state.gov/",scope={state:"az"};
  const make=(key:string,fields:Partial<import("../lib/control-plane/field-manual.ts").FieldManualEntry>)=>normalizeEntry(newFieldManualEntry("source-hints",key,{
    role:"SCOUT",kind:"LESSON",title:key,summary:key,outcome:"YIELDED",states:["az"],observedAt:"2026-10-01T00:00:00.000Z",...fields}));
  const entries=[make("worked",{role:"DETECTIVE",url:"https://state.gov/route",recordClasses:["ballot"]}),
    make("failed",{url:"https://state.gov/route",outcome:"FAILED",recordClasses:["meetings"],observedAt:"2026-10-02T00:00:00.000Z"}),
    make("default-port",{url:"https://User@STATE.gov:443/other",recordClasses:["election"]}),
    make("sibling",{url:"https://state.gov.evil.example/route"}),
    make("other-state",{url:"https://state.gov/nh",states:["nh"]}),
    ...Array.from({length:60},(_,n)=>make(`noise-${n}`,{observedAt:"2026-10-10T00:00:00.000Z"}))];
  try {
    await db.exec("CREATE TABLE cp_field_manual_entries(id text PRIMARY KEY,revision integer,updated_at timestamptz,value jsonb)");
    for(const ddl of MANUAL_ORDER_INDEXES)await db.exec(ddl);
    for(const ddl of FIX_MAP_DDL)await db.exec(ddl);
    await db.query("INSERT INTO cp_field_manual_entries SELECT value->>'id',1,now(),value FROM jsonb_array_elements($1::jsonb) value",[JSON.stringify(entries)]);
    const sql={query:async(text:string,params?:readonly unknown[])=>(await db.query(text,[...params??[]])).rows};
    const repo=pgFieldManualRepository(sql,{},()=>createFixMapRepository(async()=>[]));
    const advisory=await repo.select({...scope,limit:40});
    assert.equal(advisory.store.entries.length,40);
    assert.ok(!advisory.store.entries.some(entry=>entry.url!==null));
    const hints=await repo.sourceHints(scope,origin);
    assert.deepEqual(hints,sourceHintsOf(entries,scope,origin));
    assert.equal(hints.length,2);
    assert.deepEqual(hints.find(hint=>hint.url.endsWith("/route")),{
      url:"https://state.gov/route",outcome:"FAILED",observedAt:"2026-10-02T00:00:00.000Z",worked:true,workedFor:["ballot"],
    });
    assert.ok(Buffer.byteLength(JSON.stringify(hints))<500);
  }finally{await db.close();}
});

test("bounded SQL notes retain producer proof, failed-here exclusions and Scout blank priorities",async()=>{
  const {PGlite}=await import("@electric-sql/pglite");
  const {createMemoryRepositories}=await import("../lib/control-plane/repository/memory.ts");
  const {scoutFieldManualQuery}=await import("../lib/control-plane/scheduler/field-manual-scout.ts");
  const db=new PGlite(),memory=createMemoryRepositories(),at="2026-10-16T10:00:00.000Z",place="government:US-AZ:123456";
  try {
    await db.exec("CREATE TABLE cp_field_manual_entries(id text PRIMARY KEY,revision integer,updated_at timestamptz,value jsonb)");
    for(const ddl of FIX_MAP_DDL)await db.exec(ddl);
    const make=(key:string,kind:string="METHOD",fields:Partial<import("../lib/control-plane/field-manual.ts").FieldManualEntry>={})=>normalizeEntry(newFieldManualEntry("bounded",key,{
      role:"SCOUT",kind,title:key,summary:key,outcome:"REFERENCE",observedAt:at,platforms:["legistar"],...fields}));
    const entries=[make("works"),make("fails", "METHOD",{ocdIds:[place],outcome:"YIELDED"}),
      make("legacy-fails","METHOD",{ocdIds:[place],placeResults:[{place:place.toLowerCase(),outcome:"FAILED",observedAt:at}]}),
      make("untried","METHOD",{ocdIds:[place],outcome:"YIELDED"}),make("state"),make("three-states"),make("two-states"),make("no-proof"),
      make("legacy-three","METHOD",{placeResults:["ca","nh","tx"].map(state=>({place:`state:${state}`,outcome:"YIELDED" as const,observedAt:at}))}),
      ...([["legacy-one",["nh"]],["legacy-two",["nh","tx"]],["legacy-here",["az"]]] as const).map(([key,states])=>make(key,"METHOD",{
        placeResults:states.map(state=>({place:`state:${state}`,outcome:"YIELDED" as const,observedAt:at}))})),
      make("own-generic","LESSON",{ocdIds:[place],outcome:"YIELDED",recordClasses:[]}),
      make("candidate","LESSON",{states:["az"],outcome:"YIELDED",recordClasses:["candidate-enrichment"]}),
      make("permission","LESSON",{ocdIds:[place],outcome:"YIELDED",recordClasses:["permission"]}),
      make("exhausted","EXHAUSTED_RUNGS",{ocdIds:[place],outcome:"ZERO",recordClasses:["candidate-enrichment"],payload:{subjectId:place}}),
      make("other-blank","EXHAUSTED_RUNGS",{ocdIds:[place],outcome:"ZERO",recordClasses:["meetings"],payload:{subjectId:place}}),
      make("other-subject","EXHAUSTED_RUNGS",{ocdIds:[place],payload:{subjectId:"unrelated"}}),
      make("bookkeeping","WRITE_HEALTH",{states:["az"]}),make("playbook","PLAYBOOK",{portable:true}),
      ...Array.from({length:240},(_,index)=>make(`shared-${index}`,index%23===0?"EXHAUSTED_RUNGS":"LESSON",{
        role:index%4===0?"SHARED":"SCOUT",portable:true,
        outcome:(["YIELDED","ZERO","FAILED","BLOCKED","REFERENCE"] as const)[index%5]!,
        observedAt:new Date(Date.parse(at)+index*1000).toISOString(),
        recordClasses:index%3===0?[]:index%3===1?["candidate-enrichment"]:["meetings"],
        platforms:index%7===0?["civicplus"]:["legistar"],
        ocdIds:index%11===0?[place]:[],states:index%13===0?["az"]:[],
        payload:{subjectId:index%2===0?place:"unrelated"},
      })),
      ...Array.from({length:20},(_,index)=>make(`state-${index}`,"LESSON",{states:["az"],outcome:"YIELDED"}))];
    await memory.fieldManual.insertNew(entries,at);
    await db.query("INSERT INTO cp_field_manual_entries SELECT value->>'id',1,$2::timestamptz,value FROM jsonb_array_elements($1::jsonb) value",[JSON.stringify(entries),at]);
    const map=createFixMapRepository(async(text,params)=>(await db.query<Record<string,unknown>>(text,[...params])).rows);
    const byTitle=new Map(entries.map(entry=>[entry.title,entry.id]));
    const put=async(title:string,where:string,state:FixMapRow["state"])=>{
      const row:FixMapRow={methodId:byTitle.get(title)!,placeId:where,state,triedAt:at,attemptId:title,cause:null,updatedAt:at,supersededAttemptId:null};
      await map.put(row);await memory.fixMap.put(row);
    };
    await put("works",place,"WORKS");await put("fails",place,"FAILS");await put("untried",place,"UNTRIED");
    await put("state","ocd-division/country:us/state:az/place:other","WORKS");
    for(const state of ["ca","nh","tx"])await put("three-states",`ocd-division/country:us/state:${state}/place:other`,"WORKS");
    for(const state of ["ca","nh"])await put("two-states",`ocd-division/country:us/state:${state}/place:other`,"WORKS");
    const sql={query:async(text:string,params?:readonly unknown[])=>(await db.query(text,[...params??[]])).rows};
    const pg=pgFieldManualRepository(sql,{},()=>map);
    const queries:FieldManualQuery[]=[{role:"SCOUT",subjectId:place,ocdIds:[place],state:"az",platform:"legistar",limit:12},
      {role:"SCOUT",subjectId:place,ocdIds:[place],state:"az",limit:1000},
      scoutFieldManualQuery({subjectId:place,divisions:[place],recordClasses:["candidate-enrichment"],limit:4}),
      scoutFieldManualQuery({subjectId:place,divisions:[place],limit:6}),
      {role:"SCOUT",ocdIds:["government:US-NH:654321"],state:"nh",limit:7},
      {role:"SCOUT",ocdIds:["government:US-NH:654321"],state:"nh",platform:"civicplus",limit:12},
      {role:"SHARED",recordClass:"meetings",limit:12},
      {role:"SCOUT",subjectId:place,ocdIds:[place],state:"az",everywhere:true,platform:"legistar",limit:12},
      {role:"SCOUT",subjectId:place,state:"az",preferredRecordClasses:["no-saved-class"],limit:12},
      {role:"SCOUT",subjectId:place,state:"az",preferredRecordClasses:["meetings"],limit:12},
      {role:"SCOUT",state:"az",limit:0}];
    for(const query of queries) {
      const expected=await memory.fieldManual.select(query),actual=await pg.select(query);
      assert.deepEqual(actual,expected,JSON.stringify(query));
      assert.ok(actual.store.entries.length<=query.limit!);
      if(query.ocdIds?.includes(place)) {
        assert.ok(!actual.projection.entryIds.includes(byTitle.get("fails")!));
        assert.ok(!actual.projection.entryIds.includes(byTitle.get("legacy-fails")!));
      }
    }
    const full=await pg.select(queries[1]),tiers=new Map(full.projection.entryIds.map((id,index)=>[id,full.projection.tiers[index]]));
    for(const [title,tier] of [["works",1],["untried",1],["state",2],["three-states",3],["legacy-three",3],["legacy-one",4],["legacy-two",4],["legacy-here",2],["two-states",4],["no-proof",5]] as const)assert.equal(tiers.get(byTitle.get(title)!),tier,title);
  }finally{await db.close();}
});

test("maturity reads indexed route IDs without returning unrelated national route payloads",async()=>{
  const {PGlite}=await import("@electric-sql/pglite");
  const {learnedRouteIds}=await import("../lib/method/manual-bridge.ts");
  const db=new PGlite();
  try {
    await db.exec("CREATE TABLE cp_field_manual_entries(id text PRIMARY KEY,revision integer,updated_at timestamptz,value jsonb)");
    for(const ddl of MANUAL_ORDER_INDEXES)await db.exec(ddl);
    const entries=Array.from({length:1000},(_,index)=>newFieldManualEntry("route-summary",String(index),{
      role:"SHARED",kind:"ROUTE",title:"Learned route",summary:"Indexed metadata",outcome:"YIELDED",
      payload:index%2?{routeId:`route-${index}`,body:"x".repeat(4000)}:{id:`route-${index}`,body:"x".repeat(4000)}}));
    entries.push(newFieldManualEntry("route-summary","malformed",{role:"SHARED",kind:"ROUTE",title:"Wrong ID type",summary:"Invalid ID falls through",outcome:"YIELDED",payload:{id:7,routeId:"fallback-route"}}));
    await db.query("INSERT INTO cp_field_manual_entries SELECT value->>'id',1,now(),value FROM jsonb_array_elements($1::jsonb) value",[JSON.stringify(entries)]);
    const sql={query:async(text:string,params?:readonly unknown[])=>(await db.query(text,[...params??[]])).rows};
    const repo=pgFieldManualRepository(sql,{},()=>createFixMapRepository(async()=>[]));
    const routeIds=["route-7","route-8","route-8","not-learned","fallback-route"];
    assert.deepEqual(await repo.learnedRoutes(routeIds),{present:true,routeIds:[...new Set(routeIds)].filter(id=>learnedRouteIds({entries}).has(id)).sort()});
    assert.deepEqual(await repo.learnedRoutes([]),{present:true,routeIds:[]});
    assert.ok(Buffer.byteLength(JSON.stringify(await repo.learnedRoutes(routeIds)))<100);
    await db.exec("DELETE FROM cp_field_manual_entries");
    assert.deepEqual(await repo.learnedRoutes(routeIds),{present:false,routeIds:[]});
  }finally{await db.close();}
});
