import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assignmentPartOf, ASSIGNMENT_STATES, type AssignmentIndexRow } from "../lib/control-plane/assignment-view.ts";
import { expandControlCounts, contractControlCounts, OWNER_ASSIGNMENT_PARTS_SQL } from "../lib/control-plane/repository/migrations/CP-01-counts.ts";
import { CONTROL_COUNT_TABLES, controlCounts } from "../lib/control-plane/repository/control-counts.ts";
import { OWNER_ASSIGNMENT_ROWS_DDL, ownerAssignmentHeadOf, ownerAssignmentContributions, ownerRowJson, pgOwnerAssignmentRows } from "../lib/control-plane/repository/owner-assignment-rows.ts";
import { contractOwnerLive } from "../lib/control-plane/repository/migrations/CP-01-LIVE.ts";

test("control counts follow committed changes and owner migration retires blobs only after fresh contract catchup", async () => {
  const db = new PGlite();
  const sql = { query: async (text: string, params: readonly unknown[] = []) => (await db.query(text, [...params])).rows };
  try {
    for (const table of [...CONTROL_COUNT_TABLES,"cp_owner_snapshots","cp_work_items_archive"]) await db.exec(`CREATE TABLE ${table}(
      id text PRIMARY KEY,revision bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),changed_at timestamptz NOT NULL DEFAULT now(),value jsonb NOT NULL)`);
    await db.exec(`CREATE FUNCTION count_work_index_change(jsonb,jsonb,text,timestamptz,boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
      CREATE FUNCTION count_work_segments(v jsonb,scope text,at timestamptz) RETURNS TABLE(from_at timestamptz) LANGUAGE sql AS $$
        SELECT at FROM jsonb_array_elements(coalesce(v->'allRowsIndex','[]'::jsonb)) r $$;
      CREATE FUNCTION count_oldest_waiting(at timestamptz) RETURNS bigint LANGUAGE sql AS $$
        SELECT count(*) FROM cp_owner_snapshots s CROSS JOIN LATERAL count_work_segments(s.value,s.id,at) d
        WHERE s.id LIKE 'current:%' AND d.from_at<=at $$`);
    const at = "2026-10-28T16:00:00.000Z";
    const index = { id:"one",kind:"STANDING_OBLIGATION",lane:"ROUTINE",state:"WAITING",label:"One",subjectName:null,stateCode:"az",assignmentKeys:[],
      lastActivityAt:null,band:1,overdue:false,waitingSince:at,eligibleAt:at,blocker:null,owner:"FLEET",nextAction:"Read source" } as AssignmentIndexRow;
    const group = {members:["task-one"],usd:null,items:[],scoutKeys:[],obligation:{active:true,eligibleAt:at,backoff:false,subjectId:"state-az",assignments:[]},publications:[],clause:null};
    const part = {builtAt:at,assignments:assignmentPartOf([["one",{index,usd:null,obligation:group.obligation}]],at),publications:[],marks:{},obligations:{Arizona:1},spend:{attempts:0,usd:{sum:{p:[]},measured:0,unmeasured:0}}};
    for (const [id,value] of [["totals",{formatVersion:3,costs:{},assignments:{states:{az:part}}}],["totals:az",{builtAt:at,groups:{one:group},places:{},lists:{}}],
      ["current:az",{builtAt:at,allRowsIndex:[{...index,from:null,until:null}],bodyAttempts:[],spendByPlace:[]}]]) await db.query("INSERT INTO cp_owner_snapshots(id,value) VALUES($1,$2)",[id,JSON.stringify(value)]);
    await expandControlCounts(sql);
    assert.equal((await db.query<{value:Record<string,unknown>}>("SELECT value FROM cp_owner_snapshots WHERE id='totals:az'")).rows[0].value.groups !== undefined,true,"expand keeps the serving version readable");
    assert.equal((await pgOwnerAssignmentRows(sql).read(["one"]))[0].group.members[0],"task-one");
    await db.query("UPDATE cp_owner_snapshots SET value=jsonb_set(value,'{groups,one,members}',$1::jsonb) WHERE id='totals:az'",[JSON.stringify(["task-one","task-two"])]);
  await contractControlCounts(sql,{NODE_ENV:"test"}, {initialize:async()=>true});
    assert.deepEqual((await pgOwnerAssignmentRows(sql).read(["one"]))[0].group.members,["task-one","task-two"],"contract includes the last old-runner write");
    assert.equal((await db.query<{value:Record<string,unknown>}>("SELECT value FROM cp_owner_snapshots WHERE id='totals:az'")).rows[0].value.groups,undefined);
    assert.equal((await db.query<{value:Record<string,unknown>}>("SELECT value FROM cp_owner_snapshots WHERE id='current:az'")).rows[0].value.allRowsIndex,undefined);
    assert.equal((await db.query<{value:{formatVersion:number}}>("SELECT value FROM cp_owner_snapshots WHERE id='totals'")).rows[0].value.formatVersion,4);
    assert.equal(Number((await db.query<{n:string}>("SELECT count_oldest_waiting(now()) AS n")).rows[0].n),1,"hourly counts use the normalized rows after contract");
    const work = pgOwnerAssignmentRows(sql);
    const [entry] = await work.read(["one"]);
    const [savedCounts] = (await db.query<{value:import("../lib/control-plane/owner-snapshot-totals.ts").StateTotals}>("SELECT value FROM cp_owner_snapshots WHERE id='totals:az'")).rows;
    await assert.rejects(work.save([{...entry,group:{...entry.group,members:["uncommitted"]}}],[],[
      {id:"totals:az",expectedRevision:0,value:savedCounts.value},
    ]),/Owner counts changed/);
    assert.deepEqual((await work.read(["one"]))[0].group.members,["task-one","task-two"],"a rejected count write rolls back its work-list change");
    const door = {formatVersion:1,doorId:"door",kind:"calendar",bodyIds:[],hosts:[],status:"OPEN",updatedAt:at};
    await db.query("INSERT INTO cp_doors(id,value) VALUES('door',$1)",[JSON.stringify(door)]);
    assert.equal((await controlCounts(sql,"cp_doors",["*","OPEN"])).find(row=>row.bucket==='OPEN')?.count,1);
    await db.query("BEGIN");
    await db.exec("UPDATE cp_doors SET value=jsonb_set(value,'{status}','\"SHUT\"') WHERE id='door'");
    await db.query("ROLLBACK");
    assert.equal((await controlCounts(sql,"cp_doors",["OPEN"]))[0].count,1,"rollback also undoes the counter");
    await db.exec("UPDATE cp_doors SET value=jsonb_set(value,'{status}','\"SHUT\"') WHERE id='door'");
    const counts = await controlCounts(sql,"cp_doors",["*","OPEN","SHUT"]);
    assert.equal(counts.find(row=>row.bucket==='OPEN')?.count,0);
    assert.equal(counts.find(row=>row.bucket==='SHUT')?.count,1);
    assert.equal(counts.find(row=>row.bucket==='*')?.count,1);
    assert.equal(counts.find(row=>row.bucket==='*')?.generation,"2");
  } finally { await db.close(); }
});


test("server-side owner migration contributions equal direct assignment counts for every state and clock",async()=>{
  const db=new PGlite(),at="2026-10-28T16:00:00.000Z";
  try{
    for(const ddl of OWNER_ASSIGNMENT_ROWS_DDL)await db.exec(ddl);
    const expected=new Map<string,unknown>();
    for(const[stateIndex,state]of ASSIGNMENT_STATES.entries())for(const active of[true,false]){
      const id=`freshness:ask-gap:body-${stateIndex}-${active}#CALENDAR_STALE`;
      const index={id,kind:"STANDING_OBLIGATION",lane:"ROUTINE",state,label:"Fixture",subjectName:null,stateCode:stateIndex%2?null:"az",
        assignmentKeys:["hunt"],instructionStates:{"hunt#receipt":state},lastActivityAt:null,band:1,overdue:false,waitingSince:at,
        eligibleAt:at,blocker:null,owner:"FLEET",nextAction:"Read source"} as AssignmentIndexRow;
      const usd=stateIndex%2?{p:[.25]}:null,obligation={active,eligibleAt:stateIndex%3?at:null,backoff:stateIndex%2===0,subjectId:"subject",assignments:[]};
      expected.set(id,assignmentPartOf([[id,{index,usd,obligation}]],at));
      await db.query("INSERT INTO cp_owner_assignment_rows(id,state_code,value) VALUES($1,'az',$2::jsonb)",[id,JSON.stringify({id,state:"az",builtAt:at,
        group:{members:[],usd,items:[],scoutKeys:[],obligation,publications:[],clause:null},indexSegments:[{...index,from:null,until:null}],list:null,bodyAttempts:[],nextAt:null})]);
    }
    await db.query(OWNER_ASSIGNMENT_PARTS_SQL);
    for(const row of(await db.query<{id:string;part:unknown}>("SELECT id,value->'part' AS part FROM cp_owner_assignment_rows")).rows)
      assert.deepEqual(row.part,expected.get(row.id),row.id);
    assert.equal((await db.query<{n:string}>(OWNER_ASSIGNMENT_PARTS_SQL)).rows[0].n,"0","retries retain already-computed work-row contributions");
    await db.exec("CREATE TABLE cp_owner_snapshots(id text PRIMARY KEY,value jsonb NOT NULL,revision bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL)");
    const clocks=(await db.query<{clocks:Record<string,number>}>(`SELECT jsonb_build_object(
      'active',sum((value #>> '{part,clocks,active}')::bigint),'eligible',sum((value #>> '{part,clocks,eligible}')::bigint),
      'overdue',sum((value #>> '{part,clocks,overdue}')::bigint),'backoff',sum((value #>> '{part,clocks,backoff}')::bigint)) AS clocks
      FROM cp_owner_assignment_rows`)).rows[0].clocks;
    const state={builtAt:at,places:{preserved:1},inboxRun:"preserved",part:{builtAt:at,assignments:{total:expected.size,clocks},spend:{preserved:2}}};
    for(const[id,value]of [["totals:az",{...state,part:{...state.part,assignments:{...state.part.assignments,clocks:{...clocks,overdue:clocks.overdue-4}}}}],
      ["totals:empty",state],["totals:exact",{...state,part:{...state.part,assignments:{...state.part.assignments,clocks:{active:0,eligible:0,overdue:0,backoff:0}}}}],
      ["current",{publishedAt:at}],["totals",{formatVersion:4}]])
      await db.query("INSERT INTO cp_owner_snapshots(id,value,updated_at) VALUES($1,$2,$3)",[id,JSON.stringify(value),at]);
    const sql={query:async(text:string,params:readonly unknown[]=[]) => (await db.query(text,[...params])).rows};
    await contractOwnerLive(sql);
    const saved=async()=> (await db.query<{id:string;value:typeof state;revision:number;updated_at:Date}>("SELECT id,value,revision,updated_at FROM cp_owner_snapshots ORDER BY id")).rows;
    const repaired=await saved();
    assert.deepEqual(repaired.find(row=>row.id==='totals:az')!.value,state,"legacy drift is repaired from saved row contributions, preserving all other fields");
    assert.deepEqual(repaired.find(row=>row.id==='totals:empty')!.value.part.assignments.clocks,{active:0,eligible:0,overdue:0,backoff:0});
    assert.deepEqual(repaired.map(row=>[row.id,Number(row.revision)]),[["current",1],["totals",1],["totals:az",2],["totals:empty",2],["totals:exact",1]]);
    await contractOwnerLive(sql);
    assert.deepEqual(await saved(),repaired,"repeated contract preserves revisions and timestamps when counts already agree");
  }finally{await db.close();}
});


test("owner row fingerprints, count aggregates and activity patches preserve cold-start contributions",async()=>{
  const db=new PGlite(),at="2026-10-30T17:00:00.000Z",queries:{text:string;params:readonly unknown[]}[]=[];
  const sql={query:async(text:string,params:readonly unknown[]=[])=>{queries.push({text,params});return(await db.query(text,[...params])).rows;}};
  try{
    for(const ddl of OWNER_ASSIGNMENT_ROWS_DDL)await db.exec(ddl);
    await db.exec("CREATE TABLE cp_owner_snapshots(id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,value jsonb NOT NULL)");
    for(const value of[{é:"é",b:2,aa:1,abc:{yes:true,no:null},"😀":["a\\b","a \" b",null]},[1e-7,1e21,-1.25e-9,1e-30,0,-0,1.23e30]]){
      const [row]=(await db.query<{json:string}>("SELECT $1::jsonb::text AS json",[JSON.stringify(value)])).rows;
      assert.equal(ownerRowJson(value),row.json,"local fingerprint uses exactly the PostgreSQL representation");
    }
    const index={id:"freshness:ask-gap:body#CALENDAR_STALE",kind:"STANDING_OBLIGATION",lane:"ROUTINE",state:"WAITING",label:"One",subjectName:null,stateCode:"az",assignmentKeys:["hunt"],
      instructionStates:{"hunt#receipt":"WAITING"},lastActivityAt:null,band:1,overdue:false,waitingSince:at,eligibleAt:at,blocker:null,owner:"FLEET",nextAction:"Read source"} as AssignmentIndexRow;
    const obligation={active:true,eligibleAt:at,backoff:false,subjectId:"state-az",assignments:[]};
    const make=(id:string,usd:import("../lib/control-plane/exact-sum.ts").ExactSum|null)=>({id,state:"az",builtAt:at,
      group:{members:[id+"-member"],clause:null,obligation,usd,publications:[],items:[],scoutKeys:[]},
      indexSegments:[{...index,id,from:null,until:"2026-10-30T18:00:00.000Z"},{...index,id,state:"FAILED" as const,from:"2026-10-30T18:00:00.000Z",until:null}],
      part:assignmentPartOf([[id,{index:{...index,id},usd,obligation}]],at),nextAt:"2026-10-30T18:00:00.000Z"});
    const entries=[make(index.id,{p:[1e-30,.1,.2],nan:1}),make("other",{p:[.1],pinf:1}),make("none",null)],repo=pgOwnerAssignmentRows(sql);
    await repo.save(entries,[]);
    const heads=await repo.heads(entries.map(row=>row.id));
    assert.deepEqual(heads,entries.map(ownerAssignmentHeadOf).sort((a,b)=>a.id.localeCompare(b.id)));
    const actual=(await repo.contributions(entries.map(row=>row.id))).get("az")!,expected=ownerAssignmentContributions(entries).get("az")!;
    assert.deepEqual({...actual.part,usd:null},{...expected.part,usd:null});assert.equal(actual.usdRows,2);
    const {exactSum,mergeExact,exactValue}=await import("../lib/control-plane/exact-sum.ts"),sum=exactSum();
    mergeExact(sum,actual.part.usd!);assert.equal(exactValue(sum),exactValue(expected.part.usd!));
    assert.equal(sum.nan,expected.part.usd!.nan);assert.equal(sum.pinf,expected.part.usd!.pinf);
    queries.length=0;
    const updated=entries.map(row=>({...row,builtAt:"2026-10-30T17:01:00.000Z",indexSegments:row.indexSegments.map((segment,i)=>({...segment,lastActivityAt:i?at:"2026-10-30T17:00:30.000Z"}))}));
    await repo.save(updated,[],[],heads);
    const payload=JSON.parse(String(queries.find(query=>query.text.includes("WITH incoming"))!.params[0]));
    assert.equal(payload.some((patch:Record<string,unknown>)=>"group"in patch||"part"in patch||"indexSegments"in patch),false,"unchanged bodies never leave the process");
    assert.equal(payload.every((patch:Record<string,unknown>)=>"indexActivity"in patch),true);
    assert.deepEqual(await repo.read(entries.map(row=>row.id)),[...updated].sort((a,b)=>a.id.localeCompare(b.id)));
    const current=await repo.heads(entries.map(row=>row.id)),moved=updated.map(row=>({...row,group:{...row.group,members:["moved"],scoutKeys:["new-key"]},indexSegments:row.indexSegments.map(segment=>({...segment,label:"New label"}))}));
    await repo.save(moved,[],[],current);assert.deepEqual(await repo.read(entries.map(row=>row.id)),[...moved].sort((a,b)=>a.id.localeCompare(b.id)));
    await assert.rejects(repo.save(updated,[],[{id:"missing-state",expectedRevision:7,value:{} as import("../lib/control-plane/owner-snapshot-totals.ts").StateTotals}],await repo.heads(entries.map(row=>row.id))),/Owner counts changed/);
    assert.deepEqual(await repo.read(entries.map(row=>row.id)),[...moved].sort((a,b)=>a.id.localeCompare(b.id)),"rejected counts roll back partial field updates");
  }finally{await db.close();}
});
