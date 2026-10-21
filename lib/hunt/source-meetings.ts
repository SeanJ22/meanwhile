import {createHash} from 'node:crypto';
import {meetingSourceLinks} from './meeting-source-links.ts';
import type {SiteScope,SitePage} from './site-findings.ts';
import type {WorkArtifact} from '../control-plane/scheduler/dispatch.ts';
import type {ControlPlaneRepositories,ArtifactRecord} from '../control-plane/repository/types.ts';
import type {MeetingsDiscoveryAttempt,DiscoveryStep,DiscoveryFind} from './meetings-site-discovery.ts';
/** The existing discovery log carries actual source-page observations to the
 * existing crosswalk and wiring path. Platform URLs remain unrequested leads. */
export function sourceMeetings(input:{repos:ControlPlaneRepositories;governmentId:string;website:string;workItemId:string;currentArtifacts:()=>readonly WorkArtifact[]}){
 let home:NonNullable<MeetingsDiscoveryAttempt['site']>['homepage']=null;
 const inherited=new Map<string,Promise<readonly ArtifactRecord[]>>();
 return async(scope:SiteScope,page:SitePage)=>{
  if(!home)home={url:page.url,artifactId:page.artifactId,basis:'RECORDED_ADDRESS',hintFingerprint:null,startedAt:input.website,redirects:page.redirects??[]};
  const links=meetingSourceLinks(page.html,page.url);
  const leads=links.map(link=>({vendor:link.vendor,url:link.url,basis:'LINKED' as const,evidence:link.url,detail:`The saved government page links ${link.text||link.url}`,via:{page:page.url,artifactId:page.artifactId},...(scope.bodyName?{bodyName:scope.bodyName}:{})}));
  const found:DiscoveryFind[]=[];
  if(/^\s*BEGIN:VCALENDAR/i.test(page.html) && scope.bodyName && page.html.toLowerCase().includes(scope.bodyName.toLowerCase())){
   const count=[...page.html.matchAll(/^BEGIN:VEVENT/gim)].length;
   if(count)found.push({vendor:'ical',url:page.url,basis:'LINKED',evidence:page.url,count,detail:`The saved calendar contains ${count} events and names ${scope.bodyName}`,artifactId:page.artifactId,bodyName:scope.bodyName,via:page.via??null});
  }
  if(!found.length && !leads.length)return;
  const work=page.sourceWorkItemId??input.workItemId;
  const robotsUrls=[...new Set([new URL('/robots.txt',page.url).href,new URL('/robots.txt',scope.website).href])];
  const key=work+'|'+robotsUrls.join('|');
  if(work!==input.workItemId && !inherited.has(key))inherited.set(key,Promise.all(robotsUrls.map(url=>input.repos.artifacts.readWhere(work,['canonicalUrl'],url))).then(groups=>groups.flat()));
  const artifacts=work===input.workItemId?input.currentArtifacts():await inherited.get(key)!;
  const host=new URL(page.url).hostname.replace(/^www\./,'');
  const robots=artifacts.filter(row=>{const sourceUrl=new URL(row.canonicalUrl);return sourceUrl.hostname.replace(/^www\./,'')===host && sourceUrl.pathname==='/robots.txt' && row.recordedAt<=page.observedAt;}).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt))[0];
  const steps:DiscoveryStep[]=[];
  if(robots)steps.push({purpose:'robots',url:robots.canonicalUrl,permission:'CANNOT_TELL',status:(robots as WorkArtifact & {httpStatus?:number|null}).httpStatus??null,transportError:null,bytes:robots.byteLength,artifactId:robots.artifactId,rung:null,note:`Saved robots observation from ${robots.recordedAt}`});
  steps.push({purpose:page.url===home.url?'homepage':'endpoint',url:page.url,permission:'CANNOT_TELL',status:200,transportError:null,bytes:Buffer.byteLength(page.html),artifactId:page.artifactId,rung:page.requestCount?2:null,note:`Saved source page observed ${page.observedAt}`});
  const value={formatVersion:1 as const,jurisdictionId:input.governmentId,stateCode:scope.state,ownWebAddress:scope.website,startedAt:page.observedAt,finishedAt:page.observedAt,outcome:found.length?'FOUND' as const:'LEAD' as const,found,leads,steps,recipes:{applied:[],skipped:[],learned:[]},search:[],requestCount:page.requestCount??0,recheckAfter:new Date(Date.parse(page.observedAt)+24*3600000).toISOString(),note:`${scope.name}: ${found.length} calendar source(s) confirmed; ${leads.length} published meeting link(s) remain to be read.`,site:{address:null,homepage:home}};
  const id='discovery-hn01-'+createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
  await input.repos.discoveryAttempts.append(input.governmentId,id,{...value,attemptId:id},page.observedAt);
 };
}
