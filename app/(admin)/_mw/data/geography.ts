import "server-only";

/**
 * Membership (which ZCTAs a container overlaps) comes from the published Census lookup; coverage (which
 * governments reach each ZCTA) comes from the national ZIP index. A ZCTA the index does not carry is
 * `indexed: false`, never a ZCTA with no governments.
 *
 * Production reads only the slice a page needs from the promoted pointer. The whole lookup is built only
 * outside production, where the store holds no pointer.
 */
import type { GeographyRef, GeographyType } from "@/lib/census-geography/contract.ts";
import type { PublishedLookupSource, PublishedLookupState } from "@/lib/census-geography/reader.ts";
import { stateContainers, type Slice } from "@/lib/control-plane/admin-view/promoted-slices.ts";

import { readerQuery } from "./reader-query.ts";
import { ADMIN_READ_DEADLINE_MS, lateWords, sharedRead, type SharedRead } from "./shared-read.ts";

export type LookupRead<T> =
  | { readonly kind: "HELD"; readonly source: PublishedLookupSource; readonly versionId: string; readonly value: T }
  | { readonly kind: "UNREAD"; readonly detail: string };

function unread<T>(detail: string): LookupRead<T> {
  return { kind: "UNREAD", detail };
}

const NOT_PUBLISHED = "The Census geography lookup has not been published to this store yet, so no container can be listed. That is not a claim that none exist.";

function byLabel(a: GeographyRef, b: GeographyRef): number {
  return a.label.localeCompare(b.label, "en", { numeric: true });
}

/*
 * A slice is kept a minute fresh and half an hour recent, like every Admin
 * read (see shared-read.ts), per question asked. The questions are few (a state
 * and its kinds, a container, a code), and the map is cleared if it ever grows
 * past a few hundred.
 */
const sliceReads = new Map<string, SharedRead<Slice<unknown>>>();

function sliceRead<T>(key: string, what: string, load: () => Promise<Slice<T>>): Promise<Slice<T>> {
  let shared = sliceReads.get(key);
  if (shared === undefined) {
    if (sliceReads.size > 400) sliceReads.clear();
    shared = sharedRead<Slice<unknown>>({
      freshMs: 60_000,
      staleMs: 30 * 60_000,
      deadlineMs: ADMIN_READ_DEADLINE_MS,
      keep: (s) => s.kind === "HELD",
      late: (ms) => ({ kind: "UNREAD", detail: lateWords(what, ms) }),
    });
    sliceReads.set(key, shared);
  }
  return shared.read(load) as Promise<Slice<T>>;
}

/** Whether this read falls back to the whole lookup: only outside production, only where the store has no pointer. */
function readsWholeLookup(slice: Slice<unknown> | null): boolean {
  return process.env.NODE_ENV !== "production" && (slice === null || slice.kind === "NOT_PUBLISHED");
}

type LookupOpened =
  | { readonly ok: true; readonly state: PublishedLookupState }
  | { readonly ok: false; readonly detail: string };

const lookupShared = sharedRead<LookupOpened>({
  freshMs: 60_000,
  staleMs: 30 * 60_000,
  deadlineMs: ADMIN_READ_DEADLINE_MS,
  keep: (o) => o.ok,
  late: (ms) => ({ ok: false, detail: lateWords("The Census geography lookup", ms) }),
});

async function lookupOrUnread(): Promise<LookupOpened> {
  return lookupShared.read(async () => {
    try {
      // Loaded only here: production reads slices and never builds the whole lookup.
      const { loadPublishedLookupState } = await import("@/lib/census-geography/reader.ts");
      const state = await loadPublishedLookupState();
      if (state.source === "unavailable") return { ok: false, detail: NOT_PUBLISHED };
      return { ok: true, state };
    } catch (error) {
      return { ok: false, detail: `The Census geography lookup could not be read (${error instanceof Error ? error.name : "error"}).` };
    }
  });
}

export async function listContainers(
  stateAbbr: string,
  types: readonly GeographyType[],
): Promise<LookupRead<Readonly<Partial<Record<GeographyType, readonly GeographyRef[]>>>>> {
  const st = stateAbbr.toUpperCase();
  const query = readerQuery();
  const slice =
    query === null ? null : await sliceRead(`state|${st}|${[...types].sort().join(",")}`, `The Census geography for ${st}`, () => stateContainers(st, types, false, query));
  if (!readsWholeLookup(slice) && slice !== null) {
    if (slice.kind === "NOT_PUBLISHED") return unread(NOT_PUBLISHED);
    if (slice.kind === "UNREAD") return unread(slice.detail);
    const published = new Set(slice.value.scopes.map((s) => s.type));
    const out: Partial<Record<GeographyType, readonly GeographyRef[]>> = {};
    for (const type of types) {
      if (!published.has(type)) continue;
      out[type] = slice.value.containers
        .filter((c) => c.ref.type === type)
        .map((c) => c.ref)
        .sort(byLabel);
    }
    return { kind: "HELD", source: "published", versionId: slice.versionId, value: out };
  }

  const opened = await lookupOrUnread();
  if (!opened.ok) return unread(opened.detail);
  const out: Partial<Record<GeographyType, readonly GeographyRef[]>> = {};
  for (const type of types) {
    const e = await opened.state.lookup.enumerateGroupings(type);
    if (e.status.kind !== "OK") continue;
    out[type] = e.instances.filter((g) => g.stateAbbr === st || g.memberStates.includes(st)).sort(byLabel);
  }
  return { kind: "HELD", source: opened.state.source, versionId: opened.state.versionId, value: out };
}
