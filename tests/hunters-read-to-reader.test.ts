import {ensureHuntBodyTarget} from '../lib/hunt/body-target.ts';
import {heldCaptureReader} from '../lib/civic-data/worker-publication-context.ts';
import test from "node:test";
import assert from 'node:assert/strict';
import {placeSourceExecutor} from '../lib/hunt/own-site-runtime.ts';
import {factDb} from './helpers/hunters-db.ts';
import {ensureEntity,learnOfficialHost} from '../lib/facts/entities.ts';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';
import {MemoryRoutineDataStore} from '../lib/civic-data/store.ts';
import {MemoryEvidenceStore,putArtifact} from '../lib/control-plane/evidence/store.ts';
import {beginAttempt,claim} from '../lib/control-plane/attempt.ts';
import {scheduleObligation} from '../lib/control-plane/scheduler/obligation.ts';
import {publishBoxFindings} from '../lib/facts/box-publication.ts';
import type {SitePage} from '../lib/hunt/site-findings.ts';
import {factClocks} from '../lib/facts/clocks.ts';

test("a government source reads despite advisory robots and passes saved evidence to the existing Box publisher", async () => {
  const facts=await factDb(),vault=new MemoryEvidenceStore();
  let repos=createMemoryRepositories();
  let readHeldPage:(url:string)=>Promise<SitePage|null>=async()=>null;
  const now=new Date().toISOString(),place='ocd-division/country:us/state:az/place:example',government='az:city:example',body=place+'#governing';
  for(const entity of [{id:place,kind:'place',name:'Example',state:'AZ',parentId:null},{id:government,kind:'government',name:'Example',state:'AZ',parentId:place}])await ensureEntity(facts.query,entity as never);
  await learnOfficialHost(facts.query,government,'https://example.gov');
  const attempt=beginAttempt({routeTaskId:'rt-site',workItemId:'wi-site',worker:{role:'ACQUIRER',provider:'test',version:'1',instance:'test'},lease:claim('rt-site','test',now,60000,null),now,methodVersion:0,policyVersion:'test'});
  await repos.attempts.put(attempt.id,attempt,now);
  const scheduled=scheduleObligation({id:'freshness:meetings-discovery:az:city:example#own-site-meetings',subjectId:government,recordClass:'meetings-discovery',routeId:'own-site-meetings',active:true,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null},Date.parse(now));
  if(!('cadenceHours' in scheduled))throw Error('fixture does not schedule');
  const job={obligation:scheduled,workItemId:'wi-site',routeTaskId:'rt-site',attemptId:attempt.id,holder:'test',executor:'DETERMINISTIC',bound:{maxAttempts:3,maxWallMs:60000}} as const;
  const seen:string[]=[];
  const pages:Record<string,string>={'https://example.gov/robots.txt':'User-agent: *\nDisallow: /','https://example.gov/':'<title>Example, Arizona</title><main><a href="/council">City Council</a></main>','https://example.gov/council':'<title>Example, Arizona</title><main><h1>City Council</h1><table><tr><td>Jane Doe</td><td>Mayor</td><td>jane@example.gov</td><td><img src="https://example.gov/jane.jpg" alt="Jane Doe"></td></tr><tr><td>John Smith</td><td>Councilmember</td><td>john@example.gov</td></tr></table></main>'};
  const createRun=()=>placeSourceExecutor({repos,scope:{jurisdictionId:government,governmentId:place,bodyId:body,name:'Example',state:'AZ',website:'https://example.gov/'},query:facts.query,prepareBody:async(finding,origin)=>{if(finding.field!=='GOV-02')return;for(const record of await repos.artifacts.read(origin.workItemId)){if(!finding.artifactIds.includes(record.artifactId))continue;const capture=await heldCaptureReader(vault)(record);if(capture)await ensureHuntBodyTarget({facts,subjectId:finding.subjectId,name:finding.value,quote:finding.exactQuote,capture,clocks:factClocks(null),now:new Date(now)});}},now:()=>now,readHeldPage:url=>readHeldPage(url),spaceOut:async()=>{},vault:async(a,text)=>{const saved=await putArtifact(vault,'freshness',a,Buffer.from(text));return {stored:true,where:saved.key,why:'saved'};},open:async({url})=>{seen.push(url);const body=pages[url];assert.ok(body,'unexpected source '+url);return {status:200,body,bytes:Buffer.byteLength(body),contentType:url.endsWith('robots.txt')?'text/plain':'text/html',durationMs:1,transportError:null};}});
  const outcome=await createRun()(job);
  console.log(JSON.stringify({outcome,seen}));
  assert.equal(outcome.kind,'DISPOSED');assert.equal(outcome.cost?.requestCount,3);assert.ok((outcome.disposition?.observation?.normalizedCount??0)>=5);
  // A later job must publish from the earlier job's saved bytes without
  // relabeling the source's owner or check time, or refetching the page.
  const originalRecords=await repos.artifacts.read(job.workItemId);
  repos=createMemoryRepositories();
  for(const record of originalRecords)await repos.artifacts.append(record.workItemId,record.artifactId,record,record.recordedAt);
  const laterAttempt=beginAttempt({routeTaskId:'rt-reuse',workItemId:'wi-reuse',worker:{role:'ACQUIRER',provider:'test',version:'1',instance:'test'},lease:claim('rt-reuse','test',now,60000,null),now,methodVersion:0,policyVersion:'test'});
  await repos.attempts.put(laterAttempt.id,laterAttempt,now);
  readHeldPage=async url=>{
   for(const record of originalRecords){
    if(record.canonicalUrl!==url)continue;
    const capture=await heldCaptureReader(vault)(record);
    if(capture)return {url:capture.evidence.canonicalUrl,html:capture.evidence.text,artifactId:record.artifactId,observedAt:capture.observedAt,sourceWorkItemId:record.workItemId,sourceAttemptId:record.attemptId};
   }
   return null;
  };
  const reused=await createRun()({...job,workItemId:'wi-reuse',routeTaskId:'rt-reuse',attemptId:laterAttempt.id});
  assert.equal(reused.kind,'DISPOSED');
  assert.equal(reused.cost?.requestCount,0);
  assert.equal(seen.length,3);
  const references=await repos.artifacts.read('wi-reuse');
  assert.equal(references.length,2);
  for(const record of references)assert.deepEqual(record,originalRecords.find(original=>original.artifactId===record.artifactId));
  for(const row of await repos.boxFindings.list())assert.ok(row.value.origins.every(origin=>origin.workItemId==='wi-reuse'));
  const published=await publishBoxFindings({repos,facts,vault,fetch:async()=>{throw new Error('must reuse saved evidence')},store:new MemoryRoutineDataStore(),clocks:factClocks(null),now,limit:100,purge:async()=>({purged:true})});
  const members=await facts.query("SELECT value->>'name' AS name FROM fact WHERE entity_id=$1 AND status='live' AND field LIKE 'member:%' ORDER BY name",[body]);
  const contacts=await facts.query("SELECT e.name,f.value FROM fact f JOIN entity e ON e.id=f.entity_id WHERE f.field='email' AND f.status='live' ORDER BY e.name");
  assert.deepEqual(members.map(r=>r.name),['Jane Doe','John Smith']);
  console.log(JSON.stringify({published,members,contacts,requests:seen.length,usd:0}));
  await facts.pg.close();

});
