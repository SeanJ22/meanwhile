import {isGoverningBodyName} from './finding-subject.ts';
import {siteFindings,blankLinks,type SiteScope,type SitePage,type SiteFinding} from './site-findings.ts';
import {planPlaceHunt,type PlaceCapture} from './place-plan.ts';
import type {ControlPlaneRepositories} from '../control-plane/repository/types.ts';
import type {PlaceOwedItem} from '../coverage/place-owed.ts';
import {meetingSourceLinks} from './meeting-source-links.ts';
import {openBlanksOf} from '../coverage/open-blanks.ts';
import {checklistItem} from '../coverage/checklist-map.ts';

interface Frontier { url:string; checkedAt?:string; error?:string; bodyId?:string; bodyName?:string; via?:{page:string;artifactId:string} }
export interface SiteWalkInput {
  scope:SiteScope;
  repos:ControlPlaneRepositories;
  now:()=>string;
  readHeld:(ids:readonly string[])=>Promise<PlaceCapture>;
  /** Bulk/source reads are resolved before the local walk, for this place. */
  national:(blanks:readonly PlaceOwedItem[])=>Promise<PlaceCapture>;
  read:(url:string)=>Promise<SitePage|null>;
  report:(finding:SiteFinding)=>Promise<void>;
  pageRead?:(scope:SiteScope,page:SitePage)=>Promise<void>;
  /** The existing request/time allowance determines when this pass yields. */
  canRead:()=>boolean;
  frontier?:readonly Frontier[];
  saveFrontier:(rows:readonly Frontier[],read:readonly Frontier[])=>Promise<void>;
  plan?:Awaited<ReturnType<typeof planPlaceHunt>>;
}

/** Read one place. Only the current source page is retained; the continuation
 * holds URLs and observation times, never a pile of response bodies. */
export async function walkPlaceBlanks(input:SiteWalkInput) {
  const {scope}=input;
  if(!scope.governmentId || !scope.website)throw new Error('HUNT_SOURCE_SCOPE_MISSING');
  const state=/\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(scope.governmentId)?.[1];
  if(state && state.toUpperCase()!==scope.state.toUpperCase())throw new Error('HUNT_SOURCE_STATE_MISMATCH');
  const plan=input.plan??await planPlaceHunt({repos:input.repos,now:input.now(),divisions:[{id:scope.governmentId,label:scope.name}],
    readHeld:input.readHeld,acquireNational:blanks=>input.national(blanks)});
  scope.bodies=[...new Map(plan.items.filter(item=>item.subject.kind==='body').map(item=>[item.subject.id,{id:item.subject.id,name:item.subject.label}])).values()];
  const primary=scope.bodies.filter(body=>/#(?:governing|board)$/.test(body.id) || isGoverningBodyName(body.name,scope.name,scope.govClass));
  if(primary.length===1){scope.bodyId=primary[0].id;scope.bodyName=primary[0].name;}
  scope.members=[...new Map([...scope.members??[],...plan.items.flatMap(item=>item.checklistId==='OFF-04'?item.held.flatMap(field=>{const v=field.value as {name?:string;office?:string;bodyId?:string};return v?.name && v.office && v.bodyId ? [{id:field.subjectId,name:v.name,office:v.office,bodyId:v.bodyId}]:[];}):[])].map(m=>[m.id,m])).values()];
  const blanks=openBlanksOf(plan.items).all.filter(blank=>{
    const rule=checklistItem(blank.checklistId);
    return rule && rule.unit!=='system' && rule.unit!=='zip' && ['fact','identity','source','freshness'].includes(rule.predicateKind);
  });
  const families=new Set(blanks.map(blank=>blank.checklistId.split('-')[0]!));
  if(!blanks.length)return {read:0,findings:0,remaining:0,plan};
  // Retained sources and an interrupted frontier precede a fresh homepage.
  const queue=new Map<string,Frontier>();
  queue.set(scope.website,{url:scope.website});
  for(const row of input.frontier??[])if(!queue.has(row.url))queue.set(row.url,row);
  if(!queue.size)queue.set(scope.website,{url:scope.website});
  const seen=new Set<string>(),read:Frontier[]=[],failed:Frontier[]=[];
  let findings=0;
  let own=new URL(scope.website).hostname.toLowerCase().replace(/^www\./,'');
  while(queue.size && input.canRead()) {
    const next=queue.values().next().value!;
    queue.delete(next.url);
    if(seen.has(next.url))continue;
    seen.add(next.url);
    let page:SitePage|null;
    try{page=await input.read(next.url);}
    catch(error){
      // The source error remains on its source record; retaining the URL
      // means a failed request never turns this blank into an absence.
      if(!(error instanceof Error) || !/^HUNT_SOURCE_(?:WALL|RATE_LIMITED|UNREADABLE)/.test(error.message)){await input.saveFrontier([next,...queue.values(),...failed],read);throw error;}
      failed.push({...next,checkedAt:input.now(),error:error.message});
      await input.saveFrontier([...queue.values(),...failed],read);
      continue;
    }
    if(next.via && page)page={...page,via:next.via};
    if(!page){await input.saveFrontier([next,...queue.values()],read);break;}
    if(!read.length && next.url===scope.website){scope.website=page.url;own=new URL(page.url).hostname.toLowerCase().replace(/^www\./,'');}
    read.push({url:page.url,checkedAt:page.observedAt});
    const continuedBody=next.bodyName && scope.bodyId?.endsWith('#governing') && isGoverningBodyName(next.bodyName,scope.name,scope.govClass)?scope.bodyId:next.bodyId;
    const pageScope=continuedBody ? {...scope,bodyId:continuedBody,bodyName:next.bodyName,bodyContext:true} : scope;
    const pageFindings=siteFindings(pageScope,page);
    const sourceBodies=pageFindings.filter(f=>f.field==='GOV-02');
    const sourceBody=sourceBodies.length===1?sourceBodies[0]:null;
    const bodyContext=sourceBody ? {bodyId:sourceBody.subjectId,bodyName:sourceBody.value} : sourceBodies.length>1 ? {} : next.bodyId ? {bodyId:next.bodyId,bodyName:next.bodyName} : {};
    for(const finding of pageFindings) {
      // A page can expose a new seat/body, so keep those discoveries even
      // when the old inventory has not acquired a row for the new subject.
      if(finding.field==='GOV-02')for(const family of ['OFF','MTG','DOC','PAR'])families.add(family);
      await input.report(finding);findings++;
    }
    await input.pageRead?.(sourceBody?{...pageScope,bodyId:sourceBody.subjectId,bodyName:sourceBody.value}:sourceBodies.length>1?{...pageScope,bodyName:null,bodyContext:false}:pageScope,page);
    const platforms=meetingSourceLinks(page.html,page.url).filter(candidate=>candidate.platform);
    for(const link of blankLinks(page,families)) {
      const host=new URL(link.url).hostname.toLowerCase().replace(/^www\./,'');
      if(host!==own && !host.endsWith(`.${own}`))continue;
      // Platform routes are findings for the platform lane; this walk reads
      // the government's ordinary pages, including its own calendars.
      if(platforms.some(platform=>link.url===platform.url || link.url.startsWith(platform.url+'/')))continue;
      if(!seen.has(link.url) && !queue.has(link.url))queue.set(link.url,{url:link.url,...bodyContext,via:{page:page.url,artifactId:page.artifactId}});
    }
    await input.saveFrontier([...queue.values(),...failed],read);
  }
  return {read:read.length,findings,remaining:queue.size+failed.length,failures:failed,plan};
}
