/** Render the actual ballot page from the SELECT-only production replay, in memory. */
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { csvRows } from '../lib/reference/csv.ts';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRoutineDataStore } from '../lib/civic-data/store.ts';
import { readPromotedCivicData, promotedEdgeEntryOf } from '../lib/civic-data/read-model.ts';
import { withReaderAuthorityEdge } from '../lib/registry/runtime-edge.ts';
import { stateBallotScope } from '../lib/civic-data/state-scopes.ts';
import type { GenericBallotProjection } from '../lib/ballot/generic-projection.ts';
import type { CandidateVersionRecord, PromotedProjection } from '../lib/civic-data/types.ts';

const tomorrowRun=process.argv.includes('--tomorrow');
const exactRun=process.argv.includes('--exact-address');
const reportBase=exactRun?'data/ballot/reports/bl02-page-replay-exact':'data/ballot/reports/bl02-page-replay';
const htmlStem=exactRun?'120-lake-st':'94118';
let pageParams:{zip?:string;state?:string;lat?:string;lng?:string}={zip:'94118'};
let addressEvidence:Record<string,unknown>|undefined;
if(exactRun){
 const path='data/ballot/evidence/bl02-addresses/sf-official-address-match.json';
 const metadata=JSON.parse(await readFile(path,'utf8'));
 const sourcePath='data/ballot/evidence/bl02-addresses/'+metadata.evidence;
 const raw=gunzipSync(await readFile(sourcePath));
 const sha256=createHash('sha256').update(raw).digest('hex');
 assert.equal(sha256,metadata.rawHash,'The saved official city address source must match its recorded hash');
 const rows=csvRows(raw.toString());
 const header=rows.next().value;assert.deepEqual(header,['address','longitude','latitude']);
 const matches:string[][]=[];for(const row of rows)if(row[0]==='120 LAKE ST')matches.push(row);
 assert.equal(matches.length,1,'The exact requested street address has one official city coordinate row');
 const [address,lng,lat]=matches[0];
 assert.deepEqual({address,longitude:lng,latitude:lat},metadata.selected);
 pageParams={state:'CA',lat,lng};
 const {ballotPointStateDivisions}=await import('../lib/ballot/reader-place.ts');
 const geometryDivisions=await ballotPointStateDivisions({code:'CA',name:'California',ocdId:'ocd-division/country:us/state:ca'},Number(lat),Number(lng));
 assert.ok(geometryDivisions.includes('ocd-division/country:us/state:ca/county:san_francisco'),'The actual address point reaches its official SFcounty through held CCDgeometry');
 assert.ok(geometryDivisions.includes('ocd-division/country:us/state:ca/special_district:bay_area_rapid_transit_district/district:8'),'The actual address point falls inside the held official BART8 geometry');
 const countyGeometryPath='data/states/ca/geo/bl02-sf-census-geography-06.geojson';
 const countyGeometryBytes=await readFile(countyGeometryPath);
 const countyGeometrySha256=createHash('sha256').update(countyGeometryBytes).digest('hex');
 const geometryManifest=JSON.parse(await readFile('data/derived/state-geometry.json','utf8'));
 const resolverManifest=JSON.parse(await readFile('data/derived/resolver-geometry.json','utf8'));
 assert.equal(geometryManifest.files[countyGeometryPath].sha256,countyGeometrySha256);
 assert.ok(resolverManifest.files.includes(countyGeometryPath));
 addressEvidence={countyGeometryPath,countyGeometrySha256,metadata:path,source:sourcePath,sourceUrl:metadata.finalUrl,publisher:metadata.publisher,rawSha256:sha256,exactRow:metadata.selected,uniqueMatches:matches.length,geometryDivisions};
}
const at=tomorrowRun?'2026-10-24T12:00:00.000Z':'2026-10-23T12:00:00.000Z';
const observedAt=new Date().toISOString();
mock.timers.enable({apis:['Date'],now:Date.parse(at)});
const snapshotPath='.scratch/bl02-replay/ca.json';
const bytes=await readFile(snapshotPath);
const snapshot=JSON.parse(bytes.toString()) as {kind:'PROMOTED';projection:PromotedProjection<GenericBallotProjection>;candidate:CandidateVersionRecord};
const store=new MemoryRoutineDataStore();
(store as unknown as {candidates:Map<string,CandidateVersionRecord>}).candidates.set(snapshot.candidate.candidate.id,snapshot.candidate);
(store as unknown as {promotions:Map<string,PromotedProjection>}).promotions.set(snapshot.projection.key,snapshot.projection);
const scope=stateBallotScope('ballot-contests','CA');
const read=await readPromotedCivicData<GenericBallotProjection>('BALLOT_CANDIDACY',scope,{store,now:at,bypassCache:true});
assert.equal(read.kind,'PROMOTED');
const entry=promotedEdgeEntryOf(read,'BALLOT_CANDIDACY',scope,store);
assert.ok(entry&&entry.kind==='PROMOTED','The normal reader must attest the exact production-seeded replay output');
const misses:string[]=[];
const edge={edgeOnly:true as const,stateAuthorities:{families:new Set(['ballot-contests'] as const),load:async(family:string,state:string)=>{if(family==='ballot-contests'&&state==='CA')return{kind:'PROMOTED_POINTERS' as const,versionId:entry.projection.versionId,entries:[entry]};misses.push(`${family}:${state}`);return null;}},promoted:new Map([[snapshot.projection.key,entry]]),loadPromoted:async(recordClass:string,requestedScope:string)=>{misses.push(`${recordClass}:${requestedScope}`);return null;}};
const {default:BallotPage}=await import('../app/ballot/page.tsx');
let elements=0;
const asyncComponents=new Map<string,number>();
async function resolve(node:unknown):Promise<unknown>{
 node=await node;
 if(node===null||typeof node!=='object')return node;
 if(Array.isArray(node))return Promise.all(node.map(resolve));
 if(!React.isValidElement<Record<string,unknown>>(node)){
  if(Object.getPrototypeOf(node)!==Object.prototype)return node;
  return Object.fromEntries(await Promise.all(Object.entries(node).map(async([key,value])=>[key,await resolve(value)])));
 }
 const name=typeof node.type==='function'?node.type.name:'';
 if(typeof node.type==='function'&&(node.type.constructor.name==='AsyncFunction'||['CandidateSources','CandidateContactSources','FundingDisplay','CandidatePositions','CandidatePortraitSources'].includes(name))){
  asyncComponents.set(name,(asyncComponents.get(name)??0)+1);
  return resolve(await(node.type as(props:unknown)=>unknown)(node.props));
 }
 const props=Object.fromEntries(await Promise.all(Object.entries(node.props).map(async([key,value])=>[key,await resolve(value)])));
 if(Array.isArray(props.children))props.children=React.Children.toArray(props.children as React.ReactNode[]);
 return React.cloneElement(node,{...props,key:node.key??elements++});
}
const began=performance.now();
const html=await withReaderAuthorityEdge(edge,async()=>{
 const tree=await BallotPage({searchParams:Promise.resolve(pageParams)});
 const resolved=await resolve(tree);
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>BL-02 production-data ballot page replay</title></head><body>'+renderToStaticMarkup(resolved as React.ReactNode)+'</body></html>';
});
const elapsedMs=Math.round(performance.now()-began);
await mkdir('.scratch/bl02-page-replay',{recursive:true});
const htmlPath=`.scratch/bl02-page-replay/${htmlStem}${tomorrowRun?'-tomorrow':''}.html`;await writeFile(htmlPath,html);
const expected=[{id:'ca-sos-2026-general-board-of-equalization-member-district-2',pattern:/Board of Equalization Member District 2/i},{id:'ca-sf-2026-general-bart-director-district-8',pattern:/BART Director, District 8/i}];
const found=expected.map(row=>({...row,titlePresent:row.pattern.test(html),idPresent:html.includes(row.id),pattern:undefined}));
const contestIds=[...new Set([...html.matchAll(/data-contest-id="([^"]+)"/g)].map(match=>match[1]))];
const report={step:'BL-02',checkedAt:observedAt,clock:at,status:found.every(row=>row.titlePresent&&row.idPresent)?'PAGE_RENDERED':'PAGE_ACCEPTANCE_FAILED',productionWrites:0,localDatabaseWrites:0,networkWrites:0,
 productionData:snapshotPath,snapshotSha256:createHash('sha256').update(bytes).digest('hex'),readerVersion:snapshot.projection.versionId,
 method:'Actual app/ballot/page.tsx, normal readerRoute and readerBallotSourcesForDivisions, ordinary proof attestation from MemoryRoutineDataStore seeded with the exact SELECT-only production replay. Existing edgeOnly context refuses database fallbacks. Actual server components resolve, then react-dom/server renders the real synchronous/client components.',
 place:{requestedAddress:'120 Lake St, San Francisco, CA 94118',pageParams,addressEvidence,basis:exactRun?'Exact local equality on the official San Francisco address dataset uniquely establishes this point. The actual page receives state/latitude/longitude without a ZIP, and the held official BART8 geometry contains it.':'The live Google Civic normalized address and TurboVote sample both establish94118. This page proof uses the real94118 ZIP reader; it does not claim a new exact-address geocode.'},
 elapsedMs,underThreeSeconds:elapsedMs<3000,contests:contestIds,expected:found,asyncComponents:Object.fromEntries(asyncComponents),html:htmlPath,htmlSha256:createHash('sha256').update(html).digest('hex'),
 unavailableReplayDependencies:[...new Set(misses)].sort(),firstExactPointFailure:exactRun?{evidence:'.scratch/bl02-page-replay/exact-point-first-failure.json',result:'BART8 rendered; BOE2 absent',cause:'The held CApoint geometry lacked SFcounty/city coverage, so the county-to-BOE2 membership could not activate.',repair:'Reused all8 saved official SFCCD polygons as ordinary state geometry; existing parent ancestry now reaches SFcounty. Runtime code unchanged.'}:undefined,initialHarnessFailures:[{result:'Zero cards',cause:'The first replay supplied only the generic promoted map; the actual state reader requires the existing stateAuthorities.load interface. The harness now supplies that ordinary interface.'},{result:'Forty cards with both requested titles; expectation failed',cause:'The harness used an incorrect BOE contest ID. Corrected to the actual persisted ID including member.',evidence:'.scratch/bl02-page-replay/second-harness-failure.json'}],limitations:'Auxiliary authorities not loaded into this replay remain unavailable and show the app existing gap behavior. This is a real-data read-only local rendering proof, not evidence that production has published these changes.'};
const reportPath=reportBase+(tomorrowRun?'-tomorrow':'')+'.json';
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
if(tomorrowRun){
 const todayPath=reportBase+'.json';
 const today=JSON.parse(await readFile(todayPath,'utf8'));
 const publisher=JSON.parse(await readFile('data/ballot/reports/bl02-readonly-replay.json','utf8')).states.find((state:any)=>state.state==='CA');
 assert.equal(publisher.tomorrow.payloadUnchanged,true);
 assert.equal(publisher.tomorrow.allRepairedMembershipsRetained,true);
 assert.deepEqual([...contestIds].sort(),[...today.contests].sort(),'The actual page must preserve every rendered contest tomorrow');
 today.tomorrow={clock:at,proof:reportPath,publisherProof:'data/ballot/reports/bl02-readonly-replay.json',publisherPayloadUnchanged:publisher.tomorrow.payloadUnchanged,publisherOriginalCheckoutPreservesRepair:publisher.tomorrow.originalCheckoutPreservesRepair,pageReRendered:true,sameContestIds:true,readerVersion:report.readerVersion,expected:found,elapsedMs,html:htmlPath,htmlSha256:report.htmlSha256,scope:'Controlled-clock actual page render using the unchanged CA payload proven by the normal next-day publisher replay; no production writes or future waiting.'};
 await writeFile(todayPath,JSON.stringify(today,null,2)+'\n');
}
mock.timers.reset();
console.log(JSON.stringify({status:report.status,elapsedMs,contests:contestIds.length,expected:found,dependenciesUnavailable:report.unavailableReplayDependencies.length}));
assert.equal(report.status,'PAGE_RENDERED');
