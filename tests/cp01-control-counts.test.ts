import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assignmentPartOf, type AssignmentIndexRow } from "../lib/control-plane/assignment-view.ts";
import { expandControlCounts, contractControlCounts } from "../lib/control-plane/repository/migrations/CP-01-counts.ts";
import { CONTROL_COUNT_TABLES, controlCounts } from "../lib/control-plane/repository/control-counts.ts";
import { pgOwnerAssignmentRows } from "../lib/control-plane/repository/owner-assignment-rows.ts";

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
    await contractControlCounts(sql);
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
