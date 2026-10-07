"use client";

import { useEffect, useState } from "react";

import type { DirectoryOffice, DirectorySource } from "@/lib/officials/directory";
import { memberDirectoryReaches } from "@/lib/officials/member-directory-scope";

/**
 * One federal member's district offices and committee seats, shared by every
 * component that needs them. The cache holds the promise per member id, so
 * simultaneous mounts share one request; failures are not cached.
 */

/**
 * A committee seat as the route serves it: the chamber's row plus the joined
 * jurisdiction statement. Distinct from the on-disk `DirectoryCommittee`.
 */
export interface DirectoryCommitteeSeat {
  committeeId: string;
  name: string;
  rank: number | null;
  title: string | null;
  jurisdiction?: string | null;
  jurisdictionSource?: string | null;
  url?: string | null;
}

export interface MemberDirectory {
  source?: DirectorySource | null;
  districtOffices: DirectoryOffice[];
  committees: DirectoryCommitteeSeat[];
  /**
   * A state legislator's offices, in the same order as `districtOffices`:
   * which office each is, and the source it was read from. Absent for a
   * federal member, whose offices are all in the district.
   */
  officeDetails?: { officeKind: "CAPITOL" | "DISTRICT"; sourceUrl: string; sourceOrg: string; collectedAt: string; official: boolean }[];
}

const cache = new Map<string, Promise<MemberDirectory>>();

export function isFederalMember(id: string): boolean {
  return id.startsWith("congress:");
}

export function loadMemberDirectory(memberId: string): Promise<MemberDirectory> {
  const existing = cache.get(memberId);
  if (existing) return existing;

  const promise = (async () => {
    const response = await fetch(
      `/api/directory?member=${encodeURIComponent(memberId)}`,
    );
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as MemberDirectory;
  })().catch((error) => {
    cache.delete(memberId);
    throw error;
  });

  cache.set(memberId, promise);
  return promise;
}

export interface MemberDirectoryState {
  /** Null while in flight, and null when the member is not federal. */
  directory: MemberDirectory | null;
  /** The request failed; distinct from "no record". */
  failed: boolean;
}

export function useMemberDirectory(memberId: string): MemberDirectoryState {
  const [directory, setDirectory] = useState<MemberDirectory | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    if (!memberDirectoryReaches(memberId, "offices")) return;
    /*
     * No reset before the fetch: the id is the component's key at every call
     * site. The `live` flag drops an answer for a member already left.
     */
    void loadMemberDirectory(memberId)
      .then((payload) => {
        if (live) setDirectory(payload);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [memberId]);

  return { directory, failed };
}
