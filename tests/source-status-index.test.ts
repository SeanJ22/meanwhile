import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { SOURCE_STATUS_DDL, SOURCE_STATUS_BACKFILL_DDL } from "../lib/civic-data/source-status-index.ts";
import { serializeReaderProjectionReadback } from "../lib/civic-data/reader-readback.ts";
import { UNCHANGED_CONFIRMATION_PREFIX } from "../lib/civic-data/unchanged-confirmation.ts";
import { PUBLICATION_LATEST_ATTEMPTS_SQL } from "../lib/civic-data/publication-status-store.ts";

const source="source",kind="MEETING",scope="scope",pointer="MEETING:scope";
const at=(hour:number)=>`2026-10-28T${String(hour).padStart(2,"0")}:00:00.000Z`;

test("source status follows committed events, state changes, pointer replacements and typed current-version readbacks",async()=>{
  const pg=new PGlite();
  try {
    await pg.exec(`CREATE TABLE civic_data_candidates(id text PRIMARY KEY,source_id text,record_class text,scope text,state text,failure_code text,candidate jsonb DEFAULT '{}'::jsonb);
      CREATE TABLE civic_data_candidate_events(id serial PRIMARY KEY,candidate_id text,sequence int,state text,at timestamptz,detail text);
      CREATE TABLE civic_data_promotions(key text PRIMARY KEY,source_id text,record_class text,scope text,current_version_id text);`);
    for(const ddl of SOURCE_STATUS_DDL)await pg.exec(ddl);
    const candidate=async(id:string,state:string,failure:string|null=null)=>pg.query("INSERT INTO civic_data_candidates(id,source_id,record_class,scope,state,failure_code) VALUES($1,$2,$3,$4,$5,$6)",[id,source,kind,scope,state,failure]);
    const event=async(id:string,sequence:number,state:string,hour:number,detail:string)=>pg.query("INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES($1,$2,$3,$4,$5)",[id,sequence,state,at(hour),detail]);
    const receipt=(id:string,status:"PASS"|"FAIL",hour:number)=>serializeReaderProjectionReadback({contractVersion:2,kind:"READER_PROJECTION_READBACK",
      contractId:"contract",sourceId:source,recordClass:"MEETING",scope,projectionId:"reader",versionId:id,pointerKey:pointer,
      observedAt:at(hour),evidenceKind:"TYPED_READER_READ_MODEL",verifierId:"reader",verifierCodeSha:null,status,detail:"Observed"});
    const attempt=async()=> (await pg.query<{candidate_id:string;state:string;failure_code:string|null;attempted_at:Date}>("SELECT * FROM civic_data_source_status")).rows[0];
    const readback=async()=> (await pg.query<{candidate_id:string;status:string;at:Date}>("SELECT * FROM civic_data_current_readbacks")).rows[0];

    await candidate("v1","FETCHED");await event("v1",1,"FETCHED",10,"Fetched");
    assert.equal((await attempt()).candidate_id,"v1");assert.equal((await attempt()).state,"FETCHED");
    await pg.exec("UPDATE civic_data_candidates SET state='PROMOTED' WHERE id='v1'");
    assert.equal((await attempt()).state,"PROMOTED","later candidate state changes update the same latest source row");
    await pg.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4,'v1')",[pointer,source,kind,scope]);
    await event("v1",2,"PROMOTED",11,receipt("v1","PASS",11));
    assert.equal((await readback()).status,"PASS");
    await event("v1",3,"PROMOTED",12,receipt("v1","FAIL",12).replace('"pointerKey":"MEETING:scope"','"pointerKey":"wrong"'));
    assert.equal((await readback()).status,"PASS","malformed later receipts never become observations");
    await event("v1",4,"PROMOTED",13,receipt("v1","FAIL",13));
    assert.equal((await readback()).status,"FAIL","the latest valid FAIL supersedes an earlier PASS");

    await candidate("v2","SOURCE_BLOCKED","SOURCE_FAILURE");await event("v2",1,"FETCHED",14,"Failed source");
    const confirmation=(hour:number)=>UNCHANGED_CONFIRMATION_PREFIX+JSON.stringify({retrieval:{sourceCheck:{checkedAt:at(hour)}}});
    await event("v1",5,"PROMOTED",15,confirmation(12));
    assert.equal((await attempt()).candidate_id,"v2","reprocessing older held bytes cannot hide a newer failure");
    await event("v1",6,"PROMOTED",16,confirmation(15));
    assert.equal((await attempt()).candidate_id,"v1");assert.equal((await attempt()).attempted_at.toISOString(),at(15));
    await pg.exec("UPDATE civic_data_promotions SET current_version_id='v2'");
    assert.equal((await attempt()).candidate_id,"v2","old-version confirmations leave the eligible source history when the pointer changes");
    assert.equal(await readback(),undefined,"an old version's readback never follows a new pointer");
    await event("v1",7,"PROMOTED",17,receipt("v1","PASS",17));
    assert.equal(await readback(),undefined);
    await event("v2",2,"PROMOTED",18,receipt("v2","PASS",18));
    assert.equal((await readback()).candidate_id,"v2");
    await pg.exec("UPDATE civic_data_promotions SET current_version_id='v1'");
    assert.equal((await readback()).status,"PASS");assert.equal((await readback()).at.toISOString(),at(17));
    assert.equal((await attempt()).candidate_id,"v1");

    const inputs=JSON.stringify([["contract",source,kind,scope,true]]);
    assert.equal((await pg.query<{candidate_id:string}>(PUBLICATION_LATEST_ATTEMPTS_SQL,[inputs])).rows[0].candidate_id,"v1");
    const before={attempt:await attempt(),readback:await readback()};
    await pg.exec("DELETE FROM civic_data_source_status; DELETE FROM civic_data_current_readbacks;");
    await pg.exec(SOURCE_STATUS_BACKFILL_DDL);
    assert.deepEqual({attempt:await attempt(),readback:await readback()},before,"server-local initial backfill agrees with ordinary writer updates");
    await pg.exec("DELETE FROM civic_data_promotions");
    assert.equal(await readback(),undefined);
    assert.equal((await attempt()).candidate_id,"v2");
    await pg.exec("DELETE FROM civic_data_candidates WHERE id='v2'");
    assert.equal((await attempt()).candidate_id,"v1");
  }finally{await pg.close();}
});
