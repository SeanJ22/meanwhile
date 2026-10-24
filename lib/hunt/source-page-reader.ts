import {assertPublicUrl} from './egress.ts';
import {recordAcquisition,deriveSanitized} from '../control-plane/evidence/artifact.ts';
import {researchFetch,memoryInProcess} from './robots-first-fetch.ts';
import {DEFAULT_USER_AGENT,type OpenOne,type VaultPut} from '../control-plane/scheduler/route-executor.ts';
import {websiteRequestLimit,type WebsiteSizeForUrl} from '../control-plane/scheduler/host-supervision.ts';
import type {WorkArtifact} from '../control-plane/scheduler/dispatch.ts';
import type {SitePage} from './site-findings.ts';
export function placePageReader(input:{open:OpenOne;vault:VaultPut;spaceOut:(host:string)=>Promise<void>;now:()=>string;attemptId:string;workItemId:string;routeId:string;canRead:()=>boolean;endsAt?:number;websiteSize?:WebsiteSizeForUrl;onArtifact?:(artifact:WorkArtifact)=>Promise<void>}){
 const memory=memoryInProcess(),requests=new Map<string,number>();
 const artifacts:WorkArtifact[]=[];let requestCount=0,bytesFetched=0;
 const get=async(url:string)=>{
  const parsed=assertPublicUrl(url),key=parsed.hostname.toLowerCase().replace(/^www\./,'');
  const limit=websiteRequestLimit(input.websiteSize?.(url));
  if(!input.canRead() || (limit!==null && (requests.get(key)??0)>=limit))throw new Error('HUNT_WALK_DEFERRED');
  await input.spaceOut(parsed.host);
  if(!input.canRead())throw new Error('HUNT_WALK_DEFERRED');
  requests.set(key,(requests.get(key)??0)+1);
  const got=await (input.open as typeof input.open & ((request:Parameters<typeof input.open>[0] & {followRedirects:false})=>ReturnType<typeof input.open> & Promise<{location?:string|null;finalUrl?:string|null}>))({url,method:'GET',headers:{'user-agent':DEFAULT_USER_AGENT,accept:'text/html,text/plain,application/json,text/calendar,*/*'},timeoutMs:Math.max(1,Math.min(20000,(input.endsAt??Infinity)-Date.now())),followRedirects:false});
  requestCount+=got.requestCount??1;bytesFetched+=got.bytes;
  return got;
 };
 const save=async(url:string,got:Awaited<ReturnType<OpenOne>>,permission:'ALLOWED'|'DISALLOWED'|'NOT_APPLICABLE'|'CANNOT_TELL')=>{
  if(!got.body || !/^(text\/|application\/(json|xhtml\+xml|xml|rss\+xml))/i.test(got.contentType))return null;
  const finalUrl=(got as typeof got & {finalUrl?:string|null}).finalUrl??url;
  assertPublicUrl(finalUrl);
  const {artifact:raw}=recordAcquisition({canonicalUrl:finalUrl,retrievedAt:input.now(),httpStatus:got.status??0,contentType:got.contentType,sourceId:new URL(finalUrl).hostname,retrievalUrl:url,methodRouteId:input.routeId,workItemId:input.workItemId,attemptId:input.attemptId,permission,transport:got.status!==null && got.status>=200 && got.status<400?'REACHABLE':'OTHER_NAMED_FAILURE'},got.body);
  let artifact=raw,text=got.body;
  if(raw.tier==='RESTRICTED_RAW'){
   try{await input.vault(raw,text);}catch{/* The sanitized derivative still retains the source hash. */}
   const derived=deriveSanitized(raw,text,input.now());artifact=derived.artifact;text=derived.text;
  }
  const stored=await input.vault(artifact,text);
  if(!stored.stored)throw new Error('HUNT_SOURCE_PAGE_NOT_SAVED:'+stored.why);
  const row={permission:artifact.permission,transport:artifact.transport,httpStatus:got.status,retrievalUrl:url,artifactId:artifact.id,tier:artifact.tier,contentHash:artifact.contentHash,byteLength:artifact.byteLength,contentType:artifact.contentType,canonicalUrl:artifact.canonicalUrl,partial:got.status===206 || Boolean(got.contentRange),recordedAt:artifact.retrievedAt};
  artifacts.push(row);await input.onArtifact?.(row);
  return {url:finalUrl,html:text,artifactId:artifact.id,observedAt:artifact.retrievedAt} satisfies SitePage;
 };
 return {artifacts,get cost(){return {requestCount,bytesFetched};},read:async(url:string):Promise<SitePage|null>=>{
  let last:SitePage|null=null;const before=requestCount;
  const result=await researchFetch(url,{memory,now:()=>Date.parse(input.now()),spacingMs:0,
    sleep:async ms=>{if(!input.canRead() || Date.now()+ms>=(input.endsAt??Infinity))throw new Error('HUNT_WALK_DEFERRED');await new Promise(resolve=>setTimeout(resolve,ms));},
    get:async request=>{
      const got=await get(request.url);
      last=await save(request.url,got,'CANNOT_TELL');
      if((got.status===206 || got.contentRange) && !request.url.endsWith('/robots.txt'))throw new Error('HUNT_SOURCE_UNREADABLE:'+request.url+':partial response');
      if(got.status===429)throw new Error('HUNT_SOURCE_RATE_LIMITED:'+new URL(request.url).host);
      return {status:got.status,contentType:got.contentType,body:new TextEncoder().encode(got.body),transportError:got.transportError,location:got.location??null};
    }});
  if(result.outcome==='REFUSED')throw new Error('HUNT_SOURCE_WALL:'+result.reason);
  if(result.accessControl)throw new Error('HUNT_SOURCE_WALL:'+result.accessControl.kind+':'+new URL(result.finalUrl).host);
  if(result.transportError || result.status===null || result.status<200 || result.status>=300 || result.status===206)throw new Error('HUNT_SOURCE_UNREADABLE:'+new URL(result.finalUrl).host+':'+(result.transportError??result.status));
  const page=last as SitePage|null;
  if(!page)throw new Error('HUNT_SOURCE_UNREADABLE:'+new URL(result.finalUrl).host+':non-text representation needs its document reader');
  return {...page,requestCount:requestCount-before,redirects:result.redirects};
 }};
}
