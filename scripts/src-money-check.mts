import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {neon,neonConfig} from "@neondatabase/serverless";
import {CAMPAIGN_FINANCE_SOURCES} from "../lib/funding/state-sources.ts";

if(process.argv.length!==2)throw new Error("The retirement check takes no arguments");
const connection=process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if(!connection)throw new Error("The production read-only handle is required");
let bytesRead=0;
neonConfig.fetchFunction=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const response=await fetch(input,init);
  return new Response(response.body!.pipeThrough(new TransformStream({transform(bytes,out){bytesRead+=bytes.byteLength;out.enqueue(bytes);}})),{status:response.status,headers:response.headers});
};
const query=neon(connection),rows=[];
const [role]=await query.query("SELECT current_user,has_table_privilege(current_user,'fact','INSERT,UPDATE,DELETE') AS can_write");
assert.equal(role.current_user,"readonly");assert.equal(role.can_write,false);
for(const {state} of CAMPAIGN_FINANCE_SOURCES){
  const [facts]=await query.query(`SELECT count(*) AS records,count(*) FILTER(WHERE f.status='live') AS live FROM entity e JOIN fact f ON f.entity_id=e.id
    WHERE e.state=$1 AND e.kind='committee' AND f.produced_by LIKE $2 AND f.field LIKE 'campaign-money:%'`,[state,`campaign-finance:${state}:%`]);
  const [publications]=await query.query("SELECT count(*) AS records FROM civic_data_promotions WHERE source_id=$1 AND record_class='CAMPAIGN_FINANCE'",[`US-${state}:campaign-finance-source`]);
  const [copies]=await query.query("SELECT count(*) AS records FROM civic_data_candidates WHERE source_id=$1 AND record_class='CAMPAIGN_FINANCE'",[`US-${state}:campaign-finance-source`]);
  rows.push({state,facts:Number(facts.records),liveFacts:Number(facts.live),publications:Number(publications.records),candidateCopies:Number(copies.records)});
}
const result={at:new Date().toISOString(),bytesRead,rows};
await writeFile('/tmp/src-mn-campaign-retirement-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
assert.ok(rows.every(row=>row.facts===0 && row.publications===0 && row.candidateCopies===0),"The replaced campaign load still has stored facts or publications");
