/** Sequential fresh-process HTTP checks using the existing production readonly role.
 * NODE_USE_ENV_PROXY=1 node --env-file=/tmp/rs03-production.env --experimental-strip-types
 *   scripts/rs-03-representation-check.mts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { neon, neonConfig } from "@neondatabase/serverless";
import labels from "../data/reference/us-jurisdiction-labels.json" with { type: "json" };
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";

const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if (!connection) throw new Error("The existing production readonly connection is required");
const target = new URL(connection);
assert.equal(target.username, "readonly");
assert.ok(target.hostname.replace(/-pooler(?=\.)/, "").startsWith("ep-dry-river-axwtolzc."));
let directReadBytes = 0, serverReadBytes = 0;
neonConfig.fetchFunction = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const response = await fetch(input, init);
  directReadBytes += (await response.clone().arrayBuffer()).byteLength;
  return response;
};
const sql = neon(connection);
const [[identity]] = await sql.transaction([sql.query(`SELECT current_user AS role, current_setting('transaction_read_only') AS read_only,
 EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE')) AS can_write`, [])], { readOnly: true });
assert.equal(identity.role,"readonly"); assert.equal(identity.read_only,"on"); assert.equal(identity.can_write,false);
const output = process.argv.find(arg=>arg.startsWith("--out="))?.slice(6) ?? ".scratch/rs03/representation";
await mkdir(output,{recursive:true});
const buildId = (await readFile(".next/BUILD_ID","utf8")).trim();
const states = labels.jurisdictions.filter(row=>FIPS_TO_STATE[row.fips]?.prefix === "state");
assert.equal(states.length,50);
const counties = await sql.query(`SELECT p.scope, (SELECT reader_payload_node(d.item)->>'ocdId'
 FROM reader_payload_members(reader_payload_node(p.payload)->'divisions') d
 WHERE reader_payload_node(d.item)->>'divisionType'='county' ORDER BY reader_payload_node(d.item)->>'ocdId' LIMIT 1) AS county
 FROM civic_data_promotions p WHERE p.key=ANY($1::text[])`,[states.map(row=>`REGISTRATION:US-${row.postal}:registration:v1`)]);
const selected = states.map(row=>({...row,root:`ocd-division/country:us/state:${row.postal.toLowerCase()}`,
  county:counties.find(item=>item.scope===`US-${row.postal}:registration:v1`)?.county as string|undefined}));
assert.ok(selected.every(row=>row.county),"Every state must have a county selected from its held registration");
// Arizona is the first completely cold route, matching the reported failure.
selected.sort((a,b)=>(a.postal==="AZ"?-1:b.postal==="AZ"?1:a.postal==="NH"?-1:b.postal==="NH"?1:a.postal.localeCompare(b.postal)));
const rows: Record<string,unknown>[] = [];
const save = () => writeFile(`${output}/timings.json`,JSON.stringify({buildId,productionReadonly:identity,
  productionReadBytes:{direct:directReadBytes,server:serverReadBytes,total:directReadBytes+serverReadBytes},
  method:"One fresh Next production process per ID; first and immediate repeat; sequential; complete JSON body",selected,rows},null,2)+"\n");
for (const state of selected) for (const [kind,ocdId] of [["state",state.root],["county",state.county!]] as const) {
  const launched=performance.now();
  const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p","3304","-H","127.0.0.1"],{
    env:{...process.env,DATABASE_URL:connection,WTP_DB_ROLE:"production",WTP_VITAL_SIGNS_REPORT:"1",NODE_ENV:"production"},stdio:["ignore","pipe","pipe"],
  });
  let log=""; child.stdout.on("data",data=>{log+=data;}); child.stderr.on("data",data=>{log+=data;});
  try {
    await new Promise<void>((ready,fail)=>{
      const timer=setTimeout(()=>fail(new Error("Server startup timed out")),20_000);
      child.stdout.on("data",()=>{if(log.includes("Ready in")){clearTimeout(timer);ready();}});
      child.once("exit",code=>{clearTimeout(timer);fail(new Error(`Server exited before readiness (${code})`));});
    });
    const startupMs=performance.now()-launched;
    const bodies: unknown[]=[];
    for (const phase of ["first","repeat"]) {
      const started=performance.now();
      const response=await fetch(`http://127.0.0.1:3304/api/representation/${ocdId}`,{
        headers:{"x-wtp-synthetic-run":"rs-03-representation-check"},signal:AbortSignal.timeout(15_000),
      });
      const body=await response.json(); bodies.push(body);
      const row={state:state.postal,kind,ocdId,phase,at:new Date().toISOString(),ms:performance.now()-started,startupMs,
        status:response.status,label:body.label,divisionType:body.divisionType,tier:body.tier,metadataStatus:body.metadataStatus,
        holderStatus:body.holderStatus,holderIds:body.holders?.map((holder:{id:string})=>holder.id),
        cacheControl:response.headers.get("cache-control"),cdnCacheControl:response.headers.get("netlify-cdn-cache-control"),
        cacheTags:response.headers.get("netlify-cache-tag"),serverTiming:response.headers.get("server-timing")};
      rows.push(row); await save(); console.log(JSON.stringify(row));
    }
    assert.deepEqual(bodies[0],bodies[1],`${ocdId} retains its answer across visits`);
  } finally {
    if(child.exitCode===null && child.signalCode===null){
      const stopped=once(child,"close"); child.kill("SIGTERM");
      const timer=setTimeout(()=>child.kill("SIGKILL"),2_000);await stopped;clearTimeout(timer);
    }
    await writeFile(`${output}/${state.postal}-${kind}.log`,log.split(connection).join("[production readonly connection]"));
    const reports = new Map<string, number>();
    for (const line of log.split("\n")) if (line.startsWith("vital-signs-bytes ")) {
      const report = JSON.parse(line.slice("vital-signs-bytes ".length));
      reports.set(`${report.pid}:${report.hour}`,report.bytes.reader);
    }
    assert.ok(reports.size,"The server must report its production read bytes");
    serverReadBytes += [...reports.values()].reduce((sum,bytes)=>sum+bytes,0);
  }
}
await save();
const failures=rows.filter(row=>row.status!==200 || row.metadataStatus!=="HELD" || !row.label || Number(row.ms)+(row.phase==="first"?Number(row.startupMs):0)>=3000 ||
  !String(row.cdnCacheControl).includes("durable, max-age=60") || row.cacheControl==="no-store");
console.log(JSON.stringify({requests:rows.length,maxMs:Math.max(...rows.map(row=>Number(row.ms))),productionReadBytes:directReadBytes+serverReadBytes,failures}));
assert.equal(rows.length,200);assert.deepEqual(failures,[]);
