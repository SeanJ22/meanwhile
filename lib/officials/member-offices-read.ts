import { currentCuratedReaderRecords } from "../civic-data/curated-reader-read-model.ts";
import { officesForMember, type MemberOfficeRecord } from "./member-offices.ts";
import { fromMemberOffice, type OfficeLocation } from "./office-locations.ts";

export { refreshMemberOfficesFromPromoted, settleMemberOfficesRead } from "../civic-data/curated-reader-read-model.ts";

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
