import type { Page } from 'playwright';
import type { CoverageSummary } from '../../registry/coverage.ts';
import type { Meeting } from '../../sources/types.ts';
import { mergeReaderCoverage,stateCoverageForZip,type ReaderStateResponse } from '../../reader/client.ts';
import { PUBLIC_SITE_ORIGIN } from '../../ops/origins.ts';
import { seedZip } from '../../../scripts/browser.mts';

export interface PublicPlace {
 readonly coverage:CoverageSummary|null;readonly meetings:readonly Meeting[];
 readonly placeStatus:number;readonly stateStatus:number;readonly placeError:string;
 readonly directory:unknown;
}
const held=new WeakMap<Page,{zip:string;reading:Promise<PublicPlace>}>();
const directories=new WeakMap<Page,Map<string,Promise<unknown>>>();
export async function observedDirectory(page:Page,member:string):Promise<unknown>{
 const known=directories.get(page)?.get(member);if(known)return known;
 const response=await page.waitForResponse(r=>{const url=new URL(r.url());return url.pathname==='/api/directory'&&url.searchParams.get('member')===member;},{timeout:5_000}).catch(()=>null);
 return response?.status()===200?response.json().catch(()=>null):null;
}
/** Observe the same parallel state/place responses the arriving page consumes.
 * A place outage must not erase the independently working state package. */
export function readPublicPlace(page:Page,zip:string):Promise<PublicPlace>{
 const cached=held.get(page);if(cached?.zip===zip)return cached.reading;
 if(!directories.has(page)){
  const responses=new Map<string,Promise<unknown>>();directories.set(page,responses);
  page.on('response',response=>{const url=new URL(response.url()),member=url.searchParams.get('member');
   if(url.pathname==='/api/directory'&&member)responses.set(member,response.status()===200?response.json().catch(()=>null):Promise.resolve(null));
  });
 }
 const reading=(async()=>{
  await seedZip(page,zip);
  const response=(path:string)=>page.waitForResponse(r=>{
   const url=new URL(r.url());return url.pathname===path&&url.searchParams.get('zip')===zip;
  },{timeout:15_000}).then(async r=>({status:r.status(),value:await r.json().catch(()=>null)}),()=>({status:0,value:null}));
  const state=response('/api/reader/state'),place=response('/api/meetings');
  const opened=await page.goto(PUBLIC_SITE_ORIGIN,{waitUntil:'domcontentloaded',timeout:15_000});
  if(opened?.status()!==200)throw Error(`The live page returned ${opened?.status()??'no response'}`);
  const [s,p]=await Promise.all([state,place]);
  let stateCoverage:CoverageSummary|null=null;
  if(s.status===200&&s.value?.coverage&&s.value.zipPlaces)stateCoverage=stateCoverageForZip(s.value as ReaderStateResponse,zip);
  return {directory:s.status===200?s.value?.directory??null:null,meetings:p.status===200?p.value?.meetings??[]:[],coverage:mergeReaderCoverage(stateCoverage,p.status===200?p.value?.coverage??null:null,p.status===200?p.value?.meetings?.length??0:0),
   stateStatus:s.status,placeStatus:p.status,placeError:p.status===200?'':`The meetings reader returned ${p.status||'no response'}${p.value?.dataState?` (${p.value.dataState})`:''}.`};
 })();
 held.set(page,{zip,reading});return reading;
}
