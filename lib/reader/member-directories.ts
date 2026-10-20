import { officeRecordsForHolder, officesForMember } from "../officials/member-offices.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import type { MemberDirectory } from "../../hooks/use-member-directory.ts";
import type { MemberOfficeRecord } from "../officials/member-offices.ts";

export interface ReaderMemberDirectory {
  readonly ids: readonly string[];
  readonly directory: MemberDirectory;
}

/** The same sourced office records as the member endpoint, carried once with their exact aliases. */
export function stateMemberDirectories(roster: OfficeholderSet | null, curated: readonly MemberOfficeRecord[] = []): ReaderMemberDirectory[] {
  if (!roster) return [];
  const identities = new Map<string, number>();
  const curatedByPerson = new Map<string, MemberOfficeRecord[]>();
  for (const record of curated) {
    const records = curatedByPerson.get(record.officeholderId) ?? [];
    records.push(record); curatedByPerson.set(record.officeholderId, records);
  }
  const people = roster.officeholders.map(holder => ({ holder, ids: [...personIdentityKeys(holder)] }));
  for (const { ids } of people) for (const id of ids) identities.set(id, (identities.get(id) ?? 0) + 1);
  return people.flatMap(({ holder, ids }) => {
    const native = officesForMember(officeRecordsForHolder(holder), holder.id);
    const exactIds = new Set(ids.filter(id => identities.get(id) === 1));
    const records = native.length ? native : [...new Map([...exactIds].flatMap(id => curatedByPerson.get(id) ?? []).map(record => [record.id, record])).values()]
      .sort((a, b) => a.officeKind === b.officeKind ? 0 : a.officeKind === "CAPITOL" ? -1 : 1);
    if (!records.length) return [];
    const unambiguous = ids.filter(id => identities.get(id) === 1);
    if (!unambiguous.length) return [];
    return [{ ids: unambiguous, directory: {
      source: null, districtOffices: records.map(record => record.office), committees: [],
      officeDetails: records.map(({ officeKind, sourceUrl, sourceOrg, collectedAt, official }) => ({ officeKind, sourceUrl, sourceOrg, collectedAt, official })),
    } }];
  });
}
