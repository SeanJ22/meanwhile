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
 *                own ZIP division index (`data/derived/zip-division-ids.json`),
 *                the same file the reader uses to decide what governs a ZIP
 * ```
 *
 * The index carries the ZCTAs this repository has committed geometry for; a
 * ZCTA outside it is `indexed: false` and the page names it as not yet
 * indexed. It is never shown as a ZCTA with no governments.
 */
import zipIndex from "@/data/derived/zip-division-ids.json";
import type { GeographyRef, GeographyType } from "@/lib/census-geography/contract.ts";
import { loadPublishedLookupState, type PublishedLookupSource } from "@/lib/census-geography/reader.ts";

import { ADMIN_READ_DEADLINE_MS, lateWords, sharedRead } from "./shared-read.ts";

const INDEX = zipIndex as unknown as {
  readonly generatedAt: string;
  readonly zips: Readonly<Record<string, readonly string[]>>;
  readonly partial?: Readonly<Record<string, readonly string[]>>;
};

export const ZIP_INDEX_GENERATED_AT: string = INDEX.generatedAt;
export const ZIP_INDEX_SIZE: number = Object.keys(INDEX.zips).length;

export interface ZctaInScope {
  readonly zcta5: string;
  readonly whole: boolean;
  /** Share of the ZCTA's land inside the container, 0–1; null when the ZCTA has no land. */
  readonly fraction: number | null;
  readonly indexed: boolean;
  /** Every division whose territory reaches this ZCTA (empty when not indexed). */
  readonly divisions: readonly string[];
}

export type LookupRead<T> =
  | { readonly kind: "HELD"; readonly source: PublishedLookupSource; readonly versionId: string; readonly value: T }
  | { readonly kind: "UNREAD"; readonly detail: string };

function unread<T>(detail: string): LookupRead<T> {
  return { kind: "UNREAD", detail };
}

type LookupOpened =
  | { readonly ok: true; readonly state: Awaited<ReturnType<typeof loadPublishedLookupState>> }
  | { readonly ok: false; readonly detail: string };

/*
 * The built lookup: the promoted payload is ~15 MB of text and the index built
 * over it is the same until the pointer moves. One load is shared by every
 * caller that arrives while it runs — All states lists three states' counties
 * at once and used to load it three times over — then kept a minute fresh and
 * half an hour recent (see shared-read.ts).
 */
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
      const state = await loadPublishedLookupState();
      if (state.source === "unavailable") {
        return {
          ok: false,
          detail: "The Census geography lookup has not been published to this store yet, so no container can be listed. That is not a claim that none exist.",
        };
      }
      return { ok: true, state };
    } catch (error) {
      return { ok: false, detail: `The Census geography lookup could not be read (${error instanceof Error ? error.name : "error"}).` };
    }
  });
}

/** Every container of the given types that lies in, or reaches into, the state. */
export async function listContainers(
  stateAbbr: string,
  types: readonly GeographyType[],
): Promise<LookupRead<Readonly<Partial<Record<GeographyType, readonly GeographyRef[]>>>>> {
  const opened = await lookupOrUnread();
  if (!opened.ok) return unread(opened.detail);
  const st = stateAbbr.toUpperCase();
  const out: Partial<Record<GeographyType, readonly GeographyRef[]>> = {};
  for (const type of types) {
    const e = await opened.state.lookup.enumerateGroupings(type);
    if (e.status.kind !== "OK") continue;
    out[type] = e.instances
      .filter((g) => g.stateAbbr === st || g.memberStates.includes(st))
      .sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
  }
  return { kind: "HELD", source: opened.state.source, versionId: opened.state.versionId, value: out };
}

/** One container's ZCTAs, each joined to the reader's ZIP division index. */
export async function loadContainer(
  type: GeographyType,
  geoid: string,
): Promise<LookupRead<{ readonly geography: GeographyRef; readonly zctas: readonly ZctaInScope[]; readonly plan: string }>> {
  const opened = await lookupOrUnread();
  if (!opened.ok) return unread(opened.detail);
  const manifest = await opened.state.lookup.manifest();
  const version = manifest.scopes.find((s) => s.type === type)?.version;
  if (version === undefined) return unread(`The published lookup carries no ${type.replace(/_/g, " ")} geography yet.`);
  const r = await opened.state.lookup.zctasForGrouping({ type, geoid, version });
  if (r.status.kind !== "OK") return unread(r.status.note);
  const zctas: ZctaInScope[] = r.overlaps
    .map((o) => {
      const divisions = INDEX.zips[o.zcta5];
      return {
        zcta5: o.zcta5,
        whole: o.whole,
        fraction: o.fraction,
        indexed: divisions !== undefined,
        divisions: divisions ?? [],
      };
    })
    .sort((a, b) => a.zcta5.localeCompare(b.zcta5));
  return {
    kind: "HELD",
    source: opened.state.source,
    versionId: opened.state.versionId,
    value: { geography: r.geography, zctas, plan: r.version.plan },
  };
}

function codesOf(overlaps: readonly { readonly zcta5: string; readonly whole: boolean; readonly fraction: number | null }[]): ZctaInScope[] {
  return overlaps
    .map((o) => {
      const divisions = INDEX.zips[o.zcta5];
      return { zcta5: o.zcta5, whole: o.whole, fraction: o.fraction, indexed: divisions !== undefined, divisions: divisions ?? [] };
    })
    .sort((a, b) => a.zcta5.localeCompare(b.zcta5));
}

export interface ContainerWithCodes {
  readonly geography: GeographyRef;
  readonly zctas: readonly ZctaInScope[];
}

/** Every container of one type in the state, each with its codes — one lookup, one pass. */
export async function loadContainersWithCodes(stateAbbr: string, type: GeographyType): Promise<LookupRead<readonly ContainerWithCodes[]>> {
  const opened = await lookupOrUnread();
  if (!opened.ok) return unread(opened.detail);
  const st = stateAbbr.toUpperCase();
  const e = await opened.state.lookup.enumerateGroupings(type);
  if (e.status.kind !== "OK") return unread(e.status.note);
  const refs = e.instances.filter((g) => g.stateAbbr === st || g.memberStates.includes(st)).sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }));
  const out: ContainerWithCodes[] = [];
  for (const g of refs) {
    const r = await opened.state.lookup.zctasForGrouping({ type: g.type, geoid: g.geoid, version: g.version });
    if (r.status.kind !== "OK") continue;
    out.push({ geography: g, zctas: codesOf(r.overlaps) });
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

/** Which containers one code belongs to, of the given types (the lookup's reverse index). */
export async function membershipsOfCode(zcta5: string, types: readonly GeographyType[]): Promise<LookupRead<{ readonly memberships: readonly CodeMembership[]; readonly code: ZctaInScope }>> {
  const opened = await lookupOrUnread();
  if (!opened.ok) return unread(opened.detail);
  const r = await opened.state.lookup.groupingsForZcta(zcta5);
  if (r.status.kind !== "OK") return unread(r.status.note);
  const memberships = r.memberships
    .filter((m) => types.includes(m.geography.type))
    .map((m) => ({ type: m.geography.type, geoid: m.geography.geoid, label: m.geography.label, whole: m.whole, fraction: m.fraction }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label, "en", { numeric: true }));
  const divisions = INDEX.zips[zcta5];
  return {
    kind: "HELD",
    source: opened.state.source,
    versionId: opened.state.versionId,
    value: { memberships, code: { zcta5, whole: true, fraction: null, indexed: divisions !== undefined, divisions: divisions ?? [] } },
  };
}

/** The divisions reaching any of these ZCTAs: the set a body's division is tested against. */
export function divisionsOf(zctas: readonly ZctaInScope[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const z of zctas) for (const d of z.divisions) out.add(d);
  return out;
}
