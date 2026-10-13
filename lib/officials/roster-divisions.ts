import { designationKey, indexDivisions, type RegistryDivisionLite } from "../sources/plural/index.ts";
import type { OfficeholderSet } from "./types.ts";

/** The government's statutory district joins the Census label within that state and chamber. */
export function attachOfficialRosterDivisions(roster: OfficeholderSet, state: string, divisions: readonly RegistryDivisionLite[]): OfficeholderSet {
  const index = indexDivisions([...divisions]);
  const links = [...roster.divisions];
  const matched = new Set<string>();
  const officeholders = roster.officeholders.map(person => ({...person, memberships: person.memberships?.map(membership => {
    const division = membership.district && membership.chamber ? index.get(`${state.toLowerCase()}|${membership.chamber}|${designationKey(membership.district)}`) : undefined;
    if (!division) return membership;
    // A statutory label is the bridge when the Census code differs from the source's district number.
    for (let index = links.length - 1; index >= 0; index--) if (links[index].officeholderId === person.id && links[index].membershipId === membership.id) links.splice(index, 1);
    links.push({officeholderId: person.id, membershipId: membership.id, ocdId: division, bodyId: null});
    matched.add(person.id);
    return {...membership, divisionId: division};
  })}));
  const vacancies = roster.vacancies?.map(row => {
    const division = row.district && row.chamber ? index.get(`${state.toLowerCase()}|${row.chamber}|${designationKey(row.district)}`) : undefined;
    if (division) matched.add(row.id);
    return division ? {...row, divisionId: division} : row;
  });
  return {...roster, officeholders, vacancies, divisions: links, unmatched: roster.unmatched.filter(row => !matched.has(row.officeholderId))};
}
