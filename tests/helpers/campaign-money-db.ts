import {readFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {POINTER_MOVE_DETAIL_PREFIX} from "../../lib/civic-data/store.ts";
import type {FactDb,Query} from "../../lib/facts/publish.ts";

const directory=new URL("../../lib/db/migrations/",import.meta.url);
export async function applyCampaignMigrations(execute:(sql:string)=>Promise<unknown>){
  const journal=JSON.parse(await readFile(new URL("meta/_journal.json",directory),"utf8")) as {entries:{tag:string}[]};
  for(const entry of journal.entries){
    const migration=await readFile(new URL(`${entry.tag}.sql`,directory),"utf8");
    for(const sql of migration.split("--> statement-breakpoint"))await execute(sql);
  }
}

export async function campaignDb():Promise<FactDb&{query:Query;pg:PGlite}>{
  const {PGlite}=await import("@electric-sql/pglite");
  const pg=new PGlite();
  try{await applyCampaignMigrations(sql=>pg.exec(sql));}
  catch(error){await pg.close();throw error;}
  return {pg,query:async(text,params=[])=> (await pg.query<Record<string,unknown>>(text,[...params])).rows,
    transaction:work=>pg.transaction(tx=>work(async(text,params=[])=> (await tx.query<Record<string,unknown>>(text,[...params])).rows))};
}

let clock=0;
export async function publishMoneyFixture(db:FactDb&{query:Query},input:{recordClass:string;scope:string;payload:unknown;sourceId?:string;id?:string;fetchedOnly?:boolean}){
  const id=input.id??`money-fixture:${randomUUID()}`,source=input.sourceId??"money-reader-fixture",key=`${input.recordClass}:${input.scope}`;
  const at=new Date(Date.parse("2026-10-20T00:00:00.000Z")+(++clock)*10).toISOString();
  const validatedAt=new Date(Date.parse(at)+2).toISOString(),promotedAt=new Date(Date.parse(at)+3).toISOString();
  const hash=createHash("sha256").update(JSON.stringify(input.payload)).digest("hex");
  const receipt={contractVersion:2,decision:"GOOD",candidateId:id,sourceId:source,recordClass:input.recordClass,scope:input.scope,validatedAt,checks:[],excludedFacts:[]};
  const candidate={id,sourceId:source,recordClass:input.recordClass,scope:input.scope,identities:{},
    retrieval:{succeeded:true,rawHash:hash,retrievedAt:at},normalization:{succeeded:true,normalizedHash:hash,parserVersion:"money-reader-fixture/1"},
    temporal:{sourceThrough:at.slice(0,10)},readModel:input.payload};
  await db.transaction(async query=>{
    const [prior]=await query("SELECT current_version_id FROM civic_data_promotions WHERE key=$1",[key]);
    await query(`INSERT INTO civic_data_candidates(id,source_id,record_class,scope,state,acquisition_succeeded,raw_hash,normalized_hash,retrieved_at,source_through,parser_version,identity,candidate,validation_receipt,promoted_version_id,last_known_good_version_id)
      VALUES($1,$2,$3,$4,$5,true,$6,$6,$7,$8,'money-reader-fixture/1','{}',$9,$10,$11,$12)`,
    [id,source,input.recordClass,input.scope,input.fetchedOnly?"FETCHED":"PROMOTED",hash,at,at.slice(0,10),JSON.stringify(candidate),input.fetchedOnly?null:JSON.stringify(receipt),input.fetchedOnly?null:id,input.fetchedOnly?prior?.current_version_id??null:id]);
    const states=input.fetchedOnly?["FETCHED"]:["FETCHED","NORMALIZED","VALIDATED","PROMOTED"];
    for(const [index,state] of states.entries())await query("INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES($1,$2,$3,$4,$5)",
      [id,index+1,state,new Date(Date.parse(at)+index).toISOString(),state==="PROMOTED"?`${POINTER_MOVE_DETAIL_PREFIX}${key} moved from ${prior?.current_version_id??"bootstrap/no-version"} to ${id}.`:`Fixture ${state.toLowerCase()}`]);
    if(!input.fetchedOnly)await query(`INSERT INTO civic_data_promotions(key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,payload,validation_receipt)
      VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8) ON CONFLICT(key) DO UPDATE SET current_version_id=EXCLUDED.current_version_id,last_known_good_version_id=EXCLUDED.last_known_good_version_id,promoted_at=EXCLUDED.promoted_at,payload=EXCLUDED.payload,validation_receipt=EXCLUDED.validation_receipt`,
    [key,source,input.recordClass,input.scope,id,promotedAt,JSON.stringify(input.payload),JSON.stringify(receipt)]);
  });
  return id;
}
