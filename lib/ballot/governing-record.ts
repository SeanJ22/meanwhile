import type { SeatHolder } from "../officials/lookup.ts";
import { seatHolderById } from "../registry/server.ts";
import { readerPersonKeys } from "../identity/reader-person.ts";
import { candidacyOfficialIdentityStatus, currentOfficialIdentity, currentOfficialIdentityStatus, resolvedCandidacyForOfficial } from "../funding/campaign-money.ts";
import { incumbentHolderFor } from "./incumbent-record.ts";

interface GoverningRecordSources {
  personKeys: typeof readerPersonKeys;
  officialIdentity: typeof currentOfficialIdentity;
  officialStatus: typeof currentOfficialIdentityStatus;
  candidacyStatus: typeof candidacyOfficialIdentityStatus;
  candidacyForOfficial: typeof resolvedCandidacyForOfficial;
  federalPersonHolder: typeof incumbentHolderFor;
  holderById: typeof seatHolderById;
}

/**
 * The person whose held record a Reader card may show, independently of the
 * contested office. Only committed person links participate; the exact-seat
 * incumbency resolver remains responsible for the badge. Conflicting or stale
 * identities keep the existing gap instead of borrowing another person's votes.
 */
export async function governingRecordHolderFor(
  subjectId: string,
  sources: GoverningRecordSources = {
    personKeys: readerPersonKeys,
    officialIdentity: currentOfficialIdentity,
    officialStatus: currentOfficialIdentityStatus,
    candidacyStatus: candidacyOfficialIdentityStatus,
    candidacyForOfficial: resolvedCandidacyForOfficial,
    federalPersonHolder: incumbentHolderFor,
    holderById: seatHolderById,
  },
): Promise<SeatHolder | null> {
  const identity = sources.personKeys(subjectId);
  if (identity.status === "IDENTITY_UNRESOLVED") return null;
  const ids = new Set<string>();
  for (const key of identity.keys) {
    if (sources.officialStatus(key) === "IDENTITY_UNRESOLVED"
      || sources.candidacyStatus(key) === "IDENTITY_UNRESOLVED") return null;
    const official = sources.officialIdentity(key);
    if (official) ids.add(official.id);
  }
  // Preserve the existing exact FEC/bioguide person bridge for federal cards.
  // Its historical function name does not establish contested-seat incumbency.
  const federal = await sources.federalPersonHolder(subjectId);
  if (federal) ids.add(federal.id);
  if (ids.size > 1) {
    const candidacies = [...ids].map(id => sources.candidacyForOfficial(id)?.candidacyId);
    if (candidacies.some(id => !id) || new Set(candidacies).size !== 1) return null;
    // One canonical person can hold a legislative seat and a delegation role.
    // The legislative roster owns roll calls; a second role is not a second
    // person. Multiple legislative identities still require reconciliation.
    const legislative = [...ids].filter(id => /^(?:congress|plural):/.test(id));
    return legislative.length === 1 ? sources.holderById(legislative[0]) : null;
  }
  return ids.size === 1 ? sources.holderById([...ids][0]) : null;
}
