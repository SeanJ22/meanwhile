import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readPlaceHistory } from "../lib/control-plane/admin-view/place-history-read.ts";
import { readExactServedWitness } from "../lib/control-plane/admin-view/public-reader-observation-read.ts";
import { readShutDoorRecords } from "../lib/control-plane/admin-view/v6-stuck-doors.ts";
import { readQueueDoorsFromSql } from "../lib/control-plane/admin-view/door-queries.ts";
import { projectDoors } from "../lib/control-plane/admin-view/v6-doors-read.ts";
import { applyManualEdit,checkDoorDraft } from "../lib/doors/registry.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { existsSync,readdirSync,readFileSync } from "node:fs";
import { DISPATCH_CONFIRMATION_SQL } from "../lib/control-plane/gateway/confirmation-read.ts";
import { ownerDispatchWorkOf, type DispatchWorkReading } from "../lib/control-plane/expansion/dispatch-work.ts";
import { readPublicationCounts, PUBLICATION_READBACK_ROWS_SQL, publicationContractInputs } from "../lib/civic-data/publication-status-store.ts";
import { projectPublicationStatus, type PublicationContract } from "../lib/civic-data/publication-status.ts";
import { serializeReaderProjectionReadback } from "../lib/civic-data/reader-readback.ts";
import { SOURCE_STATUS_DDL } from "../lib/civic-data/source-status-index.ts";

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
    const draft=checkDoorDraft({doorId:"test:door",kind:"source-feed",status:"SHUT",hosts:["https://example.gov"],bodyIds:[],holds:["meetings"],config:{savedPage:"x".repeat(1_000_000)}});
    assert.ok(draft.ok);
    const door=applyManualEdit(null,draft.value,"2026-10-25T12:00:00Z");
    await pg.query("INSERT INTO cp_doors VALUES($1,1,now(),$2::jsonb)",[door.doorId,JSON.stringify(door)]);
    let bodies=0;
    const sql={query:async(text:string,params:readonly unknown[]=[])=>{
      const result=await pg.query<Record<string,unknown>>(text,[...params]);
      bodies+=result.rows.filter(row=>Object.hasOwn(row,"value")).length;
      return result.rows;
    }};
    const first=await readShutDoorRecords(sql);
    assert.equal(first[0].doorId,door.doorId);
    assert.ok(JSON.stringify(first).length<2_000,"the shut-source list carries only the displayed reason, identity and clocks");
    const queue=await readQueueDoorsFromSql(sql);
    assert.deepEqual(queue.rows,projectDoors({doors:[door],unreadable:0,saves:[],observedAt:door.updatedAt}).rows
      .filter(row=>row.status==="Shut").map(({name,why,since})=>({name,why,since})));
    assert.ok(JSON.stringify(queue).length<1_000,"Queue door fields exclude saved source settings and registry metadata");
    assert.equal((await readShutDoorRecords(sql))[0].doorId,door.doorId);
    assert.equal(bodies,1);
    // Admin reads only the bounded door fields it shows; an edit to one of them is seen at once.
    await pg.exec(`UPDATE cp_doors SET revision=revision+1,value=value||'{"shutReason":"Source moved"}'::jsonb`);
    assert.equal((await readShutDoorRecords(sql))[0].shutReason,"Source moved");
    assert.equal(bodies,2);
    await pg.exec(`UPDATE cp_doors SET revision=revision+1,value=value||'{"status":"OPEN"}'::jsonb`);
    assert.deepEqual(await readShutDoorRecords(sql),[]);
  }finally{await pg.close();}
});

test("an order confirmation returns its own counts while unrelated research stays in the database",async()=>{
  const pg=new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_research_state(id text PRIMARY KEY,value jsonb)");
    const target={key:"dispatch:wanted",requirements:{defined:14,created:7,createdThisCycle:2,carried:3,deferred:4},
      units:{blocked:2},blocked:[{code:"MISSING",why:"Source missing",dataset:"Government list"}]};
    const dispatch={targets:[target,{...target,key:"dispatch:other",irrelevant:"x".repeat(1_000_000)}]} as unknown as DispatchWorkReading;
    await pg.query("INSERT INTO cp_research_state VALUES($1,$2::jsonb)",["research:az",JSON.stringify({dispatchWork:dispatch,inventory:"x".repeat(1_000_000)})]);
    const result=await pg.query<{id:string;work:unknown}>(DISPATCH_CONFIRMATION_SQL,[["research:az"],"dispatch:wanted","wanted"]);
    assert.deepEqual(result.rows[0].work,ownerDispatchWorkOf(dispatch,"wanted"));
    assert.ok(JSON.stringify(result.rows).length<1_000);
    const unrelated=await pg.query<{work:unknown}>(DISPATCH_CONFIRMATION_SQL,[["research:az"],"dispatch:absent","absent"]);
    assert.equal(unrelated.rows[0].work,null,"another order's counts never confirm this one");
  }finally{await pg.close();}
});

test("publication counters match the typed readback verdict for current, failed, stale and malformed receipts",async()=>{
  const pg=new PGlite();
  try {
    await pg.exec(`CREATE TABLE civic_data_promotions(key text,source_id text,record_class text,scope text,current_version_id text,promoted_at timestamptz);
      CREATE TABLE civic_data_candidates(id text PRIMARY KEY,source_id text,record_class text,scope text,state text,failure_code text,candidate jsonb DEFAULT '{}'::jsonb);
      CREATE TABLE civic_data_candidate_events(candidate_id text,at timestamptz,detail text,sequence int,state text DEFAULT 'PROMOTED');`);
    for(const ddl of SOURCE_STATUS_DDL)await pg.exec(ddl);
    const contracts:PublicationContract[]=["visible","failed","stale","never","foreign","misfiled","no-surface","malformed","later-failure"].map(id=>({
      id,sourceId:`source:${id}`,recordClass:"MEETING",scope:`scope:${id}`,readerProjection:id==="no-surface"?null:{},
    }));
    const at="2026-10-28T10:00:00.000Z";
    const promotions=contracts.filter(c=>c.id!=="never").map(c=>({key:`MEETING:${c.scope}`,sourceId:c.id==="foreign"?"different-source":c.sourceId,
      recordClass:c.recordClass,scope:c.scope,currentVersionId:`current:${c.id}`,promotedAt:at}));
    const readbacks=contracts.flatMap(c=>{
      const versionId=c.id==="stale"?"old:stale":`current:${c.id}`;
      const detail=serializeReaderProjectionReadback({contractVersion:2,kind:"READER_PROJECTION_READBACK",contractId:c.id==="misfiled"?"another-contract":c.id,
        sourceId:c.sourceId,recordClass:"MEETING",scope:c.scope,projectionId:`projection:${c.id}`,versionId,pointerKey:`MEETING:${c.scope}`,
        observedAt:at,evidenceKind:"TYPED_READER_READ_MODEL",verifierId:"typed-reader",verifierCodeSha:null,
        status:c.id==="failed"?"FAIL":"PASS",detail:c.id==="malformed"?"":c.id==="visible"?"x".repeat(1_000_000):"observed"});
      return [{candidateId:versionId,at,detail},...(c.id==="later-failure"?[{candidateId:versionId,at:"2026-10-28T11:00:00.000Z",detail:detail.replace('"status":"PASS"','"status":"FAIL"')}]:[])];
    });
    for(const c of contracts)await pg.query("INSERT INTO civic_data_candidates(id,source_id,record_class,scope,state,failure_code) VALUES($1,$2,$3,$4,'PROMOTED',NULL)",[`current:${c.id}`,c.sourceId,c.recordClass,c.scope]);
    for(const p of promotions)await pg.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4,$5,$6)",[p.key,p.sourceId,p.recordClass,p.scope,p.currentVersionId,p.promotedAt]);
    for(const [index,r] of readbacks.entries())await pg.query("INSERT INTO civic_data_candidate_events(candidate_id,at,detail,sequence) VALUES($1,$2,$3,$4)",[r.candidateId,r.at,r.detail,index]);
    const sql={query:async(text:string,params:readonly unknown[]=[]) => (await pg.query(text,[...params])).rows};
    const expected=projectPublicationStatus(contracts,{promotions,readbacks,latestAttempts:[]});
    assert.deepEqual(await readPublicationCounts(sql,contracts),{total:contracts.length,readBack:expected.counts.READER_VISIBLE});
    assert.equal(expected.counts.READER_VISIBLE,1);
    const selected=await pg.query<{candidate_id:string;at:Date;contract_id:string;status:"PASS"|"FAIL"}>(PUBLICATION_READBACK_ROWS_SQL,[JSON.stringify(publicationContractInputs(contracts))]);
    assert.ok(JSON.stringify(selected.rows).length<10_000,"the status panel reads current receipt fields, not saved event detail bodies");
    const current=projectPublicationStatus(contracts,{promotions,latestAttempts:[],readbacks:selected.rows.map(row=>({
      candidateId:row.candidate_id,at:row.at.toISOString(),summary:{contractId:row.contract_id,versionId:row.candidate_id,status:row.status},
    }))});
    assert.deepEqual(current.counts,expected.counts);
    assert.deepEqual(current.contracts.map(c=>c.readback),expected.contracts.map(c=>c.readback));
  }finally{await pg.close();}
});
