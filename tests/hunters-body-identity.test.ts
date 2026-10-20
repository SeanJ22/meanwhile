import test from 'node:test';
import assert from 'node:assert/strict';
import {siteFindings} from '../lib/hunt/site-findings.ts';
import {huntFindingSubject} from '../lib/hunt/finding-subject.ts';
import {liveBodyIdentityWritesAllowed,liveHuntBodyPreparer} from '../lib/hunt/body-target-runtime.ts';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';

test('city commission aliases share one body and a profile does not seat its person on a sidebar commission',()=>{
 const scope={governmentId:'nm:city:city-of-alamogordo',name:'City Of Alamogordo',state:'NM',govClass:'CITY_OR_TOWN',bodyId:'nm:city:city-of-alamogordo#governing',website:'https://example.gov/'};
 const page=(html:string)=>({url:'https://example.gov/city-commission',html,artifactId:'fixture',observedAt:new Date().toISOString()});
 for(const name of ['ALAMOGORDO COMMISSION','City Commission']){
  const findings=siteFindings(scope,page(`<h1>${name}</h1>`));
  assert.equal(findings.find(f=>f.field==='GOV-02')?.subjectId,scope.bodyId);
 }
 const profile=siteFindings({...scope,bodyContext:true},page('<h1>Sharon McDonald</h1><p>Sharon McDonald Mayor</p><h2>Mayor\'s Youth Advisory Commission</h2>'));
 assert.ok(!profile.some(f=>f.field==='GOV-02'));
 assert.ok(profile.every(f=>f.subjectId===scope.bodyId));
 const named=huntFindingSubject({subjectId:'az:city:example#inventory:body',field:'GOV-01',value:'Planning Commission'});
 assert.equal(named.subjectId,'az:city:example#body:planning-commission');
 assert.equal(named.field,'GOV-02');
});

test('production read-only source checks cannot activate native body writes',()=>{
 const names=['NODE_ENV','WTP_RUNTIME_MODE','WTP_DB_ROLE','DATABASE_URL'] as const;
 const saved=new Map(names.map(name=>[name,process.env[name]]));
 try{
  Object.assign(process.env,{NODE_ENV:'production',WTP_RUNTIME_MODE:'production',WTP_DB_ROLE:'production',DATABASE_URL:'postgresql://readonly:unused@copy.invalid/neondb'});
  assert.equal(liveBodyIdentityWritesAllowed(),false);
  assert.equal(liveHuntBodyPreparer({repos:createMemoryRepositories(),root:'/tmp',now:()=>new Date().toISOString()}),undefined);
 }finally{for(const [name,value] of saved)if(value===undefined)delete process.env[name];else Object.assign(process.env,{[name]:value});}
});
