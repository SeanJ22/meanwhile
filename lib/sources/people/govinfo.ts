import { officeIdentity } from "../../officials/office-identity.ts";
import type { OfficeholderSet } from "../../officials/types.ts";
import { decodeEntities } from "../http.ts";
import { acquisition, array, emptyPerson, emptyRoster, gap, json, number, provenance, record, result, savedRead, sourced, stateIdentity, string, url, type PeopleAcquisitionOptions, type PeopleSourceRelease } from "./common.ts";

const textOf = (value: string) => decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
function providerPath(value: string): { path: string; params: Record<string, string> } {
  const parsed = new URL(value); if (parsed.origin !== "https://api.govinfo.gov") throw new Error("GOVINFO_NEXT_URL_INVALID");
  const params: Record<string, string> = {}; for (const [key, value] of parsed.searchParams) if (!/^(api_key|key)$/i.test(key)) params[key] = value;
  return { path: parsed.pathname.replace(/^\//, ""), params };
}
export function normalizeGovinfoMember(value: unknown, document: string, options: PeopleAcquisitionOptions, sourceUrl: string, collectedAt: string, documentSource?:{sourceUrl:string;collectedAt:string}): OfficeholderSet {
  const summary = record(value), members = array(summary.members).map(record), roster = emptyRoster(options.state, options.asOf);
  const state = stateIdentity(options.state), text = textOf(document);
  for (const member of members) {
    const bioguide = string(member.bioGuideId ?? member.bioguideId), stateCode = string(member.state);
    if (!bioguide || !/^[A-Z]\d{6}$/.test(bioguide) || !stateCode || ![state.state.toLowerCase(),state.label.toLowerCase()].includes(stateCode.toLowerCase())) continue;
    const name = string(member.memberName ?? member.name), chamberValue = string(member.chamber ?? summary.chamber ?? member.memberType);
    const chamber = /senat/i.test(chamberValue ?? "") ? "senate" : /house|representative|delegate|resident commissioner/i.test(chamberValue ?? "") ? "house" : null;
    if (!name || !chamber) { roster.unmatched.push({officeholderId:`govinfo:${state.state.toLowerCase()}:${bioguide}`,reason:"GOVINFO_MEMBER_OFFICE_UNRESOLVED"}); continue; }
    const personId=`govinfo:${bioguide}`,id = `govinfo:${state.state.toLowerCase()}:${bioguide}`, source = provenance(sourceUrl, "U.S. Government Publishing Office — Congressional Directory", collectedAt);
    const holder = emptyPerson(id, name, chamber === "senate" ? "U.S. Senator" : "U.S. Representative", state.state, source);
    holder.personId=personId;holder.level = "FEDERAL"; holder.chamber = chamber; holder.nativeIds = { bioguide: [bioguide], govinfo: [bioguide] };
    holder.partyLabel = string(member.party); holder.termStart = string(member.termStart) ?? ""; holder.termEnd = string(member.termEnd) ?? "";
    const district = number(member.district), divisionId = chamber === "senate" ? state.root : district === null ? undefined : `${state.root}/cd:${district === 0 || !state.root.includes("/state:") ? "at-large" : district}`;
    // A directory granule can contain an entire delegation. Unscoped contacts remain blanks.
    if (members.length === 1 && text) {
      const ownWebsite = [...document.matchAll(/(?:https?:\/\/|www\.)[a-z0-9.-]+\.(?:house|senate)\.gov(?:\/[^\s<>"']*)?/gi)][0]?.[0];
      holder.websiteUrl = ownWebsite ? url(ownWebsite.startsWith("www.") ? `https://${ownWebsite}` : ownWebsite) : null;
      holder.phone = /(?:\(?202\)?[\s.-]+)\d{3}[\s.-]+\d{4}/.exec(text)?.[0] ?? null;
    }
    const membershipId = `${id}:${chamber}:${district ?? "state"}:${string(summary.congress) ?? number(summary.congress) ?? ""}`;
    holder.memberships = [{ id: membershipId, personId, officeId: `congress-office:${state.state}:${officeIdentity(holder.officeTitle)}:${district ?? "state"}`, jurisdiction: state.jurisdiction,
      chamber, district: district === null ? undefined : String(district), officeTitle: holder.officeTitle, level: "FEDERAL", current: true, divisionId, sourceUrl }];
    sourced(holder,source);
    if(documentSource)holder.fieldSources={...holder.fieldSources,...Object.fromEntries(["phone","websiteUrl"].filter(field=>holder[field as "phone"|"websiteUrl"]).map(field=>[field,provenance(documentSource.sourceUrl,"U.S. Government Publishing Office — Congressional Directory",documentSource.collectedAt)]))};
    roster.officeholders.push(holder);
    if (divisionId) roster.divisions.push({officeholderId:id,membershipId,ocdId:divisionId,bodyId:null});
    else roster.unmatched.push({officeholderId:id,reason:"GOVINFO_HOUSE_DISTRICT_NOT_PUBLISHED"});
  }
  return roster;
}
export async function acquireGovinfoDirectory(options: PeopleAcquisitionOptions): Promise<PeopleSourceRelease> {
  const acquisitions = [], gaps: {sourceUrl:string;detail:string}[] = [], roster = emptyRoster(options.state, options.asOf);
  const date = new Date(options.asOf), beginning = new Date(Date.UTC(date.getUTCFullYear() - 4, 0, 1)).toISOString(), end = date.toISOString();
  let sourceUrl = `https://api.govinfo.gov/collections/CDIR/${beginning}?${new URLSearchParams({lastModifiedEndDate:end,pageSize:"100",offsetMark:"*"})}`;
  const packages: Record<string,unknown>[] = [], seen = new Set<string>();
  try {
    while (sourceUrl) {
      if (seen.has(sourceUrl)) throw new Error("GOVINFO_COLLECTION_PAGINATION_CYCLE"); seen.add(sourceUrl);
      const route = providerPath(sourceUrl), release = await savedRead(options, sourceUrl, `cdir-index:${route.params.offsetMark ?? "*"}:${beginning.slice(0,4)}`, bytes => {
        const value = JSON.parse(new TextDecoder().decode(bytes)); if (!Array.isArray(value.packages)) throw new Error("GOVINFO_CDIR_INDEX_INVALID");
      }, {name:"data_gov_api",provider:"govinfo",...route});
      acquisitions.push(acquisition(release)); const data = json(release); packages.push(...array(data.packages).map(record));
      sourceUrl = url(data.nextPage) ?? "";
    }
    const congressYear = date.getUTCMonth() === 0 && date.getUTCDate() < 3 ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
    const currentCongress = Math.floor((congressYear - 1789) / 2) + 1;
    // Current package identity is in the publisher's title/metadata; older directories cannot establish current membership.
    const current = packages.filter(row => number(row.congress) === currentCongress || new RegExp(`\\b${currentCongress}(?:st|nd|rd|th)?\\s+Congress\\b`,"i").test(string(row.title) ?? ""))
      .sort((a,b)=>(string(b.dateIssued) ?? string(b.lastModified) ?? "").localeCompare(string(a.dateIssued) ?? string(a.lastModified) ?? ""))[0];
    if (!current) throw new Error(`GOVINFO_CURRENT_DIRECTORY_NOT_FOUND:${currentCongress}`);
    const packageId = string(current.packageId); if (!packageId || !/^[a-z0-9.-]+$/i.test(packageId)) throw new Error("GOVINFO_PACKAGE_ID_INVALID");
    sourceUrl = `https://api.govinfo.gov/packages/${packageId}/granules?pageSize=100&offsetMark=*`; seen.clear();
    while (sourceUrl) {
      if (seen.has(sourceUrl)) throw new Error("GOVINFO_GRANULE_PAGINATION_CYCLE"); seen.add(sourceUrl);
      const route = providerPath(sourceUrl), release = await savedRead(options, sourceUrl, `${packageId}:granules:${route.params.offsetMark ?? "*"}`, undefined, {name:"data_gov_api",provider:"govinfo",...route});
      acquisitions.push(acquisition(release)); const data = json(release);
      if (!Array.isArray(data.granules)) throw new Error("GOVINFO_GRANULE_INDEX_INVALID");
      for (const item of array(data.granules)) {
        const row = record(item), state = stateIdentity(options.state), title = string(row.title ?? row.granuleTitle) ?? "";
        // The CDIR index names each state's section. Only its source-native granule is opened by this state reader.
        if (string(row.state)?.toUpperCase() !== state.state && !new RegExp(`\\b${state.label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\b`,"i").test(title)) continue;
        const summaryUrl = url(row.granuleLink ?? row.granuleSummary ?? row.summaryLink);
        if (!summaryUrl) { gaps.push({sourceUrl,detail:"GOVINFO_GRANULE_SUMMARY_URL_MISSING"}); continue; }
        try {
          const route = providerPath(summaryUrl), summary = await savedRead(options, summaryUrl, `${packageId}:${string(row.granuleId) ?? summaryUrl}`, undefined, {name:"data_gov_api",provider:"govinfo",...route});
          const data = json(summary);
          if (!array(data.members).some(raw=>{const value=string(record(raw).state);return value&&[state.state,state.label].includes(value);} )) continue;
          acquisitions.push(acquisition(summary));
          const documentUrl = url(record(data.download).txtLink ?? record(data.download).htmlLink);
          let document = "", documentSource:{sourceUrl:string;collectedAt:string}|undefined;
          if (documentUrl) {
            try {
              const documentRoute = new URL(documentUrl).origin === "https://api.govinfo.gov" ? providerPath(documentUrl) : null;
              const captured = await savedRead(options, documentUrl, `${packageId}:${string(row.granuleId) ?? summaryUrl}:document`, undefined,
                documentRoute ? {name:"data_gov_api",provider:"govinfo",...documentRoute} : undefined);
              acquisitions.push(acquisition(captured)); document = acquisition(captured).body;documentSource={sourceUrl:captured.finalUrl,collectedAt:captured.retrievedAt};
            } catch (error) { gap(gaps, options, documentUrl, error); }
          }
          const parsed = normalizeGovinfoMember(data, document, options, summaryUrl, summary.retrievedAt,documentSource);
          roster.officeholders.push(...parsed.officeholders.filter(holder=>!roster.officeholders.some(prior=>prior.id===holder.id)));
          roster.divisions.push(...parsed.divisions); roster.unmatched.push(...parsed.unmatched);
        } catch(error) { gap(gaps,options,summaryUrl,error); }
      }
      sourceUrl = url(data.nextPage) ?? "";
    }
  } catch(error) { gap(gaps,options,sourceUrl || "https://api.govinfo.gov/collections/CDIR",error); }
  roster.currentMembershipComplete = false;
  return result(options,roster,acquisitions,gaps);
}
