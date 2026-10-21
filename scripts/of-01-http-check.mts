/** Balanced HTTP timings and preservation on two compiled builds of one production copy. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const before = option("before") ?? "http://127.0.0.1:3101";
const after = option("after") ?? "http://127.0.0.1:3102";
for (const origin of [before,after]) assert.equal(new URL(origin).hostname,"127.0.0.1","Only local production-copy builds may be compared");
const output = resolve(option("out") ?? ".scratch/of-01/http-comparison.json");
await mkdir(dirname(output),{recursive:true});
const states = option("states")?.split(",") ?? ["AZ","AL","AK","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const rows: {state:string;phase:string;build:string;kind:string;ms:number;bytes:number;status:number;holders:number;country:string[];timing:string|null}[] = [];
const failures: string[] = [];
const save = () => writeFile(output,JSON.stringify({at:new Date().toISOString(),before,after,method:"Real complete HTTP JSON responses from compiled Next builds using the same normal production copy; alternating build order and reversed state order",rows,failures},null,2)+"\n");
async function read(state:string,build:string,origin:string,kind:string,phase:string) {
  const root=`ocd-division/country:us/${state==="DC"?"district":"state"}:${state.toLowerCase()}`;
  const path=kind==="representation"?`/api/representation/${root}`:`/api/reader/state?state=${state}`;
  const started=performance.now();
  const response=await fetch(origin+path,{headers:{"x-wtp-synthetic-run":"of-01-http"},signal:AbortSignal.timeout(15_000)});
  const text=await response.text(),ms=performance.now()-started;
  const body=JSON.parse(text);
  const countryHolders=(body.coverage?.seats??[]).filter((seat:{ocdId:string})=>seat.ocdId==="ocd-division/country:us").flatMap((seat:{representatives:{officeTitle:string;sourceUrl?:string;contactFormUrl?:string}[]})=>seat.representatives);
  const country=countryHolders.map((holder:{officeTitle:string})=>holder.officeTitle);
  rows.push({state,phase,build,kind,ms,bytes:Buffer.byteLength(text),status:response.status,holders:body.holders?.length??0,country,timing:response.headers.get("server-timing")});
  if(response.status!==200)failures.push(`${state}:${build}:${kind}:${response.status}`);
  if(ms>=3000)failures.push(`${state}:${build}:${kind}:${phase}:over-three-seconds`);
  if(build==="after"&&kind==="state"&&!country.includes("Vice President of the United States"))failures.push(`${state}:vice-president-missing`);
  if(build==="after"&&kind==="state"){
    const vice=countryHolders.find((holder:{officeTitle:string})=>holder.officeTitle==="Vice President of the United States");
    if(vice&&(!/^https:\/\/www\.whitehouse\.gov\/administration\//.test(vice.sourceUrl??"")||vice.contactFormUrl!=="https://www.whitehouse.gov/contact/"))failures.push(`${state}:vice-president-source-or-contact-missing`);
  }
  return body;
}
for(const phase of ["forward","reverse"]){
  const selected=phase==="forward"?states:[...states].reverse();
  for(let index=0;index<selected.length;index++){
    const state=selected[index]!;
    const order=(index+(phase==="reverse"?1:0))%2?[["after",after],["before",before]]:[["before",before],["after",after]];
    for(const kind of ["representation","state"]){
      const answers=new Map<string,Record<string,unknown>>();
      for(const[build,origin]of order)answers.set(build!,await read(state,build!,origin!,kind,phase));
      if(kind==="representation"){
        const old=answers.get("before")!.holders as {id:string;name:string;officeTitle:string;phone?:string;sourceUrl?:string}[];
        const current=answers.get("after")!.holders as typeof old;
        for(const holder of old){
          const match=current.find(row=>row.id===holder.id&&row.officeTitle===holder.officeTitle);
          if(!match)failures.push(`${state}:${holder.id}:official-missing`);
          else for(const key of ["phone","sourceUrl"] as const)if(holder[key]&&match[key]!==holder[key])failures.push(`${state}:${holder.id}:${key}-changed`);
        }
      }
    }
    console.log(JSON.stringify({phase,state,latest:rows.slice(-4).map(row=>({build:row.build,kind:row.kind,ms:Math.round(row.ms)}))}));
    await save();
  }
}
const summary=(["representation","state"] as const).map(kind=>({kind,...Object.fromEntries(["before","after"].map(build=>{
  const times=rows.filter(row=>row.kind===kind&&row.build===build).map(row=>row.ms).sort((a,b)=>a-b);
  return[build,{requests:times.length,median:times[Math.floor((times.length-1)/2)],p95:times[Math.floor((times.length-1)*.95)],max:times.at(-1)}];
}))}));
await save();
await writeFile(output.replace(/\.json$/,"-summary.json"),JSON.stringify({summary,failures},null,2)+"\n");
console.log(JSON.stringify({summary,failures}));
assert.deepEqual(failures,[]);
