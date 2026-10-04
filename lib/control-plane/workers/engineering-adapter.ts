import { readRolePlaybook, workerSystemPrompt } from "../playbooks.ts";
/** Engineer publishes source adapters through review; CI and S10 own merge. */
import { execFile } from 'node:child_process';
import type { ScoutResult } from '../scheduler/scout-result.ts';
import { STREAMLINE_INVENTORY_SOURCE } from './engineering-candidate.ts';
import { installedAdapters,installedAdapterGuides } from '../scheduler/scout-adapters.ts';
import {hasUntriedAdapter} from './detective.ts';
import {readFieldManual,writeFieldManual,newFieldManualEntry,upsertEntries,projectFieldManual} from '../field-manual.ts';
import { MODELS, MODEL_TIERS } from '../../models.ts';
import { recordCost } from '../repository/coordinator.ts';
import { meteredCostFields, priceMeteredUsage, readMeteredUsage } from '../model-cost.ts';
import type { ModelTransport } from '../scheduler/scout-executor.ts';
import type { ControlPlaneRepositories } from '../repository/types.ts';
import type { WorkerEvidence } from './types.ts';
import {FleetPreSendRefusal} from '../fleet-safety.ts';
import {SendBudgetRefusal} from '../expansion/spend-holds.ts';

export const ENGINEER_ADAPTER_PREFIX = 'lib/sources/platform-adapters/';
export interface AdapterFile {path:string;content:string}
export interface AdapterPullRequest {url:string;number:number;branch:string}
function adapterFiles(value:unknown): value is AdapterFile[] {
  return Array.isArray(value) && value.length>0 && value.every(file=>file && typeof file.path==='string' &&
    typeof file.content==='string' && file.content.trim() && file.path.startsWith(ENGINEER_ADAPTER_PREFIX) &&
    !file.path.includes('..') && !file.path.includes('\\') && /\.(?:ts|mjs)$/.test(file.path));
}
type GitRef = {object:{sha:string}};
type GitCommit = {tree:{sha:string}};
type GitObject = {sha:string};
type GitPull = {html_url:string;number:number};
export type GitHubRequest = (method:string,path:string,body?:unknown)=>Promise<unknown>;
/** JSON goes over stdin, never shell interpolation. */
export const githubRequest: GitHubRequest = async (method,path,body) => {
  const args=['api','--method',method,path];
  if (body !== undefined) args.push('--input','-');
  return new Promise((resolve,reject)=>{
    const child=execFile('gh',args,{windowsHide:true,maxBuffer:4*1024*1024},(error,stdout,stderr)=>{
      if(error)reject(new Error(stderr || error.message));else {try {resolve(stdout.trim()?JSON.parse(stdout):null);}catch(error){reject(error);}}
    });
    if(body!==undefined)child.stdin?.end(JSON.stringify(body));
  });
};
export function adapterBranchKey(platform:string):string {
  return platform.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-|-$/g,'').slice(0,70);
}
/** Platform-wide implementation; one branch per platform prevents one PR per subject. */
export async function publishAdapterPullRequest(input:{platform:string;files:readonly AdapterFile[];reason:string;request?:GitHubRequest;repo?:string}):Promise<AdapterPullRequest> {
  const request=input.request??githubRequest,repo=input.repo??'SeanJ22/meanwhile';
  const platform=adapterBranchKey(input.platform);
  if(!platform || !adapterFiles(input.files)) throw new Error('ENGINEER_ADAPTER_FILES_ONLY');
  const branch='engineer-adapter/'+platform;
  const existing=await request('GET',`repos/${repo}/pulls?state=open&head=${encodeURIComponent(repo.split('/')[0]+':'+branch)}`) as GitPull[];
  if(existing.length){await request('POST',`repos/${repo}/issues/${existing[0].number}/labels`,{labels:['engineer-adapter']});return {url:existing[0].html_url,number:existing[0].number,branch};}
  const main=await request('GET',`repos/${repo}/git/ref/heads/main`) as GitRef;
  const parent=await request('GET',`repos/${repo}/git/commits/${main.object.sha}`) as GitCommit;
  const tree=await request('POST',`repos/${repo}/git/trees`,{base_tree:parent.tree.sha,tree:input.files.map(file=>({path:file.path,mode:'100644',type:'blob',content:file.content}))}) as GitObject;
  const commit=await request('POST',`repos/${repo}/git/commits`,{message:`Add ${platform} source adapter`,tree:tree.sha,parents:[main.object.sha]}) as GitObject;
  try {await request('POST',`repos/${repo}/git/refs`,{ref:'refs/heads/'+branch,sha:commit.sha});}
  catch(error){
    // An interrupted prior publication may have left this branch; never overwrite it.
    const ref=await request('GET',`repos/${repo}/git/ref/heads/${branch}`) as GitRef;
    const held=await request('GET',`repos/${repo}/git/commits/${ref.object.sha}`) as GitCommit;
    if(held.tree.sha!==tree.sha)throw error;
  }
  const pr=await request('POST',`repos/${repo}/pulls`,{title:`Engineer adapter: ${platform}`,head:branch,base:'main',body:input.reason+'\n\nPlatform adapter only. CI runs the focused adapter tests. Auto-merge belongs to the engineer-adapter workflow; no production runner is started.'}) as GitPull;
  await request('POST',`repos/${repo}/issues/${pr.number}/labels`,{labels:['engineer-adapter']});
  return {url:pr.html_url,number:pr.number,branch};
}

/** Cheapest route: promote the existing deterministic sitemap implementation. */
export function plainAdapterFor(result:ScoutResult):{platform:string;files:AdapterFile[]}|null {
  if(result.refusal!==null || result.outcome!=='NEEDS_ADAPTER')return null;
  const description=[result.narrative,...result.candidates.map(c=>c.procedure),...result.nextRungs].join(' ');
  if (/uncapped.link|raw.HTML extraction|Verified Webpages/i.test(description)) return {
    platform:'uncapped-source-links',files:[
      {path:ENGINEER_ADAPTER_PREFIX+'uncapped-source-links.ts',content:UNCAPPED_LINK_SOURCE},
      {path:ENGINEER_ADAPTER_PREFIX+'uncapped-source-links.test.ts',content:UNCAPPED_LINK_TEST}
    ]};
  if(!/sitemap/i.test(description) || !/streamline|dated/i.test(description))return null;
  const name='dated-sitemap';
  return {platform:name,files:[{path:ENGINEER_ADAPTER_PREFIX+name+'.mjs',content:STREAMLINE_INVENTORY_SOURCE},
    {path:ENGINEER_ADAPTER_PREFIX+name+'.test.mjs',content:`import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryStreamlineSitemap } from './dated-sitemap.mjs';
test('dated sitemap preserves exact publisher locators and rejects unrelated hosts',()=>{
  const xml='<urlset><url><loc>https://council.gov/2026-09-30-board</loc></url><url><loc>https://unrelated.gov/2026-09-30-board</loc></url></urlset>';
  const result=inventoryStreamlineSitemap({xml,subjectId:'council',publisherOrigin:'https://council.gov'});
  assert.equal(result.entries.length,1);assert.equal(result.entries[0].sourceUrl,'https://council.gov/2026-09-30-board');
  for(const span of result.entries[0].spans)assert.equal(xml.slice(span.start,span.end),span.quote);
});\n`} ]};
}

/** Reviewed code teaches its portable instructions after deployment; unchanged versions need no write. */
export async function learnInstalledAdapters(repos:ControlPlaneRepositories,now:string) {
  const manual=await readFieldManual(repos,{role:'ENGINEER'});
  const learned=(await installedAdapterGuides()).map(({name,version,file,guide})=>newFieldManualEntry('installed-adapter',name,{
    role:'SHARED',kind:'PLATFORM_ADAPTER',title:name,summary:guide.summary,
    outcome:'REFERENCE',recordClasses:guide.recordClasses,platforms:[name],url:guide.sourceUrls[0]??null,observedAt:now,
    payload:{platform:name,installed:true,implementationVersion:version,files:[file],sourceUrls:guide.sourceUrls,procedure:guide.procedure},
  })).filter(entry=>!manual.store.entries.some(prior=>prior.id===entry.id && prior.kind===entry.kind &&
    (prior.payload as {implementationVersion?:string|null}|null)?.implementationVersion===(entry.payload as {implementationVersion:string|null}).implementationVersion));
  if(!learned.length)return {store:manual.store,projection:manual.projection,error:manual.error};
  const saved=await writeFieldManual(repos,learned,now);
  const store=upsertEntries(manual.store,learned,now);
  return {store,projection:projectFieldManual(store,{role:'ENGINEER'}),error:saved.error};
}

/** Consume needs-an-adapter work from the existing Scout results, saving the route to its PR in the bank. */
export async function workAdapterQueue(input:{repos:ControlPlaneRepositories;results:readonly ScoutResult[];
  /** Caller supplies the ordinary Fleet/area budget guard, never a raw model transport. */
  transportFor?:(result:ScoutResult)=>ModelTransport; readEvidence?:(id:string)=>Promise<WorkerEvidence>;
  now:string;request?:GitHubRequest}):Promise<AdapterPullRequest[]> {
  const manual=await learnInstalledAdapters(input.repos,input.now);
  const opened:AdapterPullRequest[]=[];
  const done=new Set(manual.store.entries.filter(e=>e.kind==='ENGINEER_ADAPTER_PR').map(e=>e.title));
  const installed=new Set(await installedAdapters());
  const latest=new Map<string,ScoutResult>();
  for(const result of [...input.results].sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt))) latest.set(result.subjectId+':'+result.recordClass,result);
  const pending=[...latest.values()].filter(r=>r.outcome==='NEEDS_ADAPTER' && r.refusal===null);
  for(const result of pending) {
    const plain=plainAdapterFor(result);
    const platform=adapterBranchKey(plain?.platform ?? result.candidates[0]?.routeId ?? result.recordClass);
    if(done.has(platform) || installed.has(platform) || hasUntriedAdapter(result,[...installed],manual.store.entries))continue;
    try {
    let candidate=plain;
    if(!candidate && input.transportFor && input.readEvidence) {
      // Exhausted code generation waits for new evidence, rather than buying the same three answers every cycle.
      if(manual.store.entries.some(e=>e.kind==='ENGINEER_INVESTIGATION' && e.title===platform &&
        (e.payload as {sourceAttemptId?:string}|null)?.sourceAttemptId===result.attemptId))continue;
      const evidence:WorkerEvidence[]=[];
      for(const id of new Set(result.artifactIds)) {
        try { evidence.push(await input.readEvidence(id)); } catch { /* Missing bytes are not invented. */ }
      }
      if(!evidence.length)continue;
      const transport=input.transportFor(result);
      const messages:Parameters<ModelTransport>[0]['messages'][number][]=[{role:'user',content:JSON.stringify({platform,
        investigation:{narrative:result.narrative,routes:result.candidates,facts:result.findings,tried:result.rungs,next:result.nextRungs},
        knowledge:manual.projection.lines,evidence:evidence.map(e=>({sourceUrl:e.canonicalUrl,text:e.text,artifactId:e.artifactId}))})}];
      const tried:string[]=[];
      for(const tier of MODEL_TIERS) {
        const model=MODELS[tier].model,started=Date.now();
        // The same existing transport admits every request, including each escalation, against live budgets.
        let response:Awaited<ReturnType<ModelTransport>>|undefined,transportError:unknown;
        try {response=await transport({model,max_tokens:8000,
          system:[{type:'text',text:workerSystemPrompt("ENGINEER", (await readRolePlaybook(input.repos, "ENGINEER")).text),cache_control:{type:"ephemeral"}}],
          messages,tools:[],tool_choice:{type:'auto'}});} catch(error) {
          if(error instanceof FleetPreSendRefusal || error instanceof SendBudgetRefusal)throw error;
          transportError=error;
        }
        const usage=readMeteredUsage(response?.usage??{}),usd=priceMeteredUsage(model,usage,'5m').usd;
        const metered=meteredCostFields(usage);
        const inputTokens=usage.uncachedInputTokens===null?null:usage.uncachedInputTokens+(usage.cacheReadInputTokens??0)+(usage.cacheCreationInputTokens??0);
        await recordCost(input.repos,{attemptId:`engineer:${result.attemptId}:${input.now}:${tier}`,workItemId:result.workItemId,
          obligationId:result.obligationId,routeTaskId:null,routeId:platform,source:'api.anthropic.com',jurisdiction:result.subjectId,
          project:'freshness',role:'ENGINEERING',recordClass:result.recordClass,recordedAt:input.now,
          ...(process.env.WTP_RUNTIME_MODE==='staging'?{nonProduction:true as const}:{}),
          cost:{inputTokens,outputTokens:usage.outputTokens,usd,durationMs:Date.now()-started,bytesFetched:0,requestCount:1,...metered},
          byModel:[{model,requestCount:1,usd,inputTokens,outputTokens:usage.outputTokens,...metered}]},input.now);
        if(!response)throw transportError??new Error('ENGINEER_TRANSPORT_FAILED');
        const text=response.content.filter(block=>block.type==='text').map(block=>(block as {text:string}).text).join('');
        let parsed: {files?:unknown}|null=null;
        try {parsed=JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{ /* The next tier sees the malformed response. */ }
        if(adapterFiles(parsed?.files) && parsed.files.some(f=>/\.test\.(?:ts|mjs)$/.test(f.path)) &&
          parsed.files.some(f=>! /\.test\.(?:ts|mjs)$/.test(f.path))) {
          candidate={platform,files:parsed.files};break;
        }
        const reason=`${tier} returned no usable adapter implementation with a colocated behavioral test`;
        tried.push(reason);
        if(usd===null)throw new Error('ENGINEER_USAGE_UNMEASURED: no escalation until the existing budget hold is reconciled');
        messages.push({role:'assistant',content:text},{role:'user',content:reason+'. Repair the response using the supplied saved evidence, or state that evidence is insufficient.'});
      }
      if(!candidate)await writeFieldManual(input.repos,[newFieldManualEntry('engineer-investigation',platform,{role:'ENGINEER',kind:'ENGINEER_INVESTIGATION',title:platform,
        summary:tried.join('; ')+'. Await new source evidence before repeating this investigation.',outcome:'BLOCKED',observedAt:input.now,
        payload:{sourceAttemptId:result.attemptId,tried}})],input.now);
    }
    if(!candidate?.files?.length)continue;
    const pr=await publishAdapterPullRequest({...candidate,request:input.request,
      reason:`Recover ${result.recordClass} acquisition using a reusable ${candidate.platform} adapter.\n\nWhat failed: ${result.narrative}\nSource routes: ${result.candidates.map(c=>c.url).join(', ') || result.rungs.map(r=>r.target).join(', ')}`});
    opened.push(pr);done.add(platform);
    await writeFieldManual(input.repos,[newFieldManualEntry('engineer-adapter',platform,{role:'SHARED',kind:'ENGINEER_ADAPTER_PR',title:platform,
      summary:'Adapter implementation in '+pr.url,outcome:'REFERENCE',observedAt:input.now,recordClasses:[result.recordClass],url:pr.url,
      payload:{platform,pr,subjectId:result.subjectId,sourceAttemptId:result.attemptId,files:candidate.files.map(file=>file.path),
        sourceUrls:[...new Set([...result.candidates.filter(c=>c.evidenceArtifactIds.length>0).map(c=>c.url),
          ...result.rungs.filter(r=>r.ok && r.artifactIds.length>0).map(r=>r.target)])]}})],input.now);
    } catch(error) {
      await writeFieldManual(input.repos,[newFieldManualEntry('engineer-adapter-blocker',platform,{role:'ENGINEER',kind:'ENGINEER_BLOCKER',title:platform,
        summary:error instanceof Error?error.message:String(error),outcome:'BLOCKED',observedAt:input.now,payload:{sourceAttemptId:result.attemptId,nextAction:'Continue the existing adapter branch/PR after the recorded publication failure is repaired.'}})],input.now);
    }
  }
  return opened;
}

const UNCAPPED_LINK_SOURCE = `/** Read all source links from held HTML; returned links are investigation routes, not verified facts. */
import { extractLinks } from '../../control-plane/scheduler/scout-tools.ts';
export function uncappedSourceLinks(html:string, sourceUrl:string) {
  return extractLinks(html,new URL(sourceUrl),Number.MAX_SAFE_INTEGER).map(link=>({...link,sourceUrl}));
}
`;
const UNCAPPED_LINK_TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { uncappedSourceLinks } from './uncapped-source-links.ts';
test('held source links after the model display cap remain discoverable for every publisher',()=>{
 for(const source of ['https://first.gov/records','https://second.gov/records']) {
  const html=Array.from({length:95},(_,i)=>'<a href="/document/'+i+'">Document '+i+'</a>').join('');
  const result=uncappedSourceLinks(html,source);
  assert.equal(result.length,95);assert.ok(result.some(link=>link.url.endsWith('/document/94')));
  assert.ok(result.every(link=>link.sourceUrl===source));
 }
});
`;
