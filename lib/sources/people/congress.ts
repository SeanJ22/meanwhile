import { officeIdentity } from "../../officials/office-identity.ts";
import type { OfficeholderSet } from "../../officials/types.ts";
import { acquisition, array, emptyPerson, emptyRoster, gap, json, number, provenance, record, result, savedRead, sourced, stateIdentity, string, url, type PeopleAcquisitionOptions, type PeopleSourceRelease } from "./common.ts";

export function normalizeCongressMember(value: unknown, options: PeopleAcquisitionOptions, sourceUrl: string, collectedAt: string): OfficeholderSet {
  const member = record(record(value).member), bioguide = string(member.bioguideId), name = string(member.directOrderName ?? member.name);
  if (!bioguide || !/^[A-Z]\d{6}$/.test(bioguide) || !name) throw new Error("CONGRESS_MEMBER_INVALID");
  const roster = emptyRoster(options.state, options.asOf);
  if (member.currentMember !== true) return roster;
  const terms = array(record(member.terms).item ?? member.terms).map(record);
  const term = terms.filter(row => ["House of Representatives", "Senate"].includes(string(row.chamber) ?? ""))
    .sort((a, b) => (number(b.startYear) ?? 0) - (number(a.startYear) ?? 0))[0];
  if (!term) throw new Error("CONGRESS_MEMBER_CURRENT_TERM_MISSING");
  const stateCode = string(term.stateCode ?? member.stateCode ?? term.stateName ?? member.state), state = stateIdentity(options.state);
  if (!stateCode) throw new Error(`CONGRESS_MEMBER_STATE_CODE_MISSING:${bioguide}`);
  if (![state.state.toLowerCase(),state.label.toLowerCase()].includes(stateCode.toLowerCase())) return roster;
  const chamber = term.chamber === "Senate" ? "senate" : "house", district = number(term.district ?? member.district);
  const source = provenance(sourceUrl, "Congress.gov / Library of Congress", collectedAt),personId=`congress-api:${bioguide}`, id = `congress-api:${state.state.toLowerCase()}:${bioguide}`;
  const holder = emptyPerson(id, name, chamber === "senate" ? "U.S. Senator" : string(term.memberType) ?? "U.S. Representative", state.state, source);
  holder.personId=personId;holder.level = "FEDERAL"; holder.chamber = chamber; holder.nativeIds = { bioguide: [bioguide], "congress-api": [bioguide] };
  // The API's year precision is retained; a day is never invented.
  holder.termStart = string(term.startDate) ?? (number(term.startYear) !== null ? String(term.startYear) : "");
  holder.termEnd = string(term.endDate) ?? (number(term.endYear) !== null ? String(term.endYear) : "");
  holder.birthDate = string(member.birthDate);
  holder.partyLabel = string(array(record(member.partyHistory).item ?? member.partyHistory).map(record).sort((a,b) => (number(b.startYear) ?? 0) - (number(a.startYear) ?? 0))[0]?.partyName ?? member.partyName);
  holder.websiteUrl = url(member.officialWebsiteUrl); holder.phone = string(record(member.addressInformation).phoneNumber);
  const depiction = record(member.depiction), imageUrl = url(depiction.imageUrl);
  if (imageUrl) holder.portraitCandidate = { imageUrl, sourceUrl, collectedAt };
  const divisionId = chamber === "senate" ? state.root : district === null ? undefined : `${state.root}/cd:${district === 0 || !state.root.includes("/state:") ? "at-large" : district}`;
  const membershipId = `${id}:${chamber}:${district ?? "state"}:${holder.termStart}`;
  holder.memberships = [{ id: membershipId, personId, officeId: `congress-office:${state.state}:${officeIdentity(chamber === "senate" ? "U.S. Senator" : "U.S. Representative")}:${district ?? "state"}`,
    jurisdiction: state.jurisdiction, chamber, district: district === null ? undefined : String(district), officeTitle: holder.officeTitle,
    level: "FEDERAL", current: true, divisionId, termStart: holder.termStart || null, termEnd: holder.termEnd || null, sourceUrl }];
  roster.officeholders.push(sourced(holder, source));
  if (divisionId) roster.divisions.push({ officeholderId: id, membershipId, ocdId: divisionId, bodyId: null });
  else roster.unmatched.push({ officeholderId: id, reason: "CONGRESS_MEMBER_DISTRICT_MISSING" });
  return roster;
}
export async function acquireCongressMembers(options: PeopleAcquisitionOptions): Promise<PeopleSourceRelease> {
  const acquisitions = [], gaps: { sourceUrl: string; detail: string }[] = [], roster = emptyRoster(options.state, options.asOf);
  let offset = 0, complete = false;
  const seen = new Set<string>(), offsets = new Set<number>();
  while (!complete) {
    options.signal.throwIfAborted();
    const path = `member/${options.state.toUpperCase()}`, params = { currentMember: "true", format: "json", limit: "250", offset: String(offset) }, sourceUrl = `https://api.congress.gov/v3/${path}?${new URLSearchParams(params)}`;
    try {
      if (offsets.has(offset)) throw new Error("CONGRESS_MEMBER_PAGINATION_CYCLE"); offsets.add(offset);
      const page = await savedRead(options, sourceUrl, `${options.state}:current-members:${offset}`, bytes => {
        const response = JSON.parse(new TextDecoder().decode(bytes)); if (!Array.isArray(response.members)) throw new Error("CONGRESS_MEMBER_LIST_INVALID");
      }, { name: "congress_api", path, params });
      acquisitions.push(acquisition(page));
      const data = json(page), members = array(data.members), pagination = record(data.pagination);
      for (const value of members) {
        const member = record(value), bioguide = string(member.bioguideId);
        if (!bioguide || !/^[A-Z]\d{6}$/.test(bioguide)) { gaps.push({sourceUrl,detail:"CONGRESS_MEMBER_LIST_ID_MISSING"}); continue; }
        if (seen.has(bioguide)) continue; seen.add(bioguide);
        const detailUrl = `https://api.congress.gov/v3/member/${bioguide}?format=json`;
        try {
          const detail = await savedRead(options, detailUrl, `member:${bioguide}`, bytes => {
            const response = JSON.parse(new TextDecoder().decode(bytes)); if (response.member?.bioguideId !== bioguide) throw new Error("CONGRESS_MEMBER_ID_MISMATCH");
          }, { name: "congress_api", path: `member/${bioguide}`, params: { format: "json" } });
          const parsed = normalizeCongressMember(json(detail), options, detailUrl, detail.retrievedAt);
          // Keep the national index, and each member's own document in its state shard.
          if (parsed.officeholders.length) { acquisitions.push(acquisition(detail)); roster.officeholders.push(...parsed.officeholders); roster.divisions.push(...parsed.divisions); roster.unmatched.push(...parsed.unmatched); await options.onPerson?.(result(options,roster,acquisitions,gaps)); }
        } catch (error) { gap(gaps, options, detailUrl, error); }
      }
      const next = url(pagination.next);
      if (next) {
        const parsed = new URL(next); if (parsed.origin !== "https://api.congress.gov" || parsed.pathname.replace(/\/$/, "") !== `/v3/${path}`) throw new Error("CONGRESS_MEMBER_NEXT_URL_INVALID");
        const nextOffset = number(parsed.searchParams.get("offset")); if (nextOffset === null || nextOffset <= offset) throw new Error("CONGRESS_MEMBER_NEXT_OFFSET_INVALID"); offset = nextOffset;
      } else {
        const count = number(pagination.count);
        if (count !== null && seen.size < count) throw new Error(`CONGRESS_MEMBER_PAGINATION_INCOMPLETE:${seen.size}:${count}`);
        complete = true;
      }
    } catch (error) { gap(gaps, options, sourceUrl, error); break; }
  }
  roster.currentMembershipComplete = complete && !gaps.length && roster.officeholders.length > 0;
  return result(options, roster, acquisitions, gaps);
}
