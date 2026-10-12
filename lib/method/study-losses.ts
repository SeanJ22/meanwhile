/**
 * For each method with two or more failures, the trait every failing place states and no working place has, or
 * "nothing shared". Pure.
 */

import type { FixMapRow } from "./fix-map.ts";

/** What we already hold about a place, each field absent when unknown. */
export interface PlaceTraits {
  readonly platform?: string | null;
  readonly platformVersion?: string | null;
  readonly state?: string | null;
  /** Agendas are posted as images, not text. */
  readonly agendasAsImages?: boolean | null;
  /** A login or form stands in the way. */
  readonly loginOrForm?: boolean | null;
  /** People served by the body (or students, for a school district). */
  readonly bodySize?: number | null;
  /** How many days ahead the body usually posts its agenda. */
  readonly postsAheadDays?: number | null;
}

export type TraitName = "platform" | "platform version" | "state" | "agendas posted as images" | "a login or form in the way" | "body size" | "how far ahead it posts";

export interface SharedTrait {
  readonly trait: TraitName;
  readonly value: string;
}

export interface LossStudy {
  readonly methodId: string;
  readonly failures: number;
  readonly works: number;
  readonly shared: readonly SharedTrait[];
  /** Plain words for Admin: the shared traits, or "nothing shared". */
  readonly says: string;
}

function sizeBand(n: number): string {
  return n < 1_000 ? "under 1,000" : n < 10_000 ? "1,000 to 10,000" : n < 50_000 ? "10,000 to 50,000" : "50,000 or more";
}

function aheadBand(days: number): string {
  return days < 3 ? "under 3 days" : days < 14 ? "3 to 14 days" : days < 45 ? "14 to 45 days" : "45 days or more";
}

/** The comparable value of each trait for one place; a trait the place does not state is simply absent. */
export function valuesOf(traits: PlaceTraits | undefined): Map<TraitName, string> {
  const out = new Map<TraitName, string>();
  if (traits === undefined) return out;
  const text = (v: string | null | undefined): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().toLowerCase() : null);
  const platform = text(traits.platform);
  if (platform !== null) out.set("platform", platform);
  const version = text(traits.platformVersion);
  if (platform !== null && version !== null) out.set("platform version", `${platform} ${version}`);
  const state = text(traits.state);
  if (state !== null) out.set("state", state);
  if (typeof traits.agendasAsImages === "boolean") out.set("agendas posted as images", traits.agendasAsImages ? "yes" : "no");
  if (typeof traits.loginOrForm === "boolean") out.set("a login or form in the way", traits.loginOrForm ? "yes" : "no");
  if (typeof traits.bodySize === "number" && Number.isFinite(traits.bodySize) && traits.bodySize >= 0) out.set("body size", sizeBand(traits.bodySize));
  if (typeof traits.postsAheadDays === "number" && Number.isFinite(traits.postsAheadDays) && traits.postsAheadDays >= 0) out.set("how far ahead it posts", aheadBand(traits.postsAheadDays));
  return out;
}

export function studyLosses(fixMap: readonly FixMapRow[], placeTraits: ReadonlyMap<string, PlaceTraits> | Readonly<Record<string, PlaceTraits>>): LossStudy[] {
  const traitsOf = (placeId: string): PlaceTraits | undefined => (placeTraits instanceof Map ? placeTraits.get(placeId) : (placeTraits as Record<string, PlaceTraits>)[placeId]);
  const byMethod = new Map<string, FixMapRow[]>();
  for (const row of fixMap) {
    const list = byMethod.get(row.methodId) ?? [];
    list.push(row);
    byMethod.set(row.methodId, list);
  }
  const studies: LossStudy[] = [];
  for (const [methodId, rows] of [...byMethod].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const failing = rows.filter((r) => r.state === "FAILS");
    if (failing.length < 2) continue;
    const working = rows.filter((r) => r.state === "WORKS");
    const failingValues = failing.map((r) => valuesOf(traitsOf(r.placeId)));
    const workingValues = working.map((r) => valuesOf(traitsOf(r.placeId)));
    const shared: SharedTrait[] = [];
    for (const trait of new Set(failingValues.flatMap((m) => [...m.keys()]))) {
      const values = failingValues.map((m) => m.get(trait));
      const first = values[0];
      if (first === undefined || values.some((v) => v !== first)) continue;
      if (workingValues.some((m) => m.get(trait) === first)) continue;
      shared.push({ trait, value: first });
    }
    shared.sort((a, b) => (a.trait < b.trait ? -1 : 1));
    studies.push({
      methodId,
      failures: failing.length,
      works: working.length,
      shared,
      says: shared.length === 0
        ? "nothing shared"
        : `${failing.length} places where it fails share: ${shared.map((s) => `${s.trait} (${s.value})`).join("; ")}${working.length > 0 ? `, and none of the ${working.length} where it works do` : ""}`,
    });
  }
  return studies;
}
