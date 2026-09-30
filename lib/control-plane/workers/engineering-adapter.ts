/** Engineer publishes source adapters through review; CI and S10 own merge. */
import { execFile } from 'node:child_process';
import type { ScoutResult } from '../scheduler/scout-result.ts';
import { STREAMLINE_INVENTORY_SOURCE } from './engineering-candidate.ts';

export const ENGINEER_ADAPTER_PREFIX = 'lib/sources/platform-adapters/';
export interface AdapterFile {path:string;content:string}
export interface AdapterPullRequest {url:string;number:number;branch:string}
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
  if(!platform || !input.files.length || input.files.some(file=>!file.path.startsWith(ENGINEER_ADAPTER_PREFIX) || file.path.includes('..') || !/\.(?:ts|mjs)$/.test(file.path))) throw new Error('ENGINEER_ADAPTER_FILES_ONLY');
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

/** Consume needs-an-adapter work from the existing Scout results, saving the route to its PR in the bank. */
export async function workAdapterQueue(input:{repos:import('../repository/types.ts').ControlPlaneRepositories;results:readonly ScoutResult[];
  transport?:import('../scheduler/scout-executor.ts').ModelTransport;now:string;request?:GitHubRequest}):Promise<AdapterPullRequest[]> {
  const {readFieldManual,writeFieldManual,newFieldManualEntry}=await import('../field-manual.ts');
  const manual=await readFieldManual(input.repos,{role:'ENGINEER'});
  const opened:AdapterPullRequest[]=[];
  const done=new Set(manual.store.entries.filter(e=>e.kind==='ENGINEER_ADAPTER_PR').map(e=>e.title));
  const pending=input.results.filter(r=>r.outcome==='NEEDS_ADAPTER' && r.refusal===null);
  for(const result of pending) {
    const platform=adapterBranchKey(result.candidates[0]?.routeId ?? result.recordClass);
    if(done.has(platform))continue;
    try {
    let candidate=plainAdapterFor(result);
    if(!candidate && input.transport) {
      const {MODELS}=await import('../../models.ts');
      const response=await input.transport({model:MODELS.haiku.model,max_tokens:8000,
        system:[{type:'text',text:'You are the Engineer. Implement a reusable platform adapter from the saved investigation. Return JSON {platform,files:[{path,content}]}. All files must be .ts or .mjs under lib/sources/platform-adapters/. Include colocated behavioral tests. No evidence, receipts, fixtures, shell commands, credentials, deployment or database changes. An adapter exports extract({text,sourceUrl}) returning field/value/exactQuote/sourceUrl facts. Preserve the input source and exact quotes. Solve the platform class, never special-case one government. No network inside extraction. Prefer existing plain code and held methods. If source evidence is insufficient return {platform,files:[]}.'}],
        messages:[{role:'user',content:JSON.stringify({platform,investigation:{narrative:result.narrative,routes:result.candidates,facts:result.findings,tried:result.rungs,next:result.nextRungs},knowledge:manual.projection.lines})}],tools:[],tool_choice:{type:'auto'}});
      const text=response.content.filter(block=>block.type==='text').map(block=>(block as {text:string}).text).join('');
      try {candidate=JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{candidate=null;}
    }
    if(!candidate?.files?.length)continue;
    const pr=await publishAdapterPullRequest({...candidate,request:input.request,
      reason:`Recover ${result.recordClass} acquisition using a reusable ${candidate.platform} adapter.\n\nWhat failed: ${result.narrative}\nSource routes: ${result.candidates.map(c=>c.url).join(', ') || result.rungs.map(r=>r.target).join(', ')}`});
    opened.push(pr);done.add(platform);
    await writeFieldManual(input.repos,[newFieldManualEntry('engineer-adapter',platform,{role:'SHARED',kind:'ENGINEER_ADAPTER_PR',title:platform,
      summary:'Adapter implementation in '+pr.url,outcome:'REFERENCE',observedAt:input.now,recordClasses:[result.recordClass],url:pr.url,
      payload:{platform,pr,subjectId:result.subjectId,sourceAttemptId:result.attemptId,files:candidate.files.map(file=>file.path)}})],input.now);
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
