import type { OfficeholderSet, PortraitCandidate } from "../../officials/types.ts";
import type { StatePeopleAcquisition } from "../../civic-data/state-people-publication.ts";
import { sameNativePerson } from "../../officials/people-identity.ts";
import { decodeEntities } from "../http.ts";
import { acquisition, array, emptyPerson, emptyRoster, gap, json, legislativeDivision, provenance, record, result, savedRead, sourced, stateIdentity, string, url, type PeopleAcquisitionOptions, type PeopleSourceRelease } from "./common.ts";

export const WIKIDATA_IDENTIFIER_PROPERTIES = { bioguide: "P1157", opensecrets: "P2686", ballotpedia: "P2390" } as const;
const propertyLabels = {
  "ocd-person": ["Open States legislator ID", "OpenStates ID", "Open States ID"],
  legiscan: ["LegiScan person ID", "LegiScan ID", "LegiScan legislator ID"],
  votesmart: ["Vote Smart ID", "VoteSmart ID"],
  followthemoney: ["Follow the Money ID", "FollowTheMoney ID"],
} as const;
export async function discoverWikidataIdentifierProperties(options: PeopleAcquisitionOptions, acquisitions: StatePeopleAcquisition[], gaps: {sourceUrl:string;detail:string}[]): Promise<Record<string,string>> {
  const properties: Record<string,string> = {...WIKIDATA_IDENTIFIER_PROPERTIES};
  for (const [provider, labels] of Object.entries(propertyLabels)) {
    let matched = false;
    for (const label of labels) {
      const sourceUrl = `https://www.wikidata.org/w/api.php?${new URLSearchParams({action:"wbsearchentities",search:label,language:"en",type:"property",format:"json"})}`;
      try {
        const release = await savedRead(options,sourceUrl,`identifier-property:${label}`); acquisitions.push(acquisition(release));
        const found = array(json(release).search).map(record).find(row=>labels.some(expected=>expected.toLowerCase()===string(row.label)?.toLowerCase()) && /^P\d+$/.test(string(row.id) ?? ""));
        if (found) { properties[provider] = string(found.id)!; matched = true; break; }
      } catch(error) { gap(gaps,options,sourceUrl,error); }
    }
    if (!matched) gaps.push({sourceUrl:"https://www.wikidata.org/",detail:`WIKIDATA_IDENTIFIER_PROPERTY_UNRESOLVED:${provider}; source IDs remain owed rather than guessed.`});
  }
  return properties;
}
const literal = (value:string) => JSON.stringify(value);
/** Jurisdictions and external identifiers come from source data, with no state-specific query. */
export function wikidataPeopleQuery(options: PeopleAcquisitionOptions, properties: Readonly<Record<string,string>>): string {
  const asOf=new Date(options.asOf).toISOString();
  const known: string[] = [];
  for (const holder of options.roster?.officeholders ?? []) {
    for (const [provider, property] of Object.entries(properties)) for (const native of holder.nativeIds?.[provider] ?? []) known.push(`(wdt:${property} ${literal(native)})`);
  }
  const identity = known.length ? `UNION { VALUES (?knownPredicate ?knownId) { ${[...new Set(known)].join(" ")} } ?person ?knownPredicate ?knownId. }` : "";
  return `SELECT DISTINCT ?person ?personLabel ?position ?positionLabel ?district ?districtLabel ?start ?end ?site ?image ?identifierProperty ?identifier WHERE {
    ?state wdt:P300 ${literal(`US-${options.state.toUpperCase()}`)}.
    { ?person p:P39 ?term. ?term ps:P39 ?position.
      { ?position (wdt:P1001|wdt:P131) ?state. } UNION { ?term pq:P768 ?district. ?district (wdt:P131|wdt:P1001)* ?state. }
    } ${identity}
    ?person p:P39 ?term. ?term ps:P39 ?position.
    OPTIONAL { ?term pq:P580 ?start. } OPTIONAL { ?term pq:P582 ?end. }
    FILTER ((!BOUND(?start) || ?start <= ${literal(asOf)}^^xsd:dateTime) && (!BOUND(?end) || ?end > ${literal(asOf)}^^xsd:dateTime))
    OPTIONAL { ?term pq:P768 ?district. } OPTIONAL { ?person wdt:P856 ?site. } OPTIONAL { ?person wdt:P18 ?image. }
    OPTIONAL { VALUES ?identifierProperty { ${Object.values(properties).map(property=>`wd:${property}`).join(" ")} } ?identifierProperty wikibase:directClaim ?identifierPredicate. ?person ?identifierPredicate ?identifier. }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`;
}
function value(row:Record<string,unknown>,key:string):string|null { return string(record(row[key]).value); }
export function normalizeWikidataPeople(data: unknown, options: PeopleAcquisitionOptions, properties: Readonly<Record<string,string>>, sourceUrl: string, collectedAt: string): OfficeholderSet {
  const rows = array(record(record(data).results).bindings).map(record), roster = emptyRoster(options.state,options.asOf), state = stateIdentity(options.state);
  const reverse = new Map(Object.entries(properties).map(([provider,property])=>[property,provider]));
  for (const row of rows) {
    const entity = value(row,"person"), qid = entity?.split("/").at(-1), name = value(row,"personLabel"), office = value(row,"positionLabel"), position = value(row,"position");
    if (!qid || !/^Q\d+$/.test(qid) || !name || !office || /^Q\d+$/.test(name) || /^Q\d+$/.test(office)) continue;
    const personId=`wikidata:${qid}`,id = `wikidata:${state.state.toLowerCase()}:${qid}`, source = provenance(entity!,"Wikidata (CC0)",collectedAt);
    let holder = roster.officeholders.find(row=>row.id===id);
    if (!holder) {
      holder = emptyPerson(id,name,office,state.state,source);holder.personId=personId; holder.nativeIds = {wikidata:[qid]}; holder.profileUrls = [entity!];
      holder.websiteUrl = url(value(row,"site")); holder.termStart = value(row,"start")?.slice(0,10) ?? ""; holder.termEnd = value(row,"end")?.slice(0,10) ?? "";
      const imageUrl = url(value(row,"image")); if (imageUrl) holder.portraitCandidate = {imageUrl,sourceUrl:entity!,collectedAt};
      holder.chamber = /United States (?:Senator|House|Representative)|member of the United States (?:Senate|House)/i.test(office) ? /Senat/i.test(office) ? "senate" : "house"
        : /state senator|member of the .*senate/i.test(office) ? "upper" : /state representative|member of the .*assembly|member of the .*house of representatives/i.test(office) ? "lower" : undefined;
      holder.level = ["senate","house"].includes(holder.chamber ?? "") ? "FEDERAL" : "STATE";
      roster.officeholders.push(holder);
    }
    const property = value(row,"identifierProperty")?.split("/").at(-1), native = value(row,"identifier"), provider = property ? reverse.get(property) : null;
    if (provider && native) holder.nativeIds = {...holder.nativeIds,[provider]:[...new Set([...(holder.nativeIds?.[provider] ?? []),native])]};
    const districtLabel = value(row,"districtLabel"), district = districtLabel && /(?:district|District)\s+(\d+[a-z]?)/.exec(districtLabel)?.[1];
    const divisionId = holder.chamber === "senate" ? state.root : holder.chamber === "house" && district ? `${state.root}/cd:${district}`
      : ["upper","lower"].includes(holder.chamber ?? "") && district ? legislativeDivision(options,holder.chamber!,district) : !holder.chamber ? state.root : undefined;
    const membershipId = `${id}:${position?.split("/").at(-1) ?? "office"}:${value(row,"start") ?? ""}`;
    if (!holder.memberships?.some(membership=>membership.id===membershipId)) holder.memberships = [...(holder.memberships ?? []),{id:membershipId,personId,officeId:position ?? membershipId,jurisdiction:state.jurisdiction,
      chamber:holder.chamber,district:district ?? undefined,officeTitle:office,level:holder.level,current:true,divisionId,termStart:value(row,"start")?.slice(0,10) ?? null,termEnd:value(row,"end")?.slice(0,10) ?? null,sourceUrl:entity!}];
    if (divisionId && !roster.divisions.some(row=>row.officeholderId===id&&row.membershipId===membershipId)) roster.divisions.push({officeholderId:id,membershipId,ocdId:divisionId,bodyId:null});
    sourced(holder,source);
  }
  for (const holder of roster.officeholders) if (!roster.divisions.some(row=>row.officeholderId===holder.id)) roster.unmatched.push({officeholderId:holder.id,reason:"WIKIDATA_OFFICE_DIVISION_UNRESOLVED"});
  return roster;
}
/** Commons states the licence for its exact file; this remains a lead until own-page verification. */
export async function acquireWikidataPortraitLicense(candidate:PortraitCandidate,options:PeopleAcquisitionOptions,acquisitions:StatePeopleAcquisition[],gaps:{sourceUrl:string;detail:string}[]):Promise<PortraitCandidate> {
  const image=new URL(candidate.imageUrl),title=decodeURIComponent(image.pathname.split("/").at(-1)??"");
  if(!title||!["commons.wikimedia.org","upload.wikimedia.org"].includes(image.hostname))return candidate;
  const metadataUrl=`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({action:"query",titles:`File:${title.replace(/_/g," ")}`,prop:"imageinfo",iiprop:"extmetadata|url",format:"json"})}`;
  try {
    const license=await savedRead(options,metadataUrl,`commons-license:${title}`);acquisitions.push(acquisition(license));
    const pages=Object.values(record(record(json(license).query).pages)),info=record(array(record(pages[0]).imageinfo)[0]),metadata=record(info.extmetadata);
    const licenseText=string(record(metadata.LicenseShortName).value),licenseUrl=url(record(metadata.LicenseUrl).value),artist=string(record(metadata.Artist).value),attribution=string(record(metadata.Attribution).value);
    return {...candidate,license:licenseText,licenseUrl,attribution:attribution??(artist?decodeEntities(artist.replace(/<[^>]+>/g,"")):null)};
  }catch(error){gap(gaps,options,metadataUrl,error);return candidate;}
}
export async function acquireWikidataPeople(options: PeopleAcquisitionOptions): Promise<PeopleSourceRelease> {
  const acquisitions: StatePeopleAcquisition[] = [], gaps: {sourceUrl:string;detail:string}[] = [];
  const properties = await discoverWikidataIdentifierProperties(options,acquisitions,gaps), query = wikidataPeopleQuery(options,properties);
  const sourceUrl = `https://query.wikidata.org/sparql?${new URLSearchParams({query,format:"json"})}`;
  let roster = emptyRoster(options.state,options.asOf);
  try {
    const release = await savedRead(options,sourceUrl,`${options.state}:current-people`,bytes=>{
      const data = JSON.parse(new TextDecoder().decode(bytes)); if (!Array.isArray(data.results?.bindings)) throw new Error("WIKIDATA_PEOPLE_RESULT_INVALID");
    }); acquisitions.push(acquisition(release)); roster = normalizeWikidataPeople(json(release),options,properties,sourceUrl,release.retrievedAt);
    const statewideIds=new Set<string>();
    roster.officeholders=roster.officeholders.filter(holder=>{
      if(holder.level!=="STATE"||holder.chamber)return true;
      statewideIds.add(holder.id);
      const held=options.roster?.officeholders.find(prior=>sameNativePerson(prior,holder));
      if(!held){gaps.push({sourceUrl:holder.provenance.sourceUrl!,detail:`WIKIDATA_STATEWIDE_OWN_PAGE_OWED:${holder.id}:${holder.name}:${holder.officeTitle}; this current office is a lead until the person's own official state page binds them to it.`});return false;}
      // Existing statewide people may receive IDs, terms and licensed photo leads. This source creates no statewide tenure.
      holder.memberships=[];holder.officeTitle=held.officeTitle;holder.level=held.level;holder.chamber=held.chamber;
      return true;
    });
    roster.divisions=roster.divisions.filter(row=>!statewideIds.has(row.officeholderId));
    roster.unmatched=roster.unmatched.filter(row=>!statewideIds.has(row.officeholderId));
    if(roster.officeholders.length)await options.onPerson?.(result(options,roster,acquisitions,gaps));
    for (const holder of roster.officeholders) {
      const candidate = holder.portraitCandidate; if (!candidate) continue;
      holder.portraitCandidate=await acquireWikidataPortraitLicense(candidate,options,acquisitions,gaps);
      await options.onPerson?.(result(options,roster,acquisitions,gaps));
    }
  } catch(error) { gap(gaps,options,sourceUrl,error); }
  roster.currentMembershipComplete = false;
  return result(options,roster,acquisitions,gaps);
}
