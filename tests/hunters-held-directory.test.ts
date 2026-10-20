import test from "node:test";
import {readPlacePackage} from '../lib/reader/place.ts';
import {readFactRosters} from '../lib/facts/roster-read.ts';
import assert from 'node:assert/strict';
import {placeSourceExecutor} from '../lib/hunt/own-site-runtime.ts';
import {factDb} from './helpers/fact-db.ts';
import {ensureEntity} from '../lib/facts/entities.ts';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';
import {MemoryRoutineDataStore} from '../lib/civic-data/store.ts';
import {MemoryEvidenceStore,putArtifact} from '../lib/control-plane/evidence/store.ts';
import {beginAttempt,claim} from '../lib/control-plane/attempt.ts';
import {scheduleObligation} from '../lib/control-plane/scheduler/obligation.ts';
import {publishBoxFindings} from '../lib/facts/box-publication.ts';
import {factClocks} from '../lib/facts/clocks.ts';
import {readFileSync} from 'node:fs';

test("another job reuses an official directory and source pages while publication rebuilds the reader place", async () => {
  const facts=await factDb(),repos=createMemoryRepositories(),vault=new MemoryEvidenceStore();
  await facts.pg.exec('CREATE TABLE civic_data_candidate_events(candidate_id text,detail text,sequence bigint); CREATE TABLE cp_work_items_history(id text primary key,value jsonb); CREATE TABLE cp_work_items(id text primary key,value jsonb); CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,source_id text,retrieved_at timestamptz,candidate jsonb,state text,acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,normalized_hash text,validation_receipt jsonb); CREATE TABLE civic_data_payload_parts(hash text primary key,payload jsonb); CREATE TABLE civic_data_promotions(key text primary key,record_class text,scope text,current_version_id text,payload jsonb);');
  for(const stmt of readFileSync(new URL('../lib/db/migrations/0036_ne01.sql',import.meta.url),'utf8').split('--> statement-breakpoint').slice(1))await facts.pg.exec(stmt);
  const now=new Date().toISOString(),place='ocd-division/country:us/state:az/place:example',government='az:city:example',body=government+'#governing';
  for(const entity of [{id:place,kind:'place',name:'Example',state:'AZ',parentId:null},{id:government,kind:'government',name:'Example',state:'AZ',parentId:place}])await ensureEntity(facts.query,entity as never);

  const attempt=beginAttempt({routeTaskId:'rt-site',workItemId:'wi-site',worker:{role:'ACQUIRER',provider:'test',version:'1',instance:'test'},lease:claim('rt-site','test',now,60000,null),now,methodVersion:0,policyVersion:'test'});
  await repos.attempts.put(attempt.id,attempt,now);
  const scheduled=scheduleObligation({id:'freshness:meetings-discovery:az:city:example#own-site-meetings',subjectId:government,recordClass:'meetings-discovery',routeId:'own-site-meetings',active:true,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null},Date.parse(now));
  if(!('cadenceHours' in scheduled))throw Error('fixture does not schedule');
  const job={obligation:scheduled,workItemId:'wi-site',routeTaskId:'rt-site',attemptId:attempt.id,holder:'test',executor:'DETERMINISTIC',bound:{maxAttempts:3,maxWallMs:60000}} as const;
  const seen:string[]=[];
  const pages:Record<string,string>={'https://example.org/robots.txt':'User-agent: *\nAllow: /','https://example.org/':'<title>Example, Arizona</title><main><a href="/council">City Council</a></main>','https://example.org/council':'<title>Example, Arizona</title><main><h1>City Council</h1><table><tr><td>Jane Doe</td><td>Mayor</td><td>jane@example.gov</td><td><img src="https://example.org/jane.jpg" alt="Jane Doe"></td></tr><tr><td>John Smith</td><td>Councilmember</td><td>john@example.gov</td></tr></table></main>'};
  pages['https://directory.gov/robots.txt']='User-agent: *\nAllow: /';pages['https://directory.gov/list']='<title>Arizona government directory</title><a href="https://example.org/">Example</a><table><tr><td>Wrong Official</td><td>Mayor</td></tr></table>';
  const createRun=(repos:ReturnType<typeof createMemoryRepositories>,heldRead:NonNullable<Parameters<typeof placeSourceExecutor>[0]['readHeldPage']>)=>placeSourceExecutor({repos,scope:{jurisdictionId:government,governmentId:government,bodyId:body,name:'Example',state:'AZ',website:'https://directory.gov/list',knownOwnSite:false,directorySeeds:['https://directory.gov/list']},query:facts.query,now:()=>now,readHeldPage:heldRead,spaceOut:async()=>{},vault:async(a,text)=>{const saved=await putArtifact(vault,'freshness',a,Buffer.from(text));return {stored:true,where:saved.key,why:'saved'};},open:async({url})=>{seen.push(url);const body=pages[url];assert.ok(body,'unexpected source '+url);return {status:200,body,bytes:Buffer.byteLength(body),contentType:url.endsWith('robots.txt')?'text/plain':'text/html',durationMs:1,transportError:null};}});
  const initial=await createRun(repos,async()=>null)(job);
  const sourceRecords=await repos.artifacts.read(job.workItemId);
  const nextRepos=createMemoryRepositories();
  for(const record of sourceRecords)await nextRepos.artifacts.append(record.workItemId,record.artifactId+':'+record.canonicalUrl,record,record.recordedAt);
  const before=seen.length;
  const outcome=await createRun(nextRepos,async(url:string)=>{
   const source=sourceRecords.find(r=>r.canonicalUrl===url && !url.endsWith('/robots.txt'));
   return source?{url,html:pages[url],artifactId:source.artifactId,observedAt:source.recordedAt,sourceWorkItemId:source.workItemId,sourceAttemptId:source.attemptId}:null;
  })({...job,workItemId:'wi-followup',attemptId:'at-followup',routeTaskId:'rt-followup'});
  assert.equal(seen.length,before,'another place worker reuses the existing official directory and saved source pages');
  assert.equal(outcome.cost?.requestCount,0);
  const origins=(await nextRepos.boxFindings.list()).flatMap(r=>r.value.origins);
  assert.ok(origins.every(o=>o.workItemId==='wi-followup' && o.sourceWorkItemId===job.workItemId));
  console.log(JSON.stringify({outcome,seen}));
  assert.equal(outcome.kind,'DISPOSED');assert.equal(initial.cost?.requestCount,5);assert.ok((outcome.disposition?.observation?.normalizedCount??0)>=5);
  const published=await publishBoxFindings({repos:nextRepos,facts,vault,fetch:async()=>{throw new Error('must reuse saved evidence')},store:new MemoryRoutineDataStore(),clocks:factClocks(null),now,limit:100,purge:async()=>({purged:true})});
  const members=await facts.query("SELECT value->>'name' AS name FROM fact WHERE entity_id=$1 AND status='live' AND field LIKE 'member:%' ORDER BY name",[body]);
  const contacts=await facts.query("SELECT e.name,f.value FROM fact f JOIN entity e ON e.id=f.entity_id WHERE f.field='email' AND f.status='live' ORDER BY e.name");
  assert.deepEqual(members.map(r=>r.name),['Jane Doe','John Smith']);assert.deepEqual(contacts.map(r=>[r.name,r.value]),[['Jane Doe','jane@example.gov'],['John Smith','john@example.gov']]);
  const roster=await readFactRosters(facts.query,[body]);assert.equal(roster.rosters[0]?.members.find(m=>m.name==='Jane Doe')?.photoUrl,'https://example.org/jane.jpg');
  const placeReader=await readPlacePackage({state:'AZ',divisionIds:[place]},facts.query);assert.equal(placeReader.bodies[0]?.fields.bodyClass,'Council');assert.equal(placeReader.bodies[0]?.fields.homepageUrl,'https://example.org/');assert.ok(!(await repos.boxFindings.list()).some(row=>JSON.stringify(row.value).includes('Wrong Official')));assert.equal(placeReader.bodies[0]?.roster?.members.find(m=>m.name==='Jane Doe')?.photoUrl,'https://example.org/jane.jpg');
  const queued=await facts.query('SELECT place_id FROM rebuild_queue WHERE place_id=$1',[place]);assert.equal(queued.length,1,'publishing a new native body must rebuild its reader place');
  console.log(JSON.stringify({published,members,contacts,website:placeReader.bodies[0]?.fields.homepageUrl,type:placeReader.bodies[0]?.fields.bodyClass,portrait:roster.rosters[0]?.members.find(m=>m.name==='Jane Doe')?.photoUrl,initialRequests:seen.length,cachedReplayRequests:outcome.cost?.requestCount,usd:0,productionBytes:0}));
  await facts.pg.close();

});
