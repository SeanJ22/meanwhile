/**
 * **WHAT ANY PLACE IS OWED AND WHAT WE HOLD, READ FOR ADMIN.**
 *
 * One place key in, S9's owed list out: every division the place touches, then
 * everything a reader there is owed, filled from what is already held for those
 * divisions by any job (`readHeldPlaceCapture`, S6), then the blanks named.
 * A ZIP resolves to every Census polygon it intersects (`divisionsForZip`, S9);
 * a county resolves to its own government; a state to its own government. No
 * agent runs and nothing is written: this is a read of held data, and a failed
 * read is a named refusal, never an empty place that looks finished.
 *
 * The result is memoized for a few minutes per place, so paging the list and
 * moving between tabs do not repeat the Census and reader-database reads.
 */
import { divisionsForZip, type PlaceDivision } from "../expansion/national-geography.ts";
import { readHeldPlaceCapture, type HeldPlaceCapture } from "../../civic-data/held-place-capture.ts";
import { buildPlaceOwedList, type PlaceOwedItem } from "../../coverage/place-owed.ts";
import { openBlanksOf, type OpenBlanks } from "../../coverage/open-blanks.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { countyIdentity, stateBase } from "../../ocd/divisions.ts";
import { parseV6PlaceKey } from "./v6-hunts-read.ts";
import { districtDivisions, readStateDistricts } from "./v6-national-geography.ts";

export interface PlaceOwedRead {
  readonly state: "READ";
  readonly placeKey: string;
  readonly label: string;
  /** What the owed list covers, in words, so a county or state never reads as a whole ZIP. */
  readonly covers: string;
  readonly divisions: readonly { readonly id: string; readonly label: string }[];
  readonly rows: readonly PlaceOwedItem[];
  readonly observedAt: string;
  readonly readMs: { readonly geography: number; readonly held: number };
}
export interface PlaceOwedRefusal {
  readonly state: "REFUSED";
  readonly code: "NOT_A_PLACE" | "GEOGRAPHY_UNREAD" | "HELD_UNREAD" | "UNSUPPORTED_PLACE";
  readonly says: string;
}

export interface PlaceOwedDeps {
  readonly now: () => string;
  readonly resolveDivisions: (place: ResolvedPlace) => Promise<{ readonly label: string; readonly covers: string; readonly divisions: readonly PlaceDivisionLike[] }>;
  readonly readHeld: (divisionIds: readonly string[], now: string) => Promise<HeldPlaceCapture>;
}
export interface PlaceDivisionLike {
  readonly id: string;
  readonly label: string;
  readonly funcstat?: string;
}
export type ResolvedPlace =
  | { readonly kind: "zip"; readonly zip: string; readonly state: string }
  | { readonly kind: "county"; readonly geoid: string; readonly state: string }
  | { readonly kind: "district"; readonly geoid: string; readonly state: string }
  | { readonly kind: "state"; readonly state: string };

/** The owed list is defined for a ZIP, a county, a congressional district or a state. Other geographies and the country are not a place view. */
export function resolvePlaceKey(key: string): ResolvedPlace | PlaceOwedRefusal {
  const scope = parseV6PlaceKey(key);
  if (scope === null || scope.kind === "country") return { state: "REFUSED", code: "NOT_A_PLACE", says: "Choose a ZIP, a county, a congressional district or a state to see what it is owed. The whole country is a list of states, not one place." };
  if (scope.kind === "state") return { kind: "state", state: scope.state };
  if (scope.type === "zcta" && /^\d{5}$/.test(scope.geoid)) return { kind: "zip", zip: scope.geoid, state: scope.state };
  if (scope.type === "county" && /^\d{5}$/.test(scope.geoid)) return { kind: "county", geoid: scope.geoid, state: scope.state };
  if (scope.type === "congressional_district" && /^\d{4}$/.test(scope.geoid)) return { kind: "district", geoid: scope.geoid, state: scope.state };
  return { state: "REFUSED", code: "UNSUPPORTED_PLACE", says: "This geography type has no owed list yet. A ZIP, a county, a congressional district or a state does." };
}

const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer";
const fipsOfState = (postal: string) => Object.entries(FIPS_TO_STATE).find(([, e]) => e.postal === postal.toUpperCase())?.[0] ?? null;

async function tigerJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Census returned HTTP ${res.status}`);
  const body = await res.json() as T & { error?: { message?: string } };
  if ((body as { error?: unknown }).error) throw new Error(`Census: ${(body as { error: { message?: string } }).error.message ?? "error"}`);
  return body;
}

async function countyDivision(geoid: string, state: string): Promise<PlaceDivisionLike> {
  const fips = fipsOfState(state);
  if (fips === null || !geoid.startsWith(fips)) throw new Error("This county code does not belong to that state");
  const meta = await tigerJson<{ layers: { id: number; name: string; type: string }[] }>(`${TIGER}?f=json`);
  const layer = meta.layers.find((l) => l.type === "Feature Layer" && /^Counties$/.test(l.name));
  if (!layer) throw new Error("Census has no county layer");
  const q = new URLSearchParams({ f: "json", where: `GEOID='${geoid}'`, outFields: "NAME,BASENAME,GEOID", returnGeometry: "false" });
  const found = await tigerJson<{ features?: { attributes: Record<string, string> }[] }>(`${TIGER}/${layer.id}/query?${q}`);
  const a = found.features?.[0]?.attributes;
  if (!a) throw new Error("Census did not resolve this county");
  const identity = countyIdentity(fips, String(a.BASENAME ?? a.NAME));
  if (!identity) throw new Error("This county has no OCD identity");
  return { id: identity.ocdId, label: String(a.NAME ?? a.BASENAME) };
}

export const defaultPlaceOwedDeps: PlaceOwedDeps = {
  now: () => new Date().toISOString(),
  async resolveDivisions(place) {
    if (place.kind === "zip") {
      const divisions = await divisionsForZip(place.zip);
      return { label: `ZIP ${place.zip}`, covers: "Every government, district and body whose boundary touches this ZIP, plus the state and the country.", divisions };
    }
    if (place.kind === "district") {
      // One owed list for the whole district: the divisions of every ZIP in it, read from held data once. No network: the ZIPs come from the published lookup and the divisions from the committed ZIP index.
      const read = await readStateDistricts(place.state);
      if (!read.ok) throw new Error(read.says);
      const district = read.districts.find((d) => d.geoid === place.geoid);
      if (district === undefined) throw new Error("The published lookup has no such congressional district in that state");
      return { label: district.label, covers: "Every government, district and body whose boundary touches a ZIP in this district, plus the district itself, the state and the country.", divisions: await districtDivisions(district) };
    }
    if (place.kind === "county") {
      const county = await countyDivision(place.geoid, place.state);
      return { label: county.label, covers: "This county’s own government. Towns, school districts and districts inside it are read in their own ZIP views.", divisions: [county] };
    }
    const fips = fipsOfState(place.state);
    const base = fips === null ? null : stateBase(fips);
    if (base === null) throw new Error("Unknown state");
    return { label: place.state.toUpperCase(), covers: "The state’s own government: statewide offices, the legislature, state agencies and statewide elections and funding. Counties and towns are read in their own views.", divisions: [{ id: base.base, label: place.state.toUpperCase() }] };
  },
  readHeld: (ids, now) => readHeldPlaceCapture(ids, { now }),
};

const MEMO_MS = 5 * 60_000;
const MEMO_PLACES = 24;
const memo = new Map<string, { at: number; read: PlaceOwedRead }>();

export async function readPlaceOwed(placeKey: string, deps: PlaceOwedDeps = defaultPlaceOwedDeps, options: { readonly fresh?: boolean } = {}): Promise<PlaceOwedRead | PlaceOwedRefusal> {
  const place = resolvePlaceKey(placeKey);
  if ("says" in place) return place;
  const cached = memo.get(placeKey);
  if (!options.fresh && cached && Date.now() - cached.at < MEMO_MS) return cached.read;
  const t0 = Date.now();
  let resolved: Awaited<ReturnType<PlaceOwedDeps["resolveDivisions"]>>;
  try { resolved = await deps.resolveDivisions(place); }
  catch (error) {
    return { state: "REFUSED", code: "GEOGRAPHY_UNREAD", says: `The Census boundaries for this place could not be read just now (${error instanceof Error ? error.message : "unknown error"}). Nothing is shown rather than an empty place.` };
  }
  const t1 = Date.now();
  const now = deps.now();
  let held: HeldPlaceCapture;
  try { held = await deps.readHeld(resolved.divisions.map((d) => d.id), now); }
  catch (error) {
    return { state: "REFUSED", code: "HELD_UNREAD", says: `What we hold for this place could not be read just now (${error instanceof Error ? error.message : "unknown error"}). The score is withheld rather than shown as zero.` };
  }
  const rows = buildPlaceOwedList({ divisions: resolved.divisions, subjects: held.subjects, held: held.held, now });
  const read: PlaceOwedRead = { state: "READ", placeKey, label: resolved.label, covers: resolved.covers,
    divisions: resolved.divisions.map((d) => ({ id: d.id, label: d.label })), rows, observedAt: now, readMs: { geography: t1 - t0, held: Date.now() - t1 } };
  memo.set(placeKey, { at: Date.now(), read });
  // A long-lived server holds at most a couple of dozen places; the oldest goes first.
  while (memo.size > MEMO_PLACES) memo.delete(memo.keys().next().value as string);
  return read;
}

/** The mission map's open blanks for a place, grouped by squad then subject: what applies, is due, is not satisfied and is not in progress. A refused read is returned as the refusal, never as an empty map. */
export async function openBlanks(placeKey: string, deps: PlaceOwedDeps = defaultPlaceOwedDeps, options: { readonly fresh?: boolean; readonly squads?: Readonly<Record<string, string>> } = {}): Promise<{ readonly state: "READ"; readonly placeKey: string; readonly blanks: OpenBlanks } | PlaceOwedRefusal> {
  const read = await readPlaceOwed(placeKey, deps, options);
  return read.state === "REFUSED" ? read : { state: "READ", placeKey, blanks: openBlanksOf(read.rows, options.squads) };
}

export type { PlaceDivision };
