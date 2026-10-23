import {extractLinks} from './page-links.ts';
import {cellText,decodeEntities} from './roster-page.ts';
import type {SitePage} from './site-findings.ts';

const nameKey=(name:string)=>name.normalize('NFKD').toLowerCase().replace(/\b(?:official website|website|visit website)\b/g,'').replace(/^(?:the )?(?:city|town|village|borough) of /,'').replace(/[^a-z0-9]/g,'');
/** A state or national directory's printed government name, with one linked
 * external site. A short place-name guess cannot bind a county to a city. */
export function governmentSiteFromDirectory(name:string,page:SitePage):{url:string;quote:string}|null{
 const expected=nameKey(name),candidates=new Map<string,{url:string;quote:string}>();
 for(const match of page.html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  if(nameKey(cellText(match[2]))!==expected)continue;
  let url:URL;try{url=new URL(decodeEntities(match[1]),page.url);}catch{continue;}
  if(!['http:','https:'].includes(url.protocol) || url.hostname===new URL(page.url).hostname)continue;
  candidates.set(url.href,{url:url.href,quote:cellText(match[0])});
 }
 return candidates.size===1?[...candidates.values()][0]:null;
}
export const directoryLinks=(name:string,page:SitePage)=>extractLinks(page.html,new URL(page.url),Number.MAX_SAFE_INTEGER).filter(l=>/\b(county|counties|municipal|local|directory|offices|cities|districts)\b/i.test(l.text) || nameKey(l.text)===nameKey(name));

/** Follow only links the official directory actually publishes. Its officials
 * belong to the directory's government, so none become the local roster. */
export async function discoverGovernmentSite(input:{name:string;seeds:readonly string[];frontier?:readonly string[];
 read:(url:string)=>Promise<SitePage|null>;canRead:()=>boolean;
 save:(frontier:readonly string[])=>Promise<void>;
 found:(site:{url:string;quote:string},page:SitePage)=>Promise<void>;}){
 const queue=new Set(input.frontier?.length?input.frontier:input.seeds),seen=new Set<string>(),failed:string[]=[];
 const hosts=new Set(input.seeds.map(url=>new URL(url).hostname.toLowerCase().replace(/^www\./,'')));
 while(queue.size && input.canRead()){
  const url=queue.values().next().value!;queue.delete(url);if(seen.has(url))continue;seen.add(url);
  let page:SitePage|null;
  try{page=await input.read(url);}catch(error){if(error instanceof Error && /^HUNT_SOURCE_/.test(error.message)){failed.push(url);await input.save([...queue,...failed]);continue;}await input.save([url,...queue,...failed]);throw error;}
  if(!page){await input.save([url,...queue]);return null;}
  hosts.add(new URL(page.url).hostname.toLowerCase().replace(/^www\./,''));
  const site=governmentSiteFromDirectory(input.name,page);
  if(site){await input.found(site,page);await input.save([]);return site.url;}
  for(const link of directoryLinks(input.name,page)){
   const host=new URL(link.url).hostname.toLowerCase().replace(/^www\./,'');
   if([...hosts].some(own=>host===own || host.endsWith('.'+own)) && !seen.has(link.url))queue.add(link.url);
  }
  await input.save([...queue,...failed]);
 }
 return null;
}
