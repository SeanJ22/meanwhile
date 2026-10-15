/** The place an owner's words name: a ZIP, county, district, state or a town or city by name, read from the national ZIP index. */
import { askedPlace } from "../control-plane/operator-chat/place-key.ts";
import { divisionIdsOfZip, stateOfZip, visitZipShards } from "../control-plane/bulk-hunts/zip-state.ts";
import { defaultPlaceOwedDeps, resolvePlaceKey, type PlaceOwedDeps } from "../control-plane/admin-view/place-owed-read.ts";
import { stateDivisionId, zipDivisionIds } from "../control-plane/admin-view/v6-national-geography.ts";
import { US_STATES } from "../control-plane/readiness/catalog.ts";

export type PlaceWords =
  | { readonly state: "PLACE"; readonly label: string; readonly divisionIds: readonly string[] }
  | { readonly state: "CHOICES"; readonly choices: readonly { readonly label: string; readonly words: string }[] }
  | { readonly state: "NONE"; readonly says: string };

export interface NamedPlace {
  readonly divisionId: string;
  readonly label: string;
  readonly state: string;
  readonly county: string | null;
  readonly zips: readonly string[];
}

const COUNTRY = "ocd-division/country:us";
const PLACE_ID = /^ocd-division\/country:us\/state:([a-z]{2})(?:\/county:([a-z0-9_~.-]+))?\/place:([a-z0-9_~.-]+)$/;
/** A county subdivision is named with its kind; a typed name may leave it off. */
const KINDS = ["city", "town", "township", "borough", "village"] as const;

const title = (slug: string) => slug.split("_").filter(Boolean).map(word => word[0]!.toUpperCase() + word.slice(1)).join(" ");
export const nameSlug = (words: string) => words.toLowerCase().replace(/&/g, " and ").replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Every town and city in the national ZIP index, by its name and by its name without its kind. Census county divisions are left out. */
export async function readNamedPlaces(): Promise<ReadonlyMap<string, readonly NamedPlace[]>> {
  const zipsOf = new Map<string, string[]>();
  await visitZipShards(shard => {
    for (const [zip, refs] of Object.entries(shard.zips)) for (const i of refs) {
      const id = shard.divisions[i];
      if (id === undefined || !PLACE_ID.test(id) || id.endsWith("_ccd")) continue;
      const held = zipsOf.get(id);
      if (held) held.push(zip); else zipsOf.set(id, [zip]);
    }
  });
  const byName = new Map<string, NamedPlace[]>();
  for (const [divisionId, zips] of zipsOf) {
    const [, state, county, slug] = PLACE_ID.exec(divisionId)!;
    const place: NamedPlace = { divisionId, state: state!, county: county ?? null, zips: zips.sort(),
      label: `${title(slug!)}, ${county ? `${title(county)} County, ` : ""}${state!.toUpperCase()}` };
    const kind = county ? KINDS.find(k => slug!.endsWith(`_${k}`)) : undefined;
    for (const key of new Set([slug!, ...(kind ? [slug!.slice(0, -kind.length - 1)] : [])])) {
      const held = byName.get(key);
      if (held) held.push(place); else byName.set(key, [place]);
    }
  }
  return byName;
}

let named: Promise<ReadonlyMap<string, readonly NamedPlace[]>> | null = null;
const namedPlaces = (): Promise<ReadonlyMap<string, readonly NamedPlace[]>> =>
  named ??= readNamedPlaces().catch(error => { named = null; throw error; });

export interface PlaceWordsDeps {
  readonly named: () => Promise<ReadonlyMap<string, readonly NamedPlace[]>>;
  readonly zipState: (zip: string) => Promise<string | null>;
  readonly zipDivisions: (zips: readonly string[]) => Promise<ReadonlyMap<string, readonly string[]>>;
  readonly resolveDivisions: PlaceOwedDeps["resolveDivisions"];
}

export const defaultPlaceWordsDeps: PlaceWordsDeps = {
  named: namedPlaces, zipState: stateOfZip, zipDivisions: zips => zipDivisionIds(zips, divisionIdsOfZip),
  resolveDivisions: defaultPlaceOwedDeps.resolveDivisions,
};

const stateNamed = (words: string) => US_STATES.find(s => s.code === words.trim().toLowerCase() || s.name.toLowerCase() === words.trim().toLowerCase()) ?? null;

/** A town or city: every division its ZIPs touch except the other towns in them, with its state and the country. */
async function cityPlace(place: NamedPlace, deps: PlaceWordsDeps): Promise<PlaceWords> {
  const byZip = await deps.zipDivisions(place.zips);
  const ids = new Set([COUNTRY, ...(stateDivisionId(place.state) ? [stateDivisionId(place.state)!] : []), place.divisionId]);
  for (const zipIds of byZip.values()) for (const id of zipIds) if (!PLACE_ID.test(id)) ids.add(id);
  return { state: "PLACE", label: place.label, divisionIds: [...ids].sort() };
}

async function keyedPlace(key: string, deps: PlaceWordsDeps): Promise<PlaceWords> {
  const place = resolvePlaceKey(key);
  if ("says" in place) return { state: "NONE", says: place.says };
  const resolved = await deps.resolveDivisions(place);
  return { state: "PLACE", label: resolved.label, divisionIds: resolved.divisions.map(division => division.id).sort() };
}

/** Reads the place in an owner's words. A name that matches several places returns them as choices, each with words that name it alone. */
export async function readPlaceWords(words: string, deps: PlaceWordsDeps = defaultPlaceWordsDeps): Promise<PlaceWords> {
  const text = words.replace(/\s+/g, " ").trim();
  const zip = /^(?:zip\s*)?(\d{5})$/i.exec(text)?.[1];
  if (zip) {
    const state = await deps.zipState(zip);
    return state === null ? { state: "NONE", says: `ZIP ${zip} is not in the national ZIP index.` } : keyedPlace(`geo:${state.toLowerCase()}.zcta.${zip}`, deps);
  }
  const key = askedPlace(text, "");
  if (key !== null && (!key.startsWith("st:") || key === text.toLowerCase())) return keyedPlace(key, deps);
  const wholeState = stateNamed(text);
  if (wholeState !== null) return keyedPlace(`st:${wholeState.code}`, deps);
  const places = await deps.named();
  const exact = PLACE_ID.test(text) ? [...places.values()].flat().find(place => place.divisionId === text) : undefined;
  if (exact) return cityPlace(exact, deps);
  const parts = text.split(",").map(part => part.trim()).filter(Boolean);
  let state: string | null = null;
  let county: string | null = null;
  if (parts.length > 1 && stateNamed(parts.at(-1)!)) state = stateNamed(parts.pop()!)!.code;
  else if (parts.length === 1) {
    const tail = / ([A-Z]{2})$/.exec(parts[0]!);
    if (tail && stateNamed(tail[1]!)) { state = tail[1]!.toLowerCase(); parts[0] = parts[0]!.slice(0, -3); }
  }
  if (parts.length > 1 && / county$/i.test(parts.at(-1)!)) county = nameSlug(parts.pop()!.replace(/ county$/i, ""));
  const matched = [...new Map((places.get(nameSlug(parts.join(" "))) ?? [])
    .filter(place => (state === null || place.state === state) && (county === null || place.county === county))
    .map(place => [place.divisionId, place] as const)).values()];
  // A town is also listed as its county's subdivision of the same name; the town itself is the place meant.
  const towns = new Set(matched.filter(place => place.county === null).map(place => place.state));
  const found = matched.filter(place => place.county === null || !towns.has(place.state) || place.divisionId.endsWith("_township"));
  if (found.length === 0) return { state: "NONE", says: `No ZIP, county, district, state, town or city we hold is named “${text}”.` };
  if (found.length > 1) return { state: "CHOICES", choices: found.map(place => ({ label: place.label, words: place.label })).sort((a, b) => a.label.localeCompare(b.label)) };
  return cityPlace(found[0]!, deps);
}
