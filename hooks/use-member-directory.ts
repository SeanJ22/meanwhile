"use client";

import { useEffect, useState } from "react";

import type { DirectoryFile, DirectoryOffice, DirectorySource } from "@/lib/officials/directory";
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

export interface StateMemberDirectory {
  readonly ids: readonly string[];
  readonly directory: MemberDirectory;
}

const cache = new Map<string, { promise: Promise<MemberDirectory>; expires: number }>();
const CACHE_MS = 30_000;

function directoryScope(memberId: string, state?: string): string | null {
  return statePeopleScopeForId(memberId, state) ??
    (/^(?:US-)?([A-Z]{2})$/i.exec(state ?? "")?.[1].toUpperCase() ?? null);
}

/** Offices sourced with the state's people use the same directory cache as a card lookup. */
export function primeStateMemberDirectories(rows: readonly StateMemberDirectory[] | undefined, state: string): void {
  for (const row of rows ?? []) {
    const held = { promise: Promise.resolve(row.directory), expires: Date.now() + CACHE_MS };
    for (const memberId of row.ids) cache.set(`${memberId}|${directoryScope(memberId, state) ?? ""}`, held);
  }
}

/** State packages carry the delegation's offices before any card opens. */
export function primeMemberDirectories(file: DirectoryFile | null, state: string): void {
  if (!file) return;
  for (const [bioguide, entry] of Object.entries(file.byMember)) {
    const directory: MemberDirectory = {
      source: file.source,
      districtOffices: entry.districtOffices,
      committees: entry.committees.map(seat => ({ ...seat, ...file.committees[seat.committeeId] })),
    };
    const memberId = `congress:${bioguide}`;
    const held = { promise: Promise.resolve(directory), expires: Date.now() + CACHE_MS };
    cache.set(`${memberId}|${directoryScope(memberId, state) ?? ""}`, held);
    // Federal identity is national; callers lacking a state still share the shelf.
    cache.set(`${memberId}|`, held);
  }
}

export function isFederalMember(id: string): boolean {
  return id.startsWith("congress:");
}

export function loadMemberDirectory(memberId: string, state?: string): Promise<MemberDirectory> {
  const scope = directoryScope(memberId,state);
  const key = `${memberId}|${scope ?? ""}`;
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.promise;

  const promise = (async () => {
    const response = await fetch(
      `/api/directory?member=${encodeURIComponent(memberId)}${scope ? `&state=${encodeURIComponent(scope.replace(/^US-/, ""))}` : ""}`,
    );
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as MemberDirectory;
  })().then(value => {
    if (cache.get(key)?.promise === promise) cache.set(key, { promise, expires: Date.now() + CACHE_MS });
    return value;
  }).catch(error => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
    throw error;
  });

  cache.set(key, { promise, expires: Infinity });
  return promise;
}

export interface MemberDirectoryState {
  /** Null while in flight, and null when no source reaches the member. */
  directory: MemberDirectory | null;
  /** The request failed; distinct from "no record". */
  failed: boolean;
}

export function useMemberDirectory(memberId: string, state?: string): MemberDirectoryState {
  const scope = directoryScope(memberId,state) ?? undefined;
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
