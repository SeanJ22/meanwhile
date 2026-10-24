import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';
import {readPlatformGovernment} from '../lib/control-plane/discovery/platform-government.ts';
import {platformRegistrationNeed,platformRegistrationBinding,type PlatformRegistrationPage} from '../lib/control-plane/discovery/platform-registration.ts';
import type {DoorRecord} from '../lib/doors/registry.ts';

const directory=process.argv[2]??'.scratch/rb-a4';
const door=JSON.parse(readFileSync(`${directory}/metro-door.json`,'utf8')) as DoorRecord;
const pages=JSON.parse(readFileSync(`${directory}/metro-governments.json`,'utf8')) as PlatformRegistrationPage[];
const page=pages.find(page=>page.government.state==='OR')!;
const index=JSON.parse(readFileSync(`${directory}/portal-read-index.json`,'utf8')) as Record<string,{url:string;status:number;hash:string;contentType:string}>;
const pg=new PGlite(),repos=createMemoryRepositories();
await pg.exec('CREATE TABLE civic_data_promotions(record_class text,scope text,current_version_id text,promoted_at timestamptz,payload jsonb); CREATE TABLE civic_data_candidates(id text,normalized_hash text)');
for(const page of pages) {
  await pg.query('INSERT INTO civic_data_candidates VALUES($1,$2)',[page.versionId,page.readModelHash]);
  await pg.query('INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4,$5::jsonb)',['REGISTRATION',`US-${page.government.state}:registration:v1`,page.versionId,page.promotedAt,JSON.stringify({governments:[page.government]})]);
}
const query=async(sql:string,params:readonly unknown[]) => (await pg.query<Record<string,unknown>>(sql,[...params])).rows;
let now=new Date().toISOString();
const observed:unknown[]=[];
const open=async(input:{url:string})=>{
  const source=index[input.url] ?? Object.values(index).find(source=>source.url===input.url);
  if(!source) return {status:null,body:'',bytes:0,contentType:'text/html',location:null,transportError:'No held source for this local replay'};
  const body=readFileSync(`${directory}/portal-sources/${source.hash}`,'utf8');
  observed.push({url:source.url,status:source.status,sha256:source.hash});
  return {status:source.status,body,bytes:Buffer.byteLength(body),contentType:source.contentType,location:null,transportError:null,
    retrievedAt:statSync(`${directory}/portal-sources/${source.hash}`).mtime.toISOString()};
};
const withdrawals:string[]=[];
try {
  await repos.doors.put(door.doorId,door,now);
  const input={need:platformRegistrationNeed(page)!,registered:platformRegistrationBinding(page),repos,query,
    reviewer:'auto-crosswalk-reviewer@0123456789ab',tenant:{platform:'legistar',url:String(door.config.platformPublisherUrl),name:'Metro',state:'OR',source:'production door'},
    runtime:{now:()=>now,open,spaceOut:async()=>{},budget:{spent:()=>false},vault:async()=>({stored:true,where:'isolated source replay',why:'saved'})},
    withdraw:async(record:DoorRecord)=>{withdrawals.push(record.doorId);}};
  const first=await readPlatformGovernment(input);
  assert.ok(first.withdrawn.some(row=>row.doorId===door.doorId));
  assert.equal((await repos.doors.mustRead(door.doorId)).value.status,'SUSPENDED');
  assert.equal(first.doors.some(row=>row.config?.platformPublisherUrl===door.config.platformPublisherUrl),false);
  now=new Date(Date.parse(now)+12*3_600_000).toISOString();
  const next=await readPlatformGovernment(input);
  assert.equal((await repos.doors.mustRead(door.doorId)).value.status,'SUSPENDED');
  assert.equal(next.doors.some(row=>row.config?.platformPublisherUrl===door.config.platformPublisherUrl),false);
  assert.ok(withdrawals.length>=2,'an interrupted reader withdrawal is safe to retry on the next run');
  mkdirSync('docs/measurements/rb-a4',{recursive:true});
  writeFileSync('docs/measurements/rb-a4/portal-connection.json',JSON.stringify({productionRole:'wtp_cp_release_readonly',productionWrites:0,
    doorId:door.doorId,government:page.government,portal:door.config.platformPublisherUrl,sources:[...new Map(observed.map(row=>[JSON.stringify(row),row])).values()],
    firstRun:'SUSPENDED in isolated control-plane copy; reader withdrawal invoked',nextRun:'still SUSPENDED; directory cannot reopen the wrong portal',
    preservedDoorId:true,withdrawalCalls:withdrawals.length},null,2)+'\n');
  console.log(JSON.stringify({door:door.doorId,nextRun:'SUSPENDED',withdrawals:withdrawals.length}));
} finally {await pg.close();}
