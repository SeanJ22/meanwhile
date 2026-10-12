import { createHash } from "node:crypto";
import type { Officeholder, OfficeholderSet, PortraitCandidate } from "../../officials/types.ts";
import type { Provenance } from "../types.ts";
import { isOfficialSource, type OfficialLinkingPage } from "../../civic-data/source-authority.ts";
import { imagesIn, pickPortraits } from "../../hunt/portrait-pick.ts";
import { decodeEntities } from "../http.ts";
import { htmlEvidenceBlocks } from "../html-evidence.ts";
import { STATEWIDE_JURISDICTIONS, statewideJurisdiction, type StatewideReferenceSource } from "./reference.ts";

export interface StatewideLead {
  readonly sourceId:string;
  readonly sourceOrg:string;
  readonly sourceUrl:string;
  readonly collectedAt:string;
  readonly state:string;
  readonly name:string;
  readonly officeTitle:string;
  readonly profileUrls:readonly string[];
  readonly nativeIds?:Readonly<Record<string,readonly string[]>>;
  readonly nativeIdSources?:Readonly<Record<string,Provenance>>;
  readonly portraitCandidate?:PortraitCandidate;
  readonly termStart?:string;
  readonly termEnd?:string;
  readonly termSources?:Readonly<Record<string,Provenance>>;
  readonly evidenceExcerpt?:string;
}
export interface StatewideGap { readonly sourceUrl:string; readonly detail:string }
const words = (s:string) => decodeEntities(s).normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const escaped = (s:string) => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const hash = (s:string) => createHash("sha256").update(s).digest("hex").slice(0,24);
/** State names qualify office labels in Wikidata; they are jurisdiction data,
 * not part of the office title that the official person's page must bind. */
export function statewideOfficeTitle(title:string,state:string):string {
  const jurisdiction=statewideJurisdiction(state),name=escaped(jurisdiction.name);
  return title.replace(new RegExp(`\\s+(?:of|for) (?:the )?(?:state of )?${name}$`,"i"),"")
    .replace(new RegExp(`^${name}\\s+`,"i"),"").trim();
}
export function statewidePageText(html:string):string {
  return decodeEntities(html.replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi," ")
    .replace(/<img\b[^>]*\balt\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi,(_tag,a:string,b:string)=>` ${a??b} `)
    .replace(/<!--[\s\S]*?-->/g," ").replace(/<[^>]*>/g," ")).replace(/\s+/g," ").trim();
}
export function statewidePageLinks(html:string,base:string):{url:string;label:string}[] {
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)].flatMap(m=>{
    try { const url=new URL(decodeEntities(m[1]),base); return ["https:","http:"].includes(url.protocol)?[{url:url.href,label:statewidePageText(m[2])}]:[]; }
    catch {return [];}
  });
}
function namedStates(text:string):readonly string[] {
  const normalized=` ${words(text)} `;
  // Longer names consume their suffix so a state whose name occurs inside
  // another jurisdiction never acquires that jurisdiction's officials.
  let remaining=normalized;const found:string[]=[];
  for (const state of [...STATEWIDE_JURISDICTIONS].sort((a,b)=>b.name.length-a.name.length)) {
    const term=` ${words(state.name)} `;
    if(remaining.includes(term)){found.push(state.postal.toLowerCase());remaining=remaining.replaceAll(term," ");}
  }
  return found;
}
function personName(label:string,officeTitles:readonly string[]):string|null {
  let name=label.replace(/\s*\((?:D|R|I|Democrat(?:ic)?|Republican|Independent)\)\s*$/i,"")
    .replace(/^(?:The\s+)?(?:Honorable|Hon\.?|Dr\.|Gov\.|Lt\.\s*Gov\.|A\.G\.)\s+/i,"");
  for(const office of [...officeTitles].sort((a,b)=>b.length-a.length))name=name.replace(new RegExp(`^(?:${escaped(office)})\\s+|[,–—-]?\\s+(?:${escaped(office)})$`,"i"),"").trim();
  if(!/^[\p{L}][\p{L}\p{M}.'’\-]*(?:\s+[\p{L}][\p{L}\p{M}.'’\-]*){1,6}$/u.test(name))return null;
  if(/\b(?:department|state|office|website|contact|about|governor|general|commissioner|secretary|treasurer|auditor|comptroller|insurance|education|agriculture|learn|read|more|member|directory|view|biography|profile|official|party|democrat|republican)\b/i.test(name))return null;
  if(namedStates(name).length)return null;
  return name;
}
/** All directories are leads. An ambiguous card stays a reported blank. */
export function parseStatewideAssociation(html:string,source:StatewideReferenceSource,sourceUrl:string,collectedAt:string,state?:string):{leads:StatewideLead[];gaps:StatewideGap[]} {
  const leads:StatewideLead[]=[],gaps:StatewideGap[]=[];
  for(const {html:block} of htmlEvidenceBlocks(html)){
    const text=statewidePageText(block);
    const headingStates=[...new Set([...block.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi)].flatMap(heading=>namedStates(statewidePageText(heading[1]))))];
    // Postal addresses can contain another state's name (Washington Street).
    // A directory's jurisdiction heading owns the card when it is present.
    const states=headingStates.length?headingStates:namedStates(text);if(states.length!==1||state&&states[0]!==state.toLowerCase())continue;
    const links=statewidePageLinks(block,sourceUrl);
    const office=source.officeTitles.find(title=>words(text).includes(words(title)))??(source.officeTitles.length===1?source.officeTitles[0]:null);
    if(!office)continue;
    const names=[...new Set(links.map(link=>personName(link.label,source.officeTitles)).filter((name):name is string=>Boolean(name)))];
    // Name headings in association cards are often plain text rather than links.
    for(const heading of block.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi)){
      const name=personName(statewidePageText(heading[1]),source.officeTitles);if(name&&!names.includes(name))names.push(name);
    }
    if(!names.length)for(const field of block.matchAll(/<(?:td|p|span)\b[^>]*>([^<>]+)<\/(?:td|p|span)\s*>/gi)){
      const name=personName(statewidePageText(field[1]),source.officeTitles);if(name&&!names.includes(name))names.push(name);
    }
    if(names.length!==1)continue;
    const name=names[0],nameWords=words(name);
    const profileUrls=links.filter(link=>isOfficialSource(link.url)||words(link.label).includes(nameWords)||/\b(?:official|website|biography|bio|about)\b/i.test(link.label))
      .map(link=>link.url).filter(url=>!url.includes("mailto:"));
    if(!profileUrls.length){gaps.push({sourceUrl,detail:`STATEWIDE_PROFILE_LINK_MISSING:${states[0]}:${name}:${office}`});continue;}
    leads.push({sourceId:source.id,sourceOrg:source.publisher,sourceUrl,collectedAt,state:states[0],name,officeTitle:office,
      profileUrls:[...new Set(profileUrls)],nativeIds:{[source.id]:profileUrls.filter(url=>new URL(url).hostname===new URL(sourceUrl).hostname)},
      nativeIdSources:{[source.id]:{sourceUrl,sourceOrg:source.publisher,collectedAt,verifiedAt:collectedAt}},evidenceExcerpt:text});
  }
  const unique=[...new Map(leads.map(lead=>[`${lead.state}|${words(lead.name)}|${words(lead.officeTitle)}`,lead])).values()];
  if(!unique.length)gaps.push({sourceUrl,detail:`STATEWIDE_DIRECTORY_NO_PARSED_LEADS:${state??"national"}:Directory evidence remains held for a standing reader; no absence is inferred.`});
  return {leads:unique,gaps};
}

interface BindingValue {readonly value:string}
export function parseWikidataStatewide(body:string,sourceUrl:string,collectedAt:string,requestedState?:string):{leads:StatewideLead[];gaps:StatewideGap[]} {
  const document=JSON.parse(body) as {results?:{bindings?:Record<string,BindingValue>[]}};
  if(!Array.isArray(document.results?.bindings))throw new Error("STATEWIDE_WIKIDATA_RESPONSE_INVALID");
  const leads:StatewideLead[]=[],gaps:StatewideGap[]=[];
  const idFields=["openstates","legiscan","bioguide","votesmart","followthemoney","opensecrets","ballotpedia"];
  for(const row of document.results.bindings){
    const state=(row.stateCode?.value??"").replace(/^US-/,"").toLowerCase();
    if(requestedState&&state!==requestedState.toLowerCase())continue;
    if(!STATEWIDE_JURISDICTIONS.some(item=>item.postal.toLowerCase()===state))continue;
    const name=row.personLabel?.value,officeTitle=row.officeLabel?.value,entity=row.person?.value;
    if(!name||!officeTitle||!entity||!/\/Q\d+$/.test(entity))continue;
    const nativeIds:Record<string,string[]>={wikidata:[entity.split("/").at(-1)!]};
    for(const key of idFields)if(row[key]?.value)nativeIds[key]=[row[key].value];
    const profileUrls=[row.personWebsite?.value,row.officeWebsite?.value,row.referenceUrl?.value].filter((value):value is string=>!!value&&/^https?:\/\//.test(value));
    leads.push({sourceId:"wikidata",sourceOrg:"Wikidata (CC0)",sourceUrl,collectedAt,state,name,officeTitle,profileUrls:[...new Set(profileUrls)],nativeIds,
      nativeIdSources:Object.fromEntries(Object.keys(nativeIds).map(source=>[source,{sourceUrl,sourceOrg:"Wikidata (CC0)",collectedAt,verifiedAt:collectedAt}])),
      ...(row.start?.value?{termStart:row.start.value.slice(0,10)}:{}),...(row.end?.value?{termEnd:row.end.value.slice(0,10)}:{}),
      termSources:{termStart:{sourceUrl,sourceOrg:"Wikidata (CC0)",collectedAt,verifiedAt:collectedAt},termEnd:{sourceUrl,sourceOrg:"Wikidata (CC0)",collectedAt,verifiedAt:collectedAt}},
      ...(row.image?.value?{portraitCandidate:{imageUrl:row.image.value,sourceUrl:entity,collectedAt}}:{})});
    if(!profileUrls.length)gaps.push({sourceUrl:entity,detail:`STATEWIDE_PROFILE_LINK_MISSING:${state}:${name}:${officeTitle}`});
  }
  return {leads:[...new Map(leads.map(row=>[`${row.state}|${row.nativeIds?.wikidata?.[0]}|${words(row.officeTitle)}`,row])).values()],gaps};
}

/** Exact holder+office co-occurrence must be on a current own official page. */
export function verifyStatewideOfficialPage(lead:StatewideLead,page:{url:string;html:string;retrievedAt:string;linkingPage?:OfficialLinkingPage|null}):{person:Officeholder;selectionQuote:string|null}|{reason:string} {
  if(!lead.profileUrls.includes(page.url))return {reason:"STATEWIDE_PAGE_NOT_PERSON_PROFILE"};
  if(!isOfficialSource(page.url,page.linkingPage))return {reason:"STATEWIDE_PAGE_NOT_OFFICIAL"};
  const jurisdiction=statewideJurisdiction(lead.state),text=statewidePageText(page.html);
  const normalized=words(statewidePageText(page.html.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi," ").replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi," ")));
  if(!namedStates(text).includes(lead.state.toLowerCase()))return {reason:"STATEWIDE_PAGE_JURISDICTION_MISSING"};
  const officialOfficeTitle=statewideOfficeTitle(lead.officeTitle,lead.state);
  const name=words(lead.name),office=words(officialOfficeTitle).replace(/^state /,"");
  if(/\b(?:state senator|state representative|assemblymember|member of (?:the )?(?:house|senate|legislature)|city|county|district|municipal)\b/.test(office))return {reason:"STATEWIDE_OFFICE_SCOPE_NOT_STATEWIDE"};
  const officePattern=escaped(office).replace(/ /g,"\\s+");
  // A broad directory, a news mention, a past biography, or names elsewhere on
  // the same page cannot establish that this person currently holds this seat.
  const currentMatch=new RegExp(`(?:\\b${escaped(name)}\\b.{0,100}?\\b${officePattern}\\b|\\b${officePattern}\\b.{0,100}?\\b${escaped(name)}\\b)`,"g");
  let binding:string|null=null;
  for(const match of normalized.matchAll(currentMatch)){
    const start=Math.max(0,match.index!-45),end=match.index!+match[0].length+45,context=normalized.slice(start,end);
    if(/\b(?:former|past|previous|retired|late|candidate|nominee|governor elect|secretary elect|served as|succeeded|resigned)\b/.test(context))continue;
    const titleOffset=match.index!+match[0].search(new RegExp(`\\b${officePattern}\\b`));
    const titlePrefix=normalized.slice(Math.max(0,titleOffset-35),titleOffset);
    if(/\b(?:deputy|assistant|vice|lieutenant|lt)\s+$/.test(titlePrefix))continue;
    binding=match[0];break;
  }
  if(!binding)return {reason:"STATEWIDE_CURRENT_HOLDER_OFFICE_NOT_BOUND"};
  // This page is the person's page, not a statewide multi-person list or a
  // dated announcement. One named leader in a heading/title gives that link.
  const headings=[...page.html.matchAll(/<(?:title|h[1-3])\b[^>]*>([\s\S]*?)<\/(?:title|h[1-3])\s*>/gi)].map(m=>words(statewidePageText(m[1])));
  if(!headings.some(heading=>heading.includes(name))&&!/\b(?:is the|serves as|serving as|about|meet|was elected as|was appointed as)\b/.test(normalized.slice(Math.max(0,normalized.indexOf(name)-25),normalized.indexOf(name)+name.length+110)))return {reason:"STATEWIDE_OWN_PAGE_IDENTITY_MISSING"};
  const sentences=text.split(/(?<=[.!?])\s+|[\r\n]+/).filter(sentence=>words(sentence).includes(office));
  let selectionMethod:"ELECTED_STATEWIDE"|"APPOINTED"|"UNKNOWN"="UNKNOWN",selectionQuote:string|null=null;
  const stateName=escaped(words(jurisdiction.name));
  const electorate=`(?:the state|${stateName})`;
  const statewideElection=new RegExp(`\\b(?:statewide elected|elected statewide|elected by (?:the )?(?:people|voters|citizens) (?:of|across|throughout) ${electorate}|elected by (?:the )?${stateName} (?:people|voters|citizens))\\b`);
  const appointedOffice=new RegExp(`(?:\\b${officePattern}\\b.{0,60}?\\b(?:is|was|are|were|shall be|has been) appointed\\b|\\b(?:is|was|are|were|shall be|has been) appointed(?: as| to (?:serve as|the office of))? (?:the )?\\b${officePattern}\\b|\\bappointed\\b.{0,60}?\\b${escaped(name)}\\b.{0,35}?\\b${officePattern}\\b)`);
  for(const sentence of sentences){
    const value=words(sentence);
    if(appointedOffice.test(value)){
      selectionMethod="APPOINTED";selectionQuote=sentence;break;
    }
    if(statewideElection.test(value)){
      selectionMethod="ELECTED_STATEWIDE";selectionQuote=sentence;break;
    }
  }
  if(lead.sourceId==="wikidata"&&selectionMethod==="UNKNOWN"&&!new RegExp(`\\b${officePattern}\\b.{0,90}\\b(?:statewide|throughout (?:the )?state|across (?:the )?state|all of ${stateName})\\b`).test(normalized))return {reason:"STATEWIDE_OFFICE_SCOPE_NOT_VERIFIED"};
  const provenance:Provenance={kind:"OFFICIAL",sourceUrl:page.url,sourceOrg:`${jurisdiction.name} — official ${lead.officeTitle} page`,collectedAt:page.retrievedAt,verifiedAt:page.retrievedAt,evidenceExcerpt:binding};
  const phoneLink=[...page.html.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)][0]?.[1];
  const phone=phoneLink?decodeEntities(phoneLink):/\b(?:phone|telephone|office phone|contact)\s*:?\s*(\+?1?[ .-]?\(?\d{3}\)?[ .-]?\d{3}[ .-]\d{4})/i.exec(text)?.[1]??null;
  const emailLink=[...page.html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)[^"']*["']/gi)][0]?.[1]??null;
  const id=`statewide:${lead.state.toLowerCase()}:${hash(`${name}|${office}`)}`,membershipId=`${id}:membership`;
  const fieldSources:Record<string,Provenance>={name:provenance,officeTitle:provenance,websiteUrl:provenance};
  for(const namespace of Object.keys(lead.nativeIds??{}))fieldSources[`nativeIds.${namespace}`]=lead.nativeIdSources?.[namespace]??{
    sourceUrl:lead.sourceUrl,sourceOrg:lead.sourceOrg,collectedAt:lead.collectedAt,verifiedAt:lead.collectedAt};
  if(lead.termStart)fieldSources.termStart=lead.termSources?.termStart??{sourceUrl:lead.sourceUrl,sourceOrg:lead.sourceOrg,collectedAt:lead.collectedAt,verifiedAt:lead.collectedAt};
  if(lead.termEnd)fieldSources.termEnd=lead.termSources?.termEnd??{sourceUrl:lead.sourceUrl,sourceOrg:lead.sourceOrg,collectedAt:lead.collectedAt,verifiedAt:lead.collectedAt};
  if(phone)fieldSources.phone=provenance;
  if(emailLink)fieldSources.email=provenance;
  if(selectionQuote)fieldSources.selectionMethod={...provenance,evidenceExcerpt:selectionQuote};
  const portrait=pickPortraits(lead.name,imagesIn(page.html,page.url))[0];
  const person:Officeholder={id,personId:id,nativeIds:lead.nativeIds,state:jurisdiction.postal,name:lead.name,officeTitle:officialOfficeTitle,level:"STATE",
    termStart:lead.termStart??"",termEnd:lead.termEnd??"",birthDate:null,partyLabel:null,websiteUrl:page.url,profileUrls:[page.url],contactFormUrl:null,phone,email:emailLink,campaignUrl:null,photo:null,
    selectionMethod, ...(selectionQuote?{selectionMethodSourceUrl:page.url}:{}),
    memberships:[{id:membershipId,personId:id,officeId:`${jurisdiction.root}:office:${office.replace(/ /g,"-")}`,jurisdiction:`US-${jurisdiction.postal}`,officeTitle:officialOfficeTitle,
      level:"STATE",current:true,...(selectionMethod!=="UNKNOWN"?{divisionId:jurisdiction.root}:{}),termStart:lead.termStart??null,termEnd:lead.termEnd??null,sourceUrl:page.url,selectionMethod,...(selectionQuote?{selectionMethodSourceUrl:page.url}:{})}],
    ...(portrait?{portraitCandidate:{...(portrait.src===lead.portraitCandidate?.imageUrl?lead.portraitCandidate:{}),imageUrl:portrait.src,sourceUrl:page.url,collectedAt:page.retrievedAt}}:lead.portraitCandidate?{portraitCandidate:lead.portraitCandidate}:{}),
    fieldSources,provenance};
  return {person,selectionQuote};
}
export function statewideRoster(state:string,people:readonly Officeholder[],generatedAt:string):OfficeholderSet {
  const jurisdiction=statewideJurisdiction(state);
  return {scope:`US-${jurisdiction.postal}`,generatedAt,currentMembershipComplete:false,officeholders:[...people],
    unmatched:people.filter(person=>!person.memberships?.some(membership=>membership.divisionId===jurisdiction.root))
      .map(person=>({officeholderId:person.id,reason:"STATEWIDE_SELECTION_METHOD_UNRESOLVED"})),
    divisions:people.flatMap(person=>(person.memberships??[]).filter(membership=>membership.divisionId===jurisdiction.root)
      .map(membership=>({officeholderId:person.id,ocdId:jurisdiction.root,bodyId:null,membershipId:membership.id})))};
}
