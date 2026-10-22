import { officeIdentity } from "../../officials/office-identity.ts";
import { officialLegislatureRosterRoutes } from "./roster-routes.ts";
import type { Officeholder, OfficeholderSet, SeatVacancy } from "../../officials/types.ts";
import { nativePersonIdFromUrl, personIdentityKeys } from "../../officials/people-identity.ts";
import { imagesIn, pickPortraits } from "../../hunt/portrait-pick.ts";
import { decodeEntities } from "../http.ts";
import { htmlEvidenceBlocks } from "../html-evidence.ts";
import { pacedPortraitAcquire } from "../../photos/portrait-work.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";
import { statewidePageText } from "../statewide/parse.ts";
import { mergePeopleSets } from "../../officials/merge-people.ts";
import { acquisition, appendRoster, digest, emptyPerson, emptyRoster, gap, legislativeDivision, provenance, record, result, savedRead, sourced, stateIdentity, string, url, type PeopleAcquisitionOptions, type PeopleSourceRelease } from "./common.ts";

const textOf = statewidePageText;
const key = (value:string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
function rosterLabelName(label: string): string {
  const observed=label.replace(/\s*--[\s\S]*$/,"").replace(/^(?:Senator|Sen\.|Representative|Rep\.|Delegate|Assemblyman|Assemblywoman|Hon\.)\s+/i,"").trim();
  const reversed=/,\s*(?:Jr\.?|Sr\.?|II|III|IV)$/i.test(observed)?null:/^([^,]+),\s*([^,]+)$/.exec(observed);
  return reversed?`${reversed[2]} ${reversed[1]}`:observed;
}
export function legislaturePageNamesPerson(html: string, name: string): boolean {
  const content=html.replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1\s*>/gi," ").replace(/<a\b[^>]*\/>/gi,"");
  return key(textOf(content)).includes(key(name)) || [...content.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .some(anchor=>key(rosterLabelName(textOf(anchor[1].replace(/<img\b[^>]*>/gi,""))))===key(name));
}
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
  if(!legislaturePageNamesPerson(html,holder.name)||!roleOnPage(text,holder))return null;
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
  const district = /\bDistrict\s*(?:No\.?\s*)?[:#-]?\s*(\d+[a-z]?)\b/i.exec(text)?.[1]
    ?? /\b(?:title|aria-label)=["']District\s+(\d+[a-z]?)\b/i.exec(html)?.[1];
  const divisionId=known?.divisionId??(district&&holder.chamber?legislativeDivision(options,holder.chamber,district):undefined),membershipId=`${id}:${holder.chamber}:${district??known?.district??""}`;
  result.memberships=[{id:membershipId,personId,officeId:known?.officeId??`official-legislature-office:${state.state}:${officeIdentity(publishedTitle)}:${district??""}`,jurisdiction:state.jurisdiction,
    chamber:holder.chamber,district:district??known?.district,officeTitle:publishedTitle,level:"STATE",current:true,divisionId,sourceUrl}];
  const fields={...source};sourced(result,fields);
  // Exact known division identities are reusable geography, not a new claim by this page.
  if(!district&&known)result.fieldSources={...result.fieldSources,memberships:holder.fieldSources?.memberships??holder.provenance};
  return result;
}
const VACANT=/^(?:vacant|vacancy|seat vacant|vacant seat)\b/i;
const MONTHS=["january","february","march","april","may","june","july","august","september","october","november","december"];
/** The departure date the page states beside the vacancy; any other date on the row is not one. */
function statedDeparture(text:string):string|null {
  const after=/\b(?:resigned|deceased|died|vacated|vacant since|vacancy since|effective)\b[^0-9A-Za-z]{0,3}(?:on\s+)?((\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})|([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4}))/i.exec(text);
  if(!after)return null;
  const [year,month,day]=after[2]?[after[4].length===2?`20${after[4]}`:after[4],Number(after[2]),Number(after[3])]
    :[after[7],MONTHS.findIndex(name=>name.startsWith(after[5].toLowerCase().slice(0,3)))+1,Number(after[6])];
  const iso=`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  return month>0&&!Number.isNaN(Date.parse(`${iso}T00:00:00Z`))&&new Date(`${iso}T00:00:00Z`).toISOString().startsWith(iso)?iso:null;
}
/** A table row's district, read from the column its own header names District. */
function districtColumn(content:string,row:string):string|undefined {
  if(!row.startsWith("<tr"))return undefined;
  const at=content.indexOf(row),table=at<0?-1:content.lastIndexOf("<table",at);
  if(table<0)return undefined;
  const header=/<tr\b[^>]*>((?:(?!<\/tr>)[\s\S])*?<th\b[\s\S]*?)<\/tr>/i.exec(content.slice(table,at))?.[1];
  const labels=header?[...header.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(match=>textOf(match[1])):[];
  const column=labels.findIndex(label=>/^district(?:\s*(?:no\.?|number|#))?$/i.test(label));
  if(column<0)return undefined;
  const cell=[...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match=>textOf(match[1]))[column];
  return cell&&/^(?:district\s*)?\d{1,3}[a-z]?$/i.test(cell)?cell.replace(/^district\s*/i,"").toLowerCase():undefined;
}
/** A bounded roster row or card that names one district and says, in a cell or label of its own, that its seat is vacant. Absence from a roster is never read as a vacancy. */
export function statedVacancies(content:string,headers:string,pageUrl:string,options:PeopleAcquisitionOptions,collectedAt:string,holders:readonly Officeholder[]):SeatVacancy[] {
  const found=new Map<string,SeatVacancy>(),address=new URL(pageUrl);
  const upperPattern=/\b(?:Senators?|Senate)\b/i,lowerPattern=/\b(?:Representatives?|Reps?|Assembly(?:man|woman| Members?)?|Delegates?|House)\b/i;
  for(const block of htmlEvidenceBlocks(content)) {
    const card=block.html,text=textOf(card);
    if(!/^<(?:tr|article|li|p|div)\b/i.test(card)||text.length>400)continue;
    const labels=[...card.matchAll(/<(td|th|a|span|strong|b|em|h[2-6]|div|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(match=>textOf(match[2]));
    if(!VACANT.test(text)&&!labels.some(label=>VACANT.test(label)&&label.length<=60))continue;
    // A container naming a member is not a statement about an empty seat.
    if([...card.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].some(anchor=>{const label=textOf(anchor[2]);return !VACANT.test(label)&&/^[\p{Lu}][\p{L}\p{M}.'’\-]+(?:\s+[\p{L}\p{M}.'’"“”\-]+){1,5}$/u.test(label)&&!/\b(?:district|vacant|vacancy|senate|house|assembly|map|email|contact)\b/i.test(label);}))continue;
    const named=new Set([...text.matchAll(/\bDistrict\s*(?:No\.?\s*)?[:#-]?\s*(\d+[a-z]?)\b/gi)].map(match=>match[1].toLowerCase()));
    const district=named.size===1?[...named][0]:named.size===0?districtColumn(content,card):undefined;
    if(!district)continue;
    // The page's own chamber (its address, table and headings) first; a combined roster names it on the row.
    const page=`${address.hostname.replace(/[.-]/g," ")} ${address.pathname.replace(/[-_/]/g," ")} ${block.ancestors.join(" ").replace(/([a-z])([A-Z])/g,"$1 $2")}`;
    const chamberOf=(value:string)=>upperPattern.test(value)===lowerPattern.test(value)?null:upperPattern.test(value)?"upper":"lower";
    const chamber=chamberOf(page)??chamberOf(headers)??chamberOf(text);
    if(!chamber)continue;
    const ocdId=legislativeDivision(options,chamber,district);
    if(!ocdId||found.has(ocdId))continue;
    const heldBy=[...new Set(holders.filter(holder=>holder.memberships?.some(row=>row.current!==false&&row.divisionId===ocdId)).flatMap(holder=>[...personIdentityKeys(holder)]))];
    found.set(ocdId,{ocdId,sourceUrl:pageUrl,sourceOrg:"State legislature — official member roster",collectedAt,reason:text,since:statedDeparture(text),
      officeTitle:chamber==="upper"?"State Senator":"State Representative",heldBy});
  }
  return [...found.values()];
}
export function normalizeOfficialLegislaturePage(html:string,pageUrl:string,options:PeopleAcquisitionOptions,collectedAt:string):OfficeholderSet {
  const roster=emptyRoster(options.state,options.asOf);
  const held=(options.roster?.officeholders??[]).filter(holder=>holder.level==="STATE"&&["upper","lower","legislature"].includes(holder.chamber??"")&&holder.state?.toLowerCase()===options.state.toLowerCase());
  const own=held.filter(holder=>[holder.websiteUrl,...(holder.profileUrls??[])].some(value=>url(value)===url(pageUrl)));
  for(const holder of own) {const parsed=personOnPage(holder,html,pageUrl,options,collectedAt);if(parsed)roster.officeholders.push(parsed);}
  // A roster's observed links bind its bounded member card to the individual's official page.
  const content=html.replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1\s*>/gi," ");
  const headers=[...content.matchAll(/<(?:h[1-3]|title)\b[^>]*>([\s\S]*?)<\/(?:h[1-3]|title)>/gi)].map(match=>textOf(match[1])).join(" ");
  const upperPattern=/\b(?:Senators?|Senate Members?)\b/i,lowerPattern=/\b(?:Representatives?|Assemblyman|Assemblywoman|Delegates?|House Members?|Assembly Members?)\b/i;
  for(const block of htmlEvidenceBlocks(content)) {
    const card=block.html.replace(/<a\b[^>]*\/>/gi,""),text=textOf(card);
    if(!/^<(?:tr|article|li|p|div)\b/i.test(card))continue;
    // Containers with several named member links cannot bind one member's
    // district, contact or image. Work each bounded child instead.
    const namedAnchors=[...card.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(anchor=>{
      const label=textOf(anchor[2].replace(/<img\b[^>]*>/gi,"")).replace(/\s*--[\s\S]*$/,"").trim();
      return attributes(anchor[1]).href&&!/^(?:view|read|contact|learn|current|all|former|member|state|house|senate|assembly|details|website|email)\b/i.test(label)
        &&/^[\p{L}][\p{L}\p{M}.,'’\-]*(?:\s+["“]?[\p{L}][\p{L}\p{M}.,'’"“”\-]*){1,6}$/u.test(label);
    });
    if(new Set(namedAnchors.map(anchor=>textOf(anchor[2]))).size>1)continue;
    for(const anchor of card.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href=attributes(anchor[1]).href;if(!href)continue;
      let profile:string;try{profile=url(new URL(href,pageUrl).href)!;if(!profile)continue;}catch{continue;}
      if(new URL(profile).hostname!==new URL(pageUrl).hostname&&!isOfficialSource(profile,{url:pageUrl,html}))continue;
      const label=textOf(anchor[2].replace(/<img\b[^>]*>/gi,"")).replace(/\s*--[\s\S]*$/,"").trim();
      const name=rosterLabelName(label),known=held.find(person=>key(person.name)===key(name));
      let holder=known;
      if(!holder) {
        if(!/^[\p{L}][\p{L}\p{M}.,'’\-]*(?:\s+["“]?[\p{L}][\p{L}\p{M}.,'’"“”\-]*){1,6}$/u.test(name)
          ||/\b(?:view|read|contact|learn|current|all|former|member|state|house|senate|senators|representatives|assembly|live|video|text|proposal|listed|of|the|for|and|to)\b/i.test(name))continue;
        const profileUrl=new URL(profile);
        const memberRoute=/\/(?:members?\/[^/?#]+|[^/?#]*-member\/|district\d+|(?:senate|house|assembly)\/(?:\d+\/)?[^/?#]+)/i.test(profileUrl.pathname);
        const districtEvidence=/\bDistrict\s*(?:No\.?\s*)?[:#-]?\s*\d+/i.test(text)||/\/(?:district)\d+\b/i.test(profileUrl.pathname)
          ||/\b(?:title|aria-label)=["']District\s+\d+/i.test(card);
        if(!(memberRoute&&(districtEvidence||upperPattern.test(text)||lowerPattern.test(text)))&&!pickPortraits(name,imagesIn(card,pageUrl)).length)continue;
        const tableContext=block.ancestors.join(" ").replace(/([a-z])([A-Z])/g,"$1 $2"),route=profileUrl.pathname;
        let upper=upperPattern.exec(text),lower=lowerPattern.exec(text);
        if(!upper&&!lower){
          const tableUpper=/\bsenate\b/i.test(tableContext)||/\/senate\//i.test(route),tableLower=/\b(?:house|assembly)\b/i.test(tableContext)||/\/(?:house|assembly)\//i.test(route);
          if(tableUpper!==tableLower){
            upper=tableUpper?upperPattern.exec(textOf(content)):null;lower=tableLower?lowerPattern.exec(textOf(content)):null;
          }else{upper=upperPattern.exec(headers);lower=lowerPattern.exec(headers);}
        }
        if(Boolean(upper)===Boolean(lower))continue;
        const office=(upper??lower)![0].replace(/(?:Senators|Representatives|Delegates|Members)\b/i,value=>value.slice(0,-1));
        holder=emptyPerson(`official-legislature:${stateIdentity(options.state).state.toLowerCase()}:${digest(profile).slice(0,24)}`,name,office,options.state,provenance(pageUrl,"State legislature — official member roster",collectedAt));
        holder.chamber=upper?"upper":"lower";holder.websiteUrl=profile;
      }
      const context=roleOnPage(text,holder)?card:`<h2>${holder.officeTitle}</h2>${card}`;
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
  const vacancies=statedVacancies(content,headers,pageUrl,options,collectedAt,roster.officeholders);
  if(vacancies.length)roster.vacancies=vacancies;
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
  // Each legislature's own roster pages, kept as data, are read with the member pages already held.
  const rosters=officialLegislatureRosterRoutes(stateIdentity(options.state).state).flatMap(value=>url(value)??[]);
  if(!profiles.length&&!rosters.length)gaps.push({sourceUrl:"https://v3.openstates.org/jurisdictions",detail:"OFFICIAL_LEGISLATURE_ROSTER_ROUTE_OWED:No observed official member or roster route is held for this state; source discovery remains standing work."});
  const queue=[...new Set([...rosters,...profiles])],seen=new Set<string>(),linkingPages=[...(options.linkingPages??[])];
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
      const known=mergePeopleSets([...(options.roster?[options.roster]:[]),roster]);
      const redirected=known&&page.finalUrl!==sourceUrl?{...known,officeholders:known.officeholders.map(person=>
        [person.websiteUrl,...person.profileUrls??[]].some(profile=>url(profile)===url(sourceUrl))?
          {...person,profileUrls:[...new Set([...person.profileUrls??[],page.finalUrl])]}:person)}:known;
      const parsed=normalizeOfficialLegislaturePage(html,page.finalUrl,{...options,roster:redirected??undefined},page.retrievedAt);
      appendRoster(roster,parsed);
      for(const observed of legislatureRosterLinks(html,page.finalUrl))if(!seen.has(observed)&&!queue.includes(observed))queue.push(observed);
      for(const holder of parsed.officeholders)if(holder.websiteUrl&&!seen.has(holder.websiteUrl)&&!queue.includes(holder.websiteUrl))queue.push(holder.websiteUrl);
      if(!parsed.officeholders.length&&profiles.includes(sourceUrl))gaps.push({sourceUrl,detail:"OFFICIAL_LEGISLATURE_PERSON_BINDING_OWED:The page did not explicitly bind its held person and office; no member was inferred."});
      else if(!parsed.officeholders.length)gaps.push({sourceUrl,detail:"OFFICIAL_LEGISLATURE_ROSTER_EXTRACTION_OWED:The captured member or roster route did not expose a person and office in the supported visible structures; its saved bytes remain standing extraction work."});
    }catch(error){gap(gaps,options,sourceUrl,error);}
  }
  roster.currentMembershipComplete=false;
  return result(options,roster,acquisitions,gaps);
}
