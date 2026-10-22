/** Production verification: SELECT only, with read-only roles. No accounting, fix, brief, or checkpoint writes. */
import { neon, neonConfig } from "@neondatabase/serverless";
import { readFileSync, writeFileSync } from "node:fs";
import { countNeonBytes, processNeonBytes } from "../../db/transfer-by-caller.ts";
import { previewConfigGrowth,readFixConfig,withKeeperFixes,composeHour, initializeLineKeeper, ownReading, runLineKeeper } from "./keep.ts";
import { readHour } from "./read.ts";
import { easternBriefClock } from "../admin-view/brief.ts";
import { HOUR } from "./model.ts";
import { readDestinationDelta } from "./destinations.ts";
import { readTransferCounters } from './transfer.ts';
import { readInventory,foldInventory } from "./inventory.ts";
import { readPostingWindow } from "./posting.ts";
import { readRecordTargets } from "./records.ts";
import { readMeetingTargets } from "./public.ts";
import { keeperRows, keeperVital } from "./admin.ts";
import { installDatabaseTransferCounter } from '../../db/transfer.ts';
import { VITAL_SIGNS_REPORT_ENV } from '../../db/transfer-by-caller.ts';

const controlUrl=process.env.WTP_CONTROL_PLANE_DATABASE_URL_READONLY,readerUrl=process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if(!controlUrl||!readerUrl) throw Error("Set the two production read-only connection variables");
process.env.DATABASE_URL=readerUrl;
// Install the shared hooks before replacing HTTP metering. The read-only preview never
// flushes accounting writes or counts a response twice when a shared reader initializes.
process.env[VITAL_SIGNS_REPORT_ENV]='1';
installDatabaseTransferCounter();
const original=fetch;
neonConfig.fetchFunction=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const response=await original(input,init),body=await response.arrayBuffer();
  const headers=new Headers(init?.headers);
  countNeonBytes(headers.get("neon-connection-string")===readerUrl?"reader":"control-plane",body.byteLength);
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
};
const control=neon(controlUrl,{readOnly:true}),reader=neon(readerUrl,{readOnly:true}),at=new Date().toISOString();
const seedStart=ownReading().bytesRead;
const statePath=process.argv.find(a=>a.startsWith("--state="))?.slice(8);
let initialState=statePath?JSON.parse(readFileSync(statePath,"utf8")).state:process.argv.includes("--initialize-clocks")?await initializeLineKeeper(control,reader,at,{readOnly:true}):undefined;
if(initialState&&process.argv.includes('--refresh-transfer'))initialState={...initialState,transferSample:await readTransferCounters(reader,at,true)};
if(initialState&&process.argv.includes('--refresh-inventory')){
 const from=new Date(Date.parse(at)-7*86400000).toISOString();
 const [inventory,posting,targets,recordTargets,destinations]=await Promise.all([readInventory(control,at,at,true),readPostingWindow(reader,from,at),readMeetingTargets(reader,from,at),readRecordTargets(reader,from,at,true),readDestinationDelta(reader,at,at,true)]);
 initialState={...initialState,inventory:foldInventory(undefined,inventory),posting,targets,recordTargets,destinations:destinations??{}};
}
if(initialState&&process.argv.includes('--refresh-targets')){
 const from=new Date(Date.parse(at)-7*86400000).toISOString();
 const [posting,targets,recordTargets]=await Promise.all([readPostingWindow(reader,from,at),readMeetingTargets(reader,from,at),readRecordTargets(reader,from,at,true)]);
 initialState={...initialState,posting,targets,recordTargets};
}
const seedBytes=ownReading().bytesRead-seedStart;
const countryCachePath=process.argv.find(a=>a.startsWith('--country-cache='))?.slice(16);
const countryCache=countryCachePath?JSON.parse(readFileSync(countryCachePath,'utf8')).caches:undefined;
const result=await runLineKeeper(control,reader,at,{readOnly:true,initialState,checkPages:process.argv.includes('--check-pages'),measureCountry:process.argv.includes('--country-changes'),countryCache});
if(process.argv.includes("--today")) {
  for(let end=Date.parse(result.hour.from);easternBriefClock(new Date(end-1).toISOString()).day===easternBriefClock(at).day;end-=HOUR) {
    const baseline=ownReading().byCaller;
    const input=await readHour(control,reader,at,{window:{from:new Date(end-HOUR).toISOString(),through:new Date(end).toISOString()},clocks:false});
    const composed=composeHour(input,result.state,at);
    // Historical event counts are available; historical browser views and old source
    // inventories are not reconstructed from today's state.
    const hour={...composed,problems:composed.problems.filter(p=>/^(?:link:|handoff:|empty:|saved-nothing:|fetched-nothing:|failed:|unmeasured:|paid-ended-empty$|rounds-killed$|unpriced-costs$)/.test(p.key)),own:ownReading(baseline)};
    result.state={...result.state,hours:[...result.state.hours,hour]};
  }
}
const todayFixes=new Map([...result.state.hours].reverse().flatMap(h=>h.problems).map(p=>[p.key,p]));
const heldConfig=await readFixConfig(control,at);
let simulated=heldConfig.value;
for(const hour of [...result.state.hours].sort((a,b)=>a.from.localeCompare(b.from)))simulated=withKeeperFixes(simulated,hour);
const todayGrowth=await previewConfigGrowth(control,heldConfig,simulated,result.hour);
const report={at,todayGrowth,window:{from:result.hour.from,through:result.hour.through},now:keeperVital(result.state),scoreboard:Object.fromEntries(keeperRows(result.state,at)),
  fixes:[...todayFixes.values()],initializationBytes:seedBytes,hourly:result.hour.own,totalBytesRead:ownReading().bytesRead,byDatabase:processNeonBytes(),state:result.state};
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
if(out) writeFileSync(out,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,state:undefined,byDatabase:undefined},null,2));
