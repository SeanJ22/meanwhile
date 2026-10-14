import { officeIdentity } from "../../officials/office-identity.ts";
import type { OfficeholderSet } from "../../officials/types.ts";
import { acquisition, appendRoster, array, emptyPerson, emptyRoster, gap, json, legislativeDivision, number, provenance, record, result, savedRead, sourced, stateIdentity, string, url, type PeopleAcquisitionOptions, type PeopleSourceRelease } from "./common.ts";

let pending: Promise<unknown> = Promise.resolve();
async function oneRequest<T>(read: () => Promise<T>): Promise<T> {
  const next = pending.then(read, read); pending = next.catch(() => undefined); return next;
}
export function currentLegiscanSessions(value: unknown, asOf: string): Record<string, unknown>[] {
  const year = new Date(asOf).getUTCFullYear();
  const sessions = array(value).map(record).filter(row => number(row.session_id) !== null);
  const inYear = sessions.filter(row => (number(row.year_start) ?? Infinity) <= year && (number(row.year_end) ?? -Infinity) >= year);
  if (inYear.length) return inYear;
  const latest = sessions.filter(row => (number(row.year_start) ?? Infinity) <= year)
    .sort((left, right) => (number(right.year_start) ?? 0) - (number(left.year_start) ?? 0) || (number(right.session_id) ?? 0) - (number(left.session_id) ?? 0))[0];
  return latest ? [latest] : [];
}
export function normalizeLegiscanPeople(value: unknown, options: PeopleAcquisitionOptions, sourceUrl: string, collectedAt: string, sessionId: number): OfficeholderSet {
  const payload = record(record(value).sessionpeople), people = array(payload.people);
  if (number(payload.session_id) !== sessionId || !people.length) throw new Error("LEGISCAN_SESSION_PEOPLE_INVALID");
  const roster = emptyRoster(options.state, options.asOf), state = stateIdentity(options.state);
  for (const raw of people) {
    const row = record(raw), native = number(row.people_id), name = string(row.name), district = string(row.district);
    const role = string(row.role), roleId = number(row.role_id);
    const chamber = /^(?:sen|senator|senate)$/i.test(role ?? "") || roleId === 2 ? "upper" : /^(?:rep|representative|assembly|assemblyman|assemblywoman|house|delegate)$/i.test(role ?? "") || roleId === 1 ? "lower" : null;
    if (native === null || !name || !chamber || !district) { roster.unmatched.push({ officeholderId: `legiscan:${state.state.toLowerCase()}:${native ?? "unknown"}`, reason: "LEGISCAN_PERSON_OFFICE_UNRESOLVED" }); continue; }
    const personId=`legiscan:${native}`,id = `legiscan:${state.state.toLowerCase()}:${native}`, source = provenance(sourceUrl, "LegiScan (CC BY 4.0)", collectedAt);
    const holder = emptyPerson(id, name, role ?? (chamber === "upper" ? "State Senator" : "State Representative"), state.state, source);
    const nativeIds: Record<string, string[]> = { legiscan: [String(native)] };
    for (const [key, provider] of [["votesmart_id", "votesmart"], ["ftm_eid", "followthemoney"], ["opensecrets_id", "opensecrets"], ["ballotpedia", "ballotpedia"], ["bioguide_id", "bioguide"], ["openstates_id", "ocd-person"], ["wikidata_id", "wikidata"]]) {
      const value = string(row[key]) ?? (number(row[key]) ? String(row[key]) : null); if (value && value !== "0") nativeIds[provider] = [value];
    }
    holder.personId=personId;holder.nativeIds = nativeIds; holder.chamber = chamber; holder.partyLabel = string(row.party); holder.websiteUrl = url(row.url ?? row.website);
    holder.phone = string(row.phone); holder.email = string(row.email);
    const divisionId = legislativeDivision(options, chamber, district), membershipId = `${id}:${sessionId}:${chamber}:${district}`;
    holder.memberships = [{ id: membershipId, personId, officeId: `legiscan-office:${state.state}:${officeIdentity(chamber === "upper" ? "State Senator" : "State Representative")}:${district}`, jurisdiction: state.jurisdiction,
      chamber, district, officeTitle: holder.officeTitle, level: "STATE", current: true, divisionId, sourceUrl }];
    roster.officeholders.push(sourced(holder, source));
    if (divisionId) roster.divisions.push({ officeholderId: id, membershipId, ocdId: divisionId, bodyId: null });
    else roster.unmatched.push({ officeholderId: id, reason: `LEGISCAN_DISTRICT_UNRESOLVED:${chamber}:${district}` });
  }
  return roster;
}
export async function acquireLegiscanPeople(options: PeopleAcquisitionOptions): Promise<PeopleSourceRelease> {
  const acquisitions = [], gaps: { sourceUrl: string; detail: string }[] = [], roster = emptyRoster(options.state, options.asOf);
  const params = { op: "getSessionList", state: options.state.toUpperCase() }, indexUrl = `https://api.legiscan.com/?${new URLSearchParams(params)}`;
  try {
    const index = await oneRequest(() => savedRead(options, indexUrl, `${options.state}:sessions`, bytes => {
      const response = JSON.parse(new TextDecoder().decode(bytes)); if (response.status !== "OK" || !Array.isArray(response.sessions)) throw new Error("LEGISCAN_SESSION_LIST_INVALID");
    }, { name: "legiscan_api", path: "", params }));
    acquisitions.push(acquisition(index));
    const sessions = currentLegiscanSessions(json(index).sessions, options.asOf);
    if (!sessions.length) throw new Error("LEGISCAN_CURRENT_SESSION_NOT_FOUND");
    for (const session of sessions) {
      const sessionId = number(session.session_id)!, params = { op: "getSessionPeople", id: String(sessionId) }, sourceUrl = `https://api.legiscan.com/?${new URLSearchParams(params)}`;
      try {
        const release = await oneRequest(() => savedRead(options, sourceUrl, `session:${sessionId}:people`, bytes => {
          const response = JSON.parse(new TextDecoder().decode(bytes)); if (response.status !== "OK" || number(response.sessionpeople?.session_id) !== sessionId) throw new Error("LEGISCAN_SESSION_PEOPLE_INVALID");
        }, { name: "legiscan_api", path: "", params }));
        acquisitions.push(acquisition(release));
        const parsed = normalizeLegiscanPeople(json(release), options, sourceUrl, release.retrievedAt, sessionId);
        appendRoster(roster,parsed);
        if(parsed.officeholders.length)await options.onPerson?.(result(options,roster,acquisitions,gaps));
      } catch (error) { gap(gaps, options, sourceUrl, error); }
    }
    // Special-session rosters are positive facts; they cannot retire a regular-session membership.
    roster.currentMembershipComplete = false;
  } catch (error) { gap(gaps, options, indexUrl, error); }
  return result(options, roster, acquisitions, gaps);
}
