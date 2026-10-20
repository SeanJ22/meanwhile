import {ensureHuntBodyTarget} from '../lib/hunt/body-target.ts';
import {heldCaptureReader} from '../lib/civic-data/worker-publication-context.ts';
import test from "node:test";
import assert from 'node:assert/strict';
import {exaAgentExecutor} from '../lib/hunt/exa-lane.ts';
import {buildScoutToolkit} from '../lib/control-plane/scheduler/scout-tools.ts';
import {indexReportedFinding} from '../lib/control-plane/box.ts';
import {recordArtifactMetadata} from '../lib/control-plane/repository/coordinator.ts';
import {factDb} from './helpers/hunters-db.ts';
import {ensureEntity,learnOfficialHost} from '../lib/facts/entities.ts';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';
import {MemoryRoutineDataStore} from '../lib/civic-data/store.ts';
import {MemoryEvidenceStore,putArtifact} from '../lib/control-plane/evidence/store.ts';
import {beginAttempt,claim} from '../lib/control-plane/attempt.ts';
import {scheduleObligation} from '../lib/control-plane/scheduler/obligation.ts';
import {publishBoxFindings} from '../lib/facts/box-publication.ts';
import {factClocks} from '../lib/facts/clocks.ts';

test("Exa findings use the ordinary Box check and save their source evidence", async () => {
  const facts=await factDb(),repos=createMemoryRepositories(),vault=new MemoryEvidenceStore();
  const now=new Date().toISOString(),place='ocd-division/country:us/state:az/place:example',government='az:city:example',body=place+'#governing';
  for(const entity of [{id:place,kind:'place',name:'Example',state:'AZ',parentId:null},{id:government,kind:'government',name:'Example',state:'AZ',parentId:place}])await ensureEntity(facts.query,entity as never);
  await learnOfficialHost(facts.query,government,'https://example.gov');
  const attempt=beginAttempt({routeTaskId:'rt-site',workItemId:'wi-site',worker:{role:'ACQUIRER',provider:'test',version:'1',instance:'test'},lease:claim('rt-site','test',now,60000,null),now,methodVersion:0,policyVersion:'test'});
  await repos.attempts.put(attempt.id,attempt,now);
  const scheduled=scheduleObligation({id:'freshness:meetings-discovery:az:city:example#own-site-meetings',subjectId:government,recordClass:'meetings-discovery',routeId:'own-site-meetings',active:true,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null},Date.parse(now));
  if(!('cadenceHours' in scheduled))throw Error('fixture does not schedule');
  const job={obligation:scheduled,workItemId:'wi-site',routeTaskId:'rt-site',attemptId:attempt.id,holder:'test',executor:'DETERMINISTIC',bound:{maxAttempts:3,maxWallMs:60000}} as const;
  const seen:string[]=[];
  const pages:Record<string,string>={'https://example.gov/robots.txt':'User-agent: *\nAllow: /','https://example.gov/':'<title>Example, Arizona</title><main><a href="/council">City Council</a></main>','https://example.gov/council':'<title>Example, Arizona</title><main><h1>City Council</h1><table><tr><td>Jane Doe</td><td>Councilmember</td><td>jane@example.gov</td></tr><tr><td>John Smith</td><td>Councilmember</td><td>john@example.gov</td></tr></table></main>'};
  const findings=[['GOV-02','City Council','City Council'],['OFF-04','Jane Doe','Jane Doe Councilmember jane@example.gov'],['OFF-02','Councilmember','Jane Doe Councilmember jane@example.gov'],['OFF-09','jane@example.gov','Jane Doe Councilmember jane@example.gov'],['OFF-04','John Smith','John Smith Councilmember john@example.gov'],['OFF-02','Councilmember','John Smith Councilmember john@example.gov'],['OFF-09','john@example.gov','John Smith Councilmember john@example.gov'],['OFF-09','520-555-0111','Jane Doe Councilmember jane@example.gov']].map(([field,value,sentence])=>({subjectId:body,field,value,sentence,sourceUrl:'https://example.gov/council'}));
  findings[0]={...findings[0],subjectId:place+'#inventory:body',field:'GOV-01'};
  const packet={governmentId:place,label:'Example',held:[],blanks:[{subjectId:place+'#inventory:body',subjectLabel:'Example: body inventory',checklistId:'GOV-01',family:'GOV',requirement:'Discover every body'}]};
  const executor=exaAgentExecutor({prepareBody:async(finding,origin)=>{if(finding.field!=='GOV-02')return;for(const record of await repos.artifacts.read(origin.workItemId)){if(!finding.artifactIds.includes(record.artifactId))continue;const capture=await heldCaptureReader(vault)(record);if(capture)await ensureHuntBodyTarget({facts,subjectId:finding.subjectId,name:finding.value,quote:finding.exactQuote,capture,clocks:factClocks(null),now:new Date(now)});}},key:'fixture-key',budget:{take:async()=>null,done:async()=>{}},now:()=>now,instructions:async()=>'Find current officials with source evidence.',packetNow:async()=>packet,
   fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify({id:'fixture-run',status:'completed',costDollars:{total:0.5},output:{structured:{findings,summary:'Controlled provider fixture'}}})}),
   toolkitFor:ctx=>buildScoutToolkit({...ctx,openOne:async({url})=>{seen.push(url);const html=pages[url];assert.ok(html,'unexpected source '+url);return {status:200,body:html,bytes:Buffer.byteLength(html),contentType:url.endsWith('robots.txt')?'text/plain':'text/html',durationMs:1,transportError:null};}}),
   toolsFor:()=>({spaceOut:async()=>{},vault:async(a,text)=>{const saved=await putArtifact(vault,'freshness',a,Buffer.from(text));await recordArtifactMetadata(repos,{artifactId:a.id,tier:a.tier,contentHash:a.contentHash,byteLength:a.byteLength,contentType:a.contentType,canonicalUrl:a.canonicalUrl,partial:false,recordedAt:a.retrievedAt,workItemId:job.workItemId,attemptId:job.attemptId,routeTaskId:job.routeTaskId},now);return {stored:true,where:saved.key,why:'saved'};},reportFinding:{subjects:new Set([place,place+'#inventory:body']),write:async finding=>({boxId:(await indexReportedFinding(repos.boxFindings,{workItemId:job.workItemId,attemptId:job.attemptId,obligationId:'hunt:packet:'+place,missionPart:null,finding},now)).id})}}),
   onResult:async result=>{assert.equal(result.findings.length,7);assert.equal(result.worker?.provider,'exa');}});
  const outcome=await executor.run(job);
  for(const artifact of outcome.artifacts??[])await recordArtifactMetadata(repos,{...artifact,workItemId:job.workItemId,attemptId:job.attemptId,routeTaskId:job.routeTaskId},now);
  assert.equal(outcome.kind,'DISPOSED');assert.equal(outcome.cost?.usd,0.5);assert.equal((await repos.boxFindings.list()).flatMap(row=>row.value.origins).length,7);
  const published=await publishBoxFindings({repos,facts,vault,fetch:async()=>{throw new Error('must reuse saved evidence')},store:new MemoryRoutineDataStore(),clocks:factClocks(null),now,limit:100,purge:async()=>({purged:true})});
  const members=await facts.query("SELECT value->>'name' AS name FROM fact WHERE entity_id=$1 AND status='live' AND field LIKE 'member:%' ORDER BY name",[body]);
  const contacts=await facts.query("SELECT e.name,f.value FROM fact f JOIN entity e ON e.id=f.entity_id WHERE f.field='email' AND f.status='live' ORDER BY e.name");
  assert.deepEqual(members.map(r=>r.name),['Jane Doe','John Smith']);
  const [counts]=await facts.query("SELECT count(*) AS n FROM fact WHERE status='live'");
  assert.ok(published.published>0);assert.ok(Number(counts.n)>0);
  console.log(JSON.stringify({fixture:true,findings:findings.length,section3Passed:published.published,refused:published.refused,readerFacts:Number(counts.n),contacts,usd:outcome.cost?.usd,dollarsPerReaderFact:0.5/Number(counts.n),savedSourceRequests:seen.length,productionBytes:0}));
  await facts.pg.close();

});
