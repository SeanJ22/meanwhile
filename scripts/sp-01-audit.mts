/** Read-only production replay. See docs/sp-01/audit.md for commands and counting rules. */
import assert from "node:assert/strict";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {neon} from "@neondatabase/serverless";
import {drizzle} from "drizzle-orm/neon-http";
import {readerCacheScopeForPublication,readerCacheTags,invalidateReaderCache,readerPublicationNeedsGeography} from "../lib/reader/cache.ts";
import {REGISTRY_STATES,registryJurisdictions} from "../lib/civic-data/state-scopes.ts";
import {CivicPayloadParts} from "../lib/civic-data/payload-parts.ts";
import {parseUnchangedConfirmation} from "../lib/civic-data/unchanged-confirmation.ts";
import {PostgresRoutineDataStore} from "../lib/civic-data/store.ts";
import {readCanonicalShelf} from "../lib/reader/canonical.ts";
import {readStatePeopleProjection} from "../lib/state-rollcalls/legislators.ts";
import {PEOPLE_SOURCE_IDS,peopleSourceRecordClass,peopleSourceScope} from "../lib/officials/people-sources.ts";
import {readStateFederalDirectory} from "../lib/officials/federal-directory-read-model.ts";
import {stateMemberDirectories,zipMemberDirectories} from "../lib/reader/member-directories.ts";
import {publishRosterOfficePoints,publishFederalDirectoryOfficePoints,publicOfficeAddress,resolvePublishedOfficePoint,type OfficePointResolution,type OfficePointResolver} from "../lib/officials/office-points-publication.ts";
import {isOfficeStreetAddress} from "../lib/map/office-locator.ts";
import type {ReadOnlyQuery} from "../lib/control-plane/admin-view/promoted-slices.ts";
import type {DirectoryOffice} from "../lib/officials/directory.ts";

const mode=process.argv[2], output=".scratch/sp-01/audit", report="docs/sp-01";
await mkdir(output,{recursive:true}); await mkdir(report,{recursive:true});
const csv=(rows:unknown[][])=>rows.map(row=>row.map(value=>`"${String(value??"").replaceAll('"','""')}"`).join(",")).join("\n")+"\n";
const json=async(path:string,value:unknown)=>writeFile(path,JSON.stringify(value,null,2)+"\n");
if(mode==="report"){
 const audit=JSON.parse(await readFile(`${output}/purges.json`,"utf8"));
 const states=await Promise.all(REGISTRY_STATES.map(async state=>JSON.parse(await readFile(`${output}/offices-${state}.json`,"utf8"))));
 const saved=(counts:Record<string,number>)=>(counts.SOURCE_POINT??0)+(counts.SAVED_GEOCODED_POINT??0);
 const reasons=(counts:Record<string,number>)=>Object.entries(counts).filter(([reason])=>!reason.endsWith("POINT")).map(([reason,count])=>`${reason}:${count}`).join("; ");
 await writeFile(`${report}/office-counts.csv`,csv([["state","offices","production_saved","production_missing","production_missing_reasons","replay_saved","replay_missing","replay_missing_reasons","people_without_offices","people_read","federal_read","people_version","federal_version","read_at","next_day_equal"],
  ...states.map(s=>[s.state,s.total,saved(s.before),s.total-saved(s.before),reasons(s.before),saved(s.after),s.total-saved(s.after),reasons(s.after),s.peopleWithoutOffice+s.federalPeopleWithoutOffice,s.peopleKind,s.federalKind,s.peopleVersion,s.federalVersion,s.readAt,s.nextDayEqual])]));
 await writeFile(`${report}/office-points.csv`,csv([["state","owner_id","address","office_source","production_status","replay_status","lat","lng","point_source"],
  ...states.flatMap(s=>s.offices.map((o:{owner:string;address:string;sourceUrl:string;before:string;after:string;point?:{lat:number;lng:number};pointSource:string})=>[s.state,o.owner,o.address,o.sourceUrl,o.before,o.after,o.point?.lat,o.point?.lng,o.pointSource]))]));
 const totals=states.reduce((sum,s)=>({offices:sum.offices+s.total,productionSaved:sum.productionSaved+saved(s.before),replaySaved:sum.replaySaved+saved(s.after)}),{offices:0,productionSaved:0,replaySaved:0});
 const stateTable=["| State | Offices | Production saved / missing | Replay saved / missing | Replay missing reasons |","| --- | ---: | ---: | ---: | --- |",...states.map(s=>`| ${s.state} | ${s.total} | ${saved(s.before)} / ${s.total-saved(s.before)} | ${saved(s.after)} / ${s.total-saved(s.after)} | ${reasons(s.after)||"—"} |`)].join("\n");
 const hours=["| Hour starting (UTC) | Original purge calls | Fixed purge calls | Publications | Unchanged checks |","| --- | ---: | ---: | ---: | ---: |",...audit.hours.map((h:{start:string;beforeCalls:number;afterCalls:number;publications:number;unchanged:number})=>`| ${h.start} | ${h.beforeCalls} | ${h.afterCalls} | ${h.publications} | ${h.unchanged} |`)].join("\n");
 const byTag=["| Tag | Before | After |","| --- | ---: | ---: |",...audit.byTag.map((t:{tag:string;before:number;after:number})=>`| ${t.tag} | ${t.before} | ${t.after} |`)].join("\n");
 await writeFile(`${report}/counts.md`, `# SP-01 production replay counts\n\nWindow: ${audit.start} through ${audit.end} (end exclusive). Twenty-four equal one-hour buckets begin at the exact window start.\n\n${audit.publications} real pointer moves and ${audit.confirmations} real unchanged receipts: ${audit.before} original purge calls, ${audit.after} fixed purge calls. Unchanged after: zero. Read-only database role, READ ONLY transactions, zero production writes.\n\n## Purges per hour\n\n${hours}\n\n## Purges by tag over the window\n\nHourly counts for each tag, including zeroes, are in [purges-hourly.csv](purges-hourly.csv). Every ${audit.scopes} current or observed scope is in [scope-tags.csv](scope-tags.csv).\n\n${byTag}\n\n## Office points for every state and territory\n\n${totals.offices} distinct person/address offices. Production holds ${totals.productionSaved} saved points; the read-only publication replay holds ${totals.replaySaved}. Missing production points are distinguished from points saved only by this replay. All 56 next-run comparisons pass.\n\n${stateTable}\n\n[Full office counts, gaps and canonical versions](office-counts.csv). [Every office point, source and missing-point reason](office-points.csv).\n`);
 console.log(JSON.stringify({totals,states:states.length,nextDayEqual:states.every(s=>s.nextDayEqual),before:audit.before,after:audit.after}));
 process.exit(0);
}
const connection=process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if(!connection)throw Error("WTP_PRODUCTION_DATABASE_URL_READONLY required");
const url=new URL(connection);assert.equal(url.username,"readonly");assert.match(url.hostname,/^ep-dry-river-axwtolzc(?:-pooler)?\./);
const db=neon(connection);
let statements=0;
const query:ReadOnlyQuery=async batch=>{statements+=batch.length;return db.transaction(batch.map(row=>db.query(row.text,[...row.params])),{readOnly:true});};
const rows=async(text:string,params:readonly unknown[]=[])=> (await query([{text,params}]))[0];
const [identity]=await rows("SELECT current_user,current_setting('transaction_read_only') read_only,now() at");
assert.equal(identity.current_user,"readonly");assert.equal(identity.read_only,"on");
delete process.env.DATABASE_URL;delete process.env.WTP_ASSET_STORE;
const parts=new CivicPayloadParts({existing:async()=>[],write:async()=>{throw Error("Replay cannot write");},
 read:async hashes=>await rows("SELECT hash,payload FROM civic_data_payload_parts WHERE hash=ANY($1::text[])",[hashes])as {hash:string;payload:unknown}[]});

if(mode==="purges"){
 const end=process.env.SP01_AUDIT_END??String(identity.at),start=new Date(Date.parse(end)-86_400_000).toISOString();
 const events=await rows(`SELECT e.id,e.candidate_id,e.at,e.detail,c.record_class,c.scope,c.source_id
 FROM civic_data_candidate_events e JOIN civic_data_candidates c ON c.id=e.candidate_id
 WHERE e.at >= $1::timestamptz AND e.at < $2::timestamptz AND e.state='PROMOTED'
 AND (e.detail LIKE 'Atomic pointer %' OR left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 ')
 ORDER BY e.at,e.id`,[start,end]);
 const pointers=await rows("SELECT record_class,scope,current_version_id FROM civic_data_promotions ORDER BY scope,record_class");
 const shelves=new Map<string,string[]>();
 // Decode shared curated shelves individually, rather than loading nationwide source records.
 for(const p of pointers.filter(p=>readerPublicationNeedsGeography(String(p.scope),String(p.record_class)))){
  const [held]=await rows("SELECT payload FROM civic_data_promotions WHERE record_class=$1 AND scope=$2",[p.record_class,p.scope]);
  const model=await parts.loadOwned(held.payload);
  shelves.set(String(p.scope),readerCacheTags(readerCacheScopeForPublication(String(p.scope),{recordClass:String(p.record_class),readModels:[model]})));
 }
 const before=(scope:string)=>{
  let decoded=scope;try{decoded=decodeURIComponent(scope);}catch{}
  const states=registryJurisdictions(decoded),family=/^source:derived:family:([a-z]{2})(?=:|$)/i.exec(decoded)?.[1];
  if(!states.length&&family)states.push(...registryJurisdictions(family));
  return states.length?states.map(state=>`reader-state:${state}`):["reader-national"];
 };
 const tagsFor=(scope:string,recordClass:string,models?:unknown[])=>models?readerCacheTags(readerCacheScopeForPublication(scope,{recordClass,readModels:models})):
  shelves.get(scope)??readerCacheTags(readerCacheScopeForPublication(scope,{recordClass}));
 const hours=Array.from({length:24},(_,index)=>({start:new Date(Date.parse(start)+index*3_600_000).toISOString(),publications:0,unchanged:0,beforeCalls:0,afterCalls:0,tags:new Map<string,{before:number;after:number}>()}));
 const scopeEvents=new Map<string,{publications:number;unchanged:number}>();
 let confirmations=0,publications=0;
 for(const e of events){
  const scope=String(e.scope),recordClass=String(e.record_class),unchanged=String(e.detail).startsWith("UNCHANGED_CONFIRMATION_V1 ");
  const h=hours[Math.floor((Date.parse(String(e.at))-Date.parse(start))/3_600_000)];
  const key=`${recordClass}:${scope}`,counts=scopeEvents.get(key)??{publications:0,unchanged:0};scopeEvents.set(key,counts);
  if(unchanged){
   counts.unchanged++;h.unchanged++;confirmations++;
   const confirmation=parseUnchangedConfirmation(String(e.detail));assert.ok(confirmation,`Invalid real receipt ${e.id}`);
   // Execute the real Postgres confirmation method with a non-writing database double.
   const store=Object.create(PostgresRoutineDataStore.prototype)as PostgresRoutineDataStore;
   Object.assign(store,{assertCandidateMutationAuthority:()=>{},cacheOptions:{purge:async()=>{assert.fail(`Unchanged purge ${e.id}`);}},
    db:Object.assign(drizzle.mock(),{batch:async()=>[[],[{sequence:1}]]})});
   const result=await store.confirmUnchanged({...confirmation,pointerVersionId:confirmation.versionId},confirmation.observedAt);
   assert.equal(result.kind,"CONFIRMED");
  }else{counts.publications++;h.publications++;publications++;}
  let models:unknown[]|undefined;
  if(!unchanged&&readerPublicationNeedsGeography(scope,recordClass)){
   const [c]=await rows("SELECT candidate->'readModel' payload FROM civic_data_candidates WHERE id=$1",[e.candidate_id]);
   const model=await parts.loadOwned(c.payload);
   // Replay the footprint of the payload replaced by this specific pointer move, including removals.
   const prior=/ moved from (.+) to /.exec(String(e.detail))?.[1];
   const priorRows=prior&&prior!=="bootstrap/no-version"?await rows("SELECT candidate->'readModel' payload FROM civic_data_candidates WHERE id=$1",[prior]):[];
   models=[model,...priorRows.length?[await parts.loadOwned(priorRows[0].payload)]:[]];
  }
  const oldTags=before(scope),newTags=unchanged?[]:tagsFor(scope,recordClass,models);
  h.beforeCalls++;if(newTags.length)h.afterCalls++;
  for(const tag of new Set([...oldTags,...newTags])){
   const count=h.tags.get(tag)??{before:0,after:0};
   if(oldTags.includes(tag))count.before++;if(newTags.includes(tag))count.after++;h.tags.set(tag,count);
  }
  if(!unchanged){const sent:string[]=[];await invalidateReaderCache(readerCacheScopeForPublication(scope,{recordClass,readModels:models}),async tags=>{sent.push(...tags);return{purged:true};});assert.deepEqual(sent,newTags);}
 }
 const tags=["reader-national","reader-national-people",...REGISTRY_STATES.map(state=>`reader-state:${state}`)].sort();
 await writeFile(`${report}/purges-hourly.csv`,csv([["hour_start_utc","tag","before","after"],...hours.flatMap(h=>tags.map(tag=>[h.start,tag,h.tags.get(tag)?.before??0,h.tags.get(tag)?.after??0]))]));
 const allScopes=new Map(pointers.map(p=>[`${p.record_class}:${p.scope}`,p]));
 for(const e of events)allScopes.set(`${e.record_class}:${e.scope}`,e);
 const scopes=[...allScopes.values()].sort((a,b)=>String(a.scope).localeCompare(String(b.scope))).map(p=>{
  const after=tagsFor(String(p.scope),String(p.record_class)),count=scopeEvents.get(`${p.record_class}:${p.scope}`);
  return {recordClass:p.record_class,scope:p.scope,before:before(String(p.scope)),after,publications:count?.publications??0,unchanged:count?.unchanged??0};
 });
 await writeFile(`${report}/scope-tags.csv`,csv([["record_class","scope","before_tags","after_tags","publications_24h","unchanged_24h"],...scopes.map(s=>[s.recordClass,s.scope,s.before.join(" "),s.after.join(" "),s.publications,s.unchanged])]));
 const summary={start,end,identity,statements,productionWrites:0,publications,confirmations,scopes:scopes.length,
  before:hours.reduce((s,h)=>s+h.beforeCalls,0),after:hours.reduce((s,h)=>s+h.afterCalls,0),
  byTag:tags.map(tag=>({tag,before:hours.reduce((s,h)=>s+(h.tags.get(tag)?.before??0),0),after:hours.reduce((s,h)=>s+(h.tags.get(tag)?.after??0),0)})),
  hours:hours.map(({tags:_tags,...h})=>h),allStateScopes:scopes.filter(s=>s.after.filter(t=>t.startsWith("reader-state:")).length===REGISTRY_STATES.length)};
 await json(`${output}/purges.json`,summary);console.log(JSON.stringify(summary));
}

if(mode==="offices"){
 const state=process.argv[3];assert.ok(REGISTRY_STATES.includes(state as typeof REGISTRY_STATES[number]));
 const jurisdiction=`US-${state}` as const;
 const selected=[{recordClass:"STATE_LEGISLATOR"as const,scope:jurisdiction},{recordClass:"STATE_LEGISLATOR"as const,scope:`${jurisdiction}:openstates-people:v1`},
  ...PEOPLE_SOURCE_IDS.map(source=>({recordClass:peopleSourceRecordClass(source),scope:peopleSourceScope(jurisdiction,source)})),
  {recordClass:"FEDERAL_DIRECTORY"as const,scope:`${jurisdiction}:current-congress-directory`}];
 const shelf=await readCanonicalShelf(selected,query);
 const people=await readStatePeopleProjection(jurisdiction,{store:shelf});
 const federal=await readStateFederalDirectory(state,{store:shelf});
 const native=people.kind==="PROMOTED"?{...people.value.roster,officeholders:people.value.roster.officeholders.filter(p=>p.level!=="FEDERAL")}:null;
 const fed=federal.kind==="PROMOTED"?federal.value:null;
 const list=(roster:typeof native,delegation:typeof fed)=>{
  const directories=[...stateMemberDirectories(roster),...zipMemberDirectories(null,[],delegation,delegation?.roster.officeholders??[])];
  const distinct=new Map<string,{owner:string;office:DirectoryOffice;address:string;sourceUrl:string}>();
  for(const d of directories)for(const [i,office]of d.directory.districtOffices.entries()){
   const owner=d.ids[0],address=publicOfficeAddress(office),key=JSON.stringify([owner,address||[office.phone,office.email]]);
   distinct.set(key,{owner,office,address,sourceUrl:d.directory.officeDetails?.[i]?.sourceUrl??d.directory.source?.repoUrl??""});
  }
  return [...distinct.values()];
 };
 const valid=(point:{lat:number;lng:number}|null|undefined)=>!!point&&Number.isFinite(point.lat)&&Number.isFinite(point.lng)&&Math.abs(point.lat)<=90&&Math.abs(point.lng)<=180;
 const reason=(office:DirectoryOffice)=>{
  const address=publicOfficeAddress(office);
  if(valid({lat:office.lat!,lng:office.lng!})&&office.lat!==null&&office.lng!==null)return"SOURCE_POINT";
  if(office.geocodedPoint?.address===address&&valid(office.geocodedPoint))return"SAVED_GEOCODED_POINT";
  if(!address)return"NO_STREET_ADDRESS";if(!isOfficeStreetAddress(address))return"MAILING_ADDRESS";
  return office.pointUnavailable?.address===address?office.pointUnavailable.reason:"NOT_SAVED_IN_PRODUCTION";
 };
 const before=list(native,fed),cachePath=`${output}/geocodes-${state}.json`;
 let cached:Record<string,OfficePointResolution>={};try{cached=JSON.parse(await readFile(cachePath,"utf8"));}catch{}
 const pending=new Map<string,Promise<OfficePointResolution>>();
 let calls=0,cacheSave=Promise.resolve();
 const resolve:OfficePointResolver=async address=>{
  const previous=cached[address];
  if(Object.hasOwn(cached,address)&&!(previous&&"lat"in previous&&!("census"in previous))&&
    !(previous&&"reason"in previous&&/^(?:ZIP_MISMATCH|UPSTREAM_TIMEOUT|UPSTREAM_ERROR|UPSTREAM_HTTP_5)/.test(previous.reason)))return previous;
  if(!pending.has(address))pending.set(address,(async()=>{calls++;const result=await resolvePublishedOfficePoint(address);cached[address]=result;cacheSave=cacheSave.then(()=>json(cachePath,cached));await cacheSave;return result;})());
  return pending.get(address)!;
 };
 const located=native?await publishRosterOfficePoints(native,native,resolve):null;
 const locatedFed=fed?await publishFederalDirectoryOfficePoints(fed,fed,resolve):null;
 const after=list(located,locatedFed);
 let retries=0;
 const nextResolve:OfficePointResolver=async address=>{retries++;return cached[address]??{reason:"NO_MATCH"};};
 if(native){const next=await publishRosterOfficePoints(native,located,nextResolve);assert.deepEqual(next,located,"Next-day native source reread must retain points and reasons");}
 if(fed&&locatedFed){
  assert.deepEqual(await publishFederalDirectoryOfficePoints(fed,locatedFed,nextResolve),locatedFed);
 }
 const counts=(offices:ReturnType<typeof list>)=>Object.fromEntries([...new Set(offices.map(row=>reason(row.office)))].sort().map(r=>[r,offices.filter(row=>reason(row.office)===r).length]));
 const result={state,readAt:identity.at,identity,productionWrites:0,statements,peopleKind:people.kind,federalKind:federal.kind,
  peopleVersion:people.metadata.versionId,federalVersion:federal.metadata.versionId,people:native?.officeholders.length??0,federalPeople:fed?.roster.officeholders.length??0,
  peopleWithoutOffice:native?.officeholders.filter(p=>!p.offices?.some(o=>o.address||o.phone||o.email)).length??0,
  federalPeopleWithoutOffice:fed?.roster.officeholders.filter(p=>!p.offices?.length&&!fed.directory.byMember[p.id.slice(9)]?.districtOffices.length).length??0,
  total:before.length,before:counts(before),after:counts(after),lookups:calls,nextDayRetries:retries,nextDayEqual:true,
  offices:after.map((row,i)=>({owner:row.owner,address:row.address,sourceUrl:row.sourceUrl,pointSource:row.office.geocodedPoint?.sourceUrl??null,
   before:reason(before[i].office),after:reason(row.office),point:reason(row.office).endsWith("POINT")?(row.office.geocodedPoint??{lat:row.office.lat!,lng:row.office.lng!}):null}))};
 assert.equal(before.length,after.length);assert.ok(!result.after.NOT_SAVED_IN_PRODUCTION,"Every replayed office needs a point or a concrete reason");
 await json(`${output}/offices-${state}.json`,result);console.log(JSON.stringify({state,total:result.total,before:result.before,after:result.after,lookups:calls,nextDayEqual:true}));
}
