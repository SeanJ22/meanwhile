import type {ReportedFinding} from "../lib/control-plane/scheduler/scout-contract.ts";
import test from "node:test";
import assert from 'node:assert/strict';
import {buildScoutToolkit} from '../lib/control-plane/scheduler/scout-tools.ts';
import {MemoryEvidenceStore,putArtifact} from '../lib/control-plane/evidence/store.ts';
import {scheduleObligation} from '../lib/control-plane/scheduler/obligation.ts';
import {RESEARCH_BOUNDS} from '../lib/control-plane/scheduler/research-policy.ts';

test("equal roles and identical bytes preserve distinct officials and source observations", async () => {
  let now='2026-10-20T10:00:00Z',requests=0;const body='ocd-division/country:us/state:az/place:example#governing',vault=new MemoryEvidenceStore();
  const scheduled=scheduleObligation({id:'hunt:packet:example',subjectId:body,routeId:'hunter:packet',recordClass:'HUNT_PACKET',active:true,lastWorkedAt:null,readerImpactAt:null,observedChangeRateHours:null},Date.parse(now));
  const saved:ReportedFinding[]=[];
  if(!('cadenceHours' in scheduled))throw new Error('expected a scheduled fixture');
  const html='<h1>City Council</h1><p>Jane Doe is a Councilmember.</p><p>John Smith is a Councilmember.</p>';
  const toolkit=buildScoutToolkit({obligation:scheduled,route:null,providerId:null,attemptId:'isolated',workItemId:'isolated',routeTaskId:'isolated',holder:'isolated',bound:RESEARCH_BOUNDS.perDispatch,now:()=>now,handed:{artifactIds:[]},spaceOut:async()=>{},
   openOne:async({url})=>{requests++;const text=url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':html;return {status:200,body:text,bytes:Buffer.byteLength(text),contentType:'text/html',durationMs:1,transportError:null};},
   vault:async(artifact,text)=>{const result=await putArtifact(vault,'freshness',artifact,Buffer.from(text));return {stored:true,where:result.key,why:'saved'};},
   reportFinding:{subjects:new Set([body]),write:async finding=>{saved.push(finding);return {boxId:'box-'+saved.length};}}});
  for(const [url,field,value,sentence] of [
   ['https://example.gov/council','OFF-04','Jane Doe','Jane Doe is a Councilmember.'],
   ['https://example.gov/members','OFF-04','John Smith','John Smith is a Councilmember.'],
   ['https://example.gov/council','OFF-02','Councilmember','Jane Doe is a Councilmember.'],
   ['https://example.gov/members','OFF-02','Councilmember','John Smith is a Councilmember.']]){
   const result=await toolkit.call('report_finding',{subjectId:body,field,value,sentence,sourceUrl:url});assert.equal(result.ok,true,result.forModel);now='2026-10-20T10:05:00Z';
  }
  assert.equal(saved.length,4);assert.equal(requests,3,'robots once, two distinct source pages, no repeated field fetches');
  assert.deepEqual(saved.map(f=>f.sourceUrl),['https://example.gov/council','https://example.gov/members','https://example.gov/council','https://example.gov/members']);
  assert.equal(saved[0].artifactIds[0],saved[1].artifactIds[0],'identical bytes retain their content id');
  assert.equal(saved[2].sourceCheckedAt,'2026-10-20T10:00:00Z','cached first source keeps the actual first observation');
  assert.equal(saved[3].sourceCheckedAt,'2026-10-20T10:05:00Z');
  console.log('Equal roles remain separate for each named official; byte-identical pages retain separate source URLs and actual observation times; repeated fields reuse saved sources');

});
