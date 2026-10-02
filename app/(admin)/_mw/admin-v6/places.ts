/**
 * **WHERE THINGS BELONG.** Scope rules for Admin v6.
 *
 * Two different questions, kept apart (READ-FIRST clarification 4):
 *
 *   breadcrumbs   `navParent` chain, for moving around only
 *   counting      `within` relations, which may name several places (a ZIP that
 *                 reaches two counties, a body serving several ZIPs)
 *
 * An item is LOCAL to a scope when something it applies to sits inside (or is)
 * the scope; SHARED when it applies to a wider place the scope sits inside, such
 * as a statewide or national record. Shared items show in their own labelled
 * rows and are never added into the local count.
 *
 * Also maps the deployed `MwScope` (all / state / Census geography) onto place
 * keys so the component can sit on the existing `?scope=` URL.
 *
 * PURE.
 */
import type { MwScope } from "../scope.ts";
import { districtLabelOfQuery } from "@/lib/control-plane/admin-view/district-catalog.ts";
import type { Hunt, Place } from "./model.ts";

export type PlaceIndex = ReadonlyMap<string, Place>;

export function indexPlaces(places: readonly Place[]): PlaceIndex {
  return new Map(places.map((p) => [p.key, p]));
}

/** Every place `key` sits inside, through explicit coverage relations. */
export function containers(index: PlaceIndex, key: string): ReadonlySet<string> {
  const out = new Set<string>();
  const stack = [...(index.get(key)?.within ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    if (out.has(next)) continue;
    out.add(next);
    stack.push(...(index.get(next)?.within ?? []));
  }
  return out;
}

/** Is `a` the same as, or inside, `b`? */
export function isWithin(index: PlaceIndex, a: string, b: string): boolean {
  return a === b || containers(index, a).has(b);
}

export type Relation = "local" | "shared" | null;

export function relation(index: PlaceIndex, applies: readonly string[], scope: string): Relation {
  if (applies.some((x) => isWithin(index, x, scope))) return "local";
  if (applies.some((x) => isWithin(index, scope, x))) return "shared";
  return null;
}

/** Breadcrumb chain from the country down to the place, by navigation parent. */
export function breadcrumbs(index: PlaceIndex, key: string): readonly Place[] {
  const chain: Place[] = [];
  const seen = new Set<string>();
  let at: string | null = key;
  while (at && !seen.has(at)) {
    seen.add(at);
    const place = index.get(at);
    if (!place) break;
    chain.unshift(place);
    at = place.navParent;
  }
  return chain;
}

/** The hunt started on this place, or the hunt on a place this one is inside. */
export function huntAt(index: PlaceIndex, hunts: readonly Hunt[], key: string): Hunt | null {
  const own = hunts.find((h) => h.placeKey === key && h.status !== "stopped");
  if (own) return own;
  const up = containers(index, key);
  return hunts.find((h) => up.has(h.placeKey) && h.status !== "stopped") ?? null;
}

/** Every hunt started inside this place (including on it). */
export function huntsWithin(index: PlaceIndex, hunts: readonly Hunt[], key: string): readonly Hunt[] {
  return hunts.filter((h) => h.status !== "stopped" && isWithin(index, h.placeKey, key));
}

/* --------------------------------------------------- MwScope <-> place key */

export const COUNTRY_KEY = "us";

export function placeKeyOf(scope: MwScope): string {
  switch (scope.kind) {
    case "all":
      return COUNTRY_KEY;
    case "state":
      return `st:${scope.state}`;
    case "geo":
      return `geo:${scope.state}.${scope.type}.${scope.geoid}`;
  }
}

/** The deployed scope a place key stands for, or null when the deployed type cannot carry it (a body). */
export function scopeOfPlaceKey(key: string): MwScope | null {
  if (key === COUNTRY_KEY) return { kind: "all" };
  const st = /^st:([a-z]{2})$/.exec(key);
  if (st) return { kind: "state", state: st[1] };
  const geo = /^geo:([a-z]{2})\.([a-z_]+)\.([0-9a-z]{1,16})$/.exec(key);
  if (geo) {
    const type = geo[2] as Extract<MwScope, { kind: "geo" }>["type"];
    return { kind: "geo", type, geoid: geo[3], state: geo[1] };
  }
  return null;
}

/** Search the picker's places. Country first, then states, counties, ZIPs, bodies. */
const KIND_ORDER = ["Country", "State", "County", "ZIP", "Area", "Body"];
export function pickerMatches(places: readonly Place[], hunts: readonly Hunt[], query: string, limit = 30): readonly Place[] {
  const q = query.trim().toLowerCase();
  // "az6", "AZ 6" and "az-06" all name AZ-06.
  const district = districtLabelOfQuery(query)?.toLowerCase() ?? null;
  return places
    .filter((p) => {
      if (!q) return true;
      if (district !== null && p.name.toLowerCase() === district) return true;
      if (p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)) return true;
      if (p.code && p.code.toLowerCase() === q) return true;
      return hunts.some((h) => h.placeKey === p.key && h.id.toLowerCase().includes(q));
    })
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** What The country lists at a scope: states at the country, congressional districts at a state, ZIPs at a district; nothing elsewhere. */
export type NationalDepth = "states" | "districts" | "zips";
export function nationalDepth(key: string): NationalDepth | null {
  if (key === COUNTRY_KEY) return "states";
  if (/^st:[a-z]{2}$/.test(key)) return "districts";
  return /^geo:[a-z]{2}\.congressional_district\.\d{4}$/.test(key) ? "zips" : null;
}
