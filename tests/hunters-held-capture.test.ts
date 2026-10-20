import test from "node:test";
import assert from 'node:assert/strict';
import {placeSourceExecutor} from '../lib/hunt/own-site-runtime.ts';
import {factDb} from './helpers/fact-db.ts';
import {ensureEntity,learnOfficialHost} from '../lib/facts/entities.ts';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';
import {MemoryRoutineDataStore} from '../lib/civic-data/store.ts';
import {MemoryEvidenceStore,putArtifact} from '../lib/control-plane/evidence/store.ts';
import {beginAttempt,claim} from '../lib/control-plane/attempt.ts';
import {scheduleObligation} from '../lib/control-plane/scheduler/obligation.ts';
import {publishBoxFindings} from '../lib/facts/box-publication.ts';
import {factClocks} from '../lib/facts/clocks.ts';
import {readFileSync} from 'node:fs';

test("the reporting job receives credit while source evidence retains its original job", async () => {
  const facts=await factDb(),repos=createMemoryRepositories(),vault=new MemoryEvidenceStore();
  await facts.pg.exec('CREATE TABLE civic_data_payload_parts(hash text primary key,payload jsonb); CREATE TABLE civic_data_promotions(key text primary key,record_class text,scope text,current_version_id text,payload jsonb);');
  for(const stmt of readFileSync(new URL('../lib/db/migrations/0036_ne01.sql',import.meta.url),'utf8').split('--> statement-breakpoint').slice(1))await facts.pg.exec(stmt);
  const now=new Date().toISOString(),place='ocd-division/country:us/state:az/place:example',government='az:city:example',body=place+'#governing';
  for(const entity of [{id:place,kind:'place',name:'Example',state:'AZ',parentId:null},{id:government,kind:'government',name:'Example',state:'AZ',parentId:place}])await ensureEntity(facts.query,entity as never);
  await learnOfficialHost(facts.query,government,'https://example.gov');
  const attempt=beginAttempt({routeTaskId:'rt-site',workItemId:'wi-site',worker:{role:'ACQUIRER',provider:'test',version:'1',instance:'test'},lease:claim('rt-site','test',now,60000,null),now,methodVersion:0,policyVersion:'test'});
  await repos.attempts.put(attempt.id,attempt,now);
  const scheduled=scheduleObligation({id:'freshness:meetings-discovery:az:city:example#own-site-meetings',subjectId:government,recordClass:'meetings-discovery',routeId:'own-site-meetings',active:true,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null},Date.parse(now));
  if(!('cadenceHours' in scheduled))throw Error('fixture does not schedule');
  const job={obligation:scheduled,workItemId:'wi-site',routeTaskId:'rt-site',attemptId:attempt.id,holder:'test',executor:'DETERMINISTIC',bound:{maxAttempts:3,maxWallMs:60000}} as const;
  const seen:string[]=[];
  const pages:Record<string,string>={'https://example.gov/robots.txt':'User-agent: *\nAllow: /','https://example.gov/':'<title>Example, Arizona</title><main><a href="/council">City Council</a></main>','https://example.gov/council':'<title>Example, Arizona</title><main><h1>City Council</h1><table><tr><td>Jane Doe</td><td>Mayor</td><td>jane@example.gov</td></tr><tr><td>John Smith</td><td>Councilmember</td><td>john@example.gov</td></tr></table></main>'};
  const run=placeSourceExecutor({repos,scope:{jurisdictionId:government,governmentId:place,bodyId:body,name:'Example',state:'AZ',website:'https://example.gov/'},query:facts.query,now:()=>now,readHeldPage:async()=>null,spaceOut:async()=>{},vault:async(a,text)=>{const saved=await putArtifact(vault,'freshness',a,Buffer.from(text));return {stored:true,where:saved.key,why:'saved'};},open:async({url})=>{seen.push(url);const body=pages[url];assert.ok(body,'unexpected source '+url);return {status:200,body,bytes:Buffer.byteLength(body),contentType:url.endsWith('robots.txt')?'text/plain':'text/html',durationMs:1,transportError:null};}});
  const outcome=await run(job);
  console.log(JSON.stringify({outcome,seen}));
  for(const row of await repos.boxFindings.list()){const changed={...row.value,origins:row.value.origins.map(origin=>({...origin,workItemId:'second-job',resultId:'second-attempt',sourceWorkItemId:origin.workItemId,sourceAttemptId:attempt.id,sourceCheckedAt:now}))};await repos.boxFindings.compareAndSet(row.id,row.revision,changed,now);}

  assert.equal(outcome.kind,'DISPOSED');assert.equal(outcome.cost?.requestCount,3);assert.ok((outcome.disposition?.observation?.normalizedCount??0)>=5);
  const published=await publishBoxFindings({repos,facts,vault,fetch:async()=>{throw new Error('must reuse saved evidence')},store:new MemoryRoutineDataStore(),clocks:factClocks(null),now,limit:100,purge:async()=>({purged:true})});
  const members=await facts.query("SELECT value->>'name' AS name FROM fact WHERE entity_id=$1 AND status='live' AND field LIKE 'member:%' ORDER BY name",[body]);
  const contacts=await facts.query("SELECT e.name,f.value FROM fact f JOIN entity e ON e.id=f.entity_id WHERE f.field='email' AND f.status='live' ORDER BY e.name");
  assert.deepEqual(members.map(r=>r.name),['Jane Doe','John Smith']);assert.deepEqual(contacts.map(r=>[r.name,r.value]),[['Jane Doe','jane@example.gov'],['John Smith','john@example.gov']]);
  assert.ok((await repos.boxFindings.list()).every(row=>row.value.origins[0].workItemId==='second-job' && row.value.origins[0].sourceWorkItemId==='wi-site'));
  console.log(JSON.stringify({published,members,contacts,reportingJob:'second-job',sourceJob:'wi-site',requests:seen.length,usd:0,productionBytes:0}));
  await facts.pg.close();

});
