import "server-only";

/**
 * **CONTAINERS AND THEIR CODES, FROM THE PUBLISHED LOOKUP.** (Admin redesign,
 * 2026-09-23.)
 *
 * Two facts, kept apart because the design insists they are different:
 *
 * ```
 *   membership   which Census ZIP-code tabulation areas (ZCTAs) a county,
 *                congressional district or metro area overlaps, wholly or in
 *                part — the published Census geography lookup, nothing else
 *   coverage     which governments' territory reaches each ZCTA — the reader's
 *                own national ZIP index (`lib/geo/zip-division-index.ts`), the
 *                same one the reader uses to decide what governs a ZIP
 * ```
 *
 * The index covers every ZIP code in the country. A ZCTA it does not carry
 * (the lattice found no land in it), or whose shard cannot be read, is
 * `indexed: false` and the page names it as not indexed. It is never shown as a
 * ZCTA with no governments.
 *
 * Production reads only the slice a page needs from the promoted pointer
 * (`lib/control-plane/admin-view/promoted-slices.ts`): one state's containers,
 * one container, or one code's containers, cut out by Postgres. A cold server
 * used to read the whole 13.7 MB lookup and prove it before any of these
 * answered (7.5 s, 2026-09-24), and a load over three seconds is not a win
 * (Sean, 2026-09-24). The whole lookup is built only outside production where
 * the store holds no pointer: the committed Arizona bootstrap that local work
 * and tests read.
 */
import type { GeographyRef, GeographyType } from "@/lib/census-geography/contract.ts";
import type { PublishedLookupSource, PublishedLookupState } from "@/lib/census-geography/reader.ts";
import { containersOfCode, oneContainer, stateContainers, type Slice } from "@/lib/control-plane/admin-view/promoted-slices.ts";
import { zipDivisionEntry } from "@/lib/geo/zip-division-index.ts";

import { readerQuery } from "./reader-query.ts";
import { ADMIN_READ_DEADLINE_MS, lateWords, sharedRead, type SharedRead } from "./shared-read.ts";

/** One code's place in the index: every division whose territory reaches it, or not indexed. */
async function indexedCode(zcta5: string): Promise<{ readonly indexed: boolean; readonly divisions: readonly string[]; readonly partial: readonly string[] }> {
  const entry = await zipDivisionEntry(zcta5);
  return entry === null ? { indexed: false, divisions: [], partial: [] } : { indexed: true, divisions: entry.ids, partial: entry.partial };
}

export interface ZctaInScope {
  readonly zcta5: string;
  readonly whole: boolean;
  /** Share of the ZCTA's land inside the container, 0–1; null when the ZCTA has no land. */
  readonly fraction: number | null;
  readonly indexed: boolean;
  /** Every division whose territory reaches this ZCTA (empty when not indexed). */
  readonly divisions: readonly string[];
  /** Of those, the ones covering only part of its sampled area (the index's `partial`). */
  readonly partial: readonly string[];
}

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

/* ---------------------------------------------------------------- the slices */

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

/* ------------------------------------------------ the whole lookup (not prod) */

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

/* ------------------------------------------------------------------ the reads */

/** Every container of the given types that lies in, or reaches into, the state. */
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

/** One container's ZCTAs, each joined to the reader's ZIP division index. */
export async function loadContainer(
  type: GeographyType,
  geoid: string,
): Promise<LookupRead<{ readonly geography: GeographyRef; readonly zctas: readonly ZctaInScope[]; readonly plan: string }>> {
  const query = readerQuery();
  const slice =
    query === null ? null : await sliceRead(`container|${type}|${geoid}`, `The Census geography for ${geoid}`, () => oneContainer(type, geoid, query));
  if (!readsWholeLookup(slice) && slice !== null) {
    if (slice.kind === "NOT_PUBLISHED") return unread(NOT_PUBLISHED);
    if (slice.kind === "UNREAD") return unread(slice.detail);
    const scope = slice.value.scopes.find((s) => s.type === type);
    if (scope === undefined) return unread(`The published lookup carries no ${type.replace(/_/g, " ")} geography yet.`);
    const found = slice.value.containers[0];
    if (found === undefined) return unread(`${type} ${geoid} is not a geography in published version ${scope.version}.`);
    return {
      kind: "HELD",
      source: "published",
      versionId: slice.versionId,
      value: { geography: found.ref, zctas: await codesOf(found.overlaps ?? []), plan: found.plan },
    };
  }

  const opened = await lookupOrUnread();
  if (!opened.ok) return unread(opened.detail);
  const manifest = await opened.state.lookup.manifest();
  const version = manifest.scopes.find((s) => s.type === type)?.version;
  if (version === undefined) return unread(`The published lookup carries no ${type.replace(/_/g, " ")} geography yet.`);
  const r = await opened.state.lookup.zctasForGrouping({ type, geoid, version });
  if (r.status.kind !== "OK") return unread(r.status.note);
  const zctas = await codesOf(r.overlaps);
  return {
    kind: "HELD",
    source: opened.state.source,
    versionId: opened.state.versionId,
    value: { geography: r.geography, zctas, plan: r.version.plan },
  };
}

async function codesOf(overlaps: readonly { readonly zcta5: string; readonly whole: boolean; readonly fraction: number | null }[]): Promise<ZctaInScope[]> {
  const codes = await Promise.all(overlaps.map(async (o) => ({ zcta5: o.zcta5, whole: o.whole, fraction: o.fraction, ...(await indexedCode(o.zcta5)) })));
  return codes.sort((a, b) => a.zcta5.localeCompare(b.zcta5));
}

export interface ContainerWithCodes {
  readonly geography: GeographyRef;
  readonly zctas: readonly ZctaInScope[];
}

/** A single ZIP's Census approximation, without widening the hunt to its county. */
export async function loadZcta(zcta5: string): Promise<LookupRead<{ readonly geography: Omit<GeographyRef, "type"> & { readonly type: "zcta" }; readonly zctas: readonly ZctaInScope[] }>> {
  if (!/^\d{5}$/.test(zcta5)) return unread("Enter a five-digit ZIP.");
  const query = readerQuery();
  const types: GeographyType[] = ["county", "congressional_district", "state_leg_upper", "state_leg_lower", "cbsa"];
  const slice = query === null ? null : await sliceRead(`zcta|${zcta5}`, `The Census geography for ZCTA ${zcta5}`, () => containersOfCode(zcta5, types, query));
  let refs: readonly GeographyRef[];
  let vintages: readonly string[];
  let source: PublishedLookupSource;
  let versionId: string;
  if (!readsWholeLookup(slice) && slice !== null) {
    if (slice.kind !== "HELD") return unread(slice.kind === "UNREAD" ? slice.detail : NOT_PUBLISHED);
    if (!slice.value.known) return unread(`${zcta5} is outside the published Census ZCTA coverage.`);
    refs = slice.value.containers.map(c => c.ref);
    vintages = slice.value.zctaTabulations ?? [];
    source = "published"; versionId = slice.versionId;
  } else {
    const opened = await lookupOrUnread();
    if (!opened.ok) return unread(opened.detail);
    const [r, manifest] = await Promise.all([opened.state.lookup.groupingsForZcta(zcta5), opened.state.lookup.manifest()]);
    if (r.status.kind !== "OK") return unread(r.status.note);
    refs = r.memberships.map(m => m.geography);
    vintages = [...new Set(manifest.versions.map(v => v.zctaTabulation))];
    source = opened.state.source; versionId = opened.state.versionId;
  }
  const states = [...new Set(refs.filter(g => g.type === "county").map(g => g.stateAbbr))].sort();
  const unique = [...new Set(vintages)];
  if (!states.length || unique.length !== 1 || !/^\d{4}$/.test(unique[0])) return unread("This ZIP's Census states or tabulation vintage cannot be resolved unambiguously.");
  return { kind: "HELD", source, versionId, value: {
    geography: { type: "zcta", geoid: zcta5, version: `zcta:${unique[0]}`, label: `ZIP ${zcta5} (Census ZCTA)`, stateAbbr: states[0], stateFips: refs.find(r => r.stateAbbr === states[0])!.stateFips, memberStates: states, ocdId: null },
    zctas: await codesOf([{ zcta5, whole: true, fraction: 1 }]),
  } };
}

/** Every container of one type in the state, each with its codes — one read, one pass. */
export async function loadContainersWithCodes(stateAbbr: string, type: GeographyType): Promise<LookupRead<readonly ContainerWithCodes[]>> {
  const st = stateAbbr.toUpperCase();
  const query = readerQuery();
  const slice =
    query === null ? null : await sliceRead(`codes|${st}|${type}`, `The Census geography for ${st}`, () => stateContainers(st, [type], true, query));
  if (!readsWholeLookup(slice) && slice !== null) {
    if (slice.kind === "NOT_PUBLISHED") return unread(NOT_PUBLISHED);
    if (slice.kind === "UNREAD") return unread(slice.detail);
    if (!slice.value.scopes.some((s) => s.type === type)) return unread(`The published lookup carries no ${type.replace(/_/g, " ")} geography yet.`);
    const containers = [...slice.value.containers].sort((a, b) => byLabel(a.ref, b.ref));
    const out: ContainerWithCodes[] = [];
    for (const c of containers) out.push({ geography: c.ref, zctas: await codesOf(c.overlaps ?? []) });
    return { kind: "HELD", source: "published", versionId: slice.versionId, value: out };
  }

  const opened = await lookupOrUnread();
  if (!opened.ok) return unread(opened.detail);
  const e = await opened.state.lookup.enumerateGroupings(type);
  if (e.status.kind !== "OK") return unread(e.status.note);
  const refs = e.instances.filter((g) => g.stateAbbr === st || g.memberStates.includes(st)).sort(byLabel);
  const out: ContainerWithCodes[] = [];
  for (const g of refs) {
    const r = await opened.state.lookup.zctasForGrouping({ type: g.type, geoid: g.geoid, version: g.version });
    if (r.status.kind !== "OK") continue;
    out.push({ geography: g, zctas: await codesOf(r.overlaps) });
  }
  return { kind: "HELD", source: opened.state.source, versionId: opened.state.versionId, value: out };
}

export interface CodeMembership {
  readonly type: GeographyType;
  readonly geoid: string;
  readonly label: string;
  readonly whole: boolean;
  readonly fraction: number | null;
}

function sortMemberships(memberships: CodeMembership[]): CodeMembership[] {
  return memberships.sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label, "en", { numeric: true }));
}

/** Which containers one code belongs to, of the given types (the lookup's reverse index). */
export async function membershipsOfCode(zcta5: string, types: readonly GeographyType[]): Promise<LookupRead<{ readonly memberships: readonly CodeMembership[]; readonly code: ZctaInScope }>> {
  const query = readerQuery();
  const slice =
    query === null ? null : await sliceRead(`code|${zcta5}|${[...types].sort().join(",")}`, `The Census geography for ZCTA ${zcta5}`, () => containersOfCode(zcta5, types, query));
  if (!readsWholeLookup(slice) && slice !== null) {
    if (slice.kind === "NOT_PUBLISHED") return unread(NOT_PUBLISHED);
    if (slice.kind === "UNREAD") return unread(slice.detail);
    if (!slice.value.known) return unread(`${zcta5} is not a Census ZCTA in the published coverage.`);
    const memberships = sortMemberships(
      slice.value.containers.flatMap((c) => {
        const o = (c.overlaps ?? [])[0];
        return o === undefined ? [] : [{ type: c.ref.type, geoid: c.ref.geoid, label: c.ref.label, whole: o.whole, fraction: o.fraction }];
      }),
    );
    return {
      kind: "HELD",
      source: "published",
      versionId: slice.versionId,
      value: { memberships, code: { zcta5, whole: true, fraction: null, ...(await indexedCode(zcta5)) } },
    };
  }

  const opened = await lookupOrUnread();
  if (!opened.ok) return unread(opened.detail);
  const r = await opened.state.lookup.groupingsForZcta(zcta5);
  if (r.status.kind !== "OK") return unread(r.status.note);
  const memberships = sortMemberships(
    r.memberships
      .filter((m) => types.includes(m.geography.type))
      .map((m) => ({ type: m.geography.type, geoid: m.geography.geoid, label: m.geography.label, whole: m.whole, fraction: m.fraction })),
  );
  return {
    kind: "HELD",
    source: opened.state.source,
    versionId: opened.state.versionId,
    value: { memberships, code: { zcta5, whole: true, fraction: null, ...(await indexedCode(zcta5)) } },
  };
}

/** The divisions reaching any of these ZCTAs: the set a body's division is tested against. */
export function divisionsOf(zctas: readonly ZctaInScope[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const z of zctas) for (const d of z.divisions) out.add(d);
  return out;
}
