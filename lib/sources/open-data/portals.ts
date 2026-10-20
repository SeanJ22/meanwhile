import { acquireKnownRelease } from "../known-release.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";
import type { RegistrationGovernmentListing } from "../../registration/listings.ts";
import type { GovernmentJoin, PortalBinding } from "./normalize.ts";
import { openDataFetch } from "./acquire.ts";
import { runBoundedWorkPool } from "../../ops/bounded-work-pool.ts";
export const STATE_DIRECTORY_URL="https://www.usa.gov/state-governments";
export interface PortalDomainIndex { has(domain: string): boolean; withinHost(host: string): Iterable<string> }
type PortalDomains = ReadonlySet<string> | PortalDomainIndex;
/** USA.gov publishes postal IDs on its directory anchors, followed by the state's own government link. */
export function stateDirectoryPage(html:string, postal:string):string|null {
  for(const match of html.matchAll(/<a\b([^>]+)>[\s\S]*?<\/a>/gi)) {
    if(new RegExp(`\\bid=["']${postal}["']`,"i").test(match[1])) {
      const href=/\bhref=["']([^"']+)["']/i.exec(match[1])?.[1];return href?new URL(href,STATE_DIRECTORY_URL).href:null;
    }
  }
  return null;
}
export function stateGovernmentWebsite(html:string):string|null {
  const section=/<h[1-6]\b[^>]*>\s*(?:State|District|Territory) government(?: website)?\s*<\/h[1-6]>([\s\S]*?)(?=<h[1-6]\b|$)/i.exec(html)?.[1];
  return section?/\bhref=["'](https:\/\/[^"']+)["']/i.exec(section)?.[1] ?? null:null;
}
export async function readStateGovernmentWebsite(postal:string,signal:AbortSignal):Promise<string|null> {
  const acquire=async(url:string)=>acquireKnownRelease({sourceId:"socrata-state-links",releaseId:url,url,parserVersion:"src-so/1",maxBytes:4*1024*1024,
    checkAfterMs:86400000,signal,fetchImpl:(url,init)=>openDataFetch(url,init),allowedHosts:["www.usa.gov","usa.gov"],headers:{accept:"text/html"}});
  const directory=await acquire(STATE_DIRECTORY_URL);
  const url=stateDirectoryPage(new TextDecoder().decode(directory.bytes),postal);if(!url)return null;
  const page=await acquire(url);return stateGovernmentWebsite(new TextDecoder().decode(page.bytes));
}

/** Read the government's own published link; names and guessed host/state abbreviations never join. */
export function portalBindingsFromPage(government:RegistrationGovernmentListing, url:string, html:string, domains:PortalDomains):PortalBinding[] {
  if (!isOfficialSource(url)) return [];
  const linked=new Map<string,string>();
  // A publisher's .gov DNS namespace is its native portal identity, including its subdomains.
  const governmentHost=new URL(url).hostname.replace(/^www\./,"");
  if(governmentHost.endsWith(".gov"))for(const domain of "withinHost" in domains ? domains.withinHost(governmentHost) : domains)
    if(domain===governmentHost || domain.endsWith(`.${governmentHost}`))linked.set(domain,"");
  for (const match of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try { const href=new URL(match[1].replaceAll("&amp;","&"),url); if(domains.has(href.hostname) && isOfficialSource(href.href,{url,html})) linked.set(href.hostname,match[0]); } catch { /* Not a public URL. */ }
  }
  if (domains.has(new URL(url).hostname)) linked.set(new URL(url).hostname,"");
  return [...linked].flatMap(([domain,linkingHtml])=>government.associations.map(association=>({domain,divisionId:association.divisionId,
    bodyIds:government.bodyIds,nativeIds:{...government.nativeIds,ocd_id:association.divisionId,geoid:association.geoid},
    official:true,linkingUrl:url,linkingHtml})));
}
export async function discoverGovernmentPortals(governments:readonly RegistrationGovernmentListing[], domains:PortalDomains, signal:AbortSignal) {
  const results=await runBoundedWorkPool(governments.filter(g=>g.website && g.associations.length && isOfficialSource(g.website)),16,async government=>{
    try {
      const url=new URL(government.website!);if(url.protocol==="http:")url.protocol="https:";
      const page=await acquireKnownRelease({sourceId:"socrata-government-links",releaseId:government.id,url:url.href,
        parserVersion:"src-so/1",maxBytes:4*1024*1024,checkAfterMs:86400000,signal,
        fetchImpl:(url,init)=>openDataFetch(url,init),headers:{accept:"text/html"}});
      return {bindings:portalBindingsFromPage(government,page.finalUrl,new TextDecoder().decode(page.bytes),domains),gap:null};
    } catch(error) { return {bindings:[],gap:{governmentId:government.id,url:government.website,reason:error instanceof Error?error.message:String(error)}}; }
  });
  return {bindings:results.flatMap(r=>r.value?.bindings ?? []),gaps:results.flatMap(r=>r.value?.gap?[r.value.gap]:[])};
}
export function governmentJoinRows(governments:readonly RegistrationGovernmentListing[]):GovernmentJoin[] {
  return governments.flatMap(g=>g.associations.map(a=>({divisionId:a.divisionId,bodyIds:g.bodyIds,
    nativeIds:{...g.nativeIds,ocd_id:a.divisionId,geoid:a.geoid,...(a.layer==="county"?{county_fips:a.geoid}:{}),...(a.layer==="place"?{place_fips:a.geoid}:{})}})));
}
