import test from "node:test";
import {factDb} from './helpers/fact-db.ts';
import {readFileSync} from 'node:fs';
import {partitionCivicPayload} from '../lib/civic-data/payload-codec.ts';
import {readScopedBank} from '../lib/hunt/place-bank.ts';
import assert from 'node:assert/strict';
import {ensureEntity} from '../lib/facts/entities.ts';
test("a native government inherits its canonical held roster before any native body exists", async()=>{
const db=await factDb();
await db.pg.exec('CREATE TABLE civic_data_payload_parts(hash text primary key,payload jsonb); CREATE TABLE civic_data_promotions(key text primary key,record_class text,scope text,current_version_id text,payload jsonb);');
for(const stmt of readFileSync(new URL('../lib/db/migrations/0036_ne01.sql',import.meta.url),'utf8').split('--> statement-breakpoint').slice(1))await db.pg.exec(stmt);
const id='ocd-division/country:us/state:az/place:example',other='ocd-division/country:us/state:az/place:elsewhere',now='2026-10-20T07:00:00.000Z';
const provenance={sourceUrl:'https://example.gov/council',collectedAt:now};
const body=(id:string)=>({id:id+'#governing',ocdId:id,name:'City Council',bodyClass:'CITY_COUNCIL',alsoServesOcdIds:[],provenance});
const member=(id:string,n:string)=>({id,name:n,officeTitle:'Councilmember',phone:null,email:null,websiteUrl:null,termNote:null,membershipSource:provenance});
const value={formatVersion:1,registry:{generatedAt:now,divisions:[{ocdId:id,label:'Example',provenance},{ocdId:other,label:'Elsewhere',provenance}],bodies:[body(id),...Array.from({length:200},(_,i)=>body(other+i))]},bodyRosters:[{bodyId:id+'#governing',sourceUrl:provenance.sourceUrl,collectedAt:now,members:[member('held:one','Jane One')]},...Array.from({length:200},(_,i)=>({bodyId:other+i+'#governing',sourceUrl:provenance.sourceUrl,collectedAt:now,members:[member('held:other'+i,'Other Person '+i)]}))],statewideExecutives:[],officialCandidacies:{formatVersion:1,rule:'EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE',rows:[]},officialPhotos:{photos:[]},rosterPhotos:{}};
const plan=partitionCivicPayload(value);for(const p of plan.parts)await db.query('INSERT INTO civic_data_payload_parts VALUES($1,$2::jsonb)',[p.hash,JSON.stringify(p.payload)]);
await db.query('INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4,$5::jsonb)',['REGISTRY_RUNTIME_BINDING:US-AZ:reader-registry-runtime','REGISTRY_RUNTIME_BINDING','US-AZ:reader-registry-runtime','v1',JSON.stringify(plan.value)]);
let bytes=0;const query=async(...args:Parameters<typeof db.query>)=>{const rows=await db.query(...args);bytes+=Buffer.byteLength(JSON.stringify(rows));return rows;};
const capture=await readScopedBank(query,[id],'AZ');
assert.equal(capture.subjects.filter(s=>s.kind==='body').length,1);
assert.equal(capture.subjects.filter(s=>s.kind==='seat').length,1);
assert.ok(capture.held.some(h=>h.checklistId==='OFF-04' && h.subjectId==='held:one'));
assert.ok(!JSON.stringify(capture).includes('Other Person'));
assert.ok(bytes<10000);
await ensureEntity(db.query,{id,kind:'place',name:'Example',state:'AZ',parentId:null});
await ensureEntity(db.query,{id:'az:city:example',kind:'government',name:'Example',state:'AZ',parentId:id});

const native=await readScopedBank(query,['az:city:example'],'AZ');
assert.ok(native.held.some(field=>field.checklistId==='OFF-04' && field.subjectId==='held:one'),'a native government inherits its canonical roster');
assert.ok(native.subjects.filter(subject=>subject.kind==='body' || subject.kind==='seat').every(subject=>subject.divisionIds.includes('az:city:example')),'capture view stays in its one government');
assert.ok(!JSON.stringify(native).includes('Other Person'));
console.log(JSON.stringify({subjects:capture.subjects.length,fields:capture.held.length,nativeSubjects:native.subjects.length,nativeFields:native.held.length,bytes,peakRssBytes:process.resourceUsage().maxRSS*1024}));
await db.pg.close();

});
