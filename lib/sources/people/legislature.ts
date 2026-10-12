import type { Officeholder, OfficeholderSet } from "../../officials/types.ts";
import { nativePersonIdFromUrl } from "../../officials/people-identity.ts";
import { imagesIn, pickPortraits } from "../../hunt/portrait-pick.ts";
import { decodeEntities } from "../http.ts";
import { pacedPortraitAcquire } from "../../photos/portrait-work.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";
import { statewidePageText } from "../statewide/parse.ts";
import { mergePeopleSets } from "../../officials/merge-people.ts";
import { acquisition, appendRoster, digest, emptyPerson, emptyRoster, gap, legislativeDivision, provenance, record, result, savedRead, sourced, stateIdentity, string, url, type PeopleAcquisitionOptions, type PeopleSourceRelease } from "./common.ts";

const textOf = statewidePageText;
const key = (value:string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const governmentRoute = (value:unknown):value is string => {
  const observed=url(value);if(!observed)return false;
  const host=new URL(observed).hostname;
  return /(?:^|\.)gov$/i.test(host)||/\.state\.[a-z]{2}\.us$/i.test(host);
};
function attributes(tag:string):Record<string,string> {return Object.fromEntries([...tag.matchAll(/\b([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map(match=>[match[1].toLowerCase(),decodeEntities(match[2]??match[3])]));}
export function legislatureRosterLinks(html:string, pageUrl:string):string[] {
  const host = new URL(pageUrl).hostname, links:string[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attributes(match[1]).href; if (!href) continue;
    let observed:URL; try {observed=new URL(href,pageUrl);}catch{continue;}
    if (!isOfficialSource(observed.href,{url:pageUrl,html})&&observed.hostname!==host || !["https:","http:"].includes(observed.protocol)) continue;
    if (!/\b(?:members?|legislators?|roster|legislative directory|senators?|representatives?)\b/i.test(`${textOf(match[2])} ${observed.pathname.replace(/[-_/]/g," ")}`)) continue;
    observed.hash=""; links.push(observed.href);
  }
  return [...new Set(links)];
}
function roleOnPage(text:string, holder:Officeholder):boolean {
  const normalized=key(text), title=key(holder.officeTitle);
  return normalized.includes(title) || holder.chamber==="upper" && /\b(?:senator|senate member)\b/.test(normalized)
    || holder.chamber==="lower" && /\b(?:representative|assemblyman|assemblywoman|assembly member|delegate|house member)\b/.test(normalized);
}
function phone(html:string):string|null {
  for(const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {const href=attributes(match[1]).href;if(href?.startsWith("tel:"))return textOf(match[2])||decodeURIComponent(href.slice(4));}
  return /(?:\(?\d{3}\)?[\s.-]+)\d{3}[\s.-]+\d{4}/.exec(textOf(html))?.[0]??null;
}
function personOnPage(holder:Officeholder,html:string,sourceUrl:string,options:PeopleAcquisitionOptions,collectedAt:string):Officeholder|null {
  const text=textOf(html), normalized=key(text);
  if(!normalized.includes(key(holder.name))||!roleOnPage(text,holder))return null;
  const nameIndex=text.toLowerCase().indexOf(holder.name.toLowerCase());
  const excerpt=nameIndex>=0?text.slice(Math.max(0,nameIndex-160),nameIndex+holder.name.length+160):text;
  const state=stateIdentity(options.state),personId=`official-legislature:${digest(sourceUrl).slice(0,24)}`,id=`official-legislature:${state.state.toLowerCase()}:${digest(sourceUrl).slice(0,24)}`,source=provenance(sourceUrl,"State legislature — official member page",collectedAt,excerpt);
  source.kind="OFFICIAL";
  const publishedTitle=normalized.includes(key(holder.officeTitle).replace(/^state /,""))?holder.officeTitle:
    holder.chamber==="upper"?/\b(?:Senator|Senate Member)\b/i.exec(text)?.[0]:/\b(?:Representative|Assemblyman|Assemblywoman|Assembly Member|Delegate|House Member)\b/i.exec(text)?.[0];
  if(!publishedTitle)return null;
  const result=emptyPerson(id,holder.name,publishedTitle,options.state,source);
  result.personId=personId;result.chamber=holder.chamber; result.nativeIds={...holder.nativeIds,"official-legislature":[sourceUrl]}; result.websiteUrl=sourceUrl;
  const native=nativePersonIdFromUrl(sourceUrl);if(native)result.nativeIds={...result.nativeIds,[native.source]:[...new Set([...(result.nativeIds[native.source]??[]),native.id])]};
  result.phone=phone(html); result.email=/href=["']mailto:([^"'?]+)/i.exec(html)?.[1]??null;
  const images=pickPortraits(holder.name,imagesIn(html,sourceUrl));if(images[0])result.portraitCandidate={imageUrl:images[0].src,sourceUrl,collectedAt};
  const known=holder.memberships?.find(membership=>membership.current!==false&&["upper","lower"].includes(membership.chamber??""));
  const district = /\bDistrict\s*(?:No\.?\s*)?[:#-]?\s*(\d+[a-z]?)\b/i.exec(text)?.[1];
  const divisionId=known?.divisionId??(district&&holder.chamber?legislativeDivision(options,holder.chamber,district):undefined),membershipId=`${id}:${holder.chamber}:${district??known?.district??""}`;
  result.memberships=[{id:membershipId,personId,officeId:known?.officeId??`official-legislature-office:${state.state}:${holder.chamber}:${district??""}`,jurisdiction:state.jurisdiction,
    chamber:holder.chamber,district:district??known?.district,officeTitle:publishedTitle,level:"STATE",current:true,divisionId,sourceUrl}];
  const fields={...source};sourced(result,fields);
  // Exact known division identities are reusable geography, not a new claim by this page.
  if(!district&&known)result.fieldSources={...result.fieldSources,memberships:holder.fieldSources?.memberships??holder.provenance};
  return result;
}
/** Member pages already observed in nationally held records seed each legislature reader. */
export function normalizeOfficialLegislaturePage(html:string,pageUrl:string,options:PeopleAcquisitionOptions,collectedAt:string):OfficeholderSet {
  const roster=emptyRoster(options.state,options.asOf);
  const held=(options.roster?.officeholders??[]).filter(holder=>holder.level==="STATE"&&["upper","lower","legislature"].includes(holder.chamber??"")&&holder.state?.toLowerCase()===options.state.toLowerCase());
  const own=held.filter(holder=>[holder.websiteUrl,...(holder.profileUrls??[])].some(value=>url(value)===url(pageUrl)));
  for(const holder of own) {const parsed=personOnPage(holder,html,pageUrl,options,collectedAt);if(parsed)roster.officeholders.push(parsed);}
  // A roster's observed links bind its bounded member card to the individual's official page.
  const headers=[...html.matchAll(/<(?:h[1-3]|title)\b[^>]*>([\s\S]*?)<\/(?:h[1-3]|title)>/gi)].map(match=>textOf(match[1])).join(" ");
  const cards=[...html.matchAll(/<(?:tr|article|li)\b[^>]*>([\s\S]*?)<\/(?:tr|article|li)>/gi),...html.matchAll(/<div\b[^>]*class=["'][^"']*(?:member|legislator|roster|profile|card)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
  for(const match of cards) {
    const card=match[1],text=textOf(card);
    for(const anchor of card.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href=attributes(anchor[1]).href;if(!href)continue;
      let profile:string;try{profile=url(new URL(href,pageUrl).href)!;if(!profile)continue;}catch{continue;}
      if(new URL(profile).hostname!==new URL(pageUrl).hostname)continue;
      const name=textOf(anchor[2]).replace(/^(?:Senator|Sen\.|Representative|Rep\.|Delegate|Assemblyman|Assemblywoman|Hon\.)\s+/i,""),known=held.find(person=>key(person.name)===key(name));
      let holder=known;
      if(!holder) {
        if(!/^[\p{L}][\p{L}\p{M}.'’\-]*(?:\s+[\p{L}][\p{L}\p{M}.'’\-]*){1,6}$/u.test(name)||/^(?:view|read|contact|learn|current|all|former|member|state|house|senate|assembly)\b/i.test(name))continue;
        const upperPattern=/\b(?:Senator|Senators|Senate)\b/i,lowerPattern=/\b(?:Representative|Representatives|Assemblyman|Assemblywoman|Delegate|Delegates|House Members?|Assembly)\b/i;
        let upper=upperPattern.exec(text),lower=lowerPattern.exec(text);if(!upper&&!lower){upper=upperPattern.exec(headers);lower=lowerPattern.exec(headers);}
        if(Boolean(upper)===Boolean(lower))continue;
        const office=(upper??lower)![0].replace(/(?:Senators|Representatives|Delegates|Members)\b/i,value=>value.slice(0,-1));
        holder=emptyPerson(`official-legislature:${stateIdentity(options.state).state.toLowerCase()}:${digest(profile).slice(0,24)}`,name,office,options.state,provenance(pageUrl,"State legislature — official member roster",collectedAt));
        holder.chamber=upper?"upper":"lower";holder.websiteUrl=profile;
      }
      const context=roleOnPage(text,holder)?card:`<h2>${headers}</h2>${card}`;
      if(!roleOnPage(textOf(context),holder))continue;
      const parsed=personOnPage(holder,context,profile,options,collectedAt);if(!parsed)continue;
      // Contacts on the roster cite the roster; the member URL remains the observed profile route.
      parsed.provenance=provenance(pageUrl,"State legislature — official member roster",collectedAt,text);parsed.provenance.kind="OFFICIAL";sourced(parsed,parsed.provenance);
      if(!roster.officeholders.some(row=>row.id===parsed.id))roster.officeholders.push(parsed);
    }
  }
  // Schema.org Person data is another source-native roster, including new members absent from held aggregators.
  for(const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let payload:unknown;try{payload=JSON.parse(script[1]);}catch{continue;}
    const visit=(value:unknown):void=>{
      if(Array.isArray(value)){value.forEach(visit);return;}const row=record(value);
      if(row["@type"]==="Person"&&string(row.name)&&string(row.jobTitle)) {
        const title=string(row.jobTitle)!,chamber=/senat/i.test(title)?"upper":/representative|assembly|delegate|house member/i.test(title)?"lower":null;
        const profile=url(row.url);if(chamber&&profile&&new URL(profile).hostname===new URL(pageUrl).hostname) {
          const seed=emptyPerson(`official-legislature:${stateIdentity(options.state).state.toLowerCase()}:${digest(profile).slice(0,24)}`,string(row.name)!,title,options.state,provenance(pageUrl,"State legislature — published Person data",collectedAt));
          seed.chamber=chamber;seed.websiteUrl=profile;const parsed=personOnPage(seed,html,profile,options,collectedAt);
          if(parsed&&!roster.officeholders.some(holder=>holder.id===parsed.id)){parsed.phone=string(row.telephone)??parsed.phone;parsed.email=string(row.email)??parsed.email;parsed.provenance=provenance(pageUrl,"State legislature — published Person data",collectedAt,textOf(html));parsed.provenance.kind="OFFICIAL";sourced(parsed,parsed.provenance);roster.officeholders.push(parsed);}
        }
      }
      for(const [field,child]of Object.entries(row))if(field!=="@context"&&child&&typeof child==="object")visit(child);
    };visit(payload);
  }
  for(const holder of roster.officeholders) {
    for(const membership of holder.memberships??[])if(membership.divisionId)roster.divisions.push({officeholderId:holder.id,membershipId:membership.id,ocdId:membership.divisionId,bodyId:null});
    if(!roster.divisions.some(row=>row.officeholderId===holder.id))roster.unmatched.push({officeholderId:holder.id,reason:"OFFICIAL_LEGISLATURE_DISTRICT_UNRESOLVED"});
  }
  return roster;
}
export async function acquireLegislatureRosters(input:PeopleAcquisitionOptions):Promise<PeopleSourceRelease> {
  const options={...input,acquire:input.acquire??pacedPortraitAcquire},acquisitions=[],gaps:{sourceUrl:string;detail:string}[]=[],roster=emptyRoster(options.state,options.asOf);
  const held=(options.roster?.officeholders??[]).filter(holder=>holder.level==="STATE"&&["upper","lower","legislature"].includes(holder.chamber??"")&&holder.state?.toLowerCase()===options.state.toLowerCase());
  const profiles=[...new Set(held.flatMap(holder=>[holder.websiteUrl,...(holder.profileUrls??[])]).filter(governmentRoute).map(value=>url(value)!))];
  if(!profiles.length)gaps.push({sourceUrl:"https://v3.openstates.org/jurisdictions",detail:"OFFICIAL_LEGISLATURE_ROSTER_ROUTE_OWED:No observed official member or roster route is held for this state; source discovery remains standing work."});
  const queue=[...profiles],seen=new Set<string>(),linkingPages=[...(options.linkingPages??[])];
  // Official state pages already held for other officers can establish their legislature's vendor or .us route.
  const stateLinks=[...new Set((options.roster?.officeholders??[]).filter(holder=>holder.state?.toLowerCase()===options.state.toLowerCase()&&holder.level==="STATE")
    .flatMap(holder=>[holder.websiteUrl,...(holder.profileUrls??[])]).filter((value):value is string=>Boolean(value&&isOfficialSource(value))))];
  if(profiles.some(profile=>!isOfficialSource(profile)))for(const sourceUrl of stateLinks) {
    if(profiles.includes(sourceUrl))continue;
    try{const page=await savedRead(options,sourceUrl,`official-linking-page:${digest(sourceUrl).slice(0,24)}`),capture=acquisition(page);acquisitions.push(capture);linkingPages.push({url:page.finalUrl,html:capture.body});
      for(const observed of legislatureRosterLinks(capture.body,page.finalUrl))if(!queue.includes(observed))queue.push(observed);
    }catch(error){gap(gaps,options,sourceUrl,error);}
  }
  for(const page of linkingPages)if(!acquisitions.some(row=>row.finalUrl===page.url)) {
    try{const saved=await savedRead(options,page.url,`official-linking-page:${digest(page.url).slice(0,24)}`);acquisitions.push(acquisition(saved));}
    catch(error){gap(gaps,options,page.url,error);}
  }
  for(let index=0;index<queue.length;index++) {
    const sourceUrl=queue[index];if(seen.has(sourceUrl))continue;seen.add(sourceUrl);
    try {
      const page=await savedRead(options,sourceUrl,`legislature-page:${digest(sourceUrl).slice(0,24)}`);acquisitions.push(acquisition(page));
      const html=acquisition(page).body,linkingPage=linkingPages.find(link=>isOfficialSource(page.finalUrl,link));
      if(!isOfficialSource(page.finalUrl,linkingPage)){gaps.push({sourceUrl:page.finalUrl,detail:"OFFICIAL_LEGISLATURE_AUTHORITY_LINK_OWED:The observed member site is not .gov and no saved official government page links to its host; its facts remain leads."});continue;}
      linkingPages.push({url:page.finalUrl,html,linkingPage});
      const parsed=normalizeOfficialLegislaturePage(html,page.finalUrl,{...options,roster:mergePeopleSets([...(options.roster?[options.roster]:[]),roster])??undefined},page.retrievedAt);
      appendRoster(roster,parsed);
      if(parsed.officeholders.length)await options.onPerson?.(result(options,roster,acquisitions,gaps));
      for(const observed of legislatureRosterLinks(html,page.finalUrl))if(!seen.has(observed)&&!queue.includes(observed))queue.push(observed);
      for(const holder of parsed.officeholders)if(holder.websiteUrl&&!seen.has(holder.websiteUrl)&&!queue.includes(holder.websiteUrl))queue.push(holder.websiteUrl);
      if(!parsed.officeholders.length&&profiles.includes(sourceUrl))gaps.push({sourceUrl,detail:"OFFICIAL_LEGISLATURE_PERSON_BINDING_OWED:The page did not explicitly bind its held person and office; no member was inferred."});
      else if(!parsed.officeholders.length)gaps.push({sourceUrl,detail:"OFFICIAL_LEGISLATURE_ROSTER_EXTRACTION_OWED:The captured member or roster route did not expose a person and office in the supported visible structures; its saved bytes remain standing extraction work."});
    }catch(error){gap(gaps,options,sourceUrl,error);}
  }
  roster.currentMembershipComplete=false;
  return result(options,roster,acquisitions,gaps);
}
