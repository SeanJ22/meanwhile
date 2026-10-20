import { createHash } from "node:crypto";
import { acquireKnownReleaseFile, KnownReleaseFileUnavailable } from "../known-release-file.ts";
import { resolveKnownReleaseCache } from "../known-release.ts";
import { readHtmlEvidenceFile } from "../html-evidence-file.ts";
import type { Officeholder, OfficeholderSet } from "../../officials/types.ts";
import type { StatePeopleAcquisition } from "../../civic-data/state-people-publication.ts";
import { acquireKnownRelease, knownReleaseSourceCheck, type KnownReleaseOptions, type KnownRelease } from "../known-release.ts";
import { pacedPortraitAcquire } from "../../photos/portrait-work.ts";
import { isOfficialSource, type OfficialLinkingPage } from "../../civic-data/source-authority.ts";
import { STATEWIDE_SOURCE_ID, STATEWIDE_PARSER_VERSION, STATEWIDE_REFERENCE_SOURCES, statewideJurisdiction, type StatewideReferenceSource } from "./reference.ts";
import { parseStatewideAssociationBlock, parseWikidataStatewide, statewideOfficeTitle, statewidePageLinks, statewideRoster, verifyStatewideOfficialPage, type StatewideLead, type StatewideGap } from "./parse.ts";
import { acquireWikidataPortraitLicense, discoverWikidataIdentifierProperties, WIKIDATA_IDENTIFIER_PROPERTIES } from "../people/wikidata.ts";
export { STATEWIDE_SOURCE_ID, STATEWIDE_PARSER_VERSION } from "./reference.ts";

const DAY=86_400_000;
type SharedOptions=Pick<KnownReleaseOptions,"store"|"locks"|"fetchImpl"|"now">&{
  readonly signal:AbortSignal;
  /** Controlled tests/replays use the same saved-byte acquisition API. */
  readonly acquire?:typeof acquireKnownRelease;
};
interface NationalStatewideLeads {
  readonly leads:readonly StatewideLead[];
  readonly acquisitions:readonly StatePeopleAcquisition[];
  readonly gaps:readonly StatewideGap[];
  readonly coverage:readonly {sourceId:string;leads:number}[];
}
interface StatewidePeopleRelease {
  readonly state:string;
  readonly releaseId:string;
  readonly roster:OfficeholderSet;
  readonly acquisitions:readonly StatePeopleAcquisition[];
  readonly gaps:readonly StatewideGap[];
  readonly coverage:readonly {sourceId:string;leads:number;verified:number}[];
}
function text(release:KnownRelease){return new TextDecoder("utf-8",{fatal:true}).decode(release.bytes);}
function acquisition(release:KnownRelease):StatePeopleAcquisition{
  return {requestedUrl:release.requestedUrl,finalUrl:release.finalUrl,httpStatus:release.httpStatus,body:text(release),retrievedAt:release.retrievedAt,
    rawHash:release.sha256,sourceCheck:knownReleaseSourceCheck(release)};
}
function shared(options:SharedOptions){return {store:options.store,locks:options.locks,fetchImpl:options.fetchImpl,now:options.now,signal:options.signal};}
function canonicalProfile(value:string):string|null{
  try{const url=new URL(value);if(!["http:","https:"].includes(url.protocol)||url.username||url.password)return null;if(url.protocol==="http:")url.protocol="https:";return url.href;}
  catch{return null;}
}
/** Every current person holding a state-jurisdiction executive office. State
 * membership comes from ISO subdivision claims, not a state or office matrix. */
export function wikidataStatewideQuery(asOf:string,properties:Readonly<Record<string,string>>=WIKIDATA_IDENTIFIER_PROPERTIES,state?:string):string {
  const at=new Date(asOf);if(!Number.isFinite(at.getTime()))throw new Error("STATEWIDE_QUERY_DATE_INVALID");
  const identifierClaims=Object.entries(properties).filter(([,property])=>/^P\d+$/.test(property)).map(([source,property])=>{
    const variable=source==="ocd-person"?"openstates":source.replace(/[^a-z0-9]/gi,"");return {variable,property};
  });
  return `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX pr: <http://www.wikidata.org/prop/reference/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?stateCode ?person ?personLabel ?office ?officeLabel ?personWebsite ?officeWebsite ?referenceUrl ?image ?start ?end ${identifierClaims.map(row=>`?${row.variable}`).join(" ")} WHERE {
  ?state wdt:P17 wd:Q30; wdt:P300 ?stateCode.
  ${state?`FILTER(?stateCode = "US-${statewideJurisdiction(state).postal}")`:'FILTER(STRSTARTS(?stateCode, "US-"))'}
  ?office (wdt:P1001|wdt:P131) ?state.
  { ?person p:P39 ?tenure. ?tenure ps:P39 ?office.
    OPTIONAL { ?tenure pq:P580 ?start. }
    OPTIONAL { ?tenure pq:P582 ?end. }
    OPTIONAL { ?tenure prov:wasDerivedFrom/pr:P854 ?referenceUrl. }
    FILTER(!BOUND(?start) || ?start <= "${at.toISOString()}"^^xsd:dateTime)
    FILTER(!BOUND(?end) || ?end > "${at.toISOString()}"^^xsd:dateTime)
  } UNION { ?office wdt:P1308 ?person. }
  OPTIONAL { ?person wdt:P856 ?personWebsite. }
  OPTIONAL { ?office wdt:P856 ?officeWebsite. }
  OPTIONAL { ?person wdt:P18 ?image. }
  ${identifierClaims.map(row=>`OPTIONAL { ?person wdt:${row.property} ?${row.variable}. }`).join("\n  ")}
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}
function sourceUrl(source:StatewideReferenceSource,asOf:string,properties?:Readonly<Record<string,string>>,state?:string){
  if(source.format!=="wikidata")return source.url;
  const url=new URL(source.url);url.searchParams.set("query",wikidataStatewideQuery(`${asOf.slice(0,10)}T00:00:00.000Z`,properties,state));url.searchParams.set("format","json");return url.href;
}
function mergeLeads(leads:readonly StatewideLead[]):StatewideLead[]{
  const merged=new Map<string,StatewideLead>();
  for(const lead of leads){
    const key=[lead.state,lead.name.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),statewideOfficeTitle(lead.officeTitle,lead.state).toLowerCase().replace(/^state /,"")].join("|");
    const held=merged.get(key);if(!held){merged.set(key,lead);continue;}
    const nativeIds:Record<string,readonly string[]>={...held.nativeIds};
    for(const [source,ids]of Object.entries(lead.nativeIds??{}))nativeIds[source]=[...new Set([...(nativeIds[source]??[]),...ids])];
    merged.set(key,{...held,nativeIds,nativeIdSources:{...lead.nativeIdSources,...held.nativeIdSources},profileUrls:[...new Set([...held.profileUrls,...lead.profileUrls])],portraitCandidate:held.portraitCandidate??lead.portraitCandidate,
      termStart:held.termStart??lead.termStart,termEnd:held.termEnd??lead.termEnd,termSources:{...lead.termSources,...held.termSources}});
  }
  return [...merged.values()];
}
/** Saved release identity shares national directory downloads across state
 * consumers. All requested national sources run; a failure leaves its gap. */
export async function acquireNationalStatewideLeads(options:SharedOptions&{readonly asOf?:string;readonly state:string}):Promise<NationalStatewideLeads>{
  const asOf=options.asOf??options.now?.()??new Date().toISOString(),acquire=options.acquire??pacedPortraitAcquire;
  statewideJurisdiction(options.state);
  const {store:sourceStore}=await resolveKnownReleaseCache(options);
  const results=await Promise.all(STATEWIDE_REFERENCE_SOURCES.map(async source=>{
    const referenceUrl=new URL(source.url);
    const acquisitions:StatePeopleAcquisition[]=[],leads:StatewideLead[]=[],gaps:StatewideGap[]=[];
    const properties=source.format==="wikidata"?await discoverWikidataIdentifierProperties({...shared(options),sourceId:"wikidata-people",state:options.state,asOf,acquire},acquisitions,gaps):undefined;
    const pending=[sourceUrl(source,asOf,properties,options.state)],seen=new Set<string>();
    while(pending.length){
      options.signal.throwIfAborted();const url=pending.shift()!;if(seen.has(url))continue;seen.add(url);
      try{
        const host=new URL(url).hostname.replace(/^www\./,"");
        if(source.format==="wikidata"){
          // The query's ISO state predicate bounds these records to this job's place.
          const release=await acquire({...shared(options),sourceId:STATEWIDE_SOURCE_ID,releaseId:`national:${source.id}:${url}`,url,
            parserVersion:STATEWIDE_PARSER_VERSION,maxBytes:16*1024*1024,checkAfterMs:DAY,allowedHosts:[host,`www.${host}`],
            headers:{accept:"application/sparql-results+json"},validate:bytes=>{if(!bytes.length)throw new Error("STATEWIDE_SOURCE_EMPTY");}});
          acquisitions.push(acquisition(release));
          const parsed=parseWikidataStatewide(text(release),release.finalUrl,release.retrievedAt,options.state);gaps.push(...parsed.gaps);
          for(const lead of parsed.leads){
            const portraitCandidate=lead.portraitCandidate?await acquireWikidataPortraitLicense(lead.portraitCandidate,
              {...shared(options),sourceId:"wikidata-people",state:options.state,asOf,acquire},acquisitions,gaps):undefined;
            leads.push({...lead,...(portraitCandidate?{portraitCandidate}:{})});
          }
          continue;
        }
        let release;
        try { release=await acquireKnownReleaseFile({...shared(options),sourceId:STATEWIDE_SOURCE_ID,releaseId:`national:${source.id}:${url}`,url,
          parserVersion:STATEWIDE_PARSER_VERSION,maxBytes:16*1024*1024,checkAfterMs:DAY,allowedHosts:[host,`www.${host}`],headers:{accept:"text/html"}}); }
        catch(error){if(!(error instanceof KnownReleaseFileUnavailable))throw error;release=error.held;gaps.push({sourceUrl:url,detail:`STATEWIDE_SOURCE_READ_FAILED:${error.message}`});}
        try{
          acquisitions.push({requestedUrl:release.requestedUrl,finalUrl:release.finalUrl,httpStatus:release.httpStatus,retrievedAt:release.retrievedAt,
            rawHash:release.sha256,sourceCheck:knownReleaseSourceCheck(release),body:"",indexOnly:true,heldCapture:{ref:release.raw,store:sourceStore}});
          let pageLeads=0;
          const enqueue=(link:{url:string;label:string},profile=false)=>{
            const target=new URL(link.url);
            if(target.protocol!=="https:"||target.hostname.replace(/^www\./,"")!==host||seen.has(link.url))return;
            const sourcePath=referenceUrl.pathname,path=target.pathname;
            const subsection=/\b(?:auditors?|comptrollers?|treasurers?|members?|governors?|commissioners?|departments?)\b/i.test(link.label)&&
              /(?:membership|member|governor|auditor|comptroller|treasurer|department|state)/i.test(path);
            if((subsection||profile)&&path!=="/"&&!/\/(?:news|events|publications|blog|login|search)(?:\/|$)/i.test(path)&&!pending.includes(link.url)&&
              (subsection||path.startsWith(sourcePath)||profile))pending.push(link.url);
          };
          for await(const fragment of readHtmlEvidenceFile(release.path)){
            options.signal.throwIfAborted();
            if(fragment.kind==="LINK"){for(const link of statewidePageLinks(fragment.html,release.finalUrl))enqueue(link);continue;}
            const parsed=parseStatewideAssociationBlock(fragment.html,source,release.finalUrl,release.retrievedAt,options.state);
            gaps.push(...parsed.gaps.filter(gap=>!gap.detail.startsWith("STATEWIDE_DIRECTORY_NO_PARSED_LEADS:")));
            for(const lead of parsed.leads){pageLeads++;leads.push(lead);for(const url of lead.profileUrls)enqueue({url,label:""},true);}
          }
          if(!pageLeads)gaps.push({sourceUrl:release.finalUrl,detail:`STATEWIDE_DIRECTORY_NO_PARSED_LEADS:${options.state}:Directory evidence remains held for a standing reader; no absence is inferred.`});
        }finally{await release.dispose();}
      }catch(error){options.signal.throwIfAborted();gaps.push({sourceUrl:url,detail:`STATEWIDE_SOURCE_READ_FAILED:${error instanceof Error?error.message:String(error)}`});}
    }
    return {sourceId:source.id,leads:mergeLeads(leads),acquisitions,gaps};
  }));
  return {leads:results.flatMap(row=>row.leads),acquisitions:results.flatMap(row=>row.acquisitions),gaps:results.flatMap(row=>row.gaps),
    coverage:results.map(row=>({sourceId:row.sourceId,leads:row.leads.length}))};
}

function heldPeopleLeads(roster:OfficeholderSet|undefined,state:string):StatewideLead[]{
  return roster?.officeholders.filter(person=>person.state?.toLowerCase()===state&&person.level==="STATE"&&!person.chamber&&person.name&&person.officeTitle)
    .map(person=>({sourceId:"held",sourceOrg:person.provenance.sourceOrg,sourceUrl:person.provenance.sourceUrl??person.websiteUrl??"",collectedAt:person.provenance.collectedAt,
      state,name:person.name,officeTitle:person.officeTitle,profileUrls:[...new Set([person.websiteUrl,...person.profileUrls??[],person.provenance.sourceUrl].filter((url):url is string=>typeof url==="string"&&/^https?:\/\//.test(url)))],
      nativeIds:person.nativeIds,nativeIdSources:Object.fromEntries(Object.keys(person.nativeIds??{}).map(namespace=>[namespace,person.fieldSources?.[`nativeIds.${namespace}`]??person.fieldSources?.nativeIds??person.provenance])),portraitCandidate:person.portraitCandidate}))??[];
}
export async function acquireStatewidePeople(options:SharedOptions&{
  readonly state:string;readonly asOf?:string;readonly national?:NationalStatewideLeads;readonly leads?:readonly StatewideLead[];readonly heldPeople?:OfficeholderSet;
  readonly officialLinks?:readonly OfficialLinkingPage[];
}):Promise<StatewidePeopleRelease>{
  const state=options.state.toLowerCase(),asOf=options.asOf??options.now?.()??new Date().toISOString();statewideJurisdiction(state);
  const national=options.national??await acquireNationalStatewideLeads({...options,state}),acquire=options.acquire??pacedPortraitAcquire;
  const nativeLeads=[...national.leads.filter(row=>row.state.toLowerCase()===state),...(options.leads??[]).filter(row=>row.state.toLowerCase()===state),...heldPeopleLeads(options.heldPeople,state)];
  const leads=mergeLeads(nativeLeads),people:Officeholder[]=[],gaps:StatewideGap[]=[...national.gaps],acquisitions:StatePeopleAcquisition[]=[...national.acquisitions];
  const verificationCounts=new Map<string,Set<string>>(),pages=new Map<string,Promise<KnownRelease>>();
  const read=(url:string)=>{
    let pending=pages.get(url);if(!pending){const host=new URL(url).hostname.replace(/^www\./,"");
      pending=acquire({...shared(options),sourceId:STATEWIDE_SOURCE_ID,releaseId:`official:${url}`,url,parserVersion:STATEWIDE_PARSER_VERSION,
        maxBytes:8*1024*1024,checkAfterMs:DAY,allowedHosts:[host,`www.${host}`],headers:{accept:"text/html"}});pages.set(url,pending);}
    return pending;
  };
  const snapshot=():StatewidePeopleRelease=>({state,releaseId:createHash("sha256").update(acquisitions.map(row=>row.rawHash).sort().join("|")).digest("hex"),
    roster:statewideRoster(state,people,acquisitions.map(row=>row.retrievedAt).sort().at(-1)??asOf),acquisitions:[...acquisitions],gaps:[...gaps],
    coverage:STATEWIDE_REFERENCE_SOURCES.map(source=>({sourceId:source.id,leads:nativeLeads.filter(lead=>lead.sourceId===source.id).length,verified:verificationCounts.get(source.id)?.size??0}))});
  // One sequential reader per host; independent official sites fill in parallel.
  const byHost=new Map<string,StatewideLead[]>();
  for(const lead of leads){const candidate=lead.profileUrls.find(url=>isOfficialSource(url))??lead.profileUrls[0];
    const canonical=candidate?canonicalProfile(candidate):null;
    const host=canonical?new URL(canonical).hostname:"unresolved";const rows=byHost.get(host)??[];rows.push(lead);byHost.set(host,rows);}
  await Promise.all([...byHost.values()].map(async rows=>{
    for(const lead of rows){
      const candidates=[...new Set(lead.profileUrls.flatMap(value=>{const url=canonicalProfile(value);return url?[url]:[];}))].sort((a,b)=>Number(isOfficialSource(b))-Number(isOfficialSource(a))),visited=new Set<string>();let verified=false;
      while(candidates.length){
        options.signal.throwIfAborted();const url=candidates.shift()!;if(visited.has(url))continue;visited.add(url);
        if(!/^https:\/\//.test(url))continue;
        try{
          const captured=await read(url);if(!acquisitions.some(row=>row.finalUrl===captured.finalUrl&&row.rawHash===captured.sha256))acquisitions.push(acquisition(captured));
          const html=text(captured),linkingPage=options.officialLinks?.find(page=>isOfficialSource(captured.finalUrl,page));
          const result=verifyStatewideOfficialPage({...lead,profileUrls:[...lead.profileUrls,captured.finalUrl]},
            {url:captured.finalUrl,html,retrievedAt:captured.retrievedAt,linkingPage});
          if("person"in result){
            people.push(result.person);verified=true;
            for(const native of nativeLeads.filter(native=>native.state===lead.state&&native.name===lead.name&&native.officeTitle===lead.officeTitle)){
              const ids=verificationCounts.get(native.sourceId)??new Set<string>();ids.add(result.person.id);verificationCounts.set(native.sourceId,ids);
            }
            if(result.person.selectionMethod==="UNKNOWN")gaps.push({sourceUrl:captured.finalUrl,detail:`STATEWIDE_SELECTION_METHOD_NOT_PUBLISHED:${state}:${lead.name}:${lead.officeTitle}`});
            break;
          }
          gaps.push({sourceUrl:captured.finalUrl,detail:`${result.reason}:${state}:${lead.name}:${lead.officeTitle}`});
          for(const link of statewidePageLinks(html,captured.finalUrl)){
            const sameName=link.label.toLowerCase().includes(lead.name.toLowerCase());
            const biography=/(?:about|bio|biography|meet|leadership|commissioner|secretary|governor|attorney)/i.test(link.label)&&
              new URL(link.url).hostname===new URL(captured.finalUrl).hostname;
            if((sameName||biography)&&!visited.has(link.url)&&!candidates.includes(link.url)&&!/[?&](?:page|search)=/.test(link.url))candidates.push(link.url);
          }
        }catch(error){options.signal.throwIfAborted();gaps.push({sourceUrl:url,detail:`STATEWIDE_OFFICIAL_PAGE_READ_FAILED:${state}:${lead.name}:${error instanceof Error?error.message:String(error)}`});}
      }
      if(!verified)gaps.push({sourceUrl:lead.sourceUrl,detail:`STATEWIDE_OFFICER_AWAITS_OWN_PAGE:${state}:${lead.name}:${lead.officeTitle}`});
    }
  }));
  return snapshot();
}
