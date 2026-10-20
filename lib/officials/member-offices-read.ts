import { currentCuratedReaderRecords, refreshMemberOfficesFromPromoted, settleMemberOfficesRead } from "../civic-data/curated-reader-read-model.ts";
import { CivicDataStoreUnavailableError, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { currentReaderAuthorityEdge, currentStateLegislatorsEdge, refuseDatabaseInEdgeOnlyContext } from "../registry/runtime-edge.ts";
import { selectedRegistryStates } from "../registry/runtime-read-model.ts";
import { readFederalDirectoryProjection } from "../reader/authority-reads.ts";
import { readStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { federalOfficeRecordsForMember, officeRecordsForHolder, officesForMember, type MemberOfficeRecord } from "./member-offices.ts";
import { fromMemberOffice, type OfficeLocation } from "./office-locations.ts";
import { personIdentityKeys, statePeopleScopeForId } from "./people-identity.ts";
import { readMemberOfficeRecords } from "./member-office-projection.ts";

export { refreshMemberOfficesFromPromoted, settleMemberOfficesRead } from "../civic-data/curated-reader-read-model.ts";
export { readMemberOfficeProjection } from "./member-office-projection.ts";

/** Core people publication makes its offices immediately available; one request loads one state. */
export async function readMemberOffices(officeholderId: string, state?: string, options: PromotedCivicDataReadOptions = {}): Promise<readonly MemberOfficeRecord[]> {
  if(/^congress:[A-Z]\d{6}$/.test(officeholderId)) {
    const places=state ? [state.replace(/^US-/i,"")] : selectedRegistryStates();
    if(!places.length) return [];
    const read=await readFederalDirectoryProjection(places,options);
    if(read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
    if(read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") return [];
    return federalOfficeRecordsForMember(read.value,officeholderId);
  }
  const jurisdiction = statePeopleScopeForId(officeholderId,state);
  const aliases = new Set([officeholderId]);
  let knownPerson = false;
  if (jurisdiction) {
    let roster: import("./types.ts").OfficeholderSet | undefined;
    if (!options.store && !currentReaderAuthorityEdge()) {
      const { readStatePackage } = await import("../reader/state.ts");
      roster = (await readStatePackage(jurisdiction.slice(3))).people ?? undefined;
    } else {
      const edge = options.store ? null : currentStateLegislatorsEdge();
      const served = edge ? await edge.load(jurisdiction) : null;
      roster = served?.value?.roster;
      if (!served) {
        refuseDatabaseInEdgeOnlyContext(`The ${jurisdiction} member offices`);
        const read = await readStatePeopleProjection(jurisdiction, options);
        if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
        if (read.kind === "PROMOTED" || read.kind === "BOOTSTRAP") roster = read.value.roster;
      }
    }
    const matches = roster?.officeholders.filter(holder => personIdentityKeys(holder).has(officeholderId)) ?? [];
    if (matches.length === 1) {
      knownPerson = true;
      for (const key of personIdentityKeys(matches[0])) aliases.add(key);
      const records = officeRecordsForHolder(matches[0]);
      if (records.length) return officesForMember(records,matches[0].id);
    }
  }
  if (jurisdiction) {
    try {
      const records = await readMemberOfficeRecords(jurisdiction.slice(3), options);
      return [...new Map([...aliases].flatMap(id => officesForMember(records, id)).map(row => [row.id, row])).values()];
    } catch (error) { if (knownPerson) return []; throw error; }
  }
  try { if(options.store) await refreshMemberOfficesFromPromoted(options); else await settleMemberOfficesRead(); }
  catch (error) { if (knownPerson) return []; throw error; }
  return [...new Map([...aliases].flatMap(currentMemberOffices).map(row => [row.id,row])).values()];
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

/** The same held offices as the one office-location shape, for Ask and cards. */
export function currentOfficeLocations(officeholderId: string): readonly OfficeLocation[] {
  return currentMemberOffices(officeholderId).map(fromMemberOffice).filter((row): row is OfficeLocation => row !== null);
}
