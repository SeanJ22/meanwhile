/** CK-01 production inspection. Existing read-only roles only; no bootstrap or publication writes.
 * CK01_READER_URL=... CK01_CONTROL_URL=... node --experimental-strip-types scripts/ck-01-check.mts [snapshot ISO]
 * Optional CK01_REPLAY points to JSON Claim[] (SavedCopy.fetchedAt is ISO); runs the actual §3 check.
 * Outputs bounded samples and counts; bytes are actual Neon HTTP response bodies, including errors.
 */
import {neon,neonConfig} from '@neondatabase/serverless';
import {readFile} from 'node:fs/promises';
import {checkFact,type Claim} from '../lib/facts/check.ts';
import {factClocks} from '../lib/facts/clocks.ts';
const snapshot=new Date(process.argv[2] ?? Date.now()).toISOString();
const from=new Date(Date.parse(snapshot)-7*86_400_000).toISOString();
let bytes=0;
neonConfig.fetchFunction=async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
 const response=await fetch(input,init),body=await response.arrayBuffer();bytes+=body.byteLength;
 return new Response(body,{status:response.status,headers:response.headers});
};
const connection=(name:string)=>{const value=process.env[name];if(!value)throw Error(`${name} is required; use an existing production read-only role.`);return neon(value);};
try{
 const reader=connection('CK01_READER_URL'),control=connection('CK01_CONTROL_URL');
 const readerRows=await reader.transaction([
  reader.query("SELECT current_user AS role,current_setting('transaction_read_only') AS read_only"),
  reader.query(`SELECT e.kind,b.reason,count(*)::int AS facts FROM blank b JOIN entity e ON e.id=b.entity_id
   WHERE b.stage IN ('CHECK','ACQUIRE') GROUP BY e.kind,b.reason ORDER BY e.kind,b.reason`),
  reader.query(`SELECT entity_id,field,kind,name,reason,detail FROM (SELECT b.entity_id,b.field,e.kind,e.name,b.reason,b.detail,
   row_number() OVER(PARTITION BY e.kind,b.reason ORDER BY b.entity_id,b.field) AS sample
   FROM blank b JOIN entity e ON e.id=b.entity_id WHERE b.stage IN ('CHECK','ACQUIRE')) samples WHERE sample<=3 LIMIT 100`),
 ],{readOnly:true});
 const audits=await control.transaction([
  control.query("SELECT current_user AS role,current_setting('transaction_read_only') AS read_only"),
  control.query(`SELECT record->'result' AS result FROM cp_log_live_audits
   WHERE log_key>= $1 AND log_key<= $2 AND record->>'kind'='RESULT'
   AND record->'result'->>'checkedAt'>$3 AND record->'result'->>'checkedAt'<=$4
   ORDER BY recorded_at LIMIT 101`,[`day:${from.slice(0,10)}`,`day:${snapshot.slice(0,10)}`,from,snapshot]),
 ],{readOnly:true});
 if(audits[1].length>100)throw Error('Audit window exceeds the bounded 100-result inspection. Select a narrower snapshot or explicit IDs.');
 const replay=process.env.CK01_REPLAY ? (JSON.parse(await readFile(process.env.CK01_REPLAY,'utf8')) as Claim[]).map(claim=>({
  entityId:claim.entity.id,fieldKind:claim.fieldKind,valueText:claim.valueText,
  result:checkFact({...claim,copy:{...claim.copy,fetchedAt:new Date(claim.copy.fetchedAt)},
   ...(claim.second?{second:{...claim.second,copy:{...claim.second.copy,fetchedAt:new Date(claim.second.copy.fetchedAt)}}}:{})},new Date(snapshot),factClocks(null).windowHours),
 })) : [];
 console.log(JSON.stringify({snapshot,from,reader:readerRows,audits,replay,neonResponseBytes:bytes},null,2));
}finally{console.error(JSON.stringify({neonResponseBytes:bytes}));}
