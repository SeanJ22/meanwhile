import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readPlaceHistory } from "../lib/control-plane/admin-view/place-history-read.ts";
import { readExactServedWitness } from "../lib/control-plane/admin-view/public-reader-observation-read.ts";
import { readShutDoorRecords } from "../lib/control-plane/admin-view/v6-stuck-doors.ts";
import { applyManualEdit,checkDoorDraft } from "../lib/doors/registry.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { existsSync,readdirSync,readFileSync } from "node:fs";

test("Admin read routes cannot bypass row-version checks with a raw SQL client or time-only response memo",()=>{
  assert.equal(existsSync("lib/db/admin-changes.ts"),false,"Admin uses the same current-version connection as every reader");
  assert.doesNotMatch(readFileSync("lib/db/transfer.ts","utf8"),/adminChangesFetch/);
  const files=[...readdirSync("lib/control-plane/admin-view").filter(file=>file.endsWith("route.ts")).map(file=>`lib/control-plane/admin-view/${file}`),"lib/control-plane/admin-view/v6-stuck-population.ts",
    "app/api/admin/v6/place/route.ts","app/api/admin/v6/scoreboard/route.ts"];
  for(const file of files){
    const source=readFileSync(file,"utf8");
    assert.doesNotMatch(source,/from\s+["'](?:@neondatabase\/serverless|pg|postgres|[^"']*\/db\/client(?:\.ts)?)["']/,
      `${file}: SQL read defaults must use the shared version-checked connection`);
    assert.doesNotMatch(source,/\bMEMO_MS\b|if\s*\(memo\s*&&/,
      `${file}: stored results must confirm a current version before reuse`);
  }
});

test("Admin history and witness projections check the owning row revision on every read and keep parameterized places separate",async()=>{
  const pg=new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_owner_snapshots(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb)");
    const point=(n:number)=>({day:"2026-10-25",at:"2026-10-25T12:00:00Z",completeness:{n,of:10},freshness:{n:0,of:0},delivery:{n:0,of:0},families:[]});
    const item={id:"work-1",publicationOutcome:{status:"PUBLISHED",workerResultId:"result-1",versionId:"version-1"}} as WorkItem;
    const witness={itemId:item.id,approvalId:"result-1",versionId:"version-1",readerKey:"reader-1",url:`${PUBLIC_SITE_ORIGIN}/ballot?zip=85001`,
      checkedAt:"2026-10-25T12:00:00Z",state:"CONFIRMED",reason:"Observed",responseSha256:null};
    await pg.query("INSERT INTO cp_owner_snapshots VALUES('current',1,now(),$1::jsonb)",[
      JSON.stringify({placeHistory:{az:[point(1)],ny:[point(2)]},servedReaderReadback:{witnesses:[witness]}})]);
    const bodies:unknown[]=[];
    const sql={query:async(text:string,params:readonly unknown[]=[])=>{
      const result=await pg.query<Record<string,unknown>>(text,[...params]);
      bodies.push(...result.rows.filter(row=>Object.hasOwn(row,"value")&&row.value!==null));
      return result.rows;
    }};
    assert.equal((await readPlaceHistory(sql,"az"))[0].completeness.n,1);
    assert.equal((await readPlaceHistory(sql,"ny"))[0].completeness.n,2);
    assert.equal((await readExactServedWitness(sql,item))!.state,"CONFIRMED");
    const before=bodies.length;
    await readPlaceHistory(sql,"az");await readPlaceHistory(sql,"ny");await readExactServedWitness(sql,item);
    assert.equal(bodies.length,before,"unchanged projections return revision confirmations only");
    await pg.query(`UPDATE cp_owner_snapshots SET revision=revision+1,value=jsonb_set(jsonb_set(value,'{placeHistory,az}',$1::jsonb),'{servedReaderReadback,witnesses}',$2::jsonb)`,[
      JSON.stringify([point(3)]),JSON.stringify([{...witness,state:"NOT_OBSERVED"}])]);
    assert.equal((await readPlaceHistory(sql,"az"))[0].completeness.n,3);
    assert.equal((await readExactServedWitness(sql,item))!.state,"NOT_OBSERVED");
  }finally{await pg.close();}
});

test("Admin shut doors reuse unchanged records and immediately observe an edit or reopening",async()=>{
  const pg=new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_doors(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb)");
    const draft=checkDoorDraft({doorId:"test:door",kind:"source-feed",status:"SHUT",hosts:["https://example.gov"],bodyIds:[],holds:["meetings"],config:{}});
    assert.ok(draft.ok);
    const door=applyManualEdit(null,draft.value,"2026-10-25T12:00:00Z");
    await pg.query("INSERT INTO cp_doors VALUES($1,1,now(),$2::jsonb)",[door.doorId,JSON.stringify(door)]);
    let bodies=0;
    const sql={query:async(text:string,params:readonly unknown[]=[])=>{
      const result=await pg.query<Record<string,unknown>>(text,[...params]);
      bodies+=result.rows.filter(row=>Object.hasOwn(row,"value")).length;
      return result.rows;
    }};
    assert.equal((await readShutDoorRecords(sql))[0].doorId,door.doorId);
    assert.equal((await readShutDoorRecords(sql))[0].doorId,door.doorId);
    assert.equal(bodies,1);
    await pg.exec(`UPDATE cp_doors SET revision=revision+1,value=value||'{"notes":"Source moved"}'::jsonb`);
    assert.equal((await readShutDoorRecords(sql))[0].notes,"Source moved");
    assert.equal(bodies,2);
    await pg.exec(`UPDATE cp_doors SET revision=revision+1,value=value||'{"status":"OPEN"}'::jsonb`);
    assert.deepEqual(await readShutDoorRecords(sql),[]);
  }finally{await pg.close();}
});
