"use client";

import { useEffect, useState } from "react";

import type { DirectoryOffice, DirectorySource } from "@/lib/officials/directory";
import { memberDirectoryReaches } from "@/lib/officials/member-directory-scope";

/**
 * One federal member's district offices and committee seats.
 *
 * ## Why this became a hook
 *
 * `MemberDirectory` owned this fetch, and g4 item 8 gave a second component a
 * use for the same answer: the contact pill row has to show the DISTRICT
 * office's number beside the Washington one, and the district numbers live in
 * this payload. Two components each running their own `fetch` for one member
 * is two requests for one answer, and — worse — two places that can disagree
 * about whether the answer arrived.
 *
 * ## The cache, and why it is a promise
 *
 * Keyed on the member id and holding the PROMISE rather than the value, so
 * two components mounting in the same tick share one request instead of
 * racing. The route is `private, no-store` by construction (a member's
 * directory must never be served from a shared cache under another member's
 * key — D40), so the browser will not do this for us.
 *
 * A failure is not cached: the entry is dropped so the next open retries,
 * rather than a transient network blip turning into a permanent "no record"
 * for the rest of the session — which would be an absence we invented.
 */

/**
 * A committee seat AS THE ROUTE SERVES IT — the chamber's own row plus the
 * jurisdiction statement the route joins onto it.
 *
 * Declared here rather than imported from `lib/officials/directory`, because
 * that module's `DirectoryCommittee` is the shape stored on disk and this is
 * the shape that comes back over the wire. Stating the difference is what
 * stops a field appearing in one and being assumed in the other.
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
  /**
   * The request failed. Kept separate from "no record", because they are
   * different claims and only one of them is about the member.
   */
  failed: boolean;
}

export function useMemberDirectory(memberId: string): MemberDirectoryState {
  const [directory, setDirectory] = useState<MemberDirectory | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    if (!memberDirectoryReaches(memberId, "offices")) return;
    /*
     * No synchronous reset before the fetch.
     *
     * Clearing state at the top of an effect is a cascading render, and it is
     * also unnecessary here: the id is the component's own key at every call
     * site, so a different member is a different mount with fresh state. What
     * IS load-bearing is the `live` flag below — an answer for a member the
     * reader has already left must never be applied, which is the same rule
     * as the stale zip shading and the stale focus mask.
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
