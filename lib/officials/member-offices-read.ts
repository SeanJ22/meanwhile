import { currentCuratedReaderRecords } from "../civic-data/curated-reader-held.ts";
import { readMemberOfficeMembers } from "./member-office-data.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { readMemberOfficeStateProjection } from "../civic-data/curated-reader-read-model.ts";
import { CivicDataStoreUnavailableError, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { currentReaderAuthorityEdge, currentStateLegislatorsEdge, refuseDatabaseInEdgeOnlyContext } from "../registry/runtime-edge.ts";
import { selectedRegistryStates } from "../registry/runtime-read-model.ts";
import { readFederalDirectoryProjection } from "../reader/authority-reads.ts";
import { readStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { readStatePersonStore } from "../reader/state.ts";
import { federalOfficeRecordsForMember, officeRecordsForHolder, officesForMember, type MemberOfficeRecord } from "./member-offices.ts";
import { fromMemberOffice, type OfficeLocation } from "./office-locations.ts";
import { personIdentityKeys, statePeopleScopeForId } from "./people-identity.ts";
import { readerRecordsWithOwnerChoices } from "../facts/owner-flags.ts";
import { factReader } from "../facts/db.ts";

export { refreshMemberOfficesFromPromoted,  } from "../civic-data/curated-reader-read-model.ts";

/** Core people publication makes its offices immediately available; one request loads one state. */
export async function readMemberOffices(officeholderId: string, state?: string, options: PromotedCivicDataReadOptions = {}): Promise<readonly MemberOfficeRecord[]> {
  const owned = (records: readonly MemberOfficeRecord[]) => readerRecordsWithOwnerChoices(factReader(),"member-offices",records);
  if(/^congress:[A-Z]\d{6}$/.test(officeholderId)) {
    const places=state ? [state.replace(/^US-/i,"")] : selectedRegistryStates();
    if(!places.length) return [];
    const read=await readFederalDirectoryProjection(places,options);
    if(read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
    if(read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") return [];
    return owned(federalOfficeRecordsForMember(read.value,officeholderId));
  }
  const jurisdiction = statePeopleScopeForId(officeholderId,state);
  const aliases = new Set([officeholderId]);
  let knownPerson = false;
  if (jurisdiction) {
    const edge = options.store ? null : currentStateLegislatorsEdge();
    const served = edge ? await edge.load(jurisdiction) : null;
    let roster = served?.value?.roster;
    if (!served) {
      refuseDatabaseInEdgeOnlyContext(`The ${jurisdiction} member offices`);
      const read = await readStatePeopleProjection(jurisdiction, { ...options, store: options.store ?? (currentReaderAuthorityEdge() ? undefined : await readStatePersonStore(jurisdiction, officeholderId)) });
      if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
      if (read.kind === "PROMOTED" || read.kind === "BOOTSTRAP") roster = read.value.roster;
    }
    const matches = roster?.officeholders.filter(holder => personIdentityKeys(holder).has(officeholderId)) ?? [];
    if (matches.length === 1) {
      knownPerson = true;
      for (const key of personIdentityKeys(matches[0])) aliases.add(key);
      const records = officeRecordsForHolder(matches[0]);
      if (records.length) return owned(officesForMember(records,matches[0].id));
    }
  }
  if(jurisdiction) {
    const read=await readMemberOfficeStateProjection(jurisdiction.slice(3),options,[...aliases]);
    if(read.kind==="STORE_UNREACHABLE"){if(knownPerson)return [];throw new CivicDataStoreUnavailableError(read);}
    if(read.kind==="PROMOTED"||read.kind==="BOOTSTRAP")return owned(read.value.records as unknown as readonly MemberOfficeRecord[]);
  }
  const store=options.store as Partial<Pick<RoutineDataStore,"readMemberOfficeMembers">> | undefined;
  const query=store?.readMemberOfficeMembers ? null : readerQuery();
  if(store?.readMemberOfficeMembers)return owned(await store.readMemberOfficeMembers([...aliases]));
  if(query)return owned(await readMemberOfficeMembers(async(text,params)=>(await query([{text,params:params??[]}]))[0]??[],[...aliases]));
  return owned([...new Map([...aliases].flatMap(currentMemberOffices).map(row => [row.id,row])).values()]);
}

export async function readOfficeLocations(officeholderId: string, state?: string, options: PromotedCivicDataReadOptions = {}): Promise<readonly OfficeLocation[]> {
  return (await readMemberOffices(officeholderId,state,options)).map(fromMemberOffice).filter((row):row is OfficeLocation => row !== null);
}

/** One member's held offices, capitol first; empty when none are held or the projection is unread. */
export function currentMemberOffices(officeholderId: string): readonly MemberOfficeRecord[] {
  let records: readonly MemberOfficeRecord[];
  try {
    records = currentCuratedReaderRecords<MemberOfficeRecord>("member-offices", []);
  } catch {
    // Not read for this process, NOT_RECORDED, or unreachable: withhold offices, never the member.
    return [];
  }
  return officesForMember(records, officeholderId);
}
