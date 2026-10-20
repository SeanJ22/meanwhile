import { loadAdapterRepairScope } from "./adapter-repair-load.ts";
import { checkAdapterRepair } from "./adapter-repair-check.ts";
import { outOfScope, repairBrief, type RepairScope } from "./adapter-repair-scope.ts";
import { detectTenancy } from "../../hunt/platform-tenancy.ts";
import { readRolePlaybook, workerSystemPrompt } from "../playbooks.ts";
/** The engineer publishes source adapters as a READY commit and status record on `stream/adapter-<kind>` for River. */
import { execFile } from 'node:child_process';
import type { ScoutResult } from '../scheduler/scout-result.ts';
import { STREAMLINE_INVENTORY_SOURCE } from './engineering-candidate.ts';
import { installedAdapters,installedAdapterGuides,installedAdapterVersion } from '../scheduler/scout-adapters.ts';
import {readFieldManual,writeFieldManual,newFieldManualEntry,type FieldManualEntry,type FieldManualQuery,type FieldManualRead} from '../field-manual.ts';
import { MODELS, MODEL_TIERS } from '../../models.ts';
import { recordCost } from '../repository/coordinator.ts';
import { listPriceUsdForUsage, meteredCostFields, priceMeteredUsage, readMeteredUsage } from '../model-cost.ts';
import type { ModelTransport } from '../scheduler/scout-executor.ts';
import type { ControlPlaneRepositories } from '../repository/types.ts';
import type { WorkerEvidence } from './types.ts';
import {FleetPreSendRefusal} from '../fleet-safety.ts';
import {SendBudgetRefusal} from '../expansion/spend-holds.ts';

export const ENGINEER_ADAPTER_PREFIX = 'lib/sources/platform-adapters/';
export interface AdapterFile {path:string;content:string}
function adapterFiles(value:unknown, scope?:RepairScope): value is AdapterFile[] {
  return Array.isArray(value) && value.length>0 && value.every(file=>file && typeof file.path==='string' &&
    typeof file.content==='string' && file.content.trim() && (scope ? outOfScope(scope,[file.path]).length===0 : file.path.startsWith(ENGINEER_ADAPTER_PREFIX)) &&
    !file.path.includes('..') && !file.path.includes('\\') && /\.(?:ts|mjs)$/.test(file.path));
}
type GitRef = {object:{sha:string}};
type GitCommit = {tree:{sha:string}};
type GitObject = {sha:string};
export interface AdapterCheck {ok:boolean;summary:string}
export type AdapterChecker = (files:readonly AdapterFile[])=>Promise<AdapterCheck>|AdapterCheck;
export interface AdapterStreamPublication {url:string;branch:string;kind:string;readySha:string;statusSha:string;created:boolean;check:AdapterCheck}
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
export const ADAPTER_STREAM_PREFIX='stream/adapter-';
const isTestFile=(path:string)=>/\.test\.(?:ts|mjs)$/.test(path);
/**
 * The engineer's own check before anything is marked READY: adapter-only paths,
 * at least one implementation and one colocated test. The full suite is
 * River's `pnpm gates` on the fold, which the status record says plainly.
 */
export function adapterOwnCheck(files:readonly AdapterFile[], scope?:RepairScope):AdapterCheck {
  if(!adapterFiles(files,scope))return {ok:false,summary:'files outside lib/sources/platform-adapters/*.ts|mjs or empty'};
  const tests=files.filter(f=>isTestFile(f.path)).length,impl=files.length-tests;
  if(scope)return impl>0?{ok:true,summary:`${scope.kind} repair: adapter-only paths; ${scope.testFiles.length} fixture and composite checks required`}:{ok:false,summary:'repair needs an implementation change'};
  if(!tests||!impl)return {ok:false,summary:`needs an implementation and a colocated test (implementation ${impl}, tests ${tests})`};
  return {ok:true,summary:`engineer check pass: ${impl} implementation, ${tests} colocated test file(s), adapter-only paths`};
}

/** `.factory/adapter-<kind>.md` in the lane status format River's `scan` reads. */
export function adapterStatusRecord(input:{kind:string;readySha:string;check:AdapterCheck;runId:string;now:string;reason:string}):string {
  const lane='adapter-'+input.kind;
  return [`# ${lane}`,'',
    'build_state: waiting','worker: adapter engineer','provider: runner',`run_id: ${input.runId}`,'lock: none',`heartbeat: ${input.now}`,
    `ready: ${lane} ${input.readySha}`,
    `checks: ${input.check.summary} on ${input.readySha}; full tests: River runs pnpm gates on the fold`,
    'working_on: none',`waiting_on: River integration of ${lane} ${input.readySha.slice(0,12)}`,'returned: none','',
    '## About','',`Written by the runner's adapter engineer (RL-06). River returns failures to board/river returns/${lane}.md.`,'',
    input.reason.trim(),''].join('\n');
}

/** One fast-forward push of a `READY: adapter <kind>` commit and its status commit onto `stream/adapter-<kind>`, created from `river` when absent. Never forced; a moved branch fails and is retried next cycle. */
export async function publishAdapterStream(input:{platform:string;files:readonly AdapterFile[];reason:string;runId:string;now:string;
  request?:GitHubRequest;repo?:string;check?:AdapterChecker;scope?:RepairScope}):Promise<AdapterStreamPublication> {
  const request=input.request??githubRequest,repo=input.repo??'SeanJ22/meanwhile';
  const kind=adapterBranchKey(input.platform);
  if(!kind || !adapterFiles(input.files,input.scope) || (input.scope && input.scope.kind!==kind)) throw new Error('ENGINEER_ADAPTER_FILES_ONLY');
  const own=adapterOwnCheck(input.files,input.scope);
  const extra=own.ok ? input.check?await input.check(input.files):input.scope?await checkAdapterRepair(input.files,input.scope):null : null;
  const check=!own.ok?own:extra?{ok:extra.ok,summary:own.summary+'; '+extra.summary}:own;
  if(!check.ok)throw new Error('ENGINEER_ADAPTER_CHECK_FAILED: '+check.summary);
  const branch=ADAPTER_STREAM_PREFIX+kind;
  // matching-refs answers an empty list for a missing branch instead of a 404.
  const matching=await request('GET',`repos/${repo}/git/matching-refs/heads/${branch}`) as {ref:string;object:{sha:string}}[];
  const held=matching.find(ref=>ref.ref==='refs/heads/'+branch);
  const base=held?held.object.sha:(await request('GET',`repos/${repo}/git/ref/heads/river`) as GitRef).object.sha;
  const parent=await request('GET',`repos/${repo}/git/commits/${base}`) as GitCommit;
  const tree=await request('POST',`repos/${repo}/git/trees`,{base_tree:parent.tree.sha,tree:input.files.map(file=>({path:file.path,mode:'100644',type:'blob',content:file.content}))}) as GitObject;
  const ready=await request('POST',`repos/${repo}/git/commits`,{message:`READY: adapter ${kind} reusable source adapter\n\n${input.reason}\n\nChecks: ${check.summary}`,tree:tree.sha,parents:[base]}) as GitObject;
  const status=adapterStatusRecord({kind,readySha:ready.sha,check,runId:input.runId,now:input.now,reason:input.reason});
  const statusTree=await request('POST',`repos/${repo}/git/trees`,{base_tree:tree.sha,tree:[{path:`.factory/adapter-${kind}.md`,mode:'100644',type:'blob',content:status}]}) as GitObject;
  const statusCommit=await request('POST',`repos/${repo}/git/commits`,{message:`status: adapter-${kind} ready ${ready.sha.slice(0,12)}`,tree:statusTree.sha,parents:[ready.sha]}) as GitObject;
  if(held)await request('PATCH',`repos/${repo}/git/refs/heads/${branch}`,{sha:statusCommit.sha,force:false});
  else await request('POST',`repos/${repo}/git/refs`,{ref:'refs/heads/'+branch,sha:statusCommit.sha});
  return {url:`https://github.com/${repo}/tree/${branch}`,branch,kind,readySha:ready.sha,statusSha:statusCommit.sha,created:!held,check};
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
export async function learnInstalledAdapters(repos:ControlPlaneRepositories,now:string):Promise<FieldManualRead> {
  const manual=await readFieldManual(repos,ENGINEER_BOOKKEEPING);
  const learned=(await installedAdapterGuides()).map(({name,version,file,guide})=>newFieldManualEntry('installed-adapter',name,{
    role:'SHARED',kind:'PLATFORM_ADAPTER',title:name,summary:guide.summary,
    outcome:'REFERENCE',recordClasses:guide.recordClasses,platforms:[name],url:guide.sourceUrls[0]??null,observedAt:now,
    payload:{platform:name,installed:true,implementationVersion:version,files:[file],sourceUrls:guide.sourceUrls,procedure:guide.procedure},
  })).filter(entry=>!manual.store.entries.some(prior=>prior.id===entry.id && prior.kind===entry.kind &&
    (prior.payload as {implementationVersion?:string|null}|null)?.implementationVersion===(entry.payload as {implementationVersion:string|null}).implementationVersion));
  if(!learned.length)return manual;
  const saved=await writeFieldManual(repos,learned,now);
  const read=await readFieldManual(repos,ENGINEER_BOOKKEEPING);
  return saved.error?{...read,error:saved.error}:read;
}

/** What the Engineer keeps track of across platforms: adapters built and installed, investigations, and how platforms are recognized. */
const ENGINEER_BOOKKEEPING:FieldManualQuery={role:'ENGINEER',everywhere:true,
  kinds:['ENGINEER_ADAPTER_PR','PLATFORM_ADAPTER','ENGINEER_INVESTIGATION','PLATFORM_FINGERPRINT']};

/** The Engineer's page for one platform: what is known for this platform, this place and its record class. */
export function engineerJob(result:Pick<ScoutResult,"subjectId"|"recordClass">,platform:string):FieldManualQuery {
  const place=result.subjectId.split('#')[0]!;
  return {role:'ENGINEER',platform,recordClass:result.recordClass,subjectId:result.subjectId,...(place.startsWith('ocd-division/')?{ocdIds:[place]}:{})};
}

const ARCHIVE_HOST = /^(?:web\.archive\.org|(?:www\.)?archive\.(?:today|is|ph|vn|fo|li|md))$/i;

/** True when an installed adapter the result named, or one the Engineer built for its attempt or source, was never run on it. */
function hasUntriedAdapter(latest:ScoutResult,installed:readonly string[],knowledge:readonly FieldManualEntry[]) {
  const description = [latest.narrative,...(latest.nextRungs ?? []),...(latest.candidates ?? []).map(c=>c.routeId)].join(' ').toLowerCase();
  const sourceOrigin=(value:unknown)=>{
    if(typeof value!=='string')return null;
    try {const url=new URL(value);return ['https:','http:'].includes(url.protocol) && !ARCHIVE_HOST.test(url.hostname)?url.origin:null;}catch{return null;}
  };
  const origins=new Set([...(latest.candidates??[]).map(c=>c.url),...(latest.rungs??[]).filter(r=>r.tool!=='search').map(r=>r.target)].map(sourceOrigin).filter(Boolean));
  const learned=new Set(knowledge.flatMap(entry=>{
    const payload=entry.payload as {sourceAttemptId?:string;files?:unknown;sourceUrls?:unknown}|null;
    if(!['ENGINEER_ADAPTER_PR','PLATFORM_ADAPTER'].includes(entry.kind) || !Array.isArray(payload?.files))return [];
    const sameAttempt=Boolean(latest.attemptId && payload.sourceAttemptId===latest.attemptId);
    const sameSourceClass=entry.recordClasses.includes(latest.recordClass?.toLowerCase()) && Array.isArray(payload.sourceUrls) &&
      payload.sourceUrls.some(value=>{const origin=sourceOrigin(value);return origin!==null && origins.has(origin);});
    if(!sameAttempt && !sameSourceClass)return [];
    return payload.files.flatMap(path=>{
      const name=typeof path==='string'?/^lib\/sources\/platform-adapters\/([a-z0-9-]+)\.(?:ts|mjs)$/.exec(path)?.[1]:undefined;
      return name?[name]:[];
    });
  }));
  return installed.some(name=>(learned.has(name) || description.includes(name) || (name==='uncapped-source-links' && /uncapped.link|raw.html extraction|verified webpages/.test(description)) || (name==='dated-sitemap' && /streamline|dated.sitemap/.test(description))) &&
    !(latest.rungs??[]).some(r=>r.tool==='run_adapter' && r.observed.includes(name+'@'+installedAdapterVersion(name))));
}

/** Consume needs-an-adapter work from the existing Scout results, saving the published route in the bank. */
export async function workAdapterQueue(input:{repos:ControlPlaneRepositories;results:readonly ScoutResult[];
  /** Caller supplies the ordinary Fleet/area budget guard, never a raw model transport. */
  transportFor?:(result:ScoutResult)=>ModelTransport; readEvidence?:(id:string)=>Promise<WorkerEvidence>;
  now:string;request?:GitHubRequest;
  check?:AdapterChecker;
  repairScopeFor?:typeof loadAdapterRepairScope}):Promise<AdapterStreamPublication[]> {
  const manual=await learnInstalledAdapters(input.repos,input.now);
  const opened:AdapterStreamPublication[]=[];
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
    let candidate:({platform:string;files:AdapterFile[];scope?:RepairScope})|null=plain;
    if(!candidate && input.transportFor && input.readEvidence) {
      // Exhausted code generation waits for new evidence, rather than buying the same three answers every cycle.
      if(manual.store.entries.some(e=>e.kind==='ENGINEER_INVESTIGATION' && e.title===platform &&
        (e.payload as {sourceAttemptId?:string}|null)?.sourceAttemptId===result.attemptId))continue;
      const evidence:WorkerEvidence[]=[];
      for(const id of new Set(result.artifactIds)) {
        try { evidence.push(await input.readEvidence(id)); } catch { /* Missing bytes are not invented. */ }
      }
      if(!evidence.length)continue;
      const kinds=[...new Set([...evidence.flatMap(e=>detectTenancy(e.text,e.canonicalUrl,manual.store.entries).map(hit=>hit.platform)),platform])];
      let scope:RepairScope|undefined;
      for(const kind of kinds) {
        const loaded=(input.repairScopeFor??loadAdapterRepairScope)(kind,{savedBytes:evidence.map(e=>e.text).join('\n\n'),failure:result.narrative});
        if(loaded) { if(!loaded.ok)throw new Error(loaded.why); scope=loaded.scope; break; }
      }
      const repairPlatform=scope?.kind??platform;
      const transport=input.transportFor(result);
      const messages:Parameters<ModelTransport>[0]['messages'][number][]=[{role:'user',content:scope?repairBrief(scope):JSON.stringify({platform,
        investigation:{narrative:result.narrative,routes:result.candidates,facts:result.findings,tried:result.rungs,next:result.nextRungs},
        knowledge:(await readFieldManual(input.repos,engineerJob(result,platform))).projection.lines,evidence:evidence.map(e=>({sourceUrl:e.canonicalUrl,text:e.text,artifactId:e.artifactId}))})}];
      const tried:string[]=[];
      for(const tier of MODEL_TIERS) {
        const model=MODELS[tier].model,started=Date.now();
        // The same existing transport admits every request, including each escalation, against live budgets.
        let response:Awaited<ReturnType<ModelTransport>>|undefined,transportError:unknown;
        try {response=await transport({model,max_tokens:8000,
          system:[{type:'text',text:workerSystemPrompt("ENGINEER", (await readRolePlaybook(input.repos, "ENGINEER")).text),cache_control:{type:"ephemeral",ttl:"1h"}}],
          batchContext:{job:"BLANK"},
          messages:scope?[...messages,{role:"user",content:"This request repairs an existing adapter. Its supplied repair scope governs allowed paths; playbook instructions about new-adapter paths apply only to new adapters. The composite contract is read-only."}]:messages,tools:[],tool_choice:{type:'auto'}});} catch(error) {
          if(error instanceof FleetPreSendRefusal || error instanceof SendBudgetRefusal)throw error;
          transportError=error;
        }
        const usage=readMeteredUsage(response?.usage??{},response?.batch===true),usd=priceMeteredUsage(model,usage,'1h').usd;
        const metered={...meteredCostFields(usage),listPriceUsd:listPriceUsdForUsage(model,usage),modelRequestCount:1,
          batchRequestCount:response?response.batch===true?1:0:null,batchEligibleRequestCount:response?.batchEligible===undefined?null:response.batchEligible?1:0};
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
        if(adapterFiles(parsed?.files,scope) && (scope || parsed.files.some(f=>/\.test\.(?:ts|mjs)$/.test(f.path))) &&
          parsed.files.some(f=>! /\.test\.(?:ts|mjs)$/.test(f.path))) {
          candidate={platform:repairPlatform,files:parsed.files,...(scope?{scope}:{})};break;
        }
        const reason=`${tier} returned no usable adapter implementation with a colocated behavioral test`;
        tried.push(reason);
        if(usd===null)throw new Error('ENGINEER_USAGE_UNMEASURED: no escalation until the existing budget hold is reconciled');
        messages.push({role:'assistant',content:text},{role:'user',content:reason+'. Repair the response using the supplied saved evidence, or state that evidence is insufficient.'});
      }
      if(!candidate)await writeFieldManual(input.repos,[newFieldManualEntry('engineer-investigation',platform,{role:'ENGINEER',kind:'ENGINEER_INVESTIGATION',title:platform,platforms:[platform],
        summary:tried.join('; ')+'. Await new source evidence before repeating this investigation.',outcome:'BLOCKED',observedAt:input.now,
        payload:{sourceAttemptId:result.attemptId,tried}})],input.now);
    }
    if(!candidate?.files?.length)continue;
    const reason=`Recover ${result.recordClass} acquisition using a reusable ${candidate.platform} adapter.\n\nWhat failed: ${result.narrative}\nSource routes: ${result.candidates.map(c=>c.url).join(', ') || result.rungs.map(r=>r.target).join(', ')}`;
    const published=await publishAdapterStream({...candidate,reason,request:input.request,check:input.check,runId:`engineer:${result.attemptId}`,now:input.now});
    opened.push(published);done.add(platform);
    const route={stream:{branch:published.branch,readySha:published.readySha,statusSha:published.statusSha,check:published.check.summary}};
    await writeFieldManual(input.repos,[newFieldManualEntry('engineer-adapter',platform,{role:'SHARED',kind:'ENGINEER_ADAPTER_PR',title:platform,platforms:[platform],
      summary:'Adapter implementation in '+published.url,outcome:'REFERENCE',observedAt:input.now,recordClasses:[result.recordClass],url:published.url,
      payload:{platform,...route,subjectId:result.subjectId,sourceAttemptId:result.attemptId,files:candidate.files.map(file=>file.path),
        sourceUrls:[...new Set([...result.candidates.filter(c=>c.evidenceArtifactIds.length>0).map(c=>c.url),
          ...result.rungs.filter(r=>r.ok && r.artifactIds.length>0).map(r=>r.target)])]}})],input.now);
    } catch(error) {
      await writeFieldManual(input.repos,[newFieldManualEntry('engineer-adapter-blocker',platform,{role:'ENGINEER',kind:'ENGINEER_BLOCKER',title:platform,platforms:[platform],
        summary:error instanceof Error?error.message:String(error),outcome:'BLOCKED',observedAt:input.now,payload:{sourceAttemptId:result.attemptId,nextAction:`Push stream/adapter-${platform} by fast-forward after the recorded publication failure is repaired.`}})],input.now);
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
