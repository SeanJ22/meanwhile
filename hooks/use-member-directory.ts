"use client";

import { useEffect, useState } from "react";

import type { DirectoryOffice, DirectorySource } from "@/lib/officials/directory";
import { memberDirectoryReaches } from "@/lib/officials/member-directory-scope";
import { statePeopleScopeForId } from "@/lib/officials/people-identity";

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

  officeDetails?: { officeKind: "CAPITOL" | "DISTRICT"; sourceUrl: string; sourceOrg: string; collectedAt: string; official: boolean }[];
}

const cache = new Map<string, Promise<MemberDirectory>>();

export function isFederalMember(id: string): boolean {
  return id.startsWith("congress:");
}

export function loadMemberDirectory(memberId: string, state?: string): Promise<MemberDirectory> {
  const scope = statePeopleScopeForId(memberId,state);
  const key = `${memberId}|${scope ?? ""}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const response = await fetch(
      `/api/directory?member=${encodeURIComponent(memberId)}${scope ? `&state=${encodeURIComponent(scope.slice(3))}` : ""}`,
    );
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as MemberDirectory;
  })().finally(() => {
    if (cache.get(key) === promise) cache.delete(key);
  });

  cache.set(key, promise);
  return promise;
}

export interface MemberDirectoryState {
  /** Null while in flight, and null when no source reaches the member. */
  directory: MemberDirectory | null;
  /** The request failed; distinct from "no record". */
  failed: boolean;
}

export function useMemberDirectory(memberId: string, state?: string): MemberDirectoryState {
  const scope = statePeopleScopeForId(memberId,state) ?? undefined;
  const key = `${memberId}|${scope ?? ""}`;
  const [result, setResult] = useState<(MemberDirectoryState & {key:string}) | null>(null);

  useEffect(() => {
    let live = true;
    if (!memberDirectoryReaches(memberId, "offices",scope)) return;

    void loadMemberDirectory(memberId,scope)
      .then((payload) => {
        if (live) setResult({key,directory:payload,failed:false});
      })
      .catch(() => {
        if (live) setResult({key,directory:null,failed:true});
      });
    return () => {
      live = false;
    };
  }, [memberId,scope,key]);

  return result?.key === key ? result : {directory:null,failed:false};
}
