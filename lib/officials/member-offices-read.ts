/**
 * A state legislator's capitol and district offices, for the reader.
 *
 * Production reads only the promoted `member-offices` pointer, which the
 * routine runner refreshes daily (lib/officials/member-offices-publication.ts).
 * A route settles the read first (`settleMemberOfficesRead`: the reader edge's
 * proven copy, else the database), then asks synchronously per member.
 *
 * The offices are an independent optional projection: before the first
 * promotion, or on a store failure, a member simply shows no offices and the
 * roster itself is never blocked.
 */
import { currentCuratedReaderRecords } from "../civic-data/curated-reader-read-model.ts";
import { officeholderIdentityMayEnterReader } from "./roster-authority.ts";
import { officesForMember, type MemberOfficeRecord } from "./member-offices.ts";

export { refreshMemberOfficesFromPromoted, settleMemberOfficesRead } from "../civic-data/curated-reader-read-model.ts";

/** One member's held offices, capitol first; empty when none are held or the projection is unread. */
export function currentMemberOffices(officeholderId: string): readonly MemberOfficeRecord[] {
  if (!officeholderIdentityMayEnterReader(officeholderId)) return [];
  let records: readonly MemberOfficeRecord[];
  try {
    records = currentCuratedReaderRecords<MemberOfficeRecord>("member-offices", []);
  } catch {
    // Not read for this process, NOT_RECORDED, or unreachable: withhold offices, never the member.
    return [];
  }
  return officesForMember(records, officeholderId);
}
