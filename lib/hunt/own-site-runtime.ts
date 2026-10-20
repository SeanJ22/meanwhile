import type {PrepareHuntBody} from './body-target-runtime.ts';
import {sourceMeetings} from './source-meetings.ts';
import {retainHuntPage} from './capture-reference.ts';
import {discoverGovernmentSite} from './government-site.ts';
import {planPlaceHunt} from './place-plan.ts';
import {walkPlaceBlanks} from './site-walk.ts';
import {placePageReader} from './source-page-reader.ts';
import {readScopedBank} from './place-bank.ts';
import {indexReportedFinding} from '../control-plane/box.ts';
import {newFieldManualEntry,writeFieldManual,fieldManualEntryId} from '../control-plane/field-manual.ts';
import {ZERO_COST} from '../control-plane/attempt.ts';
import {recordArtifactMetadata} from '../control-plane/repository/coordinator.ts';
import {websiteSizeForObligation} from '../control-plane/scheduler/host-supervision.ts';
import {DurableEvidenceStore} from '../control-plane/evidence/durable-store.ts';
import {VAULT_DIR} from '../control-plane/scheduler/vault.ts';
import {heldCaptureReader} from '../civic-data/worker-publication-context.ts';
import {readPlaceArtifacts} from '../control-plane/repository/pg-store.ts';
import {join} from 'node:path';
import {readerQuery} from '../civic-data/promoted-reader-query.ts';
import type {ControlPlaneRepositories} from '../control-plane/repository/types.ts';
import type {Query} from '../facts/publish.ts';
import type {RunWork,WorkOutcome} from '../control-plane/scheduler/dispatch.ts';
import type {OpenOne,VaultPut} from '../control-plane/scheduler/route-executor.ts';
import type {SiteScope} from './site-findings.ts';

export interface HuntSourceScope {jurisdictionId:string;governmentId:string|null;bodyId:string|null;name:string;state:string;website:string;knownOwnSite?:boolean;directorySeeds?:readonly string[];govClass?:string;}
export function placeSourceExecutor(input:{repos:ControlPlaneRepositories;scope:HuntSourceScope;open:OpenOne;vault:VaultPut;spaceOut:(host:string)=>Promise<void>;now:()=>string;root?:string;query?:Query;readHeld?:(ids:readonly string[])=>Promise<import('./place-plan.ts').PlaceCapture>;canRead?:()=>boolean;prepareBody?:PrepareHuntBody;readHeldPage?:(url:string)=>Promise<import('./site-findings.ts').SitePage|null>;}):RunWork{
 return async (job):Promise<WorkOutcome>=>{
  const started=Date.now(),canRead=input.canRead??(()=>Date.now()-started<job.bound.maxWallMs);
  const selected=input.query ? null : readerQuery();
  const query:Query=input.query??(async(text,params=[])=>{if(!selected)throw new Error('HUNT_READER_DATABASE_UNCONFIGURED');return (await selected([{text,params}]))[0];});
  const reference=input.scope;
  const identity=await query(`SELECT e.id,e.kind,e.state,e.parent_id,b.id AS body_id,b.name AS body_name FROM entity e
    LEFT JOIN LATERAL (SELECT b.id,b.name FROM entity b WHERE b.kind='body' AND b.state=e.state AND (b.parent_id=e.id OR b.id=$2)
      AND (b.id LIKE '%#governing' OR b.id LIKE '%#board' OR b.id=$2) ORDER BY b.id=$2 DESC LIMIT 1) b ON true
    WHERE e.id=ANY($1::text[]) ORDER BY e.id=$3 DESC LIMIT 1`,[[reference.jurisdictionId,reference.governmentId].filter(Boolean),reference.bodyId,reference.governmentId]);
  const row=identity[0];
  if(row?.state && row.state!==reference.state)throw new Error('HUNT_PLACE_STATE_MISMATCH');
  const governmentId=(row?.kind==='government' || row?.kind==='place'?String(row.id):typeof row?.parent_id==='string' && row.parent_id.startsWith('ocd-division/')?row.parent_id:reference.governmentId??reference.jurisdictionId);
  const scope:SiteScope={governmentId,govClass:reference.govClass,bodyId:row?.body_id?String(row.body_id):reference.bodyId??`${reference.jurisdictionId}#${/SCHOOL/.test(reference.govClass??'')?'board':'governing'}`,bodyName:row?.body_name?String(row.body_name):null,name:reference.name,state:reference.state,website:reference.website};
  const key=fieldManualEntryId('place-hunt',reference.jurisdictionId);
  const prior=await input.repos.fieldManual.read(key);
  const payload=prior?.value.payload as {website?:string;siteFrontier?:string[];frontier?:{url:string;checkedAt?:string}[];read?:{url:string;checkedAt?:string}[]}|undefined;
  if(payload?.website)scope.website=payload.website;
  let checked=0,findings=0;
  const readHeld=heldCaptureReader(new DurableEvidenceStore(join(input.root??process.cwd(),...VAULT_DIR)));
  const held=async(url:string)=>{
    const at=input.now(),cutoff=new Date(Date.parse(at)-job.obligation.cadenceHours*3600000).toISOString();
    for(const record of await readPlaceArtifacts(input.repos,url,cutoff,at)){
      const page=await readHeld(record);
      if(page && page.httpStatus===200 && !page.partial && Date.parse(page.observedAt)>=Date.parse(cutoff))return {url:page.evidence.canonicalUrl,html:page.evidence.text,artifactId:page.evidence.artifactId,observedAt:page.observedAt,sourceWorkItemId:record.workItemId,sourceAttemptId:record.attemptId};
    }
    return null;
  };
  const reader=placePageReader({open:input.open,vault:input.vault,spaceOut:input.spaceOut,now:input.now,attemptId:job.attemptId,workItemId:job.workItemId,routeId:job.obligation.obligation.routeId??'own-site-meetings',canRead,endsAt:started+job.bound.maxWallMs,websiteSize:websiteSizeForObligation(job.obligation.obligation,input.root),
   onArtifact:artifact=>recordArtifactMetadata(input.repos,{...artifact,workItemId:job.workItemId,attemptId:job.attemptId,routeTaskId:job.routeTaskId},input.now()).then(()=>undefined)});
  const readPage=async(url:string)=>{
   job.assertLeaseHealthy?.();
   const saved=await (input.readHeldPage??held)(url);
   const page=saved?await retainHuntPage(input.repos,job.workItemId,saved,input.now()):await reader.read(url);
   if(page)checked++;
   return page;
  };
  try{
   const readBank=input.readHeld??(ids=>readScopedBank(query,ids,scope.state,input.now()));
   const plan=await planPlaceHunt({repos:input.repos,now:input.now(),divisions:[{id:scope.governmentId,label:scope.name}],readHeld:readBank,acquireNational:async()=>({subjects:[],held:[]})});
   if(reference.knownOwnSite===false && !payload?.website){
     let siteRemaining=payload?.siteFrontier??reference.directorySeeds??[];
     let discoveredWebsite:string|undefined;
     const site=await discoverGovernmentSite({name:scope.name,seeds:reference.directorySeeds??[],frontier:payload?.siteFrontier,canRead,
       read:readPage,
       save:async frontier=>{siteRemaining=frontier;const at=input.now();const saved=await writeFieldManual(input.repos,[newFieldManualEntry('place-hunt',reference.jurisdictionId,{role:'SHARED',kind:'SOURCE_PAGE',title:reference.name,states:[scope.state.toLowerCase()],ocdIds:[governmentId],outcome:'REFERENCE',summary:`Read ${checked} directory page(s); this government's own website remains open`,observedAt:at,payload:{...(discoveredWebsite?{website:discoveredWebsite}:{}),siteFrontier:frontier}})],at);if(saved.error)throw new Error(saved.error);},
       found:async(site,page)=>{discoveredWebsite=site.url;await indexReportedFinding(input.repos.boxFindings,{workItemId:job.workItemId,attemptId:job.attemptId,obligationId:`hunt:packet:${governmentId}`,missionPart:null,finding:{index:findings++,subjectId:governmentId,subjectHint:scope.name,field:'government.website',value:site.url,sourceUrl:page.url,exactQuote:site.quote,artifactIds:[page.artifactId]}},input.now());}});
     if(!site)return {ranAs:'DETERMINISTIC',kind:checked?'DISPOSED':'ABORTED',artifacts:reader.artifacts,cost:{...ZERO_COST,...reader.cost,usd:0,durationMs:Date.now()-started},...(checked?{disposition:{disposition:'WALKED_NO_YIELD',observation:null,permission:'CANNOT_TELL',transport:'REACHABLE',note:`Read ${checked} directory pages; ${siteRemaining.length} directory links remain. The website stays an open blank.`}}:{}),detail:`${scope.name}: the government website remains open after ${checked} source directory page(s).`};
     scope.website=site;
   }
   const meetingPage=sourceMeetings({repos:input.repos,governmentId,website:scope.website,workItemId:job.workItemId,currentArtifacts:()=>reader.artifacts});
   const report=await walkPlaceBlanks({scope,repos:input.repos,now:input.now,canRead,plan,pageRead:meetingPage,
    // Canonical national holdings, the current place and native reader facts
    // precede local requests. They are independent of the original job or ZIP.
    readHeld:readBank,national:async()=>({subjects:[],held:[]}),
    read:readPage,
    report:async finding=>{job.assertLeaseHealthy?.();await indexReportedFinding(input.repos.boxFindings,{workItemId:job.workItemId,attemptId:job.attemptId,obligationId:`hunt:packet:${governmentId}`,missionPart:null,finding:{...finding,index:findings++,subjectHint:scope.name}},input.now());await input.prepareBody?.(finding,{workItemId:job.workItemId,attemptId:job.attemptId});},
    frontier:payload?.frontier,
    saveFrontier:async(frontier,read)=>{const at=input.now();const written=await writeFieldManual(input.repos,[newFieldManualEntry('place-hunt',reference.jurisdictionId,{role:'SHARED',kind:'SOURCE_PAGE',title:reference.name,url:scope.website,states:[scope.state.toLowerCase()],ocdIds:[governmentId],outcome:findings?'YIELDED':'REFERENCE',summary:`${checked} source page(s) read, ${findings} finding(s); ${frontier.length} published link(s) remain`,observedAt:at,payload:{website:scope.website,frontier,read}})],at);if(written.error)throw new Error(written.error);}});
   if(!report.read && report.failures?.length)return {ranAs:'DETERMINISTIC',kind:'ABORTED',artifacts:reader.artifacts,cost:{...ZERO_COST,...reader.cost,usd:0,durationMs:Date.now()-started},detail:`${scope.name}: no source page was readable; ${report.failures.length} source failure(s) remain open.`};
   return {ranAs:'DETERMINISTIC',kind:'DISPOSED',artifacts:reader.artifacts,cost:{...ZERO_COST,...reader.cost,usd:0,durationMs:Date.now()-started},disposition:{disposition:'INGESTED',observation:{rawCount:report.read,normalizedCount:report.findings,routeOnlyCount:null,earliest:null,latest:null},permission:'ALLOWED',transport:report.read?'REACHABLE':'OTHER_NAMED_FAILURE',note:`Read ${report.read} saved source page(s); ${report.findings} finding(s) entered the Box; ${report.remaining} source links remain. Open checklist blanks stay owed.`},detail:`${scope.name}: ${report.read} pages, ${report.findings} findings, $0 source reads`};
  }catch(error){return {ranAs:'DETERMINISTIC',kind:'ABORTED',artifacts:reader.artifacts,cost:{...ZERO_COST,...reader.cost,usd:0,durationMs:Date.now()-started},detail:`${scope.name}: ${checked} saved pages, ${findings} findings; source remains owed: ${error instanceof Error?error.message:String(error)}`};}
 };
}
