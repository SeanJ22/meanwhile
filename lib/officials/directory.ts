import { getFederalDirectoryFile } from "./federal-directory-read-model.ts";

/**
 * The congress-legislators directory, read from the GOOD federal-directory projection. Kept out of the coverage
 * payload: the battlecard asks for one member's slice when it opens.
 */

export interface DirectoryOffice {
  city: string | null;
  state: string | null;
  address: string | null;
  zip: string | null;
  phone: string | null;
  email?: string | null;
  lat: number | null;
  lng: number | null;
  geocodedPoint?: import("./office-points-publication.ts").PublishedOfficePoint;
}

export interface DirectoryCommittee {
  committeeId: string;
  name: string;
  /** The chamber's own rank on the committee, where the file states one. */
  rank: number | null;
  /** "Chair", "Ranking Member", … as filed. Null is the ordinary case. */
  title: string | null;
}

export interface DirectorySource {
  project: string;
  repoUrl: string;
  sha: string;
  licence: string;
  licenceUrl: string;
  sourceOrg: string;
  collectedAt: string;
}

export interface MemberDirectoryEntry {
  districtOffices: DirectoryOffice[];
  committees: DirectoryCommittee[];
}

export interface DirectoryFile {
  source: DirectorySource;
  counts: Record<string, number>;
  committees: Record<
    string,
    { name: string; type: string; url: string | null; jurisdiction: string | null; jurisdictionSource: string | null }
  >;
  byMember: Record<string, MemberDirectoryEntry>;
}

export function directorySource(): DirectorySource {
  return getFederalDirectoryFile().source;
}

/** One member's slice, joined by BIOGUIDE, never by name; a non-federal holder id returns null. */
export function directoryFor(holderId: string): {
  source: DirectorySource;
  entry: MemberDirectoryEntry;
  committeeJurisdictions: Record<string, { jurisdiction: string | null; jurisdictionSource: string | null; url: string | null }>;
} | null {
  if (!holderId.startsWith("congress:")) return null;
  const bioguide = holderId.slice("congress:".length);

  // An unavailable normalized holding is a failed read, never an empty member.
  const file = getFederalDirectoryFile();

  const entry = file.byMember[bioguide];
  if (!entry) return null;

  const jurisdictions: Record<
    string,
    { jurisdiction: string | null; jurisdictionSource: string | null; url: string | null }
  > = {};
  for (const seat of entry.committees) {
    const committee = file.committees[seat.committeeId];
    if (!committee) continue;
    jurisdictions[seat.committeeId] = {
      jurisdiction: committee.jurisdiction,
      jurisdictionSource: committee.jurisdictionSource,
      url: committee.url,
    };
  }

  return { source: file.source, entry, committeeJurisdictions: jurisdictions };
}
