/** Bounded actual-GET SQL diagnosis over the existing isolated native EPA replay. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {GET} from "../app/api/open-data/route.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {requiredRoutineContract} from "../lib/civic-data/contracts.ts";
import {routineTaskFromContract} from "../lib/civic-data/runner.ts";
import {OPEN_DATA_READER_PAYLOAD} from "../lib/sources/open-data/reader-sql.ts";
import type {Statement} from "../lib/control-plane/admin-view/promoted-slices.ts";
import {FederalMoneyBenchmarkStore} from "./lib/federal-money-benchmark-store.mts";
import {installOpenDataReaderSql,installOpenDataReplayVault} from "./lib/open-data-replay-reader.mts";
import {createEpaReplayVault} from "./lib/epa-held-spool.mts";

const args=new Map(process.argv.slice(2).map(arg=>{const at=arg.indexOf("=");return[arg.slice(0,at),arg.slice(at+1)];}));
const manifest=JSON.parse(await readFile(resolve(args.get("--manifest")??".scratch/src01-epa/four-writer-compact-manifest.json"),"utf8"));
const output=resolve(args.get("--output")??"docs/measurements/src-01/epa-sql-profile.json");
const comparison=args.get("--compare")?JSON.parse(await readFile(resolve(args.get("--compare")!),"utf8")):null;
const candidateExpression=args.get("--candidate-expression")?await readFile(resolve(args.get("--candidate-expression")!),"utf8"):null;
const samples=(args.get("--states")??"NJ,RI").split(",").map(state=>({state,zip:({NJ:"07001",RI:"02802",NH:"03031"} as Record<string,string>)[state]}));
assert.ok(samples.length<=3&&samples.every(sample=>sample.zip),"Choose at most NJ, RI and NH.");
assert.ok(args.get("--native-postgres-file"),"An existing isolated loopback native PostgreSQL cluster is required.");
const store=await FederalMoneyBenchmarkStore.open(resolve(args.get("--database")??".scratch/src01-epa/reader-native-cursor-final"),"epa-echo","epa-echo",{nativeConnectionFile:args.get("--native-postgres-file")!});
await store.query([{text:"SET jit=off",params:[]}]);await installOpenDataReaderSql(store.query);
const task=routineTaskFromContract(requiredRoutineContract("epa-echo")),clock=await store.clock(task.sourceId,task.recordClass,task.scope,task.parserVersion),at=Math.max(Date.parse(clock.lastSucceededObservedAt??clock.lastSucceededAt!),Date.parse(clock.lastSucceededAt!));assert.ok(Number.isFinite(at));await store.setReplayClock(at);
const [settingsRows]=await store.query([{text:"SELECT pg_backend_pid() AS pid,current_setting('jit') AS jit,current_setting('work_mem') AS work_mem",params:[]}]),settings=settingsRows[0];
const [shapeRows]=await store.query([{text:"SELECT jsonb_typeof(p.payload) AS payload_type,jsonb_typeof(reader_payload_node(p.payload)->'partitions') AS partitions_type,(reader_payload_node(p.payload)->'partitions')->>'kind' AS partitions_kind FROM civic_data_promotions p WHERE p.record_class='CURATED_READER_RECORD' AND p.scope='epa-echo:national'",params:[]}]);
console.log(JSON.stringify({stage:"stored-root-shape",shape:shapeRows[0]}));
async function backendTicks(){const [rows]=await store.query([{text:"SELECT pg_read_file('/proc/'||pg_backend_pid()||'/stat') AS stat",params:[]}]),value=String(rows[0].stat),fields=value.slice(value.lastIndexOf(")")+2).split(" ");return Number(fields[11])+Number(fields[12]);}
const OriginalDate=globalThis.Date;
globalThis.Date=new Proxy(OriginalDate,{construct(target,values){return Reflect.construct(target,values.length?values:[at]);},get(target,name,receiver){return name==="now"?()=>at:Reflect.get(target,name,receiver);}});
const transport=installOpenDataReplayVault(createEpaReplayVault(manifest.vaultRoots,manifest.vaultEncoding??"raw"));
const captured:{statement:Statement;wallMs:number;resultBytes:number;backendCpuTicks:number}[]=[];
const serializedResults=new Map<Statement,string>();
installReaderDatabaseQuery(async statements=>{
  if(candidateExpression)statements=statements.map(statement=>{
    if(!statement.params.includes("epa-echo:national"))return statement;
    assert.ok(statement.text.includes(OPEN_DATA_READER_PAYLOAD),"The actual GET must contain the module's exact reader expression before replacing it.");
    return {...statement,text:statement.text.replace(OPEN_DATA_READER_PAYLOAD,candidateExpression.trim())};
  });
  const ticks=await backendTicks(),started=performance.now(),rows=await store.query(statements),wallMs=performance.now()-started,cpu=await backendTicks()-ticks;
  for(let index=0;index<statements.length;index++)if(statements[index].params.includes("epa-echo:national")){const serialized=JSON.stringify(rows[index]);serializedResults.set(statements[index],serialized);captured.push({statement:statements[index],wallMs,resultBytes:Buffer.byteLength(serialized),backendCpuTicks:cpu});}
  return rows;
});
const proof={status:"RUNNING",productionWrites:0,sourceRequests:0,scope:candidateExpression?"Actual normal GET handler with the candidate SQL expression substituted only in the isolated local query adapter, compared against the preserved original SELECT; no source requests or production writes.":"Actual normal GET and EXPLAIN of the same captured SELECT over the existing isolated native PostgreSQL replay; no source requests or production writes.",manifestSha256:createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),candidateExpressionSha256:candidateExpression?createHash("sha256").update(candidateExpression).digest("hex"):null,storedRootShape:shapeRows[0],controlledAt:new OriginalDate(at).toISOString(),clock,settings,cpuUnit:"backend clock ticks from /proc stat; Linux USER_HZ normally 100",samples:[] as unknown[]};
if(comparison)assert.equal(comparison.manifestSha256,proof.manifestSha256);
try {
  for(const sample of samples){
    const before=captured.length,requested=transport.requested.length,started=performance.now(),response=await GET(new Request(`http://readonly-replay.local/api/open-data?zip=${sample.zip}`)),page=await response.json() as {records:unknown[];unavailable:string[]};
    assert.equal(response.status,200);assert.ok(page.records.length<=50);
    const getWallMs=performance.now()-started,queries=captured.slice(before);assert.equal(queries.length,1,"Capture exactly one EPA manifest SELECT per actual GET.");
    const query=queries[0];assert.match(query.statement.text,/^\s*SELECT\b/i);assert.deepEqual(page.unavailable,[]);
    if(comparison){
      const prior=comparison.samples.find((value:{state:string})=>value.state===sample.state);assert.ok(prior);const old=prior.query.statement as Statement;assert.deepEqual(old.params,query.statement.params);assert.notEqual(old.text,query.statement.text);
      const [oldRows]=await store.query([old]),serialized=serializedResults.get(query.statement)!;assert.equal(JSON.stringify(oldRows),serialized,"Old/new SQL must return byte-identical serialized rows.");
      const rounds=[];
      for(let round=0;round<3;round++)for(const variant of round%2?["new","old"]:["old","new"]){
        const statement=variant==="old"?old:query.statement,ticks=await backendTicks(),explainStarted=performance.now(),[explained]=await store.query([{text:`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${statement.text}`,params:statement.params}]),wallMs=performance.now()-explainStarted,backendCpuTicks=await backendTicks()-ticks;
        const plan=explained[0]["QUERY PLAN"] as {"Execution Time":number;Plan:Record<string,unknown>}[];
        rounds.push({round:round+1,variant,wallMs,backendCpuTicks,plan});console.log(JSON.stringify({state:sample.state,round:round+1,variant,wallMs,backendCpuTicks,pgExecutionMs:plan[0]["Execution Time"],tempBlocks:plan[0].Plan["Temp Written Blocks"]}));
      }
      proof.samples.push({...sample,getWallMs,apiRows:page.records.length,unavailable:page.unavailable,query,oldStatement:old,serializedRowsEqual:true,resultSha256:createHash("sha256").update(serialized).digest("hex"),rounds});await writeFile(output,JSON.stringify(proof,null,2));continue;
    }
    const ticks=await backendTicks(),explainStarted=performance.now(),[explained]=await store.query([{text:`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query.statement.text}`,params:query.statement.params}]),explainWallMs=performance.now()-explainStarted,explainBackendCpuTicks=await backendTicks()-ticks;
    const plan=explained[0]["QUERY PLAN"];
    const result={...sample,getWallMs,apiRows:page.records.length,unavailable:page.unavailable,artifactRequests:transport.requested.length-requested,query,explainWallMs,explainBackendCpuTicks,plan};proof.samples.push(result);console.log(JSON.stringify({state:sample.state,getWallMs,sqlWallMs:query.wallMs,backendCpuTicks:query.backendCpuTicks,explainWallMs,explainBackendCpuTicks,plan}));await writeFile(output,JSON.stringify(proof,null,2));
  }
  proof.status="PASS";
}catch(error){proof.status="FAILED";throw error;}
finally{globalThis.Date=OriginalDate;transport.restore();installReaderDatabaseQuery(undefined);await store.close();await writeFile(output,JSON.stringify(proof,null,2));}
