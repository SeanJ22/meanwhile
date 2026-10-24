import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {platformFetch} from '../lib/doors/platform-http.ts';
import {pageLinks} from '../lib/hunt/meetings-site-discovery.ts';
import {samePlatformTenant,type PlatformTenant} from '../lib/control-plane/discovery/platform-enumeration.ts';
import {matchRegisteredPlatformTenant,type PlatformRegistrationPage} from '../lib/control-plane/discovery/platform-registration.ts';
import {registeredPlatformTenant} from '../lib/control-plane/discovery/platform-catalog.ts';
import {DEFAULT_USER_AGENT} from '../lib/control-plane/scheduler/route-executor.ts';

const directory=process.argv[2] ?? '.scratch/rb-a4';
const out='docs/measurements/rb-a4/portals.json';
const input=JSON.parse(readFileSync(`${directory}/portals.json`,'utf8')) as {government_id:string;website:string|null;portal:string|null;state:string;boards:{doorId:string;bodyId:string;name:string}[]}[];
const pg=new PGlite();
await pg.exec('CREATE TABLE civic_data_promotions(key text,record_class text,scope text,current_version_id text,promoted_at timestamptz,payload jsonb); CREATE TABLE civic_data_candidates(id text PRIMARY KEY,normalized_hash text)');
const pages=JSON.parse(readFileSync(`${directory}/portal-governments.json`,'utf8')) as PlatformRegistrationPage[];
for(const state of [...new Set(pages.map(page=>page.government.state))]) {
  const selected=pages.filter(page=>page.government.state===state),first=selected[0]!;
  await pg.query('INSERT INTO civic_data_candidates VALUES($1,$2) ON CONFLICT DO NOTHING',[first.versionId,first.readModelHash]);
  await pg.query('INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4,$5,$6::jsonb)',[`REGISTRATION:US-${state}:registration:v1`,'REGISTRATION',`US-${state}:registration:v1`,first.versionId,first.promotedAt,JSON.stringify({governments:selected.map(page=>page.government)})]);
}
const query=async(text:string,parameters:readonly unknown[]) => (await pg.query<Record<string,unknown>>(text,[...parameters])).rows;
const saved=new Map<string,Promise<{url:string;body:string;status:number;contentType:string|null;hash:string}>>();
const requests=new Map<string,number>();
mkdirSync(`${directory}/portal-sources`,{recursive:true});
const sourceIndex:Record<string,{url:string;status:number;hash:string;contentType:string|null}>={};
if(existsSync(out)) for(const row of JSON.parse(readFileSync(out,'utf8')).results) for(const source of row.sources ?? []) {
  if(source.sha256 && existsSync(`${directory}/portal-sources/${source.sha256}`)) sourceIndex[source.url]={url:source.url,status:source.status,hash:source.sha256,contentType:'text/html'};
}
if(existsSync(`${directory}/portal-read-index.json`)) Object.assign(sourceIndex,JSON.parse(readFileSync(`${directory}/portal-read-index.json`,'utf8')));
for(const [url,source] of Object.entries(sourceIndex)) {
  saved.set(url,Promise.resolve({...source,body:readFileSync(`${directory}/portal-sources/${source.hash}`,'utf8')}));
  const host=new URL(url).hostname;requests.set(host,(requests.get(host)??0)+1);
}
async function read(first:string) {
  if(saved.has(first)) return saved.get(first)!;
  const work=(async()=>{
    let url=first;
    for(let hop=0;hop<7;hop++) {
      const host=new URL(url).hostname;
      if((requests.get(host)??0)>=10) return {url,body:'',status:0,contentType:null,hash:''};
      requests.set(host,(requests.get(host)??0)+1);
      let response:Response;
      try {response=await platformFetch(url,{headers:{'user-agent':DEFAULT_USER_AGENT},signal:AbortSignal.timeout(12_000)});}
      catch {return {url,body:'',status:0,contentType:null,hash:''};}
      const location=response.headers.get('location');
      if(response.status>=300 && response.status<400 && location) {url=new URL(location,url).href;continue;}
      const body=await response.text(),hash=createHash('sha256').update(body).digest('hex');
      writeFileSync(`${directory}/portal-sources/${hash}`,body);
      sourceIndex[first]={url,status:response.status,hash,contentType:response.headers.get('content-type')};
      writeFileSync(`${directory}/portal-read-index.json`,JSON.stringify(sourceIndex));
      return {url,body,status:response.status,contentType:response.headers.get('content-type'),hash};
    }
    return {url,body:'',status:0,contentType:null,hash:''};
  })();saved.set(first,work);return work;
}
const runtime={now:()=>new Date().toISOString(),spaceOut:async()=>{},budget:{spent:()=>false},
  open:async(input:{url:string})=>{const page=await read(input.url);return {status:page.status,body:page.body,bytes:Buffer.byteLength(page.body),contentType:page.contentType ?? '',location:null,transportError:page.status?null:'Source read failed'};},
  vault:async()=>({stored:true,where:'local source copy',why:'saved'})};
const own=new Map<string,Promise<{links:string[];sources:{url:string;status:number;sha256:string}[]}>>();
async function ownLinks(website:string) {
  if(own.has(website)) return own.get(website)!;
  const work=(async()=>{
    const start=new URL(/^https?:/.test(website)?website:`https://${website}`);start.protocol='https:';
    const home=await read(start.href),links=home.status===200?[...pageLinks(home.body,home.url)]:[];
    const sources=[{url:home.url,status:home.status,sha256:home.hash}];
    const local=links.filter(link=>{try{const u=new URL(link);return u.origin===new URL(home.url).origin
      && !/\.(?:js|css|svg|png|jpe?g|gif|woff2?|ico|pdf|zip)$/i.test(u.pathname)
      && /agenda|meeting|board|council|commission|calendar|about/i.test(u.pathname);}catch{return false;}})
      .sort((a,b)=>Number(!/board|agenda|meeting|council/i.test(new URL(a).pathname))-Number(!/board|agenda|meeting|council/i.test(new URL(b).pathname)));
    for(const link of [...new Set(local)].slice(0,3)) {
      const page=await read(link);sources.push({url:page.url,status:page.status,sha256:page.hash});
      if(page.status===200) links.push(...pageLinks(page.body,page.url));
    }
    return {links,sources};
  })();own.set(website,work);return work;
}
async function verify(tenant:PlatformTenant,website:string,governmentId?:string) {
  const page=await ownLinks(website);
  const links=page.links.filter(link=>samePlatformTenant(link,tenant.url));
  if(samePlatformTenant(website,tenant.url)) links.push(website);
  const matches=await matchRegisteredPlatformTenant(query,{...tenant,name:null,state:null},links.map(portalUrl=>({governmentWebsite:website,portalUrl})),governmentId);
  return {matches,sources:page.sources,links};
}
let index=0;
const results:unknown[]=[];
await Promise.all(Array.from({length:16},async()=>{
  while(index<input.length) {
    const row=input[index++]!;
    const {boards,...identity}=row,publicRow={...identity,boardCount:boards.length};
    if(!row.portal){results.push({...publicRow,action:'WITHDRAW',reason:'No published portal URL',destination:null});continue;}
    const tenant:PlatformTenant={platform:'platform',url:row.portal,name:null,state:row.state?.toUpperCase()??null,source:'production door'};
    const sources:unknown[]=[];
    let matches:PlatformRegistrationPage[]=[];
    try {
      if(row.website) {const checked=await verify(tenant,row.website,row.government_id);sources.push(...checked.sources);matches=checked.matches;}
      if(!matches.length) {
        const candidates=await registeredPlatformTenant(query,{...tenant,state:null},runtime);
        for(const candidate of candidates) if(candidate.government.website && candidate.government.website!==row.website) {
          const checked=await verify(tenant,candidate.government.website,candidate.government.id);sources.push(...checked.sources);matches.push(...checked.matches);
        }
      }
      matches=[...new Map(matches.map(m=>[m.government.id,m])).values()];
      const target=matches.length===1?matches[0]!.government:null;
      const readable=(sources[0] as {status:number}|undefined)?.status===200;
      const action=target?(target.jurisdictionId===row.government_id || target.id===row.government_id?'KEEP':'MOVE'):readable?'WITHDRAW':'RETRY';
      results.push({...publicRow,action,destination:target?{id:target.id,jurisdictionId:target.jurisdictionId,state:target.state,name:target.name,website:target.website}:null,
        reason:target?'The government site links this exact tenant':readable?'The checked sources did not confirm a unique government-to-portal link':'The own site could not be read; preserve the last verified publication and retry',sources});
    } catch(error) {results.push({...publicRow,action:'RETRY',destination:null,reason:error instanceof Error?error.message:String(error),sources});}
    if(results.length%25===0) console.log(`${results.length}/${input.length}`);
  }
}));
results.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
mkdirSync('docs/measurements/rb-a4',{recursive:true});
writeFileSync(out,JSON.stringify({observedAt:new Date().toISOString(),productionRole:'readonly',productionWrites:0,
  scope:'Every OPEN platform-census portal/government pair in the production door registry. WITHDRAW means unconfirmed in the checked sources, not a proved wrong owner.',
  sources:'Exact public source bytes are saved in ignored .scratch/rb-a4/portal-sources by SHA-256.',pairs:input.length,doors:input.reduce((n,p)=>n+p.boards.length,0),results},null,2)+'\n');
console.log(JSON.stringify({pairs:input.length,actions:results.reduce<Record<string,number>>((counts,row)=>{const key=(row as {action:string}).action;counts[key]=(counts[key]??0)+1;return counts;},{})}));
await pg.close();
