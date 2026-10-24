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
import {indexReportedFinding} from '../lib/control-plane/box.ts';
import {factClocks} from '../lib/facts/clocks.ts';

test("own-site calendar observations retain their parent link and platform URLs remain unrequested leads", async () => {
  const facts=await factDb(),repos=createMemoryRepositories(),vault=new MemoryEvidenceStore();
  const now=new Date().toISOString(),place='ocd-division/country:us/state:az/place:example',government='az:city:example',body=place+'#governing';
  for(const entity of [{id:place,kind:'place',name:'Example',state:'AZ',parentId:null},{id:government,kind:'government',name:'Example',state:'AZ',parentId:place},{id:body,kind:'body',name:'City Council',state:'AZ',parentId:government}])await ensureEntity(facts.query,entity as never);
  await learnOfficialHost(facts.query,government,'https://example.gov');
  const attempt=beginAttempt({routeTaskId:'rt-site',workItemId:'wi-site',worker:{role:'ACQUIRER',provider:'test',version:'1',instance:'test'},lease:claim('rt-site','test',now,60000,null),now,methodVersion:0,policyVersion:'test'});
  await repos.attempts.put(attempt.id,attempt,now);
  const scheduled=scheduleObligation({id:'freshness:meetings-discovery:az:city:example#own-site-meetings',subjectId:government,recordClass:'meetings-discovery',routeId:'own-site-meetings',active:true,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null},Date.parse(now));
  if(!('cadenceHours' in scheduled))throw Error('fixture does not schedule');
  const job={obligation:scheduled,workItemId:'wi-site',routeTaskId:'rt-site',attemptId:attempt.id,holder:'test',executor:'DETERMINISTIC',bound:{maxAttempts:3,maxWallMs:60000}} as const;
  const seen:string[]=[];
  const pages:Record<string,string>={'https://example.gov/robots.txt':'User-agent: *\nAllow: /','https://example.gov/':'<title>Example, Arizona</title><main><a href="/council">City Council</a></main>','https://example.gov/council':'<title>Example, Arizona</title><main><h1>City Council</h1><table><tr><td>Jane Doe</td><td>Mayor</td><td>jane@example.gov</td></tr><tr><td>John Smith</td><td>Councilmember</td><td>john@example.gov</td></tr></table></main>'};
  pages['https://example.gov/council']+='<a href="/meetings.ics">City Council calendar</a><a href="https://example.legistar.com/Calendar.aspx">Meeting calendar</a>';pages['https://example.gov/meetings.ics']='BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:City Council\nDTSTART:20261022T170000Z\nEND:VEVENT\nEND:VCALENDAR';
  const run=placeSourceExecutor({repos,scope:{jurisdictionId:government,governmentId:place,bodyId:body,name:'Example',state:'AZ',website:'https://example.gov/'},query:facts.query,now:()=>now,readHeldPage:async()=>null,spaceOut:async()=>{},vault:async(a,text)=>{const saved=await putArtifact(vault,'freshness',a,Buffer.from(text));return {stored:true,where:saved.key,why:'saved'};},open:async({url})=>{seen.push(url);const body=pages[url];assert.ok(body,'unexpected source '+url);return {status:200,body,bytes:Buffer.byteLength(body),contentType:url.endsWith('robots.txt')?'text/plain':url.endsWith('.ics')?'text/calendar':'text/html',durationMs:1,transportError:null};}});
  const outcome=await run(job);
  console.log(JSON.stringify({outcome,seen}));
  assert.equal(outcome.kind,'DISPOSED');assert.equal(outcome.cost?.requestCount,4);assert.ok((outcome.disposition?.observation?.normalizedCount??0)>=5);
  const published=await publishBoxFindings({repos,facts,vault,fetch:async()=>{throw new Error('must reuse saved evidence')},store:new MemoryRoutineDataStore(),clocks:factClocks(null),now,limit:100,purge:async()=>({purged:true})});
  const members=await facts.query("SELECT value->>'name' AS name FROM fact WHERE entity_id=$1 AND status='live' AND field LIKE 'member:%' ORDER BY name",[body]);
  const contacts=await facts.query("SELECT e.name,f.value FROM fact f JOIN entity e ON e.id=f.entity_id WHERE f.field='email' AND f.status='live' ORDER BY e.name");
  assert.deepEqual(members.map(r=>r.name),['Jane Doe','John Smith']);
  const walks=await repos.discoveryAttempts.read(place);assert.ok(walks.some(w=>w.found.some(f=>f.vendor==='ical' && f.via?.page==='https://example.gov/council')));assert.ok(walks.some(w=>w.leads.some(f=>f.url.includes('legistar.com'))));assert.ok(!seen.some(url=>url.includes('legistar.com')));
  console.log(JSON.stringify({published,members,contacts,confirmedCalendars:walks.flatMap(w=>w.found).length,requests:seen.length,usd:0,productionBytes:0}));
  await facts.pg.close();

});

test("a member page a hunter found, linked from nowhere the walk would look, is read first and its members reach the board's live page", async () => {
  const facts=await factDb(),repos=createMemoryRepositories(),vault=new MemoryEvidenceStore();
  const now=new Date().toISOString(),place='ocd-division/country:us/state:al/place:example',government='al:city:city-of-example',body=government+'#governing';
  for(const entity of [{id:place,kind:'place',name:'Example',state:'AL',parentId:null},{id:government,kind:'government',name:'City of Example',state:'AL',parentId:place}])await ensureEntity(facts.query,entity as never);
  await learnOfficialHost(facts.query,government,'https://example.gov');
  const attempt=beginAttempt({routeTaskId:'rt-site',workItemId:'wi-site',worker:{role:'ACQUIRER',provider:'test',version:'1',instance:'test'},lease:claim('rt-site','test',now,60000,null),now,methodVersion:0,policyVersion:'test'});
  await repos.attempts.put(attempt.id,attempt,now);
  const scheduled=scheduleObligation({id:'freshness:meetings-discovery:al:city:city-of-example#own-site-meetings',subjectId:government,recordClass:'meetings-discovery',routeId:'own-site-meetings',active:true,readerImpactAt:null,observedChangeRateHours:null,lastWorkedAt:null},Date.parse(now));
  if(!('cadenceHours' in scheduled))throw Error('fixture does not schedule');
  const job={obligation:scheduled,workItemId:'wi-site',routeTaskId:'rt-site',attemptId:attempt.id,holder:'test',executor:'DETERMINISTIC',bound:{maxAttempts:3,maxWallMs:60000}} as const;
  // The home page links nowhere useful; the member page was found by a hunter and reached the Box as a link.
  const MEMBERS='https://example.gov/city-council',seen:string[]=[];
  const pages:Record<string,string>={'https://example.gov/robots.txt':'User-agent: *\nAllow: /','https://example.gov/':'<title>Example, Alabama</title><main><p>Welcome to Example.</p></main>',
    [MEMBERS]:'<title>Example, Alabama</title><main><h1>City Council</h1><table><tr><td>Jane Doe</td><td>Mayor</td><td>jane@example.gov</td></tr><tr><td>John Smith</td><td>Councilmember</td><td>john@example.gov</td></tr></table></main>'};
  const link=await indexReportedFinding(repos.boxFindings,{workItemId:'wi-hunter',attemptId:'at-hunter',obligationId:`hunt:packet:${government}`,missionPart:null,finding:{index:0,subjectId:body,subjectHint:'Example',field:'GOV-03',value:MEMBERS,sourceUrl:'https://example.gov/',exactQuote:MEMBERS,artifactIds:['a-home']}},now);
  const publish=()=>publishBoxFindings({repos,facts,vault,fetch:async()=>{throw new Error('must reuse saved evidence')},store:new MemoryRoutineDataStore(),clocks:factClocks(null),now,limit:100,purge:async()=>({purged:true})});
  const handed=await publish();
  // Intake hands the link to the walk when it arrives; the publisher spends no turn on it.
  assert.deepEqual([handed.looked,handed.handed,handed.published],[0,0,0],'the link is handed to the walk at intake, not parked or published');
  assert.deepEqual((await repos.boxFindings.mustRead(link.id)).value.waitingFor?.reason,'SITE_WALK_TAKES_IT');
  const run=placeSourceExecutor({repos,scope:{jurisdictionId:government,governmentId:government,bodyId:body,name:'City of Example',state:'AL',website:'https://example.gov/'},query:facts.query,now:()=>now,readHeldPage:async()=>null,spaceOut:async()=>{},vault:async(a,text)=>{const saved=await putArtifact(vault,'freshness',a,Buffer.from(text));return {stored:true,where:saved.key,why:'saved'};},open:async({url})=>{seen.push(url);const text=pages[url];assert.ok(text,'unexpected source '+url);return {status:200,body:text,bytes:Buffer.byteLength(text),contentType:url.endsWith('robots.txt')?'text/plain':'text/html',durationMs:1,transportError:null};}});
  const outcome=await run(job);
  assert.equal(outcome.kind,'DISPOSED');
  assert.ok(seen.indexOf(MEMBERS)>=0 && seen.indexOf(MEMBERS)<seen.indexOf('https://example.gov/'),'the handed page is read before the home page: '+seen.join(' '));
  assert.equal((await repos.boxFindings.mustRead(link.id)).value.state,'built','a link that was read is done');
  await publish();
  const members=await facts.query("SELECT e.id,f.value->>'name' AS name FROM fact f JOIN entity e ON e.id=f.entity_id WHERE e.parent_id=$1 AND f.status='live' AND f.field LIKE 'member:%' ORDER BY name",[government]);
  assert.deepEqual(members.map(row=>row.name),['Jane Doe','John Smith']);
  assert.ok(members.every(row=>row.id===body),'the names are on the board named by its government');
  await facts.pg.close();
});
