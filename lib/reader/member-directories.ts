import { federalOfficeRecordsForMember, officeRecordsForHolder, officesForMember } from "../officials/member-offices.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import type { MemberDirectory } from "../../hooks/use-member-directory.ts";
import type { MemberOfficeRecord } from "../officials/member-offices.ts";
import type { FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { Officeholder } from "../officials/types.ts";

export interface ReaderMemberDirectory {
  readonly ids: readonly string[];
  readonly directory: MemberDirectory;
}

/** The same sourced office records as the member endpoint, carried once with their exact aliases. */
export function stateMemberDirectories(roster: OfficeholderSet | null, curated: readonly MemberOfficeRecord[] = [], includeEmpty = false): ReaderMemberDirectory[] {
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
    if (!records.length && !includeEmpty) return [];
    const unambiguous = ids.filter(id => identities.get(id) === 1);
    if (!unambiguous.length) return [];
    return [{ ids: unambiguous, directory: {
      source: null, districtOffices: records.map(record => record.office), committees: [],
      officeDetails: records.map(({ officeKind, sourceUrl, sourceOrg, collectedAt, official }) => ({ officeKind, sourceUrl, sourceOrg, collectedAt, official })),
    } }];
  });
}

/** Carry only the ZIP's representatives' already held offices, including recorded gaps, before pins mount. */
export function zipMemberDirectories(people: OfficeholderSet | null, curated: readonly MemberOfficeRecord[],
  federal: FederalDirectoryReadModel | null, holders: readonly Pick<Officeholder, "id" | "personId" | "nativeIds">[]): ReaderMemberDirectory[] {
  const ids = new Set(holders.flatMap(holder => [...personIdentityKeys(holder)]));
  const state = stateMemberDirectories(people, curated, true).filter(row => row.ids.some(id => ids.has(id)));
  if (!federal) return state;
  const delegation = federal.roster.officeholders.filter(holder => ids.has(holder.id)).map(holder => {
    const entry = federal.directory.byMember[holder.id.slice(9)];
    const offices = entry ? federalOfficeRecordsForMember(federal, holder.id) : [];
    return { ids: [...personIdentityKeys(holder)], directory: {
      source: entry ? federal.directory.source : null,
      districtOffices: offices.map(row => row.office),
      officeDetails: offices.map(({ officeKind, sourceUrl, sourceOrg, collectedAt, official }) => ({ officeKind, sourceUrl, sourceOrg, collectedAt, official })),
      committees: entry?.committees.map(seat => ({ ...seat, ...federal.directory.committees[seat.committeeId] })) ?? [],
    } };
  });
  return [...state, ...delegation];
}
