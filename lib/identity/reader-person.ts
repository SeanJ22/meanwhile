import { currentOfficialIdentityStatus, officialIdsForCandidacy, resolvedCandidacyForOfficial } from "../funding/campaign-money.ts";
import { azLineupReconciliation, reconciledCandidacyIdForCard } from "./az-2026.ts";
import { currentRosterMemberReaderDisposition } from "../registry/body-rosters.ts";
import { fecPersonKeys } from "../funding/snapshot.ts";

/** Exact committed person relationships; no names participate in reader joins. */
export function readerPersonKeys(subjectId: string): { status: "RESOLVED" | "DIRECT" | "IDENTITY_UNRESOLVED"; keys: string[] } {
  const rosterIdentity = currentRosterMemberReaderDisposition(subjectId);
  if (rosterIdentity?.state === "IDENTITY_UNRESOLVED") return { status: "IDENTITY_UNRESOLVED", keys: [] };
  if (rosterIdentity?.state === "EXACT_DUPLICATE") return readerPersonKeys(rosterIdentity.canonicalId!);
  if (currentOfficialIdentityStatus(subjectId) === "IDENTITY_UNRESOLVED") return { status: "IDENTITY_UNRESOLVED", keys: [] };
  const keys = new Set<string>();
  const pending = [subjectId];
  while (pending.length) {
    const key = pending.shift()!;
    if (!key || keys.has(key)) continue;
    keys.add(key);
    for (const related of fecPersonKeys(key)) if (!keys.has(related)) pending.push(related);
    const isAzCandidacy = key.startsWith("ballot-az-");
    const azRows = isAzCandidacy ? azLineupReconciliation()?.rows ?? [] : [];
    const candidacy = resolvedCandidacyForOfficial(key)?.candidacyId
      ?? (isAzCandidacy ? reconciledCandidacyIdForCard(key) : null);
    if (candidacy && !keys.has(candidacy)) pending.push(candidacy);
    for (const officialId of officialIdsForCandidacy(key)) if (!keys.has(officialId)) pending.push(officialId);
    for (const row of azRows) if (row.outcome === "RECONCILED" && row.canonicalCandidacyId === key && !keys.has(row.cardKey)) pending.push(row.cardKey);
  }
  return { status: keys.size > 1 ? "RESOLVED" : "DIRECT", keys: [...keys].sort() };
}

export class ReaderPersonIdentityError extends Error {
  readonly code = "READER_PERSON_IDENTITY_UNRESOLVED";
  constructor() { super("The supplied identity could not be verified against the current canonical person; no other person's records were attached."); this.name = "ReaderPersonIdentityError"; }
}

export function verifiedReaderPersonKeys(subjectId: string): string[] {
  const identity = readerPersonKeys(subjectId);
  if (identity.status === "IDENTITY_UNRESOLVED") throw new ReaderPersonIdentityError();
  return identity.keys;
}
