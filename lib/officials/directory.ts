import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The congress-legislators directory table (item 7, 2026-08-16).
 *
 * Read once per process from `data/congress-legislators/directory.json`,
 * which `pnpm congress:migrate` derives from the SHA-pinned snapshot. Never a
 * live fetch, never YAML at runtime.
 *
 * **Kept out of the coverage payload on purpose.** 3,891 committee
 * membership rows and 1,306 district offices have no business travelling
 * with every map click; the battlecard asks for one member's slice when it
 * opens, the same way it already asks for one member's votes.
 */

export interface DirectoryOffice {
  city: string | null;
  state: string | null;
  address: string | null;
  zip: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
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

interface DirectoryFile {
  source: DirectorySource;
  counts: Record<string, number>;
  committees: Record<
    string,
    { name: string; type: string; url: string | null; jurisdiction: string | null; jurisdictionSource: string | null }
  >;
  byMember: Record<string, MemberDirectoryEntry>;
}

let cache: DirectoryFile | null = null;

/** Throws if the table is missing — callers choose their honest fallback. */
function load(): DirectoryFile {
  cache ??= JSON.parse(
    readFileSync(
      join(process.cwd(), "data", "congress-legislators", "directory.json"),
      "utf8",
    ),
  ) as DirectoryFile;
  return cache;
}

export function directorySource(): DirectorySource {
  return load().source;
}

/**
 * One member's slice, joined by BIOGUIDE — never by name.
 *
 * `congress:A000370` → `A000370`. A holder id in any other namespace is not
 * a federal member and returns null, which is a real answer: the source's
 * scope is sitting federal members, and a scope is not widened by wanting it
 * to be.
 */
export function directoryFor(holderId: string): {
  source: DirectorySource;
  entry: MemberDirectoryEntry;
  committeeJurisdictions: Record<string, { jurisdiction: string | null; jurisdictionSource: string | null; url: string | null }>;
} | null {
  if (!holderId.startsWith("congress:")) return null;
  const bioguide = holderId.slice("congress:".length);

  // An unavailable normalized holding is a failed read, never an empty member.
  const file = load();

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
